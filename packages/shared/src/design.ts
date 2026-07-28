import { z } from 'zod';

// Design system del canal: los tokens básicos (colores + tipografía) que el
// humano edita a mano y que las animaciones del brand kit LEEN en el render.
// Viajan del perfil del canal → master.brand.design (congelado) → props de cada
// componente. Editar un color se ve al instante sin regenerar las animaciones.

const HEX = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'color hex #rgb o #rrggbb');

export const designTokensSchema = z.object({
  background: HEX, // fondo del lienzo
  surface: HEX, // tarjetas/paneles sobre el fondo
  foreground: HEX, // texto principal
  muted: HEX, // texto secundario
  accent: HEX, // color de marca (barras, resaltes)
  accent_fg: HEX, // texto sobre el acento
  // familia tipográfica; hoy solo 'Inter' va empaquetada (añadir más = fleco)
  font_family: z.enum(['Inter']),
});
export type DesignTokens = z.infer<typeof designTokensSchema>;

// Valores por defecto = la paleta oscura actual "sala de control" (los que hoy
// están horneados en los temas). Sirve de fallback donde no haya tokens.
export function defaultDesign(): DesignTokens {
  return {
    background: '#0b0f19',
    surface: '#111a2e',
    foreground: '#f4f6fb',
    muted: '#aab6cc',
    accent: '#7aa2ff',
    accent_fg: '#0b0f19',
    font_family: 'Inter',
  };
}

// Convierte un hex (#rgb o #rrggbb) a rgba() con el alpha dado. Lo usan los
// temas del brand kit para superponer un fondo semitransparente derivado del
// token de color (p. ej. la tarjeta de sección sobre el b-roll). Determinista.
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
