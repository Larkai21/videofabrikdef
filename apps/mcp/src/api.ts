// Cliente HTTP mínimo contra la API de la fábrica. Nunca lanza: todo error
// (red, HTTP, JSON) se convierte en un mensaje legible para el LLM.

export const DEFAULT_API_URL = 'http://localhost:3001';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiSuccess {
  ok: true;
  status: number;
  data: unknown;
}

export interface ApiFailure {
  ok: false;
  // null = fallo de conexión (la API no respondió)
  status: number | null;
  message: string;
}

export type ApiResult = ApiSuccess | ApiFailure;

export interface FabricaApi {
  baseUrl: string;
  request(method: HttpMethod, path: string, body?: unknown): Promise<ApiResult>;
  /** POST multipart (subidas: el A-roll de un reel). El timeout es más largo
      que el de request: un A-roll son cientos de MB, no un JSON. */
  upload(path: string, form: FormData): Promise<ApiResult>;
}

/**
 * Convierte un cuerpo de error de la API ({error, detail}) en texto claro.
 * El 404 del router (detail "MÉTODO /ruta") se distingue del 404 de negocio
 * ("Vídeo X no existe") para avisar de que el endpoint aún no existe.
 */
export function readableApiError(
  status: number,
  body: unknown,
  method: HttpMethod,
  path: string,
): string {
  if (body && typeof body === 'object') {
    const { error, detail } = body as { error?: unknown; detail?: unknown };
    if (typeof error === 'string') {
      if (status === 404 && typeof detail === 'string' && /^[A-Z]+ \//.test(detail)) {
        return `La API aún no expone ${method} ${path} (esa función está en construcción o desactivada)`;
      }
      const detailText = typeof detail === 'string' && detail.length > 0 ? `: ${detail}` : '';
      return `Error de la API (${status}, ${error})${detailText}`;
    }
  }
  return `Error de la API (${status}) en ${method} ${path}`;
}

/** Mensaje de degradación cuando la API no responde (p. ej. pnpm dev apagado). */
export function connectionErrorMessage(baseUrl: string, cause: unknown): string {
  const root = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
  const reason = root instanceof Error ? root.message : String(root);
  if (root instanceof Error && (root.name === 'TimeoutError' || root.name === 'AbortError')) {
    return `La API de la fábrica en ${baseUrl} no respondió a tiempo. ¿Está colgada o arrancando?`;
  }
  return (
    `No se pudo conectar con la API de la fábrica en ${baseUrl} (${reason}). ` +
    'Comprueba que la API esté en marcha (pnpm dev) o ajusta FABRICA_API_URL.'
  );
}

// una API colgada no debe bloquear todas las herramientas del MCP
const REQUEST_TIMEOUT_MS = Number(process.env.FABRICA_API_TIMEOUT_MS ?? '15000');
// subir un A-roll de cientos de MB por localhost tarda más que un JSON
const UPLOAD_TIMEOUT_MS = Number(process.env.FABRICA_API_UPLOAD_TIMEOUT_MS ?? '300000');

export function createApi(baseUrl?: string): FabricaApi {
  const root = (baseUrl ?? process.env.FABRICA_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');

  async function request(method: HttpMethod, path: string, body?: unknown): Promise<ApiResult> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
    } catch (cause) {
      return { ok: false, status: null, message: connectionErrorMessage(root, cause) };
    }

    let data: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      return { ok: false, status: res.status, message: readableApiError(res.status, data, method, path) };
    }
    return { ok: true, status: res.status, data };
  }

  async function upload(path: string, form: FormData): Promise<ApiResult> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method: 'POST',
        // sin content-type a mano: fetch pone el boundary del multipart
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (cause) {
      return { ok: false, status: null, message: connectionErrorMessage(root, cause) };
    }

    let data: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      return { ok: false, status: res.status, message: readableApiError(res.status, data, 'POST', path) };
    }
    return { ok: true, status: res.status, data };
  }

  return { baseUrl: root, request, upload };
}
