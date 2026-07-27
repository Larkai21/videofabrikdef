// Formateadores puros: DTO de la API → objeto JSON legible para el LLM.
// Sin E/S y sin dependencia del SDK MCP para poder testearlos en aislamiento.

import type {
  IdeaDto,
  InboxDto,
  LibraryListDto,
  TimelineDto,
  VideoDetailDto,
  YoutubePublication,
} from '@fabrica/shared';

const MAX_TEXT = 120;

export function truncate(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function msToS(ms: number): number {
  return Math.round(ms / 100) / 10;
}

export function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Clave YYYY-MM del mes en curso en UTC: el agregado del API sale de un
 * date_trunc de Postgres y el MCP puede correr en otra zona horaria.
 */
export function currentMonthKey(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function formatYoutube(youtube: YoutubePublication | null): Record<string, unknown> | null {
  if (!youtube) return null;
  return {
    estado: youtube.status,
    video_id: youtube.youtube_id,
    url: youtube.url,
    privacidad: youtube.privacy_status,
    programado_para: youtube.publish_at,
    subido_el: youtube.uploaded_at,
    error: youtube.error,
  };
}

export function formatInbox(inbox: InboxDto): Record<string, unknown> {
  return {
    puertas_pendientes: inbox.gates.map((gate) => ({
      tipo: gate.kind,
      paso: gate.step_label,
      titulo: gate.title,
      detalle: gate.meta,
      canal: gate.channel_id,
      video_id: gate.video_id,
      eta_min: gate.eta_min,
    })),
    en_curso: inbox.running.map((run) => ({
      video_id: run.video_id,
      titulo: run.title,
      estado: run.state,
      detalle: run.detail,
      coste_usd: roundUsd(run.cost_usd),
      incidencia: run.incident
        ? { mensaje: run.incident.message, accion_sugerida: run.incident.suggested_action }
        : null,
    })),
    entregas: inbox.done.map((done) => ({
      video_id: done.video_id,
      titulo: done.title,
      carpeta_salida: done.output_dir,
      terminado_el: done.finished_at,
      youtube: formatYoutube(done.youtube),
    })),
    coste_del_mes: {
      total_usd: roundUsd(inbox.month_cost_usd),
      presupuesto_usd: inbox.month_budget_usd,
      restante_usd: roundUsd(inbox.month_budget_usd - inbox.month_cost_usd),
      videos_terminados: inbox.month_videos,
    },
  };
}

export function formatIdeas(ideas: IdeaDto[], filter: { channel?: string } = {}): Record<string, unknown> {
  const rows = filter.channel ? ideas.filter((idea) => idea.channel_id === filter.channel) : ideas;
  return {
    total: rows.length,
    ideas: rows.map((idea, position) => ({
      puesto: position + 1,
      id: idea.id,
      titulo: idea.title,
      puntuacion: idea.score,
      estado: idea.status,
      canal: idea.channel_id,
      resumen: truncate(idea.summary, 200),
      angulo: idea.angle,
      por_que_ahora: idea.why_now,
      fuentes: idea.source_refs.map((ref) => ref.domain ?? ref.title ?? ref.url),
      creada_el: idea.created_at,
    })),
  };
}

function beatCountsByStatus(beats: { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const beat of beats) {
    counts[beat.status] = (counts[beat.status] ?? 0) + 1;
  }
  return counts;
}

export function formatVideo(video: VideoDetailDto): Record<string, unknown> {
  const { master } = video;
  const scenes = master.script?.scenes ?? [];
  const beats = master.beats ?? [];

  const sections: Record<string, number> = {};
  let words = 0;
  for (const scene of scenes) {
    sections[scene.section] = (sections[scene.section] ?? 0) + 1;
    words += scene.text.split(/\s+/).filter(Boolean).length;
  }

  return {
    id: video.id,
    canal: video.channel_id,
    estado: video.state,
    titulo_elegido: video.title_chosen,
    titulos: master.seo
      ? master.seo.titles.map((title, idx) => ({
          idx,
          titulo: title,
          elegido: master.seo?.chosen_idx === idx,
        }))
      : null,
    guion: master.script
      ? {
          escenas: scenes.length,
          por_seccion: sections,
          palabras: words,
          notas_hook: truncate(master.script.hook_notes),
        }
      : null,
    audio: master.audio
      ? { duracion_s: msToS(master.audio.duration_ms), lufs: master.audio.lufs }
      : null,
    beats: beats.length
      ? { total: beats.length, por_estado: beatCountsByStatus(beats) }
      : null,
    coste_usd: roundUsd(video.costs_total),
    youtube: formatYoutube(video.youtube),
    incidencia: video.incident
      ? { mensaje: video.incident.message, accion_sugerida: video.incident.suggested_action }
      : null,
    creado_el: video.created_at,
    actualizado_el: video.updated_at,
  };
}

export function formatTimeline(timeline: TimelineDto): Record<string, unknown> {
  return {
    video_id: timeline.video_id,
    estado_video: timeline.state,
    duracion_s: msToS(timeline.duration_ms),
    resumen: beatCountsByStatus(timeline.beats),
    beats: timeline.beats.map((beat) => ({
      idx: beat.idx,
      de_s: msToS(beat.from_ms),
      a_s: msToS(beat.to_ms),
      estado: beat.status,
      texto: truncate(beat.text),
      consulta_visual: beat.visual_query,
      origen: beat.chosen_origin ?? null,
      puntuacion: beat.chosen_score ?? null,
      candidatos: beat.candidates?.length ?? 0,
      motivo_descarte: beat.discard_reason ?? null,
    })),
  };
}

export function formatLibrary(list: LibraryListDto): Record<string, unknown> {
  return {
    total: list.total,
    mostrados: list.assets.length,
    assets: list.assets.map((asset) => ({
      id: asset.id,
      tipo: asset.kind,
      canal: asset.channel_id,
      fuente: asset.source,
      licencia: asset.license,
      duracion_s: asset.duration_ms === null ? null : msToS(asset.duration_ms),
      dimensiones: asset.width && asset.height ? `${asset.width}x${asset.height}` : null,
      etiquetas: asset.tags,
      descripcion: asset.caption ? truncate(asset.caption) : null,
      consulta_origen: asset.origin_query,
      usos: asset.times_used,
      candidato_a_purga: asset.purge_candidate,
      creado_el: asset.created_at,
    })),
  };
}

/**
 * Agregado de costes del mes a partir de /inbox (SPEC §14: el ledger solo
 * expone el mes en curso por esa vía; los históricos necesitan endpoint propio).
 */
export function formatCosts(
  inbox: InboxDto,
  month: string | undefined,
  now: Date = new Date(),
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const current = currentMonthKey(now);
  if (month !== undefined && month !== current) {
    return {
      ok: false,
      message:
        `Solo hay agregado del mes en curso (${current}) vía /inbox. ` +
        `Consultar ${month} requeriría un endpoint nuevo del ledger que aún no existe.`,
    };
  }
  return {
    ok: true,
    value: {
      mes: current,
      coste_total_usd: roundUsd(inbox.month_cost_usd),
      presupuesto_usd: inbox.month_budget_usd,
      restante_usd: roundUsd(inbox.month_budget_usd - inbox.month_cost_usd),
      videos_terminados: inbox.month_videos,
      nota: 'Agregado del ledger de costes del mes en curso (fuente: /inbox).',
    },
  };
}
