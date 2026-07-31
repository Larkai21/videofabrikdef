import { describe, expect, it } from 'vitest';
import {
  cuerpoBatchExecute,
  esEnlaceGoogleNews,
  idDeArticulo,
  urlEnRespuesta,
} from './google-news.js';

// URL real, de la idea que produjo el vídeo OIC6LvB17pOtsK3tOkbqx
const REAL =
  'https://news.google.com/rss/articles/CBMi3AFBVV95cUxPVzc3Z0Uwek5rY1FCT1NFWGlYamdGWTJGNmRBeDBYLUNydFVIZmNNV0ZWSE11ejJFVEZSc0lxTDcwdWF0VmdEcDh3cjlMeGJfNzIzZ2Uz?oc=5';

describe('esEnlaceGoogleNews', () => {
  it('reconoce las dos formas que emite Google News', () => {
    expect(esEnlaceGoogleNews(REAL)).toBe(true);
    expect(esEnlaceGoogleNews('https://news.google.com/articles/CBMiabc')).toBe(true);
  });

  it('no toca las fuentes normales, que son la mayoría del corpus', () => {
    for (const url of [
      'https://www.computing.es/inteligencia-artificial/empresas-como-meta/',
      'https://huggingface.co/moonshotai/Kimi-K2',
      'https://arxiv.org/abs/2401.00001',
      'https://news.google.com/', // la portada no es un artículo
      'no soy una url',
    ]) {
      expect(esEnlaceGoogleNews(url), url).toBe(false);
    }
  });
});

describe('idDeArticulo', () => {
  it('saca el identificador opaco sin la query', () => {
    expect(idDeArticulo(REAL)).toBe(
      'CBMi3AFBVV95cUxPVzc3Z0Uwek5rY1FCT1NFWGlYamdGWTJGNmRBeDBYLUNydFVIZmNNV0ZWSE11ejJFVEZSc0lxTDcwdWF0VmdEcDh3cjlMeGJfNzIzZ2Uz',
    );
    expect(idDeArticulo('https://example.com/nada')).toBeNull();
  });
});

describe('cuerpoBatchExecute', () => {
  it('mete id, sello y firma en el sitio que espera el endpoint', () => {
    const req = cuerpoBatchExecute('ABC123', 1785477813, 'FIRMA');
    const fReq = req.get('f.req');
    expect(fReq).toContain('Fbv4je');
    expect(fReq).toContain('garturlreq');
    // el orden posicional importa: id, sello, firma, al final de la petición
    expect(fReq).toMatch(/ABC123.*1785477813.*FIRMA/);
  });
});

describe('urlEnRespuesta', () => {
  // respuesta LITERAL del endpoint, capturada el 31-jul-2026
  const CRUDA =
    ')]}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.computing.es/inteligencia-artificial/empresas-como-meta-microsoft-y-nvidia-retan-a-eeuu-para-no-prohibir-los-modelos-de-ia-abiertos/\\",1]",null,null,null,"generic"],["di",7],["af.httprm",6,"890502331354695179",17]]';

  it('extrae la URL del medio de la respuesta real', () => {
    expect(urlEnRespuesta(CRUDA)).toBe(
      'https://www.computing.es/inteligencia-artificial/empresas-como-meta-microsoft-y-nvidia-retan-a-eeuu-para-no-prohibir-los-modelos-de-ia-abiertos/',
    );
  });

  it('devuelve null si Google cambia el formato, en vez de inventarse una URL', () => {
    expect(
      urlEnRespuesta(')]}\'\n\n[["wrb.fr","Fbv4je",null,null,null,null,"generic"]]'),
    ).toBeNull();
    expect(urlEnRespuesta('')).toBeNull();
  });

  it('nunca devuelve un enlace que vuelva a Google News', () => {
    const bucle =
      '[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://news.google.com/rss/x\\",1]"]]';
    expect(urlEnRespuesta(bucle)).toBeNull();
  });
});
