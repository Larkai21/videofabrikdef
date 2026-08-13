#!/usr/bin/env python3
"""El catálogo entero en JSON, para el agente que escribe guiones.

    python3 scripts/catalogo_json.py            # a pantalla
    python3 scripts/catalogo_json.py --escribir # a guiones/CATALOGO.json

`guiones/CONTRATO.md` es para leerlo una persona: explica el esquema, el
porqué de cada campo y qué aborta. Esto es lo mismo para una MÁQUINA — una
lista plana de qué se puede pedir y con qué claves — porque un agente que
tiene que elegir entre 182 plantillas no puede hacerlo leyendo prosa.

Se DERIVA, como el contrato: de `leer_guion` (qué es alcanzable y cómo se
llama), de las plantillas (qué claves lee cada una y cuánto dura su gesto) y
de `dirigir` (qué suena). Escribirlo a mano sería garantizar que se quede
viejo a la primera plantilla nueva.

Lo que el JSON dice de cada pieza, y por qué importa para escribir:

  · `copy`      — la ranura de `card_copy`. Si es `null`, el copy NO entra
                  por ahí: o va por `config`, o la pieza trae su texto y hay
                  que dárselo por `ranuras`.
  · `ranuras`   — para los bloques importados: qué clave de `config` escribe
                  qué texto. Sin esto, un bloque enseña la demo del
                  fabricante sobre tu pieza y nada avisa.
  · `config`    — las claves que la plantilla LEE de verdad. Una clave fuera
                  de esta lista es una clave muerta y `lint_config
                  --estricto` aborta el paso.
  · `gesto_s`   — cuánto dura su animación, MEDIDO al importarla. Es lo que
                  hay que darle de duración para que se vea entera.
  · `sonido`    — qué suena al entrar, deducido por la tabla del director.
  · `origen`    — «propia» o «hyperframes». No es trivia: las importadas
                  maquetan para 1920x1080 y llevan su propia paleta.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import dirigir       # noqa: E402
import leer_guion    # noqa: E402
import lint_config   # noqa: E402
import reloj         # noqa: E402

TPL = os.path.join(RAIZ, "templates")


def ranuras_de() -> dict:
    """Las ranuras de texto que declara el importador para un bloque."""
    ruta = os.path.join(RAIZ, "scripts", "importar_bloque.js")
    try:
        src = open(ruta, encoding="utf-8").read()
    except OSError:
        return {}
    m = re.search(r"const TEXTOS = \{(.*?)\n\};", src, re.S)
    if not m:
        return {}
    fuera = {}
    for linea in m.group(1).splitlines():
        mm = re.match(r"\s*'([^']+)':\s*\{(.+)\},", linea)
        if not mm:
            continue
        claves = re.findall(r"(\w+):\s*'([^']+)'", mm.group(2))
        fuera[mm.group(1) + ".html"] = {k: v for k, v in claves}
    return fuera


def gesto_de(tpl: str) -> float | None:
    try:
        src = open(os.path.join(TPL, tpl), encoding="utf-8").read()
    except OSError:
        return None
    m = re.search(r"var DUR = ([\d.]+);", src)
    return float(m.group(1)) if m else None


def claves_de(tpl: str) -> list:
    """Las claves que la plantilla LEE de verdad. `claves_de_plantilla` toma
    la RUTA y devuelve cuatro cosas; aquí solo interesa la primera."""
    ruta = os.path.join(TPL, tpl)
    if not os.path.exists(ruta):
        return []
    claves, _tarjeta, ok, _formas = lint_config.claves_de_plantilla(ruta)
    return sorted(claves) if ok else []


def sonido_de(tpl: str) -> str | None:
    base = tpl[:-5]
    if dirigir.sonidos_propios(tpl) is not None:
        return "propios (los publica la plantilla)"
    micro = dirigir.SFX_MICRO.get(base)
    if micro:
        return micro[0]
    tarjeta = dirigir.SFX_POR_PLANTILLA.get(base)
    if tarjeta:
        return tarjeta[0]
    return None


def catalogo() -> dict:
    ranuras = ranuras_de()
    inv = {}
    for nombre, tpl in leer_guion.COMPONENTES.items():
        inv.setdefault(tpl, {"pedir_como": []})["pedir_como"].append(nombre)
    for fid, tpl in leer_guion.MICRO_FX.items():
        if tpl:
            inv.setdefault(tpl, {"pedir_como": []}).setdefault("fx_id", []).append(fid)

    piezas = []
    for tpl in sorted(inv):
        d = inv[tpl]
        # Lo que el catálogo NO decía y era el dato más importante para elegir:
        # 97 de los 125 bloques importados llevan su texto dentro del marcado y
        # no exponen ninguna ranura, así que usarlos compone «Unleash Full
        # Potential» o «JAN 01 2000» dentro de la pieza y no hay config que lo
        # cambie. Anunciar 182 piezas sin decir esto es por qué siempre se
        # acaban usando las mismas: el guionista no tenía cómo saber cuáles
        # pueden decir sus palabras.
        fijo = leer_guion._texto_de_fabrica(tpl)
        piezas.append({
            "plantilla": tpl,
            "admite_copy": not fijo,
            "texto_de_fabrica": fijo[:6] or None,
            "origen": "hyperframes" if tpl.startswith("hf-") else "propia",
            "como_tarjeta": sorted(d.get("pedir_como") or []),
            "como_micro_fx": sorted(d.get("fx_id") or []),
            "copy": leer_guion.COPY.get(tpl),
            "ranuras": ranuras.get(tpl) or None,
            "gesto_s": gesto_de(tpl),
            "sonido": sonido_de(tpl),
            "config": claves_de(tpl),
        })

    return {
        "generado_por": "scripts/catalogo_json.py",
        "contrato": "guiones/CONTRATO.md",
        "lienzo": "1080x1920",
        "piezas_totales": len(piezas),
        "piezas_que_admiten_copy": sum(1 for p in piezas if p["admite_copy"]),
        "reglas_que_abortan": [
            "un `name` o un `fx_id` fuera de este catálogo aborta",
            "una pieza con `admite_copy: false` ABORTA: su texto vive en el "
            "marcado, no hay config que lo cambie, y compondría el de su demo",
            "un micro-FX con ranura de texto que no recibe copy ABORTA: sin "
            "eso rasteriza el texto de muestra de su plantilla",
            "una clave de `config` que la plantilla no lea aborta "
            "(lint_config --estricto)",
            "un `sfx` fuera de la tabla de sonidos aborta",
            "los micro-FX tienen presupuesto: uno cada 7,5 s de pieza, "
            "mínimo seis, y cada efecto UNA sola vez (BRAND_RULES §15)",
            "nada de neón: §1 se aplica aunque la pieza esté en el catálogo",
        ],
        "como_se_ancla": (
            "Todo se ancla a una PALABRA del `voice_speech` de su acto, nunca "
            "a un segundo: si se vuelve a transcribir, el plan se mueve con la "
            "grabación. Vale también para los pasos de `pasos-flow`, que "
            "aceptan `ancla` por paso."),
        "sonidos": sorted(leer_guion.SFX),
        "encuadres": [x for x in leer_guion.ENCUADRES if x],
        "posiciones": sorted(leer_guion.POSICIONES),
        "piezas": piezas,
    }


def compacto(d: dict) -> str:
    """Una línea por pieza, para que quepa en un prompt de sistema.

    El JSON completo son 81 KB —unos 20.000 tokens— y el contrato otros 25.000.
    Un agente al que le metes 45.000 tokens de referencia antes de la primera
    palabra no escribe mejor: escribe con menos sitio. Aquí va lo que hace
    falta para ELEGIR, y el JSON completo queda para consultarlo cuando ya se
    ha elegido.

    Se ordena por origen y nombre, y se marca lo que cambia la decisión:
    quién acepta copy, quién necesita que le des el texto por ranura, y
    cuánto dura su gesto."""
    filas = ["# Catálogo · %d piezas · lienzo 1080x1920" % d["piezas_totales"],
             "# copy=✓ acepta card_copy · ranura=hay que darle el texto por "
             "config · gesto=cuánto dura su animación",
             ""]
    for p in d["piezas"]:
        marca = "✓" if p["copy"] else ("ranura:" + ",".join(p["ranuras"])
                                       if p["ranuras"] else "—")
        gesto = ("%.1fs" % p["gesto_s"]) if p["gesto_s"] else "—"
        claves = [k for k in p["config"]
                  if k not in ("duration", "tema", "zoom", "modo", "sinSonido",
                               "encaje", "escala", "zona", "salida", "entrada",
                               "cue", "cueGain")]
        filas.append("%-34s %-4s %-7s %-6s %s"
                     % (p["plantilla"], "hf" if p["origen"] == "hyperframes"
                        else "·", marca, gesto, " ".join(claves[:8])))
    return "\n".join(filas) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--escribir", action="store_true")
    ap.add_argument("--compacto", action="store_true",
                    help="una línea por pieza, para un prompt de sistema")
    args = ap.parse_args()
    d = catalogo()
    if args.compacto:
        texto = compacto(d)
        if args.escribir:
            ruta = os.path.join(RAIZ, "guiones", "CATALOGO-COMPACTO.txt")
            open(ruta, "w", encoding="utf-8").write(texto)
            print("✓ guiones/CATALOGO-COMPACTO.txt   %d piezas · %d bytes"
                  % (d["piezas_totales"], len(texto)))
        else:
            print(texto)
        return 0
    texto = json.dumps(d, ensure_ascii=False, indent=1) + "\n"
    if args.escribir:
        ruta = os.path.join(RAIZ, "guiones", "CATALOGO.json")
        open(ruta, "w", encoding="utf-8").write(texto)
        print("✓ guiones/CATALOGO.json   %d piezas · %d bytes"
              % (d["piezas_totales"], len(texto)))
    else:
        print(texto)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
