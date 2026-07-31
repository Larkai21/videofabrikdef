import type { Scene } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { instruccionesDeRefinado, loQueSigueMal } from './refine.js';

function escena(id: string, text: string): Scene {
  return { id, section: 'body', text, visual_query: 'q' };
}

const GUION = [
  escena('sc-body-1', 'Una carta firmada por más de setenta empresas llegó a la Casa Blanca.'),
  escena('sc-body-2', 'Los modelos de pesos abiertos entregan sus parámetros para uso local.'),
  escena('sc-body-3', 'Desde el gobierno hay prioridades de seguridad nacional.'),
];

describe('instruccionesDeRefinado', () => {
  // `ScriptRefineJob.notes` existe en el contrato con el comentario «sin ellas
  // el refinado reescribe a ciegas», judge.ts las rellena… y la palabra `notes`
  // no aparecía en refine.ts. El refinado recibía los motivos del guion entero
  // y tenía que adivinar cuál era de qué escena.
  it('pone el arreglo concreto de cada escena junto a su texto', () => {
    const out = instruccionesDeRefinado(
      GUION,
      [GUION[1]!],
      ['ritmo flojo'],
      [
        {
          id: 'sc-body-2',
          axis: 'estructura',
          issue: 'no enlaza con la escena anterior',
          fix: 'empieza retomando la carta',
        },
      ],
    );
    expect(out).toContain('Problema (estructura): no enlaza con la escena anterior');
    expect(out).toContain('Arreglo pedido: empieza retomando la carta');
    expect(out).toContain('ritmo flojo');
  });

  it('da la escena anterior y la siguiente, o «enlaza con la anterior» es incumplible', () => {
    const out = instruccionesDeRefinado(GUION, [GUION[1]!], [], []);
    expect(out).toContain('Escena anterior (NO la reescribas): Una carta firmada');
    expect(out).toContain('Escena siguiente (NO la reescribas): Desde el gobierno');
    expect(out).toContain('Texto a reescribir: Los modelos de pesos abiertos');
  });

  it('no inventa vecinas en los extremos', () => {
    const primera = instruccionesDeRefinado(GUION, [GUION[0]!], [], []);
    expect(primera).not.toContain('Escena anterior');
    expect(primera).toContain('Escena siguiente');

    const ultima = instruccionesDeRefinado(GUION, [GUION[2]!], [], []);
    expect(ultima).toContain('Escena anterior');
    expect(ultima).not.toContain('Escena siguiente');
  });

  it('sigue funcionando sin notas: son opcionales para los jobs en vuelo', () => {
    const out = instruccionesDeRefinado(GUION, [GUION[1]!], ['motivo suelto'], []);
    expect(out).toContain('motivo suelto');
    expect(out).toContain('Texto a reescribir:');
    expect(out).not.toContain('Arreglo pedido');
  });
});

describe('loQueSigueMal', () => {
  // El caso real: el juez pidió «elimina la locución literal del rótulo», el
  // refinado reescribió la escena, y el rótulo seguía ahí. Nadie lo comprobaba.
  const CON_ROTULO = escena(
    'sc-body-11',
    'Qué hacer ya: ejecuta una checklist mínima antes de la fecha clave. Inventario de sistemas, matriz de roles, capturas de avisos publicados y copia de contratos.',
  );

  it('caza el aviso duro que el refinado no quitó', () => {
    const pendiente = loQueSigueMal([CON_ROTULO], []);
    expect(pendiente).toHaveLength(1);
    expect(pendiente[0]?.id).toBe('sc-body-11');
    expect(pendiente[0]?.axis).toBe('andamiaje');
    expect(pendiente[0]?.fix).not.toBe('');
  });

  it('le dice al reintento que ya se intentó, o repetiría la misma reescritura', () => {
    expect(loQueSigueMal([CON_ROTULO], [])[0]?.issue).toContain('sigue igual');
  });

  it('una escena que quedó bien no vuelve a la cola', () => {
    const arreglada = escena(
      'sc-body-11',
      'Antes de esa fecha te hace falta una lista corta y cerrada: inventario de sistemas, matriz de roles, capturas de los avisos publicados y copia de los contratos.',
    );
    expect(loQueSigueMal([arreglada], [])).toEqual([]);
  });

  it('los avisos blandos no cuentan: solo se insiste con lo que bloquea', () => {
    // una escena corta dispara `escena_corta`, que no es bloqueante
    const corta = escena('sc-body-2', 'Es corta y no dice gran cosa.');
    expect(loQueSigueMal([corta], [])).toEqual([]);
  });
});
