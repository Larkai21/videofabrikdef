/**
 * ¿El juez de guion discrimina, o siempre aprueba?
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/juez-calibra.ts
 *
 * Le pasa guiones deliberadamente malos y uno de control, y enseña la
 * separación entre ellos. Sin esto, endurecer los umbrales es a ciegas: el juez
 * había dado 4/4/4/5/5 en dos guiones distintos y 3/4/4/5/5 en un tercero, sin
 * suspender nunca, y con tres muestras no se puede saber si es que los guiones
 * eran buenos o que el juez no distingue.
 *
 * Cuesta una llamada LLM por fixture (~0,004 $ cada una). Fuera de CI, a mano
 * cuando se toca el prompt del juez.
 */
import { lintScenes, scriptReviewOutputSchema, scriptReviewVerdict } from '@fabrica/shared';
import type { Scene } from '@fabrica/shared';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createDb } from '@fabrica/db';
import { loadEnv } from '../src/lib/env.js';
import pino from 'pino';
import { createLlm } from '../src/providers/llm.js';
import { judgeSystem, judgeUser } from '../src/pipelines/script/prompts.js';

const CLAIMS = [
  { text: 'El puerto movió 4200 contenedores en una semana.', source_idx: 0 },
  { text: 'La tasa de aduanas subió un 12 % en 2025.', source_idx: 0 },
];

function escena(id: string, text: string, section: Scene['section'] = 'body'): Scene {
  return { id, section, text, visual_query: 'port containers crane' };
}

const relleno = (n: number, base: string): Scene[] =>
  Array.from({ length: n }, (_, i) => escena(`sc-body-${i + 1}`, base));

/**
 * El control es un guion REAL de outputs/ NOMBRADO A MANO en
 * `banco/control-juez.json`, no uno escrito para el test ni elegido por una
 * heurística.
 *
 * Antes se cogía «el más largo que haya», y eso es exactamente lo que rompió el
 * arnés: el más largo del corpus es `JBbfvawGXzsXdA92L1zcH`, que el linter
 * determinista marca 29 veces —16 de sus 19 escenas abren con rótulo, y promete
 * un vídeo futuro—. El arnés le estaba exigiendo al juez que APROBARA un guion
 * malo mientras se le pedía suspender los fixtures malos. Con eso no se puede
 * calibrar nada.
 *
 * Un fixture corto y honesto tampoco vale: puntúa bajo por fino, no por malo.
 */
function controlReal(): {
  nombre: string;
  malo: boolean;
  scenes: Scene[];
  title?: string;
  claims: readonly { text: string }[];
} | null {
  const raiz = path.resolve(process.cwd(), '../..');
  const fichero = path.join(raiz, 'banco', 'control-juez.json');
  let elegido: { video_id: string };
  try {
    elegido = JSON.parse(readFileSync(fichero, 'utf8')) as { video_id: string };
  } catch {
    console.error(
      `Falta ${fichero}. El control del arnés se NOMBRA a mano: es el guion contra el que\n` +
        'se calibra el juez y elegirlo por una heurística ya salió mal una vez.',
    );
    return null;
  }
  const dir = process.env.OUTPUTS_DIR ?? path.join(raiz, 'outputs');
  try {
    const m = JSON.parse(readFileSync(path.join(dir, elegido.video_id, 'master.json'), 'utf8')) as {
      script?: { scenes?: Scene[] };
      seo?: { titles?: string[]; chosen_idx?: number | null };
      research?: { claims?: { text: string }[] };
    };
    const scenes = m.script?.scenes ?? [];
    if (scenes.length === 0) return null;
    const t = m.seo?.titles?.[m.seo.chosen_idx ?? 0];
    return {
      nombre: `control aprobado (${elegido.video_id.slice(0, 8)}, ${scenes.length} escenas)`,
      malo: false,
      scenes,
      // su propio título y sus propios claims: juzgarlo contra el título de otro
      // tema daba promesa=0, que es correcto pero no dice nada del juez
      ...(t !== undefined ? { title: t } : {}),
      claims: m.research?.claims ?? [],
    };
  } catch {
    return null;
  }
}

const FIXTURES: Array<{
  nombre: string;
  malo: boolean;
  scenes: Scene[];
  title?: string;
  claims?: readonly { text: string }[];
}> = [
  {
    nombre: 'plano (todo generalidades)',
    malo: true,
    scenes: [
      escena(
        'sc-hook',
        'La logística es un sector muy importante que afecta a todos los aspectos de la economía global moderna.',
        'hook',
      ),
      ...relleno(
        6,
        'Es importante entender que la cadena de suministro tiene muchos factores que influyen en el resultado final y que las empresas deben considerar cuidadosamente.',
      ),
      escena('sc-cta', 'En resumen, la logística seguirá siendo relevante en el futuro.', 'cta'),
    ],
  },
  {
    nombre: 'muletillas (marcas de texto generado)',
    malo: true,
    scenes: [
      escena(
        'sc-hook',
        'En un mundo donde la logística lo es todo, los puertos son más importantes que nunca.',
        'hook',
      ),
      escena(
        'sc-body-1',
        'Y aquí viene lo interesante: no es solo una cuestión de barcos, es una cuestión de datos.',
      ),
      escena(
        'sc-body-2',
        'Prepárate, porque esto cambia las reglas del juego y desbloquea el poder de la cadena de suministro.',
      ),
      escena(
        'sc-body-3',
        'Cabe señalar que es importante destacar que vale la pena mencionar este punto.',
      ),
      escena('sc-cta', 'En conclusión, sumérgete en el fascinante mundo de la logística.', 'cta'),
    ],
  },
  {
    nombre: 'cifras inventadas (fuera de los claims)',
    malo: true,
    scenes: [
      escena(
        'sc-hook',
        'El puerto movió 98000 contenedores y perdió 47 millones de euros en un trimestre.',
        'hook',
      ),
      escena(
        'sc-body-1',
        'El 83 % de los operadores admite que no mide el coste real de la espera en aduana.',
      ),
      escena(
        'sc-body-2',
        'Un estudio de 2024 sitúa el sobrecoste en 312 euros por contenedor y hora.',
      ),
      escena('sc-cta', 'Revisa tu factura: seguramente pagas un 19 % de más.', 'cta'),
    ],
  },
];

loadEnv();
const control = controlReal();
if (control !== null) FIXTURES.unshift(control);
else console.log('aviso: sin vídeos en outputs/, no hay control real\n');

const logger = pino({ level: 'silent' });
const { client } = createDb();
const llm = createLlm(logger);

console.log(`juez: ${llm.name}\n`);
const filas: Array<{
  nombre: string;
  malo: boolean;
  total: number;
  verdict: string;
  ejes: string;
}> = [];

for (const f of FIXTURES) {
  const claims = f.claims ?? CLAIMS;
  const lint = lintScenes(f.scenes, { claims });
  const { system, user } = {
    system: judgeSystem(),
    user: judgeUser({
      title: f.title ?? 'Por qué tu envío tarda dos días de más',
      hookNotes: 'Promete explicar por qué el envío tarda de más; se paga en la última escena.',
      scenes: f.scenes,
      claims,
      words: f.scenes.reduce((a, sc) => a + sc.text.split(/\s+/).length, 0),
      lint,
    }),
  };
  const { data: result } = await llm.completeJson({
    system,
    user,
    schema: scriptReviewOutputSchema,
    maxOutputTokens: 4_000,
  });
  const { verdict, total } = scriptReviewVerdict(result.scores);
  const ejes = Object.entries(result.scores)
    .map(([k, v]) => `${k.slice(0, 4)}=${v}`)
    .join(' ');
  filas.push({ nombre: f.nombre, malo: f.malo, total, verdict, ejes });
  console.log(
    `${f.malo ? '✗ malo ' : '✓ bueno'}  ${total}/25  ${verdict.padEnd(11)}  ${ejes}  ${f.nombre}`,
  );
  console.log(
    `         lint duro: ${lint.filter((h) => h.kind === 'cliche' || h.kind === 'cifra_sin_claim').length} hits`,
  );
}

const ctrlTotal = filas.find((f) => !f.malo)?.total ?? 0;
const peorMalo = Math.max(...filas.filter((f) => f.malo).map((f) => f.total));
console.log(`\nseparación control − peor malo: ${ctrlTotal - peorMalo} puntos`);
const suspendidos = filas.filter((f) => f.malo && f.verdict === 'misaligned').length;
console.log(`malos suspendidos: ${suspendidos}/${filas.filter((f) => f.malo).length}`);
if (suspendidos < filas.filter((f) => f.malo).length) {
  console.log('→ el juez NO discrimina lo suficiente: mira la rúbrica antes de tocar umbrales');
}

await client.end();
process.exit(0);
