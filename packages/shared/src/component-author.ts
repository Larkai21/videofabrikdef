import { z } from 'zod';
import { type ComponentType } from './component-manifest.js';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from './constants.js';
import { buildComponentPrompt, type BrandTokens } from './component-prompt.js';

// Autoría por IA de componentes del brand kit (Fase 4). La LLM recibe el
// "prompt-contrato" extendido (props EXACTAS + tokens de diseño + avatar +
// reglas de determinismo) y devuelve los tres ficheros del zip como JSON. El
// worker los escribe bajo library/components/ y los valida con el pipeline de
// siempre (typecheck, determinismo, contrato, registry, render de humo). En
// modo mock, el generador registrado devuelve las PLANTILLAS de este módulo,
// que son componentes reales y deterministas (pasan la validación tal cual).

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Salida estructurada que exige la LLM: los tres ficheros del zip. El worker es
// la autoridad sobre name/version (los recalcula para evitar colisiones y poder
// re-generar), pero se piden aquí para que la validación Zod sea completa.
export const componentAuthorOutputSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  component_version: z.string().regex(SEMVER_RE),
  // .nullish(): tolera que el LLM mande null en los tipos sin duración fija
  // (el consumidor normaliza null→undefined). Evita que un null tumbe el parse.
  fixed_duration_frames: z.number().int().positive().nullish(),
  schema_ts: z.string().min(1),
  component_tsx: z.string().min(1),
});
export type ComponentAuthorOutput = z.infer<typeof componentAuthorOutputSchema>;

// Tipos que ofrece el botón "generar todas": los que la composición monta hoy.
// (transition existe en el contrato pero LongForm usa @remotion/transitions, no
// un componente del kit; se puede autorizar por tipo, pero no en el lote.)
export const AUTHOR_ALL_TYPES: ComponentType[] = [
  'intro',
  'outro',
  'title_card',
  'lower_third',
  'subtitle_theme',
  'thumbnail_template',
];

// nombre estable del componente autorizado por IA para un tipo (kebab-case).
export function authoredComponentName(type: ComponentType): string {
  return `${type.replace(/_/g, '-')}-ia`;
}

// Prompt-contrato extendido para la LLM: el de siempre + tokens de diseño +
// avatar + reglas estrictas de validación + una implementación de referencia
// (la plantilla, que ya pasa la validación) + formato de salida JSON.
export function buildComponentAuthorPrompt(
  type: ComponentType,
  tokens: BrandTokens,
  extra: { design?: Record<string, string>; character?: { name: string; description: string } } = {},
): string {
  const base = buildComponentPrompt(type, tokens);
  const designLines =
    extra.design && Object.keys(extra.design).length > 0
      ? Object.entries(extra.design)
          .map(([k, v]) => `  - ${k}: ${v}`)
          .join('\n')
      : '  (usa los valores por defecto del design system)';
  const characterLine = extra.character
    ? `El canal tiene un personaje/avatar llamado "${extra.character.name}" (${extra.character.description}). ` +
      'Si el tipo recibe una prop de imagen (logo en intro/outro, image_path en la miniatura), MUÉSTRALO de forma destacada.'
    : 'Si el tipo recibe una prop de imagen (logo/image_path) y viene definida, muéstrala.';
  const ref = authoredTemplateFor(type);

  return `${base}

## 4. Design system (LEE LOS TOKENS, no los hornees)
La composición pasará además una prop opcional \`design\` con los colores y la
tipografía del canal. Tu componente DEBE derivar TODOS sus colores y su fuente
de \`design\` (con un fallback por si llega undefined), nunca de literales fijos.
Tokens actuales del canal:
${designLines}

- Añade \`design\` al schema como objeto opcional de campos string (background,
  surface, foreground, muted, accent, accent_fg, font_family), todos opcionales.
- En el componente: \`const d = { ...FALLBACK, ...(design ?? {}) };\` y usa d.*.
- ${characterLine}
- Lienzo ${VIDEO_WIDTH}×${VIDEO_HEIGHT}, 30 fps.

## 5. Reglas de validación ESTRICTAS (si las incumples, se rechaza)
- eslint con \`@typescript-eslint/no-unused-vars\` en error: NO declares imports,
  constantes, props destructuradas ni variables que no uses. Importa de 'remotion'
  SOLO lo que uses. No declares FIXED_DURATION_FRAMES ni fps si no los usas.
- CAUSA DE FALLO MÁS COMÚN — no la repitas: al desestructurar \`useVideoConfig()\`
  extrae SOLO los campos que uses (p. ej. \`const { durationInFrames } = useVideoConfig();\`),
  NUNCA \`fps\`, \`width\` o \`height\` si no los usas. Igual con las props: desestructura
  solo las que uses (pero el schema SÍ debe declarar todas las del contrato).
- El componente se monta dentro de una Sequence de la duración correcta; NO crees
  tu propia <Sequence>. Lee la duración con useVideoConfig() si la necesitas.
- Determinismo: nada de Math.random, Date.now, new Date(), performance.now, fetch,
  setTimeout/setInterval ni requestAnimationFrame. Anima solo con useCurrentFrame().
- TypeScript estricto (sin \`any\` implícito). El componente hace \`export default\`.
- schema.ts hace \`export default z.object({...})\` y acepta EXACTAMENTE las props
  del contrato (más \`design\` opcional). No añadas props requeridas que la
  composición no pasa.

## 6. Implementación de referencia (pasa la validación tal cual)
Puedes devolverla como está o adaptarla, pero NO rompas el contrato ni las reglas
de la sección 5. Reutiliza este patrón de fallback de tokens.

schema.ts:
\`\`\`ts
${ref.schema_ts}\`\`\`

Component.tsx:
\`\`\`tsx
${ref.component_tsx}\`\`\`

## 7. Formato de salida (OBLIGATORIO)
Responde SOLO con un objeto JSON con exactamente estas claves${
    ['intro', 'outro', 'transition'].includes(type) ? '' : ' (SIN fixed_duration_frames)'
  }:
{
  "name": "<kebab-case>",
  "component_version": "0.1.0",
${['intro', 'outro', 'transition'].includes(type) ? `  "fixed_duration_frames": ${ref.fixed_duration_frames ?? 90},\n` : ''}  "schema_ts": "<contenido COMPLETO de schema.ts: export default z.object({...})>",
  "component_tsx": "<contenido COMPLETO de Component.tsx: export default del componente>"
}
No incluyas manifest.json (lo genera el sistema) ni markdown ni comentarios fuera del JSON. NO añadas claves extra${
    ['intro', 'outro', 'transition'].includes(type)
      ? ''
      : ' ni fixed_duration_frames (este tipo no la lleva)'
  }.`;
}

// Prompt de auto-reparación: dados los dos ficheros previos y el LOG EXACTO del
// fallo de validación (typecheck/eslint/contrato), pide corregir SOLO ese error
// conservando el resto. Devuelve el mismo esquema de salida.
export function buildComponentRepairPrompt(
  type: ComponentType,
  repair: { prevSchemaTs: string; prevComponentTsx: string; failureLog: string },
): string {
  return `Eres ingeniero de componentes de vídeo con Remotion. Tu componente de tipo "${type}" FALLÓ la validación. Corrige SOLO el error indicado, sin cambiar nada más ni el contrato de props.

## Error de validación (log EXACTO)
${repair.failureLog.slice(0, 2000)}

## schema.ts actual
\`\`\`ts
${repair.prevSchemaTs}\`\`\`

## Component.tsx actual
\`\`\`tsx
${repair.prevComponentTsx}\`\`\`

Reglas: sin variables/imports/props sin usar (eslint estricto: al desestructurar useVideoConfig extrae solo lo que uses); determinismo (solo useCurrentFrame, nada de Math.random/Date.now/fetch/timers); export default; schema.ts export default z.object({...}).

Responde SOLO con el JSON: { "name", "component_version", "fixed_duration_frames"?, "schema_ts", "component_tsx" }.`;
}

// ---- Plantillas deterministas (mock y referencia) -------------------------
// Componentes self-contained (solo importan react/remotion). Leen `design` con
// fallback y muestran el avatar (logo/image_path) cuando existe. Sin literales
// de template ni ${} para poder incrustarlos como cadenas sin escapes.

const DESIGN_TYPE =
  "type Design = { background?: string; surface?: string; foreground?: string; muted?: string; accent?: string; accent_fg?: string; font_family?: string };";
const FALLBACK_CONST =
  "const FALLBACK = { background: '#0b0f19', surface: '#111a2e', foreground: '#f4f6fb', muted: '#aab6cc', accent: '#7aa2ff', accent_fg: '#0b0f19', font_family: 'Inter' } as const;";
const TO_RGBA =
  "const toRgba = (hex: string, a: number): string => {\n" +
  "  let h = hex.replace('#', '');\n" +
  "  if (h.length === 3) h = h.split('').map((c) => c + c).join('');\n" +
  "  const r = parseInt(h.slice(0, 2), 16);\n" +
  "  const g = parseInt(h.slice(2, 4), 16);\n" +
  "  const b = parseInt(h.slice(4, 6), 16);\n" +
  "  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';\n" +
  "};";

const SCHEMA_DESIGN =
  "const designSchema = z\n" +
  "  .object({\n" +
  "    background: z.string(),\n" +
  "    surface: z.string(),\n" +
  "    foreground: z.string(),\n" +
  "    muted: z.string(),\n" +
  "    accent: z.string(),\n" +
  "    accent_fg: z.string(),\n" +
  "    font_family: z.string(),\n" +
  "  })\n" +
  "  .partial()\n" +
  "  .optional();";

interface Template {
  fixed_duration_frames?: number;
  schema_ts: string;
  component_tsx: string;
}

function introOutroTemplate(kind: 'intro' | 'outro'): Template {
  const title = kind === 'intro' ? '{channel_name}' : "'Gracias por ver'";
  const secondLine =
    kind === 'intro'
      ? ''
      : "        {channel_name.length > 0 ? (\n" +
        "          <div style={{ fontSize: 30, color: d.muted, marginTop: 10 }}>{channel_name}</div>\n" +
        "        ) : null}\n";
  const schema_ts =
    "import { z } from 'zod';\n\n" +
    SCHEMA_DESIGN +
    "\n\nexport default z.object({\n" +
    "  channel_name: z.string(),\n" +
    "  logo: z.string().optional(),\n" +
    "  design: designSchema,\n" +
    "});\n";
  const component_tsx =
    "import React from 'react';\n" +
    "import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';\n\n" +
    DESIGN_TYPE +
    "\n" +
    FALLBACK_CONST +
    "\n\n" +
    "type Props = { channel_name: string; logo?: string; design?: Design };\n\n" +
    "const Component: React.FC<Props> = ({ channel_name, logo, design }) => {\n" +
    "  const d = { ...FALLBACK, ...(design ?? {}) };\n" +
    "  const frame = useCurrentFrame();\n" +
    "  const { durationInFrames } = useVideoConfig();\n" +
    "  const appear = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
    "  const exit = interpolate(frame, [Math.max(1, durationInFrames - 12), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
    "  const opacity = Math.min(appear, exit);\n" +
    "  return (\n" +
    "    <AbsoluteFill style={{ backgroundColor: d.background, justifyContent: 'center', alignItems: 'center', fontFamily: d.font_family }}>\n" +
    "      <div style={{ opacity, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>\n" +
    "        {logo ? (\n" +
    "          <Img src={logo} style={{ width: 176, height: 176, borderRadius: '50%', objectFit: 'cover', border: '4px solid ' + d.accent }} />\n" +
    "        ) : null}\n" +
    "        <div style={{ fontSize: 60, fontWeight: 700, color: d.foreground, textAlign: 'center' }}>" +
    title +
    "</div>\n" +
    secondLine +
    "        <div style={{ width: 220, height: 6, borderRadius: 3, background: d.accent }} />\n" +
    "      </div>\n" +
    "    </AbsoluteFill>\n" +
    "  );\n" +
    "};\n\n" +
    "export default Component;\n";
  return { fixed_duration_frames: 90, schema_ts, component_tsx };
}

function titleCardTemplate(): Template {
  const schema_ts =
    "import { z } from 'zod';\n\n" +
    SCHEMA_DESIGN +
    "\n\nexport default z.object({\n" +
    "  title: z.string(),\n" +
    "  fromFrame: z.number(),\n" +
    "  design: designSchema,\n" +
    "});\n";
  const component_tsx =
    "import React from 'react';\n" +
    "import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';\n\n" +
    DESIGN_TYPE +
    "\n" +
    FALLBACK_CONST +
    "\n" +
    TO_RGBA +
    "\n\n" +
    "type Props = { title: string; fromFrame: number; design?: Design };\n\n" +
    "const Component: React.FC<Props> = ({ title, design }) => {\n" +
    "  const d = { ...FALLBACK, ...(design ?? {}) };\n" +
    "  const frame = useCurrentFrame();\n" +
    "  const { durationInFrames } = useVideoConfig();\n" +
    "  if (title.trim() === '') return null;\n" +
    "  const appear = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
    "  const exit = interpolate(frame, [Math.max(1, durationInFrames - 14), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
    "  const opacity = Math.min(appear, exit);\n" +
    "  const rise = interpolate(appear, [0, 1], [16, 0]);\n" +
    "  return (\n" +
    "    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: d.font_family, pointerEvents: 'none' }}>\n" +
    "      <div style={{ opacity, transform: 'translateY(' + rise + 'px)', padding: '26px 44px', borderRadius: 16, background: toRgba(d.background as string, 0.62), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, maxWidth: 1200 }}>\n" +
    "        <div style={{ fontSize: 66, fontWeight: 700, color: d.foreground, textAlign: 'center', lineHeight: 1.1 }}>{title}</div>\n" +
    "        <div style={{ width: 180, height: 5, borderRadius: 3, background: d.accent }} />\n" +
    "      </div>\n" +
    "    </AbsoluteFill>\n" +
    "  );\n" +
    "};\n\n" +
    "export default Component;\n";
  return { schema_ts, component_tsx };
}

function lowerThirdTemplate(): Template {
  const schema_ts =
    "import { z } from 'zod';\n\n" +
    SCHEMA_DESIGN +
    "\n\nexport default z.object({\n" +
    "  title: z.string(),\n" +
    "  subtitle: z.string().optional(),\n" +
    "  fromFrame: z.number(),\n" +
    "  design: designSchema,\n" +
    "});\n";
  const component_tsx =
    "import React from 'react';\n" +
    "import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';\n\n" +
    DESIGN_TYPE +
    "\n" +
    FALLBACK_CONST +
    "\n" +
    TO_RGBA +
    "\n\n" +
    "type Props = { title: string; subtitle?: string; fromFrame: number; design?: Design };\n\n" +
    "const Component: React.FC<Props> = ({ title, subtitle, design }) => {\n" +
    "  const d = { ...FALLBACK, ...(design ?? {}) };\n" +
    "  const frame = useCurrentFrame();\n" +
    "  const appear = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
    "  const slide = interpolate(appear, [0, 1], [-40, 0]);\n" +
    "  return (\n" +
    "    <AbsoluteFill style={{ fontFamily: d.font_family, pointerEvents: 'none' }}>\n" +
    "      <div style={{ position: 'absolute', left: 90, bottom: 130, opacity: appear, transform: 'translateX(' + slide + 'px)', background: toRgba(d.surface as string, 0.92), borderLeft: '6px solid ' + d.accent, padding: '14px 24px', borderRadius: 10 }}>\n" +
    "        <div style={{ fontSize: 40, fontWeight: 700, color: d.foreground }}>{title}</div>\n" +
    "        {subtitle ? <div style={{ fontSize: 22, color: d.muted, marginTop: 4 }}>{subtitle}</div> : null}\n" +
    "      </div>\n" +
    "    </AbsoluteFill>\n" +
    "  );\n" +
    "};\n\n" +
    "export default Component;\n";
  return { schema_ts, component_tsx };
}

function subtitleThemeTemplate(): Template {
  const schema_ts =
    "import { z } from 'zod';\n\n" +
    SCHEMA_DESIGN +
    "\n\nexport default z.object({\n" +
    "  cues: z.array(z.unknown()),\n" +
    "  currentMs: z.number(),\n" +
    "  design: designSchema,\n" +
    "  safeArea: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),\n" +
    "});\n";
  const component_tsx =
    "import React from 'react';\n" +
    "import { AbsoluteFill } from 'remotion';\n\n" +
    DESIGN_TYPE +
    "\n" +
    FALLBACK_CONST +
    "\n\n" +
    "type Word = { from_ms: number; to_ms: number; w: string };\n" +
    "type Cue = { from_ms: number; to_ms: number; text: string; words: Word[] };\n" +
    "type Props = { cues: unknown[]; currentMs: number; design?: Design; safeArea: { top: number; right: number; bottom: number; left: number } };\n\n" +
    "const Component: React.FC<Props> = ({ cues, currentMs, design, safeArea }) => {\n" +
    "  const d = { ...FALLBACK, ...(design ?? {}) };\n" +
    "  const list = cues as Cue[];\n" +
    "  const active = list.find((c) => currentMs >= c.from_ms && currentMs < c.to_ms);\n" +
    "  if (!active) return null;\n" +
    "  const words = active.words ?? [];\n" +
    "  return (\n" +
    "    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: d.font_family }}>\n" +
    "      <div style={{ position: 'absolute', left: safeArea.left, right: safeArea.right, bottom: safeArea.bottom, textAlign: 'center', fontSize: 52, fontWeight: 700, lineHeight: 1.2, textShadow: '0 3px 14px rgba(0, 0, 0, 0.85)' }}>\n" +
    "        {words.length > 0 ? (\n" +
    "          words.map((w, i) => (\n" +
    "            <span key={i} style={{ color: currentMs >= w.from_ms && currentMs < w.to_ms ? d.accent : currentMs >= w.to_ms ? d.foreground : d.muted }}>\n" +
    "              {w.w}\n" +
    "              {i < words.length - 1 ? ' ' : ''}\n" +
    "            </span>\n" +
    "          ))\n" +
    "        ) : (\n" +
    "          <span style={{ color: d.foreground }}>{active.text}</span>\n" +
    "        )}\n" +
    "      </div>\n" +
    "    </AbsoluteFill>\n" +
    "  );\n" +
    "};\n\n" +
    "export default Component;\n";
  return { schema_ts, component_tsx };
}

function transitionTemplate(): Template {
  const schema_ts =
    "import { z } from 'zod';\n\n" +
    SCHEMA_DESIGN +
    "\n\nexport default z.object({\n" +
    "  durationInFrames: z.number(),\n" +
    "  design: designSchema,\n" +
    "});\n";
  const component_tsx =
    "import React from 'react';\n" +
    "import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';\n\n" +
    DESIGN_TYPE +
    "\n" +
    FALLBACK_CONST +
    "\n\n" +
    "type Props = { durationInFrames: number; design?: Design };\n\n" +
    "const Component: React.FC<Props> = ({ durationInFrames, design }) => {\n" +
    "  const d = { ...FALLBACK, ...(design ?? {}) };\n" +
    "  const frame = useCurrentFrame();\n" +
    "  const progress = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
    "  return (\n" +
    "    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start' }}>\n" +
    "      <div style={{ width: progress * 100 + '%', height: '100%', background: d.accent, opacity: 0.85 }} />\n" +
    "    </AbsoluteFill>\n" +
    "  );\n" +
    "};\n\n" +
    "export default Component;\n";
  return { fixed_duration_frames: 15, schema_ts, component_tsx };
}

function thumbnailTemplate(): Template {
  const schema_ts =
    "import { z } from 'zod';\n\n" +
    SCHEMA_DESIGN +
    "\n\nexport default z.object({\n" +
    "  text: z.string(),\n" +
    "  image_path: z.string().optional(),\n" +
    "  variant: z.enum(['a', 'b']),\n" +
    "  design: designSchema,\n" +
    "});\n";
  const component_tsx =
    "import React from 'react';\n" +
    "import { AbsoluteFill, Img } from 'remotion';\n\n" +
    DESIGN_TYPE +
    "\n" +
    FALLBACK_CONST +
    "\n\n" +
    "type Props = { text: string; image_path?: string; variant: 'a' | 'b'; design?: Design };\n\n" +
    "const Component: React.FC<Props> = ({ text, image_path, variant, design }) => {\n" +
    "  const d = { ...FALLBACK, ...(design ?? {}) };\n" +
    "  return (\n" +
    "    <AbsoluteFill style={{ backgroundColor: d.background, fontFamily: d.font_family }}>\n" +
    "      {image_path ? (\n" +
    "        <AbsoluteFill>\n" +
    "          <Img src={image_path} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />\n" +
    "        </AbsoluteFill>\n" +
    "      ) : null}\n" +
    "      <AbsoluteFill style={{ justifyContent: variant === 'a' ? 'flex-end' : 'flex-start', padding: 72 }}>\n" +
    "        <div style={{ width: 180, height: 14, background: d.accent, borderRadius: 7, marginBottom: 24 }} />\n" +
    "        <div style={{ fontSize: 128, fontWeight: 800, color: d.foreground, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>{text}</div>\n" +
    "      </AbsoluteFill>\n" +
    "    </AbsoluteFill>\n" +
    "  );\n" +
    "};\n\n" +
    "export default Component;\n";
  return { schema_ts, component_tsx };
}

// Plantilla determinista por tipo (mock y referencia).
export function authoredTemplateFor(type: ComponentType): Template {
  switch (type) {
    case 'intro':
      return introOutroTemplate('intro');
    case 'outro':
      return introOutroTemplate('outro');
    case 'title_card':
      return titleCardTemplate();
    case 'lower_third':
      return lowerThirdTemplate();
    case 'subtitle_theme':
      return subtitleThemeTemplate();
    case 'transition':
      return transitionTemplate();
    case 'thumbnail_template':
      return thumbnailTemplate();
  }
}

// Salida completa (para el mock): plantilla + name/version por defecto.
export function authoredTemplateOutput(type: ComponentType): ComponentAuthorOutput {
  const tpl = authoredTemplateFor(type);
  return componentAuthorOutputSchema.parse({
    name: authoredComponentName(type),
    component_version: '0.1.0',
    ...(tpl.fixed_duration_frames !== undefined
      ? { fixed_duration_frames: tpl.fixed_duration_frames }
      : {}),
    schema_ts: tpl.schema_ts,
    component_tsx: tpl.component_tsx,
  });
}
