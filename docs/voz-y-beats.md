# Voz y beats — TTS, subtítulos y segmentación temporal

Componente: worker `tts:*`. Entrada: `guion_ok`. Salida: `audio/`, `cues[]` y `beats[]`
en el JSON maestro. Estado resultante: `audio`.

## 1. Proveedores: ElevenLabs (el canal) y edge-tts (la base)

- La voz es POR CANAL en `profile.voice` (`provider`, `voice_id`, `rate`). El canal
  real usa **ElevenLabs** con la voz Mario (`OjrdP8Z2fWjVyt0scrL7`, es-ES peninsular,
  modelo `eleven_flash_v2_5`), endpoint `with-timestamps`: audio + alineación por
  carácter que se convierte al mismo formato WordBoundary, así que el resto del
  pipeline no distingue proveedores.
- **edge-tts** (`msedge-tts`, gratis, sin clave) es el proveedor BASE: si el canal pide
  ElevenLabs y falta `ELEVENLABS_API_KEY`, se degrada a edge con warn, y el `voice_id`
  cae al fallback (`es-ES-AlvaroNeural`, rate −8 %) porque el id de una plataforma no
  existe en la otra.
- Síntesis POR ESCENA, no del texto completo: paraleliza y permite re-sintetizar solo
  la escena editada. Y DENTRO de cada escena, POR FRASE (`frases.ts`): cada frase se
  sintetiza por separado (retry por frase) y se ensambla un audio por escena con
  `PAUSE_SENTENCE_MS` (180 ms) de respiración entre frases, re-basando las palabras.
  El contrato de salida es el mismo `TtsSceneAudio`, así que aguas abajo nada
  distingue los dos caminos; los fragmentos muy cortos («¿Sí?») se pegan al anterior
  para no forzar prosodia rara. Mismos caracteres facturados, más peticiones.
- Concatenación: ffmpeg concat con silencios insertados — `SCENE_GAP_MS` 300 ms entre
  escenas de la misma sección, `SECTION_GAP_MS` 600 ms al cambiar de sección. Los
  offsets de palabra se re-basan al tiempo global durante la concatenación.

### Calibración de velocidad (WORDS_PER_MIN)

La constante que convierte minutos pedidos en palabras del guion está MEDIDA, no
estimada, y su historia importa: 150 (suposición; descalibraba la duración un 20 %) →
125 (2.887 palabras / 23,25 min reales con edge-tts) → **139** (578 palabras / 4,16 min
con Mario por `eleven_flash_v2_5`). Se re-mide al cambiar de voz o de modelo con
`pnpm probar:voz <videoId> --voz <voiceId>`, que sintetiza un guion entero por el
camino del worker y saca el wpm de los word timestamps. Los modelos NO son
intercambiables: el mismo texto por `eleven_multilingual_v2` sale bastante más lento
que por Flash, así que una muestra suelta de otro modelo no vale para calibrar.

### Normalización de locución

`normalizaLocucion` (shared/script-quality.ts) reescribe en el TEXTO DEL GUION las
formas que el sintetizador lee mal — caso fundador: «GPT-5.6» se locutaba con una «s»
donde va el 6, porque en español el punto es separador de millares y «5.6» llega
ambiguo; quitar el guion lo arregla («GPT 5.6»). Va sobre el guion y no sobre el texto
enviado al TTS porque subtítulos y anclajes salen de los word timestamps: una sola
representación en toda la cadena. `normalizaEscena` normaliza texto y `trigger_word` a
la vez (los dos o ninguno), y se aplica en la generación, el refinado y la edición
humana por la API.

## 2. Post-procesado de audio

- Normalización: ffmpeg `loudnorm` a −16 LUFS, techo −1,5 dBTP; salida WAV 44,1 kHz
  (master) + AAC para preview. La voz a −16 es la REFERENCIA DE MEZCLA (la música va
  −22 dB bajo ella); el MP4 entregado sube después a `DELIVERY_LUFS` (−14) con una
  sonda post-render y ganancia plana limitada por el pico real
  (`render/loudness.ts`) — YouTube normaliza a ~−14 y solo atenúa, así que entregar
  por debajo regalaba volumen. Medido antes del arreglo: −16,9 LUFS, pico −4,4 dBTP.
- Chequeos: silencio interno > 1,5 s → warning en UI; duración total vs objetivo ±15 %
  → warning (no bloquea).
- Música de fondo: el mezclador existe (pista por mood a −22 dB con ducking sidechain
  6:1, tras el loudnorm, tolerancia de duración ±50 ms) pero está DESACTIVADO
  (`settings.background_music=false`) y no hay ninguna pista `kind=music` en la
  biblioteca. Activarlo sin pistas no hace nada.

## 3. Subtítulos (cues)

- Agrupación de WordBoundaries en líneas: máx ~32 caracteres o 7 palabras por línea,
  máx 2 líneas por cue, cortar preferentemente en puntuación; duración de cue 1–5 s.
- Formato en el maestro: `cues: [{from_ms, to_ms, text, words: [{from_ms, to_ms, w}]}]`
  — `words` habilita el modo karaoke del `subtitle_theme` sin recomputar nada.
- No se usa Whisper: los boundaries del TTS son la verdad (ElevenLabs los da por
  carácter; edge por palabra).

## 4. Algoritmo de beats

Objetivo: huecos visuales de 8–15 s alineados con el sentido del texto.

1. Candidatos de corte = finales de frase (puntuación fuerte) con su timestamp real.
2. Greedy desde t=0: elegir el candidato más cercano a t+11,5 s dentro de [8, 15] s;
   si ninguna frase termina en la ventana, permitir corte en coma/conjunción; nunca
   dentro de palabra. Último beat: se permite 5–18 s para no dejar un huérfano.
3. Cada beat hereda: `text` (concatenación de sus frases) y `visual_query` de la escena
   dominante (la que más ms aporta); si abarca dos escenas con queries muy distintas
   (cos < 0,5), se marca `multi_scene` y el matcher prioriza la primera.
4. Salida: `beats: [{idx, from_ms, to_ms, text, visual_query, status: pending}]` con
   tiempos EXACTOS del audio final — son la ley para timeline y render.

## 5. Coste

ElevenLabs cobra por carácter (Flash a media tarifa): un vídeo de ~4,5 min son ~3.800
caracteres ≈ 1.900 créditos; el plan Starter (39.424/mes) da para ~20 vídeos. Cada
llamada registra los caracteres en `cost_ledger` aunque el coste marginal sea 0, para
vigilar el agotamiento del plan.
