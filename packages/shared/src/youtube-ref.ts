// Reconoce un vídeo de YouTube en lo que un humano pega desde el navegador o
// desde la app del móvil. Se usa al marcar a mano un vídeo como publicado.
//
// Sin `URL`: este paquete compila sin DOM (misma razón que media-paths.ts), así
// que la extracción es a base de expresiones regulares.

// Un id de YouTube son 11 caracteres del alfabeto base64url.
const ID = '[A-Za-z0-9_-]{11}';
const BARE = new RegExp(`^${ID}$`);

// watch, youtu.be, shorts, live y embed, con o sin esquema y con los
// subdominios que reparte la propia plataforma.
//
// El lookahead final es lo que evita el fallo silencioso: sin él, pegar un id
// de 12 caracteres (un dedo de más al copiar) devolvería los 11 primeros, o sea
// un id VÁLIDO pero de otro vídeo. Mejor rechazarlo y que el humano lo vuelva a
// pegar que registrar el enlace equivocado.
const LINK = new RegExp(
  `^(?:https?://)?(?:www\\.|m\\.|music\\.)?` +
    `(?:youtube\\.com/(?:watch\\?(?:[^#]*&)?v=|shorts/|live/|embed/|v/)|youtu\\.be/)` +
    `(${ID})(?![A-Za-z0-9_-])`,
  'i',
);

/** El id de 11 caracteres, o null si no reconoce la entrada. */
export function extractYoutubeId(input: string): string | null {
  const value = input.trim();
  if (BARE.test(value)) return value;
  return LINK.exec(value)?.[1] ?? null;
}

/** La URL canónica que se guarda en videos.youtube.url. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
