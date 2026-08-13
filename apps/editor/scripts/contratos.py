#!/usr/bin/env python3
"""Los contratos entre etapas: claves requeridas e INVARIANTES.

Vive en `scripts/` y no en `tests/` a propósito: lo importan las dos cosas, y
que producción dependa de código de pruebas es al revés de como debe ser. El
CLI es `scripts/comprobar_contratos.py`, para que estas comprobaciones corran
sobre los artefactos REALES en cada sesión y no solo sobre fixtures — la
diferencia entre una prueba que protege al que la escribió y una que protege al
que edita Reels.

## Por qué a mano y no con jsonschema

Tres razones, ninguna estilística:

1. **Ninguno de los fallos históricos de este repo fue una violación de
   forma.** Todos fueron de semántica: una clave en el reloj equivocado, una
   propiedad perdida al copiar, una capa fuera de `ORDEN`, un truncado
   silencioso. JSON Schema valida forma. No puede expresar
   `out_end - out_start == src_end - src_start`, ni «estos tiempos están en el
   reloj original y esos en el de salida», ni «`frames == floor(dur*fps+0.5)`».

2. Sería una dependencia nueva contra la corriente del repo, que comparte
   `ORDEN` como un fichero de datos (`guiones/capas.json`) para no importar
   un módulo desde otro.

3. La forma ya está documentada en CLAUDE.md, y **ya está desincronizada**: el
   `face.json` real tiene `muestras`, `con_rostro`, `tasa_deteccion` y
   `banda_libre`, y el `transcript.json` tiene `alineado_con_guion`, y ninguna
   aparece en el contrato escrito. De ahí el diseño obligado: **claves
   requeridas presentes + invariantes, claves extra permitidas.** Un esquema
   con `additionalProperties: false` estaría en rojo desde el primer día.

Cada función devuelve una lista de problemas; vacía significa que cumple.
"""

from __future__ import annotations

import math
import os
import re

import comun
import reloj

CANONICO = re.compile(r"^\d+\.png$")
UN_MS = 0.0015


def _requeridas(d: dict, claves, que: str) -> list:
    return ["%s: falta la clave `%s`" % (que, k) for k in claves if k not in d]


# --------------------------------------------------------------------------
def transcript(d: dict) -> list:
    mal = _requeridas(d, ("source", "words", "duration"), "transcript.json")
    if mal:
        return mal
    ws = d["words"]
    if not ws:
        return ["transcript.json: `words` está vacío"]

    dur = float(d["duration"])
    # La invariante que dispara el fallo del tramo invertido. El margen real en
    # la pieza de Codex son 0,14 s —duration 49,84, última palabra 49,70—, así
    # que una sola alucinación de cola de large-v3 lo activa.
    if ws[-1]["end"] > dur + UN_MS:
        mal.append(
            "transcript.json: la última palabra acaba en %.3f y `duration` es "
            "%.3f. O la duración está mal o Whisper ha alucinado una cola; con "
            "eso, `tramos_utiles` producía un tramo invertido."
            % (ws[-1]["end"], dur))

    for i, w in enumerate(ws):
        if not str(w.get("w", "")).strip():
            mal.append("transcript.json: `words[%d]` está vacía" % i)
        if float(w["end"]) < float(w["start"]) - UN_MS:
            mal.append("transcript.json: `words[%d]` acaba antes de empezar" % i)
        p = w.get("p")
        if p is not None and not 0.0 <= float(p) <= 1.0:
            mal.append("transcript.json: `words[%d].p` = %s, fuera de [0,1]"
                       % (i, p))
    for i, (a, b) in enumerate(zip(ws, ws[1:])):
        if float(b["start"]) < float(a["start"]) - UN_MS:
            mal.append("transcript.json: `words` no está ordenado en %d" % i)
    return mal


# --------------------------------------------------------------------------
def timeline(d: dict) -> list:
    mal = _requeridas(d, ("reloj", "source", "keep", "words",
                          "duration_original", "duration_final"),
                      "timeline.json")
    if mal:
        return mal

    # La invariante de fondo del Sprint 1.
    if d["reloj"] != "origen":
        mal.append(
            "timeline.json: declara reloj «%s». `words` y `blocks` van SIEMPRE "
            "en «origen»; el reloj de salida se deriva de `keep`." % d["reloj"])

    keep = d["keep"]
    if not keep:
        return mal + ["timeline.json: `keep` está vacío: no se conserva metraje"]

    cursor = 0.0
    for i, k in enumerate(keep):
        s0, s1 = float(k["src_start"]), float(k["src_end"])
        o0, o1 = float(k["out_start"]), float(k["out_end"])
        if s1 <= s0:
            mal.append("timeline.json: `keep[%d]` está invertido (%.3f-%.3f)"
                       % (i, s0, s1))
        if abs((s1 - s0) - (o1 - o0)) > UN_MS:
            mal.append("timeline.json: `keep[%d]` dura %.3f en origen y %.3f "
                       "en salida" % (i, s1 - s0, o1 - o0))
        if abs(o0 - cursor) > UN_MS:
            mal.append("timeline.json: `keep[%d].out_start` es %.3f y debería "
                       "encadenar en %.3f" % (i, o0, cursor))
        cursor = o1
    for i, (a, b) in enumerate(zip(keep, keep[1:])):
        if float(b["src_start"]) < float(a["src_end"]) - UN_MS:
            mal.append("timeline.json: `keep` solapa en origen entre %d y %d"
                       % (i, i + 1))

    dur_o, dur_f = float(d["duration_original"]), float(d["duration_final"])
    m = reloj.Mapa(keep)
    if abs(m.duracion() - dur_f) > 0.01:
        mal.append("timeline.json: `duration_final` es %.3f y de `keep` salen "
                   "%.3f" % (dur_f, m.duracion()))
    if not 0.0 < dur_f <= dur_o + UN_MS:
        mal.append("timeline.json: `duration_final` (%.3f) no cabe en "
                   "`duration_original` (%.3f)" % (dur_f, dur_o))

    # Las palabras están en reloj de ORIGEN, así que caben en el ORIGINAL.
    # Comprobarlas contra `duration_final` es el error de categoría que este
    # contrato existe para atrapar.
    ws = d["words"]
    if ws and float(ws[-1]["end"]) > dur_o + UN_MS:
        mal.append("timeline.json: `words` acaba en %.3f, fuera del vídeo "
                   "original (%.3f)" % (ws[-1]["end"], dur_o))

    # Y `blocks` cuenta el mismo reloj que `words`: salen de la misma lista.
    bs = d.get("blocks") or []
    if bs and ws:
        fin_b, fin_w = max(b["fin"] for b in bs), max(w["end"] for w in ws)
        if abs(fin_b - fin_w) > 0.04:
            mal.append("timeline.json: `blocks` acaba en %.3f y `words` en "
                       "%.3f: están en relojes distintos" % (fin_b, fin_w))
    return mal


# --------------------------------------------------------------------------
def face(d: dict) -> list:
    mal = _requeridas(d, ("zones", "engine", "verificado"), "face.json")
    if mal:
        return mal
    zs = d["zones"]
    if not zs:
        return ["face.json: `zones` está vacío"]
    for i, z in enumerate(zs):
        if not 0.0 < float(z["y_ui"]) < 1.0:
            mal.append("face.json: `zones[%d].y_ui` = %s, fuera de (0,1)"
                       % (i, z["y_ui"]))
        if z.get("safe") not in ("top", "bottom"):
            mal.append("face.json: `zones[%d].safe` = %r; se espera top/bottom"
                       % (i, z.get("safe")))
        if float(z["t1"]) <= float(z["t0"]):
            mal.append("face.json: `zones[%d]` está invertida" % i)
    for m in d.get("samples") or []:
        b = m.get("bbox")
        if b and not all(0.0 <= float(x) <= 1.0 for x in b):
            mal.append("face.json: un `bbox` no está normalizado a [0,1]: %s" % b)
            break
    return mal


# --------------------------------------------------------------------------
def layers(d: dict, comprobar_disco: bool = True,
           base: str | None = None) -> list:
    mal = _requeridas(d, ("fps", "ancho", "alto", "capas"), "layers.json")
    if mal:
        return mal
    # `dir`/`mask` llegan RELATIVOS a la raíz del build (o absolutos, si el
    # manifiesto es anterior al cambio de formato: se aceptan tal cual).
    # `base` la pasa quien sabe dónde vive el fichero; sin ella se cae a la
    # `raiz` grabada en la cabecera.
    d = comun.resolver_manifiesto(d, base)
    if float(d["fps"]) <= 0:
        mal.append("layers.json: `fps` = %s" % d["fps"])
    if (int(d["ancho"]), int(d["alto"])) not in (
            (1080, 1920), (1920, 1080), (1080, 1080)):
        mal.append("layers.json: lienzo %sx%s, que no es ninguno de los "
                   "formatos soportados" % (d["ancho"], d["alto"]))

    nombres = [c["capa"] for c in d["capas"]]
    for n in sorted(set(nombres)):
        if nombres.count(n) > 1:
            mal.append("layers.json: «%s» aparece %d veces"
                       % (n, nombres.count(n)))

    for c in d["capas"]:
        for k in ("capa", "dir", "frames", "dur", "t"):
            if k not in c:
                mal.append("layers.json: a «%s» le falta `%s`"
                           % (c.get("capa", "?"), k))
        if "dur" not in c or "frames" not in c:
            continue
        fps = float(c.get("fps") or d["fps"])
        # `math.floor(x + 0.5)` y NO `round`: el renderizador usa el
        # `Math.round` de JavaScript, que lleva 62.5 a 63, mientras el `round`
        # de Python usa redondeo del banquero y da 62. Con `round`, esta
        # comprobación nacía en rojo para cualquier duración que cayera en un
        # medio exacto, y una comprobación que falla sin motivo se desactiva.
        esperados = max(1, math.floor(float(c["dur"]) * fps + 0.5))
        if abs(int(c["frames"]) - esperados) > 1:
            mal.append("layers.json: «%s» declara %d fotogramas para %.3f s a "
                       "%g fps; se esperaban %d"
                       % (c["capa"], c["frames"], c["dur"], fps, esperados))
        if not comprobar_disco:
            continue
        if not c.get("dir") or not os.path.isdir(c["dir"]):
            mal.append("layers.json: «%s» apunta a un directorio que no existe"
                       % c["capa"])
            continue
        # Se cuentan solo los nombres CANÓNICOS: el repo vive en ~/Documents
        # sincronizado y iCloud deja copias tipo «00140 3.png», que contarían
        # como fotograma de más por un motivo que no tiene nada que ver con el
        # render.
        n = sum(1 for f in os.listdir(c["dir"]) if CANONICO.match(f))
        if n != int(c["frames"]):
            mal.append("layers.json: «%s» declara %d fotogramas y en disco hay "
                       "%d" % (c["capa"], c["frames"], n))
        if c.get("mask") and os.path.isdir(c["mask"]):
            nm = sum(1 for f in os.listdir(c["mask"]) if CANONICO.match(f))
            if nm != n:
                mal.append("layers.json: la máscara de «%s» tiene %d "
                           "fotogramas y la capa %d: la refracción se "
                           "desincroniza sin ningún aviso" % (c["capa"], nm, n))
    return mal


# --------------------------------------------------------------------------
def broll(d: dict) -> list:
    if not d.get("escenas"):
        return []
    mal = _requeridas(d, ("reloj", "escenas"), "broll_plan.json")
    if mal:
        return mal
    if d["reloj"] not in ("origen", "salida"):
        mal.append("broll_plan.json: reloj «%s» desconocido" % d["reloj"])
    es = sorted(d["escenas"], key=lambda e: float(e["t"]))
    for a, b in zip(es, es[1:]):
        if float(b["t"]) < float(a["t"]) + float(a.get("dur", 0)) - UN_MS:
            mal.append("broll_plan.json: «%s» y «%s» se solapan"
                       % (a.get("id"), b.get("id")))
    for e in d["escenas"]:
        for ruta in (e.get("files") or []):
            if not os.path.exists(ruta):
                mal.append("broll_plan.json: «%s» apunta a %s, que no existe"
                           % (e.get("id"), ruta))
    return mal


TODOS = {"transcript.json": transcript, "timeline.json": timeline,
         "face.json": face, "layers.json": layers,
         "broll_plan.json": broll}
