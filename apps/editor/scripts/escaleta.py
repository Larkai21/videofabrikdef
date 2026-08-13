#!/usr/bin/env python3
"""Escribir un plan a mano desde una escaleta de dirección, con red.

Esto es lo que de verdad se usa. `dirigir.py` reparte por intención sobre la
transcripción y sirve cuando no hay escaleta; pero cuando el guion viene con
actos, disparadores y copy exactos —que es el caso normal—, repartir otra vez
lo contradice. Antes eso significaba escribir el plan a pelo, y de ahí salieron
los dos fallos que este módulo evita.

## Anclar por PALABRA, no por segundo

    e.tarjeta("headlineclipper", "headline-clipper.html", ancla="dólares")

y no `t=3.65`. Los instantes se buscan en la transcripción, así que si se vuelve
a transcribir —otro modelo, otro recorte— el plan se mueve con ellos. Escribir
los segundos a mano fue lo que dejó el candado a 4,4 s de su palabra
disparadora en la primera versión de la pieza de Codex: se rehizo el montaje,
los tiempos cambiaron, y el número escrito a mano se quedó donde estaba.

## Las reglas se comprueban en CADA pasada

`auditar()` mide el plan contra BRAND_RULES §12, §13 y §15 y devuelve
`(errores, avisos)`. Los avisos salen por `stderr` y **se ven**, en vez de
quedarse en la cabeza de quien escribió el plan:

    §13  cuatro gráficos, uno por acto, 2,5-3,5 s cada uno, 12 s de aire
    §15  micro-FX: máximo 6, cada efecto UNA vez, 7 s de separación,
         0,6 s de aire alrededor de una tarjeta de acto
    §12  `cierre-cta` solo en el último 15 % y una sola vez

Que una regla se incumpla no siempre es un error —la pieza de Codex baja el
aire de 12 s a 7,9 s a propósito, porque su acto 2 es full-motion y en 44 s no
caben las dos cosas—, pero **tiene que estar a la vista**. De ahí que la
auditoría distinga error de desviación y las cuente.

## Los tiempos salen en reloj de ORIGEN

`silencios.py --aplicar` hace después el ÚNICO remapeo. Ese orden no es
opcional y la bitácora del ROADMAP lo documenta dos veces.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata

import comun
import reloj
from dirigir import CRISTAL

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige

# --------------------------------------------------------------------------
#  Los números de BRAND_RULES, en un sitio y con su sección
# --------------------------------------------------------------------------
# §13 · densidad
TARJETAS_POR_PIEZA = 4
DUR_TARJETA = (2.5, 3.5)
AIRE_ENTRE_TARJETAS = 12.0
# §15 · presupuesto de micro-FX, PROPORCIONAL a la pieza.
# Seis era la cifra de una pieza de 45 s —la de Codex, sobre la que se
# calibró— y aplicarla tal cual a una de 63 s no conserva la regla: la
# aprieta. Lo que §15 protege es la DENSIDAD, no el número: un acento cada
# 7,5 s de pieza. Por debajo de seis no baja, que es donde deja de haber
# gramática.
MAX_MICROFX = 6
SEGUNDOS_POR_MICROFX = 7.5


SEP_MICROFX = 7.0
AIRE_MICROFX = 0.6
# §12 · el cierre
CIERRE_ULTIMO_PCT = 0.15


def tope_microfx(dur: float) -> int:
    return max(MAX_MICROFX, int(round((dur or 0) / SEGUNDOS_POR_MICROFX)))

# §18 · la caja del subtítulo contra la zona que pinta la plataforma.
LIENZO = (1080, 1920)
# Lo que el bloque se pasa por debajo de su propio `bottom`: descendentes,
# tildes de la línea inferior y el filo del gesto. Medido con `colocar.py`
# sobre la pieza de Codex: con `bottom: 300` el borde inferior del alfa real
# salía a 1630 y no a 1620. No es holgura de diseño, es la diferencia entre
# la caja de maquetación y el píxel encendido, y por eso se resta aquí y no
# se «redondea» al gusto.
DESCENDENTE = 12


def caja_subtitulo(plataforma: str = None, lienzo: tuple = LIENZO) -> dict:
    """`fijoAbajo` y `anchoMax` en píxeles, derivados de la zona segura.

    Los subtítulos son el texto más leído de la pieza y estaban maquetados
    contra dos constantes: `bottom: 300` y una caja de 980 px. Medido sobre
    la pieza montada, el bloque ocupaba y 1430-1630 —171 px por debajo de
    donde arranca el caption, el usuario y el CTA— y se metía 130 px por
    detrás de la columna de likes. Nada de eso da error: sale un vídeo
    perfecto en el que la mitad del mensaje está tapada por la app.

    La banda ya se MEDÍA (`medir_zona_segura.py`, capturas reales) y el
    comprobador ya avisaba. Lo que faltaba era que el número llegase a quien
    escribe el plan, que es el único que puede hacer algo con él.

    `anchoMax` sale de que la caja está CENTRADA: para que su borde derecho
    no entre en la columna de iconos, el ancho no puede pasar del doble de
    lo que hay del centro a esa columna. Eso también protege el borde
    izquierdo, que no tiene banda pero sí simetría."""
    W, H = lienzo
    plataforma = plataforma or comun.PLATAFORMA_DEFECTO
    _, y_abajo, x_derecha, _ = comun.banda_plataforma(W, H, plataforma)
    return {
        "fijoAbajo": int(H - y_abajo + DESCENDENTE),
        "anchoMax": int(2 * x_derecha - W),
    }


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower())
                   if unicodedata.category(c) != "Mn")


def limpia(s: str) -> str:
    return sin_tildes(s).strip(".,;:!?¿¡…\"'()")


def _con_duracion(config: dict | None, dur: float) -> dict:
    """`duration` PRIMERO en la config, y no añadida al final.

    Es cosmético pero tiene un efecto real: el orden de las claves es el que
    sale al fichero, así que ponerla al final cambiaba el JSON byte a byte sin
    cambiar nada del contenido. Un diff que se mueve por eso enseña ruido
    donde no hay cambios, y los goldens dejarían de coincidir sin motivo.

    La plantilla usa `config.duration` para calcular su salida, así que la
    duración que manda es la de la capa: se escribe aquí y no se acepta otra.
    """
    fuera = {"duration": round(dur, 3)}
    for k, v in (config or {}).items():
        if k != "duration":
            fuera[k] = v
    return fuera


# --------------------------------------------------------------------------
class Guion:
    """Busca instantes por la palabra a la que la escaleta los ancla.

    Se llama `Guion` y no `Reloj` a propósito: `reloj.py` es el módulo del
    contrato origen→salida, y tener dos cosas con el mismo nombre haciendo
    trabajos distintos es como se confunden.
    """

    def __init__(self, palabras: list):
        self.p = palabras

    def _idx(self, texto: str, desde: float = 0.0) -> int:
        objetivo = limpia(texto)
        for i, w in enumerate(self.p):
            if w["start"] >= desde and limpia(w["w"]) == objetivo:
                return i
        cerca = [w["w"] for w in self.p
                 if objetivo[:4] and objetivo[:4] in limpia(w["w"])][:5]
        raise SystemExit(
            "no encuentro la palabra «%s» a partir de %.2f s.\n"
            "  El guion y la grabación no coinciden. %s\n"
            "  Revisa build/timeline.json y compara con lo que se dijo."
            % (texto, desde,
               "¿Querías una de estas? %s" % ", ".join(cerca) if cerca
               else "Ninguna palabra se le parece."))

    def ini(self, texto: str, desde: float = 0.0) -> float:
        return float(self.p[self._idx(texto, desde)]["start"])

    def fin(self, texto: str, desde: float = 0.0) -> float:
        return float(self.p[self._idx(texto, desde)]["end"])

    def existe(self, texto: str, desde: float = 0.0) -> bool:
        try:
            self._idx(texto, desde)
            return True
        except SystemExit:
            return False


# --------------------------------------------------------------------------
# Conectores: marcar «*sin subir nada a la nube*» no puede convertir «a» y
# «sin» en palabras con carga. La plantilla ya lo protege por construcción
# —`const clave = !enlace && ...`, o sea que un conector nunca es clave— y esta
# lista existe solo para que el INFORME diga la verdad sobre qué se resaltó.
#
# Si las dos divergen manda la plantilla, y el informe se queda generoso, que
# es el lado seguro del error: dice que resaltó de más, nunca de menos.
ENLACES = {
    "a", "ante", "bajo", "con", "contra", "de", "del", "desde", "durante",
    "en", "entre", "hacia", "hasta", "para", "por", "segun", "según", "sin",
    "sobre", "tras", "y", "e", "o", "u", "ni", "que", "se", "le", "la", "el",
    "los", "las", "un", "una", "unos", "unas", "al", "lo", "su", "sus", "es",
    "son", "pero", "como", "cuando", "si", "ya", "mas", "más", "muy",
}

# Niveles de DINÁMICA del subtítulo (`subtitulos(dinamica=N)`): paquetes
# curados de las claves nuevas de `kinetic-captions.html`. Un número y no
# cinco claves sueltas porque el 95 % de los usos es «más vivo» o «menos
# vivo», no un ajuste fino; el dict crudo sigue abierto para el resto
# (`dinamica={"gestos": True}`) y `**config` sigue mandando sobre ambos.
# El 0 no está: dinámica cero es no pasar nada, y la plantilla con sus
# defaults es píxel-idéntica a como era antes de existir esto.
DINAMICA = {
    1: {"gestos": True, "popPalabra": 0.04},
    2: {"gestos": True, "popPalabra": 0.06, "popClave": 0.10,
        "vaiven": 10, "cuerpoClave": 0.08},
    3: {"gestos": True, "popPalabra": 0.06, "popClave": 0.12,
        "vaiven": 16, "cuerpoClave": 0.12},
}

# El estilo FIJADO de esta marca (agosto 2026): el nivel 3 que se aprobó
# mirando `renders/captions-dinamica-demo.mp4`, más la cascada y el
# micro-giro de la iteración siguiente. Es el DEFAULT de `subtitulos()`:
# quien no quiera dinámica la apaga con `dinamica=0`, y los planes ya
# escritos no cambian —un plan es un fichero, no una llamada—. Se itera
# EDITANDO este paquete, no creando el cuarto nivel.
DINAMICA["favorito"] = dict(DINAMICA[3], escalonado=0.05, giroClave=1.2)


class Escaleta:
    """Acumula la escaleta y escribe el plan, auditándolo antes."""

    def __init__(self, timeline: dict | str = None):
        ruta = None
        if timeline is None or isinstance(timeline, str):
            ruta = timeline or os.path.join(BUILD, "timeline.json")
            if not os.path.exists(ruta):
                raise SystemExit(
                    "falta %s\n  lo produce:  "
                    ".venv/bin/python scripts/clean_transcript.py" % ruta)
            timeline = json.load(open(ruta, encoding="utf-8"))
        self.tl, self.ruta_tl = timeline, ruta

        reloj.exige_reloj(self.tl, "origen", "escaleta.py",
                          ".venv/bin/python scripts/clean_transcript.py")
        if not self.tl.get("words"):
            raise SystemExit("el timeline no tiene palabras")

        self.g = Guion(self.tl["words"])
        self.fin_pieza = float(self.tl["keep"][-1]["src_end"])
        self.actos: list[tuple[str, float, float]] = []
        self.tarjetas: list[dict] = []
        # El CROMO va aparte de las tarjetas. Una transición no es un
        # gráfico de contenido: no dice nada, separa. Metida en `tarjetas`
        # la auditoría de §13 le exige 2,5-3,5 s de duración y 12 s de aire
        # con la vecina, que son reglas escritas para lo que el espectador
        # LEE. Es la misma distinción que ya hace `dirigir.CROMO`.
        self.cromo: list[dict] = []
        self.microfx: list[dict] = []
        self.subs: dict | None = None
        self.omitir: list[tuple[float, float]] = []
        self.camara: list[tuple[float, float, float]] = []

    # ---------------------------------------------------------------- actos
    def acto(self, nombre: str, desde: str, hasta: str = None,
             desde_seg: float = None) -> tuple[float, float]:
        ini = self.g.ini(desde, desde=desde_seg or 0.0)
        fin = self.g.fin(hasta, desde=ini) if hasta else self.fin_pieza
        self.actos.append((nombre, ini, fin))
        return ini, fin

    # ------------------------------------------------------------ gráficos
    def tarjeta(self, capa: str, template: str, dur: float,
                ancla: str = None, t: float = None, desde: float = 0.0,
                desfase: float = 0.0, **extra) -> dict:
        """Una tarjeta de acto. `ancla` es la palabra; `desfase` la separación
        respecto a su inicio, en segundos, que es lo único que se escribe a
        mano y lo único que tiene sentido escribir así."""
        if t is None:
            if ancla is None:
                raise ValueError("una tarjeta necesita `ancla` o `t`")
            t = round(self.g.ini(ancla, desde=desde) + desfase, 3)
        c = dict(capa=capa, template=template, t=round(t, 3),
                 duracion=round(dur, 3), _ancla=ancla)
        c.update(extra)
        c["config"] = _con_duracion(extra.get("config"), dur)
        # Refracción real para las plantillas que llevan `.cristal` en su
        # marcado. Se pone SOLA porque olvidarla no da error: la plantilla se
        # captura sobre alfa vacío, su cristal queda en una pastilla gris y
        # nada lo dice. Lleva así desde la tanda 9. Se puede desactivar con
        # `cristal=False` para una capa concreta.
        if "cristal" not in c:
            base = template.replace(".html", "")
            if base in CRISTAL:
                c["cristal"] = True
                c.update(CRISTAL[base])
        elif c.get("cristal") is False:
            c.pop("cristal")
        self.tarjetas.append(c)
        return c

    def microfx_en(self, capa: str, template: str, dur: float,
                   ancla: str, desde: float = 0.0, desfase: float = 0.0,
                   **extra) -> dict:
        """Un micro-FX: carril aparte y presupuesto aparte (§15). Si entrara en
        el reparto de actos volveríamos al problema que ese reparto resolvió."""
        t = round(self.g.ini(ancla, desde=desde) + desfase, 3)
        c = dict(capa=capa, template=template, t=t, duracion=round(dur, 3),
                 _ancla=ancla)
        c.update(extra)
        c["config"] = _con_duracion(extra.get("config"), dur)
        self.microfx.append(c)
        return c

    def transicion(self, capa: str = "transicion",
                   template: str = "transicion.html",
                   en: str = None, t: float = None, desfase: float = 0.0,
                   modo: str = "barrido", color: str = "solida",
                   marca: str = None, dur: float = 0.6,
                   riser: bool = True, **extra) -> dict:
        """Una hoja que cruza la pantalla en la frontera de dos actos.

        Existe por un hueco medido: `cortes`, `flashEn` y `riser` **no
        aparecen ni una vez** en un plan real, así que toda la maquinaria de
        `render_playwright.js:396-423` —el mapa de sonidos por modo, la
        calibración de los impactos a 1,7, la colocación anticipada del riser y
        hasta su aviso de descarte— está escrita, es correcta y **no se ejecuta
        nunca**. El ROADMAP llama al riser «el efecto que más se nota que
        falta» y lleva desde entonces sin sonar.

        La causa no era el audio: `cortes` es una clave de `transicion.html` y
        NADIE instanciaba esa plantilla. Faltaba el productor, no el consumidor.

        `riser=True` pide que el corte se ANUNCIE. El riser dura 1,8 s y se
        coloca por delante, así que hace falta ese aire antes de la frontera;
        si no lo hay, el renderizador lo descarta con aviso —medio riser suena
        a error de montaje, no a tensión—. Medido sobre la pieza real, las tres
        fronteras dejan 6,13, 12,21 y 16,48 s libres: caben las tres.
        """
        if t is None:
            if en is None:
                raise ValueError("una transición necesita `en` (palabra) o `t`")
            t = round(self.g.ini(en) + desfase, 3)
        # El corte va DENTRO de la hoja, no al principio: la hoja entra, cruza
        # y sale, y el instante que se sonoriza es cuando tapa del todo.
        at = round(dur * 0.5, 3)
        corte = {"at": at, "dur": dur, "modo": modo, "color": color,
                 "riser": bool(riser)}
        if marca:
            corte["marca"] = marca
        c = dict(capa=capa, template=template, t=round(t - at, 3),
                 duracion=round(dur * 2, 3), _ancla=en)
        c.update(extra)
        cfg = dict(extra.get("config") or {})
        cfg["cortes"] = [corte]
        c["config"] = _con_duracion(cfg, dur * 2)
        self.cromo.append(c)
        return c

    def subtitulos(self, capa: str = "kineticcaptions",
                   template: str = "kinetic-captions.html",
                   claves: set | None = None, guion: str | None = None,
                   omitir: list | None = None,
                   dinamica: int | str | dict = "favorito",
                   **config) -> dict:
        """§12: `kinetic-captions` sustituye a `karaoke-subs` en todo plan nuevo.

        LA POLÍTICA: subtítulo sobre TODA la voz. `palabras` lleva la pieza
        entera y la plantilla decide qué grupo enseña en cada instante. Lo
        único que se quita es lo que NO SE OYE —lo que el montaje corta, ver
        `_ajusta_subtitulos`— y los tramos que la escaleta mande callar con
        `omitir=[(ini, fin)]`, en reloj de origen. En vertical y con el sonido
        apagado el subtítulo no es una ayuda: es la mitad del mensaje.

        --- `ventanas` NO ES DÓNDE SALEN LOS SUBTÍTULOS ---

        Es dónde se CLAVAN. Se deriva de las tarjetas y no se pasa a mano:
        mientras una tarjeta ocupa la pantalla los subtítulos bajan a la franja
        fija, renuncian al gesto grande y dejan de rebotar, porque dos capas
        compitiendo por la mirada estropean las dos. Fuera de las ventanas
        salen igual, en la zona de siempre y con su deriva.

        Leerlo al revés costó un diagnóstico entero, y por eso está escrito
        aquí: se contaron las palabras que caen FUERA de las ventanas —50 de
        las 105 de la pieza de Codex, el 48 %, con un tramo de 24,74 a 38,14 s
        sin ninguna ventana— y se dio por hecho que ese 48 % salía sin
        subtítulo. Sale con subtítulo. Medido sobre `build/plan.json` con
        `cobertura()`: 105 de 105 palabras y el 100 % del tiempo de voz. Y
        mirado, que es lo que manda: `build/frames/kineticcaptions/00900.png`
        —t = 30 s, en mitad del tramo supuestamente mudo— enseña «TUS PRS y»
        en pantalla. Lo que la ventana cambia ahí es la banda y la amplitud de
        la deriva, no la presencia.

        La cobertura ya no se cree: `escribir()` la MIDE con `cobertura()` y
        avisa por `stderr` si baja de `COBERTURA_MINIMA`.

        --- QUÉ PALABRAS VAN RESALTADAS ---

        Con `guion=` se marcan EN EL PROPIO TEXTO, entre asteriscos:

            e.subtitulos(guion='''
                Auditar la *seguridad* de tu código cuesta miles de *dólares*.
                *Codex Security* lo hace gratis y en tu máquina.
            ''')

        Es la misma marca que ya usa `kicker-hud` para su resaltado, así que
        quien escribe el guion no aprende una convención nueva. Y admite varias
        palabras seguidas dentro de un par de asteriscos.

        Con `claves=` se pasa un conjunto suelto. Las dos se pueden combinar.

        --- por qué importa quién las elige ---

        Hasta la tanda 17 la lista estaba escrita a mano en `plan_codex.py`, o
        sea que el énfasis lo decidía quien montaba y no quien escribió el
        guion. Y el guion es el único sitio donde se sabe qué palabra CARGA la
        frase: desde fuera solo se puede adivinar por frecuencia o por longitud,
        que es como se resalta «automáticamente» en vez de «vulnerabilidades».

        No es cosmético: la palabra marcada sale un 16 % mayor, en el acento y
        cien puntos de peso por encima, o sea que decide dónde mira el
        espectador en cada línea.
        """
        claves = {limpia(x) for x in (claves or set())}
        if guion:
            for tramo in re.findall(r"\*([^*]+)\*", guion):
                for pal in tramo.split():
                    p = limpia(pal)
                    if p and p not in ENLACES:
                        claves.add(p)
        cfg = {
            "duration": round(self.fin_pieza, 3),
            # `tam` 92 → 78, un 15 % menos. Medido sobre una pieza real
            # DENTRO de Instagram, que es el único sitio donde la pregunta
            # se responde: la caja alta del subtítulo salía a 87 px de
            # pantalla, 2,2 veces el copy de la propia app y casi 3 veces su
            # nombre de usuario. Se leía de sobra —no era un problema de
            # legibilidad— pero una sola palabra llenaba media pantalla y
            # tres se iban a tres líneas, justo lo que empuja la caja hacia
            # la banda que tapa la interfaz. A 78 queda en ~1,9 veces el
            # copy de la app y el bloque cabe en dos líneas.
            #
            # Es el cuerpo BASE, no un techo: una palabra clave sube su
            # tamaño por encima de esto (`.w.clave` la lleva a 1,16em) y una
            # plantilla de énfasis puede pedir el que quiera.
            "zona": "abajo", "tam": 78, "max": 3, "huecoMax": 0.42,
            "pop": 0.1,
            # La caja del subtítulo, DERIVADA de la zona que pinta la app.
            # Ver `caja_subtitulo`: los 300 px de antes eran una constante y
            # la medición decía, en cada pieza, que 171 px del bloque caían
            # debajo del caption y 130 px por detrás de la columna de iconos.
            **caja_subtitulo(),
            # `energia` viaja con la palabra si `medir_energia.py` la puso.
            # SIEMPRE, no solo con `dinamica`: sin efectos encendidos es
            # inerte —no es clave de primer nivel, el lint no la ve— y así
            # subir la dinámica después no obliga a reescribir el plan dos
            # veces.
            "palabras": [{"w": w["w"], "ini": w["start"], "fin": w["end"],
                          **({"energia": w["energia"]} if "energia" in w
                             else {})}
                         for w in self.tl["words"]],
            "ventanas": [{"ini": c["t"], "fin": round(c["t"] + c["duracion"], 3)}
                         for c in sorted(self.tarjetas, key=lambda c: c["t"])],
            "clave": sorted({w["w"] for w in self.tl["words"]
                             if limpia(w["w"]) in claves}),
        }
        # La dinámica se funde ANTES que `config`: el llamador sigue mandando
        # sobre cualquier clave del paquete. El default es el FAVORITO de la
        # marca; `dinamica=0` lo apaga y deja el config de siempre.
        if dinamica:
            if isinstance(dinamica, dict):
                cfg.update(dinamica)
            elif dinamica in DINAMICA:
                cfg.update(DINAMICA[dinamica])
            else:
                raise SystemExit(
                    "dinamica=%r no existe: niveles %s o un dict con las "
                    "claves de kinetic-captions.html"
                    % (dinamica, sorted(DINAMICA, key=str)))
        cfg.update(config)
        # Los tramos a callar se guardan APARTE y no en la config: la plantilla
        # no tiene una clave para «aquí no hay subtítulo» —lo que no está en
        # `palabras` no se dibuja— y meterlos dentro los dejaría como una clave
        # muerta que el lint reclamaría. Se aplican en `escribir()`, que es
        # donde ya se sabe qué metraje sobrevive.
        self.omitir = [(float(a), float(b)) for a, b in (omitir or [])]
        self.subs = dict(capa=capa, template=template, t=0.0,
                         duracion=round(self.fin_pieza, 3), config=cfg)
        return self.subs

    def plano(self, hasta: float | str, zoom: float, desde: float | str = None):
        """Un tramo de cámara (§11). Se acumulan en orden y el hueco entre uno
        y el siguiente se rellena solo, así que basta con dar las fronteras."""
        def seg(v):
            if isinstance(v, str):
                return self.g.ini(v)
            return float(v)
        ini = seg(desde) if desde is not None else (
            self.camara[-1][1] if self.camara else 0.0)
        self.camara.append((round(ini, 3), round(seg(hasta), 3), float(zoom)))

    # ------------------------------------------------------------ auditoría
    def auditar(self) -> tuple[list, list]:
        return auditar(self.tarjetas, self.microfx, self.fin_pieza,
                       len(self.actos) or TARJETAS_POR_PIEZA)

    # -------------------------------------------------------------- escribir
    def keep_con_camara(self) -> list:
        """Interseca los tramos de cámara con los `keep` que ya haya.

        Reemplazarlos descartaba el recorte que `clean_transcript.py` acababa de
        calcular. Salía bien de milagro porque `silencios.py` vuelve a medir el
        audio, pero un recorte que solo supiera el timeline —una toma falsa
        detectada por Levenshtein, que el audio no delata— se perdía en
        silencio."""
        if not self.camara:
            return self.tl["keep"]
        tramos = list(self.camara)
        if tramos[-1][1] < self.fin_pieza - 0.01:
            tramos.append((tramos[-1][1], round(self.fin_pieza, 3),
                           tramos[-1][2]))

        piezas = []
        for k in self.tl["keep"]:
            s0, s1 = float(k["src_start"]), float(k["src_end"])
            for a, b, z in tramos:
                x, y = max(s0, a), min(s1, b)
                if y - x >= 0.20:
                    piezas.append([x, y, z])
        piezas.sort()
        fuera, cursor = [], 0.0
        for x, y, z in piezas:
            fuera.append({"src_start": round(x, 3), "src_end": round(y, 3),
                          "out_start": round(cursor, 3),
                          "out_end": round(cursor + (y - x), 3), "zoom": z})
            cursor += y - x

        # Los tramos de cámara no son «dónde hay zoom»: son lo que SOBREVIVE a
        # la intersección. Un hueco entre dos tramos borra del montaje todo lo
        # que caiga dentro, y no lo delata nadie —el plan sigue siendo válido,
        # el alfa correcto y el vídeo se compone—. Escribiendo `plano` solo
        # para los actos con primer plano, una pieza pasó de 45,2 s a 12,9 s y
        # solo se vio al mirar la duración del fichero.
        antes = sum(float(k["src_end"]) - float(k["src_start"])
                    for k in self.tl["keep"])
        if antes > 0 and cursor < antes * 0.9:
            huecos = [(round(a[1], 2), round(b[0], 2))
                      for a, b in zip(tramos, tramos[1:]) if b[0] - a[1] > 0.2]
            print(
                "  AVISO: los tramos de cámara dejan fuera %.1f s de los %.1f s"
                " que había (%.0f %%).\n"
                "    Un `plano` no marca dónde hay zoom: marca lo que SE "
                "CONSERVA.\n"
                "    Falta un tramo por cada trozo que quieras en el montaje, "
                "con zoom 1.0 si no lleva.%s"
                % (antes - cursor, antes, 100 * (1 - cursor / antes),
                   "\n    Huecos sin cámara: " + ", ".join(
                       "%.1f→%.1f s" % h for h in huecos) if huecos else ""),
                file=sys.stderr)
        return fuera

    def plan(self) -> list:
        """§15: los micro-FX van POR ENCIMA de las tarjetas y POR DEBAJO de los
        subtítulos. El orden de la lista es el de composición."""
        capas = list(self.tarjetas) + list(self.cromo) + list(self.microfx)
        if self.subs:
            capas.append(self.subs)
        # `_ancla` es documentación de la escaleta, no del plan: se quita para
        # que el lint no la vea como una clave de config muerta.
        return [{k: v for k, v in c.items() if not k.startswith("_")}
                for c in capas]

    def _ajusta_subtitulos(self, keep: list) -> None:
        """Deja en `palabras` lo que DE VERDAD se oye, y mide la cobertura.

        Se hace aquí y no en `subtitulos()` porque los `plano` se escriben
        DESPUÉS —`plan_codex.py` y `leer_guion.py` los dos llaman así— y el
        metraje que sobrevive no se sabe hasta que la cámara ha intersecado.

        Qué se quita y por qué:

        - **Lo que el montaje corta.** Una toma falsa que `clean_transcript.py`
          descarta por Levenshtein sigue en `timeline.words`, y esas palabras
          no se oyen nunca. Dejarlas no es inocuo: la agrupación de la
          plantilla es SECUENCIAL, así que un grupo de tres puede llevar la
          última palabra buena y dos de la toma descartada, y entonces se lee
          en pantalla texto que no está en el audio. Y después de
          `silencios.py --aplicar` todas colapsan al mismo instante —`Mapa`
          lleva al borde lo que cae en un hueco—, con lo que el grupo nace con
          `ini == corte` y no se dibuja jamás. Ninguna de las dos cosas da
          error en ningún paso.
        - **Lo que la escaleta manda callar** con `omitir`. Es la excepción
          declarada a «subtítulo sobre toda la voz», y existe para que el aviso
          de cobertura no grite en falso: una puerta que grita en falso se
          desactiva, y se lleva por delante los avisos buenos.
        """
        cfg = self.subs["config"]
        tramos = [(float(k["src_start"]), float(k["src_end"])) for k in keep]

        def suena(w: dict) -> bool:
            a, b = float(w["ini"]), float(w["fin"])
            if not any(min(b, y) - max(a, x) > 0 for x, y in tramos):
                return False
            d = max(b - a, 1e-6)
            return not any((min(b, y) - max(a, x)) / d >= 0.5
                           for x, y in self.omitir)

        antes = cfg.get("palabras") or []
        cfg["palabras"] = [w for w in antes if suena(w)]
        fuera = [w["w"] for w in antes if not suena(w)]
        if fuera:
            print("  subtítulos: %d palabra(s) fuera del montaje o en un tramo "
                  "`omitir`; no se subtitulan porque no se oyen: %s"
                  % (len(fuera), " ".join(fuera[:12])
                     + (" …" if len(fuera) > 12 else "")), file=sys.stderr)

        c = cobertura(cfg)
        if c["palabras"] and c["pct"] < COBERTURA_MINIMA:
            print("  AVISO: solo el %.0f %% de las palabras lleva subtítulo "
                  "mientras se dice (%d de %d), y el %.0f %% del tiempo de voz."
                  "\n    Con el sonido apagado eso es lo que se pierde del "
                  "mensaje. Mira `max` y `huecoMax` en la config de «%s».\n"
                  "    Sin subtítulo: %s"
                  % (100 * c["pct"], c["con_subtitulo"], c["palabras"],
                     100 * c["pct_tiempo"], self.subs["capa"],
                     " ".join(c["mudas"][:12])
                     + (" …" if len(c["mudas"]) > 12 else "")),
                  file=sys.stderr)

    def escribir(self, destino: str = None, timeline: str = None) -> dict:
        destino = destino or os.path.join(BUILD, "plan.json")
        # El keep definitivo va ANTES de armar el plan: los subtítulos se
        # ajustan contra él y `plan()` comparte el mismo objeto de config.
        self.tl["keep"] = self.keep_con_camara()
        if self.subs:
            self._ajusta_subtitulos(self.tl["keep"])
        plan = self.plan()
        # `duration_final` se RECALCULA. Al intersecar los tramos de cámara se
        # descartan los trozos de menos de 0,20 s —no son un plano—, así que la
        # suma cambia y el valor que dejó `clean_transcript.py` se queda viejo.
        # `silencios.py` lo corregía después, pero entre los dos pasos el
        # timeline quedaba internamente incoherente: 38,645 declarados frente a
        # 38,485 reales. Lo cazó la comprobación de contratos.
        self.tl["duration_final"] = round(reloj.Mapa(self.tl["keep"]).duracion(), 3)

        # Los ACTOS se guardan, y hasta ahora no se guardaban en ninguna parte:
        # vivían solo en `informe()`, que se imprime por pantalla y se pierde.
        # O sea que la estructura narrativa de la pieza —lo único que sabe
        # dónde está el gancho y dónde el cierre— no llegaba a ningún paso
        # posterior. El compositor no puede saber en qué acto está, y por eso
        # la música de fondo no puede seguir la pieza.
        #
        # Van en RELOJ DE SALIDA, que es el único sitio donde tienen sentido
        # para quien compone: las anclas por palabra son de origen y aquí ya
        # se han resuelto. Se marca explícitamente para que nadie tenga que
        # adivinarlo — es la regla del reloj aplicada a un dato nuevo.
        if self.actos:
            mapa = reloj.Mapa(self.tl["keep"])
            self.tl["actos"] = {
                "reloj": "salida",
                "tramos": [{"nombre": n,
                            "ini": round(mapa(a), 3),
                            "fin": round(mapa(b), 3)}
                           for n, a, b in self.actos],
            }
        json.dump(self.tl, open(timeline or self.ruta_tl or
                                os.path.join(BUILD, "timeline.json"),
                                "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        json.dump(plan, open(destino, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        # Un plan NUEVO deja obsoleta la instantánea de origen del ANTERIOR.
        # `silencios.py --aplicar` re-deriva SIEMPRE de plan.origen.json, así
        # que si nadie la retira puede re-derivar del origen de OTRA pieza:
        # pasó — convivían plan.origen.json y copias de conflicto de montajes
        # distintos, y la comparación de silencios no lo cazaba. Se retira
        # SOLO aquí, al escribir un plan nuevo; hacerlo desde silencios.py
        # rompería la idempotencia que ese paso documenta (guarda la
        # instantánea la primera vez y re-deriva siempre de ahí).
        # El nombre se DERIVA del destino con la misma regla que usa
        # silencios.py (splitext + «.origen.json»): con un destino no
        # estándar (otra.json), un nombre fijo retiraría plan.origen.json y
        # dejaría viva otra.origen.json — la instantánea equivocada.
        origen = os.path.splitext(destino)[0] + ".origen.json"
        if os.path.exists(origen):
            os.remove(origen)
            print("plan nuevo: se retira %s; silencios.py --aplicar hará "
                  "instantánea fresca" % origen, file=sys.stderr)
        return {"plan": destino, "capas": len(plan)}

    # --------------------------------------------------------------- informe
    def informe(self) -> dict:
        keep = self.keep_con_camara()
        return {
            "duracion_pieza": round(self.fin_pieza, 2),
            "actos": {n: [round(a, 2), round(b, 2)] for n, a, b in self.actos},
            "tarjetas": [[c["capa"], c["t"], c["duracion"],
                          c.get("_ancla")] for c in self.tarjetas],
            "microfx": [[c["capa"], c["t"], c["duracion"],
                         c.get("_ancla")] for c in self.microfx],
            "tramos_camara": [[k["src_start"], k["src_end"], k["zoom"]]
                              for k in keep],
            "identidad_reloj": reloj.Mapa(keep).es_identidad(),
            "palabras_clave": self.subs["config"]["clave"] if self.subs else [],
        }


# --------------------------------------------------------------------------
#  COBERTURA DE SUBTÍTULOS
# --------------------------------------------------------------------------
# Los números con los que `kinetic-captions.html` agrupa, repetidos aquí con
# su línea. No se pueden importar —la plantilla es JS— y la alternativa era no
# medir: sin reproducir la regla, «los subtítulos salen» es una creencia y no
# un dato. Si allí cambian, esto miente; de ahí la referencia exacta.
COLA_GRUPO = 0.06        # kinetic-captions.html:342  const COLA
MAX_PALABRAS = 3         # kinetic-captions.html:430  defaults.max
HUECO_MAX = 0.42         # kinetic-captions.html:431  defaults.huecoMax
# Cuánto de una palabra tiene que estar en pantalla MIENTRAS se dice para
# contarla como subtitulada. La mitad, y no el 100 %: la cola de un grupo se
# recorta contra el siguiente, así que exigir el total marcaría como muda
# cualquier palabra que ceda 20 ms a la de después.
VISTA_MINIMA = 0.5
COBERTURA_MINIMA = 0.98

_PUNTUACION = re.compile(r"[.,;:!?]$")


def grupos_subtitulo(palabras: list, max_pal: int = MAX_PALABRAS,
                     hueco_max: float = HUECO_MAX) -> list:
    """Los grupos que `kinetic-captions.html` formará, y cuándo está cada uno
    en pantalla: `[{ini, corte, palabras}]`.

    Es la agrupación de su `setup` —corta al llegar al tope, en puntuación
    fuerte o si la pausa supera `huecoMax`— más el recorte de la cola contra el
    grupo siguiente (`corte`), que es lo que evita que dos grupos compartan
    banda durante 0,06 s. Función pura: la usan `Escaleta.escribir()` y las
    pruebas.
    """
    bloques, act = [], []
    for i, p in enumerate(palabras):
        act.append(p)
        sig = palabras[i + 1] if i + 1 < len(palabras) else None
        if (len(act) >= max_pal
                or _PUNTUACION.search(str(p["w"]).strip())
                or sig is None
                or (float(sig["ini"]) - float(p["fin"])) > hueco_max):
            bloques.append(act)
            act = []
    if act:
        bloques.append(act)

    grupos = [{"ini": float(b[0]["ini"]), "fin": float(b[-1]["fin"]),
               "palabras": b} for b in bloques]
    for i, g in enumerate(grupos):
        sig = grupos[i + 1] if i + 1 < len(grupos) else None
        g["corte"] = min(g["fin"] + COLA_GRUPO, sig["ini"]) if sig \
            else g["fin"] + COLA_GRUPO
    return grupos


def cobertura(config: dict) -> dict:
    """Qué parte de la voz lleva subtítulo EN PANTALLA mientras se dice.

    Un JSON con 105 palabras no prueba que se lea ninguna: lo que se ve es el
    grupo que la plantilla tiene puesto en ese instante. Aquí se cruzan las dos
    cosas —cuándo suena cada palabra y cuándo está su grupo— y sale el único
    número que describe el hueco: el porcentaje de voz sin subtítulo.
    """
    ws = config.get("palabras") or []
    grupos = grupos_subtitulo(ws, int(config.get("max") or MAX_PALABRAS),
                              float(config.get("huecoMax") or HUECO_MAX))
    vistas, voz, cubierto, mudas = 0, 0.0, 0.0, []
    for g in grupos:
        for p in g["palabras"]:
            a, b = float(p["ini"]), float(p["fin"])
            d = max(b - a, 1e-6)
            solape = max(0.0, min(b, g["corte"]) - max(a, g["ini"]))
            voz += b - a
            cubierto += solape
            if solape / d >= VISTA_MINIMA:
                vistas += 1
            else:
                mudas.append(str(p["w"]))
    return {
        "palabras": len(ws),
        "con_subtitulo": vistas,
        "pct": vistas / len(ws) if ws else 0.0,
        "grupos": len(grupos),
        "voz": round(voz, 3),
        "cubierto": round(cubierto, 3),
        "pct_tiempo": cubierto / voz if voz > 0 else 0.0,
        "mudas": mudas,
    }


# --------------------------------------------------------------------------
def auditar(tarjetas: list, microfx: list, fin_pieza: float,
            n_actos: int = TARJETAS_POR_PIEZA) -> tuple[list, list]:
    """Mide el plan contra §12, §13 y §15. Función pura: la usan el CLI y las
    pruebas.

    Devuelve `(errores, desviaciones)`. La distinción importa: que el aire
    entre tarjetas baje de 12 s puede ser una decisión —el acto 2 de la pieza
    de Codex es full-motion y en 44 s no caben las dos cosas—, mientras que
    repetir un micro-FX no lo es nunca.
    """
    errores, desv = [], []
    ts = sorted(tarjetas, key=lambda c: c["t"])
    ms = sorted(microfx, key=lambda c: c["t"])

    # --- §13 densidad ---
    if len(ts) != n_actos:
        desv.append("§13 · %d tarjeta(s) para %d actos: pide una por acto"
                    % (len(ts), n_actos))
    for c in ts:
        if not DUR_TARJETA[0] <= c["duracion"] <= DUR_TARJETA[1]:
            desv.append("§13 · «%s» dura %.2f s, fuera de %.1f-%.1f"
                        % (c["capa"], c["duracion"], *DUR_TARJETA))
    for a, b in zip(ts, ts[1:]):
        aire = round(b["t"] - (a["t"] + a["duracion"]), 2)
        if aire < 0:
            errores.append("§13 · «%s» y «%s» se solapan %.2f s"
                           % (a["capa"], b["capa"], -aire))
        elif aire < AIRE_ENTRE_TARJETAS:
            desv.append("§13 · %.2f s de aire entre «%s» y «%s» (mínimo %.0f)"
                        % (aire, a["capa"], b["capa"], AIRE_ENTRE_TARJETAS))

    # --- §15 presupuesto de micro-FX ---
    tope = tope_microfx(fin_pieza)
    if len(ms) > tope:
        errores.append("§15 · %d micro-FX, el tope es %d. Sin presupuesto, el "
                       "efecto pasa de subrayar a ser un tic del montaje."
                       % (len(ms), tope))
    vistos: dict[str, int] = {}
    for c in ms:
        vistos[c["template"]] = vistos.get(c["template"], 0) + 1
    for tpl, n in sorted(vistos.items()):
        if n > 1:
            errores.append("§15 · %s se usa %d veces; cada efecto va UNA vez. "
                           "El mismo destello tres veces deja de significar "
                           "algo." % (tpl, n))
    for a, b in zip(ms, ms[1:]):
        sep = round(b["t"] - a["t"], 2)
        if sep < SEP_MICROFX:
            desv.append("§15 · %.2f s entre «%s» y «%s» (mínimo %.0f)"
                        % (sep, a["capa"], b["capa"], SEP_MICROFX))

    # --- §15 aire alrededor de una tarjeta ---
    for m in ms:
        m0, m1 = m["t"], m["t"] + m["duracion"]
        for c in ts:
            c0, c1 = c["t"], c["t"] + c["duracion"]
            if m0 < c1 and c0 < m1:
                # Un micro-FX dentro de una tarjeta rompe el aire de §15, salvo
                # cuando es la composición pedida: la pieza de Codex superpone
                # el visor al tercer nodo del lienzo full-motion, y ahí no hay
                # cara que esquivar porque el lienzo la tapa. La forma de
                # declararlo es `colocar=False`, que es la misma marca que usa
                # `colocar.py` para no moverlo.
                deliberado = m.get("colocar") is False
                if not deliberado:
                    desv.append(
                        "§15 · «%s» cae DENTRO de «%s»; pide %.1f s de aire. "
                        "Si es a propósito, declara `colocar=False`."
                        % (m["capa"], c["capa"], AIRE_MICROFX))
                continue
            hueco = min(abs(m0 - c1), abs(c0 - m1))
            if hueco < AIRE_MICROFX:
                desv.append("§15 · «%s» a %.2f s de «%s» (pide %.1f)"
                            % (m["capa"], hueco, c["capa"], AIRE_MICROFX))

    # --- §12 el cierre ---
    for c in ts:
        if c["template"] not in ("cierre-cta.html", "engagement-cta.html"):
            continue
        if c["t"] < fin_pieza * (1 - CIERRE_ULTIMO_PCT):
            desv.append("§12 · «%s» empieza en %.2f y `cierre-cta` va en el "
                        "último %.0f %% (desde %.2f)"
                        % (c["capa"], c["t"], CIERRE_ULTIMO_PCT * 100,
                           fin_pieza * (1 - CIERRE_ULTIMO_PCT)))

    # --- que todo quepa ---
    for c in ts + ms:
        if c["t"] + c["duracion"] > fin_pieza + 0.05:
            errores.append("«%s» acaba en %.2f y la pieza dura %.2f"
                           % (c["capa"], c["t"] + c["duracion"], fin_pieza))
        if c["t"] < 0:
            errores.append("«%s» empieza en %.2f, negativo" % (c["capa"], c["t"]))

    return errores, desv


def informar(errores: list, desviaciones: list, microfx: int = 0) -> int:
    """Escribe la auditoría por stderr. Devuelve el código de salida.

    Las desviaciones NO son error: se ven y se decide. Esconderlas es lo que
    hacía que el plan pareciera cumplir §13 cuando no lo hacía.
    """
    if errores:
        print("\n-- errores de escaleta --", file=sys.stderr)
        for e in errores:
            print("  ✗ %s" % e, file=sys.stderr)
    if desviaciones:
        print("\n-- desviaciones (a la vista, no escondidas) --",
              file=sys.stderr)
        for d in desviaciones:
            print("  ⚠ %s" % d, file=sys.stderr)
    if microfx:
        print("\n  micro-FX usados: %d de %d (§15)"
              % (microfx, MAX_MICROFX), file=sys.stderr)
    if not errores and not desviaciones:
        print("\n-- escaleta conforme a §12, §13 y §15 --", file=sys.stderr)
    return 1 if errores else 0
