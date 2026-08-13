#!/usr/bin/env python3
"""Comprueba los clips de origen ANTES de tocarlos.

Existe por un error concreto y caro: los clips de `assets/aroll/` venían
codificados como 3840x2160 con una matriz de rotación de 90 grados. Es
decir, **vertical**. Yo consulté `width` y `height`, leí 16:9 y monté el
vídeo entero apaisado, aplastando la imagen.

La lección es que `width`/`height` son las dimensiones CODIFICADAS. Las de
PANTALLA salen de aplicarles la rotación, y ffmpeg sí la aplica al
decodificar: quien no la mira es quien lee el metadato a mano.

También avisa de mezclas que rompen el montaje más adelante: distinta
resolución, distinto fps o distinto número de canales entre clips obligan
a normalizar antes de concatenar.

Uso:
    python3 scripts/comprobar_fuentes.py assets/aroll
    python3 scripts/comprobar_fuentes.py assets/aroll --json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

from comun import exige_ffmpeg

# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFPROBE                       # noqa: E402
EXT = (".mp4", ".mov", ".m4v", ".mkv", ".avi")


def sonda(ruta: str) -> dict:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", ruta],
        capture_output=True, text=True)
    if r.returncode != 0:
        return {"error": r.stderr.strip()[:200]}
    d = json.loads(r.stdout)
    v = next((s for s in d["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    if not v:
        return {"error": "sin pista de vídeo"}

    # La rotación puede venir en side_data (moderno) o en tags (antiguo).
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(float(sd["rotation"]))
    if not rot:
        rot = int(float(v.get("tags", {}).get("rotate", 0) or 0))
    rot = rot % 360

    w, h = int(v["width"]), int(v["height"])
    # Las dimensiones de PANTALLA: es lo que ve el espectador y lo que
    # produce ffmpeg al decodificar.
    dw, dh = (h, w) if rot in (90, 270) else (w, h)

    fps = 0.0
    try:
        num, den = v.get("r_frame_rate", "0/1").split("/")
        fps = round(float(num) / float(den), 3)
    except (ValueError, ZeroDivisionError):
        pass

    return {
        "codificado": "%dx%d" % (w, h),
        "rotacion": rot,
        "pantalla": "%dx%d" % (dw, dh),
        "orientacion": ("vertical" if dh > dw
                        else "cuadrado" if dh == dw else "apaisado"),
        "formato": "%.3f" % (dw / dh) if dh else "?",
        "fps": fps,
        "dur": round(float(d["format"].get("duration", 0) or 0), 2),
        "codec": v.get("codec_name"),
        "audio": (a or {}).get("codec_name"),
        "canales": (a or {}).get("channels"),
        "sr": (a or {}).get("sample_rate"),
    }


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffprobe")
    ap = argparse.ArgumentParser()
    ap.add_argument("ruta", help="carpeta o archivo")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if os.path.isdir(args.ruta):
        archivos = [os.path.join(args.ruta, f) for f in sorted(os.listdir(args.ruta))
                    if f.lower().endswith(EXT)]
    else:
        archivos = [args.ruta]
    if not archivos:
        print("  ✗ no hay clips en %s" % args.ruta)
        return 1

    info = {}
    for f in archivos:
        info[os.path.basename(f)] = sonda(f)

    if args.json:
        print(json.dumps(info, indent=2, ensure_ascii=False))

    errores, avisos = [], []
    for n, d in info.items():
        if "error" in d:
            errores.append("%s: %s" % (n, d["error"]))
            continue
        if not args.json:
            marca = "⟲ " if d["rotacion"] else "  "
            print("  %s%-14s %s → %s  %-9s %5.2f fps  %6.2f s  %s/%s"
                  % (marca, n, d["codificado"], d["pantalla"],
                     d["orientacion"], d["fps"], d["dur"],
                     d["codec"], d["audio"] or "sin audio"))
        if d["rotacion"]:
            avisos.append(
                "%s lleva rotación de %d°: se ve %s, NO %s. Escalar a las "
                "dimensiones codificadas deforma la imagen."
                % (n, d["rotacion"], d["pantalla"], d["codificado"]))

    buenos = [d for d in info.values() if "error" not in d]
    for campo, texto in (("pantalla", "resolución de pantalla"),
                         ("fps", "frecuencia"),
                         ("canales", "canales de audio")):
        vals = {d[campo] for d in buenos if d.get(campo) is not None}
        if len(vals) > 1:
            avisos.append("los clips no comparten %s (%s): hay que "
                          "normalizar antes de concatenar."
                          % (texto, ", ".join(str(v) for v in sorted(map(str, vals)))))

    print("")
    for a in avisos:
        print("  ⚠ %s" % a)
    for e in errores:
        print("  ✗ %s" % e)
    if not avisos and not errores:
        print("  ✓ %d clip(s) coherentes y sin rotación" % len(buenos))

    print("\n%d clip(s), %d aviso(s), %d error(es)"
          % (len(info), len(avisos), len(errores)))
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
