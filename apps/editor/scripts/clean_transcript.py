#!/usr/bin/env python3
"""Limpieza del timeline: silencios muertos y tomas falsas.

Dos pasadas independientes sobre las palabras transcritas:

  1. SILENCIOS. Todo hueco entre palabras mayor que --silencio se rebana,
     dejando un colchón (--colchon) a cada lado para que el corte no
     muerda la respiración ni el ataque de la sílaba.

  2. TOMAS FALSAS. Cuando alguien se traba repite el mismo arranque de
     frase varias veces. Se detecta comparando n-gramas consecutivos con
     distancia de Levenshtein normalizada: si dos arranques separados por
     una pausa se parecen por encima de --similitud, se descartan todos
     menos EL ÚLTIMO, que es la toma buena.

Salida: build/timeline.json

    {
      "reloj": "origen",
      "keep":  [{"src_start", "src_end", "out_start", "out_end"}, ...],
      "words": [...en el reloj del vídeo ORIGINAL...],
      "blocks":[...agrupados para karaoke, mismo reloj...],
      "stats": {...}
    }

EL RELOJ, que es lo que más se ha equivocado en este repo
--------------------------------------------------------

`words` y `blocks` salen en el reloj del vídeo **ORIGINAL**, y `keep` es el
único registro de la traducción origen→salida. El reloj de salida NO se
almacena: se deriva con `reloj.Mapa(keep)` cuando alguien lo necesita.

Antes esta función devolvía `words` ya remapeados al vídeo de salida, y esa
es la causa raíz de un fallo que no daba error en ningún sitio:
`silencios.py` construye su mapa a partir de `keep.src_*` —reloj de origen—
y lo aplicaba a esas palabras, que ya estaban en el otro reloj. Medido sobre
una pieza real, por la vía documentada de CLAUDE.md:

  · la señal de huecos entre palabras devolvía 0 tramos en vez de 12, o sea
    que se apagaba entera;
  · se cortaban 0,33 s del ATAQUE de una palabra, justo lo que el módulo
    promete no hacer nunca;
  · los gráficos derivaban hasta 8,2 s, y cada vez más según avanzaba la
    pieza.

Guardar las dos representaciones del mismo hecho en el mismo fichero es cómo
nació todo eso. Ahora hay una, y `reloj.exige_reloj` aborta si algún paso
recibe la que no espera.

Lo que NO cambia: este script sigue recortando. Sus `stats` derivan de
`keep`, así que el umbral del 35 % con el que la skill decide si preguntar
sigue funcionando igual.

Uso:
    python3 scripts/clean_transcript.py
    python3 scripts/clean_transcript.py --silencio 0.35 --similitud 0.82
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

import comun

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige

VACIAS = {
    "el", "la", "los", "las", "un", "una", "de", "del", "al", "a", "en", "y",
    "o", "que", "qué", "con", "por", "para", "se", "su", "lo", "es", "son",
    "muy", "más", "mas", "pero", "si", "no", "ya", "the", "a", "of", "and",
    "to", "in", "is", "it", "for", "on",
}
MULETILLAS = {"eh", "em", "mmm", "este", "esto", "o sea", "bueno", "pues", "uh", "um"}


# --------------------------------------------------------------------------
#  distancia de Levenshtein normalizada
# --------------------------------------------------------------------------

def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previa = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        actual = [i]
        for j, cb in enumerate(b, 1):
            actual.append(min(
                previa[j] + 1,          # borrado
                actual[j - 1] + 1,      # inserción
                previa[j - 1] + (ca != cb),  # sustitución
            ))
        previa = actual
    return previa[-1]


def similitud(a: str, b: str) -> float:
    """1.0 = idénticas, 0.0 = nada que ver."""
    if not a and not b:
        return 1.0
    m = max(len(a), len(b))
    return 1.0 - (levenshtein(a, b) / m) if m else 1.0


def normaliza(txt: str) -> str:
    return re.sub(r"[^\wáéíóúüñ ]", "", txt.lower(), flags=re.UNICODE).strip()


# --------------------------------------------------------------------------
#  pasada 0: colas de silencio pegadas a una palabra
# --------------------------------------------------------------------------

def audio_es_de_esta_toma(ruta_audio, ruta_transcript, dur_transcript,
                          tolerancia=2.0) -> bool:
    """¿El audio y el transcript son de la MISMA grabación?

    Existe por un fallo que se coló al empezar a medir el audio: `--audio`
    tiene un valor por defecto (`build/aroll_codex.mp4`) y `--input` otro, así
    que llamar al script con un transcript distinto —una fixture de 44 s— le
    hacía medir el envolvente de OTRA pieza y recortar las colas contra un
    umbral que no era el suyo. No daba error: daba un timeline plausible y
    mal, que es la peor forma de fallar.

    Se comprueba por duración, que es lo único comparable sin volver a
    transcribir. Es la misma pregunta que hace `comprobar_montaje.py` sobre
    `build/`: ¿estas dos cosas son del mismo montaje?
    """
    # La resolución (entorno > PATH > Homebrew) vive en comun.py.
    ffprobe = comun.FFPROBE
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", ruta_audio],
            capture_output=True, text=True, check=True)
        dur_audio = float(r.stdout.strip())
    except (OSError, subprocess.CalledProcessError, ValueError):
        print("  aviso: no puedo medir %s; las colas se estiman por letras."
              % os.path.basename(ruta_audio))
        return False
    if abs(dur_audio - dur_transcript) <= tolerancia:
        return True
    print("  aviso: %s dura %.1f s y el transcript %s dura %.1f s. No son de "
          "la misma toma, así que NO se mide el audio y las colas se estiman "
          "por letras (peor). Pasa el audio correcto con --audio."
          % (os.path.basename(ruta_audio), dur_audio,
             os.path.basename(ruta_transcript), dur_transcript))
    return False


def envolvente(ruta_audio, salto=0.010):
    """RMS en dB por ventana de 10 ms de la pista de voz.

    Se extrae con ffmpeg a 16 kHz mono, que es de sobra para medir energía y
    cuesta una décima parte que leer el original."""
    import subprocess, tempfile, wave, struct, math, os as _os
    tmp = tempfile.mktemp(suffix=".wav")
    # La resolución (entorno > PATH > Homebrew) vive en comun.py.
    ff = comun.FFMPEG
    r = subprocess.run([ff, "-v", "error", "-y", "-i", ruta_audio,
                        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp],
                       capture_output=True)
    if r.returncode != 0 or not _os.path.exists(tmp):
        return None, 0
    w = wave.open(tmp); sr = w.getframerate(); n = w.getnframes()
    pcm = struct.unpack("<%dh" % n, w.readframes(n)); w.close()
    _os.unlink(tmp)
    H = int(sr * salto)
    env = []
    for i in range(0, max(0, n - H), H):
        m = sum(x * x for x in pcm[i:i + H]) / H
        env.append(20 * math.log10(math.sqrt(m) / 32768 + 1e-9))
    return env, salto


def umbral_de_habla(env):
    """Dónde acaba el habla y empieza el silencio, en dB, DERIVADO de la pieza.

    No puede ser una constante: una grabación tranquila y una a pleno pulmón
    tienen suelos distintos, y un umbral absoluto acierta en una y destroza la
    otra.

    El número sale de dos hechos medibles. Una fricativa sorda —la /s/ final de
    «PRs», «vulnerabilidades», «exploits»— lleva entre 15 y 25 dB MENOS energía
    que la vocal de la misma palabra, así que un umbral colocado cerca del nivel
    de habla se come exactamente los finales. Y por abajo está el suelo de
    ruido, que hay que dejar fuera.

    Medido en la pieza de Codex: habla mediana −26,8 dB, suelo −57,0 dB, así
    que la /s/ vive alrededor de −47. El umbral se pone 22 dB por debajo de la
    mediana y nunca a menos de 6 dB del suelo: −48,8 dB aquí, con margen por
    los dos lados."""
    if not env:
        return None
    o = sorted(env)
    p = lambda q: o[min(len(o) - 1, int(len(o) * q))]
    return max(p(0.50) - 22.0, p(0.02) + 6.0)


def fin_real(env, salto, t0, t1, umbral, cola=0.08):
    """El instante en que de verdad deja de haber habla dentro de [t0, t1].

    Se busca hacia atrás la última ventana por encima del umbral y se le suma
    una cola: el final de una fricativa decae, y cortar en la última ventana
    que pasa el umbral deja el sonido truncado en seco aunque técnicamente no
    se haya comido nada."""
    if not env:
        return None
    a, b = int(t0 / salto), min(int(t1 / salto), len(env) - 1)
    for i in range(b, a - 1, -1):
        if env[i] > umbral:
            return min(t1, (i + 1) * salto + cola)
    return None


def recortar_colas(palabras, umbral, env=None, salto=0.010, umbral_db=None,
                   seg_por_caracter=0.075):
    """Devuelve el final REAL del habla de cada palabra.

    Whisper a veces mete la pausa dentro de la palabra en vez de dejar un
    hueco: large-v3 transcribe «pero...» y le asigna 0.84 s cuando pronunciar
    'pero' lleva 0.2. Mirando solo los huecos entre palabras ese silencio es
    invisible y no se recorta nunca.

    --- POR QUÉ YA NO SE ESTIMA POR NÚMERO DE LETRAS ---

    Esto estimaba la duración «correcta» como `letras x 0,075 s` y truncaba lo
    que sobrara. Nunca miraba el audio, que es justo lo que la doctrina de este
    repo prohíbe para los silencios —«se mide en el AUDIO con `silencedetect`,
    no en los huecos entre palabras de Whisper»— y la regla valía igual aquí.

    Lo que hacía, medido sobre la pieza de Codex:

        palabra   tramo CORTADO   tramo CONSERVADO
        OpenAI      −18,2 dB          −40,5 dB
        PRs         −19,9 dB          −29,5 dB

    O sea que en tres de nueve casos cortaba audio MÁS FUERTE que el que
    dejaba: se comía la palabra y conservaba el silencio de delante. Se oía
    como un corte agresivo que se lleva los finales, las eses.

    El recuento de letras no puede funcionar: no sabe a qué velocidad habla
    nadie, y la cola de una fricativa no es proporcional a cuántas letras
    tenga la palabra.

    Ahora se busca en la ENVOLVENTE la última ventana con energía por encima
    del umbral de habla. Sin audio se cae a la estimación vieja, que es peor
    pero es lo único que queda."""
    ajustadas, recortes = [], 0
    for w in palabras:
        nuevo = dict(w)
        fin = None
        if env is not None and umbral_db is not None:
            fin = fin_real(env, salto, w["start"], w["end"], umbral_db)
        if fin is None:
            letras = len(re.sub(r"\W", "", w["w"], flags=re.UNICODE)) or 1
            estimada = max(0.12, letras * seg_por_caracter)
            if (w["end"] - w["start"]) > estimada + umbral:
                fin = w["start"] + estimada
        if fin is not None and fin < w["end"] - 0.02:
            nuevo["end"] = round(fin, 3)
            nuevo["cola_recortada"] = round(w["end"] - fin, 3)
            recortes += 1
        ajustadas.append(nuevo)
    return ajustadas, recortes


# --------------------------------------------------------------------------
#  pasada 1: silencios
# --------------------------------------------------------------------------

def tramos_utiles(palabras, umbral, colchon, dur_total):
    """Devuelve los tramos [inicio, fin] del original que hay que conservar.

    Todo tramo cumple `fin > inicio` y cabe en `[0, dur_total]`. No es un
    detalle: `min(fin, dur_total)` sin acotar TAMBIÉN el inicio producía un
    tramo INVERTIDO en cuanto una palabra empezaba pasada la duración
    declarada, y de ahí salía una cascada silenciosa —`remapear` descarta sin
    avisar toda palabra que no caiga en ningún tramo, así que la palabra
    desaparecía, `duration_final` salía NEGATIVA y `reduccion_pct` pasaba de
    100—. Nada de eso daba error.

    El disparador es real y el margen es estrecho: en el `transcript.json` de
    la pieza de Codex, `duration` es 49,84 y la última palabra acaba en 49,70.
    Una sola alucinación de cola de `large-v3` —«gracias por ver el vídeo»—
    pasada de la duración lo activa.
    """
    if not palabras:
        return []

    tope = float(dur_total) if dur_total else None

    tramos = []
    ini = max(0.0, palabras[0]["start"] - colchon)
    for prev, sig in zip(palabras, palabras[1:]):
        hueco = sig["start"] - prev["end"]
        if hueco > umbral:
            tramos.append([ini, prev["end"] + colchon])
            ini = max(0.0, sig["start"] - colchon)
    tramos.append([ini, palabras[-1]["end"] + colchon])

    # Acotar por los DOS lados y descartar lo que quede vacío o invertido.
    acotados = []
    for a, b in tramos:
        a = max(0.0, a)
        if tope is not None:
            a, b = min(a, tope), min(b, tope)
        if b - a > 1e-9:
            acotados.append([a, b])
    if not acotados:
        return []
    tramos = acotados

    # fusionar los que se toquen tras aplicar el colchón
    fusionados = [tramos[0]]
    for t in tramos[1:]:
        if t[0] <= fusionados[-1][1] + 0.01:
            fusionados[-1][1] = max(fusionados[-1][1], t[1])
        else:
            fusionados.append(t)
    return fusionados


# --------------------------------------------------------------------------
#  pasada 2: tomas falsas
# --------------------------------------------------------------------------

def agrupar_por_pausa(palabras, umbral):
    """Trocea en 'intentos': secuencias de habla separadas por pausas."""
    grupos, actual = [], []
    for i, w in enumerate(palabras):
        if actual and (w["start"] - actual[-1]["end"]) > umbral:
            grupos.append(actual)
            actual = []
        actual.append(w)
    if actual:
        grupos.append(actual)
    return grupos


def firma(grupo, n):
    """N-grama de arranque: las primeras n palabras significativas."""
    utiles = [normaliza(w["w"]) for w in grupo]
    utiles = [u for u in utiles if u and u not in MULETILLAS]
    return " ".join(utiles[:n])


def detectar_tomas_falsas(grupos, n, umbral_sim, ventana):
    """Marca los índices de grupo que son tomas descartables.

    Se compara cada grupo con los siguientes dentro de una ventana. Si el
    arranque coincide, el ANTERIOR es la toma fallida: se descarta y se
    conserva la última, que es con la que el locutor se quedó.
    """
    descartar = set()
    firmas = [firma(g, n) for g in grupos]
    for i in range(len(grupos)):
        if i in descartar or not firmas[i]:
            continue
        for j in range(i + 1, min(i + 1 + ventana, len(grupos))):
            if not firmas[j]:
                continue
            if similitud(firmas[i], firmas[j]) >= umbral_sim:
                # i quedó a medias, j es el reintento -> fuera i
                descartar.add(i)
                break
    return descartar


# --------------------------------------------------------------------------
#  remapeo de tiempos original -> salida
# --------------------------------------------------------------------------

def remapear(palabras, tramos):
    """Traduce cada palabra al reloj del vídeo ya cortado."""
    fuera = []
    desplaz, cursor = [], 0.0
    for a, b in tramos:
        desplaz.append((a, b, cursor))
        cursor += (b - a)

    for w in palabras:
        for a, b, base in desplaz:
            if a <= w["start"] <= b:
                fuera.append({
                    "w": w["w"],
                    "start": round(base + (w["start"] - a), 3),
                    "end": round(base + (min(w["end"], b) - a), 3),
                    "p": w.get("p", 1.0),
                })
                break
    return fuera, cursor


# --------------------------------------------------------------------------
#  bloques de karaoke
# --------------------------------------------------------------------------

def bloques_karaoke(palabras, max_palabras, max_dur, pausa):
    bloques, actual = [], []

    def cerrar():
        if not actual:
            return
        bloques.append({
            "ini": actual[0]["start"],
            "fin": actual[-1]["end"],
            "palabras": [{"w": w["w"].upper(), "ini": w["start"], "fin": w["end"]}
                         for w in actual],
        })
        actual.clear()

    for w in palabras:
        if actual:
            hueco = w["start"] - actual[-1]["end"]
            largo = w["end"] - actual[0]["start"]
            if len(actual) >= max_palabras or hueco > pausa or largo > max_dur:
                cerrar()
        actual.append(w)
        if re.search(r"[.!?…]$", w["w"]):
            cerrar()
    cerrar()
    return bloques


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=os.path.join(BUILD, "transcript.json"))
    ap.add_argument("--output", default=os.path.join(BUILD, "timeline.json"))
    ap.add_argument("--silencio", type=float, default=0.35,
                    help="hueco (s) a partir del cual se corta")
    ap.add_argument("--colchon", type=float, default=0.08,
                    help="margen (s) que se deja a cada lado del corte")
    ap.add_argument("--similitud", type=float, default=0.82,
                    help="umbral 0-1 para considerar dos arranques iguales")
    ap.add_argument("--ngrama", type=int, default=4,
                    help="palabras del arranque que forman la firma")
    ap.add_argument("--ventana", type=int, default=3,
                    help="cuántos intentos siguientes se comparan")
    ap.add_argument("--sin-tomas-falsas", action="store_true",
                    help="solo recortar silencios")
    ap.add_argument("--sin-recortar-colas", action="store_true",
                    help="no recortar el silencio pegado al final de una palabra")
    ap.add_argument("--max-palabras", type=int, default=4)
    ap.add_argument("--audio", default=os.path.join(BUILD, "aroll_codex.mp4"),
                    help="pista de la que se mide la envolvente para saber "
                         "dónde acaba el habla de verdad")
    args = ap.parse_args()

    if not os.path.exists(args.input):
        print("falta %s — ejecuta antes transcribe_mlx.py" % args.input,
              file=sys.stderr)
        return 2

    with open(args.input, encoding="utf-8") as f:
        tr = json.load(f)
    palabras = tr["words"]
    if not palabras:
        print("la transcripción no tiene palabras", file=sys.stderr)
        return 2

    dur_original = tr.get("duration") or (palabras[-1]["end"] + 0.5)

    # --- pasada 2 primero: quitar las tomas falsas del conjunto ---
    descartadas, n_falsas = set(), 0
    if not args.sin_tomas_falsas:
        grupos = agrupar_por_pausa(palabras, args.silencio)
        idx_fuera = detectar_tomas_falsas(grupos, args.ngrama, args.similitud,
                                          args.ventana)
        n_falsas = len(idx_fuera)
        for gi in idx_fuera:
            for w in grupos[gi]:
                descartadas.add(id(w))
    vivas = [w for w in palabras if id(w) not in descartadas]

    # --- pasada 0: colas muertas dentro de una misma palabra ---
    colas = 0
    if not args.sin_recortar_colas:
        env, salto = (None, 0.010)
        if os.path.exists(args.audio) and audio_es_de_esta_toma(
                args.audio, args.input, dur_original):
            env, salto = envolvente(args.audio)
        u_db = umbral_de_habla(env)
        vivas, colas = recortar_colas(vivas, args.silencio, env, salto, u_db)

    # --- pasada 1: rebanar silencios sobre lo que queda ---
    tramos = tramos_utiles(vivas, args.silencio, args.colchon, dur_original)
    if not tramos:
        # Pasa cuando TODAS las palabras caen fuera de la duración declarada,
        # que es lo que produce una alucinación de cola de Whisper sobre un
        # audio corto. Antes salía un timeline con `keep` vacío y
        # `duration_final: 0`, y ninguna etapa posterior lo cuestionaba.
        print("ninguna palabra cae dentro de los %.2f s que declara el "
              "transcript.\n"
              "  Las palabras van de %.2f a %.2f: o la duración está mal o "
              "Whisper ha alucinado una cola.\n"
              "  Comprueba build/transcript.json y vuelve a transcribir:\n"
              "    .venv/bin/python scripts/transcribe_mlx.py --input <video>"
              % (dur_original, vivas[0]["start"], vivas[-1]["end"]),
              file=sys.stderr)
        return 2

    # `remapear` se sigue usando, pero SOLO para saber cuánto dura la pieza
    # resultante y qué palabras sobreviven al recorte. Su salida ya NO es lo
    # que se guarda: `words` va en reloj de origen. Ver la cabecera.
    supervivientes, dur_final = remapear(vivas, tramos)
    dentro = {id(w) for w in vivas
              if any(a <= w["start"] <= b for a, b in tramos)}
    en_origen = [w for w in vivas if id(w) in dentro]

    # Los bloques se agrupan sobre las palabras EN ORIGEN, así que sus huecos
    # son los de verdad. Antes se agrupaban sobre las remapeadas, donde los
    # cortes ya habían cerrado las pausas: `pausa=args.silencio` no partía
    # nunca por pausa y el criterio quedaba reducido al tope de palabras.
    bloques = bloques_karaoke(en_origen, args.max_palabras, 1.8, args.silencio)

    salida = {
        # El reloj se declara para que ningún paso posterior tenga que
        # adivinarlo. `reloj.exige_reloj` lo comprueba y aborta nombrando el
        # comando que lo arregla.
        "reloj": "origen",
        "source": tr["source"],
        "language": tr.get("language"),
        "duration_original": round(dur_original, 3),
        "duration_final": round(dur_final, 3),
        "keep": [],
        "words": en_origen,
        "blocks": bloques,
        "stats": {
            "palabras_original": len(palabras),
            "palabras_final": len(supervivientes),
            "tomas_falsas_descartadas": n_falsas,
            "colas_de_silencio_recortadas": colas,
            "cortes": max(0, len(tramos) - 1),
            "segundos_recortados": round(dur_original - dur_final, 2),
            "reduccion_pct": round(
                100 * (dur_original - dur_final) / dur_original, 1)
            if dur_original else 0.0,
        },
    }
    cursor = 0.0
    for a, b in tramos:
        salida["keep"].append({
            "src_start": round(a, 3), "src_end": round(b, 3),
            "out_start": round(cursor, 3), "out_end": round(cursor + (b - a), 3),
        })
        cursor += (b - a)

    os.makedirs(BUILD, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    s = salida["stats"]
    print(json.dumps({"salida": args.output, **s}, ensure_ascii=False, indent=2))
    print("\n%d tramos conservados · %s -> %s"
          % (len(tramos), round(dur_original, 1), round(dur_final, 1)),
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
