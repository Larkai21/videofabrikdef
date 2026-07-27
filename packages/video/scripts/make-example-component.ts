import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Genera en un directorio temporal un zip VÁLIDO del brand kit (tipo
// lower_third, 'rotulo-ejemplo@1.0.0') y imprime la ruta del zip. Sirve como
// plantilla para diseñar componentes fuera (Claude Design + Claude Code) y
// para probar el ciclo completo: POST /components → validación → activar.
// Solo node y el binario zip del sistema (presente en macOS y Debian).
//
//   pnpm --filter @fabrica/video exec tsx scripts/make-example-component.ts

const MANIFEST = {
  version: '1',
  type: 'lower_third',
  name: 'rotulo-ejemplo',
  component_version: '1.0.0',
  props_schema: './schema.ts',
  assets: [],
};

const SCHEMA_TS = `import { z } from 'zod';

// Contrato lower_third (docs/contratos.md §3): la composición garantiza
// pasar estas props; el schema puede añadir opcionales propias, nunca
// obligatorias nuevas.
export default z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  fromFrame: z.number(),
});
`;

const COMPONENT_TSX = `// Rótulo de ejemplo del brand kit — plantilla mínima del contrato lower_third.
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
        transform: \`translateY(\${shift}px)\`,
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
`;

function main(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fabrica-componente-'));
  const srcDir = path.join(root, 'rotulo-ejemplo');
  mkdirSync(srcDir);
  mkdirSync(path.join(srcDir, 'assets'));

  writeFileSync(path.join(srcDir, 'manifest.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  writeFileSync(path.join(srcDir, 'schema.ts'), SCHEMA_TS);
  writeFileSync(path.join(srcDir, 'Component.tsx'), COMPONENT_TSX);

  const zipPath = path.join(root, 'rotulo-ejemplo@1.0.0.zip');
  // manifest.json debe quedar en la RAÍZ del zip (formato fijo del contrato)
  execFileSync('zip', ['-q', '-r', zipPath, 'manifest.json', 'schema.ts', 'Component.tsx'], {
    cwd: srcDir,
  });

  console.log(zipPath);
}

main();
