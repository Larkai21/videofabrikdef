import { z } from 'zod';

// ComponentManifest v1 (docs/contratos.md §3) — manifest.json dentro del zip
// del brand kit. Validación al subir: unzip → typecheck contra el contrato →
// render de humo de 60 frames → preview → activar.

export const COMPONENT_TYPES = [
  'intro',
  'outro',
  'title_card',
  'lower_third',
  'subtitle_theme',
  'transition',
  'thumbnail_template',
] as const;

export const componentTypeSchema = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof componentTypeSchema>;

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const componentManifestV1 = z.object({
  version: z.literal('1'),
  type: componentTypeSchema,
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'nombre en kebab-case, sin mayúsculas ni espacios'),
  component_version: z.string().regex(SEMVER_RE, 'semver X.Y.Z'),
  // ruta relativa dentro del zip al schema de props (export default z.object(...))
  props_schema: z.string(),
  // intro/outro/transition tienen duración fija en frames
  fixed_duration_frames: z.number().int().positive().optional(),
  // rutas relativas dentro del zip
  assets: z.array(z.string()),
}).superRefine((manifest, ctx) => {
  // sin duración fija, una intro/outro/transition se validaría pero jamás se
  // montaría (docs/contratos.md §3 la exige para estos tipos)
  const requiresFixed = ['intro', 'outro', 'transition'].includes(manifest.type);
  if (requiresFixed && manifest.fixed_duration_frames === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['fixed_duration_frames'],
      message: `los componentes de tipo ${manifest.type} exigen fixed_duration_frames`,
    });
  }
});

export type ComponentManifest = z.infer<typeof componentManifestV1>;

// Tema de subtítulos integrado de S1: único componente del brand kit que
// existe desde el día 1. Todo maestro nuevo nace con él.
export const DEFAULT_SUBTITLE_THEME_REF = 'subtitulos-basicos@0.1.0';

export function defaultBrand(): { components: { subtitle_theme: string } } {
  return { components: { subtitle_theme: DEFAULT_SUBTITLE_THEME_REF } };
}

// referencia "tipo resuelto" que viaja en master.brand.components: name@version
export function componentRef(name: string, version: string): string {
  return `${name}@${version}`;
}

export function parseComponentRef(ref: string): { name: string; version: string } | null {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return null;
  const name = ref.slice(0, at);
  const version = ref.slice(at + 1);
  if (!SEMVER_RE.test(version)) return null;
  return { name, version };
}

// Contratos de props mínimos por tipo (docs/contratos.md §3). El zip aporta su
// schema.ts concreto; estos son los campos que la composición garantiza pasar.
export const subtitleThemePropsSchema = z.object({
  cues: z.array(z.unknown()),
  currentMs: z.number(),
  safeArea: z.object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }),
});

export const lowerThirdPropsSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  fromFrame: z.number(),
});

export const thumbnailTemplatePropsSchema = z.object({
  text: z.string(),
  // opcional: la plantilla integrada de S1 compone sin imagen de fondo
  image_path: z.string().optional(),
  variant: z.enum(['a', 'b']),
});

export const introOutroPropsSchema = z.object({
  channel_name: z.string(),
  logo: z.string().optional(),
});

// title_card: rótulo de apertura del hook. La composición garantiza el título
// elegido y el frame de arranque local de su Sequence.
export const titleCardPropsSchema = z.object({
  title: z.string(),
  fromFrame: z.number(),
});

// transition: pieza de duración fija entre bloques; recibe los frames que le
// asigna la composición (fixed_duration_frames del manifest).
export const transitionPropsSchema = z.object({
  durationInFrames: z.number(),
});
