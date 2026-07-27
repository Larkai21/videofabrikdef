import { describe, expect, it } from 'vitest';
import { scriptSchema, SCRIPT_LENGTH_TOLERANCE, WORDS_PER_MIN } from '@fabrica/shared';
import { buildMockRefine, mockScriptPayload, mockWords } from './mocks.js';
import { countWords, scriptWords, withinTolerance } from './wordcount.js';

describe('mockWords', () => {
  it('produce exactamente el número de palabras pedido y es determinista', () => {
    const a = mockWords('semilla', 55);
    const b = mockWords('semilla', 55);
    expect(countWords(a)).toBe(55);
    expect(a).toBe(b);
    expect(mockWords('otra', 40)).not.toBe(mockWords('semilla', 40));
  });
});

describe('mockScriptPayload', () => {
  for (const minutes of [5, 7, 9]) {
    it(`respeta la duración objetivo ±10% para ${minutes} minutos`, () => {
      const payload = mockScriptPayload({
        ideaTitle: 'La GPU que lo cambió todo',
        targetMinutes: minutes,
        aiDisclosure: true,
      });
      const target = minutes * WORDS_PER_MIN;
      const words = scriptWords(payload.script.scenes);
      expect(withinTolerance(words, target)).toBe(true);
      expect(Math.abs(words - target)).toBeLessThanOrEqual(target * SCRIPT_LENGTH_TOLERANCE);
    });
  }

  it('genera escenas de 40-70 palabras con visual_query de 3-8 palabras en inglés', () => {
    const payload = mockScriptPayload({
      ideaTitle: 'La GPU que lo cambió todo',
      targetMinutes: 7,
      aiDisclosure: true,
    });
    for (const scene of payload.script.scenes) {
      const words = countWords(scene.text);
      expect(words).toBeGreaterThanOrEqual(40);
      expect(words).toBeLessThanOrEqual(70);
      const vqWords = countWords(scene.visual_query);
      expect(vqWords).toBeGreaterThanOrEqual(3);
      expect(vqWords).toBeLessThanOrEqual(8);
    }
    expect(payload.script.scenes[0]?.section).toBe('hook');
    expect(payload.script.scenes.at(-1)?.section).toBe('cta');
  });

  it('cumple el contrato de script y las reglas del paquete SEO', () => {
    const payload = mockScriptPayload({
      ideaTitle: 'La GPU que lo cambió todo',
      targetMinutes: 7,
      aiDisclosure: true,
    });
    // el guion mock debe validar contra el esquema compartido
    expect(() =>
      scriptSchema.parse({ scenes: payload.script.scenes, hook_notes: payload.script.hook_notes }),
    ).not.toThrow();
    expect(payload.seo.titles).toHaveLength(3);
    for (const title of payload.seo.titles) expect(title.length).toBeLessThanOrEqual(70);
    expect(payload.seo.description).toContain('{timestamps}');
    expect(payload.seo.description).toContain('IA');
    expect(payload.seo.tags.length).toBeGreaterThanOrEqual(10);
    expect(payload.seo.tags.length).toBeLessThanOrEqual(15);
    expect(payload.seo.thumbnails).toHaveLength(2);
    for (const thumb of payload.seo.thumbnails) {
      expect(countWords(thumb.text)).toBeLessThanOrEqual(4);
    }
  });

  it('sin disclosure no añade la línea de IA', () => {
    const payload = mockScriptPayload({
      ideaTitle: 'Otro tema',
      targetMinutes: 6,
      aiDisclosure: false,
    });
    expect(payload.seo.description).not.toContain('asistencia de IA');
  });
});

describe('buildMockRefine', () => {
  it('reescribe cada escena al número de palabras pedido', () => {
    const out = buildMockRefine({
      scenes: [
        { id: 'sc-body-1', seed: 'v1:sc-body-1', words: 48 },
        { id: 'sc-body-2', seed: 'v1:sc-body-2', words: 62 },
      ],
    }) as { scenes: Array<{ id: string; text: string }> };
    expect(out.scenes).toHaveLength(2);
    expect(countWords(out.scenes[0]?.text ?? '')).toBe(48);
    expect(countWords(out.scenes[1]?.text ?? '')).toBe(62);
  });
});
