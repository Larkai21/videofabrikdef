import { SHORT_EDIT_ALLOWED, type Edit, type MasterVideoJson, type RenderableShort } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { directEdits, PRESUPUESTO_VERTICAL } from '../assets/editing-director.js';

// Pasada propia del director de edición sobre la ventana del short.
//
// El recorte hereda los efectos del maestro largo que caen dentro de la
// ventana, y son POCOS por construcción: el largo pone ~2 overlays reales por
// minuto, así que treinta segundos traen cero o uno. Un short con un plano
// cambiando cada 2,5 s y nada escrito en pantalla se ve rápido y vacío.
//
// No se re-locuta ni se mueve un corte: la pasada solo produce `edits`, que se
// anclan en ms sobre la ley temporal que ya existe (principio 1). Lo heredado
// entra como DECLARADO —viene del guion, aunque el maestro del short ya no
// lleve `script` para volver a declararlo— y por tanto gana el reparto.

export interface EntradaEfectos {
  master: RenderableShort;
  /** el maestro largo del que se recortó: aporta claims e idioma */
  largo: MasterVideoJson;
  lang: 'en' | 'es';
}

/** El maestro con su línea de efectos rehecha para el formato vertical. */
export async function efectosDelShort(
  ctx: WorkerContext,
  { master, largo, lang }: EntradaEfectos,
): Promise<{ master: RenderableShort; antes: number; despues: number }> {
  const heredados: readonly Edit[] = (master.edits ?? []).filter(
    (e) => SHORT_EDIT_ALLOWED[e.type],
  );

  const edits = await directEdits(
    ctx,
    {
      // el ledger de costes anota la llamada contra el vídeo LARGO: el short no
      // tiene fila propia en cost_ledger y su gasto es del vídeo que lo produjo
      videoId: master.video.video_id,
      channelId: master.video.channel_id,
      lang,
      beats: master.beats.map((b) => ({
        idx: b.idx,
        from_ms: b.from_ms,
        to_ms: b.to_ms,
        text: b.text,
      })),
      cues: master.cues ?? [],
      // Sin `scenes` no hay intenciones que declarar: el maestro del short no
      // lleva `script`. Lo que el guion declaró para esta ventana ya viaja en
      // `heredados`, así que no se pierde — se hereda en vez de recalcularse.
      scenes: [],
      // un short no tiene capítulos, así que no hay whoosh de sección
      segmentStartMs: [],
      seoTags: master.seo?.tags ?? [],
      title: master.short.title,
      hookNotes: master.short.hook,
      // Los claims salen del LARGO: `research` no viaja en el recorte y son la
      // única fuente de cifras admitida en pantalla. Sin ellos, toda tarjeta de
      // dato que proponga la IA se cae por no estar respaldada.
      ...(largo.research ? { claims: largo.research.claims } : {}),
    },
    {
      presupuesto: PRESUPUESTO_VERTICAL,
      heredados,
      // la fila del ledger apunta al vídeo largo; el short_id en meta es lo
      // que permite sumar el coste marginal de la línea de shorts
      ledgerMeta: { short_id: master.video.id },
    },
  );

  return {
    master: { ...master, edits },
    antes: heredados.length,
    despues: edits.length,
  };
}
