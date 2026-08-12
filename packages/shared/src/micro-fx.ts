import { z } from 'zod';
import { normalizeWord } from './edit-intents.js';
import type { EditType, SfxName } from './master-json.js';

// Catálogo de micro-FX: acentos gráficos de menos de segundo y medio anclados a
// UNA palabra pronunciada. Portado del catálogo del proyecto hermano
// editor-youtube, podado para vídeo largo 16:9 faceless.
//
// Viven en su propio carril de presupuesto (docs/edicion.md): si entraran en el
// reparto de tarjetas volveríamos al amontonamiento que ese reparto resuelve.
//
// Los disparadores se escriben YA NORMALIZADOS y se comparan contra UN token del
// cue, no contra la frase. Eso hace innecesarios los límites de palabra: «no» no
// puede casar dentro de «nota» porque se compara el token entero.
//
// Qué NO se porta del hermano, y por qué:
// - `head-explode`: registro de reacción, presupone un creador EN CÁMARA al que
//   le explota la cabeza. Rompe el tono de una pieza de ocho minutos.
// - `neural-node-pulse`: dispararía con «ia», «modelo», «agente»… es decir unas
//   cuarenta veces por guion en un canal de tecnología. Máximo ruido, mínimo
//   significado.
// - `gold-glint`: su sitio natural es el subtítulo, y el tema de subtítulos es un
//   componente intercambiable del brand kit. Acoplarlo aquí ataría el catálogo
//   al tema instalado.
// - `cut-strip`: exige un renderer propio para una semántica que `tachado` ya da.

export const MICRO_FX_IDS = [
  'tachado',
  'visto',
  'diana',
  'subida',
  'caida',
  'candado',
  'cronometro',
  // los tres de gramática VERTICAL, portados el 12-ago-2026 (antes descartados
  // porque a 46 px sobre 1920×1080 se pierden; a 1080×1920 el texto ocupa
  // media pantalla, que es su hábitat). Solo entran con `soloVertical`.
  'sello',
  'aviso',
  'apilado',
] as const;
export const microFxIdSchema = z.enum(MICRO_FX_IDS);
export type MicroFxId = z.infer<typeof microFxIdSchema>;

export interface MicroFxDef {
  readonly id: MicroFxId;
  /** Etiqueta para el panel de curación: el humano nunca ve el id crudo. */
  readonly label: string;
  /** Palabras disparadoras, ya normalizadas. */
  readonly triggers: readonly string[];
  readonly edit: EditType;
  readonly style: string;
  readonly sfx: SfxName;
  readonly durationMs: number;
  /** Solo en 9:16: el motivo del descarte original sigue vigente en 16:9. */
  readonly soloVertical?: true;
  /** La palabra disparadora se pinta en escena (viaja en annotation.text). */
  readonly conPalabra?: true;
}

// Podas deliberadas frente al hermano. Una pieza de 50 s tolera disparadores
// frecuentes porque solo hay sitio para seis efectos y cualquiera cae en un
// momento con carga. En ocho minutos, un disparador frecuente garantiza que el
// efecto se gasta en la PRIMERA aparición, que casi siempre es la vacía:
// - fuera `no` (~40 apariciones por guion; se gastaría en «no es lo que crees»)
// - fuera `hecho` («de hecho» es muletilla) y `lista` (en tecnología es
//   sustantivo: «una lista de modelos»)
// - fuera `cero`, `segundos`, `minutos`: aparecen dentro de cifras, no como
//   señal de urgencia
// - fuera los multi-token («ya mismo»): normalizeWord borra los espacios
export const MICRO_FX: readonly MicroFxDef[] = [
  {
    id: 'tachado',
    label: 'Tachado',
    triggers: ['jamas', 'nunca', 'olvida', 'olvidate', 'error', 'errores', 'fallo', 'fallos', 'mito', 'mitos', 'mentira', 'falso', 'falsa'],
    edit: 'annotation',
    style: 'strike',
    sfx: 'clic',
    durationMs: 1000,
  },
  {
    id: 'visto',
    label: 'Confirmación',
    triggers: ['correcto', 'correcta', 'funciona', 'funcionan', 'solucion', 'resuelto', 'resuelta', 'listo', 'conseguido', 'perfecto'],
    edit: 'annotation',
    style: 'check',
    sfx: 'notificacion',
    durationMs: 1200,
  },
  {
    id: 'diana',
    label: 'Foco',
    triggers: ['mira', 'mirad', 'fijate', 'fijaos', 'observa', 'detalle', 'detalles', 'detecta', 'detectar', 'exacto', 'exactamente'],
    edit: 'annotation',
    style: 'circle',
    sfx: 'tic',
    durationMs: 1300,
  },
  {
    id: 'subida',
    label: 'Crecimiento',
    triggers: ['crece', 'crecer', 'multiplica', 'multiplicar', 'escala', 'escalar', 'dispara', 'dispararse', 'exponencial', 'duplica', 'triplica'],
    edit: 'micro_fx',
    style: 'spark_up',
    sfx: 'aparicion',
    durationMs: 1200,
  },
  {
    id: 'caida',
    label: 'Desplome',
    triggers: ['cae', 'caer', 'caida', 'desploma', 'desplome', 'desplomarse', 'hunde', 'hundir', 'pierde', 'perder'],
    edit: 'micro_fx',
    style: 'spark_down',
    sfx: 'subgrave',
    durationMs: 1100,
  },
  {
    id: 'candado',
    label: 'Acceso',
    triggers: ['truco', 'trucos', 'desbloquea', 'desbloquear', 'secreto', 'secretos', 'atajo', 'atajos'],
    edit: 'micro_fx',
    style: 'padlock',
    sfx: 'clic',
    durationMs: 1300,
  },
  {
    id: 'cronometro',
    label: 'Urgencia',
    triggers: ['rapido', 'rapida', 'rapidisimo', 'urgente', 'deprisa', 'enseguida', 'instante', 'instantaneo'],
    edit: 'micro_fx',
    style: 'timer',
    sfx: 'tic',
    durationMs: 1400,
  },
  // ---- gramática vertical (coreografías de stamp-banned, notification-pop y
  // text-stack-offset del catálogo hermano; el porqué de cada gesto vive en el
  // componente que las pinta) ----
  {
    id: 'sello',
    label: 'Sello de rechazo',
    triggers: ['prohibido', 'prohibida', 'ilegal', 'ilegales', 'bloqueado', 'bloqueada', 'censura', 'censurado', 'vetado', 'vetada'],
    edit: 'annotation',
    style: 'sello',
    sfx: 'subgrave',
    durationMs: 1400,
    soloVertical: true,
    conPalabra: true,
  },
  {
    id: 'aviso',
    label: 'Notificación de logro',
    triggers: ['ventas', 'ingresos', 'beneficios', 'clientes', 'suscriptores', 'seguidores', 'descargas', 'record'],
    edit: 'annotation',
    style: 'aviso',
    sfx: 'notificacion',
    durationMs: 1600,
    soloVertical: true,
    conPalabra: true,
  },
  {
    id: 'apilado',
    label: 'Palabra apilada',
    triggers: ['importante', 'fundamental', 'clave', 'atencion', 'critico', 'critica', 'esencial'],
    edit: 'annotation',
    style: 'apilado',
    sfx: 'aparicion',
    durationMs: 1300,
    soloVertical: true,
    conPalabra: true,
  },
];

const BY_TRIGGER = new Map<string, MicroFxDef>(
  MICRO_FX.flatMap((def) => def.triggers.map((t) => [t, def] as const)),
);

/** Micro-FX que dispara una palabra pronunciada, o null si ninguna. */
export function microFxFor(word: string): MicroFxDef | null {
  return BY_TRIGGER.get(normalizeWord(word)) ?? null;
}
