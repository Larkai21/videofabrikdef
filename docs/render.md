# Render — Remotion SSR en el VPS

Componente: worker `render:*` en contenedor propio. Entrada: `timeline_ok` (JSON maestro
completo y assets descargados). Salida: `outputs/<videoId>/` con MP4 y miniaturas.
Estado: `render` → `hecho`.

## 1. Composición

- `packages/video` exporta la composición `LongForm` cuyo `inputProps` es el JSON
  maestro (validado con el esquema Zod de `packages/shared` al entrar).
- `calculateMetadata`: `fps = 30`, `1920×1080`,
  `durationInFrames = ceil(audio.duration_ms/1000 × fps)`.
- Estructura: `<Audio>` (master WAV) + secuencia de beats — cada beat renderiza
  `<BeatVisual>` (clip con offset/loop o imagen con Ken Burns según `fit`) — + capa
  `<Subtitles>` (cues + `subtitle_theme` del brand kit) + intro/outro/lower-thirds como
  componentes del kit en sus posiciones.

## 2. Registry de componentes del brand kit

- Al validar un zip (SPEC §10), el validador compila `Component.tsx` con esbuild a un
  bundle ESM en `library/components/.../dist/index.mjs` y regenera
  `packages/video/src/registry.generated.ts`: un mapa `tipo → {id@versión → import}`.
- La composición resuelve `master.brand.components` contra ese mapa. Prohibido el import
  dinámico de rutas arbitrarias: solo entradas del registry generado.
- Validación del zip = typecheck contra el contrato de props + render de humo (frames
  0–59) + captura de preview. Si falla, `status=failed` con el log visible en UI.

## 3. Ejecución SSR

- `bundle()` de `packages/video` una vez por versión del paquete (hash del lockfile +
  src) y caché del resultado en disco; los renders reutilizan el bundle.
- `selectComposition` + `renderMedia` con: `codec: h264`, `crf: 18`,
  `audioCodec: aac (192k)`, `pixelFormat: yuv420p`,
  `concurrency: 4–6` (pestañas de Chromium en 8 vCPU).
- La COLA de render tiene concurrencia 1: un solo vídeo renderizando a la vez; el
  paralelismo va dentro del render, no entre renders.
- Docker: imagen node LTS + Chromium headless instalado con el helper de Remotion
  (`npx remotion browser ensure`) horneado en la imagen; `/dev/shm` ampliado (≥1 GB).
- Progreso: `onProgress` → Redis pub/sub → SSE al dashboard (barra en la bandeja).
- Tiempo esperado: 8 min 1080p30 ≈ 15–40 min en el VPS. Aceptable: corre desatendido.

## 4. Determinismo

- Regla de lint en `packages/video`: prohibidos `Math.random` sin semilla, `Date.now`,
  `fetch` y timers. Toda aleatoriedad deriva de `hash(video_id, beat_idx, salt)`.
- Fuentes empaquetadas en el repo o en el zip del componente (nunca Google Fonts en
  runtime). Assets siempre por ruta local (`library/`, `outputs/`), nunca URL remota.
- Garantía objetivo: mismo maestro + mismas versiones de componentes ⇒ mismo MP4.

## 5. Salidas

- `outputs/<videoId>/video.mp4`
- 2 miniaturas: `renderStill` del componente `thumbnail_template` con los 2 conceptos
  del paquete SEO → `thumb_a.jpg`, `thumb_b.jpg` (1280×720).
- `title.txt`, `description.txt` (con `{timestamps}` ya sustituidos por los tiempos
  reales de sección), `tags.txt`, y `master.json` congelado (auditoría/re-render).

## 6. Preview en dashboard (misma fuente de verdad)

- `apps/dashboard` monta `@remotion/player` con la MISMA composición `LongForm` y el
  maestro en curso: la revisión de guion reproduce los primeros 30 s reales y la
  timeline salta al beat seleccionado. Cualquier divergencia player/SSR es un bug.
