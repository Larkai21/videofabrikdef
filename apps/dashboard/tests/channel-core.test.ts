// Tests de la lógica pura del canal activo. Se ejecutan con el runner de node vía tsx:
//   pnpm --filter @fabrica/dashboard exec tsx --test tests/*.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  readStoredChannelId,
  resolveActiveChannelId,
  writeStoredChannelId,
} from '../src/lib/channel-core.ts';

test('resolveActiveChannelId sin canales devuelve null', () => {
  assert.equal(resolveActiveChannelId(null, []), null);
  assert.equal(resolveActiveChannelId('ch-a', []), null);
});

test('resolveActiveChannelId respeta el id guardado si existe', () => {
  assert.equal(resolveActiveChannelId('ch-b', ['ch-a', 'ch-b']), 'ch-b');
});

test('resolveActiveChannelId cae al primer canal si el guardado no existe', () => {
  assert.equal(resolveActiveChannelId('ch-x', ['ch-a', 'ch-b']), 'ch-a');
  assert.equal(resolveActiveChannelId(null, ['ch-a', 'ch-b']), 'ch-a');
  assert.equal(resolveActiveChannelId('', ['ch-a']), 'ch-a');
});

test('readStoredChannelId lee la clave y tolera storages rotos', () => {
  const ok = {
    getItem: (k: string) => (k === ACTIVE_CHANNEL_STORAGE_KEY ? 'ch-a' : null),
  };
  assert.equal(readStoredChannelId(ok), 'ch-a');

  const roto = {
    getItem: () => {
      throw new Error('storage bloqueado');
    },
  };
  assert.equal(readStoredChannelId(roto), null);
});

test('writeStoredChannelId escribe la clave y tolera storages rotos', () => {
  const escrito: Record<string, string> = {};
  writeStoredChannelId({ setItem: (k: string, v: string) => void (escrito[k] = v) }, 'ch-b');
  assert.equal(escrito[ACTIVE_CHANNEL_STORAGE_KEY], 'ch-b');

  assert.doesNotThrow(() =>
    writeStoredChannelId(
      {
        setItem: () => {
          throw new Error('storage bloqueado');
        },
      },
      'ch-b',
    ),
  );
});
