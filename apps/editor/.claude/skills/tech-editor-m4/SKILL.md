---
name: tech-editor-m4
description: Monta una pieza ENTERA a partir de un vídeo bruto .mp4 con Whisper local (M4 Pro), visión local para evitar el rostro, Google GenAI SDK, motor de motion graphics en Playwright y ffmpeg con LUT 3D. Úsala cuando el usuario pida editar o montar un vídeo propio, o invoque /tech-editor-m4 [archivo.mp4]. NO la uses si lo único que se pide son subtítulos sobre material ajeno: eso es scripts/solo_subs.py (ver docs/captions.md).
---

# Skill: /tech-editor-m4

> **Si lo único que se pide son captions/subtítulos sobre material que no es de
> esta marca, esta skill NO es.** Usa
> `.venv/bin/python scripts/solo_subs.py --input clip.mp4 --acento '#RRGGBB'
> --claves a,b` y lee `docs/captions.md`. Este pipeline reedita (quita silencios
> y tomas falsas), aplica el LUT de marca y genera B-Rolls: sobre el clip de otro
> las tres cosas son decisiones que nadie ha pedido.

Pipeline de edición en cinco fases. Ejecuta seguido y **solo se detiene una
vez**: antes del render final, para que el usuario apruebe.

Las normas visuales están en `BRAND_RULES.md` y son vinculantes: paleta
Carbon & Bronze, nada de neón, sin rebotes elásticos. Léelas antes de
inyectar textos o ajustar plantillas.

Trabaja desde la raíz del proyecto y usa `.venv/bin/python`.

---

## Fase 0 · Comprobación previa

Resuelve lo que falte en vez de fallar a mitad:

```bash
test -d .venv || python3.12 -m venv .venv
.venv/bin/python -c "import mlx_whisper" 2>/dev/null || .venv/bin/pip install -r requirements.txt
test -d node_modules || npm install
test -f assets/luts/carbon_bronze.cube || .venv/bin/python scripts/make_lut.py
```

Sin `GEMINI_API_KEY` ni `GOOGLE_GENAI_API_KEY`: **no te detengas**. Avisa de
que se omiten los B-Rolls y sigue; el vídeo sale igual.

---

## Fase 1 · Extracción y transcripción local

```bash
.venv/bin/python scripts/transcribe_mlx.py --input <video> --model medium
```

`--model large-v3` si hay tecnicismos, nombres propios o mezcla de idiomas.
Reporta palabras detectadas y velocidad respecto al tiempo real.

---

## Fase 2 · Limpieza de timeline y análisis de visión

```bash
.venv/bin/python scripts/clean_transcript.py
.venv/bin/python scripts/detect_face_bbox.py --input <video>
```

Informa de segundos recortados, porcentaje, cortes y tomas falsas
descartadas.

- **Si la reducción supera el 35 %, párate y pregunta.** Suele significar que
  el umbral de similitud se está comiendo material bueno. Propón
  `--similitud 0.9`.
- Si `face.json` sale con `verificado: false`, dilo claramente: la UI irá al
  tercio inferior por defecto. Ofrece
  `.venv/bin/pip install pyobjc-framework-Vision` (rápido, sin descargas)
  frente a `ollama serve && ollama pull qwen2-vl` (~6 GB).

---

## Fase 3 · Generación de assets

```bash
.venv/bin/python scripts/generate_google_assets.py --dry-run
```

El script aplica las **reglas de correspondencia** de `BRAND_RULES.md §5`:
código → Code Card, arquitectura → diagrama de nodos, métricas → tabla, y
solo lo demás va a la API. Enseña el reparto al usuario; si lo aprueba,
ejecuta sin `--dry-run`.

Si la API falla, sigue sin B-Rolls y dilo. No bloquees el montaje.

---

## Fase 4 · Renderizado de motion graphics

**Antes de renderizar, adapta el plan al vídeo real.** Los textos por defecto
de `planPorDefecto()` en `scripts/render_playwright.js` son de ejemplo: el
titular, el código del mockup, los nodos del diagrama y las pastillas deben
hablar del contenido que se acaba de transcribir. Usa `broll_plan.json` para
saber qué plantilla toca en cada instante.

**El plan se escribe ANTES de renderizar, y el silencio se quita entre las dos
cosas.** Esta fase se saltaba `silencios.py` por completo, y ese orden no es
un detalle de estilo: los fotogramas de los subtítulos llevan grabado en cada
imagen qué palabra toca en cada instante, así que quitar silencio DESPUÉS de
renderizar los deja en el reloj viejo sin dar ningún error.

```bash
# 1. el plan (automático o la escaleta de la pieza)
.venv/bin/python scripts/dirigir.py --transcript build/transcript.json

# 2. quitar silencios y remapear plan + timeline JUNTOS
.venv/bin/python scripts/silencios.py --aplicar

# 3. PUERTA OBLIGATORIA antes de gastar minutos en renderizar. Medio segundo.
make rapido
.venv/bin/python scripts/validar_plan.py build/plan.json
.venv/bin/python scripts/comprobar_reloj.py

# 4. y ahora sí
node scripts/render_playwright.js --fps 25

# 5. plan, manifiesto y fotogramas del mismo montaje. `build/` es compartido
#    entre piezas y los nombres de capa se repiten por diseño.
make comprobar
```

**Si el paso 3 falla, NO SIGAS.** Todo lo que detecta es de la clase de fallo
que no da error en ninguna etapa posterior: se ve aquí, o se ve mirando el
vídeo entero después de haber gastado los minutos de render. Y no es un
consejo genérico — `make rapido` tarda medio segundo y caza claves de config
que la plantilla no lee, colisiones con las que reserva el renderizador,
nombres de capa duplicados y tiempos que `silencios.py` no va a remapear.

Después **abre un PNG de cada capa y míralo**. Un `layers.json` con cientos
de frames no prueba que se vea nada: una fuente ausente o un
`omitBackground` mal puesto producen imágenes vacías que ningún log delata.

---

## Fase 5 · PARADA DE APROBACIÓN

Único punto de parada. Genera una previsualización y enséñasela:

```bash
.venv/bin/python scripts/composite_ffmpeg.py --preview --output renders/preview.mp4
```

Envíala con `SendUserFile` junto a un resumen: duración final vs original,
cortes, tomas falsas, B-Rolls, capas activas y si el LUT se aplicó.
**No renderices el final sin respuesta.**

---

## Fase 6 · Composición final con LUT

```bash
.venv/bin/python scripts/composite_ffmpeg.py --lut assets/luts/carbon_bronze.cube --crf 17
```

Entrega `renders/final_output.mp4` con `SendUserFile`.

---

## Reglas

- **Verifica mirando, no leyendo.**
- Nunca toques `input.mp4`. Todo va a `build/` y `renders/`.
- Si una etapa falla, di qué comando la arregla; no dejes el pipeline a medias
  sin explicar dónde quedó.
- Tiempos: `timeline.words` y `timeline.blocks` van **siempre** en el reloj del
  vídeo ORIGINAL, y `keep` es el único registro de la traducción a salida. El
  reloj de salida no se guarda: se deriva con `reloj.Mapa(keep)`. Si un paso
  aborta diciendo que el reloj no es el que espera, hazle caso — lo que hay
  detrás no da error en ninguna etapa posterior.
- No inventes IDs de modelo de Google. Si responde 404, dilo y remite a
  ai.google.dev.

## Cuándo NO usarla

Para un ajuste suelto (solo transcribir, rehacer una capa con `--only`,
regenerar el LUT), llama al script concreto. La skill es para el recorrido
completo.
