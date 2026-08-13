#!/usr/bin/env python3
"""El contrato de reloj de la pieza. Un solo sitio, y por qué.

Este repo evita que un script importe a otro, y la razón está escrita en
`validar_plan.py`: «importarlo arrastra sus dependencias y este script tiene
que poder correr solo». No aplica aquí —esto es `json`, `os` y `re`— y la
alternativa medida era peor: había TRES registros de la misma cosa, y no
coincidían.

    silencios.CLAVES_TIEMPO   = ("palabras", "ventanas", "cues")
    validar_plan.CLAVES_RELATIVAS = ("at", "flashEn", "pulsacion", "ini", "fin")

El primero indexa por CONTENEDOR y el segundo por HOJA, y se contradicen
sobre `{ini, fin, at}`: uno los llama relativos y el otro los remapea como
absolutos. Esa contradicción era el fallo.

--------------------------------------------------------------------------
LAS TRES REGLAS
--------------------------------------------------------------------------

1. **`words` y `blocks` van SIEMPRE en reloj de ORIGEN.** `keep` es el único
   registro origen→salida. El reloj de salida NO se almacena: se deriva con
   `Mapa`. Guardar las dos representaciones del mismo hecho en el mismo
   fichero es exactamente cómo nació el fallo.

2. **Todo artefacto con tiempos declara su reloj**, y quien lo lee lo
   comprueba y aborta nombrando el comando que lo arregla.

3. **La semántica se indexa por clave HOJA, no por contenedor.** Los
   contenedores crecen con cada plantilla nueva —hay 12 y la lista vieja
   cubría 2— mientras las hojas son 30 y estables. Y el recorrido es
   recursivo, así que da igual a qué profundidad viva el tiempo.

--------------------------------------------------------------------------
LO QUE HACE QUE ESTO SEA CORRECTO Y ANTES NO
--------------------------------------------------------------------------

`at`, `ini`, `fin` y compañía son RELATIVOS al inicio de su capa. Lo dice
`validar_plan.py` y lo confirma el renderizador, que llama a `seek(f/fps)`
—tiempo local de capa— y publica los cues como `capa.t + c.at`.

`silencios.remapea_config` los trataba como absolutos, y acertaba **por
accidente**: las únicas capas con listas de tiempos son los subtítulos, y
viven en `t: 0`, donde `mapa(0 + o) - mapa(0)` colapsa a `mapa(o)`. En
cuanto alguien escriba una lista de `palabras` en una capa con `t > 0`, el
código viejo la corrompe sin decir nada. Añadir `"cortes"` a la lista vieja
habría metido un fallo NUEVO, porque `cortes[].at` también es relativo.

Aquí se aplica la fórmula correcta:

    o' = mapa(t_capa + o) - mapa(t_capa)

que es idéntica a la vieja donde la vieja funciona, y correcta donde no.
"""

from __future__ import annotations

import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLAS = os.path.join(RAIZ, "templates")

# --------------------------------------------------------------------------
#  SEMÁNTICA POR CLAVE HOJA
# --------------------------------------------------------------------------
# "pos"  instante RELATIVO al inicio de la capa. Se remapea.
# "dur"  duración o ritmo. NO se remapea: comprimir el reloj de la pieza no
#        debe estirar ni encoger la animación de entrada de una tarjeta.
# "nada" ni tiempo ni duración; aparece aquí solo para que la auditoría de
#        `comprobar_relojes.py` no la reclame una y otra vez.
#
# La clasificación NO se puede derivar del código, y hay que decirlo: el
# idiom `span(t, fin - cfg.salida, cfg.salida, ...)` hace que `salida`
# aparezca en el hueco de posición Y en el de duración, en 34 plantillas. Lo
# que sí es derivable es la LISTA de candidatas —eso lo hace
# `claves_candidatas()`— y por eso la auditoría propone y una persona
# clasifica, en vez de adivinar.
#
# Cómo se resolvieron las dudosas: por la firma `span(t, INICIO, DURACIÓN)`.
#   gold-glint:51      span(t, cfg.espera, cfg.barrido)      -> espera=pos, barrido=dur
#   padlock-unlock:61  span(t, cfg.salto, 0.30)              -> salto=pos
#   highlighter:84     span(t, cfg.at + ..., cfg.barrido)    -> at=pos
#   notification:63    span(t, cfg.entrada + cfg.permanencia, 0.34)
#                      -> las dos son duraciones que SUMADAS dan un instante
SEMANTICA: dict[str, str] = {
    # --- posiciones ---
    "at": "pos",
    "ini": "pos",
    "fin": "pos",
    "start": "pos",
    "end": "pos",
    "t": "pos",
    "pulsacion": "pos",     # cierre-cta, search-bar: el clic del puntero
    "espera": "pos",        # gold-glint: cuándo arranca el barrido
    "salto": "pos",         # padlock-unlock: cuándo salta el arco
    "vsEn": "pos",          # split-versus
    "sugEn": "pos",         # search-bar: cuándo caen las sugerencias
    "flashEn": "pos",       # kinetic-type: LISTA DE NÚMEROS sueltos

    # --- duraciones y ritmos ---
    "dur": "dur",
    "duration": "dur",
    "entrada": "dur",
    "salida": "dur",
    "barrido": "dur",
    "escalonado": "dur",
    "subida": "dur",
    "pop": "dur",
    "permanencia": "dur",
    "ciclo": "dur",
    "viaje": "dur",
    # antes-despues: cuánto tarda el canto en retroceder al final. Es
    # duración y NO posición: se mide desde el fin de la capa hacia atrás,
    # así que cambiar `viaje` no debe descolocar el retroceso.
    #
    # La clasificó una persona porque el barrido NO PUEDE proponerla: sus
    # candidatas salen de `_EXACTAS` —que es la propia tabla más seis
    # palabras— y de los sufijos `En/At/Dur/Ini/Fin`. O sea que solo propone
    # nombres que ya conoce o que llevan la marca puesta, y un nombre nuevo
    # como este es invisible para él. No es un fallo del barrido: ampliarlo
    # por nombre le haría reclamar `lado`, `hueco`, `celda` y `columnas`, y
    # una auditoría que grita en falso se deja de leer. Pero conviene saber
    # que la red tiene ESE agujero y que quien añade una clave de tiempo con
    # nombre nuevo la tiene que traer aquí a mano.
    "vuelta": "dur",
    # cinta: cuánto tarda la correa en llegar a régimen y en pararse. Son
    # DURACIONES, y hay que remaparlas: si se comprime el reloj, un arranque
    # de 1,15 s dentro de una capa que ahora dura un 6 % menos tiene que
    # encogerse con ella o la correa nunca llega a régimen.
    #
    # Las trae aquí una persona por la misma razón que `vuelta`: el barrido
    # propone candidatas desde `_EXACTAS` y desde los sufijos `En/At/Dur/
    # Ini/Fin`, así que un nombre nuevo y sin sufijo le es invisible. Es un
    # agujero conocido de la red, no un fallo del barrido — ampliarlo por
    # nombre le haría reclamar `lado`, `hueco` y `columnas`, y una auditoría
    # que grita en falso se deja de leer.
    "arranque": "dur",
    "frenada": "dur",
    "trazo": "dur",
    "fundido": "dur",
    "cps": "dur",           # caracteres por segundo: un ritmo
    "huecoMax": "dur",      # umbral de pausa, no un instante
    "cada": "dur",
    "retardo": "dur",
    "salto_dur": "dur",     # glass-dock: cuánto tarda el salto, no cuándo

    # --- ni una cosa ni la otra ---
    "reparto": "nada",      # security-pipeline-nodes: booleano
    # kinetic-captions, la dinámica: factores adimensionales y píxeles, no
    # tiempos. `silencios.py` no debe tocarlos al remapear el reloj. Los
    # trae aquí una persona por lo mismo que `vuelta` y `arranque`: el
    # barrido solo propone nombres que ya conoce o con sufijo de tiempo, y
    # estos no llevan ninguno — pero dejarlos SIN clasificar es dejar la
    # puerta a que alguien los lea como tiempos el día que renombre uno.
    "gestos": "nada",       # booleano: entradas rotativas por grupo
    "popPalabra": "nada",   # factor de escala de la palabra viva
    "popClave": "nada",     # ídem para la clave
    "vaiven": "nada",       # px de descoloque por grupo
    "cuerpoClave": "nada",  # factor de cuerpo del grupo con clave/energía
    "giroClave": "nada",    # grados de micro-giro de la clave, no un tiempo
}

RELATIVAS = tuple(k for k, v in SEMANTICA.items() if v == "pos")


# --------------------------------------------------------------------------
#  mapa de tiempos
# --------------------------------------------------------------------------
class Mapa:
    """Reloj original -> reloj de salida, por tramos.

    Se construye de los `keep`: cada uno aporta un desplazamiento
    constante. Fuera de los `keep` —o sea, dentro de un silencio quitado—
    el tiempo se lleva al borde más cercano en vez de devolver un hueco:
    un gráfico anclado a una pausa tiene que ir a algún sitio.

    Los tramos se ORDENAN al construir. Antes se asumía que venían en orden
    y no se comprobaba: `recortar()` sí ordena, así que la garantía era
    accidental, y con un `keep` desordenado el mapa devolvía el reloj de
    otro tramo —silenciosamente— para todo: palabras, capas y configs.
    """

    def __init__(self, keep: list):
        self.tramos = sorted(
            (float(k["src_start"]), float(k["src_end"]), float(k["out_start"]))
            for k in keep)

    def __call__(self, t: float) -> float:
        t = float(t)
        if not self.tramos:
            # Un `keep` vacío significa que NO se conserva metraje, no «todavía
            # no se ha cortado nada»: `clean_transcript.py` siempre emite al
            # menos un tramo. Antes esto devolvía `t` —la identidad— mientras
            # `duracion()` devolvía 0, y esas dos respuestas se contradicen: se
            # escribía `duration_final: 0` dejando los tiempos de las palabras
            # intactos, y una capa de fondo con `duracion: 0`. Ahora las dos
            # dicen lo mismo, y `hay_metraje()` permite preguntarlo antes.
            return 0.0
        if t <= self.tramos[0][0]:
            return self.tramos[0][2]
        for s0, s1, o0 in self.tramos:
            if s0 <= t <= s1:
                return o0 + (t - s0)
            if t < s0:                        # cayó en un silencio quitado
                return o0
        s0, s1, o0 = self.tramos[-1]
        return o0 + (s1 - s0)

    def duracion(self) -> float:
        if not self.tramos:
            return 0.0
        s0, s1, o0 = self.tramos[-1]
        return o0 + (s1 - s0)

    def hay_metraje(self) -> bool:
        """False si no se conserva nada. Preguntarlo evita interpretar un 0 de
        `duracion()` como «una pieza que dura cero» en vez de como «el timeline
        está mal»."""
        return bool(self.tramos) and self.duracion() > 1e-9

    def es_identidad(self) -> bool:
        """Origen y salida coinciden: no se ha quitado nada todavía."""
        return all(abs(s0 - o0) < 1e-6 for s0, _, o0 in self.tramos)


# --------------------------------------------------------------------------
#  guarda de reloj
# --------------------------------------------------------------------------
def exige_reloj(d: dict, esperado: str, quien: str, produce: str = "") -> None:
    """Aborta si el artefacto no está en el reloj que `quien` necesita.

    Sin esto, el desajuste no daba error en ningún sitio: `validar_plan.py`
    solo comprueba rangos estructurales y un desfase de segundos cae dentro
    de rangos válidos; `composite_ffmpeg.py` no lee ni el plan ni las
    palabras. El daño quedaba grabado en los píxeles de los subtítulos y solo
    se veía mirando el vídeo entero.
    """
    tiene = d.get("reloj")
    if tiene == esperado:
        return
    if tiene is None:
        print("%s: el artefacto no declara en qué reloj están sus tiempos.\n"
              "  Lo escribió una versión anterior del pipeline. Regenéralo:\n"
              "    %s" % (quien, produce or "vuelve a ejecutar el paso anterior"),
              file=sys.stderr)
    else:
        print("%s: los tiempos están en reloj «%s» y hace falta «%s».\n"
              "  Aplicar dos veces el recorte de silencio desplaza todo sin\n"
              "  dar error: los gráficos llegan tarde y cada vez más tarde.\n"
              "  Regenera el artefacto en reloj de origen:\n"
              "    %s" % (quien, tiene, esperado,
                          produce or "vuelve a ejecutar el paso anterior"),
              file=sys.stderr)
    raise SystemExit(2)


# --------------------------------------------------------------------------
#  recorrido y remapeo
# --------------------------------------------------------------------------
def recolectar_tiempos(nodo, ruta: str = "", salida: list | None = None) -> list:
    """Todos los pares (ruta, valor) de claves hoja de tiempo, a cualquier
    profundidad. Movida de `validar_plan.py`, donde ya tenía el comentario
    que lo justifica: «los tiempos viven dentro de listas anidadas»."""
    if salida is None:
        salida = []
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            if SEMANTICA.get(k) == "pos" and isinstance(v, (int, float)) \
                    and not isinstance(v, bool):
                salida.append((ruta + "." + k if ruta else k, float(v)))
            elif SEMANTICA.get(k) == "pos" and isinstance(v, list):
                # listas de números sueltos, como `flashEn`
                for i, x in enumerate(v):
                    if isinstance(x, (int, float)) and not isinstance(x, bool):
                        salida.append(("%s%s[%d]" % (ruta + "." if ruta else "",
                                                     k, i), float(x)))
                    else:
                        recolectar_tiempos(x, "%s%s[%d]" % (
                            ruta + "." if ruta else "", k, i), salida)
            else:
                recolectar_tiempos(v, "%s.%s" % (ruta, k) if ruta else k, salida)
    elif isinstance(nodo, list):
        for i, v in enumerate(nodo):
            recolectar_tiempos(v, "%s[%d]" % (ruta, i), salida)
    return salida


def remapea(nodo, mapa: Mapa, t_capa: float):
    """Reescribe EN SITIO los tiempos de una config al reloj de salida.

    `t_capa` es el inicio de la capa en reloj de ORIGEN, y hace falta porque
    los tiempos de dentro son relativos a él. Se toma ANTES de tocar
    `capa["t"]`: leerlo después da el valor ya remapeado y el resultado sale
    mal por la diferencia entre los dos relojes.
    """
    base = mapa(t_capa)

    def rel(o: float) -> float:
        return round(mapa(t_capa + float(o)) - base, 3)

    if isinstance(nodo, dict):
        for k, v in list(nodo.items()):
            clase = SEMANTICA.get(k)
            if clase == "pos" and isinstance(v, (int, float)) \
                    and not isinstance(v, bool):
                nodo[k] = rel(v)
            elif clase == "pos" and isinstance(v, list):
                nodo[k] = [rel(x) if isinstance(x, (int, float))
                           and not isinstance(x, bool)
                           else remapea(x, mapa, t_capa) or x for x in v]
            elif clase in ("dur", "nada"):
                continue          # una duración no se remapea
            else:
                remapea(v, mapa, t_capa)
    elif isinstance(nodo, list):
        for v in nodo:
            remapea(v, mapa, t_capa)
    return None


# --------------------------------------------------------------------------
#  auditoría del catálogo: que la tabla no se quede vieja en silencio
# --------------------------------------------------------------------------
_COMENT_BLOQUE = re.compile(r"/\*.*?\*/", re.S)
_COMENT_LINEA = re.compile(r"(?<!:)//[^\n]*")


def sin_comentarios(src: str) -> str:
    """Quitar comentarios NO es opcional: varias plantillas nombran claves
    en prosa explicativa —`cfg.ancho`, `cfg.zona`, `cfg.escala`— y contarlas
    enmascararía justo lo que se busca. Es la misma lección que aprendió
    `validar_plan.leer_orden` cuando aún leía `ORDEN` del fuente con una
    regex: un comentario dentro de los corchetes se colaba como si fuera una
    capa (hoy `ORDEN` es un fichero de datos, guiones/capas.json).

    Se sustituyen CONSERVANDO LOS SALTOS DE LÍNEA. Con un espacio, un
    comentario de bloque de siete líneas descontaba seis del recuento y el
    informe señalaba la línea 96 cuando la clave estaba en la 102. Un aviso
    que dice «edita esta línea» y apunta a otra es peor que no darla."""
    def hueco(m: re.Match) -> str:
        return "\n" * m.group(0).count("\n")
    return _COMENT_LINEA.sub("", _COMENT_BLOQUE.sub(hueco, src))


def bloque_defaults(src: str) -> str:
    """El texto del bloque `defaults: { ... }`, contando llaves."""
    m = re.search(r"defaults\s*:\s*\{", src)
    if not m:
        return ""
    i, prof = m.end(), 1
    while i < len(src) and prof:
        if src[i] in "{[":
            prof += 1
        elif src[i] in "}]":
            prof -= 1
        i += 1
    return src[m.end():i - 1]


def claves_candidatas(dir_plantillas: str = PLANTILLAS) -> dict:
    """Claves hoja con pinta de tiempo, y dónde aparecen.

    Solo se proponen claves cuyo valor sea un NÚMERO, a cualquier profundidad
    dentro de `defaults`. Que sea a cualquier profundidad importa: `cortes:
    [{at: 0.4}]` y `saltos: [{at: 0.6}]` esconden su tiempo dentro de una
    lista, y ese es justo el caso que la lista vieja de contenedores no
    cubría. Que sea solo numérico también: así el NOMBRE del contenedor
    —`saltos`, `cortes`, `palabras`— no se propone nunca, porque no hace
    falta clasificarlo. Sus hojas ya están en la tabla y el remapeo es
    recursivo. Es la ventaja entera de indexar por hoja."""
    fuera = {}
    if not os.path.isdir(dir_plantillas):
        return fuera
    for f in sorted(os.listdir(dir_plantillas)):
        if not f.endswith(".html") or f.startswith("_"):
            continue
        ruta = os.path.join(dir_plantillas, f)
        src = sin_comentarios(open(ruta, encoding="utf-8").read())
        blk = bloque_defaults(src)
        if not blk:
            continue
        desplazamiento = src.index(blk) if blk in src else 0
        # Dos formas: `clave: 0.42` y `clave: [0.5, 1.2]`. La segunda hacía
        # falta porque `flashEn` es una lista de números SUELTOS —no de
        # objetos— y con solo la primera el auditor no habría propuesto nunca
        # una clave nueva de esa forma. Es el hueco que dejaba la lista de
        # contenedores por el otro lado.
        # La lista puede venir VACÍA —`flashEn: []` en kinetic-type— y
        # entonces no hay ningún número del que fiarse: el nombre es la única
        # señal, y el filtro por `_suena_a_tiempo` es el que decide. Exigir un
        # dígito dentro dejaba fuera precisamente la clave que motivó cubrir
        # las listas de números sueltos.
        patron = (r"([A-Za-z_]\w*)\s*:\s*"
                  r"(?:-?\d[\d.]*|\[\s*(?:-?\d[\d.,\s-]*)?\])")
        for m in re.finditer(patron, blk):
            clave = m.group(1)
            if clave in SEMANTICA or _suena_a_tiempo(clave):
                linea = src[:desplazamiento + m.start()].count("\n") + 1
                fuera.setdefault(clave, []).append("%s:%d" % (f, linea))
    return fuera


# Heurística SOLO para proponer. Una clave que la case y no esté en
# `SEMANTICA` hace fallar la auditoría, que es el punto: obliga a
# clasificarla a mano antes de que su plantilla entre en un plan.
#
# Coincidencia por palabra completa o por sufijo, NUNCA por prefijo: con
# prefijos, la pista «t» se comía `tam` y `tasa` —cuerpo de letra y muestras
# por segundo— y una auditoría que reclama cuatro claves que no son tiempos
# se desactiva en dos días.
_EXACTAS = frozenset(SEMANTICA) | frozenset({
    "cuando", "delay", "offset", "tiempo", "instante", "compas"})
_SUFIJOS = re.compile(r"(?:En|At|Dur|Ini|Fin)$|_(?:dur|at|en|ini|fin)$")


def _suena_a_tiempo(clave: str) -> bool:
    return clave in _EXACTAS or bool(_SUFIJOS.search(clave))


def sin_clasificar(dir_plantillas: str = PLANTILLAS) -> dict:
    """Candidatas que la tabla no conoce. Vacío = la tabla está al día."""
    return {k: v for k, v in claves_candidatas(dir_plantillas).items()
            if k not in SEMANTICA}


def sella(d: dict, reloj: str) -> dict:
    d["reloj"] = reloj
    return d


# --------------------------------------------------------------------------
#  El compás del contenido tecleado — UNA fuente, tres consumidores
# --------------------------------------------------------------------------
# Vivía copiado en tres sitios (leer_guion dimensionaba, validar_plan
# vigilaba, y silencios necesitaba re-alargar tras el remapeo) y las copias
# ya habían divergido: para `terminal`, uno tomaba la cola de lectura de la
# última línea POR `at` y otro de la que TERMINA más tarde — un plan válido
# para el que dimensiona reventaba en el que vigila (medido: 3,21 s contra
# 6,31 s sobre las mismas líneas). Y hasta el recuento de caracteres del
# mismo incidente salía distinto en los mensajes (194 vs 195). El compás es
# semántica de TIEMPO de las configs, que es exactamente lo que este módulo
# guarda.
TECLEO_ARRANQUE = 0.4      # code-mockup.html:compas() arranca en 0,4 s
TECLEO_PAUSA = 0.09        # pausa entre líneas del mismo compás
TECLEO_REVELADO = 0.11     # una línea no-cmd de terminal.html se revela, no
                           # se teclea (terminal.html:669)
LECTURA_CPS = 15.0         # leer no es teclear
LECTURA_MIN = 0.9          # terminar de escribirse y morir en el mismo
                           # fotograma es el mismo fallo con otro nombre


def tecleo_filas(cfg: dict) -> list:
    """[(txt, fin relativo al inicio de la capa)] del contenido tecleable,
    o [] si la config no trae una forma que este compás sepa interpretar.
    Una forma desconocida devuelve [] a propósito: adivinar produce errores
    falsos, y un error falso es lo que hace que una puerta se deje de leer."""
    def _num(v, defecto):
        try:
            n = float(v)
        except (TypeError, ValueError):
            return defecto
        return n if n > 0 else defecto

    codigo = cfg.get("codigo")
    if isinstance(codigo, list) and codigo:
        cps = _num(cfg.get("cps"), 44.0)
        t, filas = TECLEO_ARRANQUE, []
        for bruto in codigo:
            if isinstance(bruto, str):
                txt = bruto
            elif isinstance(bruto, dict) and "txt" in bruto:
                txt = str(bruto["txt"])
            else:
                return []
            fin = t + len(txt) / cps
            filas.append((txt, round(fin, 3)))
            t = fin + TECLEO_PAUSA
        return filas

    lineas = cfg.get("lineas")
    if (isinstance(lineas, list) and lineas
            and all(isinstance(l, dict) and "at" in l and "txt" in l
                    for l in lineas)):
        cps_cfg = _num(cfg.get("cps"), 26.0)
        filas = []
        for l in lineas:
            txt = str(l.get("txt") or "")
            at = _num(l.get("at"), 0.0)
            cps = _num(l.get("cps"), cps_cfg)
            fin = at + (len(txt) / cps if l.get("tipo") == "cmd"
                        else TECLEO_REVELADO)
            filas.append((txt, round(fin, 3)))
        return filas
    return []


def tecleo_minimo(cfg: dict) -> float | None:
    """Duración mínima de la capa para que su contenido se ESCRIBA y se LEA:
    fin de la fila que termina más tarde + max(0,9 s, len(última)/15).
    None si la config no trae contenido tecleable."""
    filas = tecleo_filas(cfg)
    if not filas:
        return None
    txt, fin = max(filas, key=lambda p: p[1])
    return round(fin + max(LECTURA_MIN, len(txt.strip()) / LECTURA_CPS), 2)
