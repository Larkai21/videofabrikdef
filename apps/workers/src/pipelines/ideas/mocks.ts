import { mockHash, registerMockOp } from '../../providers/llm.js';

// Mock determinista de idea_writeup: mismo cluster → misma ficha, en español.

const ANGLES = [
  'Explicar qué cambia en la práctica y a quién afecta primero',
  'Separar la señal del ruido: qué es real y qué es marketing',
  'Qué puede hacer hoy un usuario normal con esto',
];

export function buildMockIdea(mockContext: Record<string, unknown>): {
  angle: string;
  title: string;
  summary: string;
  why_now: string;
} {
  const titles = Array.isArray(mockContext.titles)
    ? (mockContext.titles as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const base = titles[0] ?? 'una historia del sector';
  const seed = mockHash(String(mockContext.clusterId ?? base));
  const angle = ANGLES[seed % ANGLES.length] ?? ANGLES[0]!;
  return {
    angle,
    title: `Qué hay detrás de ${base}`.slice(0, 70),
    summary: `Varias fuentes del nicho apuntan a la misma historia: ${base}. La pieza explica el contexto, los datos disponibles y una lectura práctica para el espectador.`,
    why_now: 'La conversación crece en las fuentes del nicho.\nVarios medios lo han cubierto en las últimas horas.',
  };
}

export function registerIdeasMocks(): void {
  registerMockOp('idea_writeup', ({ mockContext }) => buildMockIdea(mockContext));
}
