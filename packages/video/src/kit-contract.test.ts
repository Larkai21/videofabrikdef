import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  introOutroPropsSchema,
  lowerThirdPropsSchema,
  subtitleThemePropsSchema,
  thumbnailTemplatePropsSchema,
} from '@fabrica/shared';
import { checkPropsContract, samplePropsFor } from './kit-contract';

describe('samplePropsFor', () => {
  it('los ejemplos validan contra los contratos mínimos de shared', () => {
    expect(() => subtitleThemePropsSchema.parse(samplePropsFor('subtitle_theme'))).not.toThrow();
    expect(() => lowerThirdPropsSchema.parse(samplePropsFor('lower_third'))).not.toThrow();
    expect(() =>
      thumbnailTemplatePropsSchema.parse(samplePropsFor('thumbnail_template')),
    ).not.toThrow();
    expect(() => introOutroPropsSchema.parse(samplePropsFor('intro'))).not.toThrow();
    expect(() => introOutroPropsSchema.parse(samplePropsFor('outro'))).not.toThrow();
  });

  it('el ejemplo de subtítulos trae cues del maestro de demo', () => {
    const sample = samplePropsFor('subtitle_theme') as { cues: unknown[] };
    expect(Array.isArray(sample.cues)).toBe(true);
    expect(sample.cues.length).toBeGreaterThan(0);
  });
});

describe('checkPropsContract', () => {
  it('acepta un schema válido del contrato lower_third', () => {
    const schema = z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      fromFrame: z.number(),
    });
    expect(checkPropsContract(schema, 'lower_third')).toEqual({ ok: true });
  });

  it('rechaza un schema que exige props fuera del contrato', () => {
    const schema = z.object({
      title: z.string(),
      fromFrame: z.number(),
      color: z.string(), // requerida pero el contrato no la garantiza
    });
    const result = checkPropsContract(schema, 'lower_third');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no acepta las props mínimas/);
      expect(result.reason).toMatch(/color/);
    }
  });

  it('rechaza un schema con tipos incompatibles con el contrato', () => {
    const schema = z.object({ title: z.number(), fromFrame: z.number() });
    const result = checkPropsContract(schema, 'lower_third');
    expect(result.ok).toBe(false);
  });

  it('rechaza exports que no son esquemas Zod', () => {
    const result = checkPropsContract({ nada: true }, 'lower_third');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/export default z\.object/);
  });

  it('los tipos sin contrato mínimo aceptan el objeto vacío', () => {
    const schema = z.object({ label: z.string().optional() });
    expect(checkPropsContract(schema, 'title_card')).toEqual({ ok: true });
  });
});
