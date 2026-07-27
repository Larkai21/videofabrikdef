// Tests de la lógica pura de formato. Se ejecutan con el runner de node vía tsx:
//   pnpm --filter @fabrica/dashboard exec tsx --test tests/*.test.ts
// (vitest no está declarado en este paquete; ver informe del módulo.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beatShortLabel,
  fmtClock,
  fmtMoney,
  fmtSim,
  pct,
  sceneOffsets,
  speechMs,
  timeMarks,
  wordCount,
} from '../src/lib/format.ts';

test('fmtClock formatea m:ss', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(15_000), '0:15');
  assert.equal(fmtClock(65_000), '1:05');
  assert.equal(fmtClock(522_000), '8:42');
  assert.equal(fmtClock(-100), '0:00');
});

test('fmtMoney usa coma decimal y símbolo detrás', () => {
  assert.equal(fmtMoney(4.8), '4,80 $');
  assert.equal(fmtMoney(0), '0,00 $');
  assert.equal(fmtMoney(0.533), '0,53 $');
});

test('fmtSim redondea a dos decimales con coma', () => {
  assert.equal(fmtSim(0.87), '0,87');
  assert.equal(fmtSim(0.875), '0,88');
  assert.equal(fmtSim(1), '1,00');
});

test('wordCount cuenta palabras separadas por espacios', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('   '), 0);
  assert.equal(wordCount('una'), 1);
  assert.equal(wordCount('el precio  no fue\nel modelo'), 6);
});

test('speechMs estima a 150 palabras por minuto', () => {
  assert.equal(speechMs(150), 60_000);
  assert.equal(speechMs(75), 30_000);
  assert.equal(speechMs(0), 0);
  assert.equal(speechMs(100, 0), 0);
});

test('pct acota entre 0 y 100', () => {
  assert.equal(pct(5, 10), 50);
  assert.equal(pct(20, 10), 100);
  assert.equal(pct(-5, 10), 0);
  assert.equal(pct(1, 0), 0);
});

test('beatShortLabel corta en coma o dos puntos', () => {
  assert.equal(beatShortLabel('Servidores en rack, plano lateral'), 'Servidores en rack');
  assert.equal(beatShortLabel('Gráfico: descargas por semana'), 'Gráfico');
  assert.equal(beatShortLabel('Manos escribiendo'), 'Manos escribiendo');
});

test('timeMarks devuelve n marcas equiespaciadas', () => {
  assert.deepEqual(timeMarks(120_000, 3), ['0:00', '1:00', '2:00']);
  assert.equal(timeMarks(120_000, 6).length, 6);
  assert.deepEqual(timeMarks(0, 6), []);
});

test('sceneOffsets acumula la duración estimada por palabras', () => {
  const textos = [
    Array.from({ length: 150 }, () => 'palabra').join(' '),
    Array.from({ length: 75 }, () => 'palabra').join(' '),
    'final',
  ];
  const offsets = sceneOffsets(textos);
  assert.deepEqual(offsets, [0, 60_000, 90_000]);
});
