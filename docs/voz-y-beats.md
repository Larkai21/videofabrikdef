# Voz y beats — TTS, subtítulos y segmentación temporal

Componente: worker `tts:*`. Entrada: `guion_ok`. Salida: `audio/`, `cues[]` y `beats[]`
en el JSON maestro. Estado resultante: `audio`.

## 1. Proveedor MVP: edge-tts

- Implementación: paquete npm `msedge-tts` (voces neuronales de Microsoft, gratis, sin
  clave). Si diera problemas de estabilidad, fallback: sidecar Python `edge-tts` por CLI
  (misma salida). La elección queda encapsulada tras una interfaz `TtsProvider`.
- Voz por canal en `profile.voice` (p. ej. `es-ES-AlvaroNeural`, `en-US-AndrewNeural`),
  `rate` ajustable (típico −5%…−12% para narración).
- Síntesis POR ESCENA, no del texto completo: paraleliza, y permite re-sintetizar solo
  la escena editada. Cada escena devuelve audio + eventos WordBoundary
  `{offset_ms, duration_ms, text}` relativos a la escena.
- Concatenación: ffmpeg concat con silencios insertados — 300 ms entre escenas de la
  misma sección, 450 ms al cambiar de sección. Los offsets de palabra se re-basan al
  tiempo global durante la concatenación.

## 2. Post-procesado de audio

- Normalización: ffmpeg `loudnorm` a −16 LUFS, techo −1,5 dBTP; salida WAV 44,1 kHz
  (master) + AAC para preview.
- Chequeos: silencio interno > 1,5 s → warning en UI; duración total vs objetivo ±15% →
  warning (no bloquea).
- Música de fondo: OPCIONAL y pospuesta a S2 — pista de `library/assets/music` por mood
  del perfil a −22 dB bajo la voz. El mezclador queda previsto pero desactivado en MVP.

## 3. Subtítulos (cues)

- Agrupación de WordBoundaries en líneas: máx ~32 caracteres o 7 palabras por línea,
  máx 2 líneas por cue, cortar preferentemente en puntuación; duración de cue 1–5 s.
- Formato en el maestro: `cues: [{from_ms, to_ms, text, words: [{from_ms, to_ms, w}]}]`
  — `words` habilita el modo karaoke del `subtitle_theme` sin recomputar nada.
- No se usa Whisper en el MVP: los boundaries del TTS son la verdad. (Whisper/alineación
  solo entraría si un proveedor futuro no diera timestamps.)

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

## 5. Ruta ElevenLabs (flag por canal)

- Endpoint `text-to-speech/{voice_id}/with-timestamps` (modelo Flash): devuelve audio +
  alineación por carácter → se convierte al mismo formato de WordBoundary y el resto del
  pipeline no cambia.
- Coste: dentro del plan Creator para ~30 vídeos largos/mes; cada llamada registra
  caracteres consumidos en `cost_ledger` aunque el coste marginal sea 0, para vigilar el
  agotamiento del plan.
