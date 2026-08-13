#!/usr/bin/env python3
"""Utilidades compartidas. Solo biblioteca estándar, a propósito.

Este repo evita que un script importe a otro —`validar_plan.py` y
`composite_ffmpeg.py` comparten `ORDEN` leyéndolo de `guiones/capas.json`
en vez de importarse entre sí— y la razón sigue siendo la misma: «importar
un script arrastra sus dependencias y cada uno tiene que poder correr
solo». Ese motivo no aplica a un módulo que solo usa `os`, `shutil` y
`sys`. La alternativa era repetir la misma comprobación en diez ficheros,
que es como se desincronizan.
"""

from __future__ import annotations

import json
import os
import shutil
import sys

RAIZ_COMUN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _localiza_binario(nombre: str, var: str) -> str:
    """La resolución ÚNICA de ffmpeg/ffprobe: entorno > PATH > Homebrew.

    La variable de entorno manda SIEMPRE, aunque apunte a la nada: es la
    palanca del CI (que instala por apt y publica la ruta) y del arnés, que
    apaga ffmpeg a propósito con `FFMPEG_BIN=/no/existe` para probar los
    mensajes de error. Caer al PATH con la variable puesta rompería las dos
    cosas.

    Sin variable se pregunta al PATH, que es lo que hace portable el repo
    fuera de esta máquina; y el default de Homebrew queda de último respaldo
    porque en macOS el PATH de un proceso lanzado fuera de una shell (un
    hook de git, un editor) no siempre trae /opt/homebrew/bin.
    """
    valor = os.environ.get(var)
    if valor:
        return valor
    en_path = shutil.which(nombre)
    if en_path:
        return en_path
    return os.path.join("/opt/homebrew/bin", nombre)


FFMPEG = _localiza_binario("ffmpeg", "FFMPEG_BIN")
FFPROBE = _localiza_binario("ffprobe", "FFPROBE_BIN")

# Qué comando produce cada artefacto de `build/`. La tabla vive aquí y no
# repartida por los scripts para que el mensaje sea el mismo en todos: si
# `colocar.py` y `silencios.py` dan instrucciones distintas para el mismo
# fichero que falta, una de las dos está desactualizada.
PRODUCE = {
    "transcript.json": "scripts/transcribe_mlx.py --input <video>",
    "timeline.json":   "scripts/clean_transcript.py",
    "face.json":       "scripts/detect_face_bbox.py --input <video>",
    "plan.json":       "scripts/dirigir.py  (o el generador de escaleta de la pieza)",
    "layers.json":     "node scripts/render_playwright.js",
    "broll_plan.json": "scripts/generate_google_assets.py",
}


# (arriba, abajo, ancho_derecha, desde_y_derecha), en fracción del lado.
#
# Vivía dentro de `colocar.py`, que AVISA. Está aquí porque hace falta también
# donde se ESCRIBE el plan: mientras la tabla fue privada de un comprobador,
# los subtítulos se maquetaban contra una constante —`bottom: 300`— y la
# medición decía, pieza tras pieza, que 171 px del bloque caían debajo del
# caption, el usuario y el CTA que pinta la app. Avisar de un número que solo
# conoce el que avisa deja el arreglo siempre a mano.
#
# El comentario largo sobre cómo se midió cada fracción sigue en `colocar.py`,
# junto al informe que las enseña.
PLATAFORMAS = {
    "reels":   (0.12, 0.24, 0.12, 0.52),   # MEDIDO 4-ago-2026, capturas iPhone
    "tiktok":  (0.12, 0.22, 0.12, 0.52),   # estimado, sin medir
    "shorts":  (0.12, 0.22, 0.12, 0.52),   # estimado, sin medir
    "ninguna": (0.0, 0.0, 0.0, 1.0),
}
MEDIDAS = {"reels"}
PLATAFORMA_DEFECTO = "reels"


def banda_plataforma(W: int, H: int, plataforma: str) -> tuple:
    """`(y_arriba, y_abajo, x_derecha, y_desde_derecha)`: dónde pinta la app.

    Devuelve píxeles del lienzo para poder compararlos con las cajas, que ya
    están en píxeles. La fracción es lo que se declara; el píxel es un
    derivado de ella y del lado real, no un número escrito a mano."""
    arriba, abajo, derecha, desde = PLATAFORMAS[plataforma]
    return (int(round(H * arriba)), int(round(H * (1.0 - abajo))),
            int(round(W * (1.0 - derecha))), int(round(H * desde)))


def build_dir() -> str:
    """El directorio de trabajo de la pieza EN CURSO.

    Por defecto `build/`, y `EDITOR_BUILD` lo redirige. Existe para poder
    montar VARIAS piezas a la vez: `piezas.py` saca diez montajes de una
    grabación y con un solo `build/` había que hacerlos en serie, porque cada
    uno pisa el plan, el manifiesto y los fotogramas del anterior — que es
    justo lo que `comprobar_montaje.py` caza.

    La variable de entorno y no un argumento en cada script: `render_playwright
    .js` ya la respetaba, y quince scripts con un flag nuevo son quince sitios
    donde olvidarlo. Con el entorno, un proceso entero trabaja en su directorio
    sin que ninguna llamada tenga que acordarse.
    """
    d = os.environ.get("EDITOR_BUILD")
    return os.path.abspath(d) if d else os.path.join(RAIZ_COMUN, "build")


def resolver_manifiesto(man: dict, base: str | None = None) -> dict:
    """Devuelve una copia del manifiesto con `dir` y `mask` ABSOLUTOS.

    `render_playwright.js` escribe esas rutas RELATIVAS a la raíz del build
    (y la anota en la cabecera como `raiz`): con rutas absolutas dentro, un
    `build/` copiado o movido —o el mismo repo clonado en otra ruta— dejaba
    un manifiesto que apuntaba a los fotogramas de OTRA máquina.

    Retrocompatibilidad: un `layers.json` anterior trae rutas absolutas y se
    aceptan tal cual — los builds en curso y las fixtures no se regeneran
    solos, y rechazarlos rompería un montaje que funciona.

    `base` es el directorio del build (donde vive el propio manifiesto) y
    tiene prioridad sobre la `raiz` grabada: la raíz se escribió al
    renderizar, y si el build se ha movido desde entonces, el sitio REAL del
    manifiesto es la verdad y la cabecera el recuerdo.
    """
    base = base or man.get("raiz") or ""
    capas = []
    for c in man.get("capas") or []:
        c = dict(c)
        for clave in ("dir", "mask"):
            v = c.get(clave)
            if v and not os.path.isabs(v) and base:
                c[clave] = os.path.normpath(os.path.join(base, v))
        capas.append(c)
    fuera = dict(man)
    fuera["capas"] = capas
    return fuera


def carga_json(ruta: str, que: str | None = None):
    """Lee un JSON diciendo QUÉ falta y QUÉ comando lo produce.

    Antes, media docena de scripts hacía `json.load(open(args.plan))` a pelo y
    un fichero ausente salía como `FileNotFoundError` con la ruta absoluta y
    nada más. CLAUDE.md pide lo contrario, y quien ejecuta el paso 6b no tiene
    por qué saber que el plan lo escribe el paso anterior."""
    if not os.path.exists(ruta):
        pista = que or PRODUCE.get(os.path.basename(ruta))
        print("falta %s" % ruta, file=sys.stderr)
        if pista:
            print("  lo produce:  %s" % pista, file=sys.stderr)
        # `piezas.py` no monta en `build/` sino en `build/piezas/<id>/`, así
        # que tras montar las diez el `build/` de siempre no tiene plan y el
        # mensaje de arriba manda a rehacer un montaje que YA existe. Si hay
        # piezas, la respuesta no es producir nada: es decir cuál mirar.
        piezas = os.path.join(os.path.dirname(os.path.abspath(ruta)), "piezas")
        if os.path.isdir(piezas):
            ids = sorted(d for d in os.listdir(piezas)
                         if os.path.isdir(os.path.join(piezas, d)))
            if ids:
                print("  hay %d montaje(s) en build/piezas/ (%s).\n"
                      "  Para mirar uno:  EDITOR_BUILD=build/piezas/%s %s"
                      % (len(ids), ", ".join(ids[:6]) + ("…" if len(ids) > 6
                                                         else ""),
                         ids[0], " ".join(sys.argv[:1]) or "make rapido"),
                      file=sys.stderr)
        raise SystemExit(2)
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        # Un JSON truncado es lo que deja una ejecución interrumpida a mitad
        # de escritura, y el mensaje por defecto no dice de qué fichero habla.
        print("%s no es JSON válido: %s" % (ruta, e), file=sys.stderr)
        raise SystemExit(2)


def exige_ok(r, cmd: str, arregla: str | None = None):
    """Aborta si un subprocess terminó mal, enseñando la cola de su stderr.

    Existe por un inventario: doce `subprocess.run` en `scripts/` no miraban
    `returncode`, y tres estaban en el camino crítico de una pieza. El peor,
    medido: `silencios_audio()` sobre una ruta inexistente devolvía `[]` sin
    una palabra —la señal de silencios se apagaba entera— y el paso sellaba el
    timeline y devolvía 0. El propio fichero llama a esa etapa «la de mayor
    riesgo del pipeline, porque su fallo es invisible por definición».

    `cmd` es una descripción corta de lo que corría (para el mensaje);
    `arregla`, si se da, el comando que lo soluciona. Devuelve `r` para poder
    envolver la llamada: `r = exige_ok(subprocess.run(...), "ffmpeg …")`.

    Un sitio donde fallar sea PARTE del contrato —una sonda que devuelve None
    y su llamador decide— no usa esto: comprueba `returncode` a mano. La
    prueba de higiene (`tests/test_higiene.py`) acepta cualquiera de las dos
    formas; lo que no acepta es no mirar el código de salida en absoluto.
    """
    if r.returncode == 0:
        return r
    print("falló: %s (código %d)" % (cmd, r.returncode), file=sys.stderr)
    err = r.stderr or b""
    if isinstance(err, bytes):
        err = err.decode("utf-8", "replace")
    cola = [l for l in err.strip().splitlines() if l.strip()][-6:]
    for linea in cola:
        print("  | %s" % linea, file=sys.stderr)
    if arregla:
        print("  lo arregla:  %s" % arregla, file=sys.stderr)
    raise SystemExit(2)


def _existe(binario: str) -> bool:
    """Vale una ruta absoluta ejecutable o un nombre resoluble en el PATH."""
    if os.path.sep in binario:
        return os.path.isfile(binario) and os.access(binario, os.X_OK)
    return shutil.which(binario) is not None


def exige_ffmpeg(*cuales: str) -> None:
    """Aborta si falta alguno de los binarios, diciendo cómo arreglarlo.

    Sin esto, los diez scripts que invocan ffmpeg fallaban con un
    `FileNotFoundError: [Errno 2] ... '/opt/homebrew/bin/ffmpeg'` en el primer
    `subprocess.run`, que no dice qué instalar ni que la ruta se puede
    cambiar con una variable de entorno. CLAUDE.md pide lo contrario: «un
    paso que falle debe decir QUÉ falta y QUÉ COMANDO lo arregla».

    Se comprueba por adelantado y no capturando la excepción porque un script
    puede llamar a ffmpeg cincuenta veces —`hacer_sfx.py` lo hace por cada
    efecto— y descubrirlo en la número treinta deja el trabajo a medias.
    """
    faltan = []
    for nombre in (cuales or ("ffmpeg",)):
        ruta = {"ffmpeg": FFMPEG, "ffprobe": FFPROBE}[nombre]
        if not _existe(ruta):
            faltan.append((nombre, ruta))
    if not faltan:
        return

    var = {"ffmpeg": "FFMPEG_BIN", "ffprobe": "FFPROBE_BIN"}
    for nombre, ruta in faltan:
        print("falta %s: no hay nada ejecutable en %s" % (nombre, ruta),
              file=sys.stderr)
    print("\nArréglalo con una de estas dos:\n"
          "  brew install ffmpeg\n"
          "  %s\n"
          % "  ".join("%s=/ruta/a/%s" % (var[n], n) for n, _ in faltan),
          file=sys.stderr)
    raise SystemExit(2)
