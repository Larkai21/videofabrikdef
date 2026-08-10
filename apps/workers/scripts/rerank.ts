/**
 * Banco de matching: probar reglas de ordenación sobre planos ya etiquetados,
 * sin tocar la cola ni gastar una llamada.
 *
 *   pnpm rerank                    # compara todas las reglas
 *   pnpm rerank --detalle          # además, beat a beat
 *
 * De dónde salen las etiquetas: de curar a mano los 25 beats de un vídeo real
 * (calibracion/planos-etiquetados.jsonl). No es una muestra grande, pero es la
 * primera señal humana que existe sobre este problema —de 181 beats curados en
 * producción no salió ni un descarte, porque la puerta estaba rota— y sirve
 * para lo único que importa aquí: saber si un cambio mejora o empeora, en vez
 * de discutirlo.
 *
 * La medida es «acierto@1»: con qué frecuencia el candidato que la regla pone
 * primero es el que eligió el humano. La línea base (coseno tal cual) es 13/24.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { IMAGE_HANDICAP } from '@fabrica/shared';
import { createEmbeddings, cosineSimilarity } from '../src/providers/embeddings.js';

interface Candidato {
  ref: string;
  provider: string;
  kind: string;
  caption: string;
  cos: number;
}
interface Fila {
  video: string;
  beat: number;
  query: string;
  narracion: string;
  elegido: string | null;
  /** los que un espectador NO rechazaría, no «el mejor». Ver README del banco. */
  aceptables?: string[];
  /** solo filas de producción: refs que el humano descartó explícitamente */
  vetados?: string[];
  /** fila exportada de producción: `aceptables` desconocidos más allá de `elegido` */
  parcial?: boolean;
  candidatos: Candidato[];
}

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const detalle = process.argv.includes('--detalle');

function cargar(): Fila[] {
  return readFileSync(path.join(raiz, 'calibracion/planos-etiquetados.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Fila);
}

/**
 * Filas exportadas de la curación real (scripts/exportar-etiquetas.ts).
 * Van en fichero aparte y se miden aparte: son PARCIALES (solo se sabe el
 * elegido y, en los descartes, un disparate conocido), así que «sin disparate»
 * no aplica — mezclarlas con las filas a mano convertiría esa métrica en
 * acierto@1 sin que nadie lo note. El `beat` se reindexa a un entero único
 * porque aquí conviven varios vídeos y el banco indexa vectores por beat.
 */
function cargarProduccion(): Fila[] {
  const ruta = path.join(raiz, 'calibracion/planos-produccion.jsonl');
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l, i) => ({ ...(JSON.parse(l) as Fila), beat: i }));
}

/** Regla: dado un beat y los vectores, devuelve el ref que pondría primero. */
type Regla = (f: Fila, ctx: Ctx) => string;
interface Ctx {
  /** vector de la consulta de cada beat, por índice de beat */
  queryVec: Map<number, number[]>;
  /** vector del caption de cada candidato, por ref */
  capVec: Map<string, number[]>;
  /** todas las consultas del vídeo, para medir lo genérico */
  todasLasQueries: number[][];
}

const REGLAS: Record<string, Regla> = {
  // La línea base de verdad: lo que el pipeline puso primero y el humano vio
  // arriba en la ficha. NO es ordenar por coseno — el orden final sale del
  // compuesto (0,6·cos + calidad + novedad) y de la cascada de fit y vetos.
  pipeline: (f) => f.candidatos[0]!.ref,

  // Ordenar por coseno crudo, como diagnóstico: si sale peor que el pipeline,
  // es que la señal semántica aporta menos que la calidad y la novedad.
  coseno: (f) => [...f.candidatos].sort((a, b) => b.cos - a.cos)[0]!.ref,

  // Un plano que se parece a TODOS los beats del vídeo no se parece a ninguno:
  // es metraje de oficina genérico, que es justo lo que sobra en stock. Se le
  // resta su similitud media con el vídeo entero, así que compite por lo que
  // tiene de específico y no por lo que tiene de tecnológico.
  generico: (f, ctx) => {
    const puntuar = (c: Candidato): number => {
      const v = ctx.capVec.get(c.ref);
      if (!v) return c.cos;
      const medias = ctx.todasLasQueries.map((q) => cosineSimilarity(q, v));
      const fondo = medias.reduce((a, b) => a + b, 0) / Math.max(1, medias.length);
      return c.cos - LAMBDA * fondo;
    };
    return [...f.candidatos].sort((a, b) => puntuar(b) - puntuar(a))[0]!.ref;
  },

  // Igual, pero comparando contra la NARRACIÓN además de contra la consulta:
  // la consulta es una escena inventada por el director y la narración es lo
  // que de verdad se oye.
  narracion: (f, ctx) => {
    const nv = ctx.queryVec.get(-f.beat - 1);
    const puntuar = (c: Candidato): number => {
      const v = ctx.capVec.get(c.ref);
      if (!v || !nv) return c.cos;
      return 0.5 * c.cos + 0.5 * cosineSimilarity(nv, v);
    };
    return [...f.candidatos].sort((a, b) => puntuar(b) - puntuar(a))[0]!.ref;
  },

  'generico+narracion': (f, ctx) => {
    const nv = ctx.queryVec.get(-f.beat - 1);
    const puntuar = (c: Candidato): number => {
      const v = ctx.capVec.get(c.ref);
      if (!v) return c.cos;
      const medias = ctx.todasLasQueries.map((q) => cosineSimilarity(q, v));
      const fondo = medias.reduce((a, b) => a + b, 0) / Math.max(1, medias.length);
      const base = nv ? 0.5 * c.cos + 0.5 * cosineSimilarity(nv, v) : c.cos;
      return base - LAMBDA * fondo;
    };
    return [...f.candidatos].sort((a, b) => puntuar(b) - puntuar(a))[0]!.ref;
  },

  // Barrido del handicap de biblioteca: ¿penalizar (o no) a la biblioteca en
  // la ordenación cambia lo que el espectador rechazaría? Aproximación por
  // coseno efectivo (sin banda/loopPenalty del selectPick real): sirve para la
  // DIRECCIÓN del ajuste, no para el valor exacto.
  ...Object.fromEntries(
    [0, 0.03, 0.06].map((h) => [
      `handicap:${h}`,
      ((f: Fila): string =>
        [...f.candidatos].sort(
          (a, b) =>
            b.cos -
            (b.provider === 'library' ? h : 0) -
            (b.kind === 'image' ? IMAGE_HANDICAP : 0) -
            (a.cos - (a.provider === 'library' ? h : 0) - (a.kind === 'image' ? IMAGE_HANDICAP : 0)),
        )[0]!.ref) as Regla,
    ]),
  ),
};

const LAMBDA = Number(process.env.LAMBDA ?? '0.7');

/**
 * Un juez que LEE. Es la única regla que añade información en vez de reordenar
 * la que ya hay: el bi-encoder mete los seis candidatos en 0,03 de coseno y
 * ninguna combinación de esos números los separa, porque no están separados.
 *
 * Una sola llamada para todo el vídeo, con la narración y los seis pies de foto
 * por beat. Puede contestar 0, que significa «ninguno vale»: es la respuesta
 * que hoy no existe y la que evita el hacha partiendo leña sobre un gancho que
 * habla de sanciones.
 */
async function juezLee(filas: Fila[]): Promise<Map<number, string | null>> {
  const key = process.env.OPENROUTER_API_KEY ?? '';
  if (key === '') throw new Error('Falta OPENROUTER_API_KEY');
  // El PROMPT REAL del pipeline, no una copia. La copia que hubo aquí midió
  // 24/25 con un texto parecido-pero-distinto: cada vez que el prompt de
  // producción cambiara, el banco seguiría midiendo el antiguo sin avisar.
  const { buildRerankPrompt } = await import('../src/pipelines/assets/rerank.js');
  const planos = filas.map((f) => ({
    beatIdx: f.beat,
    vIdx: 0,
    text: f.narracion,
    query: f.query,
    candidates: f.candidatos.map((c) => ({
      ref: c.ref,
      provider: c.provider as 'library' | 'pexels' | 'pixabay' | 'flux' | 'wikimedia',
      score: c.cos,
      meta: { kind: c.kind, caption: c.caption },
    })),
  }));
  const { system, user } = buildRerankPrompt(planos);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.RERANK_MODEL ?? 'openai/gpt-5-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? 'error del proveedor');
  const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as {
    planos?: { idx: number; elegido: number }[];
  };
  console.log(`   (juez: ${json.usage?.total_tokens ?? '?'} tokens)`);
  const out = new Map<number, string | null>();
  // idx es la POSICIÓN en la lista enviada, como en producción
  for (const b of parsed.planos ?? []) {
    const fila = filas[b.idx];
    if (!fila) continue;
    out.set(fila.beat, b.elegido >= 1 ? (fila.candidatos[b.elegido - 1]?.ref ?? null) : null);
  }
  return out;
}

async function main(): Promise<void> {
  const filas = cargar();
  const conEtiqueta = filas.filter((f) => f.elegido !== null);
  const embeddings = createEmbeddings(pino({ level: 'warn' }));

  const queryVec = new Map<number, number[]>();
  const capVec = new Map<string, number[]>();

  const queries = filas.map((f) => f.query);
  const narraciones = filas.map((f) => f.narracion);
  const refs = [...new Set(filas.flatMap((f) => f.candidatos.map((c) => c.ref)))];
  const captions = new Map(filas.flatMap((f) => f.candidatos.map((c) => [c.ref, c.caption])));

  // Secuencial a propósito: con Promise.all los tres lotes salían con vectores
  // cruzados y las mismas reglas daban 8/24 o 4/24 según lo que tardara otra
  // llamada. Si el proveedor de embeddings no es seguro en concurrencia, este
  // banco no puede ser el sitio donde se descubra.
  const qv = await embeddings.embed(queries);
  const nv = await embeddings.embed(narraciones);
  const cv = await embeddings.embed(refs.map((r) => captions.get(r) ?? ''));
  filas.forEach((f, i) => {
    if (qv[i]) queryVec.set(f.beat, qv[i]!);
    if (nv[i]) queryVec.set(-f.beat - 1, nv[i]!);
  });
  refs.forEach((r, i) => {
    if (cv[i]) capVec.set(r, cv[i]!);
  });
  const ctx: Ctx = {
    queryVec,
    capVec,
    todasLasQueries: filas.map((f) => queryVec.get(f.beat)).filter((v): v is number[] => !!v),
  };

  // La medida que importa. «Coincide con mi elección» es demasiado estricta:
  // con cinco planos casi iguales, elegir el tercero en vez del cuarto no es un
  // error. Lo que se nota en pantalla es el plano que NO pega —el estudio de
  // radio con el cartel «ON AIR» sobre una frase que habla de un informe legal—
  // y eso es lo que mide `aceptables`.
  const conAcept = filas.filter((f) => Array.isArray(f.aceptables));
  const aceptable = (f: Fila, ref: string): boolean => (f.aceptables ?? []).includes(ref);

  console.log(`${conAcept.length} beats con planos aceptables marcados\n`);
  console.log('regla                 acierto@1   sin disparate');
  if (process.argv.includes('--juez')) {
    const veredicto = await juezLee(filas);
    const aciertos = conEtiqueta.filter((f) => veredicto.get(f.beat) === f.elegido);
    const ningunos = filas.filter((f) => veredicto.get(f.beat) === null);
    const conAceptJ = filas.filter((f) => Array.isArray(f.aceptables));
    const buenosJ = conAceptJ.filter((f) => {
      const v = veredicto.get(f.beat);
      // decir «ninguno» cuando de verdad no hay ninguno cuenta como acierto
      if (v === null || v === undefined) return (f.aceptables ?? []).length === 0;
      return (f.aceptables ?? []).includes(v);
    });
    console.log(
      `${'juez (LLM)'.padEnd(20)} ${String(aciertos.length).padStart(2)}/${conEtiqueta.length} (${((100 * aciertos.length) / conEtiqueta.length).toFixed(0).padStart(2)} %)  ${String(buenosJ.length).padStart(2)}/${conAceptJ.length} (${((100 * buenosJ.length) / conAceptJ.length).toFixed(0).padStart(2)} %)`,
    );
    console.log(
      `   dice «ninguno» en ${ningunos.length} beats (el humano no encontró plano en ${filas.filter((f) => f.elegido === null).length})`,
    );
    if (detalle) {
      for (const f of conEtiqueta) {
        const v = veredicto.get(f.beat);
        if (v === f.elegido) continue;
        console.log(`   beat ${f.beat} «${f.query}»`);
        console.log(
          `     juez: ${f.candidatos.find((c) => c.ref === v)?.caption.slice(0, 70) ?? 'NINGUNO'}`,
        );
        console.log(
          `     humano: ${f.candidatos.find((c) => c.ref === f.elegido)?.caption.slice(0, 70)}`,
        );
      }
    }
  }
  for (const [nombre, regla] of Object.entries(REGLAS)) {
    const aciertos = conEtiqueta.filter((f) => regla(f, ctx) === f.elegido);
    const pct = ((100 * aciertos.length) / conEtiqueta.length).toFixed(0);
    const buenos = conAcept.filter((f) => aceptable(f, regla(f, ctx)));
    const pct2 = ((100 * buenos.length) / conAcept.length).toFixed(0);
    console.log(
      `${nombre.padEnd(20)} ${String(aciertos.length).padStart(2)}/${conEtiqueta.length} (${pct.padStart(2)} %)  ${String(buenos.length).padStart(2)}/${conAcept.length} (${pct2.padStart(2)} %)`,
    );
    if (detalle) {
      for (const f of conEtiqueta) {
        const puesto = regla(f, ctx);
        if (puesto === f.elegido) continue;
        const cae = f.candidatos.find((c) => c.ref === puesto);
        const bien = f.candidatos.find((c) => c.ref === f.elegido);
        console.log(`   beat ${f.beat} «${f.query}»`);
        console.log(`     pone: ${cae?.caption.slice(0, 70)}`);
        console.log(`     debía: ${bien?.caption.slice(0, 70)}`);
      }
    }
  }
}

/**
 * Sección de producción: mismas reglas sobre las filas parciales. Dos números
 * por regla — acierto@1 sobre las que tienen elegido, y cuántas veces la regla
 * pone PRIMERO un plano que el humano descartó (disparate conocido).
 * `todasLasQueries` se agrupa por vídeo: penalizar lo genérico contra las
 * consultas de OTRO vídeo no mide nada.
 */
async function seccionProduccion(embeddings: ReturnType<typeof createEmbeddings>): Promise<void> {
  const filasP = cargarProduccion();
  if (filasP.length === 0) return;

  const queryVec = new Map<number, number[]>();
  const capVec = new Map<string, number[]>();
  const refs = [...new Set(filasP.flatMap((f) => f.candidatos.map((c) => c.ref)))];
  const captions = new Map(filasP.flatMap((f) => f.candidatos.map((c) => [c.ref, c.caption])));
  // secuencial, por el mismo motivo que arriba
  const qv = await embeddings.embed(filasP.map((f) => f.query));
  const nv = await embeddings.embed(filasP.map((f) => f.narracion));
  const cv = await embeddings.embed(refs.map((r) => captions.get(r) ?? ''));
  filasP.forEach((f, i) => {
    if (qv[i]) queryVec.set(f.beat, qv[i]!);
    if (nv[i]) queryVec.set(-f.beat - 1, nv[i]!);
  });
  refs.forEach((r, i) => {
    if (cv[i]) capVec.set(r, cv[i]!);
  });
  const porVideo = new Map<string, Fila[]>();
  for (const f of filasP) {
    porVideo.set(f.video, [...(porVideo.get(f.video) ?? []), f]);
  }

  const conElegido = filasP.filter((f) => f.elegido !== null);
  const conVetados = filasP.filter((f) => (f.vetados ?? []).length > 0);
  console.log(
    `\n--- producción (${filasP.length} filas de ${porVideo.size} vídeos; etiquetas PARCIALES: sin disparate no aplica) ---`,
  );
  console.log('regla                 acierto@1   pone un vetado 1º');
  for (const [nombre, regla] of Object.entries(REGLAS)) {
    let aciertos = 0;
    let vetadosPuestos = 0;
    for (const grupo of porVideo.values()) {
      const ctx: Ctx = {
        queryVec,
        capVec,
        todasLasQueries: grupo
          .map((f) => queryVec.get(f.beat))
          .filter((v): v is number[] => !!v),
      };
      for (const f of grupo) {
        const puesto = regla(f, ctx);
        if (f.elegido !== null && puesto === f.elegido) aciertos += 1;
        if ((f.vetados ?? []).includes(puesto)) vetadosPuestos += 1;
      }
    }
    console.log(
      `${nombre.padEnd(20)} ${String(aciertos).padStart(2)}/${conElegido.length}        ${String(vetadosPuestos).padStart(2)}/${conVetados.length}`,
    );
  }
}

await main();
await (async () => {
  const embeddings = createEmbeddings(pino({ level: 'warn' }));
  await seccionProduccion(embeddings);
})();
