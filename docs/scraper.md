# Scraper — motor de investigación e ideación

Componente: `apps/workers` (colas `sources:*` e `ideas:*`). Dos modos: bootstrap (wizard,
una vez por canal) y continuo (alimenta el ranking de ideas). Principio rector: primero
lo gratuito y sin cuota (RSS, APIs públicas), Playwright solo donde no hay alternativa.

## 1. Modo bootstrap (wizard)

Objetivo: convertir "nicho semilla + lista de competidores" en datos para sintetizar el
`channel_profile.json`.

1. Resolución de canales. El usuario pega URLs (`/@handle`, `/channel/UC…`).
   - `/channel/UC…` → id directo.
   - `/@handle` → `GET youtube/v3/channels?part=id,snippet,statistics&forHandle=<handle>`
     (1 unidad). Guarda `channel_id`, subs, total de vídeos.
2. Descubrimiento opcional (si el usuario no aporta competidores):
   `GET youtube/v3/search?part=snippet&type=channel&q=<nicho>` — 100 unidades por
   llamada. Máximo 5 llamadas, SOLO en bootstrap.
3. Histórico de vídeos por competidor (el RSS solo trae ~15):
   - uploads playlist = `channel_id` con prefijo `UU` en vez de `UC`.
   - `GET playlistItems?part=contentDetails&playlistId=UU…&maxResults=50` (1 ud/página,
     1–2 páginas) → videoIds.
   - `GET videos?part=snippet,contentDetails,statistics&id=<50 ids>` (1 ud/lote).
   Coste típico: 3–5 unidades por competidor. 10 competidores ≈ 50 uds.
4. Derivados calculados (se guardan en `channels.profile_inputs`):
   - Cadencia (vídeos/semana), distribución de duraciones, mediana de vistas.
   - Outliers: `views / mediana_del_canal` ≥ 3 → vídeo outlier.
   - Patrones de título: los títulos del cuartil superior pasan por un LLM que extrae
     plantillas con huecos («Por qué {X} está {verbo}», «{N} {cosas} que {beneficio}»)
     con 2 ejemplos cada una.
   - Huecos: temas frecuentes en fuentes del nicho (paso 2 del modo continuo, ejecutado
     una vez) que NO aparecen en los últimos 90 días de los competidores.

## 2. Modo continuo — catálogo de fuentes

Cada fuente es una fila en `sources` con `kind`, `config` y cadencia. Todas normalizan a
`raw_items` (§3). Cadencias por defecto (ajustables):

| Fuente | Endpoint / método | Auth | Cadencia | Señales |
|---|---|---|---|---|
| Competidores YT | `https://www.youtube.com/feeds/videos.xml?channel_id=UC…` | no | 2 h | título, fecha, vistas del feed |
| Refresh vistas YT | `videos?part=statistics&id=<lotes de 50>` (1 ud/lote) | API key | 24 h | vistas exactas → velocidad |
| Hacker News | `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points>50` y `search?tags=front_page` | no | 45 min | points, num_comments |
| Reddit | OAuth app tipo script; `GET /r/<sub>/top?t=day&limit=50` por subreddit del perfil | OAuth | 2 h | score, upvote_ratio, comments |
| arXiv | `http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG&sortBy=submittedDate&max_results=100` | no | 12 h (respetar ≥3 s entre req) | novedad, autores |
| GitHub trending | Playwright sobre `github.com/trending?since=daily` (+ por lenguaje) | no | 24 h | stars_today |
| Google News RSS | `https://news.google.com/rss/search?q=<query>&hl=<es\|en>&gl=<ES\|US>&ceid=…` una query por pilar del perfil | no | 2 h | recencia, medio |
| Blogs del nicho | RSS/Atom (lista en `sources`) | no | 3 h | recencia |
| Webs sin feed | Playwright + trafilatura, solo lista blanca en `sources` | no | 6–24 h | recencia |

Notas de implementación:
- Monitorización de competidores SIN cuota: el feed RSS de YouTube incluye el contador
  de vistas por vídeo; guardando snapshots por poll se calcula la velocidad
  (Δvistas/Δt) y el score de outlier contra la línea base del canal. El refresh diario
  por API solo afina cifras.
- Reddit: registrar app propia; incluir User-Agent identificable; verificar los límites
  vigentes del plan gratuito al crearla y encolar con rate limiter.
- Playwright: contenedor propio con Chromium; respeta robots.txt; concurrencia 1–2;
  delay 2–5 s por dominio; User-Agent identificable con URL de contacto; caché HTTP por
  ETag/Last-Modified. Nunca login ni muros de pago.
- Extracción de artículo (para research pack y para webs sin feed): trafilatura (sidecar
  Python CLI) con readability como fallback.
- Presupuesto de cuota YT en continuo: < 100 unidades/día.

## 3. Normalización y deduplicación

Todo item entra como:
```
raw_items(id, source_id, url_canonica, title, excerpt, published_at,
          metrics jsonb, lang, hash, embedding vector(384), fetched_at)
```
- URL canónica: sin utm/fragmentos; hash = sha256(url_canonica) para dedupe exacto.
- Embedding: modelo local (ver docs/assets-y-biblioteca.md §1 — el MISMO modelo en todo
  el sistema) sobre `title + excerpt`.
- Dedupe semántico: dentro de una ventana de 14 días, cos ≥ 0,90 → mismo `cluster_id`
  (una "historia"); las señales de los miembros se agregan al cluster.

## 4. Scoring y creación de ideas

Job `ideas:score` cada 2 h sobre clusters activos. Puntuación 0–100 con pesos en
`channels.settings.scoring`:

- señal externa (30): points/score/velocidad normalizados por fuente (z-score dentro de
  la fuente, no valores absolutos).
- encaje (25): cos(embedding del cluster, embeddings de los pilares del perfil).
- frescura (15): decay exponencial, τ por canal (canal de actualidad: 48 h).
- saturación (20, en negativo): similitud contra títulos publicados por competidores en
  los últimos 21 días — muy cubierto penaliza; hueco con demanda bonifica.
- valor comercial (10): match con la lista de temas de alto CPM del perfil.

Los clusters con score ≥ umbral (default 55) pasan por un LLM barato que redacta la
"idea": ángulo propuesto, título provisional, por qué ahora (2 líneas) y las 3–5 fuentes
del cluster. Inserta en `ideas` (status `new`). El humano ve el ranking; `approved`
dispara la producción; `discarded` guarda motivo opcional (realimenta pesos en futuro,
post-MVP).

## 5. Salud y fallos

- Cada fuente lleva `consecutive_failures`; ≥ 5 → `unhealthy` (se muestra en UI, se
  sigue sin ella). Reintentos con backoff exponencial + jitter.
- Todo fetch registra bytes y duración; nada de crawling recursivo: solo URLs de la
  lista y los artículos enlazados por un item ya capturado (profundidad 1).
- Logs por item con `source_id` para depurar por qué entró o no entró una idea.
