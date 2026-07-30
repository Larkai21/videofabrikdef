# Assets y biblioteca — matching, APIs de stock, encaje e ingesta

Componente: worker `assets:*`. Entrada: `audio` (beats listos). Salida: cada beat con
candidatos y estado `auto_ok`/`review`; al aprobar la timeline, descarga e ingesta
definitivas. Estados: `assets` → `timeline_ok`.

## 1. Embeddings (decisión transversal)

- Modelo LOCAL vía `fastembed` (Qdrant) en el worker, CPU: `multilingual-e5-small`
  (384 dims) — multilingüe (guiones ES, queries y stock EN), coste 0, sin latencia de
  red. Índice HNSW en pgvector.
- El MISMO modelo se usa en todo el sistema (ideas, beats, assets, saturación) para que
  las similitudes sean comparables. Cambiarlo = migración (re-embeber todo).

## 2. Cascada por beat

```
para cada beat:
  q = embed(visual_query)                       // + keywords del texto si query corta
  1) BIBLIOTECA  candidatos = assets del canal + shared
                 filtro: kind válido, anti-repeat (no usados en últimos N=8 vídeos)
                 score_lib = cos(q, asset.embedding)
  2) STOCK       si mejor score_lib < T_stock (0,70): consultar Pexels y Pixabay
  3) DECISIÓN    best ≥ T_auto  → beat.status = auto_ok (top1 fijado, 3–4 alternativas)
                 T_rev ≤ best < T_auto → status = review (candidatos visibles)
  4) FLUX        best < T_rev o sin resultados → generar imagen y status = review
```
- Umbrales iniciales: T_auto = 0,62 · T_rev = 0,45 · T_stock = 0,70. Son PROVISIONALES:
  en S1 se calibran etiquetando a mano ~50 beats (objetivo: <5% de falsos auto_ok).

## 3. APIs de stock

- Pexels vídeos: `GET https://api.pexels.com/videos/search` con
  `query, orientation=landscape, size=medium, per_page=15` (header `Authorization: <key>`).
  Fotos: `https://api.pexels.com/v1/search` cuando el beat prefiera imagen fija.
- Pixabay: `GET https://pixabay.com/api/videos/?key=…&q=…&per_page=15` como segunda
  fuente (y desempate de "sameness").
- Caché obligatoria: tabla `stock_cache(query_norm, provider, results jsonb, fetched_at)`
  con TTL 24 h y query normalizada (lower/trim) — Pexels limita 200 req/h y 20k/mes; con
  caché y 2 proveedores el MVP queda holgadísimo.
- Metadatos textuales del stock son pobres: para rankear bien, a los 5–8 finalistas por
  búsqueda se les hace caption del thumbnail (`video.image`) con un VLM barato
  (GPT-5 Mini visión o equivalente, ~0,0005 $/imagen) y se cachea junto al resultado.
  score_stock = 0,6·cos(q, embed(caption+query)) + 0,2·calidad (≥1080p, duración ≥ beat)
  + 0,2·novedad (proveedor/clip no usado recientemente).

## 4. Encaje (fit) — calculado, nunca manual

- clip_len ≥ beat_len → recorte con offset centrado (`offset_ms = (clip−beat)/2`).
- clip_len < beat_len → loop con crossfade de 300 ms hasta cubrir (máx. 3 loops; si no
  llega, el candidato se descarta del ranking).
- Imagen → Ken Burns: zoom 1,00→1,08 con pan; dirección derivada de
  `seed = hash(video_id, beat_idx)` para reproducibilidad total.
- El fit se guarda en el maestro: `beat.asset.fit = {mode, offset_ms, loops}` y el
  render lo ejecuta tal cual.

## 5. Cuando no hay plano

No hay tier de generación de imagen: el cuerpo del vídeo no lleva imágenes hechas por
IA. Hubo uno (fal.ai `flux/schnell`) y se retiró en jul-2026 sin haber producido nunca
un plano que se publicara. Los dos desenlaces posibles son:

- **Hay candidatos, pero ninguno llega a `T_REV`.** Se propone el mejor igualmente,
  marcado `review`, con su coseno y su origen a la vista. Un plano flojo es una
  propuesta que el humano puede cambiar en la curación; un hueco es una tarea que no
  puede resolver desde la timeline.
- **No hay ningún candidato**, ni siquiera reutilizando uno ya usado en el vídeo. El
  job lanza un error que nombra `PEXELS_API_KEY` y `PIXABAY_API_KEY`, el vídeo entra en
  `incidencia` y se puede reintentar. Fallar aquí es mejor que escribir un beat sin
  asset y reventar en la ingesta o en el render.

## 6. Descarga e ingesta a biblioteca

- Durante el matching solo se guardan URLs y metadatos (no se descarga nada).
- Al aprobar la timeline: descargar SOLO los elegidos → `ffprobe` (duración, resolución,
  códec) → mover a `library/assets/<canal|shared>/<kind>/` → fila en `assets` con:
  procedencia y licencia (pexels|pixabay|flux|playwright|upload), tags = tokens de la
  query + caption VLM, embedding, `times_used=1`, `last_video_id`.
- Subida manual desde la timeline: mismo camino de ingesta (kind=upload, licencia
  `propia`), y el archivo queda asignado al hueco.
- Capturas Playwright (canal IA/tech): job utilitario `capture:tool` que dado un URL
  saca screenshots 1920×1080 y un scroll-recording corto; entran a biblioteca como
  `screenshot` con tags del nombre de la herramienta.

## 7. Anti-repetición y limpieza

- Selección con `NOT IN (assets de los últimos N=8 vídeos del canal)` (configurable).
- Job mensual: assets con `times_used=0` a los 90 días → candidatos a purga (lista en
  UI, borrado manual). Nunca se borra nada referenciado por un vídeo renderizado.
