// Heurística simple de avisos al margen del guion (S1, se reporta como provisional):
// una escena que menciona una cifra cuyo número no aparece en ningún claim del
// research merece un aviso. También avisa si el research no trae claims.

export interface Claim {
  text: string;
  source_idx: number;
}

const FIGURE_RE = /\d+(?:[.,]\d+)*\s?(?:%|\$|€|millones|millón|mil\b|k\b)?/gi;

/** Extrae los tokens numéricos visibles de un texto. */
export function extractFigures(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(FIGURE_RE)) {
    const token = match[0].trim();
    if (token !== '') out.push(token);
  }
  return out;
}

function bareNumber(token: string): string {
  return token.replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
}

/**
 * Devuelve el aviso de margen para una escena, o null si no procede.
 * Regla: hay cifra y (no hay claims, o alguna cifra no aparece en ningún claim).
 */
export function sceneMarginNote(sceneText: string, claims: Claim[]): string | null {
  const figures = extractFigures(sceneText);
  if (figures.length === 0) return null;
  if (claims.length === 0) {
    return 'Cifra sin claim en el research. Conviene verificarla antes de renderizar.';
  }
  const unbacked = figures.filter((f) => {
    const bare = bareNumber(f);
    if (bare === '') return false;
    return !claims.some((c) => c.text.includes(bare));
  });
  if (unbacked.length === 0) return null;
  return 'Dato sin fuente en el research. Conviene citar un recuento concreto.';
}

/** Mapa id de escena → aviso, para pintar el margen del documento. */
export function marginNotes(
  scenes: ReadonlyArray<{ id: string; text: string }>,
  claims: Claim[],
): Map<string, string> {
  const notes = new Map<string, string>();
  for (const scene of scenes) {
    const note = sceneMarginNote(scene.text, claims);
    if (note !== null) notes.set(scene.id, note);
  }
  return notes;
}
