# Cómo mirar lo que hace este repo

Tres formas de ver el catálogo, de menos a más compromiso. La regla que las
ordena está en `CLAUDE.md`: **verifica mirando, no leyendo**. Un `layers.json`
con cientos de fotogramas no prueba que se vea nada — una fuente ausente o un
`omitBackground` mal puesto producen imágenes vacías que ningún log delata.

Este documento estuvo atrapado dentro de `renders/`, que está en `.gitignore`,
así que se habría perdido en el primer clon. Ahora vive aquí.

---

## 1 · La hoja de contactos — congelada

```bash
node scripts/hoja_contactos.js
open build/hoja/
```

Un instante de cada plantilla, en los dos temas, apilados. Sirve para juzgar
**composición y color**, y para eso está bien.

Va sobre **medio tono y no sobre negro** a propósito: sobre negro, un trazo
negro y una sombra dura son invisibles. Están ahí —se pueden medir— pero no se
pueden juzgar, y un catálogo que miente sobre la mitad de sus fichas no sirve
para elegir.

`--only <parte del nombre>` para iterar sobre una sola.

### El contacto versionado — para quien no tiene esta máquina

```bash
make contacto
```

Regenera la hoja por tema y la exporta comprimida a
`docs/media/catalogo-carbon.jpg` y `docs/media/catalogo-paper.jpg`, a menos de
1,5 MB cada una. Es el único catálogo que **viaja con el repo**: el agente
guionista externo no puede correr Playwright, y sin estos JPG su única imagen
del catálogo era un mensaje de error. Cada JPG lleva la rejilla completa de un
tema; para juzgar en esta máquina sigue valiendo más la hoja de `build/` — el
JPEG se come el detalle fino a propósito, a cambio de poder versionarse.

Después de añadir o retocar una plantilla, `make contacto` otra vez: un
catálogo versionado que miente es peor que el mensaje de error al que
sustituye.

## 2 · La galería — en movimiento

```bash
node scripts/galeria.js            # ~2 min, escribe en /tmp
python3 scripts/galeria_video.py   # monta el vídeo
```

Lo único que juzga de verdad una plantilla de motion. Una entrada que llega
tarde, un rebote que §11 prohíbe o un texto que se lee a medias **no se ven en
una captura**.

Cada clip arranca en `t=0` y no en el instante asentado: en motion, la entrada
es lo que hay que mirar. Y al final van los 21 sonidos con su onda dibujada.

Escribe en `/tmp` y no en `build/` a propósito: son casi tres mil PNG y `build/`
está sincronizado con iCloud.

## 3 · Sobre metraje — cuando la plantilla lo necesita

Dos plantillas **no se pueden juzgar sin vídeo debajo**, y la hoja de contactos
miente sobre las dos:

- **`glass-dock`** y cualquier capa con `cristal: true`. Sin metraje detrás no
  hay nada que refractar, así que se ve una pastilla gris. Fue exactamente lo
  que llevó a diagnosticar mal la plantilla.
- **`antes-despues`**. Sin metraje el lado «antes» sale transparente y solo se
  ve el mueble —canto, tirador, rótulos—. El revelado lo hace ffmpeg.

```bash
mkdir -p /tmp/prueba
cat > /tmp/prueba/plan.json <<'JSON'
[
  { "capa": "antesdespues", "template": "antes-despues.html",
    "t": 2.0, "duracion": 5.0, "cortinilla": true,
    "imagen": "assets/broll/auditoria_antes.png",
    "config": { "duration": 5.0, "hasta": 0.64,
                "antes": "LO QUE ENCONTRÓ", "despues": "LO QUE HICE" } }
]
JSON

# --build NO es opcional: sin él, render_playwright.js VACÍA
# build/frames/<capa> de las capas de su plan y te llevas por delante el
# montaje que tuvieras.
node scripts/render_playwright.js --build /tmp/prueba \
  --plan /tmp/prueba/plan.json --fps 25

python3 scripts/composite_ffmpeg.py \
  --layers /tmp/prueba/layers.json --timeline build/timeline.json \
  --output /tmp/prueba/salida.mp4 --preview
```

---

## Escuchar

```bash
make sonido     # la tabla: cada señal con su nivel real y si aparta la voz
make escuchar   # fichas de tres pasadas: sin el efecto / con él / con él +6 dB
```

La galería presenta cada efecto **aislado**, y aislado es donde no se puede
detectar el fallo que costó el sprint de sonido: `deslizar` sonaba perfecto solo
y en la mezcla quedaba 1,9 dB por debajo del umbral del ducking, así que no
apartaba la voz. **Ese hecho solo existe contra la voz.**

El número dice si el efecto **existe**; la escucha dice si está **bien**.

---

## Dos avisos que cuestan minutos

**`--build` en cualquier render de prueba.** Sin él se borran los fotogramas
del montaje real.

**`--lut` si la cortinilla revela metraje.** Sin grading los dos lados son el
mismo píxel: la cortinilla se ve moverse sin revelar nada, que es peor que no
ponerla porque parece que funciona. El compositor avisa y omite el revelado,
pero mejor no llegar ahí.
