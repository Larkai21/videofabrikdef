# Fábrica de vídeo — contexto del proyecto

Herramienta self-hosted (VPS propio, Docker Compose) para producir vídeos de YouTube
semi-automatizados estilo "faceless". MVP: un solo canal (IA/tecnología), de la idea al
MP4 con metadatos, con intervención humana mínima y localizada en tres puertas (las del
raíl del vídeo largo; el clipping de episodios y los reels del editor añaden las suyas
propias FUERA del raíl — ver docs/episodios.md y docs/reels.md).
La especificación completa está en `SPEC.md` (raíz del repo): léela entera antes de
diseñar módulos nuevos o tomar decisiones de arquitectura.

## Stack (decidido — no reabrir sin preguntar)

- Monorepo pnpm + Turborepo, TypeScript estricto, ESM.
- `apps/dashboard`: Vite + React SPA (sin SSR), shadcn/ui, Tailwind, TanStack Query.
- `apps/api`: Fastify + Drizzle ORM + PostgreSQL (con pgvector).
- `apps/workers`: BullMQ sobre Redis; jobs idempotentes y reanudables.
- `packages/video`: composiciones Remotion, compartidas entre @remotion/player
  (preview en dashboard) y render SSR (worker). React es obligatorio en el front por esto.
  Una sola composición (`Pieza`) pinta el vídeo largo y el short vertical; lo que
  cambia entre formatos vive en `perfilDe(lienzo)`.
- `packages/shared`: esquemas Zod como única fuente de tipos (channel_profile,
  JSON maestro, contratos de componentes del brand kit).
- Almacenamiento MVP: sistema de archivos local (`library/`, `outputs/`). MinIO, después.

## Principios no negociables

1. La timeline es de revisión, no de edición: los tiempos los fija el audio
   (word timestamps → beats de 8–15 s). El humano cambia el contenido de los huecos,
   nunca los cortes. Sin asas de recorte ni arrastre de bordes.
2. El humano selecciona y aprueba; nunca ve JSON crudo (el guion se muestra como documento).
3. Todo estado de negocio vive en Postgres como máquina de estados explícita;
   la cola solo transporta trabajo. Cualquier job se puede reintentar sin efectos dobles.
4. Ledger de costes: cada llamada externa (LLM, TTS, stock, imagen) registra proveedor,
   unidades y coste estimado, agregado por vídeo.
5. Cascada de assets: biblioteca local → stock (Pexels/Pixabay). No invertir.
   Sin imágenes generadas por IA en el cuerpo del vídeo: si nada encaja, se propone
   el mejor plano marcado ámbar; si no queda ningún candidato, el job falla con
   incidencia reintentable.
6. Determinismo de render: sin aleatoriedad sin semilla, sin fetch durante el render,
   fuentes empaquetadas, animación solo con useCurrentFrame.
7. El MVP no toca la YouTube Data API en el camino crítico: la salida es MP4 + metadatos
   para subida manual. La API entra tras la auditoría (sprint 2+).
8. UI en español, sentence case, textos de sistema sin exclamaciones.

## Convenciones

- Zod primero: el esquema se define en `packages/shared` y los tipos se derivan (z.infer).
- Los workers no importan de `apps/*`; solo comparten `packages/*`.
- Migraciones con drizzle-kit; no editar SQL generado a mano.
- Tests de contrato para el JSON maestro y para el manifest de componentes del brand kit.
- Commits pequeños por módulo.

## Comandos (mantener esta lista al día al crearlos)

- `pnpm dev` — dashboard + api + workers en local
- `pnpm typecheck` / `pnpm lint` / `pnpm test`
- `docker compose up -d` — postgres, redis
- `pnpm render:smoke` — render de humo de 60 frames de la composición
- `pnpm previews:kit` — re-siembra las previews del brand kit con la marca real
  del canal. Hay que ejecutarlo al cambiar tokens, avatar o nombre, y al tocar
  una pieza integrada: la pantalla de Brand kit enseña mp4 ya renderizados, no
  los componentes en vivo
- `pnpm --filter @fabrica/video preview:marca [--video]` — fotogramas y clips de
  las cuatro piezas y de las tarjetas, con la marca real
- `pnpm rerank` — banco de matching sobre los planos etiquetados
- `pnpm encuadre` — banco de encuadre 9:16 (encuadreDe + foco) sobre los planos
  etiquetados de los shorts reales
- `pnpm encuadre:kf [--regenerar]` — banco de REGRESIÓN del tracking (kf) sobre
  planos con vaivén real (calibracion/vaiven); golden = salida congelada del
  sidecar, vigila el determinismo
- `pnpm clips:director <episodeId> [--con-risas] [--guardar]` — banco del
  director de highlights: corre el prompt sobre los beats reales sin cola ni
  inserción; con LLM_MODEL contrasta proveedores
- `pnpm calidad <videoId>` — informe de calidad + hoja de contactos; incluye los
  shorts del vídeo con los umbrales del formato y su hoja 9:16
- `pnpm metricas <csv>` — importa el CSV de YouTube Studio a videos.metrics y
  shorts.metrics (casa por id de YouTube si lo conoce, si no por título; el MVP
  no toca la YouTube API)
- `pnpm guion …` — banco de guiones (iterar el prompt sin cola); ver docs/calidad.md
- `pnpm probar:voz <videoId> --voz <id>` — mide wpm real y alineación de una voz TTS
- `pnpm probar:stt -- <url|fichero> [--max-min 20]` — banco de STT del clipping:
  descarga el audio (yt-dlp) y mide si las fronteras de frase son reales. La
  métrica operativa es fronteras FUERTES (respaldadas por silencio) por minuto,
  ≥4/min; el % de puntuación del ASR confirmada por pausa se reporta pero no
  gobierna (medido: 7 % en un monólogo rápido y aun así 5,2 fuertes/min). STT
  por STT_PROVIDER: 'mlx' (local, Metal, coste 0, por defecto en esta máquina)
  o 'whisper' (API, 0,006 $/min)
- `pnpm reescala:biblioteca [--dry]` — normaliza a 1080p los clips grandes ya ingeridos
- `pnpm sfx` — regenera los 14 .wav sintetizados
- Módulo editor (`apps/editor`, reels): su arnés es propio, no turbo —
  `cd apps/editor && make ci` (clon sin builds) o `make rapido` (con un build);
  puesta en marcha del venv en docs/reels.md. Requiere macOS Apple Silicon +
  Python 3.12; el resto de la fábrica no hereda esos requisitos
- **Captions sobre un clip AJENO** (solo subtítulos: ni reel, ni fábrica) —
  `cd apps/editor && .venv/bin/python scripts/solo_subs.py --input clip.mp4
  --acento '#E5789F' --claves palabra1,palabra2`. El motor es
  `apps/editor/templates/kinetic-captions.html` y el caso entero está en
  `apps/editor/docs/captions.md`. NO es el `SubtitulosCineticos.tsx` de la línea
  siguiente: otro motor, otro producto. Este caso se ha reimplementado desde
  cero más de una vez por entrar por la puerta equivocada
- `pnpm --filter @fabrica/video preview:marca --vertical [--video]` — fotogramas
  del short con la marca real (cartela, subtítulos cinéticos, recorte 9:16)

## No hacer

- No añadir edición de vídeo (trims, timeline arrastrable, capas).
- No llamar todavía a la YouTube Data API desde el pipeline.
- No introducir Next.js/SSR ni cambiar el stack del front.
- No usar MoviePy ni FFmpeg directo para el cuerpo del vídeo: Remotion es el motor;
  FFmpeg queda para utilidades (loudnorm, probes, extracción de frames).
- No añadir un segundo motor de render AL PIPELINE DE LA FÁBRICA: el cuerpo de
  vídeos, shorts y clips es solo Remotion (Player = render, mismo píxel).
  Excepción consciente y acotada (2026-08-12): el módulo `apps/editor` (reels
  desde A-roll propio) usa su propio motor Playwright+ffmpeg y NINGÚN píxel
  cruza de un motor al otro — ver docs/reels.md §motivo. Para la fábrica,
  HyperFrames y el catálogo del editor siguen siendo REFERENCIA VISUAL: se
  portan sus coreografías a Remotion, con su porqué, y se documenta qué se
  descarta. Ver docs/motion-graphics.md y docs/motion-graphics-vertical.md.
- No añadir un control para mover la ventana de un short. Es un asa de recorte
  (principio 1) y además rompe el invariante: la ventana cae en frontera de
  beat, que es lo que garantiza que el corte no parte una frase. El humano
  elige entre candidatos, descarta con motivo y pide otros. Ver docs/shorts.md.
- No reintroducir generación de imagen por IA (Flux/fal.ai, Google/Gemini, Imagen) en
  ninguna parte del pipeline. El avatar del canal se sube desde el dashboard. Los enums
  y etiquetas que aún dicen `flux` son legado: describen datos ya guardados y no se
  quitan, pero tampoco se usan.
