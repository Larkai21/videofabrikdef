# Fábrica de vídeo

Herramienta self-hosted para producir vídeos de YouTube estilo faceless con
intervención humana mínima en tres puertas. La especificación completa está en
`SPEC.md`; los documentos de detalle por módulo, en `docs/`.

## Estructura

```
apps/dashboard    SPA Vite + React (bandeja, wizard, guion, timeline, entrega)
apps/api          Fastify + Drizzle; máquina de estados y rutas internas
apps/workers      BullMQ: fuentes, ideas, guion, tts, assets, render
packages/shared   Esquemas Zod (única fuente de tipos) y contratos
packages/db       Esquema Drizzle + cliente Postgres (compartido por api y workers)
packages/video    Composiciones Remotion (player en dashboard + render SSR)
library/          Brand kit y assets etiquetados (índice en Postgres)
outputs/          Entregables por vídeo (MP4 + metadatos + miniaturas)
```

`packages/db` existe porque los workers no importan de `apps/*` (regla del
proyecto) pero comparten el esquema de base de datos con la API.

## Puesta en marcha

```bash
cp .env.example .env        # rellena las claves que tengas; sin claves hay modo mock
docker compose up -d        # postgres (pgvector) + redis
pnpm install
pnpm db:migrate             # migraciones drizzle
pnpm db:seed                # canal de ejemplo y fuentes
pnpm dev                    # dashboard + api + workers
```

## Comandos

- `pnpm dev` — dashboard + api + workers en local
- `pnpm typecheck` / `pnpm lint` / `pnpm test`
- `docker compose up -d` — postgres, redis
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed`
- `pnpm render:smoke` — render de humo de 60 frames de la composición
