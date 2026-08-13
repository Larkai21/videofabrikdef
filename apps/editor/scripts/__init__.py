"""scripts/ expuesto como el paquete `editor` (ver pyproject.toml).

Este fichero existe SOLO para el empaquetado: los scripts del pipeline no lo
necesitan —se ejecutan como ficheros sueltos y se importan entre sí por
nombre plano tras un `sys.path.insert`— y un `__init__.py` no cambia nada de
eso: un directorio metido en `sys.path` expone sus módulos igual con él que
sin él. Lo que sí cambia es que `pip install -e .` puede servir `import
editor.reloj` sin mover un solo fichero.

El `sys.path` de abajo es el puente entre los dos mundos: los módulos de
este directorio se importan ENTRE SÍ por nombre plano (`contratos.py` hace
`import reloj`, no `from editor import reloj`), así que al entrar por
`import editor.contratos` ese `import reloj` tiene que poder resolverse.
Añadir el directorio aquí lo garantiza sin tocar los ~20 scripts existentes.
`append` y no `insert(0)`: los scripts que ya manipulan el path se ponen
delante a propósito, y este puente no debe disputarles la precedencia.

Consecuencia conocida y asumida en fase 1: `editor.reloj` y `reloj` son DOS
objetos módulo distintos si se importan por las dos vías en el mismo
proceso. Para constantes y funciones puras —que es lo que exportan estos
módulos— no importa; si algún día un `isinstance` cruza las dos vías, ahí
estará el porqué.
"""

import os as _os
import sys as _sys

_AQUI = _os.path.dirname(_os.path.abspath(__file__))
if _AQUI not in _sys.path:
    _sys.path.append(_AQUI)
