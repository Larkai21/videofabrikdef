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

export const shortVideoMetaSchema = z
  .object({
    /** id del SHORT, no de su origen */
    id: z.string(),
    /** el vídeo largo del que se recortó (origen fábrica) */
    video_id: z.string().optional(),
    /** el episodio externo del que se recortó (origen clipping) */
    episode_id: z.string().optional(),
    channel_id: z.string(),
    idea_id: z.string().optional(),
    fps: z.literal(30),
    width: z.literal(1080),
    height: z.literal(1920),
  })
  .superRefine((v, ctx) => {
    // exactamente un origen: un short sin padre no se puede auditar y uno con
    // dos padres no se puede facturar
    const origenes = [v.video_id, v.episode_id].filter((x) => x !== undefined).length;
    if (origenes !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'El short necesita exactamente un origen: video_id o episode_id',
      });
    }
    if (v.video_id !== undefined && v.idea_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un short de vídeo de la fábrica lleva idea_id',
      });
    }
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
  /** inicio de la ventana en el reloj del origen; también el trim del audio */
  source_from_ms: z.number().int().nonnegative(),
  source_to_ms: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
  /** los idx que tenían los beats en el origen, para poder rastrear */
  source_beat_idxs: z.array(z.number().int().nonnegative()).min(1),
  /** rótulo de la cartela superior, no el título del origen */
  title: z.string().min(1).max(60),
  /** por qué alguien dejaría de deslizar */
  hook: z.string().min(1),
  /** para el humano que aprueba */
  reason: z.string(),
  score: z.number(),
  /**
   * Solo clips de EPISODIO externo: la fuente CONGELADA en el maestro. Es el
   * registro de defensa ante reclamaciones (sobrevive a purgar el episodio) y
   * la materia prima de la atribución automática en description.txt.
   */
  fuente: z
    .object({
      source_url: z.string(),
      source_title: z.string(),
      source_channel_name: z.string(),
    })
    .optional(),
  /**
   * Solo clips de episodio: el plan de encuadre POR PLANO que el pre-corte
   * horneó en el fichero (cambios de plano por scene detection + cara más
   * grande vía Vision de macOS, congelado al proponer — principio 6). Es
   * auditoría: el render no lo lee, el clip ya viene recortado.
   */
  encuadre_plan: z
    .array(
      z.object({
        from_ms: z.number().int().nonnegative(),
        to_ms: z.number().int().positive(),
        /** x aplicada; null = sin cara en ese plano (se usó la global) */
        x: z.number().nullable(),
        /** tracking continuo: keyframes SUAVIZADOS que el crop horneó
            (mismo reloj de la ventana que from_ms); ausente = x fija */
        kf: z
          .array(z.object({ t_ms: z.number().int(), x: z.number() }))
          .optional(),
      }),
    )
    .optional(),
  /**
   * Modo del lienzo del clip (segundo modo del formato de referencia,
   * t=260 s del tutorial): `tarjeta` (por defecto) = cabecera + titular +
   * tarjeta ~cuadrada con el hablante; `full_bleed` = metraje a sangre 9:16
   * sin tarjeta, subtítulo gigante en mayúsculas a media pantalla. Se usa
   * cuando el plano es metraje de cine, no el hablante — la heurística del
   * director que lo activa sola está pendiente; el campo existe para que el
   * layout y el contrato no cambien cuando llegue.
   */
  modo: z.enum(['tarjeta', 'full_bleed']).optional(),
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

/**
 * Telemetría del PROCESO que produjo el short, congelada en el maestro como
 * `broll_telemetry` en el largo. Sin esto, sobre un short guardado no se puede
 * reconstruir si la pasada de ritmo hizo algo ni si el director de verdad
 * eligió o entró el fallback en silencio (que hoy no deja rastro).
 */
export const shortTelemetrySchema = z.object({
  planos_antes: z.number().int().nonnegative(),
  planos_despues: z.number().int().nonnegative(),
  segundos_por_plano: z.number().nonnegative(),
  efectos_heredados: z.number().int().nonnegative(),
  efectos_colocados: z.number().int().nonnegative(),
  /** quién eligió la ventana: el LLM o la propuesta de reserva */
  // 'operador': subventana explícita pedida por una persona (sin LLM)
  director: z.enum(['llm', 'fallback', 'operador']),
});
export type ShortTelemetry = z.infer<typeof shortTelemetrySchema>;

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
    // opcional: los maestros congelados antes del 12-ago-2026 no la traen
    short_telemetry: shortTelemetrySchema.optional(),
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
  // dos barras horizontales apiladas: filas, así que caben a 1080 de ancho
  // igual que en 1920 — el eje largo de la barra es el único que importa
  barras: true,
  // en vertical la línea corre de arriba abajo, que además es como se lee el
  // formato: el mismo port a columna que los tres de lista
  linea_tiempo: true,
  // el anillo es cuadrado: cabe igual en los dos lienzos, solo cambia el radio
  ciclo: true,
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
