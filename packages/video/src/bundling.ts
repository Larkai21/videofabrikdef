import type { WebpackOverrideFn } from '@remotion/bundler';

// Los paquetes del monorepo usan imports estilo NodeNext ('./x.js' que apunta
// a x.ts); el webpack de Remotion no trae extensionAlias, así que el bundle()
// del render (humo y worker) debe pasar este override. Módulo sin React: no
// se re-exporta desde index.ts para no arrastrar @remotion/bundler al player.
export const webpackOverride: WebpackOverrideFn = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.jsx': ['.tsx', '.jsx'],
    },
  },
});
