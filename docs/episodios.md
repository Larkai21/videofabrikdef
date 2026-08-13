# Clipping de episodios — de un podcast ajeno a clips verticales

Subsistema completo API + workers + UI. Construido después de SPEC.md; esta es
su documentación de módulo, con la misma vocación que `docs/shorts.md`: el
porqué de cada decisión, no solo el qué.

## El flujo, de URL a MP4

```
POST /episodios (URL de YouTube/Twitch + canal destino)
  → cola media/download   (yt-dlp → episode.mp4 + audio.wav; tope 4 h)
  → cola media/transcribe (STT por bloques de 10 min + silencios + beats)
  → estado `listo`        ← fin de la cadena automática
  → humano: elegir ENCUADRE (3 tiras reales; POST /episodios/:id/focus)
  → humano: proponer clips (POST /episodios/:id/clips)
  → cola highlights/propose (director LLM por bloques de beats + pre-corte
    ffmpeg a 1080×1920 con encuadre horneado → filas en `shorts` `propuesto`)
  → humano: aprobar/descartar en /episodios/:id/clips (pantalla EpisodioClips)
  → cola render/short (misma composición Remotion `ShortForm` que los shorts)
  → `hecho`: outputs/episodios/<episodeId>/shorts/<shortId>/ con vídeo, thumb,
    title/description/tags, SRT/VTT y master.json
```

Estados del episodio (`packages/shared/src/episode-states.ts`):
`nuevo → descargando → transcribiendo → listo → archivado` + `incidencia`
(recuperable al estado donde falló). Los clips son filas de `shorts` con
`episode_id` (XOR con `video_id`) y usan la máquina de shorts sin cambios.

## Reglas que no se negocian

- **Encuadre antes de proponer.** `POST /episodios/:id/clips` devuelve 409 sin
  `focus` elegido; el worker además levanta incidencia si le llega el caso. El
  encuadre queda CONGELADO en el maestro de cada clip al proponerse: re-elegir
  el foco después no re-encuadra clips ya propuestos.
- **Los descartados no cuentan como vivos.** Re-proponer (`force`) excluye las
  ventanas descartadas (con su motivo, la única señal humana que el director
  aprende) Y las vivas. Mismo criterio que la guarda de idempotencia del
  worker (`handleProposeHighlights`).
- **Atribución obligatoria.** `description.txt` de cada clip lleva el bloque
  «Clip del episodio … de …» con la URL original (`short.fuente` congelada en
  el maestro). La política de derechos vive en `episode-states.ts`
  (`ajeno_sin_acuerdo` por defecto, claims registrables, retirada si el
  creador lo pide; sin mecánicas anti-detección).

## Las puertas de la bandeja (fuera del raíl)

El raíl de la Bandeja cuenta VÍDEOS de la fábrica. El clipping no para ningún
vídeo, así que sus dos puertas van en la sección «Clips y reels», con ficha
ámbar (`data-estado="espera"`) y enlace directo a la pantalla de clips:

| kind | Cuándo se abre | Cómo se cierra |
|---|---|---|
| `episodio_listo` | episodio `listo` sin clips VIVOS (los descartados no cuentan) | proponer clips (o al insertarse los propuestos) |
| `clips_episodio` | ≥1 clip `propuesto` del episodio | aprobar o descartar el último propuesto |

Frescura por SSE: `inbox_changed` se publica al terminar descarga y
transcripción, al insertar clips, al agotar candidatos, al elegir encuadre
(`POST /focus`) y en approve/discard de clips de episodio (rutas de shorts).
El `refetchInterval` de 30 s de la Bandeja queda como red, no como mecanismo.

## Invalidaciones de eventos (dashboard)

- `short_state` con `episode_id` → `['episodio-clips', episode_id]` (la lista
  de la pantalla de clips) además de `['short', id]`.
- `short_state` a `incidencia`/`aprobado` → borra `shortProgress[short_id]`
  (el % de un render muerto no sobrevive al estado).
- `incident` con `episode_id` → `['episodios']` (las incidencias de episodio
  no emiten `episode_state`).
- `render_progress` de un clip llega solo con `short_id` — la barra del vídeo
  largo no se enciende.

## Dónde vive cada cosa

- API: `apps/api/src/routes/episodios.ts` (todas las rutas `/episodios*`).
- Workers: `apps/workers/src/pipelines/episodios/` (descarga, STT, beats,
  apretado, encuadre por plano vía `scripts/encuadre-clip.py`, director de
  highlights, pre-corte) y `render/short.ts` (render compartido).
- UI: `screens/Episodios.tsx` (alta, encuadre, enlace a clips),
  `screens/EpisodioClips.tsx` (aprobar/descartar/renombrar/publicar, preview
  con `@remotion/player` — la MISMA composición que el render).
- Layout del clip: `packages/video/src/short/ClipLayout.tsx` (calcado del
  canal de referencia; el pre-corte va al aspecto de la tarjeta, no a 9:16).

## Deuda declarada

- `archivado` existe en la máquina pero nada lo dispara todavía (la purga del
  mp4 grande está descrita, no implementada).
- El MCP expone las puertas con `episode_id` pero aún no tiene herramientas de
  proponer/aprobar clips (solo lectura vía inbox).
- La puerta `episodio_listo` no distingue en su enlace el sub-caso «falta
  encuadre» (el banner de la pantalla de clips lo reconduce a /episodios).
