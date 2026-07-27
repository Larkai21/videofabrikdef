import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFigures, marginNotes, sceneMarginNote } from '../src/lib/warnings.ts';

test('extractFigures encuentra cifras con y sin unidad', () => {
  assert.deepEqual(extractFigures('cayó un 40% en 2025'), ['40%', '2025']);
  assert.deepEqual(extractFigures('sin números aquí'), []);
  assert.equal(extractFigures('costó 1,5 millones').length, 1);
});

test('sceneMarginNote: sin cifras no hay aviso', () => {
  assert.equal(sceneMarginNote('el precio no fue el modelo', []), null);
});

test('sceneMarginNote: cifra sin claims produce aviso', () => {
  const note = sceneMarginNote('cayó un 40% en un mes', []);
  assert.notEqual(note, null);
  assert.match(note ?? '', /sin claim/i);
});

test('sceneMarginNote: cifra respaldada por un claim no avisa', () => {
  const claims = [{ text: 'el coste cayó un 40% según el informe', source_idx: 0 }];
  assert.equal(sceneMarginNote('cayó un 40% en un mes', claims), null);
});

test('sceneMarginNote: cifra no respaldada avisa aunque haya claims', () => {
  const claims = [{ text: 'el modelo salió en enero', source_idx: 0 }];
  const note = sceneMarginNote('cayó un 40% en un mes', claims);
  assert.notEqual(note, null);
  assert.match(note ?? '', /sin fuente/i);
});

test('marginNotes mapea solo las escenas con aviso', () => {
  const scenes = [
    { id: 's1', text: 'sin cifras' },
    { id: 's2', text: 'un 87% de los equipos' },
  ];
  const notes = marginNotes(scenes, []);
  assert.equal(notes.has('s1'), false);
  assert.equal(notes.has('s2'), true);
});
