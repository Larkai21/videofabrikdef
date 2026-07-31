/**
 * Banco de guiones: iterar el prompt sin pasar por la cola.
 *
 *   pnpm guion preparar                      # congela los briefs desde Postgres
 *   pnpm guion --variante base --n 3         # escribe guiones del conjunto dev
 *   pnpm guion --variante base --casos control
 *   pnpm guion --medir base                  # tabla determinista de una corrida
 *   pnpm guion --diff base v2                # qué subió y qué bajó
 *   pnpm guion --leer base                   # lista los .md para leerlos a mano
 *
 * Por qué existe: hoy, para ver el efecto de tocar una línea de `prompts.ts`
 * hace falta una idea con research en Postgres, Redis arriba, BullMQ
 * despachando y pasar la puerta humana — y la salida es JSON. La cadena entera
 * tarda 92 segundos (medido en cost_ledger), así que lo que hace inviable
 * iterar veinte veces no es el reloj: es el estado. Esto quita el estado.
 *
 * El research se congela en el caso. No es solo por dinero (0,0028 $): es para
 * que dos corridas de la misma variante se diferencien SOLO en el prompt. Si el
 * research se rehiciera en cada vuelta, la mitad de la varianza vendría de la
 * red y no habría forma de atribuir una mejora.
 *
 * Coste medido: 0,00514 $ por guion. Una vuelta de 6 casos × 3 muestras ≈ 0,09 $
 * y 3-4 minutos de reloj con concurrencia 5.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import PQueue from 'p-queue';
import { channels, createDb, ideas as ideasTable, videos } from '@fabrica/db';
import {
  BLOCKING_LINT_KINDS,
  blockingSceneIds,
  channelSettingsSchema,
  entidadesNombradas,
  escenasEncabezadas,
  lintScenes,
  palabrasDelCierre,
  researchSchema,
  type ChannelProfile,
  type Research,
  type Scene,
} from '@fabrica/shared';
import { loadEnv } from '../src/lib/env.js';
import { closeCost, failCost, openCost } from '../src/lib/ledger.js';
import { usageCost } from '../src/pipelines/script/llm-call.js';
import { createLlm } from '../src/providers/llm.js';
import { downloadSources } from '../src/pipelines/script/research.js';
import { refineOutputSchema, scriptGenSchema } from '../src/pipelines/script/generate.js';
import { instruccionesDeRefinado } from '../src/pipelines/script/refine.js';
import {
  refineSystem,
  researchSystem,
  researchUser,
  scriptSystem,
  scriptUser,
} from '../src/pipelines/script/prompts.js';
import { scriptWords, wordTarget } from '../src/pipelines/script/wordcount.js';

const RAIZ = path.resolve(process.cwd(), '../../banco');
const DIR_CASOS = path.join(RAIZ, 'casos');
const DIR_CORRIDAS = path.join(RAIZ, 'corridas');
const CONCURRENCIA = 5;

interface Caso {
  id: string;
  /** dev se lee durante el sprint; control NO se mira hasta cerrar */
  conjunto: 'dev' | 'control';
  /** modo de fallo del material que representa este caso */
  familia: string;
  origen: { video_id: string; idea_id: string };
  idea: { title: string; angle: string | null; summary: string; whyNow: string | null };
  targetMinutes: number;
  research: Research;
  notas: string;
}

// Familias por MODO DE FALLO DEL MATERIAL, que es la taxonomía que sale del
// corpus: lo que rompe el guion no es el tema, es qué trae el research.
// La mitad va a control y no se mira hasta la portería.
const REPARTO: Record<string, { conjunto: 'dev' | 'control'; familia: string; notas: string }> = {
  JBbfvawGXzsXdA92L1zcH: {
    conjunto: 'dev',
    familia: 'research-rico',
    notas:
      '23 claims de HuggingFace, nombres propios a espuertas. Produjo el PEOR guion estructural del corpus: 16 de 19 escenas rotuladas, la ficha técnica leída en voz alta. Es la prueba de que arreglar el research no arregla el guion.',
  },
  IbDk9awikbto_TPi_cq8l: {
    conjunto: 'dev',
    familia: 'research-de-titular',
    notas: '2 claims de un titular de Google News. El guion gira entero sobre una cifra del 25 %.',
  },
  EKPfJAWT9OOMy3wF098Bp: {
    conjunto: 'dev',
    familia: 'research-vacio',
    notas:
      'claims = []. Prometió una demo en pantalla en un canal sin cámara: «En la demo usaré un libro técnico».',
  },
  uVkNtcYIrYqEX8D3dG1Ah: {
    conjunto: 'dev',
    familia: 'research-de-tuit',
    notas:
      '1 claim de un tuit. 1008 palabras y CERO entidades reales. Le contó al espectador que el research pack era limitado.',
  },
  zZ0X0SRh7OusaNdtPK8dd: {
    conjunto: 'dev',
    familia: 'research-desalineado',
    notas:
      'Los 6 claims van de discapacidad, SSI y el «benefits cliff»; el guion va de ganar dinero con IA a los 38. El material no responde a la idea.',
  },
  OIC6LvB17pOtsK3tOkbqx: {
    conjunto: 'dev',
    familia: 'google-news-reparado',
    notas:
      'Su fuente es la que destapó el fetcher roto. Con el arreglo pasa de 1 claim («existe un artículo titulado…») a research real de computing.es.',
  },
  // ojo con los guiones: son ids de nanoid y hay que citarlos
  'S5uiXZu-0z5yKqogXT-X2': {
    conjunto: 'control',
    familia: 'producto-repo',
    notas: '11 claims de GitHub, el research más limpio del corpus.',
  },
  O9WieZkLPrbjAAXcDxq1f: {
    conjunto: 'control',
    familia: 'noticia-con-medio',
    notas: '10 claims de techspot. Su guion es el único del corpus que se lee bien.',
  },
  CVj6w2e34mSz6BsAAFMET: {
    conjunto: 'control',
    familia: 'research-de-tuit',
    notas: '9 claims de xcancel.',
  },
  OV2mHfxG8vxN9NxTxTiHo: {
    conjunto: 'control',
    familia: 'producto-repo',
    notas: '4 claims de un blog técnico.',
  },
  OZmRIqZ2w_qwyAg_RYLDh: {
    conjunto: 'control',
    familia: 'research-vacio',
    notas: 'claims = []. 16 de 18 escenas rotuladas: «Hardware:», «Modelos:», «Aplicaciones:».',
  },
  dLLuSGNMMCE45frc5iImQ: {
    conjunto: 'control',
    familia: 'research-de-titular',
    notas: '2 claims de Google News, guion corto.',
  },
};

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });

/** Semilla determinista por caso y muestra. */
function semilla(casoId: string, muestra: number): number {
  const h = createHash('sha1').update(`${casoId}:${muestra}`).digest();
  return h.readUInt32BE(0);
}

function sha(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function gitSha(): string {
  try {
    // sin dependencias: el HEAD de .git basta y no exige que git esté en PATH
    const head = readFileSync(path.resolve(process.cwd(), '../../.git/HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5) : null;
    if (!ref) return head.slice(0, 12);
    return readFileSync(path.resolve(process.cwd(), '../../.git', ref), 'utf8')
      .trim()
      .slice(0, 12);
  } catch {
    return 'desconocido';
  }
}

async function preparar(): Promise<void> {
  loadEnv();
  const { db, client } = createDb();
  const llm = createLlm(logger);
  mkdirSync(DIR_CASOS, { recursive: true });
  let hechos = 0;
  try {
    for (const [videoId, meta] of Object.entries(REPARTO)) {
      const destino = path.join(DIR_CASOS, `${videoId}.json`);
      if (existsSync(destino)) {
        console.log(`· ${videoId} ya congelado`);
        continue;
      }
      const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
      if (!video) {
        console.log(`✗ ${videoId} no está en la BD; se omite`);
        continue;
      }
      const [idea] = await db.select().from(ideasTable).where(eq(ideasTable.id, video.ideaId));
      const [channel] = await db.select().from(channels).where(eq(channels.id, video.channelId));
      if (!idea || !channel?.profile) {
        console.log(`✗ ${videoId} sin idea o sin perfil; se omite`);
        continue;
      }
      const settings = channelSettingsSchema.parse(channel.settings ?? {});
      // el research se rehace CON EL FETCHER ARREGLADO y se congela
      const docs = await downloadSources(logger, idea.sourceRefs ?? [], false);
      const { data: research } = await llm.completeJson({
        system: researchSystem(),
        user: researchUser({ title: idea.title, angle: idea.angle, summary: idea.summary }, docs),
        schema: researchSchema,
        mockContext: { refs: idea.sourceRefs ?? [], ideaTitle: idea.title },
      });
      const caso: Caso = {
        id: videoId,
        conjunto: meta.conjunto,
        familia: meta.familia,
        origen: { video_id: videoId, idea_id: idea.id },
        idea: {
          title: idea.title,
          angle: idea.angle,
          summary: idea.summary,
          whyNow: idea.whyNow,
        },
        targetMinutes: settings.target_minutes,
        research,
        notas: meta.notas,
      };
      writeFileSync(destino, `${JSON.stringify(caso, null, 2)}\n`);
      const chars = docs.reduce((n, d) => n + d.text.length, 0);
      console.log(
        `✓ ${videoId.padEnd(22)} ${meta.conjunto.padEnd(8)} ${meta.familia.padEnd(22)} ` +
          `${research.claims.length} claims · ${chars} chars descargados`,
      );
      hechos += 1;
    }
  } finally {
    await client.end();
  }
  console.log(`\n${hechos} casos congelados en ${DIR_CASOS}`);
}

function cargarCasos(conjunto: 'dev' | 'control' | 'todos'): Caso[] {
  if (!existsSync(DIR_CASOS)) {
    console.error('No hay casos. Ejecuta antes: pnpm guion preparar');
    process.exit(1);
  }
  return readdirSync(DIR_CASOS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(DIR_CASOS, f), 'utf8')) as Caso)
    .filter((c) => conjunto === 'todos' || c.conjunto === conjunto)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function comoDocumento(
  caso: Caso,
  gen: { script: { scenes: Scene[]; hook_notes: string }; seo: { titles: string[] } },
): string {
  const hits = lintScenes(gen.script.scenes, { claims: caso.research.claims });
  const porTipo = new Map<string, number>();
  for (const h of hits) porTipo.set(h.kind, (porTipo.get(h.kind) ?? 0) + 1);
  const palabras = scriptWords(gen.script.scenes);
  return [
    `# ${gen.seo.titles[0] ?? '(sin título)'}`,
    '',
    `> ${caso.familia} · ${caso.id} · ${palabras} palabras · ${gen.script.scenes.length} escenas`,
    '',
    'Otros títulos propuestos:',
    ...gen.seo.titles.slice(1).map((t) => `- ${t}`),
    '',
    '---',
    '',
    ...gen.script.scenes.flatMap((s) => [
      `**${s.id}** · ${s.text.trim().split(/\s+/).length} palabras`,
      '',
      s.text,
      '',
    ]),
    '---',
    '',
    '## Lo que dice el linter',
    '',
    porTipo.size === 0
      ? 'Sin avisos.'
      : [...porTipo.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `- ${k}: ${n}`)
          .join('\n'),
    '',
    `- escenas que abren con encabezado: ${escenasEncabezadas(gen.script.scenes)} de ${gen.script.scenes.length}`,
    '',
  ].join('\n');
}

async function correr(variante: string, conjunto: 'dev' | 'control' | 'todos', n: number) {
  loadEnv();
  const llm = createLlm(logger);
  const { db, client } = createDb();
  // a qué canal se le imputa el gasto del banco
  const [canal] = await db.select({ id: channels.id }).from(channels).limit(1);
  const perfilCanalId = canal?.id ?? null;
  const casos = cargarCasos(conjunto);
  if (casos.length === 0) {
    console.error(`No hay casos en el conjunto "${conjunto}".`);
    process.exit(1);
  }
  const dir = path.join(DIR_CORRIDAS, variante);
  mkdirSync(dir, { recursive: true });
  const cola = new PQueue({ concurrency: CONCURRENCIA });
  const empezado = Date.now();
  let ok = 0;
  let fallos = 0;

  console.log(
    `${casos.length} casos × ${n} muestras = ${casos.length * n} guiones · variante "${variante}" · ${llm.model}\n`,
  );

  await Promise.all(
    casos.flatMap((caso) =>
      Array.from({ length: n }, (_, muestra) =>
        cola.add(async () => {
          const targetWords = wordTarget(caso.targetMinutes);
          const perfil = perfilDelCanal();
          const system = scriptSystem(perfil, targetWords);
          const user = scriptUser({
            idea: {
              title: caso.idea.title,
              angle: caso.idea.angle,
              summary: caso.idea.summary,
              whyNow: caso.idea.whyNow,
            },
            research: caso.research,
            targetWords,
            language: perfil.language,
            editedScenes: [],
          });
          // El banco gasta dinero de verdad y tiene que verse. Sin esto, el
          // ledger —y con él el coste del mes del dashboard— solo cuenta lo que
          // pasa por la cola: marcaba 1,85 $ cuando la clave llevaba 3,05 $
          // gastados, y esa diferencia son exactamente las tandas del banco.
          // Va con `video_id` nulo porque no pertenece a ningún vídeo, y con la
          // variante en `meta` para poder atribuir el gasto a cada vuelta.
          const handle = await openCost(db, {
            videoId: null,
            channelId: perfilCanalId,
            provider: llm.ledgerProvider,
            operation: 'script',
            meta: { banco: variante, caso: caso.id, muestra: muestra + 1, model: llm.model },
          });
          try {
            const { data: gen, usage } = await llm.completeJson({
              op: 'script',
              system,
              user,
              schema: scriptGenSchema,
              // La semilla depende del CASO y de la MUESTRA, nunca de la
              // variante: así la muestra 2 del caso X se compara con la muestra
              // 2 del caso X de la otra variante, y la única diferencia entre
              // las dos es el prompt. Sin esto el diff mide sobre todo azar.
              seed: semilla(caso.id, muestra),
              mockContext: { ideaTitle: caso.idea.title },
            });
            const base = path.join(dir, `${caso.id}-${muestra + 1}`);
            writeFileSync(`${base}.md`, comoDocumento(caso, gen));
            writeFileSync(
              `${base}.json`,
              `${JSON.stringify(
                {
                  caso: caso.id,
                  conjunto: caso.conjunto,
                  familia: caso.familia,
                  variante,
                  muestra: muestra + 1,
                  git_sha: gitSha(),
                  // lo ÚNICO que permite decir dentro de tres meses «este guion
                  // salió de este prompt»
                  prompt_sha: sha(`${system}\n \n${user}`),
                  modelo: llm.model,
                  tokens: usage,
                  script: gen.script,
                  seo: gen.seo,
                },
                null,
                2,
              )}\n`,
            );
            await closeCost(db, handle, usageCost(usage, llm.model));
            ok += 1;
            process.stdout.write('.');
          } catch (err) {
            // la llamada fallida también se ha pagado si llegó al proveedor
            await failCost(db, handle, err instanceof Error ? err.message : String(err));
            fallos += 1;
            process.stdout.write('x');
            logger.warn({ caso: caso.id, err }, 'guion fallido');
          }
        }),
      ),
    ),
  );

  await client.end();
  const seg = ((Date.now() - empezado) / 1000).toFixed(0);
  console.log(`\n\n${ok} guiones en ${seg} s${fallos > 0 ? ` · ${fallos} fallidos` : ''}`);
  console.log(`   ${dir}`);
  console.log(`\nAhora: pnpm guion --medir ${variante}`);
}

interface Metricas {
  guiones: number;
  escenas: number;
  encabezadas: number;
  andamiaje: number;
  promesa_no_producible: number;
  meta_narracion: number;
  objeciones_seguidas: number;
  cliche: number;
  cifra_sin_claim: number;
  palabras_media: number;
  // tasas: lo único comparable entre corridas de distinto tamaño
  rotuladas_pct: number;
  promesas_x_guion: number;
  meta_x_guion: number;
  /** palabras de la última frase de cada escena, en media */
  cierre_medio: number;
  /** % de escenas que cierran con ocho palabras o menos */
  cierres_cortos_pct: number;
}

function medir(variante: string): Metricas | null {
  const dir = path.join(DIR_CORRIDAS, variante);
  if (!existsSync(dir)) return null;
  const casos = new Map(cargarCasos('todos').map((c) => [c.id, c]));
  const m: Metricas = {
    guiones: 0,
    escenas: 0,
    encabezadas: 0,
    andamiaje: 0,
    promesa_no_producible: 0,
    meta_narracion: 0,
    objeciones_seguidas: 0,
    cliche: 0,
    cifra_sin_claim: 0,
    palabras_media: 0,
    rotuladas_pct: 0,
    promesas_x_guion: 0,
    meta_x_guion: 0,
    cierre_medio: 0,
    cierres_cortos_pct: 0,
  };
  let palabras = 0;
  const cierres: number[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const caso = casos.get(j.caso);
    const scenes: Scene[] = j.script.scenes;
    m.guiones += 1;
    m.escenas += scenes.length;
    m.encabezadas += escenasEncabezadas(scenes);
    palabras += scriptWords(scenes);
    for (const s of scenes) cierres.push(palabrasDelCierre(s.text));
    for (const h of lintScenes(scenes, { claims: caso?.research.claims ?? [] })) {
      if (h.kind === 'andamiaje') m.andamiaje += 1;
      if (h.kind === 'promesa_no_producible') m.promesa_no_producible += 1;
      if (h.kind === 'meta_narracion') m.meta_narracion += 1;
      if (h.kind === 'objeciones_seguidas') m.objeciones_seguidas += 1;
      if (h.kind === 'cliche') m.cliche += 1;
      if (h.kind === 'cifra_sin_claim') m.cifra_sin_claim += 1;
    }
  }
  m.palabras_media = m.guiones > 0 ? Math.round(palabras / m.guiones) : 0;
  // Las tasas son lo que se compara. Comparar CONTEOS entre corridas mezcla
  // «menos rótulos» con «menos escenas»: las corridas del mismo prompt han
  // salido con 256, 272 y 288 escenas, así que un −27 en el conteo podía ser
  // simplemente un guion más corto.
  const porCien = (n: number) => (m.escenas > 0 ? Math.round((1000 * n) / m.escenas) / 10 : 0);
  const porGuion = (n: number) => (m.guiones > 0 ? Math.round((10 * n) / m.guiones) / 10 : 0);
  m.cierre_medio =
    cierres.length > 0
      ? Math.round((10 * cierres.reduce((a, b) => a + b, 0)) / cierres.length) / 10
      : 0;
  m.cierres_cortos_pct =
    cierres.length > 0
      ? Math.round((1000 * cierres.filter((n) => n <= 8).length) / cierres.length) / 10
      : 0;
  m.rotuladas_pct = porCien(m.andamiaje);
  m.promesas_x_guion = porGuion(m.promesa_no_producible);
  m.meta_x_guion = porGuion(m.meta_narracion);
  return m;
}

/**
 * El porcentaje de cierres cortos tiene TECHO, no solo suelo.
 *
 * La primera versión de la regla de ritmo pedía que cada escena cerrara con
 * ocho palabras o menos. La métrica subió del 11 % al 74 % y el texto empeoró:
 * el modelo le pegaba a cada escena un imperativo genérico («Mantén el control
 * local», «Decide según tu riesgo», «Sigue leyendo»). Si todas las escenas
 * rematan, ninguna remata.
 *
 * Referencia: el único guion del corpus que se lee bien está en el 30 %. La
 * banda 20-45 % lo contiene con margen a los dos lados.
 *
 * La lección general, y vale para cualquier métrica que se añada aquí: una
 * medida en la que «más es mejor» acaba jugada. Si un valor extremo no puede
 * ser malo, la métrica no está midiendo calidad.
 */
export function enBandaDeCierre(pct: number): boolean {
  return pct >= 20 && pct <= 45;
}

function imprimirMetricas(variante: string, m: Metricas): void {
  const pct = m.escenas > 0 ? Math.round((m.encabezadas / m.escenas) * 100) : 0;
  console.log(`\n${variante}: ${m.guiones} guiones · ${m.escenas} escenas`);
  console.log(`  encabezadas      ${m.encabezadas} de ${m.escenas} (${pct} %)`);
  console.log(`  andamiaje        ${m.andamiaje}`);
  console.log(`  promesa impagable ${m.promesa_no_producible}`);
  console.log(`  meta-narración   ${m.meta_narracion}`);
  console.log(`  objeciones segui ${m.objeciones_seguidas}`);
  console.log(`  muletillas       ${m.cliche}`);
  console.log(`  cifra sin claim  ${m.cifra_sin_claim}`);
  console.log(`  palabras (media) ${m.palabras_media}`);
  console.log(`  ── tasas ──`);
  console.log(`  rotuladas        ${m.rotuladas_pct} % de las escenas`);
  console.log(`  promesas/guion   ${m.promesas_x_guion}`);
  console.log(`  meta/guion       ${m.meta_x_guion}`);
  const banda = enBandaDeCierre(m.cierres_cortos_pct);
  console.log(
    `  cierre de escena ${m.cierre_medio} palabras · ${m.cierres_cortos_pct} % de ≤8 ` +
      `${banda ? '(en banda)' : '← FUERA de 20-45 %'}`,
  );
}

/**
 * Cuánto se mueve cada métrica entre dos corridas del MISMO prompt.
 *
 * Medido sobre CUATRO corridas idénticas (`s2`, `s2-bis`, `sem-a`, `sem-b`),
 * 6 casos × 3 muestras cada una. La tasa de escenas rotuladas salió 48 %, 36 %,
 * 38 % y 31 %: media 38, desviación 7,1 puntos entre corridas, así que la banda
 * de una DIFERENCIA a dos sigmas es ±20 puntos. Los conteos crudos llevan banda
 * proporcionalmente mayor porque además cambia el número de escenas.
 *
 * Existe porque me pasó: leí un +13 y luego un +27 de `andamiaje` como si el
 * prompt hubiera empeorado, escribí la conclusión en un comentario del código,
 * y al correr el mismo prompt otra vez salió −31.
 *
 * La semilla NO es una salida: se añadió `seed` al proveedor y se probó con dos
 * corridas idénticas; la banda no bajó. gpt-5-mini razona antes de responder y
 * la semilla no se honra. Lo único que estrecha la banda es subir las muestras,
 * y va con la raíz: pasar de 3 a 12 muestras por caso la deja en ±10 puntos.
 *
 * Un cambio que no supere la banda NO se acepta como mejora.
 */
const BANDA_RUIDO: Record<keyof Metricas, number> = {
  guiones: 0,
  escenas: 0,
  encabezadas: 31,
  andamiaje: 31,
  promesa_no_producible: 9,
  meta_narracion: 6,
  objeciones_seguidas: 4,
  cliche: 1,
  cifra_sin_claim: 0,
  palabras_media: 33,
  rotuladas_pct: 20,
  promesas_x_guion: 0.6,
  meta_x_guion: 0.4,
  // Sobre cientos de cierres por corrida esta métrica es MUY estable, que es lo
  // que la hace útil: cinco corridas dieron 15,0 / 15,3 / 15,8 / 15,9 / 16,2
  // (sd 0,45) y 7,6 / 8,8 / 11,2 / 12,1 / 13,3 % (sd 2,3). Objetivo, medido
  // sobre el único guion del corpus que se lee bien: 11,2 palabras y 30 %.
  cierre_medio: 1.3,
  cierres_cortos_pct: 7,
};

/**
 * Mide varias corridas juntas. Comparar UNA corrida contra UNA corrida es la
 * trampa que esto viene a evitar: con una banda de ±20 puntos, el resultado
 * depende de contra cuál de las corridas de línea base se compare. Agrupando,
 * la línea base gana precisión con la raíz del número de corridas.
 *
 *   pnpm guion --diff s2,s2-bis,sem-a,sem-b s3-movimientos
 */
function medirVarias(nombres: string[]): Metricas | null {
  const ms = nombres.map(medir);
  if (ms.some((m) => m === null)) return null;
  const vivos = ms as Metricas[];
  const suma = (k: keyof Metricas) => vivos.reduce((n, m) => n + m[k], 0);
  const m: Metricas = {
    guiones: suma('guiones'),
    escenas: suma('escenas'),
    encabezadas: suma('encabezadas'),
    andamiaje: suma('andamiaje'),
    promesa_no_producible: suma('promesa_no_producible'),
    meta_narracion: suma('meta_narracion'),
    objeciones_seguidas: suma('objeciones_seguidas'),
    cliche: suma('cliche'),
    cifra_sin_claim: suma('cifra_sin_claim'),
    // medias, no sumas
    palabras_media: Math.round(
      vivos.reduce((n, x) => n + x.palabras_media * x.guiones, 0) / suma('guiones'),
    ),
    rotuladas_pct: 0,
    promesas_x_guion: 0,
    meta_x_guion: 0,
    cierre_medio: 0,
    cierres_cortos_pct: 0,
  };
  // Las tasas se calculan DESPUÉS: dentro del literal, `m.escenas` todavía no
  // existe y el fallo es un ReferenceError en tiempo de ejecución, no de tipos.
  const ponderada = (k: 'cierre_medio' | 'cierres_cortos_pct'): number =>
    m.escenas > 0
      ? Math.round((10 * vivos.reduce((n, x) => n + x[k] * x.escenas, 0)) / m.escenas) / 10
      : 0;
  m.cierre_medio = ponderada('cierre_medio');
  m.cierres_cortos_pct = ponderada('cierres_cortos_pct');
  m.rotuladas_pct = Math.round((1000 * m.andamiaje) / m.escenas) / 10;
  m.promesas_x_guion = Math.round((10 * m.promesa_no_producible) / m.guiones) / 10;
  m.meta_x_guion = Math.round((10 * m.meta_narracion) / m.guiones) / 10;
  return m;
}

function diff(a: string, b: string): void {
  const nombresA = a.split(',');
  const nombresB = b.split(',');
  const ma = medirVarias(nombresA);
  const mb = medirVarias(nombresB);
  if (!ma || !mb) {
    console.error(`Falta alguna corrida de ${!ma ? a : b}.`);
    process.exit(1);
  }
  if (nombresA.length > 1 || nombresB.length > 1) {
    console.log(
      `\n  línea base: ${nombresA.length} corrida(s), ${ma.guiones} guiones · ` +
        `variante: ${nombresB.length} corrida(s), ${mb.guiones} guiones`,
    );
  }
  console.log(`\n${a} → ${b}\n`);
  let algunaSenal = false;
  // Comparación PAREADA: los mismos guiones antes y después (una reparación).
  // La banda de ruido mide la varianza entre corridas INDEPENDIENTES; aplicarla
  // aquí escondería un efecto real, porque el azar del muestreo es el mismo a
  // los dos lados.
  const pareada = nombresB.length === 1 && nombresB[0] === `${nombresA[0]}-reparado`;
  if (pareada) {
    console.log('  (comparación pareada: mismos guiones antes y después, la banda no aplica)');
  }
  const tamanoDistinto = ma.guiones !== mb.guiones;
  const soloTasas: (keyof Metricas)[] = [
    'guiones',
    'escenas',
    'rotuladas_pct',
    'promesas_x_guion',
    'meta_x_guion',
    'palabras_media',
    'cierre_medio',
    'cierres_cortos_pct',
  ];
  for (const k of Object.keys(ma) as (keyof Metricas)[]) {
    // con corridas de distinto tamaño, los conteos crudos comparan manzanas con
    // peras: 80 rótulos en 544 escenas es la mitad de tasa que 83 en 272
    if (tamanoDistinto && !soloTasas.includes(k)) continue;
    const d = mb[k] - ma[k];
    const banda = pareada ? 0 : BANDA_RUIDO[k];
    const senal = Math.abs(d) > banda;
    if (senal) algunaSenal = true;
    const flecha = d === 0 ? '=' : d < 0 ? '↓' : '↑';
    const marca = d === 0 ? '' : senal ? '  ← señal' : `  (ruido: banda ±${banda})`;
    console.log(
      `  ${k.padEnd(22)} ${String(ma[k]).padStart(5)} → ${String(mb[k]).padStart(5)}  ` +
        `${flecha} ${d > 0 ? '+' : ''}${d}${marca}`,
    );
  }
  if (!algunaSenal) {
    console.log('\n  Nada supera la banda de ruido: este cambio NO se puede llamar mejora.');
  }
}

// El perfil del canal se lee del propio banco para no depender de la BD al
// correr: si cambia el perfil, cambian los guiones, y eso tiene que quedar
// registrado como un cambio del banco, no colarse por debajo.
let perfilCache: ChannelProfile | null = null;
function perfilDelCanal(): ChannelProfile {
  if (perfilCache) return perfilCache;
  const f = path.join(RAIZ, 'perfil.json');
  if (!existsSync(f)) {
    console.error(`Falta ${f}. Ejecuta antes: pnpm guion preparar`);
    process.exit(1);
  }
  perfilCache = JSON.parse(readFileSync(f, 'utf8')) as ChannelProfile;
  return perfilCache;
}

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * La portería: las comprobaciones DETERMINISTAS de las ocho de la rúbrica.
 *
 * Las otras cuatro —reordenación, corte, dónde se paga la promesa y el minuto
 * tres— son de juicio y viven en los veredictos; esto no las sustituye ni las
 * finge. Devuelve código de salida para poder ponerlo en un gate.
 *
 * El conjunto de CONTROL se evalúa aquí y solo aquí: si se mira antes, deja de
 * ser control y se pierde la única defensa contra el sobreajuste.
 */
function porteria(variante: string): void {
  const dir = path.join(DIR_CORRIDAS, variante);
  if (!existsSync(dir)) {
    console.error(`No existe la corrida "${variante}".`);
    process.exit(1);
  }
  const casos = new Map(cargarCasos('todos').map((c) => [c.id, c]));
  const ficheros = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let fallos = 0;
  const porCaso = new Map<
    string,
    {
      rotuladas: number;
      promesas: number;
      fontaneria: number;
      entidades: number;
      escenas: number;
      conjunto: string;
    }
  >();

  for (const f of ficheros) {
    const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const scenes: Scene[] = j.script.scenes;
    const caso = casos.get(j.caso);
    const hits = lintScenes(scenes, { claims: caso?.research.claims ?? [] });
    const ent = new Set<string>();
    for (const s of scenes) for (const e of entidadesNombradas(s.text)) ent.add(e);
    const acc = porCaso.get(j.caso) ?? {
      rotuladas: 0,
      promesas: 0,
      fontaneria: 0,
      entidades: 0,
      escenas: 0,
      conjunto: caso?.conjunto ?? '?',
    };
    acc.rotuladas += escenasEncabezadas(scenes);
    acc.escenas += scenes.length;
    acc.promesas += hits.filter((h) => h.kind === 'promesa_no_producible').length;
    acc.fontaneria += hits.filter((h) => h.kind === 'meta_narracion').length;
    acc.entidades += ent.size;
    porCaso.set(j.caso, acc);
  }

  console.log(`\nPortería · ${variante} · ${ficheros.length} guiones de ${porCaso.size} casos\n`);
  const linea = (ok: boolean, txt: string) => {
    if (!ok) fallos += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${txt}`);
  };
  for (const [id, a] of [...porCaso.entries()].sort()) {
    const pct = a.escenas > 0 ? Math.round((100 * a.rotuladas) / a.escenas) : 0;
    console.log(`\n  ${id.slice(0, 12)} (${a.conjunto})`);
    linea(
      a.rotuladas === 0,
      `1· ninguna escena abre con rótulo — ${a.rotuladas} de ${a.escenas} (${pct} %)`,
    );
    linea(a.promesas === 0, `2· ninguna promesa impagable — ${a.promesas}`);
    linea(a.fontaneria === 0, `3· ninguna meta-narración — ${a.fontaneria}`);
    linea(a.entidades > 0, `6· nombra algo real — ${a.entidades} entidades distintas`);
  }
  console.log(
    '\n  4· reordenación · 5· corte · 7· dónde se paga la promesa · 8· minuto tres',
    '\n     Son de JUICIO: se leen los guiones y se escribe el veredicto. La portería no los finge.',
  );
  console.log(`\n${fallos === 0 ? 'PASA' : `NO PASA: ${fallos} comprobaciones fallidas`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * La pasada de REPARACIÓN, que el banco no estaba midiendo.
 *
 * En producción, el juez llama al refinado con las escenas que el linter marca
 * como duras (`blockingSceneIds` → `patch_targets`), y `andamiaje` es una de
 * ellas. O sea que el guion que se publica NO es el que sale del generador: es
 * el que sale del generador con hasta cuatro escenas reescritas.
 *
 * El banco medía solo lo primero, así que su número de rótulos era el de ANTES
 * de reparar. Esto cierra el bucle: coge una corrida, repara lo que el linter
 * marcaría, y vuelve a medir. Es también la prueba de que el bucle CIERRA: si
 * el refinado reescribe una escena y le vuelve a poner un rótulo, no sirve.
 */
async function reparar(variante: string): Promise<void> {
  loadEnv();
  const llm = createLlm(logger);
  const dir = path.join(DIR_CORRIDAS, variante);
  if (!existsSync(dir)) {
    console.error(`No existe la corrida "${variante}".`);
    process.exit(1);
  }
  const casos = new Map(cargarCasos('todos').map((c) => [c.id, c]));
  const perfil = perfilDelCanal();
  const destino = path.join(DIR_CORRIDAS, `${variante}-reparado`);
  mkdirSync(destino, { recursive: true });
  const cola = new PQueue({ concurrency: CONCURRENCIA });
  let tocados = 0;
  let escenasReescritas = 0;

  const ficheros = readdirSync(dir).filter((f) => f.endsWith('.json'));
  await Promise.all(
    ficheros.map((f) =>
      cola.add(async () => {
        const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        const caso = casos.get(j.caso);
        const scenes: Scene[] = j.script.scenes;
        const hits = lintScenes(scenes, { claims: caso?.research.claims ?? [] });
        const duros = blockingSceneIds(hits).slice(0, 4);
        if (duros.length === 0) {
          writeFileSync(path.join(destino, f), JSON.stringify(j, null, 2));
          process.stdout.write('.');
          return;
        }
        const objetivos = scenes.filter((s) => duros.includes(s.id));
        const notas = duros.map((id) => {
          const h = hits.find((x) => x.id === id && BLOCKING_LINT_KINDS.includes(x.kind))!;
          return {
            id,
            axis: h.kind,
            issue: h.detail,
            fix:
              h.kind === 'andamiaje'
                ? 'reescribe la escena para que empiece con una frase normal, sin rótulo ni dos puntos al principio'
                : 'reescribe la escena corrigiendo eso, conservando el contenido',
          };
        });
        try {
          const { data } = await llm.completeJson({
            op: 'refine',
            system: refineSystem(perfil),
            user: instruccionesDeRefinado(scenes, objetivos, [], notas),
            schema: refineOutputSchema,
            mockContext: { scenes: objetivos.map((s) => ({ id: s.id, seed: s.id, words: 50 })) },
          });
          const nuevos = new Map(data.scenes.map((s) => [s.id, s.text]));
          j.script.scenes = scenes.map((s) => {
            const t = nuevos.get(s.id);
            return t !== undefined && duros.includes(s.id) ? { ...s, text: t } : s;
          });
          tocados += 1;
          escenasReescritas += duros.length;
          process.stdout.write('r');
        } catch {
          process.stdout.write('x');
        }
        writeFileSync(path.join(destino, f), JSON.stringify(j, null, 2));
      }),
    ),
  );
  console.log(
    `\n\n${tocados} de ${ficheros.length} guiones reparados · ${escenasReescritas} escenas reescritas`,
  );
  console.log(`\nAhora: pnpm guion --diff ${variante} ${variante}-reparado`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'preparar') {
    await preparar();
    await congelarPerfil();
    return;
  }
  const rep = arg('reparar');
  if (rep !== undefined) {
    await reparar(rep);
    return;
  }
  const port = arg('porteria');
  if (port !== undefined) {
    porteria(port);
    return;
  }
  const medirVar = arg('medir');
  if (medirVar !== undefined) {
    const m = medir(medirVar);
    if (!m) {
      console.error(`No existe la corrida "${medirVar}".`);
      process.exit(1);
    }
    imprimirMetricas(medirVar, m);
    return;
  }
  const i = process.argv.indexOf('--diff');
  if (i >= 0) {
    diff(process.argv[i + 1]!, process.argv[i + 2]!);
    return;
  }
  const leer = arg('leer');
  if (leer !== undefined) {
    const dir = path.join(DIR_CORRIDAS, leer);
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith('.md'))
      .sort()) {
      console.log(path.join(dir, f));
    }
    return;
  }
  const variante = arg('variante');
  if (variante === undefined) {
    console.error(
      [
        'Uso:',
        '  pnpm guion preparar',
        '  pnpm guion --variante <nombre> [--casos dev|control|todos] [--n 3]',
        '  pnpm guion --medir <variante>',
        '  pnpm guion --diff <a> <b>',
        '  pnpm guion --leer <variante>',
        '  pnpm guion --porteria <variante>',
        '  pnpm guion --reparar <variante>',
      ].join('\n'),
    );
    process.exit(1);
  }
  const conjunto = (arg('casos') ?? 'dev') as 'dev' | 'control' | 'todos';
  if (conjunto === 'control') {
    // Mirar el control durante la iteración lo convierte en dev y se pierde la
    // única defensa contra el sobreajuste. No se bloquea, se deja constancia.
    console.log('⚠ Estás corriendo el conjunto de CONTROL. Solo al cerrar un sprint.\n');
  }
  await correr(variante, conjunto, Number(arg('n') ?? 3));
}

async function congelarPerfil(): Promise<void> {
  const { db, client } = createDb();
  try {
    const [canal] = await db.select().from(channels).limit(1);
    if (canal?.profile) {
      writeFileSync(path.join(RAIZ, 'perfil.json'), `${JSON.stringify(canal.profile, null, 2)}\n`);
      console.log(`✓ perfil del canal congelado en ${path.join(RAIZ, 'perfil.json')}`);
    }
  } finally {
    await client.end();
  }
}

await main();
