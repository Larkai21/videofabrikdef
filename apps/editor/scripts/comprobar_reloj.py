#!/usr/bin/env python3
"""Mide si el reloj de la pieza está sano. Solo lee; no escribe en `build/`.

Existe porque el fallo de reloj de este repo NO da error y NO se ve en el
JSON: `validar_plan.py` no lo detecta —un desfase de segundos cae dentro de
rangos válidos— y `composite_ffmpeg.py` nunca lee `plan.json` ni
`timeline.words`. El daño queda grabado píxel a píxel en los fotogramas de
los subtítulos, así que hasta ahora solo se veía mirando el vídeo entero.

**Ni la duración ni `keep` valen como evidencia.** Entre el pipeline roto y
el arreglado la duración de salida difiere 0,09 s, y hay casos en los que
`keep` sale idéntico mientras las palabras se desplazan segundos. Cualquier
comprobación basada en esas dos cosas da luz verde a un vídeo descuadrado.
De ahí las cinco de aquí abajo, que miran otra cosa.

    A · anclaje       la palabra bajo cada gráfico sigue siendo la misma
    B · habla         los silencios eliminados no pisan habla transcrita
    C · canario       la señal de huecos entre palabras sigue viva
    D · idempotencia  aplicar dos veces da el mismo resultado
    E · coherencia    `blocks` y `words` cuentan el mismo reloj

Uso:
    python3 scripts/comprobar_reloj.py                 # sobre build/
    python3 scripts/comprobar_reloj.py --build otro/
    python3 scripts/comprobar_reloj.py --sin-ffmpeg    # omite B

Devuelve 1 si alguna comprobación falla.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                 # noqa: E402

import clean_transcript as ct          # noqa: E402
import reloj                           # noqa: E402
import silencios as sil                # noqa: E402

FPS = 25.0
UN_FOTOGRAMA = 1.0 / FPS


# --------------------------------------------------------------------------
#  utilidades
# --------------------------------------------------------------------------
class Resultado:
    def __init__(self, clave: str, titulo: str):
        self.clave, self.titulo = clave, titulo
        self.ok: bool | None = None       # None = omitida
        self.medida = ""
        self.detalle: list[str] = []

    def pasa(self, medida: str) -> "Resultado":
        self.ok, self.medida = True, medida
        return self

    def falla(self, medida: str) -> "Resultado":
        self.ok, self.medida = False, medida
        return self

    def omitida(self, motivo: str) -> "Resultado":
        self.ok, self.medida = None, motivo
        return self


def palabra_mas_cercana(palabras: list, t: float) -> tuple[int, float]:
    """Índice de la palabra cuyo inicio está más cerca de `t`, y el desfase.

    Es la unidad de medida del check A: un gráfico «está en su sitio» si cae
    sobre la misma palabra antes y después de comprimir el reloj. Lo dice el
    propio ROADMAP: la prueba que vale no es cuántos segundos se quitan, es
    que los gráficos sigan cayendo sobre la misma palabra."""
    mejor, dmin = -1, float("inf")
    for i, w in enumerate(palabras):
        d = abs(float(w["start"]) - t)
        if d < dmin:
            mejor, dmin = i, d
    return mejor, dmin


def via_documentada(transcript: dict) -> dict:
    """Reproduce EN MEMORIA la secuencia de CLAUDE.md, sin escribir nada.

    O sea `clean_transcript.py` con su umbral por defecto (0.35, el que
    aparece literalmente en los comandos rápidos), que es lo que hace
    cualquiera que siga la documentación.

    Este instrumento nació modelando el FALLO: devolvía `words` en reloj de
    salida porque es lo que `clean_transcript.py` hacía. Ahora modela el
    contrato: `words` y `blocks` en reloj de ORIGEN y `keep` como único
    registro de la traducción. Se mantiene `words_salida` —derivado, no
    almacenado— porque los checks lo necesitan para responder «¿qué leería
    quien escribe un plan?»."""
    palabras = transcript["words"]
    dur = transcript.get("duration") or (palabras[-1]["end"] + 0.5)

    grupos = ct.agrupar_por_pausa(palabras, 0.35)
    fuera = ct.detectar_tomas_falsas(grupos, 4, 0.82, 3)
    descartadas = {id(w) for gi in fuera for w in grupos[gi]}
    vivas = [w for w in palabras if id(w) not in descartadas]
    vivas, _ = ct.recortar_colas(vivas, 0.35)

    tramos = ct.tramos_utiles(vivas, 0.35, 0.08, dur)
    salida_, dur_final = ct.remapear(vivas, tramos)
    dentro = {id(w) for w in vivas
              if any(a <= w["start"] <= b for a, b in tramos)}
    en_origen = [w for w in vivas if id(w) in dentro]

    keep, cursor = [], 0.0
    for a, b in tramos:
        keep.append({"src_start": round(a, 3), "src_end": round(b, 3),
                     "out_start": round(cursor, 3),
                     "out_end": round(cursor + (b - a), 3)})
        cursor += b - a

    return {"reloj": "origen",
            "source": transcript["source"], "keep": keep,
            "words": en_origen,                    # reloj de ORIGEN
            "words_origen": en_origen,             # el mismo, por claridad
            "words_salida": salida_,               # derivado, para los checks
            "blocks": ct.bloques_karaoke(en_origen, 4, 1.8, 0.35),
            "duration_original": round(dur, 3),
            "duration_final": round(dur_final, 3)}


# --------------------------------------------------------------------------
#  A · anclaje
# --------------------------------------------------------------------------
def check_a(tl: dict, fuente: str, sin_ffmpeg: bool) -> Resultado:
    r = Resultado("A", "anclaje: el gráfico sigue sobre su palabra")
    if sin_ffmpeg or not fuente or not os.path.exists(fuente):
        return r.omitida("necesita la fuente de audio")

    # La REFERENCIA es el audio, no las palabras del timeline.
    #
    # Mi primera versión de este check comparaba la capa remapeada contra las
    # palabras remapeadas, y pasaba 8/8 con el pipeline roto: las dos cosas
    # cruzan el mismo mapa, así que derivan juntas y el error se cancela. Una
    # comprobación que no puede fallar no comprueba nada.
    #
    # Lo que hay que preguntar es otra cosa: la palabra X se pronuncia en el
    # segundo `o` del ORIGINAL; tras quitar los silencios, el instante del
    # vídeo final en que se oye es `Mapa(keep_final)(o)` y no hay discusión,
    # porque `keep` es el recorte que ffmpeg va a aplicar al metraje. El
    # gráfico anclado a esa palabra tiene que caer ahí.
    origen = tl["words_origen"]
    salida = tl["words_salida"]           # lo que leería quien escribe el plan
    anclas = list(range(0, len(origen), max(1, len(origen) // 8)))[:8]

    # Plan sintético a propósito: así la comprobación mide el mecanismo y no
    # depende de qué pieza haya en `build/`. Los tiempos se escriben LEYENDO
    # `timeline.words`, que es lo que hacen los planes a mano; con el contrato
    # arreglado eso es reloj de ORIGEN.
    #
    # Cada capa lleva además una palabra en su config a 0,30 s RELATIVOS de su
    # inicio. Eso ejercita el otro camino del remapeo, el que antes acertaba
    # solo por accidente: las capas de subtítulos viven en t=0 y ahí la
    # fórmula relativa colapsa a la absoluta. Estas capas están en t>0.
    DESFASE = 0.30
    plan = [{"capa": "prueba%d" % k, "template": "pills.html",
             "t": float(origen[i]["start"]), "duracion": 1.5,
             "config": {"duration": 1.5,
                        "palabras": [{"w": origen[i]["w"],
                                      "ini": DESFASE, "fin": DESFASE + 0.2}]}}
            for k, i in enumerate(anclas)]

    with tempfile.TemporaryDirectory() as tmp:
        p_tl = os.path.join(tmp, "timeline.json")
        p_pl = os.path.join(tmp, "plan.json")
        json.dump(tl, open(p_tl, "w", encoding="utf-8"), ensure_ascii=False)
        json.dump(plan, open(p_pl, "w", encoding="utf-8"), ensure_ascii=False)
        cod = _aplicar(p_tl, p_pl, fuente)
        if cod != 0:
            return r.falla("silencios.py devolvió %d" % cod)
        tl2 = json.load(open(p_tl, encoding="utf-8"))
        plan2 = json.load(open(p_pl, encoding="utf-8"))

    mapa = reloj.Mapa(tl2["keep"])
    aciertos, peor, peor_pal = 0, 0.0, ""
    rel_ok = 0
    for despues, i in zip(plan2, anclas):
        verdad = mapa(float(origen[i]["start"]))   # cuándo SE OYE de verdad
        desfase = abs(float(despues["t"]) - verdad)
        if desfase <= UN_FOTOGRAMA:
            aciertos += 1
        else:
            r.detalle.append(
                "  «%s» se oye en %.3f s y su gráfico cae en %.3f s (%+.3f s)"
                % (origen[i]["w"], verdad, despues["t"],
                   float(despues["t"]) - verdad))
        if desfase > peor:
            peor, peor_pal = desfase, origen[i]["w"]

        # El tiempo de dentro de la config es relativo: su instante ABSOLUTO
        # tiene que seguir siendo el mismo trozo de audio que antes.
        rel = despues["config"]["palabras"][0]["ini"]
        abs_esperado = mapa(float(origen[i]["start"]) + DESFASE)
        if abs(float(despues["t"]) + rel - abs_esperado) <= UN_FOTOGRAMA:
            rel_ok += 1
        else:
            r.detalle.append(
                "  «%s»: su palabra interna debía caer en %.3f s y cae en %.3f s"
                % (origen[i]["w"], abs_esperado, float(despues["t"]) + rel))

    medida = ("%d/%d gráficos sobre su palabra y %d/%d tiempos relativos "
              "correctos, peor desfase %.3f s%s"
              % (aciertos, len(anclas), rel_ok, len(anclas), peor,
                 " («%s»)" % peor_pal if peor else ""))
    bien = aciertos == len(anclas) and rel_ok == len(anclas)
    return r.pasa(medida) if bien else r.falla(medida)


def _aplicar(p_tl: str, p_pl: str, fuente: str) -> int:
    return subprocess.run(
        [sys.executable, os.path.join(RAIZ, "scripts", "silencios.py"),
         "--timeline", p_tl, "--plan", p_pl, "--fuente", fuente, "--aplicar"],
        capture_output=True, text=True).returncode


# --------------------------------------------------------------------------
#  B · no cortar habla
# --------------------------------------------------------------------------
def check_b(tl: dict, fuente: str, sin_ffmpeg: bool) -> Resultado:
    r = Resultado("B", "habla: los silencios no pisan palabras")
    if sin_ffmpeg or not fuente or not os.path.exists(fuente):
        return r.omitida("necesita la fuente de audio")

    brutos = sil.silencios_audio(fuente, -34.0, 0.30)
    huecos = sil.huecos_transcripcion(tl["words"], 0.30)
    tramos = sil.protege_habla(brutos + huecos, tl["words"], 0.05)

    # Se mide contra el habla en el reloj de ORIGEN, que es el único en el
    # que los silencios del audio tienen sentido. Y se usa la duración
    # ESTIMADA por longitud, no el final de Whisper: ese alarga la última
    # palabra de cada frase hasta el siguiente ataque, así que tomarlo al pie
    # de la letra convierte cualquier pausa en «habla» y la comprobación no
    # detectaría nada. Es el mismo criterio que `protege_habla`.
    pisado, peor, culpable = 0.0, 0.0, ""
    for w in tl.get("words_origen") or tl["words"]:
        ini = float(w["start"])
        fin = min(float(w["end"]),
                  ini + 0.075 * max(1, len(str(w["w"]).strip())))
        for a, b in tramos:
            solape = min(fin, b) - max(ini, a)
            if solape > 0:
                pisado += solape
                if solape > peor:
                    peor, culpable = solape, w["w"]

    medida = "%.3f s de habla pisada (peor: %.3f s en «%s»)" % (
        pisado, peor, culpable) if peor else "0 s de habla pisada"
    # 0,05 s es el umbral: por debajo de eso es cola de palabra, que Whisper
    # alarga de todos modos y que recortar no se oye.
    return r.pasa(medida) if pisado <= 0.05 else r.falla(medida)


# --------------------------------------------------------------------------
#  C · canario de señal
# --------------------------------------------------------------------------
def check_c(tl: dict) -> Resultado:
    r = Resultado("C", "canario: la señal de huecos sigue viva")
    n = len(sil.huecos_transcripcion(tl["words"], 0.30))
    # Esta señal existe por un fallo medido: `silencedetect` mide PICO, y un
    # chasquido de boca de -8 dB mantiene por encima del umbral un tramo cuyo
    # nivel MEDIO es -47 dB y en el que no habla nadie. Que no haya PALABRA
    # es un dato independiente del nivel. Si el reloj de `words` no es el del
    # audio, esta señal devuelve cero y el módulo informa de éxito.
    medida = "%d huecos entre palabras" % n
    return r.pasa(medida) if n > 0 else r.falla(medida + " — la señal está muerta")


# --------------------------------------------------------------------------
#  D · idempotencia
# --------------------------------------------------------------------------
def check_d(build: str, fuente: str, sin_ffmpeg: bool) -> Resultado:
    r = Resultado("D", "idempotencia: dos pasadas dan lo mismo")
    p_tl0 = os.path.join(build, "timeline.json")
    p_pl0 = os.path.join(build, "plan.json")
    if not (os.path.exists(p_tl0) and os.path.exists(p_pl0)):
        return r.omitida("faltan build/timeline.json o build/plan.json")
    if sin_ffmpeg or not fuente or not os.path.exists(fuente):
        return r.omitida("necesita la fuente de audio")

    with tempfile.TemporaryDirectory() as tmp:
        p_tl = os.path.join(tmp, "timeline.json")
        p_pl = os.path.join(tmp, "plan.json")
        shutil.copy(p_tl0, p_tl)
        shutil.copy(p_pl0, p_pl)
        _aplicar(p_tl, p_pl, fuente)
        a_tl = open(p_tl, encoding="utf-8").read()
        a_pl = open(p_pl, encoding="utf-8").read()
        _aplicar(p_tl, p_pl, fuente)
        b_tl = open(p_tl, encoding="utf-8").read()
        b_pl = open(p_pl, encoding="utf-8").read()

    if a_tl == b_tl and a_pl == b_pl:
        return r.pasa("las dos pasadas son idénticas")

    ta, tb = json.loads(a_tl), json.loads(b_tl)
    pa, pb = json.loads(a_pl), json.loads(b_pl)
    r.detalle.append("  tramos de keep: %d -> %d"
                     % (len(ta["keep"]), len(tb["keep"])))
    if ta.get("words") and tb.get("words"):
        r.detalle.append("  words[-1].start: %.3f -> %.3f (%+.3f s)"
                         % (ta["words"][-1]["start"], tb["words"][-1]["start"],
                            tb["words"][-1]["start"] - ta["words"][-1]["start"]))
    peor, cual = 0.0, ""
    for x, y in zip(pa, pb):
        d = abs(float(y["t"]) - float(x["t"]))
        if d > peor:
            peor, cual = d, x["capa"]
    if peor:
        r.detalle.append("  mayor desplazamiento en el plan: %.3f s (%s)"
                         % (peor, cual))
    return r.falla("la segunda pasada cambia el resultado")


# --------------------------------------------------------------------------
#  E · coherencia interna
# --------------------------------------------------------------------------
def check_e(build: str) -> Resultado:
    r = Resultado("E", "coherencia: blocks y words, el mismo reloj")
    p = os.path.join(build, "timeline.json")
    if not os.path.exists(p):
        return r.omitida("falta build/timeline.json")
    tl = json.load(open(p, encoding="utf-8"))
    bl = tl.get("blocks") or []
    if not bl:
        return r.omitida("el timeline no tiene blocks")
    if tl.get("reloj") != "origen":
        return r.falla("el timeline declara reloj «%s»; el contrato dice que "
                       "words y blocks van SIEMPRE en «origen»"
                       % tl.get("reloj"))

    # Mi primera versión comparaba el fin de `blocks` contra
    # `keep[-1].out_end`, que es el reloj de SALIDA. Con el contrato arreglado
    # eso da un falso positivo de 11 s: son dos relojes distintos, y compararlos
    # es el mismo error de categoría que este sprint viene a arreglar. Lo que
    # hay que comprobar son otras tres cosas.
    fin_bl = max(float(b["fin"]) for b in bl)
    fin_w = max(float(w["end"]) for w in tl["words"]) if tl.get("words") else 0.0
    dur_orig = float(tl.get("duration_original") or 0)
    mapa = reloj.Mapa(tl.get("keep") or [])
    fin_pieza = mapa.duracion()

    r.detalle.append("  ORIGEN  words hasta %.3f · blocks hasta %.3f · "
                     "el vídeo dura %.3f" % (fin_w, fin_bl, dur_orig))
    r.detalle.append("  SALIDA  derivado: blocks hasta %.3f · la pieza dura "
                     "%.3f" % (mapa(fin_bl), fin_pieza))

    fallos = []
    # 1) los dos cuentan el mismo reloj: salen de la misma lista de palabras
    if abs(fin_bl - fin_w) > UN_FOTOGRAMA:
        fallos.append("blocks y words difieren %.3f s" % abs(fin_bl - fin_w))
    # 2) caben en el ORIGINAL, que es el reloj en el que están
    if dur_orig and fin_bl > dur_orig + UN_FOTOGRAMA:
        fallos.append("blocks sale %.3f s del vídeo original"
                      % (fin_bl - dur_orig))
    # 3) y al derivarlos, caben en la pieza
    if fin_pieza and mapa(fin_bl) > fin_pieza + UN_FOTOGRAMA:
        fallos.append("derivados, salen %.3f s de la pieza"
                      % (mapa(fin_bl) - fin_pieza))

    if fallos:
        return r.falla("; ".join(fallos))
    return r.pasa("words y blocks coinciden y caben en los dos relojes")


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default=comun.build_dir())
    ap.add_argument("--sin-ffmpeg", action="store_true",
                    help="omite las comprobaciones que necesitan el audio")
    args = ap.parse_args()

    p_tr = os.path.join(args.build, "transcript.json")
    if not os.path.exists(p_tr):
        print("falta %s — ejecuta antes:\n"
              "  .venv/bin/python scripts/transcribe_mlx.py --input <video>"
              % p_tr, file=sys.stderr)
        return 2
    transcript = json.load(open(p_tr, encoding="utf-8"))
    fuente = transcript.get("source") or ""

    # Los checks A, B y C se miden sobre la VÍA DOCUMENTADA reconstruida en
    # memoria, no sobre lo que haya en `build/`: así el informe dice si la
    # secuencia de CLAUDE.md produce un vídeo cuadrado, que es la pregunta.
    # D y E sí miran los artefactos reales del disco.
    doc = via_documentada(transcript)

    print("fuente : %s" % (fuente or "(sin declarar)"))
    print("vía documentada: clean_transcript.py --silencio 0.35 -> "
          "%d tramos, %.2f s\n" % (len(doc["keep"]), doc["duration_final"]))

    checks = [
        check_a(doc, fuente, args.sin_ffmpeg),
        check_b(doc, fuente, args.sin_ffmpeg),
        check_c(doc),
        check_d(args.build, fuente, args.sin_ffmpeg),
        check_e(args.build),
    ]

    fallos = 0
    for c in checks:
        icono = {True: "✓", False: "✗", None: "·"}[c.ok]
        print("  %s %s · %s" % (icono, c.clave, c.titulo))
        print("      %s" % c.medida)
        for d in c.detalle:
            print("    %s" % d)
        if c.ok is False:
            fallos += 1

    hechas = sum(1 for c in checks if c.ok is not None)
    print("\n%d de %d comprobaciones fallan (%d omitidas)"
          % (fallos, hechas, len(checks) - hechas))
    if fallos:
        print("\nEl reloj NO está sano. Ninguno de estos fallos da error en el\n"
              "pipeline: se ven aquí o se ven mirando el vídeo entero.")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
