import fs from 'node:fs/promises';

// Descarga con tope de tamaño, compartida por la ingesta de la cascada y el
// resolutor de insertos. Rechaza por content-length declarado y ABORTA en
// streaming si el total real supera el límite (un servidor puede mentir en la
// cabecera); ante error cierra el handle y borra el destino a medias.

const MAX_DOWNLOAD_BYTES = Number(process.env.STOCK_MAX_DOWNLOAD_MB ?? '200') * 1024 * 1024;

export async function downloadWithCap(url: string, destPath: string, ref: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${ref}): HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Descarga rechazada (${ref}): ${declared} bytes supera el límite`);
  }
  const reader = res.body.getReader();
  const handle = await fs.open(destPath, 'w');
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Descarga abortada (${ref}): supera el límite de tamaño`);
      }
      await handle.write(value);
    }
  } catch (err) {
    await handle.close();
    await fs.unlink(destPath).catch(() => {});
    throw err;
  }
  await handle.close();
}
