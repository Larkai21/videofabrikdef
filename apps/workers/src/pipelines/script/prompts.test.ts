import { demoProfile } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { sceneBlueprint, scriptSystem } from './prompts.js';

describe('sceneBlueprint', () => {
  // El reparto anterior era una frase fija que describía 6-9 escenas de cuerpo.
  // A siete minutos son catorce, y al modelo no le quedaba más que estirar.
  it('nombra un papel para todos los ids del cuerpo, sea cual sea la longitud', () => {
    for (const n of [4, 7, 14, 20]) {
      const plano = sceneBlueprint(n);
      // el primero y el último id del cuerpo aparecen siempre
      expect(plano, `n=${n}`).toContain('sc-body-1');
      expect(plano, `n=${n}`).toContain(`sc-body-${n}`);
    }
  });

  it('reparte el cuerpo en movimientos con una pregunta cada uno', () => {
    // No hay un papel por escena: eso es lo que el modelo locutaba. Una
    // pregunta no se puede usar como encabezado de escena.
    const largo = sceneBlueprint(14);
    expect(largo).toContain('¿qué ha pasado exactamente, y a quién?');
    expect(largo).toContain('¿qué puede hacer con esto quien lo ha escuchado?');
    // La pregunta anterior era «¿qué hace el lunes por la mañana?» y el modelo
    // la citaba como rótulo: «El lunes por la mañana:» apareció 3 veces en los
    // guiones del banco. Cualquier frase concreta que se ponga aquí se puede
    // copiar como encabezado, así que las preguntas tienen que ser abstractas.
    expect(largo).not.toContain('lunes por la mañana');
    expect(largo).not.toMatch(/PUNTO MEDIO|GIRO|re-gancho fuerte|lo contraintuitivo/i);
  });

  it('cubre TODAS las escenas del cuerpo, sin huecos ni solapes', () => {
    for (const n of [3, 4, 7, 14, 20]) {
      const plano = sceneBlueprint(n);
      const cubiertas = new Set<number>();
      for (const m of plano.matchAll(/sc-body-(\d+)(?:–sc-body-(\d+))?/g)) {
        const desde = Number(m[1]);
        const hasta = Number(m[2] ?? m[1]);
        for (let i = desde; i <= hasta; i++) {
          expect(cubiertas.has(i), `sc-body-${i} repetido con n=${n}`).toBe(false);
          cubiertas.add(i);
        }
      }
      expect(
        [...cubiertas].sort((a, b) => a - b),
        `n=${n}`,
      ).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it('dice explícitamente que las preguntas no se escriben', () => {
    expect(sceneBlueprint(14)).toContain('NO se escriben en el guion');
  });

  it('sin cuerpo no dice nada', () => {
    expect(sceneBlueprint(0)).toBe('');
  });
});

describe('scriptSystem', () => {
  it('pide un número concreto de intenciones, no un techo', () => {
    const s = scriptSystem(demoProfile, 875);
    // 875 palabras ≈ 7 min × 1,2 tarjetas/min ≈ 8, y ahora se nombra la escena
    // de cada una: «repartidas» no bastaba y dejaba tres minutos mudos de siete
    expect(s).toMatch(/Declara \d+ o más de tipo tarjeta/);
    expect(s).toContain('incluidas la primera y la última');
    expect(s).not.toContain('de 0 a 2 por escena');
  });

  // El copy se LEE en pantalla: salía en inglés en un canal en español porque
  // la única regla de idioma del prompt era la de la consulta de archivo.
  it('exige que el copy de tarjeta vaya en el idioma del guion', () => {
    expect(scriptSystem({ ...demoProfile, language: 'es' }, 875)).toContain('EN ESPAÑOL');
    expect(scriptSystem({ ...demoProfile, language: 'en' }, 875)).toContain('EN INGLÉS');
  });

  it('trae un ejemplo de intenciones, que antes no existía', () => {
    const s = scriptSystem(demoProfile, 875);
    expect(s).toContain('"effect":"stat"');
    // el ejemplo es de tema ajeno al canal, para dar la forma sin el contenido
    expect(s).toContain('contenedores');
  });
});
