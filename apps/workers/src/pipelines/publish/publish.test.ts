import { describe, expect, it } from 'vitest';
import {
  buildUploadBody,
  createMockProvider,
  parseResumeOffset,
  MAX_TITLE_LENGTH,
} from '../../providers/youtube.js';

describe('buildUploadBody', () => {
  const base = {
    title: 'Un título normal',
    description: 'Descripción con capítulos\n0:00 Intro',
    tags: ['ia', 'tecnología'],
    publishAt: null,
    containsSyntheticMedia: false,
  };

  it('arma snippet y status privados con categoría 28', () => {
    const body = buildUploadBody(base);
    expect(body.snippet).toEqual({
      title: 'Un título normal',
      description: 'Descripción con capítulos\n0:00 Intro',
      tags: ['ia', 'tecnología'],
      categoryId: '28',
    });
    expect(body.status.privacyStatus).toBe('private');
    expect(body.status.selfDeclaredMadeForKids).toBe(false);
    expect(body.status).not.toHaveProperty('publishAt');
    expect(body.status).not.toHaveProperty('containsSyntheticMedia');
  });

  it('trunca el título a 100 caracteres sin partir pares sustitutos', () => {
    const long = `${'a'.repeat(99)}🚀🚀`;
    const body = buildUploadBody({ ...base, title: long });
    expect(Array.from(body.snippet.title)).toHaveLength(MAX_TITLE_LENGTH);
    expect(body.snippet.title.endsWith('🚀')).toBe(true);
    // un título dentro del límite queda intacto
    expect(buildUploadBody(base).snippet.title).toBe(base.title);
  });

  it('declara containsSyntheticMedia solo si el perfil lo pide', () => {
    expect(
      buildUploadBody({ ...base, containsSyntheticMedia: true }).status.containsSyntheticMedia,
    ).toBe(true);
    expect(buildUploadBody(base).status).not.toHaveProperty('containsSyntheticMedia');
  });

  it('incluye publishAt solo cuando hay hueco programado', () => {
    const at = '2026-08-03T17:00:00.000Z';
    expect(buildUploadBody({ ...base, publishAt: at }).status.publishAt).toBe(at);
    expect(buildUploadBody(base).status).not.toHaveProperty('publishAt');
  });
});

describe('parseResumeOffset (308 de reanudación)', () => {
  it('lee el offset de una respuesta 308 real', () => {
    // fixture: cabeceras tal y como las devuelve el endpoint resumable tras
    // recibir el primer chunk de 8 MB
    const res = new Response(null, {
      status: 308,
      headers: { Range: 'bytes=0-8388607', 'X-GUploader-UploadID': 'AEnB2Uo' },
    });
    expect(res.status).toBe(308);
    expect(parseResumeOffset(res.headers.get('range'))).toBe(8_388_608);
  });

  it('sin cabecera Range no hay bytes recibidos', () => {
    const res = new Response(null, { status: 308 });
    expect(parseResumeOffset(res.headers.get('range'))).toBe(0);
  });

  it('tolera formatos con espacios y rechaza basura', () => {
    expect(parseResumeOffset('bytes = 0 - 999')).toBe(1_000);
    expect(parseResumeOffset('bytes=*')).toBe(0);
    expect(parseResumeOffset('')).toBe(0);
    expect(parseResumeOffset(null)).toBe(0);
  });
});

describe('MockProvider', () => {
  it('simula la subida con progreso hasta 100 y devuelve mock-<videoId>', async () => {
    const provider = createMockProvider(undefined, 0);
    const seen: number[] = [];
    const result = await provider.upload({
      videoId: 'v-123',
      filePath: '/no/importa.mp4',
      title: 't',
      description: 'd',
      tags: [],
      publishAt: null,
      containsSyntheticMedia: false,
      onProgress: (p) => seen.push(p),
    });
    expect(result.youtubeId).toBe('mock-v-123');
    expect(result.url).toBe('https://youtu.be/mock-v-123');
    expect(seen.at(-1)).toBe(100);
    expect(seen.length).toBeGreaterThan(1);
    // la miniatura simulada no revienta
    await expect(provider.setThumbnail('mock-v-123', '/no/importa.jpg')).resolves.toBeUndefined();
  });
});
