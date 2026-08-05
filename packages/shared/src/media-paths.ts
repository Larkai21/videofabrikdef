// Firma ESTRUCTURAL: solo los campos que esta función toca. Así el maestro de
// un short —que no es asignable a MasterVideoJson porque sus literales de
// tamaño son otros— pasa por aquí sin duplicar la lista de campos de medio,
// que es justo lo que este módulo existe para evitar.
export interface MediaBearingMaster {
  audio?: { path: string } | undefined;
  brand?: { avatar_path?: string | undefined } | undefined;
  beats?:
    | Array<{
        asset?: { path?: string | undefined } | undefined;
        visuals?: Array<{ asset?: { path?: string | undefined } | undefined }> | undefined;
      }>
    | undefined;
  edits?: Array<{ type: string; image_path?: string }> | undefined;
}

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
export function mapMasterMediaPaths<T extends MediaBearingMaster>(
  master: T,
  fn: (path: string) => string,
): T {
  // clon profundo por JSON: `structuredClone` no está en las libs de este
  // paquete (shared compila sin DOM) y el maestro es JSON puro por contrato
  const c = JSON.parse(JSON.stringify(master)) as T;
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
  // el inserto de referencia lleva su imagen congelada en el propio edit. La
  // firma estructural no puede atar `image_path` al discriminante, así que se
  // comprueba a mano; en el contrato, un imagen_apoyo siempre lo trae.
  for (const edit of c.edits ?? []) {
    if (edit.type === 'imagen_apoyo' && edit.image_path !== undefined) {
      edit.image_path = fn(edit.image_path);
    }
  }
  return c;
}
