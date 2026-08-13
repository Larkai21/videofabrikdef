# El formato de clips: disección de la referencia

Fuente: `editing.mp4` (55 min, 1080p60) — grabación de pantalla de la edición
real de los shorts del canal **CrispyTheory** (clips de famosos, el modelo de
negocio que este pipeline replica: el propio editor narra que ingresa ~4000 $
en dos semanas). Transcripción íntegra en
`banco/referencias-transcript-editing.txt` (6769 palabras, mlx-whisper).
Diseccionado fotograma a fotograma el 12-ago-2026; las medidas de abajo salen
de los fotogramas en alta del short terminado reproducido a pantalla completa
(t≈236-260 s de la grabación).

## Anatomía del short terminado (t=242 s, el patrón)

Sobre lienzo 1080×1920 (el corte del visor medía 484×863 px; factor 2,23):

| Capa | Medida | Detalle |
|---|---|---|
| Fondo | — | negro puro |
| Cabecera | avatar Ø≈134 px, centro y≈218 px | avatar circular + «Crispy Theory ❄» bold blanco + `@crispytheory` gris fino debajo |
| Titular | y 19-28 %, 2 líneas | bold redondeada (geométrica tipo Poppins), base blanca, PALABRAS CLAVE a color: «Brad Pitt» amarillo, «Funniest» verde, «Cameo» cian |
| Tarjeta de vídeo | x 5-95 %, y 29,9-83,2 % (≈972×1023 px, ~cuadrada), radio ≈45 px | el vídeo del hablante DENTRO, esquinas redondeadas, sin borde |
| Subtítulo | y≈67-73 %, pisando el tercio bajo de la tarjeta | 1-2 palabras, bold redondeada, AMARILLO con contorno negro grueso («speak», «\*Laughter\*») |

Segundo modo (t=260 s, b-roll de película): full-bleed 9:16 sin tarjeta,
subtítulo gigante blanco en mayúsculas con palabra clave amarilla a media
pantalla («DEADPOOL **BUILDS** A»). Se usa cuando el plano es metraje de cine,
no el hablante.

## Tracking

En el timeline de Premiere se ve la mecánica: keyframes de posición/escala
sobre el clip fuente 16:9 dentro de la secuencia vertical — el editor
re-encuadra A MANO al hablante en cada cambio de plano y ajusta suave dentro
del plano. Traducción a este pipeline (todo congelado al proponer, principio
6): cambios de plano por scene detection + dentro del plano la cara que MUEVE
LOS LABIOS (Vision de macOS, varianza de apertura entre fotogramas a 300 ms,
muestreada cada 1,2 s con confirmación doble) → plan por tramos horneado por
el pre-corte (`scripts/encuadre-clip.py` + `precortarClip`).

## Dinamismo (lo que se OYE en el tutorial)

El editor recorta silencios, muletillas y tramos irrelevantes para densificar
el clip. Portado como APRETADO (`apretar.ts`): keeps por huecos entre palabras
>480 ms con colchón de 120 ms y mapa de reloj origen→salida (la lección del
proyecto hermano: los keeps son el único registro de la traducción). El corte
SEMÁNTICO de relleno (frases prescindibles marcadas por LLM) queda pendiente.

## Réplica en este repo

`packages/video/src/short/ClipLayout.tsx` — activo cuando el maestro es de
episodio (`video.episode_id`). Medidas idénticas a la tabla de arriba;
tipografía Poppins ExtraBold/Medium empaquetada (`public/fonts/`,
`ensureClipFontLoaded`), paleta de acentos `#FFD348 / #A8E063 / #3EE0F0`.
El pre-corte sale YA al aspecto de la tarjeta (~0,95:1, alto completo del
plano: las caras quedan a su altura natural, sin recorte vertical oculto).

Subtítulos: tres coreografías del catálogo de editor-youtube rotando por
frase — slam (mayúsculas, sobrepaso, rotación sembrada, amarillo/blanco),
weight-shift (la activa engorda, la otra se apaga) y highlight (caja amarilla
barriendo, texto negro) — dentro del área segura real (`anchoLibreCentrado` +
suelo sobre la banda de la interfaz).

## Deltas conocidos frente a la referencia

- ~~Tracking CONTINUO dentro del plano~~ — hecho: el sidecar conserva la serie
  muestreada del hablante (kf), el worker la suaviza con media móvil + zona
  muerta de 0,02 (`pipelines/episodios/encuadre.ts`, determinista) y el
  pre-corte hornea el paneo como expresión del crop. Los keyframes aplicados
  quedan en `encuadre_plan[].kf` del maestro (auditoría). El banco `pnpm
  encuadre` aún no tiene casos de hablante en movimiento: falta material
  etiquetado con vaivén real.
- Modo full-bleed para b-roll de película (no aplica a entrevistas; pendiente
  si el material lo trae).
- Gráficos puntuales (emojis, logos) que el editor añade a mano; emoji-pop
  del catálogo hermano es el candidato.
- ~~Corte semántico de relleno por LLM~~ — hecho tras el flag de canal
  `clips_relleno` (apagado por defecto): el director marca frases
  prescindibles POR ÍNDICE (nunca tiempos: una alucinación de ms no puede
  partir una palabra), guardas deterministas encima (ni gancho ni cierre,
  techo del 25 % de la ventana) y el apretado las corta como silencio
  sintético (`relleno.ts` + `quitar` en `calcularKeeps`). Coste al ledger
  como `clips_relleno`, con `short_id` en meta.
