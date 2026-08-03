// Subtítulos SRT/VTT desde los cues congelados del maestro. Transformación
// pura, cero llamadas: los cues ya traen la agrupación en líneas y los tiempos
// EXACTOS del audio (los word boundaries del TTS son la verdad; no hay
// Whisper). Lo único que se hace aquí es re-basar al tiempo del MP4 — la intro
// de marca antepone unos segundos y desplaza todo, el mismo desplazamiento que
// ya llevan los capítulos de description.txt — y formatear.

export interface CueLike {
  from_ms: number;
  to_ms: number;
  text: string;
}

function pad(n: number, ancho: number): string {
  return String(n).padStart(ancho, '0');
}

function tiempo(ms: number, sepDecimal: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const mil = t % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sepDecimal}${pad(mil, 3)}`;
}

/** SRT con los tiempos re-basados al MP4 (offset = duración de la intro). */
export function cuesToSrt(cues: CueLike[], offsetMs = 0): string {
  return cues
    .map((c, i) =>
      [
        String(i + 1),
        `${tiempo(c.from_ms + offsetMs, ',')} --> ${tiempo(c.to_ms + offsetMs, ',')}`,
        c.text,
        '',
      ].join('\n'),
    )
    .join('\n');
}

/** WebVTT, mismo contenido que el SRT (YouTube acepta los dos formatos). */
export function cuesToVtt(cues: CueLike[], offsetMs = 0): string {
  const cuerpo = cues
    .map(
      (c) =>
        `${tiempo(c.from_ms + offsetMs, '.')} --> ${tiempo(c.to_ms + offsetMs, '.')}\n${c.text}`,
    )
    .join('\n\n');
  return `WEBVTT\n\n${cuerpo}\n`;
}
