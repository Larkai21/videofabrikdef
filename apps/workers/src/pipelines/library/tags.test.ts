import { describe, expect, it } from 'vitest';
import { mergeTags, tokensFromCaption } from './tags.js';

describe('tokensFromCaption', () => {
  it('tokeniza en minúsculas, sin signos y con longitud mínima', () => {
    expect(tokensFromCaption('Un dron DJI sobrevuela la ciudad, al atardecer.')).toEqual([
      'dron',
      'dji',
      'sobrevuela',
      'ciudad',
      'atardecer',
    ]);
  });

  it('descarta stopwords y tokens cortos', () => {
    expect(tokensFromCaption('la IA y el chip de 3 nm')).toEqual(['chip']);
  });

  it('quita acentos y eñes sin partir las palabras', () => {
    expect(tokensFromCaption('montaña añil')).toEqual(['montana', 'anil']);
  });

  it('no parte los nombres NFD de macOS por la marca combinante', () => {
    // «señalando» tal y como lo entrega el sistema de archivos de macOS:
    // n + tilde combinante (U+0303). El bug del hallazgo 11 de la auditoría
    // lo partía en «sen» + «alando».
    expect(tokensFromCaption('sen\u{0303}alando con el dedo')).toEqual(['senalando', 'dedo']);
  });
});

describe('mergeTags', () => {
  it('funde existentes y caption sin duplicados, existentes primero', () => {
    const out = mergeTags(['servidor', 'datacenter'], 'Pasillo de un datacenter con servidores iluminados');
    expect(out.slice(0, 2)).toEqual(['servidor', 'datacenter']);
    expect(out).toContain('pasillo');
    expect(out).toContain('iluminados');
    // 'datacenter' no se repite
    expect(out.filter((t) => t === 'datacenter')).toHaveLength(1);
  });

  it('normaliza mayúsculas de los tags existentes', () => {
    expect(mergeTags(['GPU'], 'gpu en primer plano')).toEqual(['gpu', 'primer', 'plano']);
  });

  it('respeta el tope de 16 tags', () => {
    const caption = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(' ');
    expect(mergeTags([], caption)).toHaveLength(16);
  });

  it('con caption vacío devuelve los existentes normalizados', () => {
    expect(mergeTags(['Ciudad', 'noche'], '')).toEqual(['ciudad', 'noche']);
  });

  it('sanea los existentes: stopwords fuera, acentos fuera, pero los cortos de humano se quedan', () => {
    // «con» es basura de pasadas viejas y muere; «ia» es un tag corto puesto
    // por un humano y la regla de longitud (pensada para captions) no lo toca
    expect(mergeTags(['con', 'ia', 'tecnología'], '')).toEqual(['ia', 'tecnologia']);
  });
});
