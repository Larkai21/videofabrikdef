# Fábrica de vídeo

Herramienta self-hosted que produce vídeos de YouTube estilo *faceless* con
intervención humana mínima y localizada: la máquina investiga, escribe, locuta,
busca los planos y renderiza; el humano firma en tres puertas. Además de los
vídeos largos produce **shorts** derivados, **clips de episodios ajenos**
(podcasts, entrevistas) y **reels** editados sobre grabación propia a cámara.

La especificación completa está en `SPEC.md`; el detalle por módulo, en `docs/`.
Las reglas de trabajo del repo, en `CLAUDE.md`.

## Estado hoy (15-ago-2026)

Produce de verdad: **7 vídeos largos completos** en `outputs/` (MP4 + título,
descripción y tags listos para pegar + dos miniaturas + informe de calidad),
más **10 shorts** derivados y **7 clips** de tres episodios externos.

- **Funciona end-to-end**: idea → guion → voz → planos → render → entregables.
- **La publicación en YouTube está construida pero apagada**: necesita
  credenciales OAuth propias (`PUBLISH_PROVIDER=mock` por defecto). El MVP
  entrega MP4 + metadatos para subida manual, con checklist en la pantalla de
  entrega.
- **Música de fondo**: la maquinaria está (mezcla con ducking, anti-repetición
  de pista, registro de licencia), pero la biblioteca tiene **cero pistas**, así
  que el toggle no tiene efecto hasta subir 15-20 pistas con licencia limpia.
- **En curso** (`docs/plan-variedad-matching.md`): más variedad de material y
  mejor emparejamiento plano↔narración. Hechos los sprints de medición,
  variedad barata (segunda consulta por plano, NASA como red de dominio
  público, cosecha de subcampeones, cobertura tipográfica cuando ningún plano
  vale), licencias con atribución y cosecha semanal de biblioteca. Pendiente el
  salto grande: emparejamiento por embedding **visual** (hoy es texto contra
  texto y la señal no separa; quien sostiene la calidad es un juez LLM que lee
  los pies de foto).

## Cómo funciona

### El raíl del vídeo largo

Cadena de colas BullMQ sobre Redis. Todo el estado de negocio vive en Postgres
como máquina de estados explícita; la cola solo transporta trabajo y cada job es
idempotente y reanudable. Los workers **piden** transiciones, nunca las deciden.

```
sources.poll → ideas.score → [PUERTA 1] → script.generate → judge → refine
   → [PUERTA 2] → tts.synthesize → assets.match → [PUERTA 3] → assets.ingest
   → render.video → entregables (→ publish.upload, opcional)
```

Estados del vídeo: `idea → idea_aprobada → guion_borrador → guion_ok → audio →
assets → timeline_ok → render → hecho`, más `incidencia`, que recuerda el estado
previo para poder reintentar el job exacto.

1. **Radar (`sources`)** — un scheduler por fuente (Hacker News, arXiv, RSS,
   Google News, YouTube; todo feeds públicos, sin API keys) trae material, lo
   deduplica por hash y lo agrupa por similitud con pgvector.
2. **Ideas (`ideas`)** — el LLM puntúa cada tema contra los pilares del canal.
   El humano manda: puede reordenar el ranking a mano.
3. **Guion (`script`)** — investiga las fuentes reales de la idea (descarga y
   extrae el texto), escribe escenas + paquete SEO, y un juez propio (linter
   determinista + LLM) puede devolverlo a refinar hasta dos veces.
4. **Voz (`tts`)** — sintetiza por frase, normaliza a −16 LUFS y mezcla música
   opcional. De los tiempos de palabra salen los subtítulos y los **beats** de
   8-15 s, que son la ley temporal del vídeo.
5. **Planos (`assets`)** — cascada **biblioteca local → stock (Pexels/Pixabay) →
   red de dominio público (NASA, Wikimedia Commons)**, nunca al revés y sin
   imágenes generadas por IA. Un director LLM escribe la consulta visual de cada
   beat y un juez LLM lee los pies de foto y reordena o veta.
6. **Render (`render`)** — Remotion en SSR sobre el JSON maestro. El mismo
   componente pinta el vídeo largo y el vertical; lo que se ve en el reproductor
   del dashboard es exactamente lo que se renderiza.
7. **Entrega** — `outputs/<id>/` con `video.mp4`, `title.txt`,
   `description.txt` (con capítulos reales y atribuciones), `tags.txt`,
   subtítulos SRT/VTT, miniaturas e informe de calidad.

### Las tres puertas humanas

| Puerta | Qué se decide | Dónde |
| --- | --- | --- |
| **1 · Elegir** | Una idea del ranking | `/ideas` |
| **2 · Aprobar** | El guion y el título (1 de 3) | `/videos/:id/guion` |
| **3 · Curar** | Beat a beat: aprobar, elegir otro plano o descartar con motivo | `/videos/:id/timeline` |

La timeline es de **revisión, no de edición**: los cortes los fija el audio y no
hay asas de recorte. El humano cambia el contenido de los huecos, nunca sus
límites. Los beats que la máquina resolvió en verde cruzan solos.

### Los otros tres productos

- **Shorts** (`/videos/:id/shorts`) — el sistema propone fragmentos verticales
  del vídeo largo que funcionan solos; tú eliges cuáles se renderizan.
- **Clips de episodios** (`/episodios`) — pegas una URL de YouTube/Twitch, se
  descarga con `yt-dlp` y se transcribe por bloques; eliges el encuadre 9:16 y
  un director LLM propone ventanas con gancho (o pides una ventana exacta a
  mano). Salen con la atribución al episodio original en la descripción.
- **Reels** (`/reels`) — tu grabación a cámara + un guion de dirección se
  convierten en un vertical editado (subtítulos cinéticos, tarjetas, micro-FX).
  Motor propio en `apps/editor` (Python + Playwright + ffmpeg): **dos motores,
  cero mezcla** — ni un píxel cruza entre él y Remotion. Una sola puerta: firmar
  el plan de capas.

### Servidor MCP

`apps/mcp` expone 28 herramientas por stdio para que un agente opere **sobre**
las puertas humanas (nunca por debajo): pasa por los mismos endpoints que el
dashboard. Se arranca aparte con `pnpm --filter @fabrica/mcp start`.

## Estructura

```
apps/dashboard    SPA Vite + React (16 pantallas: bandeja, guion, timeline, entrega…)
apps/api          Fastify + Drizzle; máquina de estados, rutas internas y SSE
apps/workers      BullMQ: sources, ideas, script, tts, assets, render, publish,
                  library, shorts, media, highlights, edit
apps/mcp          Servidor MCP (28 herramientas) contra la API local
apps/editor       Motor de reels (Python + Playwright + ffmpeg); arnés propio
packages/shared   Esquemas Zod: única fuente de tipos y contratos
packages/db       Esquema Drizzle + cliente Postgres (compartido por api y workers)
packages/video    Composiciones Remotion (player del dashboard + render SSR)
library/          Brand kit y assets etiquetados (índice en Postgres)
outputs/          Entregables por vídeo (MP4 + metadatos + miniaturas + calidad)
calibracion/      Bancos etiquetados y baselines de calidad
```

`packages/db` existe porque los workers no importan de `apps/*` (regla del
proyecto) pero comparten el esquema de base de datos con la API.

## Puesta en marcha

**Requisitos**: Node ≥ 22, pnpm 10, Docker (compose), `ffmpeg` en el PATH.
Opcionales según lo que uses: `yt-dlp` (clips de episodios), Python 3.12 con
`mlx-whisper` (transcripción local gratis en Apple Silicon).

```bash
cp .env.example .env        # sin claves, todo el pipeline corre en modo mock
docker compose up -d        # postgres (pgvector) en 55432 + redis en 56379
pnpm install
pnpm db:migrate             # migraciones drizzle
pnpm db:seed                # canal de ejemplo y fuentes
pnpm dev                    # dashboard :5173 + api :3001 + workers
```

Abre <http://localhost:5173>. El dashboard exige el puerto 5173 exacto (si está
ocupado no arranca: es deliberado, porque el CORS de la API solo admite ese
origen y el fallo sería silencioso). El render necesita la API en marcha:
resuelve los assets contra `http://127.0.0.1:3001/files`.

### Claves (todas opcionales, salvo una)

| Variable | Para qué | Sin ella |
| --- | --- | --- |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Guion, scoring, jueces, captions | `LLM_PROVIDER=mock`: respuestas deterministas |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY` | Stock de vídeo e imagen | **El matching falla** con incidencia (válvula de desarrollo: `STOCK_SIN_CLAVES=1`) |
| `ELEVENLABS_API_KEY` | Voz de pago (flag por canal) | Degrada a edge-tts, gratis |
| `YT_OAUTH_CLIENT_ID` / `_SECRET` | Subida a YouTube | `PUBLISH_PROVIDER=mock`: se simula |

`EMBEDDINGS_PROVIDER=fastembed` usa un modelo multilingüe local (coste 0) y es
lo que hace útil la búsqueda en biblioteca; `hash` es solo un mock determinista.
`STT_PROVIDER=mlx` transcribe episodios en local gratis (Apple Silicon);
`whisper` usa la API de OpenAI a 0,006 $/min.

### El módulo de reels, aparte

`apps/editor` no entra en `pnpm dev` ni en turbo, y tiene requisitos propios que
**el resto de la fábrica no hereda**: macOS Apple Silicon, Python 3.12 exacto y
Chromium de Playwright.

```bash
cd apps/editor
python3.12 -m venv .venv && .venv/bin/pip install -e . -r requirements.txt
pnpm install                # postinstall trae Playwright + Chromium
make rapido                 # ~850 tests en menos de 2 s
```

## Comandos

**Desarrollo**

- `pnpm dev` — dashboard + api + workers
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — ~900 tests en 7 paquetes
- `pnpm compose:up` / `pnpm compose:down` — postgres y redis
- `pnpm db:generate` / `db:migrate` / `db:seed`

**Calidad y bancos** (el repo se juzga mirando: casi todo saca imágenes)

- `pnpm calidad <videoId>` — informe + hoja de contactos HTML con fotogramas de
  cada plano y efecto; audita también los shorts del vídeo
- `pnpm variedad` — repetición de planos **entre** vídeos (lo que `calidad` no
  ve) y baseline en `calibracion/variedad-baseline.json`
- `pnpm rerank` — banco del emparejamiento de planos sobre beats etiquetados
- `pnpm encuadre` — banco del encuadre 9:16
- `pnpm guion` — itera el prompt del guion sin tocar la cola
- `pnpm probar:voz <videoId> --voz <id>` — mide velocidad y alineación de una voz
- `pnpm probar:stt -- <url|fichero>` — banco de transcripción del clipping
- `pnpm render:smoke` — render de humo de 60 frames
- `pnpm previews:kit` — re-siembra las previews del brand kit
- `pnpm metricas <csv>` — importa el CSV de YouTube Studio

Protocolo: **antes de tocar una señal, mídela con su banco; después, otra vez**
(`docs/calidad.md` §6).

## Principios que no se negocian

1. La timeline es de revisión, no de edición: los tiempos los fija el audio.
2. El humano selecciona y aprueba; nunca ve JSON crudo.
3. El estado vive en Postgres como máquina de estados; la cola solo transporta.
4. Ledger de costes: cada llamada externa queda registrada por vídeo.
5. Cascada de assets biblioteca → stock, sin invertir y sin imágenes generadas
   por IA en el cuerpo del vídeo.
6. Determinismo de render: sin aleatoriedad sin semilla, sin fetch durante el
   render, fuentes empaquetadas.
7. Interfaz en español, sentence case, sin exclamaciones.
