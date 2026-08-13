import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EDIT_TYPES, SHORT_EDIT_ALLOWED, type EditType } from '@fabrica/shared';

// El banco de frases del director de formas (plan-dibujar-ideas.md, Fase 5):
// 30-40 frases reales de los guiones producidos con la forma que un editor
// humano elegiría. Este test NO llama al LLM — medir al director de verdad es
// cosa de un banco con proveedor, como `pnpm rerank` — pero sí mide lo que se
// puede medir en CI: qué parte del banco puede DIBUJARSE con el catálogo
// actual. El % va en el nombre del test a propósito («reporta, no exige»):
// acoplarlo a un umbral duro antes de tener el director de formas sería
// repetir el error del 74 % documentado en docs/calidad.md.

// Vocabulario del plan: las formas del catálogo + las seis relaciones nuevas.
const FORMAS_NUEVAS = ['cuello', 'barras', 'linea_tiempo', 'arbol', 'capas', 'ciclo'] as const;
const formaSchema = z.enum([...EDIT_TYPES, ...FORMAS_NUEVAS]);

const bancoSchema = z.object({
  etiquetado: z.string(),
  frases: z
    .array(
      z.object({
        id: z.string().min(1),
        video: z.string().min(1),
        forma: formaSchema,
        frase: z.string().min(10),
      }),
    )
    .min(30)
    .max(40),
});

const raw = readFileSync(
  fileURLToPath(new URL('../../../../../calibracion/frases-etiquetadas.json', import.meta.url)),
  'utf8',
);
const banco = bancoSchema.parse(JSON.parse(raw));

// «cuello» está cubierto por el catálogo sin forma propia: el propio plan dice
// que pasos_flow con la última estación acentuada ES un cuello de botella (y el
// componente acentúa la última estación desde su port).
const EQUIVALENCIAS: Partial<Record<(typeof FORMAS_NUEVAS)[number], EditType>> = {
  cuello: 'pasos_flow',
};

function formaEnCatalogo(forma: z.infer<typeof formaSchema>): EditType | null {
  if ((EDIT_TYPES as readonly string[]).includes(forma)) return forma as EditType;
  return EQUIVALENCIAS[forma as (typeof FORMAS_NUEVAS)[number]] ?? null;
}

const total = banco.frases.length;
const cubiertas = banco.frases.filter((f) => formaEnCatalogo(f.forma) !== null);
const pctCatalogo = Math.round((cubiertas.length / total) * 100);
const enVertical = cubiertas.filter((f) => SHORT_EDIT_ALLOWED[formaEnCatalogo(f.forma)!]);
const pctVertical = Math.round((enVertical.length / total) * 100);

const frecuencia = new Map<string, number>();
for (const f of banco.frases) frecuencia.set(f.forma, (frecuencia.get(f.forma) ?? 0) + 1);
const nuevasPorFrecuencia = FORMAS_NUEVAS.map((forma) => ({
  forma,
  n: frecuencia.get(forma) ?? 0,
  cubierta: formaEnCatalogo(forma) !== null,
})).sort((a, b) => b.n - a.n);

describe(`banco de frases · ${total} frases · catálogo cubre ${pctCatalogo} % (${cubiertas.length}/${total}) · vertical ${pctVertical} %`, () => {
  it('el fichero es un banco válido: ids únicos y frases de los vídeos producidos', () => {
    const ids = new Set(banco.frases.map((f) => f.id));
    expect(ids.size).toBe(total);
    // cada frase viene de uno de los maestros congelados en outputs/
    const videos = new Set(banco.frases.map((f) => f.video));
    expect(videos.size).toBeGreaterThanOrEqual(3);
  });

  it('reporta la frecuencia de las formas nuevas: es lo que decide cuáles se implementan', () => {
    // La tabla que justifica la elección de la Fase 2. Se imprime para que la
    // decisión sea auditable en el log de CI, no para exigir un número.

    console.log('formas nuevas por frecuencia en el banco:');
    for (const { forma, n, cubierta } of nuevasPorFrecuencia) {
      console.log(`  ${forma.padEnd(14)} ${n}${cubierta ? '  (ya expresable en el catálogo)' : ''}`);
    }
    console.log(`cobertura del catálogo: ${pctCatalogo} % · permitido en vertical: ${pctVertical} %`);
    // el banco tiene que seguir conteniendo señal para las formas nuevas: si
    // alguien lo poda hasta dejar solo formas viejas, deja de medir el sprint
    expect(nuevasPorFrecuencia.some((f) => f.n > 0)).toBe(true);
  });
});
