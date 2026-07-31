import { describe, expect, it } from 'vitest';
import {
  BLOCKING_LINT_KINDS,
  blockingSceneIds,
  escenasEncabezadas,
  lintScenes,
} from './script-quality.js';

const CLAIMS = [
  { text: 'el índice subió un 70% en enero' },
  { text: 'ya son 2 millones de usuarios' },
];

const LEXICO = ['dato', 'coste', 'equipo', 'modelo', 'informe', 'plazo', 'cambio', 'motivo'];

/**
 * Relleno neutro: sin dígitos (el linter los leería como cifras) y partido en
 * frases de ocho palabras para no disparar el aviso de frase larga.
 */
function relleno(n: number): string {
  const palabras = Array.from({ length: n }, (_, i) => LEXICO[i % LEXICO.length] ?? 'dato');
  const frases: string[] = [];
  for (let i = 0; i < palabras.length; i += 8) frases.push(palabras.slice(i, i + 8).join(' '));
  return `${frases.join('. ')}.`;
}

const kinds = (hits: ReturnType<typeof lintScenes>): string[] => hits.map((h) => h.kind);

describe('lintScenes', () => {
  it('no marca nada en una escena limpia con una cifra respaldada', () => {
    // el control de falsos positivos es lo que decide si un linter así sirve
    const texto = `El índice subió un 70% en enero y eso cambia el cálculo. ${relleno(35)}`;
    expect(lintScenes([{ id: 'sc-1', text: texto }], { claims: CLAIMS })).toEqual([]);
  });

  it('detecta muletillas de texto generado', () => {
    const hits = lintScenes(
      [{ id: 'sc-1', text: `En un mundo donde todo cambia, esto importa. ${relleno(35)}` }],
      { claims: CLAIMS },
    );
    expect(kinds(hits)).toContain('cliche');
    // el detalle conserva la capitalización original para que el humano
    // encuentre la frase tal cual está escrita
    expect(hits[0]?.detail).toContain('En un mundo donde');
  });

  it('detecta exclamaciones y frases kilométricas', () => {
    const exclama = lintScenes([{ id: 'sc-1', text: `Esto es enorme. ${relleno(45)}!` }], {
      claims: CLAIMS,
    });
    expect(kinds(exclama)).toContain('exclamacion');

    const frase30 = Array.from({ length: 30 }, () => 'coste').join(' ');
    const larga = lintScenes([{ id: 'sc-1', text: `${frase30}. ${relleno(25)}` }], {
      claims: CLAIMS,
    });
    expect(kinds(larga)).toContain('frase_larga');
  });

  it('avisa de escenas fuera del rango de palabras', () => {
    expect(kinds(lintScenes([{ id: 'sc-1', text: relleno(20) }], { claims: CLAIMS }))).toContain(
      'escena_corta',
    );
    const largaHits = lintScenes(
      [{ id: 'sc-1', text: `${relleno(20)}. ${relleno(20)}. ${relleno(50)}.` }],
      {
        claims: CLAIMS,
      },
    );
    expect(kinds(largaHits)).toContain('escena_larga');
  });

  it('marca la cifra que no está en el research', () => {
    const hits = lintScenes(
      [{ id: 'sc-1', text: `El coste bajó un 45% este trimestre. ${relleno(35)}` }],
      { claims: CLAIMS },
    );
    const cifra = hits.filter((h) => h.kind === 'cifra_sin_claim');
    expect(cifra).toHaveLength(1);
    expect(cifra[0]?.detail).toContain('45');
  });

  it('acepta la cifra dicha con letra cuando el claim la trae en dígitos', () => {
    const texto = `Ya son 2 millones de usuarios y sigue subiendo. ${relleno(35)}`;
    const hits = lintScenes([{ id: 'sc-1', text: texto }], { claims: CLAIMS });
    expect(kinds(hits)).not.toContain('cifra_sin_claim');
  });
});

describe('blockingSceneIds', () => {
  it('solo bloquean el cliché y la cifra sin claim', () => {
    const hits = lintScenes(
      [
        { id: 'sc-1', text: `En la era de los datos todo cambia. ${relleno(35)}` },
        { id: 'sc-2', text: relleno(20) },
      ],
      { claims: CLAIMS },
    );
    expect(blockingSceneIds(hits)).toEqual(['sc-1']);
  });
});

describe('andamiaje del prompt locutado', () => {
  // Frases LITERALES de vídeos ya publicados. No son ejemplos inventados: cada
  // una está en el audio de un MP4 que salió de la fábrica.
  const reales = [
    'PUNTO MEDIO: estas herramientas funcionan, pero no son cajas negras perfectas.',
    'GIRO: lo más valioso no es ahorrar tiempo leyendo; es cambiar la tarea.',
    'Sí, pero: no todos los nichos pagan igual.',
    'Caso: Marta, 38 años, gestora de proyectos.',
    'Contexto social: muchas personas en tu situación están en riesgo económico.',
    'Giro: aunque exista evidencia sectorial del 25%, tu retorno puede variar.',
    'Primera idea: mapear lo que ya sabes.',
    'Paso tres: vectorizar. Cada fragmento se transforma en un vector.',
  ];

  it('marca las formas del andamiaje que se colaron en los vídeos reales', () => {
    for (const text of reales) {
      const hits = lintScenes([{ id: 'sc-body-1', text }], { claims: [] });
      expect(
        hits.some((h) => h.kind === 'andamiaje'),
        `no detectado: ${text}`,
      ).toBe(true);
    }
  });

  it('bloquea: no basta con avisar, el guion no puede salir así', () => {
    expect(BLOCKING_LINT_KINDS).toContain('andamiaje');
  });

  it('NO bloquea los dos puntos retóricos, que son buena escritura', () => {
    // «No fue un fallo: fue el diseño» está bien escrito. Bloquear esto sería
    // cambiar un defecto por otro peor: guiones que no pueden usar el recurso.
    const hits = lintScenes([{ id: 's2', text: 'No fue un fallo: fue el diseño.' }], {
      claims: [],
    });
    expect(hits.some((h) => h.kind === 'andamiaje')).toBe(false);
  });

  it('mide el agregado: doce de dieciséis escenas rotuladas no es un guion', () => {
    const escenas = [
      { text: 'Hardware: las entradas de capital apuntan a aceleradores.' },
      { text: 'Modelos: hay apuestas en modelos base y optimización.' },
      { text: 'Un contenedor sale de Shanghái y llega a Róterdam en treinta días.' },
    ];
    expect(escenasEncabezadas(escenas)).toBe(2);
  });

  it('caza los rótulos que el modelo se INVENTA, no solo los del prompt', () => {
    // La lista blanca anterior cubría 28 de 400 escenas reales. Estas salieron
    // del banco y ninguna aparece en prompts.ts: el modelo se las inventa, así
    // que una lista nunca puede ir por delante.
    for (const text of [
      'Arquitectura: Kimi-K3 declara muchas capas y atención de largo alcance.',
      'Demo rápida: puedes desplegar desde HuggingFace o la API pública.',
      'Riesgos legales potenciales: sin pruebas no podemos afirmar infracciones.',
      'Quién y dónde: la denuncia sale de una cuenta con pocos seguidores.',
      'Cómo minimizar riesgos: exige metadatos que registren el origen.',
    ]) {
      const hits = lintScenes([{ id: 's', text }], { claims: [] });
      expect(
        hits.some((h) => h.kind === 'andamiaje'),
        text,
      ).toBe(true);
    }
  });

  it('caza también los rótulos que salieron de arreglar el prompt', () => {
    // Se reescribió sceneBlueprint para que los papeles fueran prosa y no
    // etiquetas citables. En la primera tanda del banco el modelo escribió
    // «Lo contraintuitivo:» seis veces y «Otra objeción:» cinco, copiando la
    // redacción NUEVA. Cambiar el nombre del papel solo cambia el del rótulo.
    for (const text of [
      'Lo contraintuitivo: el coste no es técnico, es psicológico.',
      'Otra objeción: no todos los nichos pagan igual.',
      'Primer paso práctico: mapea en qué capa operas.',
    ]) {
      const hits = lintScenes([{ id: 's', text }], { claims: [] });
      expect(
        hits.some((h) => h.kind === 'andamiaje'),
        text,
      ).toBe(true);
    }
  });

  it('no marca una escena que simplemente empieza por una palabra normal', () => {
    const sanas = [
      'Marta llevaba ocho años en la misma empresa cuando cerraron su departamento.',
      'El coste oculto de la reconversión no es técnico, es psicológico.',
      'Las entradas de capital apuntan a aceleradores y centros de datos.',
      'Un contenedor sale de Shanghái y llega a Róterdam en treinta días.',
    ];
    for (const text of sanas) {
      const hits = lintScenes([{ id: 'sc-body-1', text }], { claims: [] });
      expect(
        hits.some((h) => h.kind === 'andamiaje'),
        `falso positivo: ${text}`,
      ).toBe(false);
    }
  });
});

describe('cifra_sin_claim: solo las cifras que afirman algo', () => {
  const claims = [{ text: 'el índice subió un 70% en enero' }];
  const salta = (text: string): boolean =>
    lintScenes([{ id: 's', text }], { claims }).some((h) => h.kind === 'cifra_sin_claim');

  it('marca la cifra que de verdad afirma algo sin respaldo', () => {
    expect(salta('El 45% de las empresas ya lo usa.')).toBe(true);
    expect(salta('Levantaron 300 millones de dólares.')).toBe(true);
    expect(salta('Son 12.000 modelos publicados este año.')).toBe(true);
  });

  it('no marca la cifra que está en los claims', () => {
    expect(salta('El índice subió un 70% en enero, según el informe.')).toBe(false);
  });

  it('no marca números instructivos ni narrativos', () => {
    // Los cuatro son literales de guiones reales. Antes disparaban los 29
    // avisos del corpus, y NINGUNO era una cifra inventada: el juez suspendió
    // tres vídeos por esto y el refinado gastó su presupuesto entero en
    // quitarle la edad al personaje en vez de arreglar la estructura.
    expect(salta('1) mapea en qué capa operas; 2) identifica dependencias; 3) prioriza.')).toBe(
      false,
    );
    expect(salta('Caso: Marta, 38 años, gestora de proyectos.')).toBe(false);
    expect(salta('Redacta un email de 150 palabras y prueba 20 contactos.')).toBe(false);
    expect(salta('Checklist para las primeras ocho semanas: 1) línea de base; 2) piloto.')).toBe(
      false,
    );
  });

  // Laguna conocida y anterior a esto: numericTokens solo ve dígitos, así que
  // «uno de cada cuatro adultos» no se comprueba contra el research en absoluto.
  it.todo('las cifras escritas con letra no se comprueban');
});

describe('promesa_no_producible', () => {
  const salta = (text: string): boolean =>
    lintScenes([{ id: 's', text }], { claims: [] }).some((h) => h.kind === 'promesa_no_producible');

  it('marca lo que la fábrica no puede entregar, con frases de guiones reales', () => {
    // las cuatro salieron de vídeos publicados o del banco
    expect(salta('En la demo usaré un libro técnico como ejemplo.')).toBe(true);
    expect(salta('el flujo que te mostré te las entrega')).toBe(true);
    expect(salta('descarga el pack del vídeo en el enlace')).toBe(true);
    expect(salta('en el próximo vídeo desplegamos juntos un benchmark')).toBe(true);
    expect(salta('dejo enlaces y un checklist descargable en la descripción')).toBe(true);
    // esta se escapó del primer patrón por la preposición: la cazó leer el banco
    expect(salta('Empezamos con una demo práctica y un flujo que puedas aplicar ya.')).toBe(true);
  });

  it('NO marca lo que el espectador sí puede hacer en sitios de terceros', () => {
    // este canal habla de software: «descarga el repositorio» es contenido,
    // no una promesa de adjunto. Confundirlos vaciaría los guiones técnicos.
    expect(salta('Desde Hugging Face descarga el repositorio y elige la cuantización.')).toBe(
      false,
    );
    expect(salta('Un repositorio y pesos abiertos permiten descargar el modelo.')).toBe(false);
    expect(salta('Los capítulos están abajo, en la descripción del vídeo.')).toBe(false);
    // hablar de la demo de otro es contenido, no una promesa propia
    expect(salta('La demo de OpenAI duró doce minutos y enseñó tres funciones.')).toBe(false);
  });
});

describe('meta_narracion', () => {
  const salta = (text: string): boolean =>
    lintScenes([{ id: 's', text }], { claims: [] }).some((h) => h.kind === 'meta_narracion');

  it('marca el guion que anuncia su propio movimiento en vez de ejecutarlo', () => {
    expect(salta('Aquí cumplo la promesa práctica: en la demo configuré y subí el libro.')).toBe(
      true,
    );
    expect(salta('Lo contraintuitivo es que ahorrar tiempo puede costarte trabajo extra.')).toBe(
      true,
    );
    expect(salta('PUNTO MEDIO: estas herramientas funcionan pero no son cajas negras.')).toBe(true);
  });

  it('marca la escena que le cuenta al espectador lo que está viendo', () => {
    // salió del refinado al pedirle que dejara la lista al gráfico: escribió
    // la instrucción en la narración en vez de obedecerla
    expect(salta('No repitas cada punto en voz alta; el gráfico lo muestra.')).toBe(true);
    expect(salta('Los cuatro pasos los tienes en pantalla mientras hablo.')).toBe(true);
    expect(salta('Como puedes ver en pantalla, la curva se dispara en enero.')).toBe(true);
  });

  it('no marca el contenido que simplemente es sorprendente', () => {
    expect(salta('Ahorrar tiempo leyendo puede costarte más horas de las que ganas.')).toBe(false);
  });

  it('no marca al que habla DE esquemas y pantallas, que es media mitad del nicho', () => {
    // sin el verbo que señala, «el esquema» disparaba en 13 escenas del banco
    expect(salta('El esquema MoE declara 896 expertos y activa 16 por token.')).toBe(false);
    expect(salta('Inicias una grabación de pantalla y narras en voz alta los pasos.')).toBe(false);
    expect(salta('Ese esquema reduce el coste de inferencia sin tocar la calidad.')).toBe(false);
  });
});

describe('objeciones_seguidas', () => {
  const escena = (id: string, text: string) => ({ id, text });
  const cuantos = (textos: string[]): number =>
    lintScenes(
      textos.map((t, i) => escena(`sc-body-${i + 1}`, t)),
      { claims: [] },
    ).filter((h) => h.kind === 'objeciones_seguidas').length;

  it('deja pasar la alternancia: dos objeciones seguidas son tensión', () => {
    expect(cuantos(['Pero hay un coste.', 'Sin embargo eso no siempre pasa.'])).toBe(0);
  });

  it('marca el bloque: tres o más son una lista de pegas', () => {
    // literal de OIC6LvB17pOtsK3tOkbqx: tres escenas consecutivas de objeción
    expect(
      cuantos([
        'Podrías pensar que dejar de usar modelos abiertos evita problemas.',
        'También podrías creer que usar solo proveedores grandes te cubre.',
        'Otra objeción común: los atacantes ya pueden acceder a modelos.',
      ]),
    ).toBe(1);
  });

  it('la racha se corta con una escena que avanza', () => {
    expect(
      cuantos([
        'Pero hay un coste operativo que nadie cuenta.',
        'Sin embargo, la cifra depende del sector.',
        'Nvidia publicó sus resultados el martes.',
        'Aunque el reglamento cambie, el contrato sigue.',
      ]),
    ).toBe(0);
  });
});

describe('cierre_resumen', () => {
  const salta = (text: string): boolean =>
    lintScenes([{ id: 's', text }], { claims: [] }).some((h) => h.kind === 'cierre_resumen');

  it('marca la escena que se cierra resumiéndose, con frases reales del banco', () => {
    expect(
      salta(
        'Hay dos tipos de plataforma. Esa diferencia condiciona la precisión que puedes exigir y si tendrás citas textuales verificables.',
      ),
    ).toBe(true);
    expect(
      salta(
        'Los sistemas indexan distinto. Esos problemas no son imposibles, pero exigen vigilancia y protocolos sencillos antes de usarlo.',
      ),
    ).toBe(true);
  });

  it('NO marca el remate corto: el demostrativo no es el problema', () => {
    // «Eso lo cambia todo» es un buen cierre. Lo que sobra es el resumen largo.
    expect(salta('El contrato ya no te cubre. Eso lo cambia todo.')).toBe(false);
    expect(salta('Sin las claves, tus datos son puro ruido.')).toBe(false);
  });

  it('se repara: entra en los avisos que disparan la reescritura', () => {
    expect(BLOCKING_LINT_KINDS).toContain('cierre_resumen');
  });
});
