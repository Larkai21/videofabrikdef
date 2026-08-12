import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ejec = promisify(execFile);

// Silencios medidos en el AUDIO, no en los huecos entre palabras de Whisper.
//
// Trampa aprendida en el proyecto hermano (editor-youtube/CLAUDE.md): Whisper
// alarga la última palabra de cada frase hasta el siguiente ataque, así que
// por sus tiempos casi no hay huecos — un cruce por pausas basado en los word
// timestamps no vería nada. La transcripción sirve para no cortar dentro de
// una palabra; el silencio lo dice el audio.
//
// Umbrales para voz hablada con ruido de fondo (podcast/directo), no para el
// TTS limpio de frases.ts (-45 dB/0.05 s): -35 dB y 0,25 s ignoran las
// respiraciones y se quedan con las pausas de verdad.

const RUIDO_DB = -35;
const MIN_S = 0.25;

/** Tramos [desde_ms, hasta_ms] de silencio en el fichero. */
export async function detectarSilencios(audioPath: string): Promise<[number, number][]> {
  const r = await ejec(
    'ffmpeg',
    [
      '-nostdin',
      '-i',
      audioPath,
      '-af',
      `silencedetect=n=${RUIDO_DB}dB:d=${MIN_S}`,
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  ).catch((err: { stderr?: string }) => ({ stderr: err.stderr ?? '' }) as { stderr: string });
  // silencedetect escribe por stderr líneas silence_start/silence_end
  const out: [number, number][] = [];
  let inicio: number | null = null;
  for (const linea of (r.stderr ?? '').split('\n')) {
    const start = /silence_start:\s*([\d.]+)/.exec(linea);
    if (start) inicio = Math.round(Number.parseFloat(start[1]!) * 1000);
    const end = /silence_end:\s*([\d.]+)/.exec(linea);
    if (end && inicio !== null) {
      out.push([inicio, Math.round(Number.parseFloat(end[1]!) * 1000)]);
      inicio = null;
    }
  }
  return out;
}
