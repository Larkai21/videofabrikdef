import { execa } from 'execa';

// Música de fondo (docs/voz-y-beats.md §2, S2): pista de la biblioteca a
// −22 dB bajo la voz, mezclada DESPUÉS del loudnorm de la voz. La pista se
// elige de forma determinista con un hash del videoId (mismo vídeo → misma
// pista, aunque cambie el orden de llegada de las filas). Lógica pura + un
// único comando ffmpeg, sin tocar la duración de la voz.

export const MUSIC_GAIN_DB = -22;
export const MUSIC_FADE_S = 2;
// pistas de los últimos N vídeos del canal que el pick aparta (anti-repetición)
export const MUSIC_ANTI_REPEAT_N = 3;
// la mezcla no puede cambiar la duración del master más que esto
export const MUSIC_DURATION_TOLERANCE_MS = 50;

// FNV-1a de 32 bits: hash determinista y barato (mismo videoId → misma pista)
export function musicHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Selección determinista: ordena por id (estable ante el orden de la consulta)
// y elige con el hash del videoId. Sin pistas → null (el flujo sigue sin música).
// `excluir` = pistas de los últimos vídeos del canal (anti-repetición): se
// apartan mientras quede alternativa; si el pool entero está excluido, se
// repite — con la música activada, repetir pista es mejor que quitarla.
export function pickMusicTrack<T extends { id: string }>(
  videoId: string,
  tracks: T[],
  excluir: ReadonlySet<string> = new Set(),
): T | null {
  if (tracks.length === 0) return null;
  const frescas = tracks.filter((t) => !excluir.has(t.id));
  const pool = frescas.length > 0 ? frescas : tracks;
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted[musicHash(videoId) % sorted.length] ?? null;
}

// Cadena de filtros de la mezcla, pura para poder testearla:
// - la pista entra en bucle (-stream_loop -1) y amix con duration=first la
//   corta EXACTAMENTE al final de la voz
// - volume=-22dB base, fade out de 2 s al final
// - DUCKING: sidechaincompress con la voz como cadena lateral → cuando hay voz
//   la música baja sola y respira en los silencios (suena profesional en vez de
//   un lecho plano). La voz se divide (asplit) en la mezcla y la cadena lateral.
// - normalize=0 en amix para no atenuar la voz al mezclar
export function buildMusicMixFilter(voiceDurationMs: number): string {
  const fadeStartS = Math.max(0, voiceDurationMs / 1000 - MUSIC_FADE_S);
  return [
    `[0:a]asplit=2[voz][sc]`,
    `[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume=${MUSIC_GAIN_DB}dB,` +
      `afade=t=out:st=${fadeStartS.toFixed(3)}:d=${MUSIC_FADE_S}[bg]`,
    // umbral/ratio suaves: baja ~6-8 dB bajo la voz, ataque rápido, release lento
    `[bg][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[bgduck]`,
    `[voz][bgduck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`,
  ].join(';');
}

export async function mixMusicUnderVoice(opts: {
  voicePath: string;
  musicPath: string;
  outPath: string;
  voiceDurationMs: number;
}): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-i',
    opts.voicePath,
    '-stream_loop',
    '-1',
    '-i',
    opts.musicPath,
    '-filter_complex',
    buildMusicMixFilter(opts.voiceDurationMs),
    '-map',
    '[mix]',
    '-ar',
    '44100',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    opts.outPath,
  ]);
}
