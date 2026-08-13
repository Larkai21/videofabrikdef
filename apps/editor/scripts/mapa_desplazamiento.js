#!/usr/bin/env node
/* =====================================================================
   Genera el mapa de desplazamiento del cristal.

   El liquid glass real de iOS no difumina: DESPLAZA. Un cristal dobla la
   luz que lo atraviesa, y eso un blur no lo reproduce — por eso el efecto
   con solo blur se queda en "plástico esmerilado".

   La técnica original (feTurbulence -> feDisplacementMap) vive en un
   filtro SVG aplicado con backdrop-filter, que en nuestro pipeline no
   sirve: al capturar con omitBackground no hay backdrop. Así que se
   rasteriza AQUÍ el ruido de turbulencia a un PNG, y ffmpeg lo usa con
   su filtro `displace`.

   Convenio de ffmpeg: 128 = sin desplazamiento. El canal R mueve en X y
   el G en Y. feTurbulence ya entrega valores centrados, así que encaja
   sin conversión.

   El mapa se atenúa hacia el centro: en un cristal real la refracción se
   concentra en el canto, no en el medio. Un desplazamiento uniforme se
   ve como una ola, no como vidrio.

   Uso:
     node scripts/mapa_desplazamiento.js
     node scripts/mapa_desplazamiento.js --freq 0.008 --octavas 2 --borde 0.42
   ===================================================================== */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RAIZ = fs.realpathSync(path.dirname(__dirname));
const SALIDA = path.join(RAIZ, 'assets', 'mapas');

function args() {
  const a = process.argv.slice(2);
  const o = { freq: 0.008, octavas: 2, semilla: 92, borde: 0.42,
              w: 1080, h: 1920, salida: path.join(SALIDA, 'cristal_displace.png') };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--freq') o.freq = Number(a[++i]);
    else if (a[i] === '--octavas') o.octavas = Number(a[++i]);
    else if (a[i] === '--semilla') o.semilla = Number(a[++i]);
    else if (a[i] === '--borde') o.borde = Number(a[++i]);
    else if (a[i] === '--salida') o.salida = a[++i];
  }
  return o;
}

const PAGINA = (o) => `<!doctype html><html><head><style>
  html,body{width:${o.w}px;height:${o.h}px;margin:0;overflow:hidden;background:#808080}
  .capa{position:absolute;inset:0}
  /* la turbulencia */
  .ruido{filter:url(#turb)}
  /* Atenuación hacia el centro: gris neutro (128) en el medio, ruido a
     tope en los bordes. Multiplicar por gris deja el centro sin mover. */
  .centro{background:radial-gradient(ellipse ${(1 - o.borde) * 100}% ${(1 - o.borde) * 100}% at 50% 50%,
          #808080 55%, rgba(128,128,128,0) 100%);}
</style></head><body>
  <svg width="0" height="0" style="position:absolute">
    <filter id="turb" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${o.freq} ${o.freq}"
                    numOctaves="${o.octavas}" seed="${o.semilla}" result="noise"/>
      <feGaussianBlur in="noise" stdDeviation="0.6"/>
    </filter>
  </svg>
  <div class="capa ruido" style="background:#808080"></div>
  <div class="capa centro"></div>
</body></html>`;

async function main() {
  const o = args();
  fs.mkdirSync(path.dirname(o.salida), { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: o.w, height: o.h } });
  await p.setContent(PAGINA(o));
  await p.screenshot({ path: o.salida });
  await b.close();

  console.log(JSON.stringify({
    mapa: o.salida,
    resolucion: `${o.w}x${o.h}`,
    baseFrequency: o.freq, numOctaves: o.octavas, semilla: o.semilla,
    atenuacion_centro: o.borde,
    nota: 'canal R -> desplazamiento X, canal G -> Y, 128 = neutro'
  }, null, 2));
}
/* Solo se ejecuta si se INVOCA, no si se importa. Sin esto, un `require()`
   para reutilizar sus funciones lanzaba el trabajo entero y escribía en `build/`.
   Es el equivalente del `if __name__ == "__main__"` que todos los scripts de
   Python ya tienen; se le puso al renderizador después de que me borrara
   fotogramas por esto mismo. */
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  module.exports = { main };
}

