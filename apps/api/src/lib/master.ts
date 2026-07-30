import type { MasterVideoJson } from '@fabrica/shared';
import { toFileUrl } from './files.js';

export function videoTitle(row: {
  id: string;
  titleChosen: string | null;
  master: MasterVideoJson;
}): string {
  if (row.titleChosen) return row.titleChosen;
  const seo = row.master.seo;
  if (seo) {
    const title = seo.titles[seo.chosen_idx ?? 0] ?? seo.titles[0];
    if (title) return title;
  }
  return `Vídeo ${row.id}`;
}

// El dashboard nunca ve rutas de disco: audio y assets se sirven por /files.
//
// TODA ruta de medio del maestro tiene que pasar por aquí, incluidos los
// sub-planos. Se reescribía solo `beat.asset` y no `beat.visuals[].asset`, y
// como la composición usa la lista de sub-planos cuando existe, los beats de
// varios planos llegaban al Player con rutas de disco que OffthreadVideo/Img no
// pueden cargar: salían EN NEGRO, con los subtítulos y los overlays encima. Es
// decir, en la preview de la timeline se veían los textos y no el vídeo — justo
// el mismo fallo que ya se había corregido en el render.
function conUrl<T extends { path?: string }>(asset: T | undefined): T | undefined {
  return asset?.path !== undefined ? { ...asset, path: toFileUrl(asset.path) } : asset;
}

export function masterWithFileUrls(master: MasterVideoJson): MasterVideoJson {
  const audio = master.audio ? { ...master.audio, path: toFileUrl(master.audio.path) } : undefined;
  const beats = master.beats?.map((beat) => ({
    ...beat,
    ...(beat.asset ? { asset: conUrl(beat.asset)! } : {}),
    ...(beat.visuals
      ? {
          visuals: beat.visuals.map((v) => ({
            ...v,
            ...(v.asset ? { asset: conUrl(v.asset)! } : {}),
          })),
        }
      : {}),
  }));
  const brand =
    master.brand?.avatar_path !== undefined
      ? { ...master.brand, avatar_path: toFileUrl(master.brand.avatar_path) }
      : master.brand;
  return {
    ...master,
    ...(audio ? { audio } : {}),
    ...(beats ? { beats } : {}),
    ...(brand ? { brand } : {}),
  };
}
