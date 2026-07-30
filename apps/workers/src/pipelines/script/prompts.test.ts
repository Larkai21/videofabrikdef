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

  it('en formato largo introduce re-gancho y giro, y en corto no los fuerza', () => {
    // Este test afirmaba que el plano contuviera «PUNTO MEDIO» y «GIRO» en
    // mayúsculas. Estaba fijando el bug: el modelo copiaba esos rótulos al
    // texto de la escena y el locutor los decía en voz alta en el MP4. Lo que
    // hay que garantizar es el ARCO (que a lo largo haya re-gancho central y
    // giro, y a lo corto no), no las palabras con que se le pide.
    const largo = sceneBlueprint(14);
    expect(largo).toContain('re-gancho fuerte');
    expect(largo).toContain('lo contraintuitivo');
    expect(largo).not.toMatch(/PUNTO MEDIO|GIRO/);

    const corto = sceneBlueprint(3);
    expect(corto).not.toContain('re-gancho fuerte');
    expect(corto).toContain('sc-body-3');
  });

  it('avisa de que los papeles no se escriben dentro del guion', () => {
    // la instrucción explícita es la primera línea de defensa; el linter
    // (`andamiaje` en script-quality.ts) es la segunda
    expect(sceneBlueprint(14)).toContain('NUNCA escribas estos papeles');
  });

  it('sin cuerpo no dice nada', () => {
    expect(sceneBlueprint(0)).toBe('');
  });
});

describe('scriptSystem', () => {
  it('pide un número concreto de intenciones, no un techo', () => {
    const s = scriptSystem(demoProfile, 875);
    // 875 palabras ≈ 7 min × 1,2 tarjetas/min ≈ 8
    expect(s).toMatch(/Declara \d+ de tipo tarjeta/);
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
