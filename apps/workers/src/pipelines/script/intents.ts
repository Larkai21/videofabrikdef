import {
  DROP_LABELS,
  validateSceneIntents,
  normalizaLocucion,
  wordInText,
  type EditIntent,
  type IntentDropReason,
  type Scene,
} from '@fabrica/shared';

// Barrido de intenciones visuales del guion. El prompt PIDE que trigger_word sea
// una palabra literal de la escena, pero la garantía es este código: lo que no
// valida se cae aquí, no en el render.

export interface IntentSweep {
  scenes: Scene[];
  // el efecto va junto al motivo: saber que se cayó «un stat por cifra sin
  // respaldo» dice qué arreglar; «se cayó uno» no dice nada
  dropped: Array<{ sceneId: string; effect: string; reason: IntentDropReason }>;
}

/** Cuántas intenciones llevan estas escenas. Para medir antes y después. */
export function countIntents(scenes: Array<{ edit_intents?: EditIntent[] }>): number {
  return scenes.reduce((acc, s) => acc + (s.edit_intents?.length ?? 0), 0);
}

/** Deja en cada escena solo las intenciones que se sostienen. Nunca lanza. */
export function sweepIntents(scenes: Scene[], claims: readonly { text: string }[]): IntentSweep {
  const dropped: IntentSweep['dropped'] = [];
  const out = scenes.map((scene) => {
    if (scene.edit_intents === undefined || scene.edit_intents.length === 0) return scene;
    const { kept, dropped: fuera } = validateSceneIntents(scene, claims);
    for (const d of fuera) {
      dropped.push({ sceneId: scene.id, effect: d.intent.effect, reason: d.reason });
    }
    const { edit_intents: _omitido, ...resto } = scene;
    return kept.length > 0 ? { ...resto, edit_intents: kept } : resto;
  });
  return { scenes: out, dropped };
}

/**
 * Aviso en español para el humano. Nunca JSON crudo (principio 2): se agrupa por
 * motivo y se nombra el número de efectos, no su estructura.
 */
export function intentWarning(dropped: IntentSweep['dropped']): string | null {
  if (dropped.length === 0) return null;
  const porMotivo = new Map<IntentDropReason, number>();
  for (const d of dropped) porMotivo.set(d.reason, (porMotivo.get(d.reason) ?? 0) + 1);
  const partes = [...porMotivo.entries()].map(
    ([reason, n]) => `${n === 1 ? 'uno' : n} por ${DROP_LABELS[reason]}`,
  );
  const total = dropped.length;
  return `Se han descartado ${total === 1 ? 'un efecto' : `${total} efectos`} del guion: ${partes.join('; ')}.`;
}

/**
 * Intenciones que sobreviven a una reescritura del texto de su escena.
 *
 * Lo usan los tres sitios que cambian `scene.text` conservando el resto del
 * objeto (edición humana, parche del juez y ajuste de duración). Sin esto la
 * garantía «trigger_word está en text» se rompe en silencio y volveríamos al
 * problema original: un efecto anclado a una palabra que ya no se pronuncia.
 */
export function keepValidIntents(
  scene: { edit_intents?: EditIntent[] },
  nuevoTexto: string,
): { edit_intents?: EditIntent[] } {
  const kept = (scene.edit_intents ?? []).filter((i) => wordInText(nuevoTexto, i.trigger_word));
  return kept.length > 0 ? { edit_intents: kept } : {};
}

/**
 * Deja la escena en la forma que se va a locutar: normaliza el texto y, con él,
 * los `trigger_word`.
 *
 * Los dos a la vez o ninguno. Si se normaliza solo el texto, un disparador que
 * dijera «GPT-5.6» deja de casar con el «GPT 5.6» que se oye, y el efecto se
 * descarta sin que nadie lo pida.
 */
export function normalizaEscena<T extends { text: string; edit_intents?: EditIntent[] }>(
  escena: T,
): T {
  const text = normalizaLocucion(escena.text);
  const intents = escena.edit_intents?.map((i) => ({
    ...i,
    trigger_word: normalizaLocucion(i.trigger_word),
  }));
  return { ...escena, text, ...(intents ? { edit_intents: intents } : {}) };
}
