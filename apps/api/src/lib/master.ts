import {
  mapMasterMediaPaths,
  type MasterVideoJson,
  type MediaBearingMaster,
} from '@fabrica/shared';
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

// Genérica sobre la forma del maestro: el del short tampoco es asignable al
// del largo, y esta función existe justamente para que la lista de campos de
// medio esté escrita una sola vez.
export function masterWithFileUrls<T extends MediaBearingMaster>(master: T): T {
  // la lista de campos de medio vive en shared: tres copias de esta función
  // divergían y por ese hueco salieron beats en negro en el player y un
  // inserto que la curación no podía ver
  return mapMasterMediaPaths(master, toFileUrl);
}
