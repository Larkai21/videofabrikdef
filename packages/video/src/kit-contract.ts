import { makeDemoMaster, type ComponentType } from '@fabrica/shared';

// Contrato de props mínimo por tipo de componente del brand kit
// (docs/contratos.md §3). El zip aporta su schema.ts concreto; aquí se
// construye un objeto de ejemplo válido del contrato y se comprueba que el
// schema del zip lo acepta. Lógica pura y sin React: la consumen los tests,
// scripts/check-contract.ts y el harness de humo (kit-smoke.tsx).

/** Props de ejemplo del contrato mínimo para un tipo dado. */
export function samplePropsFor(type: ComponentType): Record<string, unknown> {
  switch (type) {
    case 'subtitle_theme': {
      // cues reales del maestro de demo compartido (misma fuente que el
      // render de humo de pnpm render:smoke)
      const master = makeDemoMaster();
      return {
        cues: master.cues ?? [],
        currentMs: 600,
        // mismos valores que SAFE_AREA de Subtitles.tsx (duplicados a
        // propósito: este módulo no importa React)
        safeArea: { top: 90, right: 160, bottom: 120, left: 160 },
      };
    }
    case 'lower_third':
      return { title: 'Canal de ejemplo', subtitle: 'Dato de contexto', fromFrame: 0 };
    case 'title_card':
      return { title: 'Titular de prueba', fromFrame: 0 };
    case 'transition':
      return { durationInFrames: 30 };
    case 'thumbnail_template':
      return { text: 'Titular de prueba', variant: 'a' };
    case 'intro':
    case 'outro':
      return { channel_name: 'Canal de ejemplo' };
  }
}

export type ContractCheck = { ok: true } | { ok: false; reason: string };

interface ZodLikeIssue {
  path?: Array<string | number>;
  message?: string;
}

interface ZodLikeResult {
  success: boolean;
  error?: { issues?: ZodLikeIssue[] };
}

/**
 * Verifica que el export default de schema.ts es un esquema Zod y que acepta
 * las props mínimas del contrato del tipo. Duck typing sobre safeParse para
 * no depender de la identidad de la instancia de zod del zip.
 */
export function checkPropsContract(schema: unknown, type: ComponentType): ContractCheck {
  if (
    schema === null ||
    typeof schema !== 'object' ||
    typeof (schema as { safeParse?: unknown }).safeParse !== 'function'
  ) {
    return {
      ok: false,
      reason:
        'schema.ts no exporta por defecto un esquema Zod: se esperaba export default z.object({...})',
    };
  }
  const sample = samplePropsFor(type);
  let result: ZodLikeResult;
  try {
    result = (schema as { safeParse: (v: unknown) => ZodLikeResult }).safeParse(sample);
  } catch (err) {
    return {
      ok: false,
      reason: `schema.safeParse lanzó una excepción: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (result.success) return { ok: true };
  const issues = (result.error?.issues ?? [])
    .slice(0, 5)
    .map((i) => `${(i.path ?? []).join('.') || '(raíz)'}: ${i.message ?? 'inválido'}`)
    .join('; ');
  return {
    ok: false,
    reason:
      `el esquema no acepta las props mínimas del contrato de ${type}` +
      (issues.length > 0 ? `: ${issues}` : ''),
  };
}
