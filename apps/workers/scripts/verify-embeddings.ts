// Verificación del backend de embeddings multilingüe (docs/assets-y-biblioteca.md §1).
// Uso: pnpm --filter @fabrica/workers exec tsx scripts/verify-embeddings.ts
//
// Fuerza EMBEDDINGS_PROVIDER=fastembed, embebe pares de prueba ES/EN e imprime
// las similitudes coseno. Criterio: cada par relacionado entre idiomas debe
// puntuar más alto que su par no relacionado.
// Salidas: OK (backend real y orden correcto, exit 0), FALLO (backend real y
// orden incorrecto, exit 1), DEGRADADO (sin backend multilingüe instalado,
// exit 0 con aviso: el modo degradado no rompe nada).
import pino from 'pino';
import { cosineSimilarity, createEmbeddings } from '../src/providers/embeddings.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();
process.env.EMBEDDINGS_PROVIDER = 'fastembed';

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const provider = createEmbeddings(logger);

const pairs: { es: string; en: string; unrelated: string }[] = [
  { es: 'sala de servidores', en: 'server room', unrelated: 'birthday cake' },
  { es: 'coche eléctrico cargando', en: 'electric car charging', unrelated: 'medieval castle' },
  { es: 'inteligencia artificial generativa', en: 'generative artificial intelligence', unrelated: 'fishing boat at sea' },
];

const texts = pairs.flatMap((p) => [p.es, p.en, p.unrelated]);
const vectors = await provider.embed(texts);
const info = provider.describe();

console.log('');
console.log(`Backend efectivo: ${info.backend} (modelo ${info.model}, ${info.dims} dims)`);
console.log('');

let ok = true;
for (let i = 0; i < pairs.length; i++) {
  const pair = pairs[i];
  const vEs = vectors[i * 3];
  const vEn = vectors[i * 3 + 1];
  const vUn = vectors[i * 3 + 2];
  if (!pair || !vEs || !vEn || !vUn) {
    console.error('Faltan vectores en la respuesta del proveedor');
    process.exit(1);
  }
  const near = cosineSimilarity(vEs, vEn);
  const far = cosineSimilarity(vEs, vUn);
  const pass = near > far;
  ok &&= pass;
  console.log(`  cos('${pair.es}', '${pair.en}') = ${near.toFixed(4)}`);
  console.log(`  cos('${pair.es}', '${pair.unrelated}') = ${far.toFixed(4)}`);
  console.log(`  → ${pass ? 'correcto' : 'INCORRECTO'}: el par relacionado ${pass ? 'gana' : 'NO gana'}`);
  console.log('');
}

if (info.backend !== 'e5-transformers') {
  console.log('Resultado: DEGRADADO');
  console.log(
    'Sin backend multilingüe instalado: EMBEDDINGS_PROVIDER=fastembed está cayendo al mock hash,',
  );
  console.log(
    'que no garantiza similitud entre idiomas. Falta la dependencia @huggingface/transformers',
  );
  console.log('(modelo Xenova/multilingual-e5-small). Tras instalarla: relanzar este script y,');
  console.log('si pasa, conmutar el .env y lanzar el job reembed de la cola library.');
  process.exit(0);
}

console.log(`Resultado: ${ok ? 'OK' : 'FALLO'}`);
process.exit(ok ? 0 : 1);
