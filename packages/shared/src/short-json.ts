import { z } from 'zod';
import { brandSchema, masterVideoJsonV1, type EditType } from './master-json.js';

// Contrato del maestro de un SHORT vertical (1080×1920), recortado de un vídeo
// largo ya entregado.
//
// Se deriva del maestro largo con omit/extend en vez de aflojar sus literales
// de `width`/`height`: esos literales son la única validación estructural que
// impide que un maestro corrupto entre en el render largo, y aflojarlos no
// ganaría nada porque el short necesita ADEMÁS campos que el largo no debe
// tener (`video_id`, la ventana de corte). Con omit/extend, todo campo que se
// añada al contrato largo lo hereda el short gratis.

export const shortVideoMetaSchema = z.object({
  /** id del SHORT, no del vídeo largo */
  id: z.string(),
  /** el largo del que se recortó */
  video_id: z.string(),
  channel_id: z.string(),
  idea_id: z.string(),
  fps: z.literal(30),
  width: z.literal(1080),
  height: z.literal(1920),
});

/**
 * Cómo se encuadra un plano apaisado en el lienzo vertical. Se estampa en el
 * recorte a partir de lo que la biblioteca ya sabe del asset (dimensiones y
 * tipo), nunca se infiere durante el render: el principio 6 prohíbe analizar
 * nada mientras se renderiza.
 *
 * - `recorte`: el 16:9 a cover, anclado al punto de foco. La norma.
 * - `cover`: el asset ya es vertical y llena el lienzo. Gana el material.
 * - `entero`: no admite recorte (capturas, gráficos con texto); banda central a
 *   contain con la losa de marca arriba y abajo.
 */
export const SHORT_FRAMINGS = ['recorte', 'cover', 'entero'] as const;
export const shortFramingSchema = z.enum(SHORT_FRAMINGS);
export type ShortFraming = z.infer<typeof shortFramingSchema>;

export const shortCutSchema = z.object({
  /** inicio de la ventana en el reloj del vídeo largo; también el trim del audio */
  source_from_ms: z.number().int().nonnegative(),
  source_to_ms: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
  /** los idx que tenían los beats en el largo, para poder rastrear el origen */
  source_beat_idxs: z.array(z.number().int().nonnegative()).min(1),
  /** rótulo de la cartela superior, no el título del vídeo largo */
  title: z.string().min(1).max(60),
  /** por qué alguien dejaría de deslizar */
  hook: z.string().min(1),
  /** para el humano que aprueba */
  reason: z.string(),
  score: z.number(),
});
export type ShortCut = z.infer<typeof shortCutSchema>;

// La marca del short NO tiene slots de kit: no hay intro (3,2 s sobre 30 es el
// 10 % de la pieza y son justo los segundos que deciden si alguien se queda),
// ni outro (15 s existen para las pantallas finales de YouTube, que en Shorts
// no existen), ni tarjeta de sección (no hay segmentos), ni rótulo (compite con
// los subtítulos por el mismo tercio). Omitir el campo es más honesto que
// arrastrarlo e ignorarlo, que es la clase de fallo que documenta
// EDIT_RENDER_KIND.
export const shortBrandSchema = brandSchema.omit({ components: true });

export const shortMasterV1 = masterVideoJsonV1
  .omit({
    video: true,
    brand: true,
    research: true,
    script: true,
    script_review: true,
    script_telemetry: true,
    broll_telemetry: true,
    // un short de 35 s no tiene capítulos ni tarjetas de sección
    segments: true,
    // los costes son del vídeo largo; el short no gasta al renderizar
    costs: true,
  })
  .extend({
    video: shortVideoMetaSchema,
    brand: shortBrandSchema,
    short: shortCutSchema,
  });

export type ShortMasterJson = z.infer<typeof shortMasterV1>;

/**
 * Qué efectos de edición viven en vertical. `Record` COMPLETO por el mismo
 * motivo que `EDIT_RENDER_KIND`: añadir un tipo a `EDIT_TYPES` sin decidir si
 * cabe a 1080 de ancho no compila.
 */
export const SHORT_EDIT_ALLOWED: Record<EditType, boolean> = {
  zoom_punch: true,
  keyword_highlight: true,
  text_callout: true,
  stat_card: true,
  quote_card: true,
  sfx: true,
  kinetic_text: true,
  stat_odometer: true,
  annotation: true,
  micro_fx: true,
  // Los tres de enumerar ya se maquetan en COLUMNA cuando el lienzo es
  // vertical, que es el eje que este formato sí tiene. Son las únicas formas
  // del catálogo que dibujan una RELACIÓN y no texto en una caja, así que
  // dejarlas fuera era dejar al short sin vocabulario. `pasos_flow` con la
  // última estación acentuada es, literalmente, un cuello de botella.
  split_versus: true,
  pasos_flow: true,
  tendencia: true,
  // el marco de navegador es 16:9 por definición
  device_frame: false,
  // un recuadro apaisado sobre un plano apaisado: dos cajas 16:9 en un lienzo
  // que no tiene ancho para ninguna
  imagen_apoyo: false,
};

// Lo que exige el render del short. Espejo de renderableMasterV1 sin la puerta
// de `seo.chosen_idx` (el título del short es el de su propia cartela) y sin
// `script`, que no viaja en el recorte.
export const renderableShortV1 = shortMasterV1
  .required({ audio: true, cues: true, beats: true, brand: true })
  .superRefine((short, ctx) => {
    for (const beat of short.beats) {
      if (!beat.asset?.path || !beat.asset.kind) {
        ctx.addIssue({
          code: 'custom',
          path: ['beats', beat.idx, 'asset'],
          message: `El beat ${beat.idx} no tiene asset resuelto con path y kind`,
        });
      }
    }
    if (short.beats.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['beats'], message: 'El short no tiene ningún beat' });
    }
  });

export type RenderableShort = z.infer<typeof renderableShortV1>;
