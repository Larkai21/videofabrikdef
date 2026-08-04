import fsp from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { DELIVERY_LUFS, DELIVERY_TRUE_PEAK } from '@fabrica/shared';
import { measureLoudness } from '../tts/audio.js';

/**
 * Lleva el MP4 entregado a la sonoridad de plataforma (−14 LUFS).
 *
 * La voz se normaliza a −16 (referencia de mezcla de música y SFX), pero
 * YouTube normaliza a ~−14 y SOLO atenúa: entregar por debajo regala volumen
 * frente a cualquier otro vídeo. Medido en el último vídeo antes de esto:
 * −16,9 LUFS con pico real −4,4 dBTP — la subida cabe entera.
 *
 * Ganancia plana (`volume=`), no loudnorm: el loudnorm dinámico recomprime y
 * la mezcla ya viene medida; aquí solo falta nivel. Se limita por el techo de
 * pico real y solo se SUBE — si el MP4 ya está por encima de −14, YouTube
 * atenuará por su cuenta y bajar aquí destruiría margen sin ganar nada.
 *
 * Solo se re-encodea el audio (vídeo `-c:v copy`): rápido e idempotente — en
 * una segunda pasada la medida ya da ~−14 y la ganancia queda bajo el umbral.
 */
export async function ajustarLoudnessEntrega(
  mp4Path: string,
  logger: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  },
): Promise<void> {
  const medida = await measureLoudness(mp4Path, logger);
  if (medida === null) return; // sin medida no se toca nada; ya quedó el warn
  const haciaObjetivo = DELIVERY_LUFS - medida.lufs;
  const margenPico = DELIVERY_TRUE_PEAK - medida.truePeakDb;
  const ganancia = Math.min(haciaObjetivo, margenPico);
  if (ganancia <= 0.1) {
    // dos motivos distintos, dos mensajes: «ya está» y «no cabe» no son lo
    // mismo — un log que dice lo primero cuando pasa lo segundo miente
    if (haciaObjetivo > 0.1) {
      logger.warn(
        { lufs: medida.lufs, truePeakDb: medida.truePeakDb, faltanDb: Number(haciaObjetivo.toFixed(2)) },
        'El MP4 queda por debajo de la sonoridad de entrega: el pico real no deja subir más',
      );
    } else {
      logger.info(
        { lufs: medida.lufs, truePeakDb: medida.truePeakDb },
        'El MP4 ya está en la sonoridad de entrega; sin ganancia',
      );
    }
    return;
  }
  const tmp = path.join(path.dirname(mp4Path), `.loudness-${path.basename(mp4Path)}`);
  await execa('ffmpeg', [
    '-y',
    '-i',
    mp4Path,
    '-c:v',
    'copy',
    '-af',
    `volume=${ganancia.toFixed(2)}dB`,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    tmp,
  ]);
  // rename atómico: /files y /videos/:id/download sirven este path
  await fsp.rename(tmp, mp4Path);
  logger.info(
    { lufsAntes: medida.lufs, gananciaDb: Number(ganancia.toFixed(2)) },
    'MP4 subido a la sonoridad de entrega (−14 LUFS)',
  );
}
