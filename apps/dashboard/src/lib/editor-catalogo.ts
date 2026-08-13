import { z } from 'zod';

// Catálogo de plantillas del módulo editor (apps/editor/guiones/CATALOGO.json,
// generado por catalogo_json.py). El esquema vive AQUÍ y no en @fabrica/shared
// a propósito: shared lleva los contratos de la API de la fábrica, y este
// fichero es un artefacto del módulo con dueño propio — si su generador
// cambia, el parse de abajo avisa sin arrastrar a nadie más.
//
// Se sirve por /files/editor/ (estático de la API) y se pide con URL RELATIVA:
// el proxy /files de Vite lo deja same-origin, que es lo que permite que el
// iframe de la galería sea scriptable (TPL.setup / TPL.seek).

export const piezaCatalogoSchema = z.looseObject({
  plantilla: z.string(),
  admite_copy: z.boolean(),
  origen: z.enum(['propia', 'hyperframes']),
  texto_de_fabrica: z.array(z.string()).nullable(),
  copy: z.unknown().nullable(),
  ranuras: z.unknown().nullable(),
  /** segundos del gesto declarado; null si la pieza no lo declara */
  gesto_s: z.number().nullable(),
  sonido: z.string().nullable(),
  config: z.array(z.string()),
});
export type PiezaCatalogo = z.infer<typeof piezaCatalogoSchema>;

export const catalogoEditorSchema = z.looseObject({
  lienzo: z.string(),
  piezas_totales: z.number().int(),
  piezas_que_admiten_copy: z.number().int(),
  reglas_que_abortan: z.array(z.string()),
  piezas: z.array(piezaCatalogoSchema),
});
export type CatalogoEditor = z.infer<typeof catalogoEditorSchema>;

export async function getCatalogoEditor(): Promise<CatalogoEditor> {
  const res = await fetch('/files/editor/guiones/CATALOGO.json');
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'El catálogo del editor no está servido (¿EDITOR_DIR apunta a apps/editor?)'
        : `Error ${res.status} cargando el catálogo del editor`,
    );
  }
  return catalogoEditorSchema.parse(await res.json());
}

/** URL same-origin de una plantilla para el iframe de la galería. */
export function plantillaUrl(fichero: string): string {
  return `/files/editor/templates/${encodeURIComponent(fichero)}`;
}
