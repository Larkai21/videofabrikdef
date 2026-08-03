// GENERADO por packages/video/scripts/generate-registry.ts — NO EDITAR A MANO.
// Metadatos del manifest por ref, en fichero propio y SIN imports de React:
// lo consume el worker de render (offset de capítulos) además de la
// composición. Ver registry-gen.ts (generateMetaSource).
//
// Lleva el TIPO porque el layout monta un slot solo si el ref está registrado
// BAJO ESE TIPO: un consumidor que mire solo la duración replicaría a medias la
// degradación y calcularía offsets de una intro que no se monta (reproducido:
// components.intro apuntando a una outro desplazaba los capítulos 4 s).
export interface KitComponentMeta {
  type: string;
  fixed_duration_frames?: number;
}

export const componentMeta: Record<string, KitComponentMeta> = {
  'intro-basica@0.1.0': { type: 'intro', fixed_duration_frames: 96 },
  'outro-basica@0.1.0': { type: 'outro', fixed_duration_frames: 120 },
  'rotulo-basico@0.1.0': { type: 'lower_third' },
  'rotulo-ejemplo@1.0.0': { type: 'lower_third' },
  'subtitulos-basicos@0.1.0': { type: 'subtitle_theme' },
  'titulo-seccion@0.1.0': { type: 'title_card' },
};
