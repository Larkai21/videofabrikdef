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

## Certificación contra la referencia (13-ago-2026)

Prueba de fuego: el MISMO material que el tutorial (Bryan Cranston Full
Interview | CONAN on TBS, `YEbQ835Zqx8`) por el pipeline entero, comparado
lado a lado con el short publicado del canal de referencia («When Brian
Cranston Farted In Front Of His Girlfriend», 23 s). Resultado: la anatomía es
LA MISMA — cabecera con marca, titular de dos líneas con palabras clave a
color, tarjeta redondeada, subtítulos coreografiados en la banda baja, cortes
de plano por hablante (6 tramos, x 0,39-0,63) y tracking continuo (kf en 4 de
6 tramos). El clip está en `outputs/episodios/VyS5jpKL6RdkyjjqPqUMJ/`.

Lo que destapó (y se arregló o quedó anotado):

1. **STT alucinaba con material no español** (ARREGLADO): `lang: 'es'` fijo
   hizo que whisper transcribiera un bloque entero de la entrevista inglesa
   en falso español, justo sobre la anécdota objetivo. Ahora el idioma se
   detecta en el primer bloque y queda clavado para el resto.
2. **El director de highlights esquivó la anécdota de la referencia DOS
   veces** (ABIERTO): en dos rondas propuso momentos correctos pero nunca la
   historia de la novia sin olfato — la que el canal de referencia eligió y
   monetizó. Salió a la segunda solo con el descarte dirigido («queremos la
   anécdota de…»). Sesgo a favor de opiniones/datos y en contra de
   historietas humanas cerradas; revisar los criterios del prompt.
   Y segunda pata del mismo hallazgo: la referencia CORTA EN EL REMATE (23 s,
   solo la mitad del gas) y nuestro director se llevó la anécdota entera
   (58 s). Al pedirle la subventana del remate en dos rondas más, propuso la
   ventana adyacente y después cayó a la reserva: el bucle de candidatos no
   sabe proponer una SUBVENTANA de una zona ya renderizada. Para calcar el
   oficio de la referencia falta o detección de remate (cortar el clip en el
   punchline, no en el fin de la anécdota) o permitir subventanas explícitas.
   La versión de 22 s equivalente a la referencia se cortó A MANO de la
   salida renderizada para el lado a lado (fuera del pipeline, solo demo).
   → Sprint 7 (mismo día) cerró las tres patas: señal de CARCAJADA medida en
   el audio (risas.ts: 90 eventos en el episodio, 46/164 beats) + guarda
   determinista recortarAlRemate (de 0/3 clips rematando en risa a 2/3 con
   gpt-5-mini y 3/3 con claude-sonnet-4.5, duraciones 25-38 s) + subventana
   explícita del operador (API/MCP: la ventana 612-638 s salió renderizada en
   23,9 s por el pipeline — la referencia publica 23,4; ya sin tijera manual).
   El prompt del director se reescribió con la lección (v2, mismo día): las
   historietas humanas puntúan como las opiniones y «cortar en el remate
   manda sobre la duración». Verificado sin dirigir sobre el mismo episodio:
   una anécdota humana pasó a encabezar la propuesta (antes nunca salió) y
   dos de tres clips cortan en remate. Lo que el prompt NO puede arreglar:
   (a) el remate exacto es adivinanza sin señal de carcajada — whisper no
   transcribe risas; la señal de audio (pico de energía tras frase) es la
   feature pendiente; (b) las duraciones siguen en 45-48 s; (c) la anécdota
   del gas siguió sin proponerse — sospecha de auto-censura del modelo ante
   contenido escatológico, pendiente de contrastar con otro proveedor.
3. **Deltas de diseño confirmados en el lado a lado**: sin b-roll externo de
   películas (la referencia inserta Breaking Bad; nuestra cascada es
   biblioteca→stock por licencias), rótulos en el idioma del canal, y una
   anécdota entera (58 s) donde la referencia publicó dos partes de 23 s.

## Deltas conocidos frente a la referencia

- ~~Tracking CONTINUO dentro del plano~~ — hecho: el sidecar conserva la serie
  muestreada del hablante (kf), el worker la suaviza con media móvil + zona
  muerta de 0,02 (`pipelines/episodios/encuadre.ts`, determinista) y el
  pre-corte hornea el paneo como expresión del crop. Los keyframes aplicados
  quedan en `encuadre_plan[].kf` del maestro (auditoría). Banco de REGRESIÓN
  con vaivén real: `pnpm encuadre:kf` (calibracion/vaiven/, tres cortes del
  Conan con gestos y giros, 33 muestras kf congeladas como golden — vigila el
  determinismo, no una verdad etiquetada a ojo que no existe).
- ~~Modo full-bleed para b-roll de película~~ — el LAYOUT está
  (`short.modo: 'full_bleed'` en el maestro: metraje a sangre, subtítulo
  gigante en mayúsculas a media pantalla, palabra activa amarilla). Queda la
  heurística del director que lo active solo (necesita distinguir «plano de
  cine» de «hablante», y el material actual es todo entrevista) y el
  pre-corte a 9:16 completo para ese modo (hoy recorta al aspecto de la
  tarjeta; `cover` lo rellena recortando lados).
  DECISIÓN (13-ago-2026, Sprint 8): el b-roll ilustrativo va DENTRO de la
  tarjeta, como hace la referencia en sus insertos (fotograma t=11 s del
  short de Cranston: Breaking Bad dentro de la tarjeta redondeada, cabecera
  y titular intactos) — `short.broll` + BrollEnTarjeta. El full-bleed queda
  reservado para metraje PROTAGONISTA de clip entero, que este material de
  entrevista no pide; su heurística no se inventa hasta que haya material
  que la necesite.
- ~~Gráficos puntuales (emojis)~~ — portado: micro-FX `emoji` en el catálogo
  (`micro-fx.ts` + `PalabraVertical`), diez disparadores españoles con carga y
  el emoji como pieza a un quinto del ancho. Los LOGOS siguen fuera (exigen
  assets con licencia por marca, no un léxico).
- ~~Corte semántico de relleno por LLM~~ — hecho tras el flag de canal
  `clips_relleno` (apagado por defecto): el director marca frases
  prescindibles POR ÍNDICE (nunca tiempos: una alucinación de ms no puede
  partir una palabra), guardas deterministas encima (ni gancho ni cierre,
  techo del 25 % de la ventana) y el apretado las corta como silencio
  sintético (`relleno.ts` + `quitar` en `calcularKeeps`). Coste al ledger
  como `clips_relleno`, con `short_id` en meta.
