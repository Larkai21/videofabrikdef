// Resolución de los enlaces de Google News a la URL real del medio.
//
// El 56 % de las ideas en cola (390 de 694) tienen como primera fuente una URL
// del tipo `news.google.com/rss/articles/CBMi…`. Esa URL NO redirige: devuelve
// HTTP 200 con 580 KB del cascarón de la aplicación de Google News, cuyo único
// texto visible es «Google News». Readability extrae cadena vacía, el research
// se queda sin claims y el guion se escribe a partir del titular — hasta el
// punto de decírselo al espectador: «Nuestro research pack es limitado».
//
// El identificador es opaco (formato `AU_yqL…`): no lleva la URL dentro, así
// que decodificarlo no sirve. La única vía es la que usa la propia página:
// leer la firma y el sello de tiempo del `<c-wiz>` y pedirle la URL al endpoint
// interno `batchexecute`.
//
// Es una API interna y Google puede romperla sin avisar. Por eso vive aparte,
// no lanza nunca y devuelve `null` cuando algo no encaja: si deja de funcionar,
// el research vuelve a comportarse exactamente como hoy (fuente sin texto), que
// es el peor caso actual, no una regresión.

import type pino from 'pino';

// El cascarón solo entrega la firma a un navegador; con el user-agent del bot
// devuelve la portada de Google News sin los atributos que hacen falta.
// OJO: tiene que ser un UA de navegador COMPLETO (motor y versión incluidos):
// el recorte «Mozilla/5.0 (Macintosh…)» a secas dejó de recibir la firma en
// ago-2026 y el resolver volvía null en silencio — verificado con curl: el
// mismo fetch con UA completo trae data-n-a-sg y el recortado no.
const UA_NAVEGADOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Desde una IP europea, Google redirige a consent.google.com (RGPD) y ese
// muro devuelve 403 al fetch sin cookies: TODO el flujo moría ahí. La cookie
// SOCS/CONSENT declara el consentimiento ya dado y el redirect no ocurre.
// Solo se envía a dominios de Google, nunca a los medios.
const COOKIE_CONSENT = 'SOCS=CAI; CONSENT=YES+';
const TIMEOUT_MS = 15_000;

export function esEnlaceGoogleNews(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'news.google.com' && /\/(rss\/)?articles\//.test(u.pathname);
  } catch {
    return false;
  }
}

/** El identificador opaco del artículo dentro de la URL de Google News. */
export function idDeArticulo(url: string): string | null {
  const m = /\/(?:rss\/)?articles\/([^/?#]+)/.exec(url);
  return m?.[1] ?? null;
}

/**
 * Construye el cuerpo de la petición a `batchexecute`.
 *
 * La forma del payload es la que emite la propia página; los `'X'` y los `1`
 * son relleno posicional que el endpoint exige pero no mira. Se extrae para
 * poder probarla sin red.
 */
export function cuerpoBatchExecute(id: string, ts: number, sg: string): URLSearchParams {
  const peticion = JSON.stringify([
    'garturlreq',
    [
      [
        'X',
        'X',
        ['X', 'X'],
        null,
        null,
        1,
        1,
        'US:en',
        null,
        1,
        null,
        null,
        null,
        null,
        null,
        0,
        1,
      ],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    id,
    ts,
    sg,
  ]);
  return new URLSearchParams({
    'f.req': JSON.stringify([[['Fbv4je', peticion, null, 'generic']]]),
  });
}

/** La URL del medio dentro de la respuesta de `batchexecute`. */
export function urlEnRespuesta(raw: string): string | null {
  // la respuesta viene con el prefijo anti-JSONP `)]}'` y con la URL escapada
  // dentro de una cadena JSON anidada
  const m = /"(https?:\/\/(?!news\.google\.com)[^"\\]{15,500})"/.exec(raw.replace(/\\"/g, '"'));
  return m?.[1] ?? null;
}

/**
 * La URL real del medio, o `null` si no se puede resolver.
 *
 * Nunca lanza: cualquier fallo (red, cambio de formato, Google cerrando el
 * endpoint) devuelve `null` y el research sigue con la fuente sin texto.
 */
export async function resolverEnlaceGoogleNews(
  logger: pino.Logger,
  url: string,
): Promise<string | null> {
  const id = idDeArticulo(url);
  if (id === null) return null;
  try {
    const paginaRes = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA_NAVEGADOR, cookie: COOKIE_CONSENT },
    });
    if (!paginaRes.ok) return null;
    const html = await paginaRes.text();
    const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
    const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
    if (sg === undefined || ts === undefined) {
      logger.warn({ url }, 'Google News no entregó la firma; la fuente se queda sin texto');
      return null;
    }
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': UA_NAVEGADOR,
        cookie: COOKIE_CONSENT,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: cuerpoBatchExecute(id, Number(ts), sg),
    });
    if (!res.ok) return null;
    return urlEnRespuesta(await res.text());
  } catch (err) {
    logger.warn({ url, err }, 'No se pudo resolver el enlace de Google News');
    return null;
  }
}
