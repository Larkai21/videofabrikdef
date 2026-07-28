import { buildComponentPrompt, componentTypeSchema, type ComponentType } from '@fabrica/shared';

// Imprime el "prompt-contrato" (SPEC §10) para diseñar un componente del brand
// kit con Claude Design. Los tokens de marca se pasan por variables de entorno
// (para probar sin BD); en el dashboard el mismo prompt sale del canal activo
// vía GET /components/prompt.
//
//   pnpm --filter @fabrica/video exec tsx scripts/make-component-prompt.ts <tipo>
//   CANAL="Señal y ruido" TONO="explicativo,concreto" ESTILO="clean tech" \
//     pnpm --filter @fabrica/video exec tsx scripts/make-component-prompt.ts intro

function main(): void {
  const type = process.argv[2];
  const parsed = componentTypeSchema.safeParse(type);
  if (!parsed.success) {
    console.error(
      `Tipo inválido. Usa uno de: ${componentTypeSchema.options.join(', ')}\n` +
        '  tsx scripts/make-component-prompt.ts <tipo>',
    );
    process.exitCode = 1;
    return;
  }
  const tone = process.env.TONO?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];
  const prompt = buildComponentPrompt(parsed.data as ComponentType, {
    channel_name: process.env.CANAL ?? '(nombre del canal)',
    ...(tone.length > 0 ? { tone } : {}),
    ...(process.env.ESTILO ? { visual_prompt_suffix: process.env.ESTILO } : {}),
    language: process.env.IDIOMA === 'en' ? 'en' : 'es',
  });
  console.log(prompt);
}

main();
