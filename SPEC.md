# SPEC — Fábrica de vídeo self-hosted (MVP: un canal)

Versión 1.0 · julio 2026 · Destilado de la conversación de diseño en claude.ai.
Este documento es la fuente de verdad de alcance y arquitectura. `CLAUDE.md` resume lo
operativo; aquí está el porqué y el detalle.

## 1. Objetivo

Producir vídeos long-form de YouTube (6–9 min) para canales sin rostro con un 75–85% de
automatización y 11–18 minutos de trabajo humano por vídeo, corriendo íntegramente en un
VPS propio (~8 vCPU / 16 GB). Coste variable objetivo por vídeo: < 0,50 $ en el stack MVP.
La supervisión humana es deliberada: la política de YouTube sobre contenido inauténtico
(jul-2025) desmonetiza lo plantillado; el contenido asistido por IA con aportación humana
genuina sigue siendo monetizable. Los puntos de intervención existen por eso.

## 2. Alcance del MVP

Dentro: un canal · wizard de perfil a partir de scraping previo · ideación continua por
RSS/scraping con scoring · guion JSON estructurado + paquete SEO · TTS con edge-tts
(word boundaries) · cascada de assets stock-first · timeline de revisión · brand kit por
zips validados · biblioteca local etiquetada · render Remotion SSR · salida MP4 +
metadatos + 2 miniaturas para subida manual.

Fuera (sprints futuros): subida por YouTube API (tras auditoría) · multicanal · servidor
MCP · niveles de autonomía A2/A3 · analytics y bucle de feedback · Shorts derivados ·
scheduler · MinIO · notificaciones push.

## 3. Módulos: motivo y funcionalidad

| Módulo | Por qué existe | Qué hace (MVP) |
|---|---|---|
| Perfil de canal (wizard) | Coherencia: que el vídeo 30 suene al vídeo 1 | Scraping previo de competencia, síntesis del avatar, patrones de título, `channel_profile.json` editable |
| Ideación (scraper) | Producir sobre demanda real sin gastar cuota | RSS de competidores y fuentes del nicho, dedupe por embeddings, scoring LLM, ranking |
| Generación (guion+SEO) | El guion decide retención y el título el CTR | Research pack, JSON de escenas con visual_query, 3 títulos, descripción, tags |
| Voz y subtítulos | Narración = retención; coste cero | edge-tts con word boundaries; ElevenLabs como flag por canal |
| Assets y timeline | El b-roll irrelevante es el mayor riesgo automatizado | Cascada biblioteca→stock→Flux, similitud por embeddings, triaje por confianza, timeline de revisión |
| Brand kit | Diferenciación visual sin diseñar cada vídeo | Prompts-contrato por componente, import de zips validados, versionado |
| Biblioteca local | Acumular valor: coste y tiempo bajan con cada vídeo | Carpeta en disco + índice etiquetado en Postgres, tier 0 de la cascada |
| Render | Fábrica determinista y reproducible | Remotion SSR en el VPS; preview exacta con @remotion/player |
| Salida | Sacar la API de YouTube del camino crítico | Carpeta con MP4, título, descripción, tags, miniaturas; checklist de subida manual |
| Núcleo (datos/colas) | Estado explícito, reanudable y auditable | Postgres con máquina de estados, BullMQ, ledger de costes, contratos Zod |

## 4. Estructura del repo

```
/apps
  /dashboard      Vite + React SPA (shadcn/ui, Tailwind, TanStack Query)
  /api            Fastify + Drizzle + Postgres
  /workers        BullMQ: sources, script, tts, assets, render
/packages
  /video          composiciones Remotion (player + SSR)
  /shared         esquemas Zod y tipos derivados
/library          componentes del brand kit + assets etiquetados (ver §11)
/outputs          entregables por vídeo
docker-compose.yml   postgres (pgvector), redis
```

## 5. Modelo de datos mínimo

- `channels(id, name, profile jsonb, settings jsonb)` — settings incluye flags:
  `packaging_first`, proveedor TTS, idioma.
- `sources(id, channel_id?, kind[rss|hn|reddit|news|web], url, config jsonb)`
- `ideas(id, channel_id, title, summary, score, status[new|approved|discarded|snoozed],
  source_refs jsonb, embedding vector)`
- `videos(id, channel_id, idea_id, state, title_chosen, seo jsonb, master_json jsonb,
  costs_total, timestamps)`
- `beats(id, video_id, idx, from_ms, to_ms, text, visual_query,
  status[auto_ok|review|locked], asset_id?)`
- `assets(id, scope[channel|shared], kind[clip|image|music|screenshot|upload], path,
  source[pexels|pixabay|flux|playwright|upload], license, duration_ms, width, height,
  tags text[], embedding vector, times_used, last_video_id?)`
- `components(id, channel_id, type, name, version, path, manifest jsonb,
  status[validated|failed])`
- `cost_ledger(id, video_id, provider, operation, units, unit_cost, cost)`

El estado de negocio vive aquí; BullMQ solo transporta trabajo.

## 6. Máquina de estados y puertas humanas

`idea → idea_aprobada → guion_borrador → guion_ok → audio → assets → timeline_ok → render → hecho`

Gates humanos del MVP (fijos): elegir idea (~1 min) · revisar guion y elegir título
(5–10 min) · curar timeline (3–5 min) · subida manual (~2 min). Cada aprobación es un
evento de API que transiciona el estado y encola los siguientes jobs. Fallos: reintento
con backoff; si persiste, estado `incidencia` visible en la bandeja con tarjeta de error
y acción sugerida (reintentar, regenerar, descartar). Nada se bloquea en silencio.

## 7. Wizard de canal (una vez, 1–2 h)

Entrada: nicho semilla + 5–10 canales competidores (o descubrimiento con unas pocas
llamadas `search.list` — 100 unidades cada una, aceptable solo en setup).
Scraping previo: feed RSS de cada competidor (sin cuota) + `videos.list` en lotes de 50
(1 unidad/lote) → títulos, duraciones, cadencia, vistas → patrones de título que
funcionan y huecos de contenido.
Salida: `channel_profile.json` — posicionamiento, espectador objetivo, tono, pilares de
contenido, guía visual, estilo de subtítulos, voz, patrones de título SEO. El humano lo
edita y aprueba. Se inyecta como contexto en todo lo generado después, y de él deriva el
DESIGN.md del brand kit.

## 8. Producción por vídeo

1. Ideación continua: workers de fuentes → dedupe por embeddings (pgvector) → scoring
   LLM (novedad × encaje con el perfil × saturación × valor publicitario) → ranking.
2. Research pack: fetch de 3–5 fuentes (trafilatura) → resumen con referencias.
3. Generación: guion JSON de escenas (gancho / desarrollo / CTA, `visual_query` por
   escena) + 3 variantes de título minadas de los patrones del nicho + descripción + tags.
4. Gate de guion — el título gobierna: el humano elige 1 título y edita el gancho.
   Un juez de alineación (LLM barato) compara la promesa del título elegido con el guion;
   solo si divergen lanza una pasada de refinamiento dirigida (gancho, payoff, cierre).
   Flag por canal `packaging_first`: elegir título y concepto de miniatura al aprobar la
   idea, antes de escribir el guion.
5. TTS: edge-tts (gratis; sus word boundaries dan subtítulos y el corte en beats de
   8–15 s). ElevenLabs (`with-timestamps`) como flag por canal.
6. Assets por beat: cascada biblioteca → Pexels/Pixabay (query desde `visual_query`,
   ranking por similitud embedding↔metadatos) → Flux Schnell (≤1 MP). Encaje calculado:
   recorte central si el clip sobra, loop si falta, Ken Burns si es imagen. Confianza
   alta → `auto_ok`; dudoso → `review`.
7. Timeline de revisión (§9). Al aprobar → render.
8. Render: Remotion SSR en contenedor propio, concurrencia 1–2; la composición consume
   el JSON maestro + componentes del brand kit referenciados por `id@versión`.
9. Salida: `outputs/<video>/` con MP4, title.txt, description.txt, tags.txt y 2
   miniaturas. Pantalla de entrega con botones de copiar y checklist de subida.

## 9. Timeline de revisión — reglas de UX

- Pista de clips con anchos proporcionales a la duración, pista de voz+subtítulos debajo,
  playhead sincronizado con @remotion/player: clic en un beat → el player salta ahí.
- Los tiempos son de SOLO lectura (los fija el audio). Acciones por beat: aprobar ·
  ver alternativas ya traídas por la API · buscar en stock con texto libre · subir un
  archivo propio (entra a la biblioteca y de ahí al hueco).
- Verde = auto-aprobado; ámbar = revisar. Teclado: `a` aprobar, `espacio` reproducir,
  flechas para moverse, `d` descartar con motivo (el motivo alimenta la regeneración).
- La home es una bandeja: qué te espera, estado de cada vídeo, coste acumulado discreto.
- Nunca JSON crudo; el guion se muestra renderizado como documento.

## 10. Brand kit — prompts-contrato y zips

Tipos de componente: intro, outro, title_card, lower_third, subtitle_theme, transition,
thumbnail_template. La herramienta genera por tipo un prompt-contrato con tres bloques:
tokens de marca (del perfil / DESIGN.md), interfaz exacta de props (Zod/TS) y
restricciones Remotion (animar solo con useCurrentFrame, sin aleatoriedad sin semilla,
sin fetch en render, fuentes empaquetadas, 1920×1080). El humano lo trabaja fuera
(Claude Design / Open Design + Claude Code) y sube un zip con formato fijo:
`manifest.json` (type, name, version) + `Component.tsx` + `schema.ts` + `assets/`.
Validación al subir: unzip en sandbox → typecheck contra el contrato → render de prueba
de 60 frames → preview en UI → activar. Registro versionado (`lower_third@1.2.0`); cada
vídeo guarda las versiones usadas para que un re-render antiguo salga idéntico.
Nota: código ejecutable propio en VPS propio es aceptable; el validador protege el
pipeline de componentes rotos, no es un sandbox de seguridad multiusuario.

## 11. Biblioteca local

En disco: `library/components/<canal>/<tipo>/<nombre>@<versión>/` y
`library/assets/<canal|shared>/{clips,images,music,screenshots,uploads}/`.
Índice en Postgres (tabla `assets`). Ingesta automática: el asset hereda la query que lo
encontró + caption con VLM barato → etiquetas + embedding. Procedencia y licencia se
guardan siempre. La biblioteca es el tier 0 de la cascada: el matcher busca aquí por
similitud semántica antes de salir a Pexels. Anti-repetición: no reutilizar el mismo
asset en los últimos N vídeos del canal (configurable). Para el canal de IA/tech, las
capturas y grabaciones de pantalla de las herramientas comentadas (via Playwright, el
mismo del scraper) son b-roll propio, gratuito y máximamente auténtico.

## 12. Proveedores, costes y límites (verificados jul-2026)

- Guion: GPT-5 Mini (~0,25 $/M entrada, 2 $/M salida) por defecto; escalón de calidad
  configurable por canal. Coste por guion despreciable (<0,01 $).
- TTS: edge-tts 0 $ (MVP). ElevenLabs Creator 22 $/mes ≈ 121k créditos; Flash consume
  0,5 créditos/carácter → ~30 vídeos largos/mes incluidos en el plan (sin variable).
- Stock: API de Pexels gratuita — 200 req/hora y 20.000/mes, ampliable gratis mostrando
  atribución; cachear búsquedas normalizadas (per_page hasta 80). Pixabay como segunda
  fuente.
- Imagen: Flux Schnell en Fal.ai a 0,003 $/megapíxel, facturado redondeando hacia
  arriba → generar a ≤1 MP (1280×720) y confiar en Ken Burns; 1080p nativo ≈ 0,009 $/img.
- Render: Remotion es gratuito para individuos y empresas de ≤3 personas, incluido uso
  comercial y renderizado server-side self-hosted. El plan Automators (0,01 $/render,
  mínimo 100 $/mes) solo aplica a empresas de 4+ o a producto vendido a terceros.
- YouTube Data API: `videos.insert` usa un bucket propio de subidas — 100 llamadas/día a
  1 unidad cada una (ya no 1.600 uds del pool general de 10k). Los proyectos no
  auditados suben los vídeos bloqueados en privado: solicitar la auditoría de la API en
  la semana 1. `status.containsSyntheticMedia` permite declarar contenido sintético.
  Los feeds RSS de canal (`youtube.com/feeds/videos.xml?channel_id=…`) permiten
  monitorizar competidores sin gastar cuota.
- Coste variable objetivo por vídeo de 8 min en el stack MVP: ≈ 0,05–0,35 $.

## 13. Canal 1 (el del MVP)

IA y tecnología aplicada. Formato de 6–9 min: «qué acaba de salir + qué puedes hacer tú
con ello», con mezcla 60% actualidad / 40% evergreen (explicadores de conceptos).
Fuentes: Hacker News (API Algolia), arXiv, GitHub trending, blogs de IA, Google News
RSS, RSS de competidores. Idioma inicial pendiente de decisión: inglés (mayor RPM) o
español (menor competencia); el pipeline soporta ambos.

## 14. Sprints propuestos

- S1 — vertical completo: esqueleto del monorepo + docker compose (postgres, redis) +
  wizard básico + pipeline de UN vídeo end-to-end con plantilla Remotion mínima y gates
  en UI simple. Hecho = un MP4 publicable producido de punta a punta con ≤20 min humanos.
- S2 — la herramienta de verdad: timeline de revisión con Player + brand kit por zips +
  biblioteca con etiquetado + juez de alineación de título. Hecho = 5 vídeos
  consecutivos sin tocar código.
- S3 — publicación y escala: subida por YouTube API (tras auditoría) + programación +
  segundo canal + primeras herramientas MCP. Hecho = subida automática en privado con
  aprobación desde la bandeja.

## 15. Decisiones descartadas (con motivo, para no reabrirlas)

- Fork de MoneyPrinterTurbo como base: el delta necesario es el 70–80% del sistema y su
  esqueleto (Python/Streamlit, single-run, MoviePy) estorba. Se usa como motor puente la
  primera semana y como cantera de soluciones (matching de material, subtítulos, TTS).
- AWS Lambda para render: el requisito es VPS propio; Remotion SSR local cumple.
- MoviePy/FFmpeg como motor principal: calidad de plantilla; FFmpeg queda de utilidad.
- Nuxt/Vue en el front: se perdería @remotion/player (preview en vivo, la mejor UX de
  los gates) y la fuente única de verdad de las composiciones.
- Claude Design / Open Design como motor de render: son herramientas de tiempo de
  diseño (artefactos por generación agéntica), no motores deterministas; sí se usan
  para diseñar los componentes del brand kit que Remotion ejecuta.

## 16. Documentos de detalle (docs/)

Antes de implementar un componente, lee su doc. No cargarlos todos por defecto: son
lectura bajo demanda.

- `docs/scraper.md` — motor de ideación: fuentes y endpoints exactos, cadencias,
  normalización, dedupe y scoring; incluye el modo bootstrap del wizard.
- `docs/generacion-guion.md` — research pack, prompts, paquete SEO y juez de alineación.
- `docs/voz-y-beats.md` — TTS por escena, word boundaries, subtítulos y algoritmo de beats.
- `docs/assets-y-biblioteca.md` — embeddings, cascada de matching, APIs de stock,
  umbrales, encaje (fit) e ingesta a biblioteca.
- `docs/edicion.md` — director de edición: intenciones declaradas por el guion,
  carriles y presupuesto de densidad, catálogo de micro-FX y catálogo de sonido.
- `docs/render.md` — Remotion SSR: bundling, registry del brand kit, ajustes, salidas.
- `docs/contratos.md` — esquemas versionados (perfil, JSON maestro, manifest) y API interna.
