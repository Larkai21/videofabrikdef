#!/usr/bin/env python3
"""Audita que `reloj.SEMANTICA` conozca todas las claves de tiempo del catálogo.

El fallo que esto evita ya pasó, y de la peor manera: la lista de claves de
tiempo de `silencios.py` se mantenía a mano —«si una plantilla nueva añade la
suya, va aquí»— y cubría 2 de las 12 que había. Las otras 10 no se remapeaban.
Añadir una plantilla con una clave de tiempo nueva y olvidarse de registrarla
producía subtítulos y efectos desplazados **sin un solo error en el log**.

Ahora la tabla se indexa por clave HOJA, que son 32 y no crecen con cada
plantilla, y este script comprueba que sigue completa. Si encuentra una
candidata sin clasificar, sale con 1 y dice el fichero, la línea y las dos
opciones. La auditoría FALLA hasta que alguien decida: es una puerta, no un
aviso.

**Por qué no se clasifica automáticamente.** No se puede, y conviene decirlo
en vez de fingir lo contrario. El idiom que usan las plantillas es

    span(t, fin - cfg.salida, cfg.salida, Ease.inOutCubic)

donde `cfg.salida` aparece en el hueco de POSICIÓN y en el de DURACIÓN, en 34
plantillas. Mirando el código no hay forma de saber cuál es. Lo que sí se
puede derivar es la LISTA de candidatas; el barrido propone y una persona
decide una vez, leyendo la firma `span(t, INICIO, DURACIÓN)`.

Uso:
    python3 scripts/comprobar_relojes.py
    python3 scripts/comprobar_relojes.py --plantillas otro/dir
"""

from __future__ import annotations

import argparse
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import reloj                                # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plantillas", default=reloj.PLANTILLAS)
    args = ap.parse_args()

    candidatas = reloj.claves_candidatas(args.plantillas)
    falta = {k: v for k, v in candidatas.items() if k not in reloj.SEMANTICA}

    pos = sorted(k for k, v in reloj.SEMANTICA.items() if v == "pos")
    dur = sorted(k for k, v in reloj.SEMANTICA.items() if v == "dur")
    print("tabla: %d claves hoja  ·  %d posiciones  ·  %d duraciones"
          % (len(reloj.SEMANTICA), len(pos), len(dur)))
    print("catálogo: %d claves candidatas en %s\n"
          % (len(candidatas), os.path.relpath(args.plantillas, RAIZ)))

    if not falta:
        print("  ✓ todas las candidatas están clasificadas")
        return 0

    for clave, sitios in sorted(falta.items()):
        print("  ✗ «%s» no está en reloj.SEMANTICA" % clave)
        for s in sitios[:4]:
            print("      templates/%s" % s)
        if len(sitios) > 4:
            print("      … y %d más" % (len(sitios) - 4))
        print("      Mira su uso: en `span(t, INICIO, DURACIÓN, ...)` el primer")
        print("      hueco es una POSICIÓN y el segundo una DURACIÓN. Después")
        print("      añade UNA de estas dos líneas a scripts/reloj.py:")
        print('          "%s": "pos",   # instante relativo -> se remapea' % clave)
        print('          "%s": "dur",   # duración o ritmo  -> no se remapea' % clave)
        print()

    print("%d clave(s) sin clasificar. Mientras estén así, `silencios.py` no "
          "las remapea\ny los gráficos de esas plantillas se desplazarán sin "
          "dar ningún error." % len(falta))
    return 1


if __name__ == "__main__":
    sys.exit(main())
