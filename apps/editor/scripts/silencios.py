#!/usr/bin/env python3
"""Quita los silencios de una pieza YA planificada y remapea todo el reloj.

Esto no es un detector de silencios: eso lo hace ffmpeg en una línea. Lo
que aporta es lo otro, que es donde está el fallo caro.

    Al quitar un silencio, TODO lo que venga después se adelanta. Si se
    remapean los subtítulos pero no los gráficos, cada tarjeta aparece
    tarde, y cada vez más tarde según avanza la pieza. Ya pasó en este
    repo: un vídeo de 59 s con la narración de 74 s por encima.

Por eso el módulo toma el plan y el timeline JUNTOS y los reescribe con el
mismo mapa. Lo que no se remapee aquí, se descuadra.

Tres decisiones que no son obvias:

  · **El silencio se mide en el AUDIO**, con `silencedetect`, no en los
    huecos entre palabras de Whisper. Whisper alarga la última palabra de
    cada frase hasta el siguiente ataque, así que por sus tiempos casi no
    hay huecos: se pierde justo el silencio que se quería quitar.

  · **Nunca se corta dentro de una palabra.** La transcripción manda sobre
    el detector: si `silencedetect` marca silencio donde Whisper dice que
    hay habla, gana Whisper. Un corte a media sílaba se oye siempre.

  · **No se quita TODO el silencio.** Se deja `--minima` de pausa. Pegar
    las frases sin aire da ese montaje ametrallado que delata la
    automatización, y además se come las pausas que llevan intención.

VA ENTRE EL DIRECTOR Y EL RENDERIZADOR. No después.

    dirigir.py -> silencios.py --aplicar -> render_playwright.js -> ...

Remapear el plan DESPUÉS de renderizar no basta, y falla de una manera que
no se ve en el log. Una tarjeta aguanta el remapeo porque su contenido no
cambia mientras dura; los subtítulos cinéticos, no: sus fotogramas llevan
grabado qué palabra toca en cada instante del reloj VIEJO. Comprobado
mirando el vídeo — con el reloj comprimido un 6 %, en el segundo 30 se leía
«ESPACIO LATENTE» mientras se oía «desde la primera capa».

Uso:
    python3 scripts/silencios.py --timeline build/timeline.json --plan build/plan.json
    python3 scripts/silencios.py --aplicar --umbral -30 --minima 0.14
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

import reloj
import comun                                 # noqa: E402
from comun import carga_json, exige_ffmpeg, exige_ok

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
FFMPEG = comun.FFMPEG



# --------------------------------------------------------------------------
#  detección
# --------------------------------------------------------------------------
def silencios_audio(fuente: str, umbral_db: float, minimo: float) -> list:
    """Tramos [ini, fin] por debajo de `umbral_db` durante al menos `minimo`."""
    # El returncode SE MIRA. Medido sin mirarlo: sobre una ruta inexistente
    # esto devolvía [] sin excepción ni aviso — la señal de silencios del
    # AUDIO se apagaba entera, el paso sellaba el timeline y devolvía 0. En
    # la etapa que este mismo fichero llama «la de mayor riesgo del pipeline,
    # porque su fallo es invisible por definición», un ffmpeg que falla tiene
    # que parar, no callarse.
    r = exige_ok(
        subprocess.run(
            [FFMPEG, "-nostdin", "-v", "info", "-i", fuente,
             "-af", "silencedetect=noise=%.1fdB:d=%.3f" % (umbral_db, minimo),
             "-f", "null", "-"],
            capture_output=True, text=True),
        "ffmpeg silencedetect sobre %s" % fuente,
        arregla="comprueba la ruta del audio y FFMPEG_BIN")
    tramos, ini = [], None
    for m in re.finditer(r"silence_(start|end):\s*(-?[\d.]+)", r.stderr):
        if m.group(1) == "start":
            ini = float(m.group(2))
        elif ini is not None:
            tramos.append([ini, float(m.group(2))])
            ini = None
    return tramos


def huecos_transcripcion(palabras: list, minimo: float) -> list:
    """Huecos entre palabras transcritas. Es la OTRA señal, y hace falta.

    `silencedetect` mide PICO, así que un chasquido de boca o el ruido de
    parar la cámara mantienen el tramo por encima del umbral y no lo marca
    como silencio — aunque su nivel medio esté 25 dB por debajo del habla y
    perceptualmente sea aire muerto. Pasó en el corte de un clip: pico de
    -8 dB por un transitorio, media de -47 dB, y un segundo entero de nadie
    hablando que el detector de audio dejaba pasar.

    Que no haya PALABRA es un dato independiente del nivel, y para decidir
    si sobra metraje es el que manda."""
    out = []
    for a, b in zip(palabras, palabras[1:]):
        hueco = float(b["start"]) - float(a["end"])
        if hueco >= minimo:
            out.append([float(a["end"]), float(b["start"])])
    return out


def protege_habla(tramos: list, palabras: list, margen: float = 0.10) -> list:
    """Recorta los silencios que pisen una palabra transcrita.

    `silencedetect` mide energía, y una consonante sorda —una /s/, una /f/—
    puede caer por debajo del umbral sin ser silencio. La transcripción
    sabe que ahí hay habla."""
    if not palabras:
        return tramos
    out = []
    for a, b in tramos:
        trozos = [[a, b]]
        for w in palabras:
            # El INICIO de palabra de Whisper es fiable; el final no: alarga
            # la última palabra de cada frase hasta el siguiente ataque. Si se
            # protege hasta ese final, se protege el silencio entero y el
            # módulo no recorta nada — es lo que pasaba: 17 silencios
            # detectados, 5 supervivientes, 1,7 % de recorte.
            #
            # Aquí se estimaba la duración por LONGITUD —`0.075 x letras`—
            # copiando lo que hacía `clean_transcript.recortar_colas`. Las dos
            # estaban mal por lo mismo: el recuento de letras no sabe a qué
            # velocidad habla nadie, y la cola de una fricativa no es
            # proporcional a cuántas letras tenga la palabra. Medido sobre la
            # pieza de Codex, esa estimación dejaba FUERA de la protección
            # tramos a −18 dB, o sea habla clara: se oía como un corte que se
            # lleva los finales y las eses.
            #
            # Desde que `clean_transcript` mide el final real en la ENVOLVENTE
            # del audio, `w["end"]` de `timeline.json` YA es el final medido y
            # no el de Whisper. Recortarlo otra vez con una estimación peor era
            # deshacer la medición: se protege hasta el final que trae, y
            # punto. Quien pase palabras sin medir se protege de más, que es el
            # lado seguro del error.
            ini = float(w["start"])
            ws, we = ini - margen, float(w["end"]) + margen
            nuevos = []
            for x, y in trozos:
                if we <= x or ws >= y:        # no se tocan
                    nuevos.append([x, y])
                    continue
                if ws > x:
                    nuevos.append([x, ws])
                if we < y:
                    nuevos.append([we, y])
            trozos = nuevos
        out += trozos
    return [t for t in out if t[1] - t[0] > 0]


def fusionar_astillas(piezas: list, minima_toma: float) -> tuple[list, int]:
    """Absorbe las astillas de plano en el tramo con el que son continuas.

    Los tramos de cámara del director y los cortes de silencio son dos
    rejillas independientes, y al cruzarse dejan astillas: un cambio de zoom
    a 0,2 s de un corte produce cinco fotogramas con OTRO encuadre entre dos
    saltos. En la pieza de Codex salió una de 0,10 s —dos fotogramas y
    medio— y se lee como un parpadeo, no como un plano.

    No se descarta metraje: la astilla se pega al vecino con el que es
    continua en el original y adopta SU zoom. El sonido no se entera y el
    cambio de encuadre pasa a coincidir con el corte, que es lo que §11 pide
    de entrada («saltos de corte por tramo, no rampas»).

    Una astilla aislada por silencio a los dos lados se deja como está: ahí
    no hay parpadeo posible porque no está pegada a nada.
    """
    if not piezas:
        return piezas, 0

    fusiones = 0
    cambiado = True
    while cambiado:
        cambiado = False
        for i, p in enumerate(piezas):
            if p[1] - p[0] >= minima_toma:
                continue
            prev = piezas[i - 1] if i > 0 else None
            sig = piezas[i + 1] if i + 1 < len(piezas) else None
            pega_prev = prev is not None and abs(p[0] - prev[1]) < 1e-6
            pega_sig = sig is not None and abs(sig[0] - p[1]) < 1e-6
            # Si toca por los dos lados se elige el vecino más largo: es el
            # que manda visualmente y el que la astilla debe imitar.
            if pega_prev and pega_sig:
                pega_sig = (sig[1] - sig[0]) > (prev[1] - prev[0])
                pega_prev = not pega_sig
            if pega_prev and prev[2] != p[2]:
                piezas[i - 1] = [prev[0], p[1], prev[2]]
                piezas.pop(i)
                fusiones += 1
                cambiado = True
                break
            if pega_sig and sig[2] != p[2]:
                piezas[i + 1] = [p[0], sig[1], sig[2]]
                piezas.pop(i)
                fusiones += 1
                cambiado = True
                break
            # Mismo zoom que el vecino: no hay parpadeo, pero dos tramos
            # contiguos con el mismo encuadre son un tramo. Se unen para no
            # dejar cortes que no cortan nada.
            if pega_prev:
                piezas[i - 1] = [prev[0], p[1], prev[2]]
                piezas.pop(i)
                cambiado = True
                break
            if pega_sig:
                piezas[i + 1] = [p[0], sig[1], sig[2]]
                piezas.pop(i)
                cambiado = True
                break
    return piezas, fusiones


def recortar(keep: list, silencios: list, minima: float,
             colchon: float, minima_toma: float = 0.45) -> tuple[list, int]:
    """Parte los `keep` para saltarse los silencios, dejando `minima` de aire.

    Se conserva el `zoom` del tramo del que sale cada trozo: es una
    decisión de cámara del director y perderla al cortar rompería el
    montaje de planos."""
    cortes = []
    for a, b in silencios:
        a2, b2 = a + colchon, b - colchon
        if b2 - a2 <= minima:
            continue
        # El aire que se deja va al PRINCIPIO del silencio: la pausa
        # después de una frase es la que se oye natural; el aire antes del
        # siguiente ataque se percibe como retraso.
        cortes.append([a2 + minima, b2])

    piezas = []
    for k in keep:
        s0, s1 = float(k["src_start"]), float(k["src_end"])
        trozos = [[s0, s1]]
        for ca, cb in cortes:
            res = []
            for x, y in trozos:
                if cb <= x or ca >= y:
                    res.append([x, y])
                    continue
                if ca > x:
                    res.append([x, ca])
                if cb < y:
                    res.append([cb, y])
            trozos = res
        for x, y in trozos:
            if y - x < 0.08:      # trocito inservible: un fotograma suelto
                continue
            piezas.append([x, y, k.get("zoom", 1.0)])

    piezas.sort()
    piezas, fusiones = fusionar_astillas(piezas, minima_toma)

    nuevos, salida = [], 0.0
    for x, y, z in piezas:
        nuevos.append({"src_start": round(x, 3), "src_end": round(y, 3),
                       "out_start": round(salida, 3),
                       "out_end": round(salida + (y - x), 3),
                       "zoom": z})
        salida += y - x
    return nuevos, fusiones


# --------------------------------------------------------------------------
#  aplicación
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(comun.build_dir(), "timeline.json"))
    ap.add_argument("--plan", default=os.path.join(comun.build_dir(), "plan.json"))
    ap.add_argument("--fuente", default=None,
                    help="por defecto, el `source` del timeline")
    ap.add_argument("--umbral", type=float, default=-34.0,
                    help="dBFS por debajo de los cuales se considera silencio")
    ap.add_argument("--minimo", type=float, default=0.30,
                    help="duración mínima para que un silencio cuente")
    ap.add_argument("--minima", type=float, default=0.14,
                    help="pausa que SE CONSERVA de cada silencio")
    ap.add_argument("--colchon", type=float, default=0.05,
                    help="aire que se respeta a cada lado del habla")
    ap.add_argument("--minima-toma", type=float, default=0.45,
                    help="por debajo de esto un tramo no es un plano: se "
                         "absorbe en el vecino continuo y adopta su zoom")
    ap.add_argument("--aplicar", action="store_true",
                    help="reescribe el timeline y el plan")
    ap.add_argument("--silencios", default=None,
                    help="JSON con la lista [[ini,fin],...] en vez de medirla "
                         "con silencedetect; para pruebas reproducibles")
    ap.add_argument("--volcar-silencios", default=None,
                    help="escribe en ese fichero la lista medida y termina")
    args = ap.parse_args()

    tl = carga_json(args.timeline)

    # El timeline tiene que llegar en reloj de ORIGEN: el mapa se construye de
    # `keep.src_*`, que está en ese reloj, así que aplicarlo a unos tiempos ya
    # remapeados los desplaza otra vez. Antes no había ninguna guarda y el
    # desfase no daba error en ningún sitio.
    reloj.exige_reloj(tl, "origen", "silencios.py",
                      ".venv/bin/python scripts/clean_transcript.py")

    # El PLAN sí queda en reloj de salida tras aplicar, así que una segunda
    # pasada lo volvería a mover. Se conserva su versión en origen y siempre
    # se re-deriva de ahí: eso hace que iterar sobre --minima o --umbral sea
    # seguro, que es la única razón por la que se vuelve a ejecutar este paso.
    copia_origen = os.path.splitext(args.plan)[0] + ".origen.json"
    if os.path.exists(copia_origen):
        plan = carga_json(copia_origen)
        reaplicado = True

        # La idempotencia tiene un filo: si alguien REESCRIBE el plan —añade
        # una capa, cambia un ancla— y vuelve a ejecutar esto, se re-deriva de
        # la instantánea VIEJA y el trabajo nuevo desaparece sin una palabra.
        # Me pasó añadiendo tres transiciones: se escribieron, se aplicó este
        # paso, y el plan salió con las ocho capas de antes. No hubo error, no
        # hubo aviso; simplemente no estaban.
        #
        # No se puede arreglar re-instantaneando sin más —eso rompería la
        # idempotencia, que es lo que hace seguro iterar sobre `--minima`—, así
        # que se COMPARA y, si no cuadra, se PARA. Dos lecciones medidas:
        #
        #   · Comparar solo NOMBRES de capa era poco: un plan con las mismas
        #     capas pero otra plantilla, otro ancla u otra config pasaba
        #     limpio y el trabajo nuevo se perdía igual. Se comparan pares
        #     (capa, template), que es lo más hondo que se puede comparar:
        #     `t`, `duracion` y `config` cambian legítimamente con el remapeo
        #     y darían falso positivo en cada re-pasada.
        #
        #   · Avisar por stderr y seguir aplicando con exit 0 no paraba a
        #     nadie: quien encadena pasos no lee el aviso, y así convivieron
        #     un plan.origen.json y copias de conflicto de montajes DISTINTOS
        #     sin que nada lo cazara. Desde que `escaleta.escribir()` retira
        #     la instantánea al escribir un plan nuevo, llegar aquí con
        #     desajuste significa manipulación manual: parar es lo honesto.
        actual = carga_json(args.plan)

        def firma(capas):
            return {(c.get("capa"), c.get("template")) for c in capas}

        nuevas = firma(actual) - firma(plan)
        idas = firma(plan) - firma(actual)
        if nuevas or idas:
            def lista(pares):
                return ", ".join(sorted("%s (%s)" % p for p in pares))
            motivo = []
            if nuevas:
                motivo.append("estas capas se PERDERÍAN: %s" % lista(nuevas))
            if idas:
                motivo.append("reaparecerían capas ya quitadas: %s"
                              % lista(idas))
            print(
                "%s no coincide con la instantánea de origen %s.\n"
                "  Se re-derivaría de la instantánea, así que %s.\n"
                "  Lo arregla: regenera el plan (leer_guion.py / "
                "plan_codex.py) o borra %s"
                % (args.plan, os.path.basename(copia_origen),
                   "; ".join(motivo), copia_origen),
                file=sys.stderr)
            raise SystemExit(2)
    else:
        plan = carga_json(args.plan)
        reaplicado = False

    # La lista de silencios se puede INYECTAR. Es lo que permite congelar
    # esta etapa —la de mayor riesgo del pipeline, porque su fallo es
    # invisible por definición— en una prueba automática sin depender de
    # ffmpeg ni de tener el metraje a mano. `--volcar-silencios` produce el
    # fichero desde el material real una vez.
    if args.silencios:
        # Con la lista inyectada NO se toca ffmpeg, así que tampoco se exige.
        # Exigirlo aquí anulaba el sentido de `--silencios`, que existe
        # precisamente para poder congelar esta etapa —la de mayor riesgo del
        # pipeline— en una prueba sin binarios ni metraje. Lo tenía puesto
        # incondicionalmente y lo descubrí al montar la prueba.
        brutos = [[float(a), float(b)]
                  for a, b in carga_json(
                      args.silencios, "scripts/silencios.py --volcar-silencios <json>")]
        fuente = args.fuente or tl.get("source") or "(inyectada)"
    else:
        exige_ffmpeg("ffmpeg")
        fuente = args.fuente or tl.get("source")
        if not fuente or not os.path.exists(fuente):
            print("no encuentro la fuente: %s\n"
                  "Pásala con --fuente, o inyecta los silencios medidos con "
                  "--silencios <json>." % fuente, file=sys.stderr)
            return 2
        brutos = silencios_audio(fuente, args.umbral, args.minimo)

    if args.volcar_silencios:
        json.dump(brutos, open(args.volcar_silencios, "w", encoding="utf-8"))
        print(json.dumps({"escrito": args.volcar_silencios,
                          "silencios": len(brutos)}, indent=2))
        return 0

    huecos = huecos_transcripcion(tl.get("words") or [], args.minimo)
    # Unión de las dos señales: nivel bajo O ausencia de palabra. Cualquiera
    # de las dos por separado deja pasar aire muerto.
    sil = protege_habla(brutos + huecos, tl.get("words") or [], args.colchon)
    keep, fusiones = recortar(tl.get("keep") or [], sil, args.minima,
                              args.colchon, args.minima_toma)
    mapa = reloj.Mapa(keep)

    # Sin metraje no hay pieza, y escribirlo así dejaba `duration_final: 0` y
    # una capa de fondo de duración cero, cosas que ninguna etapa posterior
    # cuestiona. Suele significar que los umbrales se han comido el material.
    if not mapa.hay_metraje():
        print("el recorte no deja metraje: %d tramos, %.3f s.\n"
              "  Los umbrales se han comido la pieza. Sube --minimo (hoy %.2f) "
              "o baja --umbral (hoy %.1f dB)."
              % (len(keep), mapa.duracion(), args.minimo, args.umbral),
              file=sys.stderr)
        return 2

    antes = sum(float(k["src_end"]) - float(k["src_start"])
                for k in (tl.get("keep") or []))
    despues = mapa.duracion()

    informe = {
        "silencios_detectados": len(brutos),
        "huecos_sin_palabra": len(huecos),
        "silencios_tras_proteger_habla": len(sil),
        "segundos_de_silencio": round(sum(b - a for a, b in sil), 2),
        "tramos": {"antes": len(tl.get("keep") or []), "despues": len(keep),
                   "astillas_fusionadas": fusiones,
                   "mas_corto_s": round(min((k["src_end"] - k["src_start"]
                                             for k in keep), default=0.0), 3)},
        "duracion": {"antes": round(antes, 2), "despues": round(despues, 2),
                     "recorte_pct": round(100 * (1 - despues / max(antes, 1e-9)), 1)},
    }

    if args.aplicar:
        # La copia en origen se guarda ANTES de tocar nada, y solo la primera
        # vez. Si ya existe, `plan` viene de ella y volver a escribirla sería
        # guardar la versión ya remapeada.
        if not reaplicado:
            json.dump(plan, open(copia_origen, "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)

        tl["keep"] = keep
        tl["duration_final"] = round(despues, 3)
        # `words` y `blocks` NO se tocan: se quedan en reloj de origen, que es
        # lo que compra la idempotencia. `keep` ya lleva la traducción y
        # quien necesite el reloj de salida lo deriva con `reloj.Mapa`.
        # Remapearlos aquí era el fallo: se les aplicaba un mapa
        # origen->salida a unos tiempos que clean_transcript ya había pasado
        # a salida, y cada pasada los desplazaba otra vez.

        for c in plan:
            # `t0` se lee ANTES de escribir `c["t"]`. Los tiempos de dentro
            # de la config son RELATIVOS a este valor, así que tomarlo
            # después —ya remapeado— los descuadra por la diferencia entre
            # los dos relojes.
            t0 = float(c.get("t", 0))
            t1 = t0 + float(c.get("duracion", 0))
            n0, n1 = mapa(t0), mapa(t1)
            c["t"] = round(n0, 3)
            # La duración se recalcula del mapa, no se conserva: si dentro
            # del gráfico había un silencio, el gráfico también se acorta.
            # Mantener la duración original lo dejaría vivo por encima de
            # lo que ya es otra frase.
            c["duracion"] = round(max(0.4, n1 - n0), 3)
            if isinstance(c.get("config"), dict):
                c["config"]["duration"] = c["duracion"]
                reloj.remapea(c["config"], mapa, t0)
            # `fondo` solo se estira a la pieza entera si YA lo era: la regla
            # nació para fondos de pieza completa, y aplicada a ciegas rompió
            # el lienzo de ACTO de la vía del guion — un Dark Canvas de 13,2 s
            # (el acto full-motion) salía estirado a 45,3 s y tapaba el rostro
            # de los actos 3 y 4. Un fondo que empieza con la pieza y la cubre
            # casi entera es global; el resto se remapea como cualquier capa.
            if c["capa"].startswith("fondo") or c.get("template") == "fondo.html":
                if t0 <= 0.05 and t1 >= antes * 0.9:
                    c["duracion"] = round(despues, 3)
                    c["config"]["duration"] = round(despues, 3)
            # El contenido TECLEADO exige tiempo de pantalla REAL: la plantilla
            # teclea a cps en el reloj de salida, así que si el remapeo comió
            # silencio DENTRO de la ventana, la capa comprimida ya no da para
            # escribir y leer su contenido. Medido: leer_guion dimensionó
            # 7,36 s en origen, el remapeo dejó 6,34 y el contenido pedía
            # 6,73 — validar_plan (con razón) paraba la cadena. Se re-alarga
            # al mínimo del compás único (reloj.tecleo_minimo), acotado al
            # final de la pieza.
            if isinstance(c.get("config"), dict):
                minimo = reloj.tecleo_minimo(c["config"])
                if minimo and c["duracion"] < minimo:
                    nuevo = round(min(minimo, despues - c["t"]), 3)
                    if nuevo > c["duracion"]:
                        print("  «%s»: el remapeo la dejó en %.2f s y su "
                              "contenido tecleado pide %.2f s: se re-alarga "
                              "a %.2f s" % (c["capa"], c["duracion"],
                                            minimo, nuevo), file=sys.stderr)
                        c["duracion"] = nuevo
                        c["config"]["duration"] = nuevo

        # El timeline sigue declarando «origen»: es lo único que cambia de
        # `keep`, y `words`/`blocks` no se han movido. Esa es la invariante.
        json.dump(tl, open(args.timeline, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        json.dump(plan, open(args.plan, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        # El plan de B-Roll también lleva tiempos absolutos y también hay
        # que pasarlo. Es la única ruta del fallo de reloj que llegaba al
        # COMPOSITOR y no solo a los píxeles de los subtítulos: `escenas[].t`
        # se usa tal cual para colocar el overlay.
        ruta_broll = os.path.join(os.path.dirname(args.timeline),
                                  "broll_plan.json")
        if os.path.exists(ruta_broll):
            bp = carga_json(ruta_broll)
            if bp.get("escenas") and bp.get("reloj") == "origen":
                for e in bp["escenas"]:
                    t0 = float(e["t"])
                    e["t"] = round(mapa(t0), 3)
                    if "dur" in e:
                        e["dur"] = round(max(0.4, mapa(t0 + float(e["dur"]))
                                             - mapa(t0)), 3)
                reloj.sella(bp, "salida")
                json.dump(bp, open(ruta_broll, "w", encoding="utf-8"),
                          ensure_ascii=False, indent=1)
                informe["broll_remapeado"] = len(bp["escenas"])

        informe["escrito"] = [args.timeline, args.plan, copia_origen]
        # Los fotogramas que ya existan quedan inservibles: llevan grabado
        # el reloj viejo. Se avisa aquí porque el error resultante —
        # subtítulos retrasados— no da ningún fallo y es fácil no verlo
        # hasta que alguien mira el vídeo entero.
        man = os.path.join(comun.build_dir(), "layers.json")
        if os.path.exists(man):
            informe["ATENCION"] = (
                "hay fotogramas renderizados con el reloj anterior: "
                "borra build/frames y vuelve a renderizar, o los "
                "subtítulos irán retrasados")

    print(json.dumps(informe, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
