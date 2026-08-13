# Contratos — esquemas versionados y API interna

Fuente de verdad en código: `packages/shared` (Zod). Este doc fija los campos para que
todos los módulos y la UI hablen lo mismo. Versionado semver por esquema; cambio
incompatible = major + migración.

## 1. ChannelProfile v1

```
{
  version: "1",
  identity: { name, positioning, audience, tone: string[] },
  language: "es" | "en",
  pillars: [{ name, description, example_queries: string[] }],
  style: {
    visual_prompt_suffix: string,      // sufijo de estilo para prompts de imagen
    stock_query_lang: "en" | "es",
    banned: string[]                   // temas/palabras prohibidos
  },
  voice: { provider: "edge" | "elevenlabs", voice_id, rate },
  title_patterns: [{ template, example, source: "mined" | "manual" }],
  high_cpm_topics: string[],
  flags: { packaging_first: boolean, ai_disclosure: boolean }
}
```

Adenda (jul–ago 2026) a los contratos de abajo, que conservan la forma de S1:

- `identity.tagline` (≤48 chars): la segunda línea de la cabecera del canal
  («Noticias de tecnología e IA»). Viaja perfil → `master.brand.tagline` →
  intro/outro. El nombre solo no es la identidad.
- `settings.avatar_en_video` (default false): si el avatar del canal entra en
  intro/outro. Apagado, la intro se monta como la cabecera de YouTube
  (entramado + logotipo), que tampoco lleva el avatar dentro.
- `master.edits[]`: la línea de edición (14 tipos en `EDIT_TYPES`, unión
  discriminada `editSchema`, clasificación de render en `EDIT_RENDER_KIND`).
  Las escenas llevan `edit_intents[]` (declaración del guionista) y el maestro
  `scene_spans[]` (índice escena→audio para anclar disparadores).
- Lectura tolerante: `editsFieldSchema` descarta el edit que no valida — un
  maestro nuevo leído por código viejo pierde ese edit en silencio.

## 2. MasterVideoJson v1 (el JSON maestro)

```
{
  version: "1",
  video: { id, channel_id, idea_id, fps: 30, width: 1920, height: 1080 },
  research: { sources[], summary, claims: [{text, source_idx}], angles[] },
  script: { scenes: [{id, section: "hook"|"body"|"cta", text, visual_query,
                      emphasis?, edited_by_human?}], hook_notes },
  seo: { titles: [string, string, string], chosen_idx, description, tags[],
         thumbnails: [{text, visual}] },
  audio: { path, duration_ms, lufs },
  cues: [{ from_ms, to_ms, text, words: [{from_ms, to_ms, w}] }],
  beats: [{ idx, from_ms, to_ms, text, visual_query,
            status: "pending"|"auto_ok"|"review"|"locked",
            asset?: { id, fit: {mode: "trim"|"loop"|"kenburns",
                                offset_ms?, loops?}, effect? },
            candidates?: [{ ref, provider, score, thumb_url }] }],
  brand: { components: { intro?, outro?, title_card?, lower_third?,
                         subtitle_theme, transition?, thumbnail_template } },
                         // valores "tipo@versión" resueltos por el registry
  costs: { total_usd, by_provider: {..} }
}
```

Reglas: `beats[].from_ms/to_ms` son la ley temporal (nadie los edita salvo el worker de
voz). `candidates` se vacía al aprobar la timeline (quedan solo los elegidos).

## 3. ComponentManifest v1 (brand kit)

```
{
  version: "1",
  type: "intro"|"outro"|"title_card"|"lower_third"|"subtitle_theme"|
        "transition"|"thumbnail_template",
  name, component_version: semver,
  props_schema: "./schema.ts",       // export default z.object(...)
  fixed_duration_frames?: number,    // intro/outro/transition
  assets: string[]                   // rutas relativas dentro del zip
}
```

Contratos de props mínimos por tipo (los genera el prompt-contrato): `subtitle_theme`
recibe `{cues, currentMs, safeArea}`; `lower_third` `{title, subtitle?, fromFrame}`;
`thumbnail_template` `{text, image_path, variant}`; intro/outro `{channel_name, logo?}`.

## 4. API interna (Fastify) — recursos del MVP

```
POST /channels/wizard            body {niche, competitors[]} → perfil borrador
PUT  /channels/:id/profile       aprobar/editar perfil
GET  /inbox                      qué espera al humano + estados en curso (SSE hermano: /events)
GET  /ideas?status=new           ranking
POST /ideas/:id/approve|discard  (discard admite {reason})
GET  /videos/:id                 maestro renderizable para UI y Player
PUT  /videos/:id/script          edición de escenas (marca edited_by_human)
POST /videos/:id/title           {chosen_idx} → dispara juez de alineación
GET  /videos/:id/timeline        beats + candidatos
POST /videos/:id/beats/:idx      {action: approve|choose|discard, ref?, reason?}
GET  /stock/search?q=&beat=      búsqueda libre para la timeline (usa stock_cache)
POST /library/upload             multipart → ingesta (kind=upload)
POST /components                 multipart zip → validación (respuesta con log/preview)
POST /videos/:id/approve-timeline → encola render
GET  /events                     SSE: progreso de jobs y render
```

Construido después del MVP (mismas convenciones): `/videos/:id/shorts` y
`/shorts/:id/*` (docs/shorts.md), `/episodios*` (docs/episodios.md) y
`/reels*` (docs/reels.md) — DTOs en `packages/shared/src/api.ts`, como todo.

Convención: toda transición de estado pasa por la API (nunca un worker "decide" un gate);
la API valida el estado origen antes de transicionar (máquina de estados en un solo sitio).

## 5. Ledger de costes — unidades por proveedor

| provider       | operation           | units                                   |
| -------------- | ------------------- | --------------------------------------- |
| openai         | script/judge/refine | tokens in+out                           |
| openai         | vlm_caption         | imágenes                                |
| edge-tts       | tts                 | caracteres (coste 0, se registra igual) |
| elevenlabs     | tts                 | caracteres                              |
| pexels/pixabay | search              | requests (coste 0; vigila límites)      |
| fal            | flux_schnell        | megapíxeles                             | (histórico: proveedor retirado en jul-2026) |
| youtube        | api                 | unidades de cuota (bootstrap/refresh)   |

Regla: el worker escribe la fila ANTES de la llamada (estado pending) y la completa con
la respuesta; así una caída a mitad no pierde el gasto.
