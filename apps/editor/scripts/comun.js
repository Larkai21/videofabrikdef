#!/usr/bin/env node
/* Utilidades compartidas de los scripts de Node. Es el espejo de `comun.py`
   para lo poco que ambos mundos repiten; hoy, UNA cosa: dónde está ffmpeg.

   La resolución es la misma cadena que en Python, y tiene que serlo — dos
   criterios distintos en dos lenguajes es cómo un render encuentra un
   ffmpeg y la composición encuentra otro:

     1. la variable de entorno manda SIEMPRE, aunque apunte a la nada: es la
        palanca del CI y del arnés, que apaga ffmpeg a propósito con
        `FFMPEG_BIN=/no/existe` para probar los mensajes de error;
     2. sin variable, el PATH, que es lo que hace portable el repo fuera de
        esta máquina;
     3. y el default de Homebrew de último respaldo, porque en macOS el PATH
        de un proceso lanzado fuera de una shell (un hook de git, un editor)
        no siempre trae /opt/homebrew/bin. */

'use strict';

const fs = require('fs');
const path = require('path');

function localizarBinario(nombre, variable) {
  const porEntorno = process.env[variable];
  if (porEntorno) return porEntorno;
  /* `which` sin subproceso: se recorre el PATH buscando un ejecutable. */
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidato = path.join(dir, nombre);
    try {
      fs.accessSync(candidato, fs.constants.X_OK);
      if (fs.statSync(candidato).isFile()) return candidato;
    } catch { /* no está en este directorio del PATH */ }
  }
  return path.join('/opt/homebrew/bin', nombre);
}

const FFMPEG = localizarBinario('ffmpeg', 'FFMPEG_BIN');
const FFPROBE = localizarBinario('ffprobe', 'FFPROBE_BIN');

module.exports = { localizarBinario, FFMPEG, FFPROBE };
