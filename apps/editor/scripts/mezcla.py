#!/usr/bin/env python3
"""El grafo de audio, como funciones puras.

Por qué existe este módulo, que es la parte que importa:

El mezclador eran sesenta líneas empotradas en el `main()` de
`composite_ffmpeg.py`. No se podía llamar, así que no se podía probar; no se
podía probar, así que **no había ni una sola prueba del mezclador**; y como no
se podía medir sin renderizar un vídeo entero, toda la calibración documentada
—los +3,2 dB de los impactos, los −60,5 dB del lecho, los tics— vive solo en la
bitácora del ROADMAP, sin nada que la sostenga.

Aquí entran diccionarios y listas y sale una cadena de filtergraph. Ni ffmpeg,
ni disco, ni `subprocess`. Eso permite dos cosas que antes eran imposibles:

  · afirmar sobre el grafo en el nivel RÁPIDO, sin ffmpeg y en milisegundos;
  · construir **solo la rama de audio**, que es lo que hace falta para medir la
    sonoridad antes de normalizarla. El grafo completo no sirve: sus salidas de
    vídeo quedarían sin consumir y un label sin consumir es un error de
    filtergraph, no un descarte silencioso.

Es la misma excepción a «ningún script importa a otro» que ya se concedió a
`comun.py` y a `reloj.py`, y por la misma razón: la alternativa es tener el
mismo conocimiento escrito en dos sitios, que es exactamente el fallo que este
repo lleva seis sprints persiguiendo.

Sin dependencias. Ni siquiera de la biblioteca estándar, salvo `os` para
componer rutas y `sys` para que un acto sin peso avise por stderr en vez de
caer al defecto en silencio.
"""

from __future__ import annotations

import os
import sys

# Cuánto puede sumar el máster antes del codificador. NO es −1,0 dBFS aunque el
# objetivo sea −1,0 en el fichero: entre el limitador y el AAC se pierde margen
# por los dos lados. Medido sobre el máster real de una pieza, aislando el
# códec —mismo audio, solo cambia el contenedor—:
#
#     techo del limitador     pico en el fichero tras AAC 192k
#          −1,0 dBFS                    −0,2      (medio dB de sobrepaso)
#          −1,2 dBFS                    −0,7
#          −1,4 dBFS                    −1,0      <- el que cumple
#
# Parte del sobrepaso no es del códec: `alimiter` con `attack=5` deja pasar
# transitorios cortos, así que el wav ya sale por encima de su propio techo.
# Da igual de quién sea la culpa — lo que se entrega es el mp4, y el número que
# manda es el de la derecha.
TECHO_DEFECTO = -1.4

# Qué sobrevive cuando hay más señales de las que caben. El truncado de antes
# era POR ORDEN TEMPORAL, así que en una pieza con muchos cues desaparecía el
# sonido del FINAL — incluidos `resolucion` y `suscribir`, que son los dos
# momentos que la pieza entera prepara. Un cierre sin su acorde acaba en seco;
# un tecleo de menos no lo nota nadie.
PRIORIDAD = {
    "resolucion": 0, "suscribir": 0,
    "riser": 1, "impacto": 1, "fallo": 1, "acierto": 1, "subgrave": 1,
    "preimpacto": 2, "barrido": 2, "notificacion": 2,
    "aparicion": 3, "escaner": 3, "pop": 3, "deslizar": 3,
    "destello": 4, "clic": 4,
    "tic": 5, "tecleo": 5,
}


# --------------------------------------------------------------------------
#  las juntas del A-Roll
# --------------------------------------------------------------------------
def declick(dur_tramo: float, d: float = 0.006) -> str:
    """Los seis milisegundos que hacen que no se oigan las costuras.

    `atrim` + `concat` corta la onda POR DONDE VA, sin mirar si está en un
    paso por cero. Medido sobre la pieza real —14 juntas en 38,5 s—, el
    escalón muestra a muestra en la junta llega a **6446 LSB**, que es 46
    veces la mediana natural de la señal (139), y **2 de las 14** superan
    el percentil 99,9 de toda la pieza. Eso es un chasquido, y en un
    proyecto cuya premisa es «se le ven las costuras» resulta que también
    se OYEN.

    Por qué `afade` y NO `acrossfade`, que es lo que parece que toca:
    `acrossfade=d` **acorta la salida en `d` por junta**. Con 14 juntas a
    20 ms son 0,28 s que el audio pierde y el vídeo no, porque el `concat`
    de vídeo no se acorta. Eso rompe la invariante de reloj de punta a
    punta que `tests/test_cadena.py` existe para proteger. `afade` no toca
    la duración: comprobado, 38,485 s exactos con 4, 6 y 12 ms.

    Por qué 6 ms. Medido sobre las mismas 14 juntas:
        hoy      escalón máx. 6446 · 2 juntas sobre el p99,9
        4 ms                   75 · 0
        6 ms                   50 · 0     <- por debajo de la mediana (139)
       12 ms                   25 · 0
    Con 6 ms el escalón cae por debajo de la mediana natural de la señal:
    deja de existir como evento. 12 ms mejora poco más y abre un hueco de
    24 ms en la junta, que ya roza lo audible dentro de habla continua.
    Y `silencios.py` garantiza un colchón de 0,05 s alrededor de cada
    corte, así que 6 ms cabe ocho veces dentro de lo que ya se reserva.

    Por qué `curve=qsin` y no la rampa lineal por defecto: cuarto de seno
    es potencia constante. Con rampa lineal, dos fundidos cruzados dejan un
    hoyo de energía en el centro; aquí no se cruzan, pero el mismo
    argumento vale para el hueco de la junta.

    El tramo más corto de una pieza real ronda el medio segundo, pero un
    `keep` de 15 ms es legal: se acota a un tercio del tramo para que los
    dos fundidos no se solapen y dejen el tramo sin nivel plano.
    """
    d = min(d, max(dur_tramo / 3.0, 0.0005))
    return (",afade=t=in:st=0:d=%.4f:curve=qsin"
            ",afade=t=out:st=%.4f:d=%.4f:curve=qsin"
            % (d, max(0.0, dur_tramo - d), d))


# --------------------------------------------------------------------------
#  recolección
# --------------------------------------------------------------------------
def recolectar(capas, dir_sfx, catalogo=None):
    """Aplana los `cues` del manifiesto. Devuelve `(cues, avisos)`.

    Los cues llegan ya en tiempo ABSOLUTO de pieza: los convirtió
    `render_playwright.js` sumando `capa.t + c.at`, porque quien sabe cuándo
    pasa algo dentro de una animación es la animación.

    La diferencia con el código que sustituye está en los `avisos`. Antes esto
    era `if os.path.exists(ruta): cues.append(...)` **sin `else`**: un nombre de
    efecto mal escrito desaparecía sin una línea de log y el vídeo salía sin ese
    sonido, sin que nada se quejara. Es exactamente el patrón que el repo ya
    castigó dos veces —las capas fuera de `ORDEN` y las claves `parallax`/`dx`
    sin copiar al manifiesto—, y estaba aquí otra vez.
    """
    cues, avisos = [], []
    for capa in capas:
        # La VENTANA de la capa. Un cue fuera de ella es un sonido que suena
        # cuando en pantalla no hay nada que lo produzca, y pasa de verdad:
        # `cierre-cta` publica su pulsación en el segundo 2,6 de su animación
        # y el acto recortó la capa a 1,61 s, así que el clic del botón sonaba
        # un segundo DESPUÉS de que el botón se hubiera ido. Nada lo delataba
        # —el sonido existe, el fichero existe, el cue es válido— salvo verlo.
        # Se descarta y se dice; clavarlo al borde sería inventarse una
        # intención que nadie tuvo.
        t0 = float(capa.get("t") or 0.0)
        t1 = t0 + float(capa.get("dur") or 0.0)
        for c in (capa.get("cues") or []):
            nombre = c.get("sfx")
            at = float(c.get("t") or 0.0)
            if t1 > t0 and not (t0 - 0.05 <= at <= t1 + 0.05):
                avisos.append(
                    "«%s» suena «%s» en %.2f s y la capa vive de %.2f a "
                    "%.2f: fuera de su ventana, se descarta"
                    % (capa.get("capa", "?"), nombre, at, t0, t1))
                continue
            ruta = os.path.join(dir_sfx, "%s.wav" % nombre)
            if catalogo is not None and nombre not in catalogo:
                avisos.append(
                    "«%s» pide el sonido «%s», que no está en el catálogo"
                    % (capa.get("capa", "?"), nombre))
                continue
            if not os.path.exists(ruta):
                avisos.append(
                    "«%s» pide «%s» y no existe %s"
                    % (capa.get("capa", "?"), nombre, ruta))
                continue
            cues.append({"sfx": nombre, "ruta": ruta,
                         "t": float(c["t"]),
                         "gain": float(c.get("gain", 1.0))})
    cues.sort(key=lambda c: (c["t"], c["sfx"]))
    return cues, avisos


# Cuánto dura la carrera del riser. Medido UNA vez con ffprobe sobre
# assets/sfx/riser.wav —1.800000 s exactos, lo sintetiza así hacer_sfx.py— y
# cableado: leerlo del disco en cada composición metería el filesystem en una
# función pura, y el día que el riser cambie de duración esta constante se
# regenera con el mismo comando de un renglón:
#     ffprobe -v error -show_entries format=duration -of csv=p=0 assets/sfx/riser.wav
DUR_RISER = 1.80


def cues_de_frontera(keep, actos, existentes=(), tol=0.2):
    """Cues sintéticos en los saltos de cámara del montaje. `(cues, avisos)`.

    Los dos saltos de zoom de la pieza real eran MUDOS: los cues nacen en las
    plantillas (`capas[].cues`) y el zoom por tramo vive en `keep[].zoom`,
    donde ninguna plantilla mira. El riser —PRIORIDAD 1 arriba y «el efecto
    que más se nota que falta» según el ROADMAP— solo lo emitía `transicion()`
    de escaleta.py, así que un montaje sin cortinillas no lo oía jamás.

    Aquí no entra nada nuevo: `keep` y `actos` (reloj de SALIDA los dos) ya
    los tiene el compositor. Mismo timeline → mismos cues, sin reloj ni
    azar: la función es pura y el orden de salida es el de las fronteras.

    La regla, conservadora y con los dos casos reales medidos al lado:

      · salto de zoom que ABRE acto → riser terminando EN la frontera
        (arranca DUR_RISER antes; gain 0.75, el mismo que `render_playwright`
        da a los risers de plantilla) + barrido en la frontera (gain 0.5).
        En la pieza real: la frontera de 3,78 s (zoom 1.16→1.0) cierra el
        gancho (fin 3.78) y el concepto arranca 1,48 s después → riser en
        1,98 s y barrido en 3,78 s.
      · salto de zoom a MITAD de acto → solo barrido (gain 0.5). En la pieza
        real: 33,9 s (zoom 1.0→1.16); el outro no arranca hasta 36,18 s.
      · frontera de acto SIN salto de zoom → nada. En la pieza real: el
        outro arranca en 36,18 s y el corte de 36,1 s no cambia el zoom
        (1.16→1.16). Un riser sin evento visual promete algo que no llega.

    Qué es «abrir acto», que es donde está el matiz: la frontera coincide
    (±`tol`) con el `ini` de un acto, o con el `fin` del anterior cuando el
    siguiente arranca a menos de una carrera de riser (los tramos de acto
    declaran HUECOS: material que ningún acto reclama, `leer_guion.py`). El
    riser que termina en el corte PROMETE el acto que viene; si el acto tarda
    en llegar más que la propia carrera del riser, la promesa no se cumple.
    Con los números reales: 1,48 s ≤ 1,8 en el corte de 3,78 (anuncia), y
    2,28 s > 1,8 en el de 33,9 (no anuncia: barrido y ya).

    `existentes` son los cues que el plan ya trae: si una escaleta ya anunció
    ese corte con su `transicion(riser=True)`, duplicárselo sería sonar dos
    veces. Se descarta CON aviso — el descarte mudo es el patrón que este
    repo lleva seis sprints castigando.
    """
    def _ya_hay(sfx, t):
        for e in existentes:
            if e.get("sfx") == sfx and abs(float(e["t"]) - t) <= 0.3:
                return float(e["t"])
        return None

    cues, avisos = [], []
    tramos = sorted(actos, key=lambda a: float(a["ini"]))
    for i in range(1, len(keep)):
        t = round(float(keep[i]["out_start"]), 3)
        z0 = float(keep[i - 1].get("zoom", 1.0))
        z1 = float(keep[i].get("zoom", 1.0))
        if z0 == z1:
            continue          # sin evento visual no se promete nada
        abre = any(abs(t - float(a["ini"])) <= tol for a in tramos)
        if not abre:
            for a, b in zip(tramos, tramos[1:]):
                if (abs(t - float(a["fin"])) <= tol
                        and 0.0 <= float(b["ini"]) - t <= DUR_RISER):
                    abre = True
                    break
        propuestos = []
        if abre:
            if t >= DUR_RISER:
                propuestos.append(("riser", round(t - DUR_RISER, 3), 0.75))
            else:
                # medio riser suena a error de montaje, no a tensión: es la
                # misma guarda que ya aplica render_playwright.js
                avisos.append(
                    "la frontera de %.2f s abre acto pero no hay %.1f s de "
                    "carrera para el riser: solo barrido" % (t, DUR_RISER))
        propuestos.append(("barrido", t, 0.5))
        for sfx, tc, gain in propuestos:
            previo = _ya_hay(sfx, tc)
            if previo is not None:
                avisos.append(
                    "la frontera de %.2f s ya tiene su %s en el plan "
                    "(%.2f s): no se duplica" % (t, sfx, previo))
                continue
            cues.append({"sfx": sfx, "t": tc, "gain": gain})
    return cues, avisos


def truncar(cues, tope):
    """Recorta a `tope` señales por PRIORIDAD, no por reloj.

    Devuelve `(cues, aviso)`. Se conserva el orden temporal en la salida: lo
    que cambia es a quién se sacrifica.
    """
    if len(cues) <= tope:
        return cues, None
    fuera = sorted(cues, key=lambda c: (PRIORIDAD.get(c["sfx"], 3), c["t"]))
    dentro = sorted(fuera[:tope], key=lambda c: c["t"])
    perdidos = {}
    for c in fuera[tope:]:
        perdidos[c["sfx"]] = perdidos.get(c["sfx"], 0) + 1
    aviso = ("%d señales de sonido y el tope son %d. Se quitan las menos "
             "importantes, no las últimas: %s"
             % (len(cues), tope,
                ", ".join("%s×%d" % kv for kv in sorted(perdidos.items()))))
    return dentro, aviso


def agrupar(cues):
    """`{sfx: [cue, ...]}` conservando el orden temporal.

    Una entrada de ffmpeg por SONIDO y no por cue: el mismo `.wav` alimenta N
    ramas con `asplit`. Con diez tecleos, antes eran diez `-i` del mismo
    fichero. Es lo que permite subir el tope de señales sin que el número de
    entradas se dispare.
    """
    grupos = {}
    for c in cues:
        grupos.setdefault(c["sfx"], []).append(c)
    return grupos


# --------------------------------------------------------------------------
#  variantes: que dos tecleos seguidos no sean el mismo fichero
# --------------------------------------------------------------------------
def variantes_de(ruta, existe=os.path.exists):
    """Las variantes grabadas de un efecto: `[base, _v2, _v3, _v4]`, las que
    existan y en ese orden FIJO — nada de listar el directorio, que depende
    del filesystem. El contrato con quien las genera es ese y solo ese:
    junto a `tecleo.wav` pueden existir `tecleo_v2.wav` … `tecleo_v4.wav`.

    `existe` se inyecta para poder probar el reparto sin tocar el disco, y
    porque las variantes pueden no existir todavía: sin ellas la lista es
    `[base]` y todo se comporta EXACTAMENTE como antes.
    """
    base, ext = os.path.splitext(ruta)
    lista = [ruta]
    for i in (2, 3, 4):
        v = "%s_v%d%s" % (base, i, ext)
        if existe(v):
            lista.append(v)
    return lista


def variante_para(i, variantes):
    """Qué fichero le toca a la aparición i-ésima de un efecto (por orden
    temporal): `variantes[i % n]`.

    Por qué existe: siete tecleos byte a byte IDÉNTICOS en 6,5 s —medido
    sobre la pieza real: seis del code-mockup y uno del terminal, todos
    desde `lista[0]["ruta"]`— son la firma de lo sintético. Ningún teclado
    real repite la misma onda dos veces. El reparto es módulo y no azar
    porque el azar está prohibido en este repo: mismo plan → misma mezcla,
    byte a byte.
    """
    return variantes[i % len(variantes)]


# --------------------------------------------------------------------------
#  ramas del grafo
# --------------------------------------------------------------------------
def rama_cues(grupos, idx0, sfx_vol, dur_total, variantes=None):
    """Las señales de sonido, agrupadas. Devuelve `(filtros, entradas, idx)`.

    `entradas` son las rutas que hay que añadir al comando con `-i`, en orden.
    `apad=whole_dur` y no `apad` a secas: sin argumento genera silencio
    INFINITO por rama y solo lo corta el `duration=first` del amix final. Con
    ocho ramas da igual; con ciento veinte, no.

    `variantes` es `{sfx: [rutas]}` (ver `variantes_de`): la aparición
    i-ésima de un efecto usa `variante_para(i, ...)`, así que cada variante
    entra UNA vez con `-i` y alimenta con `asplit` solo las apariciones que
    le tocan. Sin variantes (o sin el argumento) el grafo que sale es
    byte a byte el de siempre — es lo que permite calar esto sin re-calibrar
    nada.
    """
    filtros, entradas = [], []
    etiquetas = []
    idx = idx0
    for sfx, lista in grupos.items():
        vs = (variantes or {}).get(sfx) or [lista[0]["ruta"]]
        # reparto round-robin por orden temporal (la lista ya viene ordenada
        # de `recolectar`): ruta de variante -> apariciones que la usan
        reparto = {}
        for i in range(len(lista)):
            reparto.setdefault(variante_para(i, vs), []).append(i)
        fuentes = {}
        for vi, ruta_v in enumerate(vs):
            aps = reparto.get(ruta_v)
            if not aps:
                continue          # más variantes que apariciones
            entradas.append(ruta_v)
            mio = idx
            idx += 1
            # con una sola variante las etiquetas son las históricas
            # (`tecleo_0`), para que el grafo sin variantes no cambie ni
            # en el nombre de un label
            pref = sfx if len(vs) == 1 else "%s_v%d" % (sfx, vi)
            if len(aps) > 1:
                salidas = "".join("[%s_%d]" % (pref, i) for i in aps)
                filtros.append("[%d:a]asplit=%d%s" % (mio, len(aps), salidas))
                for i in aps:
                    fuentes[i] = "[%s_%d]" % (pref, i)
            else:
                fuentes[aps[0]] = "[%d:a]" % mio
        for i, c in enumerate(lista):
            etq = "sx_%s_%d" % (sfx, i)
            ms = int(round(max(0.0, c["t"]) * 1000))
            filtros.append(
                "%svolume=%.3f,adelay=%d:all=1,apad=whole_dur=%.3f[%s]"
                % (fuentes[i], c["gain"] * sfx_vol, ms, dur_total, etq))
            etiquetas.append("[%s]" % etq)
    if etiquetas:
        filtros.append("%samix=inputs=%d:duration=longest:normalize=0[golpes]"
                       % ("".join(etiquetas), len(etiquetas)))
    return filtros, entradas, idx


def rama_ducking(voz, ducking):
    """La locución se aparta bajo los golpes. Sin esto compiten y se enturbian.

    `ratio = 1 + ducking*5` conserva la calibración que ya estaba: `--ducking
    0.95` da 5,75, que es lo que se afinó a oído en la tanda 1.
    """
    if ducking <= 0:
        return ["[%s][golpes]amix=inputs=2:duration=first:normalize=0[mix]" % voz]
    return [
        "[golpes]asplit=2[gmix][gkey]",
        "[%s][gkey]sidechaincompress=threshold=0.05:ratio=%.1f:"
        "attack=8:release=260[vozduck]" % (voz, 1.0 + ducking * 5.0),
        "[vozduck][gmix]amix=inputs=2:duration=first:normalize=0[mix]",
    ]


def rama_master(entrada, ganancia_dB, techo_dBTP=TECHO_DEFECTO, salida="master"):
    """Ganancia estática y limitador. La última rama antes del codificador.

    **El limitador no es una preferencia, es aritmética.** Medido sobre la
    pieza real: sonoridad −17,6 LUFS y pico −2,80 dBTP. Llevarla a −14 son
    +3,57 dB y solo hay 2,80 dB de margen, así que sin limitador la pieza sale
    a **+0,77 dBTP** — recortada por el codificador, no por nosotros.

    Y por qué ganancia estática en vez de `loudnorm` de una pasada: con ese
    déficit `loudnorm` no puede aplicar ganancia lineal y **cae a modo
    dinámico**, que se come 0,2 LU de rango (medido: LRA 3,0 → 2,8). Además
    reamuestrea internamente a 192 kHz y obliga a volver. Ganancia + limitador
    da el objetivo exacto sin tocar la dinámica, con un filtro que el repo ya
    usa en `hacer_sfx.py`.
    """
    return ["[%s]volume=%+.2fdB,alimiter=limit=%.4f:attack=5:release=50:"
            "level=false,aresample=48000[%s]"
            % (entrada, ganancia_dB, 10 ** (techo_dBTP / 20.0), salida)]


# Cuánto pesa la cama en cada acto. No son valores musicales: son la forma de
# la pieza. §13 define cuatro actos —gancho, núcleo, prueba, cierre— y lo que
# el fondo tiene que hacer en cada uno es distinto: entrar con algo de tensión,
# retirarse cuando la voz explica, volver a subir con la demostración y
# resolver al final.
#
# El contraste subió tras medir renders/codex-guion.mp4 con ebur128: la cama
# entera estaba enmascarada (ver CAMA_DEFECTO) y, encima, el arco 0.80↔1.25
# era de solo 3,9 dB — un arco que no se oía sobre un fondo que no se oía.
# Con 0.65↔1.35 el arco es de 6,3 dB: el concepto se RETIRA de verdad
# (−1,8 dB más que antes) y el cierre resuelve (+0,7 dB), que es lo único que
# un fondo estructural tiene que hacer.
PESO_ACTO = {"gancho": 1.20, "hook": 1.20,
             "concepto": 0.65, "nucleo1": 0.65,
             "prueba": 1.00, "nucleo2": 1.00,
             "cierre": 1.35, "outro": 1.35,
             # Los nombres que usa de verdad quien escribe un guion. La tabla
             # tenía el vocabulario del director —«concepto», «núcleo1»— y no
             # el del guionista, así que «PROBLEMA» y «MECANISMO» caían al
             # defecto 1.00: la mitad de la pieza sonaba al mismo nivel y la
             # medida lo dijo con una palabra, LRA 1,6 LU. La curva que
             # describen es la misma: el problema se retira para que el
             # mecanismo pueda subir.
             "problema": 0.65, "tension": 0.70,
             "mecanismo": 0.85, "explicacion": 0.85, "como": 0.85,
             "solucion": 1.00, "demo": 1.00, "practica": 1.00,
             "llamada": 1.35, "cta": 1.35}
PESO_POR_DEFECTO = 1.0

# Volumen base de la cama (lo multiplican los pesos de arriba). Calibrado
# MIDIENDO los valles momentary de las pausas de la voz con ebur128 sobre el
# máster de solo audio de la pieza real, no a ojo:
#
#     base 0.25 (el histórico)   valles en −32/−37 LUFS (p25 −32,9, mín −37,3)
#     base 0.70 (+8,9 dB)        valles en −26/−30 LUFS (p25 −27,3, mín −30,3)
#
# Un lecho audible deja el suelo de las pausas en −25/−28; con 0.25 la cama
# quedaba ~18 dB bajo la voz — enmascarada en cada instante de la pieza, o
# sea un fichero, no un fondo. Con 0.70 el suelo típico queda en −27±2 y la
# cama ~13 dB bajo la voz. El valle más hondo (−30,3) cae en el CENTRO del
# concepto, donde el arco (0.65 = −3,7 dB) la retira adrede: subir la base
# hasta plancharlo dejaría las pausas del cierre en −19, que ya no es fondo.
# La subida no es lineal con la ganancia: el máster renormaliza a −14 LUFS
# integrados, así que +1,2 dB de cama solo movían el suelo +1,0 (medido
# 0.55→0.63) — por eso se calibra midiendo y no con una regla de tres.
CAMA_DEFECTO = 0.70

# Tildes fuera sin `unicodedata`: los nombres de acto son castellano llano y
# esta tabla cubre lo que aparece en un guion. No merece una dependencia más.
_TILDES = str.maketrans("áéíóúüñ", "aeiouun")


def _normaliza(nombre):
    return nombre.lower().translate(_TILDES).strip()


def peso_de_acto(nombre):
    """El peso de cama que le toca a un acto, casando el nombre con tolerancia.

    Antes esto era `PESO_ACTO.get(nombre)` EXACTO, y los actos que llegan por
    la vía del guion no se llaman como las claves: «prueba / ejecución» y
    «outro y bucle infinito» caían al defecto 1.0 sin una línea de log. Medido
    por actos con ebur128 sobre la pieza real: el cierre perdió su 1.25
    —+1,9 dB, justo en la resolución que la pieza entera prepara— y el acto
    que el diseño quiere más retirado (concepto, 0.80) salió el MÁS alto de
    la pieza. Es el mismo patrón de descarte mudo que este repo ya castigó
    con las capas fuera de `ORDEN` y con los cues sin `else` — y estaba aquí
    otra vez.

    El casado, en orden y quedándose con el primero que acierte:
      (a) la clave exacta, ya normalizada (minúsculas, tildes fuera);
      (b) el primer token antes de espacio o «/»
          («prueba / ejecución» → prueba, «outro y bucle infinito» → outro);
      (c) prefijo: el nombre EMPIEZA por una clave («gancho-frio» → gancho).
          Solo en esa dirección — al revés, una inicial suelta casaría con
          media tabla.

    Si nada casa, el defecto Y un aviso por stderr con el nombre y las claves
    válidas: el defecto sin aviso es exactamente el fallo que se arregla.
    """
    if nombre:
        n = _normaliza(nombre)
        if n in PESO_ACTO:
            return PESO_ACTO[n]
        tokens = n.replace("/", " ").split()
        if tokens and tokens[0] in PESO_ACTO:
            return PESO_ACTO[tokens[0]]
        for clave in sorted(PESO_ACTO, key=len, reverse=True):
            if n.startswith(clave):
                return PESO_ACTO[clave]
    print("AVISO: el acto «%s» no casa con ningún peso de la cama; usa el "
          "defecto %.2f. Claves válidas: %s"
          % (nombre, PESO_POR_DEFECTO, ", ".join(sorted(PESO_ACTO))),
          file=sys.stderr)
    return PESO_POR_DEFECTO


def volumen_por_actos(actos, base):
    """Expresión de `volume` que interpola entre los pesos de cada acto.

    Devuelve `None` si no hay actos: entonces el volumen es constante y no hay
    razón para pagar un `eval=frame`.

    Se interpola entre los PUNTOS MEDIOS de cada acto, no se conmuta en sus
    fronteras. Un escalón de gain en la frontera es audible —es exactamente un
    corte de nivel, que es lo que el declick acaba de quitar de las juntas— y
    además caería justo donde suele haber una pausa, o sea donde más se oiría.
    Interpolando, el fondo ya viene subiendo cuando llega el acto siguiente,
    que es lo que hace un músico y no un conmutador.
    """
    if not actos:
        return None
    pts = []
    for a in actos:
        medio = (float(a["ini"]) + float(a["fin"])) / 2.0
        pts.append((medio, peso_de_acto(a.get("nombre"))))
    pts.sort()
    if len(pts) == 1:
        return "%.4f" % (base * pts[0][1])

    # Cadena de `if` anidados: antes del primer punto vale el primer peso,
    # después del último vale el último, y en medio se interpola linealmente.
    expr = "%.4f" % (base * pts[-1][1])
    for (t0, g0), (t1, g1) in reversed(list(zip(pts, pts[1:]))):
        tramo = ("(%.4f+(%.4f)*(t-%.3f)/%.3f)"
                 % (base * g0, base * (g1 - g0), t0, max(t1 - t0, 1e-6)))
        expr = "if(lt(t,%.3f),%s,%s)" % (t1, tramo, expr)
    return "if(lt(t,%.3f),%.4f,%s)" % (pts[0][0], base * pts[0][1], expr)


def ganancia_para(lufs_medido, objetivo=-14.0):
    """Cuánto hay que subir para llegar al objetivo de la plataforma.

    Reels, Shorts y TikTok normalizan alrededor de −14 LUFS. Entregar más bajo
    significa que la plataforma sube la pieza a ciegas y sin limitador; más
    alto, que la baja y el trabajo de máster se pierde.
    """
    return objetivo - lufs_medido
