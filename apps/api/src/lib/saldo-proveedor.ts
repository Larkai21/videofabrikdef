// se acepta cualquier logger con `warn`: la API usa el de Fastify y los tests,
// uno de mentira. Atarlo al tipo de pino obligaría a castear en el único sitio
// que lo llama.
interface Avisador {
  warn: (obj: unknown, msg?: string) => void;
}

// Saldo real de la clave del proveedor de LLM.
//
// El coste del mes que enseña la bandeja sale de `cost_ledger`, que es una
// ESTIMACIÓN: tokens contados × la tabla de precios de `constants.ts`. Lo que
// de verdad para la fábrica es el contador del proveedor, y los dos se separan
// en cuanto algo llama al modelo sin pasar por el ledger o la tabla de precios
// se queda vieja.
//
// Pasó, y por eso existe esto: el dashboard marcaba 1,85 $ mientras la clave
// llevaba 3,05 $ gastados y devolvía 403 en todas las llamadas. La diferencia
// eran las tandas del banco de guiones, que no registraba. Con el ledger
// arreglado los dos números deberían converger — y verlos juntos es lo único
// que avisa cuando dejan de hacerlo.

const CACHE_MS = 60_000;

export interface SaldoProveedor {
  proveedor: 'openrouter';
  /** gastado en total con esta clave, en dólares */
  gastado_usd: number;
  /** tope de la clave, o null si no tiene */
  tope_usd: number | null;
  /** lo que queda, o null si no hay tope */
  queda_usd: number | null;
}

let cache: { at: number; valor: SaldoProveedor | null } | null = null;

/** Solo para los tests: el caché es de módulo y sobreviviría entre casos. */
export function _resetCacheSaldo(): void {
  cache = null;
}

/**
 * Nunca lanza y nunca bloquea la bandeja: si no hay clave, si la red falla o si
 * el proveedor cambia el formato, devuelve null y la UI no enseña el dato. Un
 * indicador de saldo que tumba la pantalla principal es peor que no tenerlo.
 */
export async function saldoProveedor(logger: Avisador): Promise<SaldoProveedor | null> {
  const ahora = Date.now();
  if (cache !== null && ahora - cache.at < CACHE_MS) return cache.valor;

  const key = process.env.OPENROUTER_API_KEY;
  if (key === undefined || key === '') {
    cache = { at: ahora, valor: null };
    return null;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      signal: AbortSignal.timeout(5_000),
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cuerpo = (await res.json()) as {
      data?: { usage?: unknown; limit?: unknown; limit_remaining?: unknown };
    };
    const d = cuerpo.data;
    if (d === undefined || typeof d.usage !== 'number') throw new Error('respuesta sin usage');
    const valor: SaldoProveedor = {
      proveedor: 'openrouter',
      gastado_usd: d.usage,
      tope_usd: typeof d.limit === 'number' ? d.limit : null,
      queda_usd: typeof d.limit_remaining === 'number' ? d.limit_remaining : null,
    };
    cache = { at: ahora, valor };
    return valor;
  } catch (err) {
    logger.warn({ err }, 'No se pudo leer el saldo del proveedor; la bandeja sigue sin ese dato');
    cache = { at: ahora, valor: null };
    return null;
  }
}
