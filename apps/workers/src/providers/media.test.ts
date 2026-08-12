import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createMedia } from './media.js';

// El contrato del proveedor de media: MEDIA_PROVIDER=mock no sale a red y es
// determinista — la suite nunca depende de yt-dlp ni de la conexión.

describe('createMedia', () => {
  it('el mock produce metadatos estables desde la URL, sin red', async () => {
    process.env.MEDIA_PROVIDER = 'mock';
    const media = createMedia(pino({ level: 'silent' }));
    expect(media.name).toBe('mock');
    const a = await media.probe('https://www.youtube.com/watch?v=abc123');
    const b = await media.probe('https://www.youtube.com/watch?v=abc123');
    expect(a).toEqual(b);
    expect(a.isLive).toBe(false);
    expect(a.durationS).toBeGreaterThan(0);
    delete process.env.MEDIA_PROVIDER;
  });

  it('sin la variable, el proveedor real es yt-dlp', () => {
    delete process.env.MEDIA_PROVIDER;
    expect(createMedia(pino({ level: 'silent' })).name).toBe('yt-dlp');
  });
});
