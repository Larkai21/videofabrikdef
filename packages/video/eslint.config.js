import tseslint from 'typescript-eslint';

// Determinismo de render (docs/render.md §4): en src/ está prohibida toda
// fuente de no-determinismo — Math.random, relojes, timers y red. La única
// base temporal de la animación es useCurrentFrame; la aleatoriedad visual
// deriva de hashSeed(video_id, beat_idx). scripts/ queda fuera (tooling).
export default tseslint.config(
  {
    ignores: ['out/**', 'public/**', 'node_modules/**', 'scripts/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Sin fetch durante el render (determinismo).' },
        { name: 'setTimeout', message: 'Sin timers: la animación usa useCurrentFrame.' },
        { name: 'setInterval', message: 'Sin timers: la animación usa useCurrentFrame.' },
        { name: 'setImmediate', message: 'Sin timers: la animación usa useCurrentFrame.' },
        {
          name: 'requestAnimationFrame',
          message: 'Sin rAF: la animación usa useCurrentFrame.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Aleatoriedad solo con semilla: hashSeed(video_id, beat_idx).',
        },
        { object: 'Date', property: 'now', message: 'Sin reloj: usa useCurrentFrame.' },
        {
          object: 'performance',
          property: 'now',
          message: 'Sin reloj: usa useCurrentFrame.',
        },
        { object: 'window', property: 'fetch', message: 'Sin fetch durante el render.' },
        { object: 'globalThis', property: 'fetch', message: 'Sin fetch durante el render.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Sin reloj en render: usa useCurrentFrame.',
        },
      ],
    },
  },
);
