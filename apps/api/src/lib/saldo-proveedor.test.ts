import { afterEach, describe, expect, it, vi } from 'vitest';
import { saldoProveedor, _resetCacheSaldo } from './saldo-proveedor.js';

const logger = { warn: () => {} };

afterEach(() => {
  _resetCacheSaldo();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// respuesta LITERAL de https://openrouter.ai/api/v1/key, capturada el 31-jul-2026
const REAL = {
  data: {
    label: 'sk-or-v1-6a9...739',
    limit: 3,
    limit_remaining: 0,
    usage: 3.0512375,
    is_free_tier: false,
  },
};

function conRespuesta(ok: boolean, cuerpo: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(cuerpo) })),
  );
}

describe('saldoProveedor', () => {
  it('lee la respuesta real del proveedor', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    conRespuesta(true, REAL);
    expect(await saldoProveedor(logger)).toEqual({
      proveedor: 'openrouter',
      gastado_usd: 3.0512375,
      tope_usd: 3,
      queda_usd: 0,
    });
  });

  // Es un dato de APOYO: la bandeja es la pantalla principal y no puede caerse
  // porque el proveedor tarde, cambie el formato o no haya clave.
  it('devuelve null y no lanza si no hay clave', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await saldoProveedor(logger)).toBeNull();
  });

  it('devuelve null si el proveedor responde mal', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    conRespuesta(false, {});
    expect(await saldoProveedor(logger)).toBeNull();
  });

  it('devuelve null si el formato cambia, en vez de inventarse un saldo', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    conRespuesta(true, { data: { algo: 'otro' } });
    expect(await saldoProveedor(logger)).toBeNull();
  });

  it('devuelve null si la red falla', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    expect(await saldoProveedor(logger)).toBeNull();
  });

  it('cachea: la bandeja se refresca cada 30 s y no puede pegarle al proveedor cada vez', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    const spy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(REAL) }));
    vi.stubGlobal('fetch', spy);
    await saldoProveedor(logger);
    await saldoProveedor(logger);
    await saldoProveedor(logger);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('acepta una clave sin tope: gastado sí, saldo restante no', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    conRespuesta(true, { data: { usage: 12.5 } });
    expect(await saldoProveedor(logger)).toEqual({
      proveedor: 'openrouter',
      gastado_usd: 12.5,
      tope_usd: null,
      queda_usd: null,
    });
  });
});
