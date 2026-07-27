import { describe, expect, it } from 'vitest';
import type { Seo } from '@fabrica/shared';
import { resolveSeo } from './generate.js';
import { mockScriptPayload } from './mocks.js';
import { packagingGenSchema } from './packaging.js';
import { scriptUser } from './prompts.js';

// Camino packaging con el mock (offline): la idea aprobada genera SOLO seo,
// el humano elige título y write-script produce un guion que respeta el seo.

const MOCK_OPTS = { ideaTitle: 'agentes de IA locales', targetMinutes: 7, aiDisclosure: false };

describe('packagingGenSchema', () => {
  it('del payload mock de la op script se queda solo con el seo', () => {
    const full = mockScriptPayload(MOCK_OPTS);
    const parsed = packagingGenSchema.parse(full);
    expect('script' in parsed).toBe(false);
    expect(parsed.seo.titles).toHaveLength(3);
    expect(parsed.seo.thumbnails.length).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveSeo', () => {
  it('sin seo previo construye el paquete con límites (70 chars, 15 tags, 2 miniaturas)', () => {
    const gen = mockScriptPayload(MOCK_OPTS).seo;
    const seo = resolveSeo(undefined, gen);
    expect(seo.chosen_idx).toBeNull();
    expect(seo.titles).toHaveLength(3);
    for (const t of seo.titles) expect(t.length).toBeLessThanOrEqual(70);
    expect(seo.tags.length).toBeLessThanOrEqual(15);
    expect(seo.thumbnails).toHaveLength(2);
  });

  it('con título ya elegido conserva el seo confirmado sin pisarlo', () => {
    const gen = mockScriptPayload(MOCK_OPTS).seo;
    const confirmado: Seo = { ...resolveSeo(undefined, gen), chosen_idx: 1 };
    const regenerado = mockScriptPayload({ ...MOCK_OPTS, ideaTitle: 'otro título distinto' }).seo;
    expect(resolveSeo(confirmado, regenerado)).toBe(confirmado);
  });

  it('sin título elegido el seo nuevo sí sustituye al borrador', () => {
    const gen = mockScriptPayload(MOCK_OPTS).seo;
    const borrador = resolveSeo(undefined, gen);
    const gen2 = mockScriptPayload({ ...MOCK_OPTS, ideaTitle: 'idea distinta' }).seo;
    const resultado = resolveSeo(borrador, gen2);
    expect(resultado).not.toBe(borrador);
    expect(resultado.titles[0]).toBe(gen2.titles[0]?.slice(0, 70));
  });
});

describe('camino packaging completo con el mock', () => {
  it('seo sin script → título elegido → write-script deja guion y respeta el título', () => {
    // 1) packaging: solo seo (el maestro queda sin script)
    const packaged = packagingGenSchema.parse(mockScriptPayload(MOCK_OPTS));
    const seoBorrador = resolveSeo(undefined, packaged.seo);
    expect(seoBorrador.chosen_idx).toBeNull();

    // 2) puerta: el humano confirma el segundo título
    const seoElegido: Seo = { ...seoBorrador, chosen_idx: 1 };
    const titulo = seoElegido.titles[1];

    // 3) write-script: el generate normal produce guion y conserva el seo
    const gen = mockScriptPayload(MOCK_OPTS);
    expect(gen.script.scenes.length).toBeGreaterThanOrEqual(3);
    const seoFinal = resolveSeo(seoElegido, gen.seo);
    expect(seoFinal).toBe(seoElegido);
    expect(seoFinal.titles[seoFinal.chosen_idx ?? 0]).toBe(titulo);
  });

  it('el prompt del guion incluye el título confirmado como promesa a cumplir', () => {
    const research = {
      sources: [],
      summary: 'resumen',
      claims: [],
      angles: [],
    };
    const prompt = scriptUser({
      idea: { title: 'agentes de IA locales', angle: null, summary: 'resumen', whyNow: null },
      research,
      targetWords: 1000,
      language: 'es',
      chosenTitle: 'Por qué los agentes locales importan ahora',
      editedScenes: [],
    });
    expect(prompt).toContain('«Por qué los agentes locales importan ahora»');
    expect(prompt).toContain('cumplir exactamente esa promesa');
  });
});
