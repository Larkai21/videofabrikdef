# Plan: más variedad de material y mejor matching (14-ago-2026)

Origen: investigación de 12 agentes (4 lectores de código, 6 de mundo exterior,
2 jueces adversariales) disparada por el usuario con un plan externo de Gemini
como insumo. Informe completo: artifact «Más material, mejor matching»
(claude.ai/code/artifact/6ff3595d-8b5c-4696-b71e-cdbafa8bbe99). Este doc es la
versión operativa: qué se decidió, en qué orden, y qué queda en manos del
usuario.

## El diagnóstico en tres líneas

1. El matching es texto-texto y la señal NO separa (constants.ts:36 lo
   documenta; candidatos de un beat en 0,037 de coseno; AUC 0,707 sin umbral
   útil). La calidad la sostiene el juez LLM (96 % sin disparate).
2. La variedad se estrangula por diseño: UNA query por plano, caché 24 h,
   Pexels 200 req/h, anti-repetición solo por identidad exacta. Baseline
   medida (pnpm variedad, 7 vídeos): 14,5 % de planos repetidos contra la
   ventana de 8, con picos del 22 % y assets en 4 de 7 vídeos.
3. La biblioteca (~575 assets) solo crece como subproducto de producir.

## El veredicto del plan de Gemini (resumen)

YA EXISTÍA: word timestamps del TTS, director LLM de intención visual,
ducking sidechain, entrega −14 con ganancia plana medida, Remotion
parametrizado con OffthreadVideo, caché+idempotencia. VIOLA DECISIONES:
AWS Lambda (SPEC §15), S3/Redis como estado. INVIABLE: Storyblocks API
(enterprise ~24k $/año), GIPHY/Tenor (Tenor API clausurada 30-jun-2026;
GIPHY prohíbe uso comercial del contenido), yt-dlp como b-roll (Content ID
sin duración mínima, YPP «reused/inauthentic content» por canal, ni fair use
ni cita UE cubren b-roll decorativo; la atribución no arregla nada).
APROVECHABLE: PySceneDetect al servicio de un embedding visual local.

## Sprints

- **S1 · Medir antes de tocar (HECHO en su núcleo, 14-ago)**
  - `pnpm variedad`: telemetría inter-vídeo que no existía + baseline
    congelada en calibracion/variedad-baseline.json. HECHO.
  - Fuentes de stock muertas → visibles: colector en StockSearchIds,
    congelado en `broll_telemetry.fuentes_muertas`, aviso `fuente_muerta`
    (gravedad alta) en pnpm calidad; guarda dura si NO hay ninguna API key
    (incidencia reintentable; válvula STOCK_SIN_CLAVES=1). HECHO.
  - cacheCaption genérico por prefijo de ref (antes: ternario binario que
    rompería cualquier proveedor nuevo). HECHO.
  - Deriva docs corregida (CAPTION_TOP_K/finalistas). HECHO.
  - PENDIENTE HUMANO (D5): curar 3-4 vídeos en el dashboard y volcar con
    exportar-etiquetas hasta ≥100 etiquetas; sin banco, S2/S4 no se pueden
    afirmar.
- **S2 · Variedad barata**:
  - 2ª variante de query por plano (alt_query del director, solo si la 1ª no
    llena 10 finalistas). HECHO 14-ago.
  - NASA como red de CLIPS de dominio público (sin key; búsqueda + metadata
    por candidato para duración/mp4; entra cuando el comercial no llena el
    pool, antes que Commons). HECHO 14-ago.
  - Cosecha de subcampeones: el nº 2 de cada plano con caption ya pagado
    entra en biblioteca con times_used=0 (tope 12/vídeo; la purga de 90 días
    lo vigila). HECHO 14-ago.
  - Fallback al veto del juez: edit 'cobertura' a pantalla completa (velo +
    narración del tramo, keyword acentuada) emitido por el pipeline para los
    vetados sin rescate; retira los edits visibles bajo su ventana. HECHO
    14-ago (still fx-cobertura.png verificado).
  - Coverr: PENDIENTE de D2.
- **S2b · Música**: maquinaria HECHA 14-ago — master.audio.music_asset_id
  congela la pista, pickMusicTrack anti-repite contra los últimos 3 vídeos
  (con pool agotado repite antes que quitar), y elegir una pista sin
  licencia registrada avisa. Inventario medido: CERO pistas kind=music.
  PENDIENTE HUMANO: ingerir 15-20 pistas seguras etiquetadas por mood
  (YouTube Audio Library / CC BY con crédito / Pixabay Music) — sin pool,
  background_music sigue siendo un toggle sin efecto.
- **S3 · Licencias por item + cosecha semanal**: HECHO 14-ago en su núcleo —
  assets.credit (migración 0015) + crédito congelado en beat.asset.credit +
  línea «Metraje: …» en description.txt; la red de Commons para b-roll pasa
  de PD/CC0 a todo LICENSE_OK (BY/BY-SA con crédito). Cosecha semanal (lunes
  6:00): rota las example_queries de los pilares, 8 consultas y 12 clips por
  canal/semana, caption reutilizado o VLM con ledger, times_used=0; probada
  en vivo (2 clips reales). PENDIENTE: cliente de Internet Archive y vídeo
  de Commons (el habilitador ya existe).
- **S4 · Matching visual (L)**: sidecar Python (PySceneDetect 0.7.1 +
  SigLIP2 so400m-patch14-384, dim 1152, multilingüe, transformers+MPS;
  fallback MobileCLIP2-S2) → tabla asset_shots con pgvector HNSW. Regla
  congelada: LO VISUAL SOLO RECUPERA; DECIDE EL JUEZ. Regalos del mismo
  índice: biblioteca troceada en planos elegibles (fit.offset_ms ya existe),
  tramo distinto por reutilización, anti-repetición perceptual en pick.ts,
  retirada del caption VLM de pago. Antes de nada: smoke de 100 frames (MPS)
  y confirmar que los thumbnails de Pexels no cuentan contra el rate limit.
- **S5 · La cama que se oye**: MUSIC_GAIN_DB −22→−17/−18 y ratio 6→2-3
  (pendiente D3), re-nivelar SFX_VOLUME, re-medir pico real, portar el check
  ebur128 post-render de apps/editor.

## Decisiones del usuario (pendientes)

- D1: rechazo formal de yt-dlp como b-roll + AUDITAR el clipping de podcasts
  (misma exposición legal, misma cuenta).
- D2: Coverr sí/no (logo en dashboard; su prohibición de «IA/dataset» roza el
  índice visual de S4 — si sí, excluir sus assets del índice).
- D3: ¿la música se oye (−17/−18 dB) o se quita? El estado actual (inaudible
  pero con riesgo de Content ID) es lo único indefendible.
- D4: confirmar que no se paga stock (nada con API baja de 50 $/mes).
- D5: una tarde de curación humana para llenar el banco (bloquea S2/S4).
- D6: autorizar el sidecar Python en workers (precedente: apps/editor).
