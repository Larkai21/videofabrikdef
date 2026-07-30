import { z } from 'zod';

// Rúbrica del juez del guion. El cambio de fondo respecto a la versión anterior:
// el VEREDICTO no lo decide el modelo, se deriva en código de unos umbrales.
// Antes el propio prompt le decía «no seas quisquilloso», que es una invitación
// a decir que todo está alineado.

export const SCRIPT_REVIEW_AXES = ['promesa', 'estructura', 'ritmo', 'factualidad', 'estilo'] as const;
export const scriptReviewAxisSchema = z.enum(SCRIPT_REVIEW_AXES);
export type ScriptReviewAxis = z.infer<typeof scriptReviewAxisSchema>;

const scoreSchema = z.number().int().min(0).max(5);

export const scriptReviewScoresSchema = z.object({
  promesa: scoreSchema,
  estructura: scoreSchema,
  ritmo: scoreSchema,
  factualidad: scoreSchema,
  estilo: scoreSchema,
});
export type ScriptReviewScores = z.infer<typeof scriptReviewScoresSchema>;

export const scriptSceneNoteSchema = z.object({
  id: z.string().min(1),
  axis: scriptReviewAxisSchema,
  /** qué falla, en una frase */
  issue: z.string().min(1),
  /** qué hacer, en una frase accionable */
  fix: z.string().min(1),
});
export type ScriptSceneNote = z.infer<typeof scriptSceneNoteSchema>;

/**
 * Salida CRUDA del modelo. Sin veredicto a propósito: lo deriva
 * scriptReviewVerdict a partir de umbrales que viven en el código y se
 * recalibran en un solo sitio.
 */
export const scriptReviewOutputSchema = z
  .object({
    scores: scriptReviewScoresSchema,
    reasons: z.array(z.string()).max(4),
    scene_notes: z.array(scriptSceneNoteSchema).max(6),
    patch_targets: z.array(z.string()).max(4),
  })
  .superRefine((r, ctx) => {
    // un patch_target sin nota es una instrucción sin contenido: el refinado
    // reescribiría esa escena sin saber qué arreglar
    const noted = new Set(r.scene_notes.map((n) => n.id));
    for (const id of r.patch_targets) {
      if (!noted.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['patch_targets'],
          message: `patch_target ${id} sin nota de escena`,
        });
      }
    }
  });
export type ScriptReviewOutput = z.infer<typeof scriptReviewOutputSchema>;

/** Forma persistida en master.script_review. */
export const scriptReviewSchema = z.object({
  scores: scriptReviewScoresSchema,
  reasons: z.array(z.string()),
  scene_notes: z.array(scriptSceneNoteSchema),
  patch_targets: z.array(z.string()),
  verdict: z.enum(['aligned', 'misaligned']),
  /**
   * Huella del guion revisado. Si no coincide con el guion actual, la revisión
   * es vieja: así el juez es idempotente y no vuelve a pagar por lo mismo.
   */
  fingerprint: z.string(),
  stale: z.boolean().optional(),
  reviewed_at: z.string(),
});
export type ScriptReview = z.infer<typeof scriptReviewSchema>;

// Umbrales. Constantes y no criterio del modelo: recalibrar es tocar aquí.
export const SCRIPT_REVIEW_MIN_AXIS = 3;
/** La factualidad es más estricta: una cifra inventada no es un matiz. */
export const SCRIPT_REVIEW_MIN_FACT = 4;
export const SCRIPT_REVIEW_MIN_TOTAL = 17; // sobre 25

export function scriptReviewVerdict(scores: ScriptReviewScores): {
  verdict: 'aligned' | 'misaligned';
  blocking: ScriptReviewAxis[];
  total: number;
} {
  const blocking: ScriptReviewAxis[] = [];
  for (const axis of SCRIPT_REVIEW_AXES) {
    const min = axis === 'factualidad' ? SCRIPT_REVIEW_MIN_FACT : SCRIPT_REVIEW_MIN_AXIS;
    if (scores[axis] < min) blocking.push(axis);
  }
  const total = SCRIPT_REVIEW_AXES.reduce((s, a) => s + scores[a], 0);
  const verdict =
    blocking.length > 0 || total < SCRIPT_REVIEW_MIN_TOTAL ? 'misaligned' : 'aligned';
  return { verdict, blocking, total };
}

/** Resumen en español para el evento de progreso y la cabecera de la puerta 2. */
export function scriptReviewSummary(scores: ScriptReviewScores): string {
  return SCRIPT_REVIEW_AXES.map((a) => `${a} ${scores[a]}`).join(' · ');
}
