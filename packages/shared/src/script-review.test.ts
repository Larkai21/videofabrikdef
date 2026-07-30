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
    scene_notes: [{ id: 'sc-body-3', axis: 'ritmo', issue: 'frases largas', fix: 'parte en frases cortas' }],
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

  it('rechaza un patch_target sin nota: sería una instrucción sin contenido', () => {
    const r = scriptReviewOutputSchema.safeParse({ ...base, patch_targets: ['sc-body-9'] });
    expect(r.success).toBe(false);
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
    const r = scriptReviewVerdict({ promesa: 3, estructura: 3, ritmo: 3, factualidad: 4, estilo: 3 });
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
