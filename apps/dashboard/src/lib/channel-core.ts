// Lógica pura del canal activo (multicanal, SPEC §14 S3).
// Separada de React para poder probarla con el runner de node.

export const ACTIVE_CHANNEL_STORAGE_KEY = 'fabrica.canal-activo';

/**
 * Resuelve el canal activo a partir del id guardado y la lista de canales
 * conocidos. Reglas:
 * - sin canales → null
 * - id guardado válido → ese id
 * - id guardado ausente o desconocido → el primer canal de la lista
 */
export function resolveActiveChannelId(
  stored: string | null,
  channelIds: readonly string[],
): string | null {
  if (channelIds.length === 0) return null;
  if (stored !== null && stored !== '' && channelIds.includes(stored)) return stored;
  return channelIds[0] ?? null;
}

/** Lee el id guardado tolerando storages rotos (modo privado, permisos…). */
export function readStoredChannelId(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(ACTIVE_CHANNEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Guarda el id del canal activo sin romper si el storage falla. */
export function writeStoredChannelId(
  storage: Pick<Storage, 'setItem'>,
  id: string,
): void {
  try {
    storage.setItem(ACTIVE_CHANNEL_STORAGE_KEY, id);
  } catch {
    // sin persistencia: el canal activo vive solo en memoria esta sesión
  }
}
