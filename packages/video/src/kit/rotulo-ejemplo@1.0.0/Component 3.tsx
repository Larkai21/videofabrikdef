// Rótulo de ejemplo del brand kit — plantilla mínima del contrato lower_third.
// Restricciones del contrato (docs/render.md §4): animar SOLO con
// useCurrentFrame, sin fetch durante el render, sin aleatoriedad sin semilla,
// fuentes empaquetadas en el zip o pila del sistema. Export default obligatorio.
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

export interface RotuloEjemploProps {
  title: string;
  subtitle?: string;
  fromFrame: number;
}

const RotuloEjemplo: React.FC<RotuloEjemploProps> = ({ title, subtitle, fromFrame }) => {
  const frame = useCurrentFrame();
  const t = frame - fromFrame;
  // entrada breve: visible ya en el frame 0 para que el preview no salga vacío
  const opacity = interpolate(t, [0, 8], [0.6, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shift = interpolate(t, [0, 10], [18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        bottom: 96,
        maxWidth: 860,
        opacity,
        transform: `translateY(${shift}px)`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '18px 28px',
        borderLeft: '6px solid #7aa2ff',
        background: 'rgba(10, 14, 22, 0.82)',
        borderRadius: 10,
        color: '#f4f6fb',
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
      {subtitle !== undefined ? (
        <div style={{ fontSize: 26, fontWeight: 400, color: '#aab6cc' }}>{subtitle}</div>
      ) : null}
    </div>
  );
};

export default RotuloEjemplo;
