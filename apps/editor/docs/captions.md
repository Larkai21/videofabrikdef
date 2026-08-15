# Poner captions a un vídeo

Este documento cubre **un caso de uso concreto**: coger un mp4 y devolverlo con
subtítulos cinéticos quemados. Es el encargo que llega suelto —«ponle captions a
estos tres clips»— y que no pasa por el montaje de una pieza.

Existe porque el caso se ha reimplementado desde cero más de una vez, midiendo
un vídeo de referencia fotograma a fotograma para deducir un estilo **que ya
estaba escrito en este repo**. La regla que evita repetirlo:

> Antes de escribir una línea de render de subtítulos, mira
> `templates/kinetic-captions.html`. Es el motor. No hay otro.

---

## El comando

```bash
cd apps/editor
.venv/bin/python scripts/solo_subs.py --input clip.mp4 \
    --acento '#E5789F' --claves novia,éxito
```

Sale en `renders/<nombre>-subs.mp4`, o donde diga `--salida`. Admite varios
vídeos y comodines del shell (`--input 'Aux/*.mp4'`); con más de uno, `--salida`
no vale y cada uno se nombra solo.

El script es autónomo: transcribe con `mlx-whisper`, escribe `timeline.json` y
`plan.json`, rasteriza los PNG con Playwright y compone con ffmpeg. Diez
segundos de vídeo tardan ~30 s en un M4 Pro.

### Lo que NO hace, a propósito

Está escrito en la cabecera de `scripts/solo_subs.py` y conviene no deshacerlo:

- **No pasa por `clean_transcript.py`.** Ese paso quita silencios y tomas
  falsas, o sea REEDITA. Sobre material de otro eso no es una mejora: te piden
  subtitular, no montar. `keep` es el clip entero y el vídeo que sale dura
  exactamente lo que entró.
- **No aplica el LUT de marca** (`--lut none` explícito). Medido en la zona sin
  subtítulo: 30,6 dB de PSNR con el LUT puesto contra 44,2 sin él. El grado es
  de ESTA marca y sobre material ajeno es una alteración que nadie ha pedido.
- **No detecta rostro**: donde no se recorta cámara no hace falta.
- **No impone los 30 fps del pipeline**: respeta los del origen. Imponerlos
  remuestrea — cuatro clips a 24 salieron a 30, o sea 240 fotogramas
  convertidos en 300 duplicando uno de cada cuatro.
- **No añade dinámica** (`--dinamica 0`). Los gestos, el vaivén y el micro-giro
  son la firma de esta marca; quien los quiera, los pide.

Codifica a CRF 14 con preset `slower` y no a los 17 de siempre: aquí la única
capa es texto sobre metraje que no se toca, así que todo lo que el codificador
tire es pérdida pura contra el original.

---

## Los dos caminos hacia la misma plantilla

| Camino | Quién escribe el plan | Cuándo |
|---|---|---|
| Pieza propia | `escaleta.Escaleta.subtitulos()` | hay guion y montaje |
| Material ajeno | `scripts/solo_subs.py` | solo se piden captions |

Los dos emiten una capa `kineticcaptions` con
`template: "kinetic-captions.html"`. Difieren en los valores por defecto:
`escaleta.subtitulos()` trae `dinamica="favorito"` y deriva `fijoAbajo` y
`anchoMax` de la zona segura con `caja_subtitulo()`; `solo_subs.py` no pone
ninguno de los cuatro y deja que mande el `defaults` de la plantilla.

`templates/karaoke-subs.html` es **legado**: BRAND_RULES §12 dice que
`kinetic-captions` lo sustituye en todo plan nuevo.

Nada de esto tiene que ver con
`packages/video/src/themes/SubtitulosCineticos.tsx`, que es la reimplementación
en Remotion para los shorts de la fábrica. Otro motor, otro producto.

---

## El estilo, tal como está escrito

Todo sale de `templates/kinetic-captions.html` y de los tokens de
`templates/_tokens.css`. La plantilla **no escribe ni un hexadecimal propio**
salvo en el bloque declarado del preset 2.

**El gesto no es color: es PESO.** La voz recorre la línea por el eje variable
de Plus Jakarta Sans, y cada palabra tiene tres estados:

| Estado | Token | Peso |
|---|---|---|
| aún no se ha dicho | `--wght-espera` | 300 |
| suena ahora | `--wght-voz` | 800 |
| ya se ha dicho | `--wght-dicha` | 500 |

Los anchos se **congelan en `em` antes de animar**, así que engordar una palabra
no recoloca a sus vecinas.

**Familia y cuerpo.** `var(--display)` → Plus Jakarta Sans. Cuerpo del token
`--t-hero` = **109 px**, versales. La palabra clave va a 1,16 em.

**Conectores.** Van en `Yellowtail` (respaldo `Caveat`) cursiva, minúscula,
girada −4°, en `--ink-soft`, y **no entran en el sistema de pesos** porque
Yellowtail es estática: su estado lo marca solo la opacidad. La lista es cerrada
y está en la constante `ENLACES` (52 palabras) — «se detectan por lista y no por
longitud: hay conectores largos ("mientras") y palabras con carga cortas
("IA")». Los posesivos no entran.

**Palabra clave.** Las que se pasen en `--claves` van en el acento y llevan un
`filo` debajo. Sin `--claves` no hay ninguna palabra en color y el acento no se
usa; el script avisa si le das acento sin claves.

**Agrupación.** Máximo `max: 3` palabras por grupo. Corta al llegar al máximo,
en puntuación (`[.,;:!?]`) o si la pausa con la siguiente pasa de
`huecoMax: 0.42` s. Cada grupo se recorta contra el siguiente
(`min(fin + COLA, siguiente.ini)`) para que no haya dos en pantalla a la vez.

**Caja.** `fijoAbajo: 471` px desde el borde inferior —que es `1920 − 1459 + 10`,
donde empieza la banda que pinta Reels, medida sobre capturas— y
`anchoMax: 820` px, que es `2×950 − 1080`: la caja está centrada, así que para
que su borde derecho no entre en la columna de likes el ancho no puede pasar del
doble de lo que hay del centro a esa columna.

---

## El color: de amarillo a azul a rosa

La palabra clave siempre ha ido en `--accent`, y el acento es lo único que ha
cambiado. Historia real, verificada en el repo del editor:

| Cuándo | Acento | Dónde |
|---|---|---|
| commit inicial `dc65392` | `#FFE500` amarillo | `_tokens.css` |
| — | `#CD7F32` bronce (Carbon & Bronze) | `_tokens.css` |
| `38bcf0f`, 31-jul-2026 | **`#6FA0D6` azul** (carbon) · `#1F4E79` (paper) | «la marca deja de ser Carbon & Bronze y pasa a ser Papel y Tinta» |

Ese **azul `#6FA0D6` es el de los reels propios**: es el acento de marca, y la
plantilla lo hereda sin saber nada de él.

**El rosa nunca fue un cambio de código.** Es un parámetro del plan:
`config.acento`, expuesto como `--acento`. Existe exactamente para esto —lo dice
la cabecera de `solo_subs.py`—:

> `kinetic-captions` pinta la palabra con carga en `--accent`, que es el azul de
> esta marca. Para una pieza que no es de esta marca eso es el error y no el
> acierto.

El rosa que se usa con Katy es **`#E5789F`**. No hay preset, ni perfil, ni rama,
ni seed que se llame «katy»: hay un color en la línea de comandos. Buscar un
commit «azul → rosa» es buscar algo que no existe.

Cuando se pasa `--acento`, el filete de bronce se va con él: el bronce es la
marca de esta marca, y bajo una palabra rosa son dos colores peleándose.

---

## La trampa: `tam` no hace lo que parece

Si un caption sale más pequeño de lo esperado, **no es un fallo de
configuración**. Al final de `setup()` la plantilla mide la palabra **más ancha
de toda la pieza** y, si pasa de `anchoMax`, baja el cuerpo de la ZONA entera de
una sola vez:

```js
if (masAncha > anchoMax) {
  const menor = Math.floor(cuerpo * (anchoMax / masAncha));
  zona.style.fontSize = menor + 'px';
}
```

Es deliberado —«un ajuste por grupo haría que el subtítulo cambiara de tamaño a
mitad de frase»—, y tiene una consecuencia que hay que saber:

> **Subir `tam` no agranda nada** cuando alguna palabra ya se pasa de
> `anchoMax`: el ajuste lo cancela en la misma proporción. Medido: con
> `tam: 150` en vez del defecto, la altura de caja pasó de 59 px a 61.

Lo que manda es **la longitud de la palabra más larga del clip**. Comparado con
el vídeo de referencia de Katy:

| | Palabra más larga | Cuerpo final | Altura de caja |
|---|---|---|---|
| referencia | `DEBERÍAS` (8) | 109 px (sin encoger) | 81 px |
| clips 1 y 2 | `perfectamente` (13) | ~92 px | 59 px |

O sea: el mismo motor con la misma configuración da tipografía más pequeña en un
guion con palabras largas. No hay nada que arreglar. Si de verdad hace falta más
cuerpo, la única palanca honesta es `anchoMax`, y subirlo mete el texto debajo
de la columna de iconos de la plataforma (§18) — que es justo lo que ese número
evita.

---

## Cómo se comprueba que salió bien

Se juzga mirando, y además se mide:

```bash
# la imagen no ha cambiado fuera del rótulo
ffmpeg -i original.mp4 -i salida.mp4 -filter_complex \
  "[0:v]crop=1080:1100:0:0[a];[1:v]crop=1080:1100:0:0[b];[a][b]psnr" -f null -
```

Referencias medidas en la zona sin subtítulo: **30,6 dB** con LUT y 30 fps ·
**44,2** sin LUT a 30 fps · **46,3** sin LUT a 24 fps y CRF 14. Los tres clips de
agosto de 2026 dieron **50,6-51,0 dB**.

Y comprobar que los fps de salida son los del origen:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,nb_frames \
        -of csv=p=0 salida.mp4
```
