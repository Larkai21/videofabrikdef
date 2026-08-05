// Tests del orden y el rango de fechas de la galería de entregas.
//   pnpm --filter @fabrica/dashboard test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InboxDto } from '@fabrica/shared';
import { FILTRO_VACIO, filtrarEntregas, rangoImposible } from '../src/lib/entregas.js';

type Entregada = InboxDto['done'][number];

// `created_at` en hora LOCAL, que es como lo escribe el humano en el <input>
const iso = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

function entrega(id: string, created: string, title = `Vídeo ${id}`): Entregada {
  return {
    video_id: id,
    title,
    output_dir: `/out/${id}`,
    finished_at: created,
    created_at: created,
    thumbnail_url: null,
    youtube: null,
  };
}

const a = entrega('a', iso(2026, 3, 1));
const b = entrega('b', iso(2026, 3, 10));
const c = entrega('c', iso(2026, 3, 20));
const TODAS = [b, a, c];

const ids = (l: Entregada[]): string[] => l.map((e) => e.video_id);

test('por defecto ordena de más reciente a más antiguo', () => {
  assert.deepEqual(ids(filtrarEntregas(TODAS, FILTRO_VACIO)), ['c', 'b', 'a']);
});

test('el orden inverso es simétrico', () => {
  assert.deepEqual(ids(filtrarEntregas(TODAS, { ...FILTRO_VACIO, orden: 'antiguo' })), [
    'a',
    'b',
    'c',
  ]);
});

test('desempata por id para no bailar entre refetches', () => {
  const mismo = iso(2026, 3, 5);
  const x = entrega('zzz', mismo);
  const y = entrega('aaa', mismo);
  assert.deepEqual(ids(filtrarEntregas([x, y], FILTRO_VACIO)), ['aaa', 'zzz']);
  assert.deepEqual(ids(filtrarEntregas([y, x], FILTRO_VACIO)), ['aaa', 'zzz']);
});

test('sin fechas no filtra nada', () => {
  assert.equal(filtrarEntregas(TODAS, FILTRO_VACIO).length, 3);
});

test('desde incluye el vídeo creado a las 00:00 de ese día', () => {
  const madrugador = entrega('m', iso(2026, 3, 10, 0, 0));
  const out = filtrarEntregas([madrugador], { ...FILTRO_VACIO, desde: '2026-03-10' });
  assert.deepEqual(ids(out), ['m']);
});

// El fallo clásico: comparar 'YYYY-MM-DD' contra un ISO en UTC deja fuera el
// día `hasta` entero.
test('hasta incluye el vídeo creado a las 23:30 de ese día', () => {
  const tardio = entrega('t', iso(2026, 3, 10, 23, 30));
  const out = filtrarEntregas([tardio], { ...FILTRO_VACIO, hasta: '2026-03-10' });
  assert.deepEqual(ids(out), ['t']);
});

test('el rango recorta por los dos lados', () => {
  const out = filtrarEntregas(TODAS, {
    ...FILTRO_VACIO,
    desde: '2026-03-05',
    hasta: '2026-03-15',
  });
  assert.deepEqual(ids(out), ['b']);
});

test('un rango invertido devuelve lista vacía sin reventar', () => {
  const f = { ...FILTRO_VACIO, desde: '2026-03-20', hasta: '2026-03-01' };
  assert.equal(rangoImposible(f), true);
  assert.deepEqual(filtrarEntregas(TODAS, f), []);
});

test('el filtro de texto se compone con el de fechas', () => {
  const lista = [
    entrega('x', iso(2026, 3, 2), 'Chips de IA y latencia'),
    entrega('y', iso(2026, 3, 12), 'Chips de IA y coste'),
    entrega('z', iso(2026, 3, 12), 'Otra cosa distinta'),
  ];
  const out = filtrarEntregas(lista, {
    ...FILTRO_VACIO,
    q: 'chips',
    desde: '2026-03-10',
  });
  assert.deepEqual(ids(out), ['y']);
});

test('una fecha ilegible no hace desaparecer el vídeo y va al final', () => {
  const roto = entrega('roto', 'no-es-una-fecha');
  const out = filtrarEntregas([roto, ...TODAS], { ...FILTRO_VACIO, desde: '2026-01-01' });
  assert.deepEqual(ids(out), ['c', 'b', 'a', 'roto']);
});
