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
    .catch(() => {
      continueRender(handle);
    });
}
