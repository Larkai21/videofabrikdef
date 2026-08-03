# Fábrica de vídeo — contexto del proyecto

Herramienta self-hosted (VPS propio, Docker Compose) para producir vídeos de YouTube
semi-automatizados estilo "faceless". MVP: un solo canal (IA/tecnología), de la idea al
MP4 con metadatos, con intervención humana mínima y localizada en tres puertas.
La especificación completa está en `SPEC.md` (raíz del repo): léela entera antes de
diseñar módulos nuevos o tomar decisiones de arquitectura.

## Stack (decidido — no reabrir sin preguntar)
- Monorepo pnpm + Turborepo, TypeScript estricto, ESM.
- `apps/dashboard`: Vite + React SPA (sin SSR), shadcn/ui, Tailwind, TanStack Query.
- `apps/api`: Fastify + Drizzle ORM + PostgreSQL (con pgvector).
- `apps/workers`: BullMQ sobre Redis; jobs idempotentes y reanudables.
- `packages/video`: composiciones Remotion, compartidas entre @remotion/player
  (preview en dashboard) y render SSR (worker). React es obligatorio en el front por esto.
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
- `pnpm calidad <videoId>` — informe de calidad + hoja de contactos
- `pnpm guion …` — banco de guiones (iterar el prompt sin cola); ver docs/calidad.md
- `pnpm probar:voz <videoId> --voz <id>` — mide wpm real y alineación de una voz TTS
- `pnpm reescala:biblioteca [--dry]` — normaliza a 1080p los clips grandes ya ingeridos
- `pnpm sfx` — regenera los 14 .wav sintetizados

## No hacer
- No añadir edición de vídeo (trims, timeline arrastrable, capas).
- No llamar todavía a la YouTube Data API desde el pipeline.
- No introducir Next.js/SSR ni cambiar el stack del front.
- No usar MoviePy ni FFmpeg directo para el cuerpo del vídeo: Remotion es el motor;
  FFmpeg queda para utilidades (loudnorm, probes, extracción de frames).
- No reintroducir generación de imagen por IA (Flux/fal.ai, Google/Gemini, Imagen) en
  ninguna parte del pipeline. El avatar del canal se sube desde el dashboard. Los enums
  y etiquetas que aún dicen `flux` son legado: describen datos ya guardados y no se
  quitan, pero tampoco se usan.
