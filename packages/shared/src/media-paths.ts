import type { MasterVideoJson } from './master-json.js';

// El ÚNICO sitio donde se enumera qué campos del maestro son rutas de medio.
//
// Existe porque la regla «toda ruta de medio nueva tiene que pasar por la
// reescritura» estaba escrita en los docs y aun así se incumplió tres veces:
// primero con `beats[].visuals[].asset.path` (los beats multi-plano salían EN
// NEGRO en el MP4), después con `edits[].image_path` en el worker de render, y
// otra vez con el mismo campo en el script `render-master`. La causa no era el
// olvido: eran TRES copias independientes de la misma lista —worker, API y
// script—, y arreglar una no arreglaba las otras.
//
// Con esto, añadir un campo de medio al contrato se hace aquí y las tres
// reescrituras lo heredan. Cada llamador aporta solo su transformación (a URL
// de /files en el worker y en el script, a URL del dashboard en la API).

/**
 * Devuelve una copia del maestro con `fn` aplicada a TODAS sus rutas de medio.
 * No muta el original: el maestro se congela en master.json con sus rutas
 * locales, que es lo que permite re-renderizar y auditar.
 */
export function mapMasterMediaPaths(
  master: MasterVideoJson,
  fn: (path: string) => string,
): MasterVideoJson {
  // clon profundo por JSON: `structuredClone` no está en las libs de este
  // paquete (shared compila sin DOM) y el maestro es JSON puro por contrato
  const c = JSON.parse(JSON.stringify(master)) as MasterVideoJson;
  if (c.audio) c.audio.path = fn(c.audio.path);
  // avatar del canal congelado en la marca: intro/outro lo cargan como logo
  const avatar = c.brand?.avatar_path;
  if (c.brand && typeof avatar === 'string') c.brand.avatar_path = fn(avatar);
  for (const beat of c.beats ?? []) {
    if (beat.asset?.path !== undefined) beat.asset.path = fn(beat.asset.path);
    // los sub-planos llevan su propio asset con ruta local
    for (const sv of beat.visuals ?? []) {
      if (sv.asset?.path !== undefined) sv.asset.path = fn(sv.asset.path);
    }
  }
  // el inserto de referencia lleva su imagen congelada en el propio edit
  for (const edit of c.edits ?? []) {
    if (edit.type === 'imagen_apoyo') edit.image_path = fn(edit.image_path);
  }
  return c;
}
