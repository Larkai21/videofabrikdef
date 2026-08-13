# @fabrica/mcp — servidor MCP de la fábrica

Servidor MCP por stdio que expone las puertas humanas de la fábrica de vídeo como
herramientas para un agente (Claude Code, Claude Desktop u otro cliente MCP).
No toca la base de datos: todas las herramientas hablan con la API HTTP de la
fábrica y devuelven JSON legible. Si la API no responde o un endpoint aún no
existe, la herramienta devuelve un aviso claro en vez de fallar.

## Puesta en marcha

1. Arranca la fábrica: `pnpm dev` (API en `http://localhost:3001`).
2. Copia `.mcp.json.example` de la raíz del repo a `.mcp.json` (Claude Code lo
   detecta al abrir el proyecto). Para otro host, ajusta `FABRICA_API_URL`.

Arranque manual (para depurar): `pnpm --filter @fabrica/mcp start`
(el protocolo va por stdout; los avisos, por stderr).

## Herramientas

| Herramienta | Argumentos | Qué hace |
| --- | --- | --- |
| `inbox_status` | — | Puertas pendientes, vídeos en curso, entregas y coste del mes |
| `list_ideas` | `channel?`, `status?` | Ranking de ideas con puntuación y fuentes (por defecto `new`) |
| `approve_idea` | `idea_id` | Aprueba la idea y arranca la producción del vídeo |
| `discard_idea` | `idea_id`, `reason?` | Descarta la idea con motivo opcional |
| `get_video` | `video_id` | Estado + resumen del maestro: títulos, guion, audio, beats por estado, coste |
| `choose_title` | `video_id`, `chosen_idx` | Elige uno de los tres títulos (0-2) |
| `approve_script` | `video_id` | Aprueba el guion y encola la síntesis de voz |
| `request_rewrite` | `video_id`, `reason` | Pide una reescritura del guion |
| `timeline_status` | `video_id` | Beats con tiempos, estado, origen del asset y puntuación |
| `approve_beat` | `video_id`, `idx` | Aprueba un beat (bloquea su mejor candidato) |
| `discard_beat` | `video_id`, `idx`, `reason` | Descarta el asset del beat y re-busca candidatos |
| `approve_timeline` | `video_id` | Aprueba la timeline completa y lanza ingesta + render |
| `retry_video` | `video_id` | Reintenta un vídeo en incidencia |
| `publish_video` | `video_id` | Aprueba la publicación en YouTube (subida en privado + programación) |
| `library_search` | `q`, `kind?` | Busca en la biblioteca local de assets |
| `production_costs` | `month?` | Agregado del ledger del mes en curso (vía `/inbox`) |
| `list_episode_clips` | `episode_id` | Clips del episodio con estado, ventana, gancho y confianza |
| `propose_episode_clips` | `episode_id` | Pide clips (episodio listo + encuadre elegido) |
| `approve_clip` | `clip_id` | Aprueba un clip propuesto y lo manda a render |
| `discard_clip` | `clip_id`, `reason` | Descarta con motivo (alimenta la siguiente propuesta) |
| `list_reels` | — | Reels del módulo editor con su estado |
| `get_reel` | `reel_id` | Detalle: guion congelado + plan COMPLETO de capas (el payload de `update_reel_plan`) |
| `create_reel` | `aroll_path`, `guion_json`, `channel_id`, `title?`, `formato?` | Alta con subida del A-roll local (multipart) |
| `update_reel_plan` | `reel_id`, `plan` | Reemplaza el plan entero (solo en `plan_listo`) |
| `approve_reel_render` | `reel_id` | Firma el plan y lanza el render del editor |
| `regenerate_reel_plan` | `reel_id` | Re-prepara el plan desde el guion (descarta ediciones) |
| `retry_reel` | `reel_id` | Reintenta un reel en incidencia |

Notas:
- `production_costs` solo cubre el mes en curso; los históricos necesitarán un
  endpoint propio del ledger.
- Los errores de la API (`{error, detail}`) se devuelven como texto claro con
  `isError`; un 404 de router se distingue de un 404 de negocio ("la API aún no
  expone ese endpoint" frente a "el vídeo no existe").

## Ejemplos de uso

Con el servidor conectado en Claude Code:

> «¿Qué hay pendiente en la fábrica?»
>
> El agente llama a `inbox_status`, ve una puerta de guion y responde con el
> vídeo, el paso y el coste del mes. Después: «elige el título 1 y aprueba el
> guion» → `choose_title {video_id, chosen_idx: 1}` + `approve_script {video_id}`.

> «Revisa la timeline del vídeo A9HH… y descarta lo que no encaje»
>
> El agente llama a `timeline_status`, detecta un beat con puntuación baja,
> ejecuta `discard_beat {video_id, idx: 3, reason: "plano genérico, pide algo de servidores"}`
> y cierra con `approve_timeline` cuando todos los beats quedan aprobados.

## Desarrollo

- `pnpm --filter @fabrica/mcp typecheck` — TypeScript estricto.
- `pnpm --filter @fabrica/mcp test` — unitarios de formateadores + integración
  con el client del SDK en memoria (los tests contra la API viva se saltan
  solos si no hay API escuchando).
- `pnpm --filter @fabrica/mcp exec tsx scripts/smoke.ts` — humo por stdio real:
  lanza el servidor como subproceso y ejercita `inbox_status`, `list_ideas`,
  `get_video` y `publish_video` por JSON-RPC.
