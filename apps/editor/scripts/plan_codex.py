#!/usr/bin/env python3
"""La escaleta de la pieza «Codex Security», declarada sobre `escaleta.py`.

Antes esto eran 400 líneas con la mecánica de buscar palabras, intersecar
tramos de cámara y comprobar §13/§15 mezclada con el contenido. Todo eso vive
ahora en `scripts/escaleta.py` y aquí queda solo la DECISIÓN: qué gráfico, en
qué palabra, cuánto dura y por qué.

    python3 scripts/plan_codex.py            # -> build/plan.json

Los instantes se anclan a la PALABRA, nunca a un segundo escrito a mano: si se
vuelve a transcribir, el plan se mueve con la transcripción. Y los tiempos
salen en reloj de ORIGEN; `silencios.py --aplicar` hace el único remapeo.
"""

from __future__ import annotations

import json
import sys

import escaleta


def construir(tl=None) -> escaleta.Escaleta:
    e = escaleta.Escaleta(tl)

    # ---------------------------------------------------------------- actos
    _, a1_fin = e.acto("gancho", desde="Auditar", hasta="trabajo")
    a2_ini, _ = e.acto("concepto", desde="OpenAI", hasta="compilación")
    a3_ini, _ = e.acto("prueba", desde="Lo", hasta="tiempo", desde_seg=a2_ini)
    a4_ini, _ = e.acto("cierre", desde="Tienes")

    # ------------------------------------------------- tarjetas, una por acto
    # ACTO 1 · gancho. El titular tiene que estar FUERA antes de que caiga el
    # sello sobre «dólares»: §15 pide 0,6 s de aire. La duración se DERIVA de
    # eso en vez de escribirse, así que si la palabra se mueve el aire aguanta.
    t_dolares = e.g.ini("dólares")
    c1_ini = 0.55
    e.tarjeta(
        "headlineclipper", "headline-clipper.html",
        t=c1_ini,
        dur=t_dolares + 0.11 - escaleta.AIRE_MICROFX - c1_ini,
        sfx="deslizar", sfxGain=0.9,
        config={
            "medio": "OPENAI", "seccion": "Seguridad",
            "titular": "Codex Security, ahora abierto",
            "resaltar": "abierto",
            "entradilla": "Auditoría estática y modelos de detección, "
                          "en el repositorio oficial.",
            "firma": "CODEX SECURITY · OPEN SOURCE",
            # Sin `zona`: `_engine.js` solo la aplica a un nodo con
            # `class="tarjeta"` y esta plantilla posiciona a sangre, así que
            # escrita aquí no haría nada y no lo diría. La banda la resuelve
            # `colocar.py` midiendo el alfa real.
            # `zoom` y NO `escala`: es la clave del MOTOR, que escala la
            # maquetación entera. `escala` solo existe dentro de `code-mockup`.
            # 0.62 sale de la revisión de esta misma pieza: a tamaño completo
            # la tarjeta sustituía a la cámara en vez de acompañarla.
            "zoom": 0.62,
        })

    # ACTO 2 · el único gráfico a pantalla completa. `lienzo` tapa el A-Roll, y
    # por eso `colocar=False`: tapar la cara aquí es la intención, no un choque.
    c2_ini = e.g.ini("Trae", desde=a2_ini) + 0.60
    c2_fin = e.g.fin("vulnerabilidades") + 0.72
    e.tarjeta(
        "securitypipelinenodes", "security-pipeline-nodes.html",
        t=c2_ini, dur=c2_fin - c2_ini,
        sfx="aparicion", sfxGain=0.85, colocar=False,
        config={
            "titulo": "Arquitectura de auditoría", "y": 600,
            "lienzo": True, "reparto": True,
            "nodos": [
                {"rot": "entrada", "tit": "Code Repo",
                 "sub": "tus PRs y tus ramas"},
                {"rot": "motor", "tit": "Codex Engine",
                 "sub": "auditoría estática"},
                {"rot": "salida", "tit": "Vulnerability Alert",
                 "sub": "en tiempo de compilación", "alerta": True},
            ],
        })

    # ACTO 3 · la ventana de código entra con «Ejecutas un script en local»,
    # que es cuando el .yml significa algo.
    #
    # El guion la pide en POS_MID_RIGHT, que no es representable: §12 fija el
    # eje X de toda tarjeta en el 50 % y solo deja elegir banda vertical. Se
    # resuelve por arriba, que es la banda que los subtítulos NO ocupan: por
    # debajo de la cara quedan 162 px antes de la franja de texto, y ahí no
    # cabe una ventana de código.
    c3_ini = e.g.ini("Ejecutas") + 0.24
    e.tarjeta(
        "codemockup", "code-mockup.html", t=c3_ini, dur=3.40,
        sfx="tecleo", sfxGain=1.2,
        config={
            "archivo": "codex-security.yml", "rama": "main",
            "estado": "GITHUB ACTIONS · CI",
            # `escala` sí es la clave propia de esta plantilla. 0.52 y tres
            # líneas vienen de la revisión: a tamaño completo tapaba la cara.
            "anclaje": "arriba", "escala": 0.52, "margen": 60, "cps": 58,
            "codigo": [
                "- uses: openai/codex-security@v1",
                "  with:",
                "    scan: pull_request",
            ],
        })

    # ACTO 4 · cierre. Colocada a mano, y por eso `colocar=False`: la caja de
    # alfa de esta plantilla incluye su anillo de ondas, que crece durante toda
    # la capa —640 px medidos— así que `colocar.py` concluye «no cabe en
    # ninguna banda» aunque la TARJETA ocupe 315 px y sí quepa. Es la medición
    # la que engaña, no el gráfico. `dy` la lleva a la banda «arriba» de §12,
    # por encima de la franja intocable del rostro: el acto 4 va directo a
    # lente y la cara es justo lo que no se puede tapar.
    t_perfil = e.g.fin("perfil")
    c4_ini = e.g.ini("mi", desde=a4_ini) - 0.35
    e.tarjeta(
        "cierrecta", "cierre-cta.html", t=c4_ini, dur=3.50,
        sfx="deslizar", sfxGain=0.9, colocar=False, dy=-707,
        config={
            "rotulo": "Enlace y guía rápida",
            "titular": "Pruébalo hoy\nen tu repo",
            "sub": "Repositorio e instalación, en mi perfil",
            "boton": "Ver el perfil", "ico": "→",
            "botonHecho": "Abierto", "icoHecho": "✓",
            "marca": "@editor-youtube",
            # RELATIVO al inicio de la capa: el puntero toca el botón justo al
            # acabar «perfil».
            "pulsacion": round(t_perfil - c4_ini, 2),
            "zoom": 0.52,
        })

    # --------------------------------------------------------- micro-FX (§15)
    # Tres como capa propia. Los otros dos que pide el guion ya viven DENTRO de
    # una tarjeta y duplicarlos gastaría presupuesto sin añadir nada:
    #   · cli-typewriter -> lo teclea `code-mockup` con su `cps`
    #   · cursor-tap     -> es el puntero de `cierre-cta`
    # `padlock-unlock` queda FUERA: sus disparadores son «truco · estrategia ·
    # desbloquear · acceso · secreto» y la locución no dice ninguno. Ponerlo
    # sería la mentira pequeña contra la que avisa §13.

    # «ya no te va a costar miles de dólares»: el sello cae sobre el coste en
    # una frase que lo NIEGA, así que no afirma nada falso.
    # y=1290 y tam=72, no y=1500/104: medido, a ese tamaño el sello ocupaba
    # 1496-1804 y los subtítulos viven en 1507-1690, o sea texto rojo justo
    # debajo de texto blanco. §15 pone los micro-FX POR DEBAJO de los
    # subtítulos, así que el choque no salía en ningún log: salía en el
    # fotograma. 1290-1503 es la ventana libre entre la franja intocable de la
    # cara (acaba en 1279) y el techo del texto.
    e.microfx_en("stampbanned", "stamp-banned.html", dur=1.20,
                 ancla="dólares", desfase=0.11,
                 sfx="impacto", sfxGain=1.7,
                 config={"texto": "MILES DE $", "y": 1290, "tam": 72,
                         "giro": -9})

    # «detectar» es disparador canónico de target-hud (§15). Cae DENTRO de la
    # ventana full-motion y el guion lo quiere superpuesto al nodo de alerta,
    # así que `colocar=False`: ahí no hay cara que esquivar —la tapa el
    # lienzo— y desplazarlo lo saca del nodo. y=1180 es el centro del tercer
    # nodo con la red arrancando en 600.
    e.microfx_en("targethud", "target-hud.html", dur=1.40,
                 ancla="detectar", desfase=-0.18,
                 sfx="tic", sfxGain=1.1, colocar=False,
                 config={"texto": "DETECTAR", "x": 700, "y": 1180, "r": 150})

    # «antes de subir a producción»: el tic afirma que la puerta pasa.
    e.microfx_en("svgcheckmark", "svg-checkmark.html", dur=1.40,
                 ancla="producción", desfase=-0.20,
                 sfx="resolucion", sfxGain=1.0,
                 config={"texto": "SIN EXPLOITS", "x": 840, "y": 430,
                         "r": 96, "tam": 54})

    # ---------------------------------------------------- transiciones (§11)
    # Una hoja en cada frontera de acto, y con ella el RISER — que hasta ahora
    # no sonaba nunca en ninguna pieza, porque `cortes` es una clave de
    # `transicion.html` y nadie instanciaba esa plantilla. La maquinaria que lo
    # coloca 1,8 s por delante lleva escrita desde la tanda 12 sin ejecutarse.
    #
    # Las tres fronteras dejan 6,13, 12,21 y 16,48 s libres alrededor —medido
    # sobre este mismo plan—, así que la carrera del riser cabe en las tres. El
    # `modo` cambia por frontera para que no se lean como el mismo gesto tres
    # veces, que es lo que pide §11 sobre variedad.
    e.transicion("transicion", en="OpenAI", desfase=-0.35,
                 modo="barrido", color="solida", marca="02")
    e.transicion("transicion2", en="Lo", desfase=-0.35,
                 modo="persiana", color="tinta", marca="03")
    e.transicion("transicion3", en="Tienes", desfase=-0.35,
                 modo="cortina", color="solida", marca="04")

    # ------------------------------------------------------- subtítulos (§12)
    # Las palabras que CARGAN la frase, marcadas en el propio guion. Antes era
    # una lista suelta escrita aquí, o sea que el énfasis lo decidía quien
    # montaba; el guion es el único sitio donde se sabe qué palabra pesa.
    e.subtitulos(guion="""
        Auditar la *seguridad* de tu código cuesta miles de *dólares*.
        OpenAI acaba de sacar *Codex Security* y es *gratuita*.
        Trae un agente que lee tus *PRs* y tu rama y busca *vulnerabilidades*
        antes de que lleguen a producción.
        Lo montas en *GitHub Actions* y escanea *automáticamente*.
        No necesitas saber de *exploits*: te dice qué falla y cómo se arregla.
        Instalación rápida y *sin subir nada a la nube*.
    """)

    # ------------------------------------------------------------ cámara (§11)
    # 1,15x en el gancho, alternando 1,00 y 1,12 en el desarrollo, 1,20x en el
    # cierre. Cada frontera es un salto de corte real, no una rampa.
    e.plano(hasta=a1_fin, zoom=1.15, desde=0.0)   # gancho, plano cerrado
    e.plano(hasta=c2_ini, zoom=1.00)
    e.plano(hasta=c2_fin, zoom=1.00)              # tapado por el lienzo
    e.plano(hasta=c3_ini, zoom=1.12)
    e.plano(hasta=c3_ini + 3.40, zoom=1.00)
    e.plano(hasta=a4_ini, zoom=1.12)
    e.plano(hasta=e.fin_pieza, zoom=1.20)         # cierre, directo a lente
    return e


def main() -> int:
    e = construir()
    errores, desv = e.auditar()
    res = e.escribir()
    print(json.dumps({**res, **e.informe()}, ensure_ascii=False, indent=2))
    return escaleta.informar(errores, desv, microfx=len(e.microfx))


if __name__ == "__main__":
    sys.exit(main())
