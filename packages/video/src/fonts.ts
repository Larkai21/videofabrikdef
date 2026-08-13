import type React from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

// Fuente empaquetada en public/fonts (docs/render.md §4): nunca Google Fonts
// en runtime. Se carga con la API FontFace y delayRender para que el primer
// frame renderizado ya use la tipografía correcta. Si la carga falla se sigue
// con la pila del sistema.
export const FONT_FAMILY = "'Inter', 'Helvetica Neue', Arial, sans-serif";

// Estilo "display" para titulares: Inter variable trae el eje óptico opsz
// (14-32); a tamaño grande (opsz 32) las letras tienen más carácter. Así los
// títulos/intros/callouts usan el corte display SIN empaquetar otra fuente,
// mientras los subtítulos/cuerpo se quedan en el corte de texto (opsz 14).
export function displayText(weight = 800): React.CSSProperties {
  return {
    fontFamily: FONT_FAMILY,
    fontWeight: weight,
    fontVariationSettings: `"opsz" 32, "wght" ${weight}`,
    letterSpacing: '-0.02em',
  };
}

let started = false;

export function ensureFontLoaded(): void {
  if (started) return;
  started = true;
  if (typeof document === 'undefined') return;
  const handle = delayRender('Carga de la fuente Inter');
  const face = new FontFace(
    'Inter',
    `url(${staticFile('fonts/InterVariable.woff2')}) format('woff2')`,
    { weight: '100 900', style: 'normal' },
  );
  face
    .load()
    .then((loaded) => {
      // lib.dom de TS 5.9 no expone add() en FontFaceSet
      (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
      continueRender(handle);
    })
    .catch((err: unknown) => {
      // Antes se continuaba en silencio y el MP4 salía con la fuente del
      // sistema: otra tipografía, otras métricas y otros saltos de línea en los
      // subtítulos, sin que nadie se enterara. En un motor cuyo principio es
      // «fuentes empaquetadas», un render con otra fuente NO es el mismo vídeo,
      // así que es mejor fallar el render que entregar algo distinto en
      // silencio. Sigue habiendo `continueRender` para no dejar el render
      // colgado si Remotion captura el error.
      continueRender(handle);
      throw new Error(
        `No se pudo cargar la fuente empaquetada Inter: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

// ---- tipografía del formato de CLIPS ----
// El canal de referencia (docs/referencia-clips.md) compone titulares y
// captions en una geométrica redondeada; con Inter el lado a lado delataba la
// diferencia al primer vistazo. Poppins (OFL, empaquetada en public/fonts)
// es esa familia: ExtraBold para titulares/captions y Medium para el handle.
export const CLIP_FONT_FAMILY = "'Poppins', 'Inter', 'Helvetica Neue', Arial, sans-serif";

export function clipText(weight: 500 | 800 = 800): React.CSSProperties {
  return {
    fontFamily: CLIP_FONT_FAMILY,
    fontWeight: weight,
    letterSpacing: '0.005em',
  };
}

let clipStarted = false;

export function ensureClipFontLoaded(): void {
  if (clipStarted) return;
  clipStarted = true;
  if (typeof document === 'undefined') return;
  for (const [peso, fichero] of [
    ['800', 'fonts/Poppins-ExtraBold.ttf'],
    ['500', 'fonts/Poppins-Medium.ttf'],
  ] as const) {
    const handle = delayRender(`Carga de Poppins ${peso}`);
    const face = new FontFace('Poppins', `url(${staticFile(fichero)}) format('truetype')`, {
      weight: peso,
      style: 'normal',
    });
    face
      .load()
      .then((loaded) => {
        (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
        continueRender(handle);
      })
      .catch((err: unknown) => {
        // mismo criterio que Inter: un clip con otra fuente no es el mismo clip
        continueRender(handle);
        throw new Error(
          `No se pudo cargar la fuente empaquetada Poppins: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
