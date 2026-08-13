#!/usr/bin/env python3
"""Genera `guiones/CONTRATO.md`: el contrato formal del agente guionista.

Hasta ahora quien escribe los guiones JSON trabajaba a ciegas: su única
«documentación» del formato era `docs/guion-ejemplo.md` —un ejemplo, no un
contrato— y el mensaje de error de `leer_guion.py` al abortar. Lo que el
guion puede pedir vive repartido en cinco tablas de dos ficheros, y el
guionista no las ve: pidió `cursor-tap`, que no existe, y `#4CC2FF`, que §1
prohíbe, porque nada le decía qué SÍ hay.

El MD no se escribe a mano, NUNCA. Cada tabla del contrato es una copia de
las de `leer_guion.py`, del catálogo de `hacer_sfx.py` o de los `defaults`
de las plantillas, y las copias manuales divergen — es el incidente que
motivó `comprobar_docs.py`: «ninguna fuente de marca está instalada», siendo
falso, bloqueó un diagnóstico entero. Aquí es peor, porque hay agentes
ampliando esas tablas en paralelo: un contrato copiado a mano nacería viejo.
Así que se DERIVA, y la puerta (`comprobar_docs.py`) compara byte a byte.

Uso:
    python3 scripts/contrato_guion.py             # imprime y compara (puerta)
    python3 scripts/contrato_guion.py --escribir  # escribe guiones/CONTRATO.md

Sin `--escribir` imprime el contrato por stdout —así `> fichero` da el MD
limpio— y devuelve 1 si difiere del que hay en disco, con el diff por stderr.
"""

from __future__ import annotations

import argparse
import difflib
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import dirigir      # noqa: E402  — SFX_MICRO, SFX_POR_PLANTILLA, sonidos_propios
import hacer_sfx    # noqa: E402  — catalogo() y las descripciones de EFECTOS
import leer_guion   # noqa: E402  — COMPONENTES, COPY, MICRO_FX, SFX, POSICIONES…
import lint_config  # noqa: E402  — claves_de_plantilla: qué lee cada plantilla

PLANTILLAS = os.path.join(RAIZ, "templates")
DESTINO = os.path.join(RAIZ, "guiones", "CONTRATO.md")


# --------------------------------------------------------------------------
#  piezas derivadas
# --------------------------------------------------------------------------
def _todas_las_plantillas() -> list[str]:
    return sorted(f for f in os.listdir(PLANTILLAS)
                  if f.endswith(".html") and not f.startswith("_"))


def _alcanzables() -> list[str]:
    """Las plantillas a las que un guion puede llegar HOY: los componentes,
    los micro-FX con traducción, y `fondo.html`, que `MODE_FULL_MOTION` emite
    por su cuenta debajo del gráfico de pantalla."""
    return sorted(set(leer_guion.COMPONENTES.values())
                  | {t for t in leer_guion.MICRO_FX.values() if t}
                  | {"fondo.html"})


def _claves_md(tpl: str) -> str:
    """Las claves de `config` que la plantilla LEE, con su forma cuando los
    `defaults` la declaran. Mismo extractor que el lint (`lint_config.
    claves_de_plantilla`, sobre `reloj.bloque_defaults`): usar otro aquí es
    como el contrato y el lint acabarían discrepando sobre la misma clave.

    Se excluyen las del motor (`tema`, `duration`, `zoom`…): valen en
    cualquier plantilla y se documentan una vez, no cincuenta. La FORMA va
    entre paréntesis porque el fallo de tipo es el peor de los dos: una clave
    mal escrita no hace nada, una lista pasada como texto revienta al
    renderizar — `code-mockup` recibió `codigo` como cadena y `compas()`
    llamó a `.map` sobre un string: cero fotogramas."""
    ruta = os.path.join(PLANTILLAS, tpl)
    if not os.path.exists(ruta):
        return "—"
    claves, _tarjeta, legible, formas = lint_config.claves_de_plantilla(ruta)
    if not legible:
        return "(extracción no fiable: mira la plantilla)"
    utiles = sorted(claves - lint_config.DEL_MOTOR
                    - lint_config.RESERVADAS_RENDERIZADOR)
    return ", ".join("`%s` (%s)" % (k, formas[k]) if k in formas else "`%s`" % k
                     for k in utiles) or "—"


def _sonido_componente(tpl: str) -> str:
    propios = dirigir.sonidos_propios(tpl)
    if propios is not None:
        return ("publica sus propios cues (%s)" % ", ".join(sorted(propios))
                if propios else "publica sus propios cues")
    son, _gan = dirigir.SFX_POR_PLANTILLA.get(
        tpl[:-5], dirigir.SFX_POR_TIPO["entrada"])
    return "`%s` al entrar" % son


def _sonido_micro(tpl: str) -> str:
    propios = dirigir.sonidos_propios(tpl)
    if propios is not None:
        return ("publica sus propios cues (%s)" % ", ".join(sorted(propios))
                if propios else "publica sus propios cues")
    # El MISMO encadenado que ejecuta leer_guion (dirigir primero, y su
    # shim de nuevos después): el contrato decía «aparicion» para cursor-tap
    # mientras la mezcla recibía «clic» — un contrato que miente en un
    # sonido es el fallo mudo contra el que se escribió.
    son, _gan = dirigir.SFX_MICRO.get(
        tpl[:-5], leer_guion.SFX_MICRO_NUEVOS.get(tpl[:-5], ("aparicion", 0.7)))
    return "`%s`" % son


def _ranura_copy(tpl: str) -> str:
    # El mismo `COPY.get(tpl, "titulo")` que ejecuta leer_guion: si la
    # plantilla no está en la tabla, la ranura por defecto es `titulo`.
    ranura = leer_guion.COPY.get(tpl, "titulo")
    if ranura is None:
        return ("— (sin ranura de texto: su contenido va por config; un "
                "`card_copy` se avisa y se tira)")
    if isinstance(ranura, (list, tuple)):
        # Doble ranura (antes-despues): el guion la llena con una lista o
        # con una cadena partida por « → », «->» o «|».
        return " y ".join("`%s`" % r for r in ranura) +                " (lista, o cadena partida por « → », «->» o «|»)"
    if tpl in leer_guion.COPY:
        return "`%s`" % ranura
    return "`%s` (por defecto)" % ranura


def _despl_txt(d: dict) -> str:
    if not d:
        return "ninguno (la plantilla ya centra)"
    return ", ".join("`%s=%+d`" % (k, d[k]) for k in sorted(d))


def _encuadre_txt(nombre: str, zoom) -> str:
    if nombre == "FRAME_LEFT":
        return ("sin zoom. El eje horizontal de cámara NO es expresable: el "
                "recorte sigue al rostro. Se informa y el acto sale a 1.0")
    if not zoom or zoom == 1.0:
        return "tramo de cámara a 1.0 (el plano tal cual)"
    return "tramo de cámara con zoom %.2f" % zoom


# --------------------------------------------------------------------------
#  el documento
# --------------------------------------------------------------------------
def generar() -> str:
    L: list[str] = []
    p = L.append

    n_total = len(_todas_las_plantillas())
    alcanzables = _alcanzables()
    sonidos_guion = sorted(set(leer_guion.SFX.values()))
    n_catalogo = len(hacer_sfx.catalogo())

    p("# Contrato del guion de dirección")
    p("")
    p("> **GENERADO** por `scripts/contrato_guion.py` desde las tablas de")
    p("> `scripts/leer_guion.py`, el catálogo de `scripts/hacer_sfx.py` y los")
    p("> `defaults` de las plantillas. **No lo edites a mano**: regenéralo con")
    p("> `python3 scripts/contrato_guion.py --escribir`. La puerta")
    p("> (`scripts/comprobar_docs.py`) falla si diverge de las tablas.")
    p("")
    p("El guion JSON lo consume `scripts/leer_guion.py`, que lo cruza con la")
    p("grabación real y dice en voz alta cada divergencia. El guion describe la")
    p("pieza que se QUERÍA grabar; manda la grabación. Ejemplo completo:")
    p("`guiones/codex-security.json`. Colores y palabras en azul:")
    p("`guiones/PALETA.md`. Un guion de pieza redactado en prosa:")
    p("`docs/guion-ejemplo.md`.")
    p("")
    p("Hoy el guion alcanza %d de las %d plantillas del catálogo y %d de los"
      % (len(alcanzables), n_total, len(sonidos_guion)))
    p("%d sonidos sintetizados. Ampliar ese alcance es ampliar las tablas"
      % n_catalogo)
    p("`COMPONENTES`, `MICRO_FX` y `SFX` de `scripts/leer_guion.py` — este")
    p("contrato se regenera de ahí.")
    p("")
    p("## Esquema")
    p("")
    p("```json")
    p("{")
    p('  "metadata": { "title": "…", "duration_seconds": 55,')
    p('                "aspect_ratio": "9:16" },')
    p('  "timeline": [')
    p("    {")
    p('      "act": 1,')
    p('      "act_name": "HOOK",')
    p('      "start_sec": 0,')
    p('      "screen_mode": "MODE_A_ROLL",')
    p('      "framing": "FRAME_CLOSE_UP",')
    p('      "voice_speech": "texto que se quería decir en este acto",')
    p('      "blue_highlight_words": ["palabra", "otra"],')
    p('      "visual_trigger": {')
    p('        "name": "headline-clipper.html",')
    p('        "position": "POS_TOP_CENTER",')
    p('        "card_copy": "TITULAR DE LA TARJETA",')
    p('        "config": { "lo": "que la plantilla necesite, tal cual" }')
    p("      },")
    p('      "micro_fx": [')
    p('        { "trigger_word": "palabra", "fx_id": "stamp-banned",')
    p('          "position": "POS_MID_RIGHT", "config": {} }')
    p("      ],")
    p('      "media_local": [')
    p('        { "file": "assets/broll/clip.mp4", "ancla": "palabra",')
    p('          "dur": 2.2 }')
    p("      ],")
    p('      "sfx": ["stamp_heavy.wav"]')
    p("    }")
    p("  ],")
    p('  "infinite_loop": { "end_phrase": "…", "start_phrase": "…" }')
    p("}")
    p("```")
    p("")
    p("Qué hace el pipeline con cada campo:")
    p("")
    p("- **`voice_speech`** — el texto del acto. Se alinea con `difflib`")
    p("  contra la transcripción real, PALABRA a palabra: todos los anclajes")
    p("  (actos, disparadores, azules) se resuelven sobre esa alineación.")
    p("- **`start_sec` / `end_sec`** — intención, no mandan. Los límites del")
    p("  acto salen de la primera y la última palabra realmente alineadas;")
    p("  una desviación > 1,5 s se informa. En la pieza de Codex el acto 3 se")
    p("  grabó 4,3 s antes de su marca.")
    p("- **`blue_highlight_words`** — palabras que salen en `--accent` en los")
    p("  subtítulos. Una palabra que no se dijo NO se puede resaltar: se")
    p("  propone el equivalente por posición o se omite, y se dice.")
    p("- **`visual_trigger.card_copy`** — entra por la ranura de copy de la")
    p("  tabla de componentes (cada plantilla la llama de otra forma).")
    p("- **`visual_trigger.config` / `micro_fx[].config`** — passthrough: se")
    p("  pasa TAL CUAL a la plantilla. Es la válvula para lo que el guion no")
    p("  modela (el código de un mockup, el botón de un CTA). Tras escribir")
    p("  el plan, `lint_config.py --estricto` comprueba que cada clave la lea")
    p("  de verdad la plantilla; una clave que no lee es ERROR, porque el")
    p("  fallo es mudo: `headline-clipper` recibió `titulo`, lo ignoró y")
    p("  rasterizó su texto de muestra sobre la cara.")
    p("- **`micro_fx[].trigger_word`** — palabra del `voice_speech` de SU acto")
    p("  sobre la que dispara el efecto. Se ancla a la palabra real alineada.")
    p("- **`sfx`** — cues de sonido del acto, con nombres de banco de la tabla")
    p("  de abajo. Se RECONCILIAN con las capas colocadas, no se colocan a")
    p("  ciegas: casan por afinidad de nombre, se confirman contra lo que ya")
    p("  suena, o los cubre la frontera de acto; lo que queda sin capa se")
    p("  informa. Nada desaparece sin una línea.")
    p("- **`timeline[].media_local`** — B-Roll LOCAL declarado por el acto:")
    p("  lista de `{file, ancla, desfase?, dur}`, anclada a la PALABRA como")
    p("  todo lo demás — volver a transcribir mueve la escena con la")
    p("  grabación. El fichero tiene que existir en disco (los media no se")
    p("  versionan; fuente, id y licencia por fichero en `guiones/MEDIA.md`):")
    p("  si falta, ABORTA nombrándolo. Las escenas salen a")
    p("  `build/broll_plan.json` en reloj de ORIGEN — y con `--escribir` ese")
    p("  plan se escribe SIEMPRE, vacío incluido, para que el broll_plan de")
    p("  otra pieza no sobreviva en `build/`.")
    p("- **`micro_fx[].media_fetch`** — se resuelve EN LOCAL, sin descargar")
    p("  nada: el slug se casa por tokens contra los ficheros de")
    p("  `assets/broll/` («shield security via pexels» casa")
    p("  shield_security_pixabay_262696.mp4 por «shield»+«security»; el")
    p("  proveedor no puntúa). Si la media_local del acto ya coloca ese")
    p("  fichero, la petición se confirma sin duplicar; si nada casa, el")
    p("  informe dice el paso: bajar el fichero a `assets/broll/` y")
    p("  declararlo en `guiones/MEDIA.md`.")
    p("- **`infinite_loop`** — SÍ se lee: se mide la costura del bucle")
    p("  (cola tras la última palabra + cabeza antes de la primera) y se")
    p("  informa; desviación si la suma pasa de 0,35 s. No toca el montaje.")
    p("- **`spatial_position`, `time_range`, `component_type`,")
    p("  `custom_specification`** — se aceptan y hoy no se leen: no lleves")
    p("  señal ahí. La posición va en `visual_trigger.position` y")
    p("  `micro_fx[].position`.")
    p("- **`metadata.brand_highlight_color`** — sobra: el color lo pone la")
    p("  paleta (`guiones/PALETA.md`). Un color fuera de marca se ignora y se")
    p("  avisa.")
    p("")
    p("Claves de `config` que valen en CUALQUIER plantilla (las aplica el")
    p("motor): `tema` (`carbon` | `paper`; por defecto `carbon`), `zoom`")
    p("(escala de maquetación), y `zona`/`ancho` solo en plantillas con nodo")
    p("`.tarjeta`. `duration` la pone `leer_guion.py` con la duración que")
    p("dicta el CONTENIDO (el compás de tecleo puede alargarla). `modo` está")
    p("RESERVADA por el renderizador: la sobrescribe y no llega nunca a la")
    p("plantilla. Los tiempos dentro de `config` (`at`, `ini`, `fin`…) son")
    p("RELATIVOS al inicio de su capa, no absolutos de la pieza.")
    p("")

    # --- componentes -------------------------------------------------------
    p("## Componentes (`visual_trigger.name`)")
    p("")
    p("| nombre en el guion | plantilla | ranura de `card_copy` | sonido | claves de `config` |")
    p("|---|---|---|---|---|")
    for nombre in sorted(leer_guion.COMPONENTES):
        tpl = leer_guion.COMPONENTES[nombre]
        p("| `%s` | `templates/%s` | %s | %s | %s |"
          % (nombre, tpl, _ranura_copy(tpl), _sonido_componente(tpl),
             _claves_md(tpl)))
    p("")
    p("Un `name` fuera de esta tabla ABORTA con la lista de plantillas")
    p("disponibles. La tarjeta entra 0,55 s después de arrancar el acto y")
    p("dura 2,5-3 s (recortada al acto); `cierre-cta` se ancla al FINAL de la")
    p("pieza (último 15 %, BRAND_RULES §12). El contenido tecleable alarga la")
    p("capa: la permanencia la dicta el contenido, no el guion.")
    p("")

    # --- micro-FX ----------------------------------------------------------
    p("## Micro-FX (`micro_fx[].fx_id`)")
    p("")
    p("| `fx_id` | plantilla | sonido | claves de `config` | copy OBLIGATORIO |")
    p("|---|---|---|---|---|")
    for fid in sorted(leer_guion.MICRO_FX):
        tpl = leer_guion.MICRO_FX[fid]
        if tpl is None:
            p("| `%s` | — sin equivalente: se informa y se OMITE | — | — | — |"
              % fid)
            continue
        obliga = leer_guion._ranuras_de_texto(tpl)
        p("| `%s` | `templates/%s` | %s | %s | %s |"
          % (fid, tpl, _sonido_micro(tpl), _claves_md(tpl),
             ", ".join("`%s`" % k for k in sorted(obliga)) or "—"))
    p("")
    p("La última columna ABORTA si viene vacía. Un micro-FX con ranura de")
    p("texto que no recibe copy rasteriza el de MUESTRA de su plantilla, y")
    p("nada lo avisa después: el PNG sale bien, el alfa es correcto y el")
    p("vídeo se compone. Medido sobre diez piezas ya montadas — se compuso")
    p("«NO» tachado mientras la voz decía «es completamente falso»,")
    p("«ELIMINAR» sobre la cara, «OBSOLETO» sellado sobre el flujo,")
    p("«PREMIUM» en la frente durante el cierre y «point at things», que es")
    p("la demo del bloque importado. Dura 1,3 s y nadie lo lee dos veces:")
    p("por eso se coló entero y por eso la puerta es un aborto y no un aviso.")
    p("")
    p("Un `fx_id` fuera de esta tabla ABORTA. Dos micro-FX sobre la misma")
    p("`trigger_word` no se descartan: se escalonan 1,5 s o, si el acto no")
    p("da, se separan en el eje X (dx −260/+260) — y se dice. Repetir un")
    p("micro-FX en la pieza es una desviación que la auditoría señala (§15).")
    p("")

    # --- sonidos -----------------------------------------------------------
    p("## Sonidos de banco (`sfx`)")
    p("")
    p("El guion habla en nombres de fichero de banco; este repo SINTETIZA sus")
    p("efectos (`scripts/hacer_sfx.py`). La traducción es por intención — que")
    p("un golpe suene a golpe — y un nombre fuera de tabla ABORTA.")
    p("")
    p("| nombre de banco | aquí suena | a qué suena |")
    p("|---|---|---|")
    for banco in sorted(leer_guion.SFX):
        trad = leer_guion.SFX[banco]
        desc = hacer_sfx.EFECTOS[trad][3] if trad in hacer_sfx.EFECTOS \
            else "(¡no está en hacer_sfx.EFECTOS!)"
        frontera = " — cue de FRONTERA: si no casa con una capa, lo cubre el " \
                   "barrido automático del cambio de acto" \
            if banco in leer_guion.CUE_FRONTERA else ""
        p("| `%s` | `%s` | %s%s |" % (banco, trad, desc, frontera))
    p("")

    # --- posiciones --------------------------------------------------------
    p("## Posiciones (`position`)")
    p("")
    # La prosa se DERIVA de la tabla, no se escribe al lado de ella. Estuvo
    # escrita a mano y sobrevivió a la vuelta atrás que vació `POSICIONES`:
    # el párrafo prometía `dx`/`dy` mientras las seis filas de debajo, en el
    # MISMO fichero, decían «ninguno». Un contrato que se contradice a sí
    # mismo es peor que no tenerlo, porque el guionista lee el párrafo.
    if any(leer_guion.POSICIONES.values()):
        p("`POS_*` se traduce a desplazamiento de COMPOSICIÓN: `dx`/`dy` viajan")
        p("en la capa y `colocar.py` los afina después midiendo el alfa real del")
        p("gráfico contra el rostro de esa ventana. Son el punto de partida, no")
        p("una promesa de píxel. Una posición fuera de tabla no aborta: se avisa")
        p("y el gráfico sale sin desplazamiento (colocar.py ajusta `dy`).")
    else:
        p("`POS_*` **se informa y no se emite**: ninguna posición se traduce a")
        p("desplazamiento. Declara la intención y sale en el informe, y ahí se")
        p("acaba. Quien coloca es la plantilla —que maqueta para el lienzo")
        p("entero— y `colocar.py`, que mide el alfa real del gráfico contra el")
        p("rostro de esa ventana y afina `dy`. Es una vuelta atrás MEDIDA: un")
        p("`dx` fijo por posición sacó tres gráficos del cuadro (mockup 200 px,")
        p("terminal 190, sello 140) y encogerlos para que cupieran los clavó en")
        p("los ojos. Para llevar algo a un lado hay que diseñar la plantilla")
        p("estrecha, no empujar la ancha. Una posición fuera de tabla tampoco")
        p("aborta: se avisa, y el efecto es el mismo que el de una que sí está.")
    p("")
    p("| `position` | desplazamiento emitido |")
    p("|---|---|")
    for pos, d in leer_guion.POSICIONES.items():
        p("| `%s` | %s |" % (pos, _despl_txt(d)))
    p("")

    # --- encuadres y modos -------------------------------------------------
    p("## Encuadres (`framing`) y modos de pantalla (`screen_mode`)")
    p("")
    p("| `framing` | qué hace el pipeline |")
    p("|---|---|")
    for nombre, zoom in leer_guion.ENCUADRES.items():
        if nombre is None:
            continue
        p("| `%s` | %s |" % (nombre, _encuadre_txt(nombre, zoom)))
    p("")
    p("Cada acto emite SIEMPRE su tramo de cámara, con o sin zoom: los tramos")
    p("se intersecan con el `keep` y un acto sin tramo se caería del montaje.")
    p("")
    p("`screen_mode`:")
    p("")
    p("- **`MODE_A_ROLL`** — el gráfico va SOBRE el metraje y se aparta del")
    p("  rostro (`colocar.py`).")
    p("- **`MODE_FULL_MOTION`** — el gráfico HACE de pantalla: se emite")
    p("  `templates/fondo.html` (la única plantilla opaca) debajo, cubriendo")
    p("  el acto entero; el gráfico dura el acto y lleva `colocar=False` —")
    p("  sobre fondo opaco no hay rostro del que apartarse.")
    p("")

    # --- reglas que abortan ------------------------------------------------
    p("## Reglas que ABORTAN (exit ≠ 0)")
    p("")
    p("El exit code es la única señal que ve un guionista automatizado, así")
    p("que ninguna de estas falla en silencio:")
    p("")
    p("1. **Acto con menos del 25 % de palabras literales** contra la")
    p("   grabación. `difflib` empareja SIEMPRE —dos textos sin nada en común")
    p("   devuelven un `replace` de uno contra el otro—, así que la puerta no")
    p("   es que haya emparejamiento sino cuánto es LITERAL. Sin ella, el")
    p("   guion de OTRA toma produce un plan con buena pinta y los anclajes")
    p("   en sitios arbitrarios.")
    p("2. **`visual_trigger.name` fuera de la tabla de componentes.**")
    p("3. **`micro_fx[].fx_id` fuera de la tabla de micro-FX.**")
    p("4. **`sfx` fuera de la tabla de sonidos.** Un cue mal escrito")
    p("   desaparecía sin una línea de log; ahora revienta con la lista de lo")
    p("   que sí hay.")
    p("5. **Con `--escribir`: `lint_config.py --estricto` sobre el plan.**")
    p("   Una clave de `config` que la plantilla no lee es error, no aviso —")
    p("   ver el incidente del texto de muestra sobre la cara.")
    p("")
    p("Lo demás se INFORMA en el listado de reconciliación (stdout), una")
    p("línea por decisión: sustituciones de palabra, cues sin capa, material")
    p("improvisado sin guion, duraciones alargadas por contenido.")
    p("")
    p("## Lo que el pipeline NO sabe hacer")
    p("")
    p("Se declara en vez de fingirse: el eje horizontal de CÁMARA")
    p("(`FRAME_LEFT` — el recorte sigue al rostro) se informa y la pieza")
    p("sale sin él. DESCARGAR de la red tampoco se hace, pero `media_fetch`")
    p("ya no muere en el informe: se resuelve contra lo que hay en")
    p("`assets/broll/`, y lo que falte se baja A MANO según")
    p("`guiones/MEDIA.md` — el manifiesto de qué fichero es cada media, de")
    p("dónde se baja y con qué licencia.")
    p("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--escribir", action="store_true",
                    help="escribe guiones/CONTRATO.md (si no, imprime y "
                         "compara: exit 1 si difiere)")
    a = ap.parse_args()

    texto = generar()

    if a.escribir:
        with open(DESTINO, "w", encoding="utf-8") as f:
            f.write(texto)
        print("✓ %s   %d líneas"
              % (os.path.relpath(DESTINO, RAIZ), texto.count("\n")))
        return 0

    # Modo puerta: imprimir por stdout y comparar byte a byte con el disco.
    sys.stdout.write(texto)
    if not os.path.exists(DESTINO):
        print("\n✗ no existe guiones/CONTRATO.md; escríbelo:\n"
              "    python3 scripts/contrato_guion.py --escribir",
              file=sys.stderr)
        return 1
    en_disco = open(DESTINO, encoding="utf-8").read()
    if en_disco == texto:
        print("✓ guiones/CONTRATO.md está al día", file=sys.stderr)
        return 0
    # El diff entero puede ser largo; las primeras líneas dicen QUÉ tabla se
    # movió, que es lo que hace falta para decidir si el cambio es esperado.
    diff = list(difflib.unified_diff(
        en_disco.splitlines(), texto.splitlines(),
        "guiones/CONTRATO.md (disco)", "generado", lineterm=""))
    for linea in diff[:24]:
        print("  " + linea, file=sys.stderr)
    if len(diff) > 24:
        print("  … (%d líneas más de diff)" % (len(diff) - 24),
              file=sys.stderr)
    print("✗ guiones/CONTRATO.md diverge de las tablas: las tablas mandan.\n"
          "  Regenéralo:  python3 scripts/contrato_guion.py --escribir",
          file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
