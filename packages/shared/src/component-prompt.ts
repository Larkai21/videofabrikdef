import { type ComponentType } from './component-manifest.js';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from './constants.js';

// Generador del "prompt-contrato" (SPEC §10): dado un tipo de componente del
// brand kit y los tokens de marca del canal, produce un prompt listo para pegar
// en Claude Design / Claude Code. Tres bloques: tokens de marca, interfaz exacta
// de props + manifest, y restricciones de Remotion + formato del zip. Compartido
// por el CLI (scripts/make-component-prompt.ts) y la API (/components/prompt)
// para que no diverjan.

export interface BrandTokens {
  channel_name: string;
  tone?: string[];
  visual_prompt_suffix?: string;
  language?: 'es' | 'en';
}

interface TypeSpec {
  label: string;
  whenShown: string;
  propsTs: string;
  needsFixedDuration: boolean;
  isAnimation: boolean;
}

const WORD_TS =
  '{ from_ms: number; to_ms: number; w: string }';
const CUE_TS =
  `{ from_ms: number; to_ms: number; text: string; words: ${WORD_TS}[] }`;

const TYPE_SPECS: Record<ComponentType, TypeSpec> = {
  intro: {
    label: 'Intro',
    whenShown: 'Cabecera de marca al inicio del vídeo (duración fija).',
    propsTs: '{ channel_name: string; logo?: string }',
    needsFixedDuration: true,
    isAnimation: true,
  },
  outro: {
    label: 'Outro',
    whenShown: 'Cierre de marca al final del vídeo (duración fija).',
    propsTs: '{ channel_name: string; logo?: string }',
    needsFixedDuration: true,
    isAnimation: true,
  },
  title_card: {
    label: 'Tarjeta de título / sección',
    whenShown: 'Rótulo centrado que aparece unos segundos al entrar cada sección.',
    propsTs: '{ title: string; fromFrame: number }',
    needsFixedDuration: false,
    isAnimation: true,
  },
  lower_third: {
    label: 'Rótulo inferior (lower third)',
    whenShown: 'Rótulo en banda inferior con el título y el nombre del canal.',
    propsTs: '{ title: string; subtitle?: string; fromFrame: number }',
    needsFixedDuration: false,
    isAnimation: true,
  },
  subtitle_theme: {
    label: 'Tema de subtítulos',
    whenShown: 'Subtítulos karaoke; recibe el cue activo por tiempo y los pinta.',
    propsTs: `{ cues: ${CUE_TS}[]; currentMs: number; safeArea: { top: number; right: number; bottom: number; left: number } }`,
    needsFixedDuration: false,
    isAnimation: true,
  },
  transition: {
    label: 'Transición',
    whenShown: 'Pieza breve entre bloques (duración fija).',
    propsTs: '{ durationInFrames: number }',
    needsFixedDuration: true,
    isAnimation: true,
  },
  thumbnail_template: {
    label: 'Plantilla de miniatura',
    whenShown: 'Imagen fija (no animación) para la miniatura; se renderiza como still.',
    propsTs: "{ text: string; image_path?: string; variant: 'a' | 'b' }",
    needsFixedDuration: false,
    isAnimation: false,
  },
};

function brandBlock(tokens: BrandTokens): string {
  const lines = [`- Canal: ${tokens.channel_name || '(sin nombre)'}`];
  if (tokens.tone && tokens.tone.length > 0) lines.push(`- Tono: ${tokens.tone.join(', ')}`);
  if (tokens.visual_prompt_suffix && tokens.visual_prompt_suffix.trim() !== '') {
    lines.push(`- Estética visual: ${tokens.visual_prompt_suffix.trim()}`);
  }
  lines.push(`- Idioma de los textos: ${tokens.language === 'en' ? 'inglés' : 'español'}`);
  return lines.join('\n');
}

export function buildComponentPrompt(type: ComponentType, tokens: BrandTokens): string {
  const spec = TYPE_SPECS[type];
  const fixedLine = spec.needsFixedDuration
    ? `- OBLIGATORIO fixed_duration_frames (entero > 0, frames a 30 fps): la Sequence que monta el componente mide exactamente eso; léelo con useVideoConfig().`
    : '- Sin fixed_duration_frames: la composición decide cuánto se muestra.';
  const animLine = spec.isAnimation
    ? 'Anima SOLO con useCurrentFrame()/interpolate/spring; nada de CSS animations ni timers.'
    : 'Es una imagen FIJA (se renderiza con renderStill); no animes.';

  return `Eres diseñador de componentes de vídeo con Remotion. Diseña un componente de brand kit de tipo "${type}" (${spec.label}) para este canal.

## 1. Marca
${brandBlock(tokens)}
${spec.whenShown}

## 2. Contrato de props (EXACTO — no cambies los nombres)
La composición pasará SIEMPRE estas props; tu schema.ts debe aceptarlas:

  // props que recibe Component.tsx
  type Props = ${spec.propsTs};

- schema.ts hace \`export default z.object({ ... })\` que valida esas props.
- Component.tsx hace \`export default\` del componente React que las recibe.
${fixedLine}

## 3. Restricciones de Remotion y formato del zip
- Lienzo ${VIDEO_WIDTH}×${VIDEO_HEIGHT}, 30 fps.
- ${animLine}
- Determinismo: prohibido Math.random() sin semilla, Date.now(), fetch() y timers (setTimeout/setInterval). Todo lo que se mueva o varíe debe derivar de useCurrentFrame().
- Fuentes: empaquetadas en el zip o de la pila del sistema; nunca Google Fonts en tiempo de render.
- Assets (imágenes, logos) por ruta local relativa dentro del zip, declarados en manifest.assets.
- El zip contiene EXACTAMENTE: manifest.json + Component.tsx + schema.ts + assets/.
- manifest.json: { "version": "1", "type": "${type}", "name": "<kebab-case>", "component_version": "1.0.0", "props_schema": "./schema.ts", "assets": [], ${spec.needsFixedDuration ? '"fixed_duration_frames": <frames>, ' : ''}}

Entrega el contenido de los tres ficheros (manifest.json, schema.ts, Component.tsx). El componente se validará compilando con TypeScript, comprobando el contrato de props y haciendo un render de humo antes de activarse.`;
}
