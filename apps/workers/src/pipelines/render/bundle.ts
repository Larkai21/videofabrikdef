import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webpackOverride } from '@fabrica/video/bundling';
import { bundle } from '@remotion/bundler';
import type { WorkerContext } from '../../lib/context.js';
import { REPO_ROOT } from '../../lib/env.js';
import { videoSrcLock } from '../../lib/locks.js';

// Empaquetado de la composición de Remotion, compartido por el render del
// vídeo largo y el del short: el bundle es el MISMO para los dos formatos —solo
// cambia el id que selecciona `selectComposition`—, así que un short no obliga
// a re-empaquetar nada.

const require = createRequire(import.meta.url);

export function videoPackageDir(): string {
  // resuelve el subpath exportado para localizar packages/video sin asumir
  // la estructura del repo (funciona también instalado en contenedor)
  const entry = require.resolve('@fabrica/video/entry');
  return path.resolve(path.dirname(entry), '..');
}

async function hashTree(
  hash: ReturnType<typeof createHash>,
  dir: string,
  relBase: string,
): Promise<void> {
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) await hashTree(hash, abs, rel);
    else if (entry.isFile()) {
      hash.update(rel);
      try {
        hash.update(await fsp.readFile(abs));
      } catch {
        // archivo desaparecido entre readdir y readFile (poda del kit en
        // vuelo): se anota la ausencia; el candado evita el caso normal
        hash.update('desaparecido');
      }
    }
  }
}

// bundle() una vez por versión del código de la composición: la clave es el
// hash de packages/video/src + fuentes + package.json, cacheado en un
// directorio gitignoreado. Los renders siguientes reutilizan el bundle.
export async function ensureBundle(ctx: WorkerContext): Promise<string> {
  // candado compartido con la validación del brand kit: sin él, la
  // regeneración del registry puede mutar src/kit entre el cálculo del hash
  // y el bundle, y el marcador perpetuaría un bundle mezclado
  return videoSrcLock.run(async () => {
    const pkgDir = videoPackageDir();
    const hash = createHash('sha1');
    await hashTree(hash, path.join(pkgDir, 'src'), 'src');
    // la composición importa @fabrica/shared: un cambio ahí también invalida
    const sharedDir = path.dirname(require.resolve('@fabrica/shared'));
    await hashTree(hash, sharedDir, 'shared/src');
    const publicDir = path.join(pkgDir, 'public');
    if (fs.existsSync(publicDir)) await hashTree(hash, publicDir, 'public');
    hash.update(await fsp.readFile(path.join(pkgDir, 'package.json')));
    const key = hash.digest('hex').slice(0, 16);

    const outDir = path.join(REPO_ROOT, '.turbo', 'remotion-bundle', key);
    const marker = path.join(outDir, '.bundle-completo');
    if (fs.existsSync(marker)) return outDir;
    await fsp.rm(outDir, { recursive: true, force: true });
    ctx.logger.info({ key }, 'Empaquetando la composición de Remotion');
    const serveUrl = await bundle({
      entryPoint: path.join(pkgDir, 'src', 'entry.ts'),
      publicDir: path.join(pkgDir, 'public'),
      outDir,
      webpackOverride,
    });
    await fsp.writeFile(marker, key);
    return serveUrl;
  });
}
