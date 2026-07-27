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
export function masterWithFileUrls(master: MasterVideoJson): MasterVideoJson {
  const audio = master.audio ? { ...master.audio, path: toFileUrl(master.audio.path) } : undefined;
  const beats = master.beats?.map((beat) =>
    beat.asset?.path ? { ...beat, asset: { ...beat.asset, path: toFileUrl(beat.asset.path) } } : beat,
  );
  return {
    ...master,
    ...(audio ? { audio } : {}),
    ...(beats ? { beats } : {}),
  };
}
