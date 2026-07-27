import { staticFile } from 'remotion';

// Contrato de rutas de medios de la composición (ver también la nota de
// estrategia en apps/workers/src/pipelines/render/index.ts):
// - http(s)/data/blob → se usan tal cual (el worker reescribe rutas locales
//   a URLs de la API antes de renderizar).
// - ruta relativa → asset del public/ del bundle, vía staticFile (render de humo).
// - ruta absoluta del sistema de archivos → NO es cargable por Chromium; la
//   composición pinta la placa neutra en su lugar (maestro a medio construir
//   en el player del dashboard).

export function isRenderableSrc(path: string): boolean {
  if (/^(https?:|data:|blob:)/.test(path)) return true;
  if (path.startsWith('/static-') || path.startsWith('/files/')) return true;
  return !path.startsWith('/');
}

export function toSrc(path: string): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (path.startsWith('/static-') || path.startsWith('/files/')) return path;
  return staticFile(path);
}
