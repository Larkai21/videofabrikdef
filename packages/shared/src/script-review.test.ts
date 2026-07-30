import { describe, expect, it } from 'vitest';
import {
  scriptReviewOutputSchema,
  scriptReviewSummary,
  scriptReviewVerdict,
  type ScriptReviewScores,
} from './script-review.js';

const TODO = (n: number): ScriptReviewScores => ({
  promesa: n,
  estructura: n,
  ritmo: n,
  factualidad: n,
  estilo: n,
});

describe('scriptReviewOutputSchema', () => {
  const base = {
    scores: TODO(4),
    reasons: ['la promesa se paga tarde'],
    scene_notes: [
      { id: 'sc-body-3', axis: 'ritmo', issue: 'frases largas', fix: 'parte en frases cortas' },
    ],
    patch_targets: ['sc-body-3'],
  };

  it('acepta una revisión coherente', () => {
    expect(scriptReviewOutputSchema.safeParse(base).success).toBe(true);
  });

  it('rechaza puntuaciones fuera de rango o decimales', () => {
    expect(scriptReviewOutputSchema.safeParse({ ...base, scores: TODO(6) }).success).toBe(false);
    expect(
      scriptReviewOutputSchema.safeParse({ ...base, scores: { ...TODO(4), ritmo: 3.5 } }).success,
    ).toBe(false);
  });

  // Un target sin nota es una instrucción sin contenido: el refinado reescribiría
  // esa escena sin saber qué arreglar. Se descarta el target, no la revisión.
  it('descarta un patch_target sin nota en vez de tumbar la revisión', () => {
    const r = scriptReviewOutputSchema.safeParse({ ...base, patch_targets: ['sc-body-9'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.patch_targets).toEqual([]);
  });

  // Con el juez real: devolvió un eje inventado y el parse fallaba entero, así
  // que se perdían también las puntuaciones y el job se reintentaba pagando.
  it('descarta una nota con eje inventado y conserva el resto de la revisión', () => {
    const r = scriptReviewOutputSchema.safeParse({
      ...base,
      scene_notes: [
        { id: 'sc-body-1', axis: 'concrecion', issue: 'x', fix: 'y' },
        { id: 'sc-body-2', axis: 'ritmo', issue: 'x', fix: 'y' },
      ],
      patch_targets: ['sc-body-1', 'sc-body-2'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scene_notes).toHaveLength(1);
      expect(r.data.scores.ritmo).toBeDefined();
      // el target de la nota descartada se cae con ella
      expect(r.data.patch_targets).toEqual(['sc-body-2']);
    }
  });
});

describe('scriptReviewVerdict', () => {
  it('alinea cuando todos los ejes pasan', () => {
    const r = scriptReviewVerdict(TODO(4));
    expect(r.verdict).toBe('aligned');
    expect(r.blocking).toEqual([]);
    expect(r.total).toBe(20);
  });

  it('la factualidad es más estricta que el resto', () => {
    // 3 pasa en cualquier otro eje, pero no en factualidad
    expect(scriptReviewVerdict({ ...TODO(4), ritmo: 3 }).verdict).toBe('aligned');
    const fact = scriptReviewVerdict({ ...TODO(4), factualidad: 3 });
    expect(fact.verdict).toBe('misaligned');
    expect(fact.blocking).toEqual(['factualidad']);
  });

  it('un solo eje hundido basta para desalinear', () => {
    expect(scriptReviewVerdict({ ...TODO(5), estilo: 2 }).verdict).toBe('misaligned');
  });

  it('desalinea por total aunque ningún eje baje del mínimo', () => {
    // 3+3+3+4+3 = 16 < 17, con todos los ejes en su mínimo
    const r = scriptReviewVerdict({
      promesa: 3,
      estructura: 3,
      ritmo: 3,
      factualidad: 4,
      estilo: 3,
    });
    expect(r.total).toBe(16);
    expect(r.blocking).toEqual([]);
    expect(r.verdict).toBe('misaligned');
  });
});

describe('scriptReviewSummary', () => {
  it('resume en una línea legible', () => {
    expect(scriptReviewSummary(TODO(4))).toBe(
      'promesa 4 · estructura 4 · ritmo 4 · factualidad 4 · estilo 4',
    );
  });
});
