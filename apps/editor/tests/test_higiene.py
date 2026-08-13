"""Puerta de higiene: ningún `subprocess.run` sin mirar el código de salida.

El inventario que motivó esto: doce `subprocess.run` en `scripts/` no miraban
`returncode`, y tres estaban en el camino crítico de una pieza. El peor,
medido: `silencios_audio()` sobre una ruta inexistente devolvía `[]` sin una
palabra —la señal de silencios se apagaba entera— y el paso sellaba el
timeline y devolvía 0. Otro: un ffprobe fallido en `oro.py` congelaba
`dur: 0.0` en el golden, es decir, convertía el fallo en especificación.

La regla admite TRES formas honestas, y solo esas tres:

  · `comun.exige_ok(subprocess.run(...), ...)` cuando el fallo para el paso;
  · mirar `r.returncode` a mano cuando la función es una sonda cuyo contrato
    es devolver None/[] y el llamador decide (avisando por stderr: el fallo
    puede tolerarse, el silencio no);
  · el marcador `# fallo-tolerado: <motivo>` en la propia llamada, para el
    caso raro en que de verdad dé igual — y entonces el motivo queda escrito.

Es el mismo patrón que `comprobar_relojes.py`: una puerta, no un aviso. La
prueba FALLA nombrando fichero:línea hasta que cada llamada elija una forma.

Se localizan las llamadas con `ast` y no con una expresión regular porque las
de este repo son multilínea —el paréntesis cierra líneas después, a veces
dentro de un `exige_ok(...)` que empieza en otra línea— y contar paréntesis a
mano sobre argumentos llenos de filtros de ffmpeg es pedir falsos positivos.
"""

from __future__ import annotations

import ast
import glob
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# La comprobación puede venir unas líneas después de la llamada: el patrón
# real del repo es llamada multilínea + comentario de por qué + `if
# r.returncode`. Trece líneas cubren el caso más largo que hay hoy sin abrir
# tanto la ventana como para que valga el `returncode` de OTRA llamada.
VENTANA = 13

MARCADOR = "# fallo-tolerado:"
SENALES = ("check=", ".returncode", "exige_ok")


def _es_run(nodo) -> bool:
    return (isinstance(nodo, ast.Call)
            and isinstance(nodo.func, ast.Attribute)
            and nodo.func.attr == "run"
            and isinstance(nodo.func.value, ast.Name)
            and nodo.func.value.id == "subprocess")


def _es_exige_ok(nodo) -> bool:
    if not isinstance(nodo, ast.Call):
        return False
    f = nodo.func
    return ((isinstance(f, ast.Name) and f.id == "exige_ok")
            or (isinstance(f, ast.Attribute) and f.attr == "exige_ok"))


def _infractores(ruta: str) -> list[tuple[str, int]]:
    with open(ruta, encoding="utf-8") as f:
        fuente = f.read()
    lineas = fuente.splitlines()
    arbol = ast.parse(fuente, filename=ruta)

    # Un `subprocess.run` envuelto en `exige_ok(...)` cumple aunque la
    # palabra `exige_ok` esté en una línea ANTERIOR a la llamada, que la
    # ventana textual —solo hacia delante— no ve.
    envueltos = set()
    for nodo in ast.walk(arbol):
        if _es_exige_ok(nodo):
            for sub in ast.walk(nodo):
                if _es_run(sub):
                    envueltos.add(id(sub))

    malos = []
    for nodo in ast.walk(arbol):
        if not _es_run(nodo) or id(nodo) in envueltos:
            continue
        ini = nodo.lineno
        fin = nodo.end_lineno or ini
        llamada = "\n".join(lineas[ini - 1:fin])
        if MARCADOR in llamada:
            continue
        ventana = "\n".join(lineas[ini - 1:fin + VENTANA])
        if any(s in ventana for s in SENALES):
            continue
        malos.append((os.path.relpath(ruta, RAIZ), ini))
    return malos


def test_todo_subprocess_run_mira_el_codigo_de_salida():
    malos = []
    for ruta in sorted(glob.glob(os.path.join(RAIZ, "scripts", "*.py"))):
        malos.extend(_infractores(ruta))

    detalle = "\n".join("  ✗ %s:%d" % (f, n) for f, n in malos)
    assert not malos, (
        "%d subprocess.run sin mirar el código de salida:\n%s\n"
        "Elige la forma honesta para cada uno:\n"
        "  · envuélvelo:  r = exige_ok(subprocess.run(...), \"qué corría\", "
        "arregla=\"...\")\n"
        "  · o comprueba `r.returncode` a mano y AVISA por stderr antes de "
        "devolver el valor vacío\n"
        "  · o, si de verdad da igual, marca la línea con "
        "«# fallo-tolerado: <motivo>»"
        % (len(malos), detalle))
