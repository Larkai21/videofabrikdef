import { describe, expect, it } from 'vitest';
import { extractYoutubeId, youtubeWatchUrl } from './youtube-ref.js';

const ID = 'dQw4w9WgXcQ';

describe('extractYoutubeId', () => {
  it('acepta el id pelado', () => {
    expect(extractYoutubeId(ID)).toBe(ID);
    expect(extractYoutubeId(`  ${ID}  `)).toBe(ID);
  });

  it('acepta las formas de enlace que reparte la plataforma', () => {
    const casos = [
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?t=42`,
      `https://youtu.be/${ID}?si=abcdefg`,
      `https://www.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=${ID}&list=PL123`,
      `https://www.youtube.com/watch?list=PL123&v=${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `youtu.be/${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      `youtube.com/watch?v=${ID}`,
    ];
    for (const caso of casos) expect(extractYoutubeId(caso), caso).toBe(ID);
  });

  it('rechaza lo que no reconoce', () => {
    const casos = [
      '',
      '   ',
      'dQw4w9WgXc', // 10
      'https://vimeo.com/123456',
      'https://www.youtube.com/@uncanal',
      'https://www.youtube.com/results?search_query=ia',
      `https://www.youtube.com/watch?sv=${ID}`, // parámetro que solo ACABA en v
    ];
    for (const caso of casos) expect(extractYoutubeId(caso), caso).toBeNull();
  });

  it('rechaza un id de 12 caracteres en vez de truncarlo a 11', () => {
    // un dedo de más al copiar daría, truncando, un id válido de OTRO vídeo
    expect(extractYoutubeId(`${ID}X`)).toBeNull();
    expect(extractYoutubeId(`https://youtu.be/${ID}X`)).toBeNull();
  });
});

describe('youtubeWatchUrl', () => {
  it('devuelve la forma canónica', () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
