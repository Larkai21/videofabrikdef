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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
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
  const bloques = filas.map((f) => {
    const opciones = f.candidatos
      .map((c, i) => `    ${i + 1}. [${c.kind}] ${c.caption}`)
      .join('\n');
    return `BEAT ${f.beat}\n  se oye: ${f.narracion.replace(/\s+/g, ' ').slice(0, 220)}\n  candidatos:\n${opciones}`;
  });
  const system = [
    'Eres montador de un canal de YouTube. Para cada beat te doy lo que se OYE',
    'y los pies de foto de los planos de archivo disponibles.',
    'Elige el plano que un espectador aceptaría como ilustración de esa frase.',
    'Criterio: que el plano muestre el SUJETO del que se habla, o una escena en',
    'la que eso ocurriría. No vale que comparta el tema general.',
    'Si ninguno lo cumple, responde 0. Vale la pena responder 0: un plano que no',
    'pega se nota más que un plano repetido.',
    'Responde SOLO JSON: {"beats":[{"idx":number,"elegido":number}]}, con elegido',
    'entre 1 y el número de candidatos, o 0 si ninguno sirve.',
  ].join('\n');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.RERANK_MODEL ?? 'openai/gpt-5-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: bloques.join('\n\n') },
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
    beats?: { idx: number; elegido: number }[];
  };
  console.log(`   (juez: ${json.usage?.total_tokens ?? '?'} tokens)`);
  const out = new Map<number, string | null>();
  for (const b of parsed.beats ?? []) {
    const fila = filas.find((f) => f.beat === b.idx);
    if (!fila) continue;
    out.set(b.idx, b.elegido >= 1 ? (fila.candidatos[b.elegido - 1]?.ref ?? null) : null);
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

await main();
