import { describe, expect, it } from 'vitest';
import {
  makeDemoMaster,
  makeDemoShort,
  type Edit,
  type MasterVideoJson,
  type RenderableShort,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { dedupeAndCap, PRESUPUESTO_VERTICAL } from '../assets/editing-director.js';
import { efectosDelShort } from './efectos.js';

// La pasada de efectos del short (plan-dibujar-ideas.md, Fase 1) se entregó en
// 166b98c sin banco de pruebas propio: el A/B (`scripts/ab-edicion.ts --short`)
// necesita BD y proveedor, así que los tres casos del contrato —ventana vacía,
// presupuesto agotado y separación mínima— no tenían dónde fallar en CI. Los
// dos últimos se prueban sobre `dedupeAndCap` con PRESUPUESTO_VERTICAL, que es
// la puerta final REAL de la pasada (directEdits termina ahí); el primero,
// sobre `efectosDelShort` entera.

/**
 * Un contexto que EXPLOTA al primer uso. La ventana vacía tiene que resolverse
 * sin tocar BD, ledger ni LLM: si algún día alguien mueve el corto-circuito de
 * `directEdits` por detrás de la llamada, este proxy lo delata.
 */
const ctxProhibido = new Proxy(
  {},
  {
    get(_t, prop): never {
      throw new Error(`la ventana vacía no debe tocar el contexto (accedió a ${String(prop)})`);
    },
  },
) as unknown as WorkerContext;

const largo: MasterVideoJson = makeDemoMaster();

function shortConEdits(edits: Edit[]): RenderableShort {
  // beats: [] = la ventana del short no contiene ningún beat. El contrato de
  // render lo prohíbe, pero la pasada corre ANTES de esa validación y tiene
  // que degradar a «sin efectos», no a una llamada LLM sobre nada.
  return { ...makeDemoShort(), beats: [], edits } as unknown as RenderableShort;
}

describe('efectosDelShort — la ventana vacía', () => {
  it('sin beats no hay llamada: devuelve el maestro sin efectos y no toca el contexto', async () => {
    const out = await efectosDelShort(ctxProhibido, {
      master: shortConEdits([]),
      largo,
      lang: 'es',
    });
    expect(out.master.edits).toEqual([]);
    expect(out.despues).toBe(0);
  });

  it('cuenta como heredados solo lo que SHORT_EDIT_ALLOWED deja pasar', async () => {
    const edits: Edit[] = [
      // permitido en vertical: entra como heredado
      { type: 'split_versus', from_ms: 1_000, to_ms: 4_400, items: ['Antes', 'Ahora'] },
      // 16:9 por definición: se filtra antes de la pasada
      { type: 'device_frame', from_ms: 5_000, to_ms: 7_600, text: 'kernel.ai' },
      // dos cajas apaisadas en un lienzo sin ancho: fuera
      { type: 'imagen_apoyo', from_ms: 8_000, to_ms: 11_000, image_path: '/x.jpg', text: 'X' },
    ];
    const out = await efectosDelShort(ctxProhibido, {
      master: shortConEdits(edits),
      largo,
      lang: 'es',
    });
    expect(out.antes).toBe(1);
  });

  it('un clip de episodio (sin vídeo padre) no pasa por aquí: sin claims no hay cifras', async () => {
    const master = shortConEdits([]);
    const sinPadre = {
      ...master,
      video: { ...master.video, video_id: undefined, episode_id: 'ep-1' },
    } as unknown as RenderableShort;
    await expect(efectosDelShort(ctxProhibido, { master: sinPadre, largo, lang: 'es' })).rejects.toThrow(
      /vídeo padre/,
    );
  });
});

describe('la puerta final de la pasada — presupuesto y separación del formato', () => {
  const tarjeta = (from: number, i: number): Edit => ({
    type: 'text_callout',
    from_ms: from,
    to_ms: from + 2_400,
    beat_idx: 0,
    text: `t${i}`,
  });

  it('presupuesto agotado: diez candidatas en 35 s salen exactamente las del tope', () => {
    // separadas 3,5 s: la separación (7 s) permitiría ~5, así que quien corta
    // aquí es el PRESUPUESTO por pieza, no la separación
    const candidatas = Array.from({ length: 10 }, (_, i) => tarjeta(i * 3_500, i));
    const out = dedupeAndCap(candidatas, 35_000, new Set(), PRESUPUESTO_VERTICAL);
    const tarjetas = out.filter((e) => e.type === 'text_callout');
    expect(tarjetas).toHaveLength(PRESUPUESTO_VERTICAL.tarjetas);
  });

  it('separación mínima: dos tarjetas a 5 s se quedan en una; a 7 s caben las dos', () => {
    const juntas = dedupeAndCap([tarjeta(0, 0), tarjeta(5_000, 1)], 30_000, new Set(), PRESUPUESTO_VERTICAL);
    expect(juntas.filter((e) => e.type === 'text_callout')).toHaveLength(1);

    const separadas = dedupeAndCap(
      [tarjeta(0, 0), tarjeta(PRESUPUESTO_VERTICAL.sepTarjetaMs, 1)],
      30_000,
      new Set(),
      PRESUPUESTO_VERTICAL,
    );
    expect(separadas.filter((e) => e.type === 'text_callout')).toHaveLength(2);
  });
});
