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
- El coseno mide caption↔query: la query NUNCA se incluye en el texto embebido del
  asset (inflaría la similitud con sus propios términos). Esa fuga existió en la
  biblioteca y producía un bucle autoconfirmante; está cerrada y los 227 assets de
  entonces, re-embebidos.

## 2. Cascada por beat (en realidad: por sub-plano)

El director de b-roll parte cada beat en 1–3 sub-planos (`MAX_VISUALS_PER_BEAT`),
cada uno con su consulta; la cascada resuelve cada sub-plano:

```
para cada sub-plano:
  q = embed(visual_query)                       // + keywords del texto si query corta
  1) BIBLIOTECA  candidatos = assets del canal + shared
                 filtro: kind válido, anti-repeat (últimos N=8 vídeos), veto intra-vídeo
                 cos efectivo = cos − LIBRARY_HANDICAP (0,03) [− IMAGE_HANDICAP si imagen]
  2) STOCK       si lo mejor no llega a T_STOCK (0,88): Pexels y Pixabay
  3) DECISIÓN    sobre el COSENO CRUDO: best ≥ T_AUTO (0,86) → auto_ok
                 T_REV (0,78) ≤ best < T_AUTO → review
                 best < T_REV → se propone el mejor igualmente, en review
```

Los umbrales están calibrados a ojo y el conjunto etiquetado
(`calibracion/planos-etiquetados.jsonl`, ver `docs/calidad.md`) demostró que el
problema no era el corte sino la señal: todos los candidatos de un beat caben en
~0,04 de coseno. De ahí el juez de planos (§3).

**Cuota global de imágenes** (`exigeClipPorCuota`): las palancas por pool (plazas de
finalista, handicap) no miran el vídeo entero, y el agregado se fue al 42 % contra un
techo del 30 % — las imágenes no ganan por mejores sino porque su texto de partida es
mejor (el alt de una foto de Pexels: 13,7 palabras; el slug de un clip: 2,0). La cuota
lleva la cuenta corriente del vídeo y exige clip en cuanto la siguiente imagen pasaría
del techo (`broll_imagenes_max_pct`, 30 % por defecto). En re-match parcial arranca
contando lo ya bloqueado.

**Tope de duración de imagen** (`IMAGE_MAX_S`, hoy 5 s): una imagen cuyo tramo lo
supere se trocea en varias imágenes/clips distintos. Limitación conocida (plan S10):
el troceo solo existe en el matching, y el juez de planos y la curación humana eligen
DESPUÉS sin re-trocear — por eso pueden salir imágenes largas. El destino es aplicar
el tope en la ingesta, que es el último escritor.

## 3. El juez de planos (`broll_rerank`)

Tras resolver todos los beats, UNA llamada LLM relee los finalistas de cada sub-plano
(la narración que se oye + los pies de foto) y reordena, pudiendo contestar «ninguno
pega» — entonces el sub-plano pierde el verde y lo mira el humano sí o sí.

Por qué existe, medido sobre el conjunto etiquetado: los planos que un espectador
rechazaría bajan de 17/25 (68 %) a 24/25 (96 %). Ninguna combinación de números del
embedding conseguía eso: la información para distinguir «informe legal» de «estudio de
radio» no está en esos vectores. Coste: ~7.500 tokens por vídeo (~0,002–0,005 $).

Escribe en `visuals[]`, que es de donde tira la ingesta — reordenar solo
`beats.candidates` sería decorativo (la misma clase de fallo que tuvo la puerta de
curación humana). Detalle operativo: se releen los beats de la BD después del matching;
la fila en memoria tiene los candidatos vacíos.

## 4. APIs de stock y captions

- Pexels vídeos + fotos; Pixabay solo vídeos. Caché `stock_cache(query_norm, provider)`
  con TTL 24 h. Los `ref` de ambos clientes comparten formato.
- Los metadatos textuales del stock son pobres y DESIGUALES (título de foto = alt
  humano; título de clip = slug de URL). Por eso: preselección gratis por coseno de
  título con embeddings locales, y caption VLM de pago (~0,0005 $/imagen) solo para los
  `CAPTION_TOP_K=4` de los 6 finalistas que pueden ganar, con reparto de plazas POR
  TIPO para que la desigualdad de títulos no regale las descripciones a las fotos.
  Caché por imagen (`caption_cache`): un ref ya descrito no se paga dos veces.
- La descripción se hace sobre el fotograma del PUNTO MEDIO del tramo que se usa, no
  sobre el segundo 1: en más de la mitad de los clips la decisión se tomaba sobre una
  imagen que el espectador nunca veía.

## 5. Encaje (fit) — calculado, nunca manual

- clip_len ≥ beat_len → recorte con offset centrado.
- clip_len < beat_len → loop (máx. 3) o stretch hasta `MIN_PLAYBACK_RATE=0.75`.
- Imagen → Ken Burns: zoom 1,00→1,08 con pan; dirección por semilla.
- El fit se guarda en el maestro y el render lo ejecuta tal cual. La ingesta lo
  recalcula SIEMPRE con la duración real del archivo descargado.

## 6. Cuando no hay plano

No hay tier de generación de imagen: el cuerpo del vídeo no lleva imágenes hechas por
IA. Hubo uno (fal.ai `flux/schnell`) y se retiró en jul-2026 sin haber producido nunca
un plano publicado. Los dos desenlaces posibles:

- **Hay candidatos, pero ninguno llega a `T_REV`.** Se propone el mejor igualmente,
  marcado `review`, con su coseno y su origen a la vista.
- **No hay ningún candidato.** Antes de fallar, la `reserva` (los planos ya usados en
  el vídeo, apartados por el veto) es la red del último recurso: un plano repetido es
  mejor que un beat sin plano. Si ni eso, el job falla con incidencia reintentable.

## 7. Descarga e ingesta a biblioteca

- Durante el matching solo se guardan URLs y metadatos (no se descarga nada).
- Al aprobar la timeline: descargar SOLO los elegidos (tope 200 MB por archivo) →
  **reescalado a 1080p si viene más grande** (`reducirA1080`; un 4K en un render 1080p
  solo cuesta decodificación — un vídeo real murió por timeout de render con un clip
  3840×2160) → `ffprobe` → `library/assets/<canal|shared>/<kind>/` → fila en `assets`
  con procedencia, licencia, tags, embedding del caption (SIN la query), `times_used`.
- `pnpm reescala:biblioteca` normalizó los 50 clips >1080p que ya estaban dentro;
  es idempotente.
- Subida manual desde la timeline: mismo camino (kind=upload, licencia `propia`).
- La curación escribe la elección humana también en `visuals[]`
  (`elegirEnSubplano`): el beat guarda su elección en columnas propias, pero la
  ingesta lee los sub-planos — escribir solo en una mitad hace la puerta decorativa
  (pasó: 181 beats curados sin efecto sobre el MP4).

## 8. Anti-repetición y limpieza

- Entre vídeos: `NOT IN (assets de los últimos N=8 vídeos del canal)`.
- Dentro del vídeo: veto por refs ya elegidos al ARMAR el pool (el repetido ni
  compite), más de-dupe de contiguos por coseno de contenido (0,9).
- Job mensual: assets con `times_used=0` a los 90 días → candidatos a purga (lista en
  UI, borrado manual). Nunca se borra nada referenciado por un vídeo renderizado.
