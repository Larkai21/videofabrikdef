# Convergencia fábrica ↔ módulo editor — duplicados y su plan

Los dos pipelines nacieron separados y resolvieron CUATRO veces el mismo tipo
de problema con implementaciones distintas. Este documento fija qué está
duplicado, cuál es la implementación canónica, y en qué orden converger sin
romper nada. Regla general: **no se converge por estética** — cada punto tiene
un coste de bug real que lo justifica, y se ataca cuando toque ese código.

## Mapa de duplicados

| Concepto | Fábrica (TS) | Editor (Py/JS) | Canónica propuesta |
|---|---|---|---|
| Reloj origen→salida tras quitar silencios | `apps/workers/src/pipelines/episodios/apretar.ts` (`Keep`, `remapear`) | `scripts/reloj.py` (`Mapa`, `SEMANTICA` por clave hoja) + duplicado JS en `render_playwright.js:mapaDe` | La del editor es más completa (clasifica claves relativas/absolutas). El editor YA practica la solución barata: contrato de tests compartido JS↔Py. **Paso 1: fixtures compartidos** en `apps/editor/tests/fixtures/reloj/` que también corra vitest de workers; portar la implementación es v2 |
| STT local (mlx-whisper, word timestamps) | `apps/workers/scripts/transcribe-mlx.py` + `providers/stt.ts` (3 backends) | `scripts/transcribe_mlx.py` | La de la fábrica (interfaz con mock y ledger de coste). El worker de reels debería acabar llamando a `providers/stt.ts` y alimentando el `transcript.json` del editor; hoy usa el del editor porque su formato de tokens es el que consumen sus scripts. Converger = un adaptador de formato, no dos whispers |
| Cara con Vision de macOS | `apps/workers/scripts/encuadre-clip.py` (plano + cara por hablante) | `scripts/detect_face_bbox.py` (zonas seguras) | Distinto OBJETIVO (encuadre vs esquivar): convergen en una utilidad Vision común solo si alguna vez se toca por otra razón. Prioridad baja |
| Silencios (ffmpeg silencedetect) | `episodios/silencios.ts` (−35 dB/0,25 s) | `scripts/silencios.py` (−34 dB/0,30 s) | Umbrales distintos MEDIDOS por cada lado para su material (podcast ruidoso vs A-roll limpio). No unificar umbrales; sí el parser si se toca |
| Loudness de entrega | `render/loudness.ts` (−14 LUFS, ganancia plana, true peak) | `mezcla.py` (`ganancia_para`, techo dBTP) | Equivalentes y estables. Congelar con un fixture cruzado (mismo wav → misma ganancia ±0,1 dB) y no tocar |
| Captions karaoke | `packages/video` (cues del maestro) | `kinetic-captions.html` + 10 presets | NO converger: son productos distintos (formato del canal vs estilos del editor). Lo compartible es el DATO (tokens con tiempos), y ya lo es |
| SFX sintetizados | `packages/video/public/sfx` (14, `make-sfx.ts`) | `assets/sfx` (30, `hacer_sfx.py`) | Catálogos de marca distintos a propósito. Nada que hacer |
| Portada/thumbnail | `renderStill` de composición `Thumbnail` | `scripts/portada.py` (puntúa fotogramas reales) | Complementarios (sintética vs fotograma real). `portada.py` podría puntuar miniaturas del largo algún día — apuntado, no planificado |

## Orden de ejecución propuesto

1. **Fixtures de reloj compartidos** (barato, mata la clase de bug más cara):
   casos `keep[] × tiempos` con resultado esperado, consumidos por pytest del
   editor Y vitest de workers. Disparador: la próxima vez que se toque
   `apretar.ts` o `reloj.py`.
2. **Adaptador STT**: `providers/stt.ts` → formato de tokens del editor
   (`transcript.json` con `words[{w,start,end,p}]`). Disparador: cuando el
   worker de reels necesite el backend whisper-API (hoy mlx local basta).
3. **Fixture cruzado de loudness** (una tarde, congela el contrato).
4. Vision común y parser de silencios: solo por oportunidad.

## Lo que NO se va a converger (decisión, no pereza)

- Los dos motores de render (ver `docs/reels.md` §motivo).
- Los catálogos visuales (plantillas HTML vs componentes Remotion): la
  doctrina de PORTAR coreografías con su porqué (`docs/motion-graphics.md`)
  es la vía de intercambio, no un motor común.
- Umbrales de silencio: cada material tiene los suyos, medidos.
