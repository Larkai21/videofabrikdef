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
import {
  IDEA_STATUSES,
  ideaDtoSchema,
  inboxDtoSchema,
  libraryListDtoSchema,
  timelineDtoSchema,
  videoDetailDtoSchema,
} from '@fabrica/shared';
import { createApi, type ApiResult, type FabricaApi } from './api.js';
import {
  formatCosts,
  formatInbox,
  formatIdeas,
  formatLibrary,
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
      '(ideas, guion, timeline), publicación y biblioteca. Todas hablan con la API ' +
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
      const query = status ? `?status=${encodeURIComponent(status)}` : '';
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
        kind: z.string().optional().describe('Tipo de asset: clip, image, music, screenshot, upload'),
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
