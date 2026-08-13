#!/usr/bin/env node
// Servidor MCP stdio de la fábrica (SPEC §14, S3). No toca la base de datos:
// todas las herramientas hablan con la API HTTP (FABRICA_API_URL) y devuelven
// JSON legible. Los errores de la API se devuelven como texto claro, nunca
// como excepciones sin capturar.

import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import {
  ASSET_KINDS,
  IDEA_STATUSES,
  ideaDtoSchema,
  inboxDtoSchema,
  libraryListDtoSchema,
  REEL_FORMATS,
  reelDetailDtoSchema,
  reelPlanLayerSchema,
  reelsListDtoSchema,
  shortsListDtoSchema,
  timelineDtoSchema,
  videoDetailDtoSchema,
} from '@fabrica/shared';
import { createApi, type ApiResult, type FabricaApi } from './api.js';
import {
  formatClips,
  formatCosts,
  formatInbox,
  formatIdeas,
  formatLibrary,
  formatReel,
  formatReels,
  formatTimeline,
  formatVideo,
} from './format.js';

const SERVER_INFO = { name: 'fabrica', version: '0.1.0' } as const;

function textResult(payload: unknown): CallToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

interface Parser<T> {
  parse(data: unknown): T;
}

/** Valida la respuesta contra el contrato de @fabrica/shared sin lanzar. */
function parseDto<T>(schema: Parser<T>, data: unknown, what: string):
  | { ok: true; value: T }
  | { ok: false; message: string } {
  try {
    return { ok: true, value: schema.parse(data) };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      message: `La respuesta de la API para ${what} no cumple el contrato de @fabrica/shared: ${reason}`,
    };
  }
}

/** Encadena petición + parseo + formateo con manejo uniforme de errores. */
async function fetchAndFormat<T>(
  result: Promise<ApiResult>,
  schema: Parser<T>,
  what: string,
  format: (value: T) => unknown,
): Promise<CallToolResult> {
  const res = await result;
  if (!res.ok) return errorResult(res.message);
  const parsed = parseDto(schema, res.data, what);
  if (!parsed.ok) return errorResult(parsed.message);
  return textResult(format(parsed.value));
}

/** POST de puerta: devuelve confirmación breve o el error legible de la API. */
async function actionResult(
  result: Promise<ApiResult>,
  okMessage: string | ((data: unknown) => string),
): Promise<CallToolResult> {
  const res = await result;
  if (!res.ok) return errorResult(res.message);
  return textResult(typeof okMessage === 'function' ? okMessage(res.data) : okMessage);
}

const ideasResponseSchema = z.array(ideaDtoSchema);

export function buildServer(api: FabricaApi = createApi()): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Herramientas de la fábrica de vídeo: bandeja de entrada, puertas humanas ' +
      '(ideas, guion, timeline), publicación, biblioteca y reels del módulo editor ' +
      '(alta, revisión y firma del plan de capas). Todas hablan con la API ' +
      `HTTP local (${api.baseUrl}).`,
  });

  const readOnly = { annotations: { readOnlyHint: true } };

  server.registerTool(
    'inbox_status',
    {
      description:
        'Bandeja de entrada de la fábrica: puertas pendientes de decisión humana, ' +
        'vídeos en curso, entregas terminadas y coste del mes.',
      ...readOnly,
    },
    async () => fetchAndFormat(api.request('GET', '/inbox'), inboxDtoSchema, '/inbox', formatInbox),
  );

  server.registerTool(
    'list_ideas',
    {
      description:
        'Ranking de ideas con puntuación y fuentes. Filtros opcionales: canal y ' +
        `estado (${IDEA_STATUSES.join(', ')}; por defecto new).`,
      inputSchema: {
        channel: z.string().min(1).optional().describe('Id del canal para filtrar'),
        status: z.enum(IDEA_STATUSES).optional().describe('Estado de las ideas (por defecto new)'),
      },
      ...readOnly,
    },
    async ({ channel, status }) => {
      // el filtro de canal se aplica en la API (?channel=), no en cliente
      const params = new URLSearchParams();
      if (status !== undefined) params.set('status', status);
      if (channel !== undefined) params.set('channel', channel);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      return fetchAndFormat(
        api.request('GET', `/ideas${query}`),
        ideasResponseSchema,
        '/ideas',
        (ideas) => formatIdeas(ideas, channel === undefined ? {} : { channel }),
      );
    },
  );

  server.registerTool(
    'approve_idea',
    {
      description: 'Aprueba una idea del ranking y arranca la producción del vídeo.',
      inputSchema: { idea_id: z.string().min(1).describe('Id de la idea') },
    },
    async ({ idea_id }) =>
      actionResult(
        api.request('POST', `/ideas/${encodeURIComponent(idea_id)}/approve`),
        (data) => {
          const videoId =
            data && typeof data === 'object' && 'video_id' in data
              ? String((data as { video_id: unknown }).video_id)
              : 'desconocido';
          return `Idea ${idea_id} aprobada. Vídeo creado: ${videoId} (estado idea_aprobada; el guion se genera en segundo plano).`;
        },
      ),
  );

  server.registerTool(
    'discard_idea',
    {
      description: 'Descarta una idea del ranking, con motivo opcional.',
      inputSchema: {
        idea_id: z.string().min(1).describe('Id de la idea'),
        reason: z.string().optional().describe('Motivo del descarte'),
      },
    },
    async ({ idea_id, reason }) =>
      actionResult(
        api.request(
          'POST',
          `/ideas/${encodeURIComponent(idea_id)}/discard`,
          reason === undefined ? undefined : { reason },
        ),
        `Idea ${idea_id} descartada.`,
      ),
  );

  server.registerTool(
    'get_video',
    {
      description:
        'Estado de un vídeo y resumen de su JSON maestro: títulos propuestos, ' +
        'guion por secciones, audio, beats por estado, coste y publicación.',
      inputSchema: { video_id: z.string().min(1).describe('Id del vídeo') },
      ...readOnly,
    },
    async ({ video_id }) =>
      fetchAndFormat(
        api.request('GET', `/videos/${encodeURIComponent(video_id)}`),
        videoDetailDtoSchema,
        `/videos/${video_id}`,
        formatVideo,
      ),
  );

  server.registerTool(
    'choose_title',
    {
      description: 'Elige uno de los tres títulos propuestos (índices 0 a 2) en la puerta de guion.',
      inputSchema: {
        video_id: z.string().min(1).describe('Id del vídeo'),
        chosen_idx: z.number().int().min(0).max(2).describe('Índice del título elegido (0-2)'),
      },
    },
    async ({ video_id, chosen_idx }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/title`, { chosen_idx }),
        `Título ${chosen_idx} elegido para el vídeo ${video_id}.`,
      ),
  );

  server.registerTool(
    'approve_script',
    {
      description: 'Aprueba el guion (puerta de guion) y lanza la síntesis de voz.',
      inputSchema: { video_id: z.string().min(1).describe('Id del vídeo') },
    },
    async ({ video_id }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/approve-script`),
        `Guion aprobado para el vídeo ${video_id}; la síntesis de voz queda encolada.`,
      ),
  );

  server.registerTool(
    'request_rewrite',
    {
      description: 'Pide una reescritura del guion con un motivo (vuelve a guion_borrador).',
      inputSchema: {
        video_id: z.string().min(1).describe('Id del vídeo'),
        reason: z.string().min(1).describe('Motivo de la reescritura'),
      },
    },
    async ({ video_id, reason }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/rewrite`, { reason }),
        `Reescritura encargada para el vídeo ${video_id}.`,
      ),
  );

  server.registerTool(
    'timeline_status',
    {
      description:
        'Timeline de un vídeo: beats con tiempos, estado, origen del asset elegido y puntuación.',
      inputSchema: { video_id: z.string().min(1).describe('Id del vídeo') },
      ...readOnly,
    },
    async ({ video_id }) =>
      fetchAndFormat(
        api.request('GET', `/videos/${encodeURIComponent(video_id)}/timeline`),
        timelineDtoSchema,
        `/videos/${video_id}/timeline`,
        formatTimeline,
      ),
  );

  server.registerTool(
    'approve_beat',
    {
      description: 'Aprueba un beat de la timeline (bloquea su mejor candidato).',
      inputSchema: {
        video_id: z.string().min(1).describe('Id del vídeo'),
        idx: z.number().int().min(0).describe('Índice del beat'),
      },
    },
    async ({ video_id, idx }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/beats/${idx}`, {
          action: 'approve',
        }),
        `Beat ${idx} aprobado en el vídeo ${video_id}.`,
      ),
  );

  server.registerTool(
    'discard_beat',
    {
      description:
        'Descarta el asset propuesto de un beat con un motivo; se re-buscan candidatos.',
      inputSchema: {
        video_id: z.string().min(1).describe('Id del vídeo'),
        idx: z.number().int().min(0).describe('Índice del beat'),
        reason: z.string().min(1).describe('Motivo del descarte (alimenta la nueva búsqueda)'),
      },
    },
    async ({ video_id, idx, reason }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/beats/${idx}`, {
          action: 'discard',
          reason,
        }),
        `Beat ${idx} descartado en el vídeo ${video_id}; se buscarán candidatos nuevos.`,
      ),
  );

  server.registerTool(
    'approve_timeline',
    {
      description:
        'Aprueba la timeline completa (todos los beats deben estar aprobados) y lanza la ingesta y el render.',
      inputSchema: { video_id: z.string().min(1).describe('Id del vídeo') },
    },
    async ({ video_id }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/approve-timeline`),
        `Timeline aprobada para el vídeo ${video_id}; ingesta de assets y render en marcha.`,
      ),
  );

  server.registerTool(
    'retry_video',
    {
      description: 'Reintenta un vídeo en incidencia (vuelve al estado previo y re-encola su job).',
      inputSchema: { video_id: z.string().min(1).describe('Id del vídeo') },
    },
    async ({ video_id }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/retry`),
        `Reintento lanzado para el vídeo ${video_id}.`,
      ),
  );

  server.registerTool(
    'publish_video',
    {
      description:
        'Aprueba la publicación en YouTube de un vídeo terminado (subida en privado y programación según los ajustes del canal).',
      inputSchema: { video_id: z.string().min(1).describe('Id del vídeo') },
    },
    async ({ video_id }) =>
      actionResult(
        api.request('POST', `/videos/${encodeURIComponent(video_id)}/publish`),
        `Publicación encolada para el vídeo ${video_id}; sigue el estado con get_video.`,
      ),
  );

  server.registerTool(
    'library_search',
    {
      description:
        'Busca en la biblioteca local de assets por texto (descripción, etiquetas, consulta de origen) y tipo opcional.',
      inputSchema: {
        q: z.string().min(1).describe('Texto a buscar'),
        kind: z
          .enum(ASSET_KINDS)
          .optional()
          .describe('Tipo de asset: clip, image, music, screenshot o upload'),
      },
      ...readOnly,
    },
    async ({ q, kind }) => {
      const params = new URLSearchParams({ q, limit: '30' });
      if (kind) params.set('kind', kind);
      return fetchAndFormat(
        api.request('GET', `/library?${params.toString()}`),
        libraryListDtoSchema,
        '/library',
        formatLibrary,
      );
    },
  );

  server.registerTool(
    'production_costs',
    {
      description:
        'Coste agregado del ledger para el mes en curso (total, presupuesto y vídeos terminados). Solo mes en curso.',
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM')
          .optional()
          .describe('Mes YYYY-MM (solo se admite el mes en curso)'),
      },
      ...readOnly,
    },
    async ({ month }) => {
      const res = await api.request('GET', '/inbox');
      if (!res.ok) return errorResult(res.message);
      const parsed = parseDto(inboxDtoSchema, res.data, '/inbox');
      if (!parsed.ok) return errorResult(parsed.message);
      const costs = formatCosts(parsed.value, month);
      if (!costs.ok) return errorResult(costs.message);
      return textResult(costs.value);
    },
  );

  // ---- clips de episodios (clipping): la puerta de curación vía agente ----

  server.registerTool(
    'list_episode_clips',
    {
      description:
        'Clips de un episodio (todos, descartados incluidos): estado, ventana, ' +
        'gancho y confianza. propuesto = esperando approve_clip/discard_clip.',
      inputSchema: { episode_id: z.string().min(1).describe('Id del episodio') },
      ...readOnly,
    },
    async ({ episode_id }) =>
      fetchAndFormat(
        api.request('GET', `/episodios/${encodeURIComponent(episode_id)}/clips`),
        shortsListDtoSchema,
        `/episodios/${episode_id}/clips`,
        (dto) => formatClips(dto.shorts),
      ),
  );

  server.registerTool(
    'propose_episode_clips',
    {
      description:
        'Pide clips de un episodio LISTO con encuadre elegido (409 si falta ' +
        'cualquiera de los dos). «Proponer otros» excluye solo las ventanas ya ' +
        'propuestas y las descartadas con su motivo.',
      inputSchema: { episode_id: z.string().min(1).describe('Id del episodio') },
    },
    async ({ episode_id }) =>
      actionResult(
        api.request('POST', `/episodios/${encodeURIComponent(episode_id)}/clips`),
        (data) => {
          const enCurso =
            data && typeof data === 'object' && 'ya_en_curso' in data
              ? (data as { ya_en_curso: unknown }).ya_en_curso === true
              : false;
          return enCurso
            ? `Ya se están buscando clips del episodio ${episode_id}.`
            : `Buscando clips del episodio ${episode_id}; míralos con list_episode_clips.`;
        },
      ),
  );

  server.registerTool(
    'propose_episode_clip_window',
    {
      description:
        'Propone un clip de una SUBVENTANA explícita del episodio (segundos ' +
        'del original). Salta al director y sus exclusiones: para re-cortes ' +
        'de zonas ya renderizadas o momentos que el LLM evita. La ventana se ' +
        'ajusta a beats y frases; el título provisional se edita en la puerta.',
      inputSchema: {
        episode_id: z.string().min(1).describe('Id del episodio'),
        from_s: z.number().nonnegative().describe('Segundo de inicio en el original'),
        to_s: z.number().positive().describe('Segundo de fin en el original'),
      },
    },
    async ({ episode_id, from_s, to_s }) =>
      actionResult(
        api.request('POST', `/episodios/${encodeURIComponent(episode_id)}/clips`, {
          ventana: { from_ms: Math.round(from_s * 1000), to_ms: Math.round(to_s * 1000) },
        }),
        `Subventana ${from_s}-${to_s} s encolada; mírala con list_episode_clips.`,
      ),
  );

  server.registerTool(
    'approve_clip',
    {
      description: 'Aprueba un clip propuesto y lo manda a la cola de render.',
      inputSchema: { clip_id: z.string().min(1).describe('Id del clip (short)') },
    },
    async ({ clip_id }) =>
      actionResult(
        api.request('POST', `/shorts/${encodeURIComponent(clip_id)}/approve`),
        `Clip ${clip_id} aprobado; entra en la cola de render.`,
      ),
  );

  server.registerTool(
    'discard_clip',
    {
      description:
        'Descarta un clip propuesto con motivo. El motivo es la única señal ' +
        'humana que el director aprende: escríbelo de verdad.',
      inputSchema: {
        clip_id: z.string().min(1).describe('Id del clip (short)'),
        reason: z.string().min(1).describe('Por qué no vale (alimenta la siguiente propuesta)'),
      },
    },
    async ({ clip_id, reason }) =>
      actionResult(
        api.request('POST', `/shorts/${encodeURIComponent(clip_id)}/discard`, { reason }),
        `Clip ${clip_id} descartado.`,
      ),
  );

  // ---- reels (módulo editor): el agente como director antes de la firma ----

  server.registerTool(
    'list_reels',
    {
      description:
        'Lista los reels del módulo editor con su estado. plan_listo = plan esperando ' +
        'revisión: es el momento de get_reel + update_reel_plan + approve_reel_render.',
      ...readOnly,
    },
    async () =>
      fetchAndFormat(api.request('GET', '/reels'), reelsListDtoSchema, '/reels', (dto) =>
        formatReels(dto.reels),
      ),
  );

  server.registerTool(
    'get_reel',
    {
      description:
        'Detalle de un reel: estado, guion congelado y el PLAN COMPLETO de capas ' +
        '(el mismo array que update_reel_plan espera de vuelta tras editarlo). ' +
        'Las plantillas y sus configs se documentan en apps/editor/guiones/CATALOGO.json.',
      inputSchema: { reel_id: z.string().min(1).describe('Id del reel') },
      ...readOnly,
    },
    async ({ reel_id }) =>
      fetchAndFormat(
        api.request('GET', `/reels/${encodeURIComponent(reel_id)}`),
        reelDetailDtoSchema,
        `/reels/${reel_id}`,
        formatReel,
      ),
  );

  server.registerTool(
    'create_reel',
    {
      description:
        'Da de alta un reel: sube el A-roll (ruta local de esta máquina) con su guion ' +
        'de dirección JSON (contrato en apps/editor/guiones/CONTRATO.md). La máquina ' +
        'transcribe, cruza el guion con lo grabado y deja el plan en plan_listo.',
      inputSchema: {
        aroll_path: z.string().min(1).describe('Ruta local del vídeo bruto (A-roll)'),
        guion_json: z.string().min(2).describe('El guion de dirección, como JSON en texto'),
        channel_id: z.string().min(1).describe('Canal destino'),
        title: z.string().optional().describe('Título; si falta, sale del guion'),
        formato: z.enum(REEL_FORMATS).optional().describe('Lienzo (por defecto 9:16)'),
      },
    },
    async ({ aroll_path, guion_json, channel_id, title, formato }) => {
      if (!existsSync(aroll_path)) {
        return errorResult(`No existe el fichero: ${aroll_path}`);
      }
      try {
        const parsed: unknown = JSON.parse(guion_json);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return errorResult('El guion debe ser un objeto JSON (no array ni escalar).');
        }
      } catch (cause) {
        return errorResult(
          `El guion no es JSON válido: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      const form = new FormData();
      // openAsBlob: el A-roll puede ser de GB y no debe pasar por memoria
      form.append('aroll', await openAsBlob(aroll_path), basename(aroll_path));
      form.append('channel_id', channel_id);
      form.append('guion', guion_json);
      if (title !== undefined && title.trim() !== '') form.append('title', title);
      if (formato !== undefined) form.append('formato', formato);
      return actionResult(api.upload('/reels', form), (data) => {
        const reelId =
          data && typeof data === 'object' && 'reel_id' in data
            ? String((data as { reel_id: unknown }).reel_id)
            : 'desconocido';
        return (
          `Reel ${reelId} en cola: transcripción y plan en marcha. ` +
          'Sigue el estado con get_reel; en plan_listo toca revisar y firmar.'
        );
      });
    },
  );

  server.registerTool(
    'update_reel_plan',
    {
      description:
        'Reemplaza el plan de capas de un reel (solo en plan_listo). Manda el plan ' +
        'ENTERO editado, no un parche: capas con capa/template/t/duracion/config. ' +
        'Lo firmado con approve_reel_render será exactamente lo último guardado aquí.',
      inputSchema: {
        reel_id: z.string().min(1).describe('Id del reel'),
        plan: z
          .array(reelPlanLayerSchema)
          .min(1)
          .describe('El plan completo de capas que sustituye al actual'),
      },
    },
    async ({ reel_id, plan }) =>
      actionResult(
        api.request('PATCH', `/reels/${encodeURIComponent(reel_id)}/plan`, { plan }),
        (data) => {
          const capas =
            data && typeof data === 'object' && 'capas' in data
              ? String((data as { capas: unknown }).capas)
              : String(plan.length);
          return `Plan del reel ${reel_id} guardado (${capas} capas).`;
        },
      ),
  );

  server.registerTool(
    'approve_reel_render',
    {
      description:
        'Firma el plan de un reel en plan_listo y lanza el render (rasterizado ' +
        'Playwright + composición ffmpeg). Se renderiza exactamente el plan guardado.',
      inputSchema: { reel_id: z.string().min(1).describe('Id del reel') },
    },
    async ({ reel_id }) =>
      actionResult(
        api.request('POST', `/reels/${encodeURIComponent(reel_id)}/render`),
        `Plan firmado; render del reel ${reel_id} en cola. Sigue el estado con get_reel.`,
      ),
  );

  server.registerTool(
    'regenerate_reel_plan',
    {
      description:
        'Vuelve a preparar el plan de un reel en plan_listo releyendo su guion ' +
        'congelado (útil tras corregir el cruce guion↔grabación). Descarta ediciones.',
      inputSchema: { reel_id: z.string().min(1).describe('Id del reel') },
    },
    async ({ reel_id }) =>
      actionResult(
        api.request('POST', `/reels/${encodeURIComponent(reel_id)}/preparar`),
        `Regenerando el plan del reel ${reel_id} desde su guion.`,
      ),
  );

  server.registerTool(
    'retry_reel',
    {
      description: 'Reintenta un reel en incidencia (vuelve al estado previo y re-encola su job).',
      inputSchema: { reel_id: z.string().min(1).describe('Id del reel') },
    },
    async ({ reel_id }) =>
      actionResult(
        api.request('POST', `/reels/${encodeURIComponent(reel_id)}/retry`),
        `Reintento lanzado para el reel ${reel_id}.`,
      ),
  );

  return server;
}

async function main(): Promise<void> {
  const api = createApi();
  const server = buildServer(api);
  await server.connect(new StdioServerTransport());
  // stdout es del protocolo; los avisos van por stderr
  console.error(`Servidor MCP de la fábrica listo (API: ${api.baseUrl})`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((cause) => {
    console.error('El servidor MCP no pudo arrancar:', cause);
    process.exit(1);
  });
}
