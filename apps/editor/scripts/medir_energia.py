#!/usr/bin/env python3
"""Mide la energía de la voz por PALABRA y la escribe en el timeline.

Es el dato que modula la dinámica de `kinetic-captions.html`: la lista
`clave` dice QUÉ palabras llevan carga y la energía dice CUÁNTA lleva cada
una en el audio real. Se mide el RMS de la ventana de cada palabra —el RMS
y no el pico, por lo mismo que `extraer_niveles.py`: el pico de una
locución lo marcan las consonantes explosivas— y se normaliza a 0..1.

La normalización es por PERCENTILES (p20..p95), no por min/max: un golpe
de micro o una ventana casi muda arrastraría la escala entera y dejaría
el resto de la pieza aplanado en el medio. Y una ventana muda no vale 0
sino 0,5 —neutro—: casi siempre es Whisper alargando una palabra sobre un
silencio, y castigarla invertiría el énfasis.

Se mide en reloj de ORIGEN contra el audio fuente. Sobre un timeline ya
remapeado las ventanas estarían desplazadas y cada palabra se mediría
sobre el audio de otra — sin ningún error. Por eso la guarda de `reloj`
aborta en vez de avisar.

El campo `energia` viaja DENTRO de cada palabra (`words[i].energia`), no
en un fichero aparte: `escaleta.subtitulos()` construye `config.palabras`
desde `words` y `_ajusta_subtitulos` filtra dicts enteros, así que el
campo sobrevive al filtrado y al remapeo sin que nadie lo acompañe. Un
fichero aparte obligaría a un join por índice que se desincroniza en
cuanto algo filtra una palabra.

Uso:
    python3 scripts/medir_energia.py                       # build/timeline.json
    python3 scripts/medir_energia.py --timeline build/piezas/H1A/timeline.json
    python3 scripts/medir_energia.py --audio otra_fuente.mp4

Idempotente: dos pasadas dan los mismos valores (no hay estado ni azar).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

from comun import build_dir, carga_json, exige_ffmpeg
from extraer_niveles import SR, muestras

# Por debajo de esto la ventana se considera MUDA: no hay voz que medir,
# solo el suelo de ruido. 1e-4 sobre muestras normalizadas a ±1 son -80 dB,
# muy por debajo de cualquier locución y por encima del cero digital.
RMS_MUDO = 1e-4

# La escala se ancla entre estos dos percentiles de las palabras CON voz.
P_SUELO, P_TECHO = 20.0, 95.0


def percentil(valores: list[float], q: float) -> float:
    """Percentil por interpolación lineal, sobre la lista ordenada.

    Propio y no de numpy: numpy no está en requirements y traerlo por dos
    percentiles sería la dependencia más cara del repo por línea usada."""
    if not valores:
        raise ValueError("percentil de una lista vacía")
    vs = sorted(valores)
    if len(vs) == 1:
        return vs[0]
    pos = (len(vs) - 1) * (q / 100.0)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(vs) - 1)
    return vs[lo] + (vs[hi] - vs[lo]) * (pos - lo)


def rms_db(x: list[float], a: float, b: float, sr: int = SR) -> float | None:
    """RMS en dB de la ventana [a, b) segundos, o None si está muda.

    La ventana se recorta al audio real: una palabra que Whisper estire más
    allá del final no debe reventar, solo medir lo que hay."""
    i = max(0, int(a * sr))
    j = min(len(x), max(int(b * sr), i + 1))
    seg = x[i:j]
    if not seg:
        return None
    rms = math.sqrt(sum(s * s for s in seg) / len(seg))
    if rms <= RMS_MUDO:
        return None
    return 20.0 * math.log10(rms)


def normaliza(dbs: list[float | None]) -> list[float]:
    """De dB por palabra a energía 0..1; None (muda) y audio plano dan 0,5."""
    con_voz = [e for e in dbs if e is not None]
    if not con_voz:
        return [0.5] * len(dbs)
    suelo = percentil(con_voz, P_SUELO)
    techo = percentil(con_voz, P_TECHO)
    if techo - suelo < 1e-6:
        # Audio plano (o una sola palabra): no hay contraste que repartir.
        return [0.5] * len(dbs)
    out = []
    for e in dbs:
        if e is None:
            out.append(0.5)
        else:
            out.append(round(min(1.0, max(0.0, (e - suelo) / (techo - suelo))), 3))
    return out


def aplicar(tl: dict, x: list[float], sr: int = SR) -> dict:
    """Escribe `energia` en cada `words[i]` del timeline. Devuelve el resumen.

    Exige reloj de ORIGEN: `words` remapeadas medirían el audio de otra
    palabra sin dar un solo error."""
    if tl.get("reloj") != "origen":
        print("el timeline no está en reloj de origen (reloj=%r): la energía "
              "se mide contra el audio FUENTE y con el reloj remapeado cada "
              "palabra caería sobre el audio de otra.\n"
              "  Mide sobre build/timeline.json ANTES de silencios.py "
              "--aplicar." % tl.get("reloj"), file=sys.stderr)
        raise SystemExit(2)
    words = tl.get("words", [])
    dbs = [rms_db(x, w["start"], w["end"], sr) for w in words]
    energias = normaliza(dbs)
    for w, e in zip(words, energias):
        w["energia"] = e
    con_voz = [e for e in dbs if e is not None]
    return {
        "palabras": len(words),
        "mudas": len(dbs) - len(con_voz),
        "p20_db": round(percentil(con_voz, P_SUELO), 1) if con_voz else None,
        "p95_db": round(percentil(con_voz, P_TECHO), 1) if con_voz else None,
    }


def main() -> int:
    exige_ffmpeg("ffmpeg")
    ap = argparse.ArgumentParser(
        description="RMS por palabra, normalizado, al timeline (in situ)")
    ap.add_argument("--timeline",
                    default=os.path.join(build_dir(), "timeline.json"))
    ap.add_argument("--audio", default=None,
                    help="por defecto, el `source` del timeline")
    args = ap.parse_args()

    tl = carga_json(args.timeline)
    audio = args.audio or tl.get("source")
    if not audio or not os.path.exists(audio):
        print("no encuentro el audio (%r): pásalo con --audio" % audio,
              file=sys.stderr)
        return 2

    resumen = aplicar(tl, muestras(audio))

    with open(args.timeline, "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False)
    resumen["timeline"] = args.timeline
    print(json.dumps(resumen, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
