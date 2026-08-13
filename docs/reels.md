# Reels — el módulo editor dentro de la fábrica

A-roll PROPIO (tú a cámara) + guion de dirección JSON → vertical editado:
subtítulos cinéticos, tarjetas, micro-FX y composición, con una sola puerta
humana (aprobar el plan). El motor es el del proyecto editor-youtube,
integrado como `apps/editor`.

## Motivo (y el porqué de la excepción de motor)

La fábrica produce vídeo faceless: TTS + assets + Remotion, y su regla «un
solo motor de render» existe para que el Player del dashboard y el render SSR
sean EL MISMO píxel. Los reels son otro producto con otro material: cámara
propia, edición sobre lo grabado, catálogo de 182 plantillas HTML+GSAP ya
construido y probado (830 tests) en editor-youtube. Portar 182 plantillas a
Remotion costaría meses y no compraría nada: aquí no hay preview de Remotion
que deba coincidir con nada.

Decisión (2026-08-12, explícita del propietario): **dos motores, cero mezcla**.
- Remotion sigue siendo el ÚNICO motor del cuerpo de vídeos, shorts y clips.
- El módulo editor rasteriza sus reels con Playwright y compone con ffmpeg,
  y NINGÚN píxel cruza de un motor al otro.
- La doctrina previa («editor-youtube es catálogo de referencia visual; sus
  coreografías se portan a Remotion», ver `docs/motion-graphics.md`) SIGUE
  VIVA para el pipeline de la fábrica: portar coreografías al catálogo de
  `packages/video` sigue siendo el camino para largo/shorts/clips.

## El flujo

```
POST /reels (multipart: A-roll + guion JSON + canal)   → fila `reels`, estado `nuevo`
  → cola edit/prepare (concurrency 1):
      transcribe_mlx → clean_transcript → detect_face_bbox
      → leer_guion --escribir (cruce guion↔grabación; aborta si <25 % literal)
      → silencios --aplicar (apretado; remapea plan+timeline JUNTOS)
      → validar_plan (puerta barata)
      → plan a la fila (BD = fuente de verdad) → `plan_listo`
  → PUERTA: /reels/:id — el plan como documento, capa a capa
      (entra en / dura / plantilla; editar t·duración·quitar capa; regenerar)
  → POST /reels/:id/render (firma) → cola edit/render:
      plan BD → build/plan.json (se renderiza EXACTAMENTE lo firmado)
      → render_playwright (frames por capa, alfa) → colocar --aplicar
      → composite_ffmpeg --output outputs/reels/<id>/final.mp4 → portada.py
  → `hecho`: final.mp4 + portada.jpg servidos por /files
```

Estados (`packages/shared/src/reel-states.ts`):
`nuevo → preparando → plan_listo → render → hecho` + `incidencia`;
`plan_listo → preparando` permite regenerar el plan desde el guion congelado.

## Contratos

- Cola `edit`, jobs `prepare`/`render` (`packages/shared/src/queues.ts`),
  concurrency 1: el editor abre SU propio Chromium (no el de Remotion) y una
  composición ffmpeg pesada.
- Tabla `reels` (`packages/db/src/schema.ts`): guion jsonb congelado al alta,
  plan jsonb editable SOLO en `plan_listo` (`PATCH /reels/:id/plan`, 409 en
  cualquier otro estado). El worker de render vuelca el plan de la BD al
  build ANTES de rasterizar: lo renderizado es lo firmado.
- Storage: `library/reels/<id>/{input.*, guion.json, build/}` y
  `outputs/reels/<id>/{final.mp4, portada.jpg}`.
- Eventos: `reel_state {reel_id, state}` → el dashboard invalida el prefijo
  `['reels']`; `inbox_changed` al abrir/cerrar la puerta.
- Puerta de bandeja `reel_plan` (sección «Clips y reels», ficha ámbar,
  enlace a /reels/:id).

## Cómo lo invoca el worker

`apps/workers/src/pipelines/reels/index.ts` NO importa nada del editor: lanza
sus scripts como procesos (execa) con `cwd=apps/editor` y
`EDITOR_BUILD=library/reels/<id>/build` — el mismo mecanismo de builds
aislados que `piezas.py` usa para montar 10 vídeos en paralelo. La regla «los
workers no importan de apps/*» se mantiene: esto es un sidecar, como
`transcribe-mlx.py`.

Variables: `EDITOR_DIR` (default `apps/editor` relativo al worker),
`EDITOR_PYTHON` (default `apps/editor/.venv/bin/python3`), `REEL_LUT`
(default `none`; el LUT es explícito por diseño del editor — sin él no hay
grado).

## Puesta en marcha del módulo

```bash
cd apps/editor
python3.12 -m venv .venv && .venv/bin/pip install -e . -r requirements.txt
pnpm install          # playwright + chromium (postinstall)
make rapido           # el arnés propio del módulo: lint + ~850 tests
```

Requisitos duros del módulo: macOS Apple Silicon (mlx-whisper sobre Metal,
Vision para el rostro), Python 3.12, ffmpeg (env > PATH > Homebrew tras la
Fase 1 de empaquetado). El resto de la fábrica no los hereda: si el worker de
`edit` no puede correr, las demás colas ni se enteran.

## UI

- `/reels` (`screens/Reels.tsx`): alta (canal + título + A-roll + guion JSON
  con validación de forma) y lista con estados.
- `/reels/:id` (`screens/ReelDetalle.tsx`): LA puerta. El plan como documento
  (principio 2: nada de JSON crudo): una fila por capa con cuándo entra,
  cuánto dura y qué plantilla; editar t/duración, quitar capa, guardar,
  regenerar desde el guion, y «Aprobar y renderizar» (deshabilitado con
  borrador sin guardar: se firma lo que hay en la fila). En `hecho`, el MP4 y
  su portada.

## El agente como director (MCP)

El servidor MCP de la fábrica (`apps/mcp`) expone 7 herramientas de reels:
`list_reels`, `get_reel`, `create_reel` (sube el A-roll local por multipart),
`update_reel_plan` (plan entero, solo en `plan_listo`), `approve_reel_render`,
`regenerate_reel_plan` y `retry_reel`. Con ellas, Claude recupera el papel que
tenía en el repo original — proponer y retocar la edición — pero SOBRE la
puerta, no por debajo: la máquina prepara, el agente dirige (edita capas
leyendo `apps/editor/guiones/CATALOGO.json`), y la firma sigue siendo una
acción explícita. `get_reel` devuelve el plan completo a propósito: es el
payload que `update_reel_plan` espera de vuelta.

## Siguientes pasos declarados

1. **Galería de plantillas en el dashboard**: `guiones/CATALOGO.json` del
   editor ya es el schema exacto para poblar un selector (182 piezas, con
   `admite_copy`, `config[]`, `ranuras`). Falta servir las plantillas por el
   API y resolver el scrubbing en iframe (mismo origen o postMessage con un
   wrapper); mientras, las hojas de contacto (`docs/media/catalogo-*.jpg` del
   módulo) sirven de catálogo visual.
2. **Editor de config por capa** en la puerta (los `config` los fija el guion;
   hoy se corrigen en el guion + regenerar, o vía MCP `update_reel_plan`).
3. **Progreso fino del render** (hoy solo estados; el editor no emite %).
4. Convergencia de duplicados con el pipeline de clipping: `docs/convergencia.md`.
