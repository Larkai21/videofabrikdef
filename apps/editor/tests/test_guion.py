"""`leer_guion.py`: el guion de dirección en JSON contra la grabación real.

Lo que se prueba aquí no es que el script corra: es que **no se calle**. Un
guion y una toma nunca coinciden del todo, y cada divergencia que el lector
resuelva en silencio es una decisión de dirección tomada por una tabla de
`difflib`. Así que las afirmaciones son de dos clases:

  · lo que RESUELVE  — alinear «arquitectura» con lo que de verdad se dijo;
  · lo que AVISA     — y que un nombre inventado reviente en vez de evaporarse.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import leer_guion                              # noqa: E402
import oro as generador                        # noqa: E402

GUION = os.path.join(RAIZ, "guiones", "codex-security.json")


@pytest.fixture(scope="module")
def tl():
    return generador.timeline_desde_transcript()


@pytest.fixture(scope="module")
def guion():
    if not os.path.exists(GUION):
        pytest.skip("falta %s" % GUION)
    with open(GUION, encoding="utf-8") as f:
        g = json.load(f)
    # Los media del guion NO se versionan (guiones/MEDIA.md): en un clon sin
    # ellos `construir` revienta —a propósito— y este módulo entero no
    # tendría nada que medir. Saltar señalando el manifiesto es más honesto
    # que mutilar el guion para que pase.
    for a in g["timeline"]:
        for m in a.get("media_local") or []:
            if not os.path.exists(os.path.join(RAIZ, m["file"])):
                pytest.skip("falta %s — bájalo según guiones/MEDIA.md"
                            % m["file"])
    return g


@pytest.fixture(scope="module")
def construido(guion, tl):
    return leer_guion.construir(guion, dict(tl))


def dice(informe, *trozos):
    return [x for x in informe if all(t in x for t in trozos)]


def capa_de(e, nombre):
    return next(c for c in e.tarjetas + e.microfx if c["capa"] == nombre)


# ==========================================================================
#  alineación: el guion propone, la grabación dispone
# ==========================================================================

def test_una_palabra_que_no_se_dijo_no_se_resalta_en_su_sitio(construido, tl):
    """El guion pide azul sobre «arquitectura» y en el audio se oyó
    «compilación». Resaltar «arquitectura» es imposible; dejarlo caer sin más
    pierde el énfasis que el guionista puso ahí. Se sustituye Y se dice."""
    e, inf = construido
    claves = {c.lower().strip(".,") for c in e.subs["config"]["clave"]}
    assert "arquitectura" not in claves
    assert "compilación" in claves
    assert dice(inf, "arquitectura", "compilación")


def test_las_palabras_que_si_se_dijeron_pasan_literales(construido):
    e, _ = construido
    claves = {c.lower().strip(".,!¡") for c in e.subs["config"]["clave"]}
    for p in ("fallos", "miles", "vulnerabilidades", "script", "producción"):
        assert p in claves, "«%s» está en el audio y el guion la pide en azul" % p


def test_el_reloj_lo_pone_la_grabacion_no_el_guion(construido, guion):
    """`start_sec` es la intención del guionista. Si mandara, un acto que se
    grabó 4 s antes arrastraría todos sus gráficos fuera de sitio."""
    e, inf = construido
    por_nombre = {n: (i, f) for n, i, f in e.actos}
    ini_a3 = por_nombre["prueba / ejecución"][0]
    assert abs(ini_a3 - 24) > 3, "el acto 3 se grabó lejos de su segundo 24"
    assert dice(inf, "acto 3", "Manda la grabación")


# ==========================================================================
#  lo que no existe: se dice, no se descarta
# ==========================================================================

def test_cursor_tap_ya_existe_y_se_coloca(construido):
    """`cursor-tap` fue el hueco medido del catálogo: se informaba y se
    omitía. `templates/cursor-tap.html` ya existe, así que se coloca como
    cualquier micro-FX y el mensaje de omisión está muerto. Su sonido es
    «clic» por `SFX_MICRO_NUEVOS` mientras `dirigir.SFX_MICRO` no lo
    aprenda — y si la plantilla publica sus propios cues, no se le pisan."""
    e, inf = construido
    c = capa_de(e, "cursortap")
    assert c["template"] == "cursor-tap.html"
    assert c.get("sfx", "clic") == "clic"
    assert not dice(inf, "NO existe")


def test_la_tabla_alcanza_todos_los_micro_fx_del_director():
    """Medido antes de ampliar la tabla: 10 de 56 plantillas alcanzables.
    Cada micro-FX con sonido en `dirigir.SFX_MICRO` tiene plantilla en
    templates/ — pedirlo por guion no puede reventar con «no hay
    traducción» cuando los dos eslabones reales existen."""
    import dirigir
    for fid in dirigir.SFX_MICRO:
        tpl = leer_guion.MICRO_FX.get(fid)
        assert tpl, "«%s» suena en dirigir.SFX_MICRO y el guion no puede pedirlo" % fid
        assert os.path.exists(os.path.join(RAIZ, "templates", tpl)), tpl
    # cursor-tap va aparte: la plantilla la está creando otra tanda, así que
    # aquí se exige el MAPEO y no el fichero — su render lo miran los
    # revisores, no esta prueba.
    assert leer_guion.MICRO_FX["cursor-tap"] == "cursor-tap.html"
    assert None not in leer_guion.MICRO_FX.values()


def test_un_sfx_fuera_de_tabla_revienta(guion, tl):
    """Un nombre de sonido mal escrito tiene que PARAR el montaje. Este repo
    sintetiza sus efectos: un `.wav` de banco que nadie tradujo no suena, y
    hasta ahora eso no producía ni un aviso."""
    g = json.loads(json.dumps(guion))
    g["timeline"][0]["sfx"] = ["no_existe_este_sonido.wav"]
    with pytest.raises(SystemExit) as ex:
        leer_guion.construir(g, dict(tl))
    assert "no_existe_este_sonido.wav" in str(ex.value)


def test_un_componente_fuera_de_tabla_revienta(guion, tl):
    g = json.loads(json.dumps(guion))
    g["timeline"][0]["visual_trigger"]["name"] = "inventada.html"
    with pytest.raises(SystemExit) as ex:
        leer_guion.construir(g, dict(tl))
    assert "inventada.html" in str(ex.value)


def test_un_guion_de_otra_toma_revienta(guion, tl):
    """Montar el guion de otra pieza sobre esta grabación no puede «casi
    funcionar»: no hay nada que alinear y hay que decirlo."""
    g = json.loads(json.dumps(guion))
    for a in g["timeline"]:
        a["voice_speech"] = "zumbido cuarzo penumbra jengibre alfarero"
    with pytest.raises(SystemExit) as ex:
        leer_guion.construir(g, dict(tl))
    assert "NINGUNA palabra" in str(ex.value)


# ==========================================================================
#  la cámara: el fallo que salió de 45,2 s a 12,9 s sin dar error
# ==========================================================================

def test_la_camara_cubre_la_pieza_entera(construido):
    """Un tramo de cámara no marca dónde hay zoom: marca lo que SE CONSERVA.
    Emitir `plano` solo para los actos con primer plano borró del montaje los
    otros dos, y ni el plan, ni el alfa, ni el compositor se quejaron."""
    e, _ = construido
    assert e.camara, "sin tramos de cámara no hay intersección que auditar"
    cubierto = sum(b - a for a, b, _ in e.camara)
    assert cubierto > e.fin_pieza * 0.9, (
        "los tramos de cámara cubren %.1f s de %.1f s" % (cubierto, e.fin_pieza))
    for (_, fin, _), (ini, _, _) in zip(e.camara, e.camara[1:]):
        assert ini - fin < 0.25, "hueco de cámara en %.2f→%.2f s" % (fin, ini)


def test_el_keep_no_se_encoge_al_pasar_por_la_camara(construido, tl):
    e, _ = construido
    antes = sum(k["src_end"] - k["src_start"] for k in tl["keep"])
    despues = sum(k["src_end"] - k["src_start"] for k in e.keep_con_camara())
    assert despues > antes * 0.9, "%.1f s -> %.1f s" % (antes, despues)


# ==========================================================================
#  lo que el pipeline no sabe hacer: se declara
# ==========================================================================

@pytest.mark.parametrize("aguja,motivo", [
    ("FRAME_LEFT", "encuadre lateral de cámara"),
    ("brand_highlight_color", "color de marca del guion"),
])
def test_lo_no_expresable_se_declara(construido, aguja, motivo):
    """Lo que el guion pide y este pipeline no hace. Nada puede desaparecer
    en silencio: quien lee el informe tiene que poder decidir. La lista era
    de cinco: `POS_*` y `MODE_FULL_MOTION` ya se emiten, y `media_fetch` se
    resuelve EN LOCAL contra assets/broll — cada uno con sus propias
    pruebas (la sección de media, más abajo)."""
    _, inf = construido
    clave = {"FRAME_LEFT": "FRAME_LEFT",
             "brand_highlight_color": "brand_highlight_color"}[aguja]
    assert dice(inf, clave), "no se informa de: %s" % motivo


# ==========================================================================
#  el eje horizontal: POS_* se emite y colocar.py lo afina
# ==========================================================================

def test_pos_no_se_emite_como_desplazamiento(construido):
    """`POS_*` se informa y NO se emite, y es una vuelta atrás medida.

    Se probaron las dos formas de honrarlo sobre la pieza real y las dos
    salieron peor que no hacer nada: un `dx` fijo sacó el mockup, el
    terminal y el sello del cuadro (200, 190 y 140 px, con el código
    cortado a media línea), y añadirles `escala` para que cupieran convirtió
    un mockup grande y legible sobre la barbilla en uno pequeño clavado en
    los ojos. Coloca la plantilla, y colocar.py la afina contra el rostro.
    """
    e, inf = construido
    for nom in ("codemockup", "stampbanned", "svgcheckmark", "headlineclipper"):
        c = capa_de(e, nom)
        assert "dx" not in c, nom
        assert "escala" not in c, nom
    assert dice(inf, "POS_MID_RIGHT", "No se emite desplazamiento")


# ==========================================================================
#  MODE_FULL_MOTION: el A-Roll se oculta de verdad
# ==========================================================================

def test_full_motion_emite_fondo_debajo(construido):
    """El guion pidió «A-Roll oculto, Dark Canvas» y la tarjeta se compuso
    SOBRE la cara: 12,7 s con los ojos del presentador tapados. fondo.html
    es la única plantilla opaca y va primera en el ORDEN del compositor:
    en un acto MODE_FULL_MOTION se emite cubriendo el acto entero, y fondo
    y gráfico llevan colocar=False — sobre fondo opaco no hay rostro."""
    e, inf = construido
    fondos = [c for c in e.cromo if c["template"] == "fondo.html"]
    assert len(fondos) == 1, "un acto full-motion, un fondo"
    f = fondos[0]
    ini, fin = {n: (a, b) for n, a, b in e.actos}["concepto"]
    assert abs(f["t"] - ini) < 0.01
    assert abs(f["t"] + f["duracion"] - fin) < 0.01
    assert f["colocar"] is False
    assert capa_de(e, "securitypipelinenodes")["colocar"] is False
    assert dice(inf, "MODE_FULL_MOTION", "DEBAJO")
    assert not dice(inf, "no existe en el pipeline")


# ==========================================================================
#  la permanencia la dicta el contenido, no el guion
# ==========================================================================

def test_el_code_mockup_dura_lo_que_tarda_su_codigo(construido):
    """194 caracteres a cps 42 son 4,64 s solo de tecleo y el guion daba
    3,0: «fail-on: high» jamás apareció. Con el compás ÚNICO de reloj.py
    (0,4 de arranque + len/cps + 0,09 de pausa, y la cola de lectura SIN la
    sangría — la sangría no se lee), la capa dura lo que su contenido
    necesita. El número es el mismo que exigirá validar_plan: esa igualdad
    es el motivo de que el compás viva en un solo sitio."""
    e, inf = construido
    import reloj
    esperado = reloj.tecleo_minimo(capa_de(e, "codemockup")["config"])
    assert esperado == pytest.approx(6.73, abs=0.05)
    assert capa_de(e, "codemockup")["duracion"] == pytest.approx(esperado, abs=0.05)
    assert dice(inf, "codemockup", "se alarga")


def test_el_payoff_del_terminal_se_puede_leer(construido):
    """«3 vulnerabilidades · 0 falsos positivos» entraba en t=1,0 de una capa
    de 1,3 s: vivió 0,3 s, ilegible. La cola de lectura es max(0,9, len/15)
    y la última línea tiene 39 caracteres: 2,6 s de lectura garantizados."""
    e, inf = construido
    term = capa_de(e, "terminal")
    assert term["duracion"] == pytest.approx(3.71, abs=0.05)
    assert dice(inf, "cli-typewriter", "se alarga")


def test_si_el_acto_no_da_se_dice_que_se_recorta(guion, tl):
    """La duración derivada se recorta al fin del acto, y el recorte no es
    mudo: el informe dice qué líneas no llegan a aparecer."""
    g = json.loads(json.dumps(guion))
    g["timeline"][2]["visual_trigger"]["config"]["cps"] = 5   # 40 s de tecleo
    e, inf = leer_guion.construir(g, dict(tl))
    cm = capa_de(e, "codemockup")
    ini, fin = {n: (a, b) for n, a, b in e.actos}["prueba / ejecución"]
    assert cm["t"] + cm["duracion"] <= fin + 0.01
    assert dice(inf, "codemockup", "no llegan a teclearse")


def test_el_azul_del_guion_es_neon_y_se_dice(construido):
    """`#4CC2FF` satura 0,70 sobre valor 1,00. §1 prohíbe el neón, así que se
    usa el acento de marca — pero se dice cuál se usó y por qué."""
    _, inf = construido
    assert dice(inf, "#4CC2FF", "neón")


def test_dos_micro_fx_sin_tiempo_se_separan_en_el_espacio(guion, tl):
    """`target-hud` y `padlock-unlock` disparando los dos en la MISMA palabra,
    a 1,9 s del fin del acto: el escalonado de 1,5 s no cabe, y recortarlo
    contra el fin del acto dejó 0,8 s de solape — fotograma 17,4 s: el
    candado SOBRE el nodo del pipeline, ilegibles los dos. Si el tiempo no
    da, el espacio: dx −260/+260, y queda dicho.

    El choque se CONSTRUYE aquí en vez de leerse del guion de la pieza. Los
    dos efectos vivían de verdad sobre «vulnerabilidades» y la prueba se
    apoyaba en eso, así que separarlos por ritmo —`padlock-unlock` se movió a
    «módulos» para partir una ventana muerta de 10,87 s— la puso en rojo sin
    que el mecanismo que vigila hubiera cambiado nada. Una prueba de
    comportamiento no puede depender de una decisión de montaje: el guion de
    la pieza cambia por motivos que no son los suyos."""
    g = json.loads(json.dumps(guion))          # copia: el fixture es de módulo
    for a in g["timeline"]:
        for m in a.get("micro_fx") or []:
            if m["fx_id"] == "padlock-unlock":
                m["trigger_word"] = "vulnerabilidades"
    e, inf = leer_guion.construir(g, dict(tl))
    assert dice(inf, "target-hud", "padlock-unlock", "se separan en el espacio")
    hud, cand = capa_de(e, "targethud"), capa_de(e, "padlockunlock")
    assert hud["dx"] == -260 and cand["dx"] == 260
    # comparten el instante: el eje que los separa es el X
    assert abs(hud["t"] - cand["t"]) < 0.2, (hud["t"], cand["t"])


def test_si_el_acto_da_tiempo_el_escalonado_se_mantiene(guion, tl):
    """La separación en el espacio es el plan B. Disparados en «repositorio»
    —a más de 10 s del fin del acto— el escalonado temporal de 1,5 s cabe y
    es lo que se usa: dos efectos que se suceden se leen mejor que dos
    efectos simultáneos, aunque estén separados."""
    g = json.loads(json.dumps(guion))
    for fx in g["timeline"][1]["micro_fx"]:
        fx["trigger_word"] = "repositorio"
    e, inf = leer_guion.construir(g, dict(tl))
    assert dice(inf, "Se escalona")
    hud, cand = capa_de(e, "targethud"), capa_de(e, "padlockunlock")
    assert cand["t"] - hud["t"] == pytest.approx(1.5, abs=0.05)
    assert "dx" not in hud and "dx" not in cand


#  el sonido: los cues del guion se colocan, no se tiran
#
#  El mecanismo existía entero —capa.sfx → cue al entrar la capa→ mezcla— y
#  este script validaba los 8 cues del guion y LOS TIRABA: el sello, el HUD y
#  el candado entraron en mudo en la pieza real. Estas pruebas fijan la
#  cascada de reconciliación: afinidad > confirmación > frontera > sin capa.

def test_el_cue_del_guion_gana_al_deducido_por_tabla(construido):
    """`stamp-banned` sonaría «fallo» por `dirigir.SFX_MICRO`; el guion pide
    `stamp_heavy.wav` (→ impacto) y comparte «stamp» con la capa: habla DE
    ella, así que su traducción sustituye a la deducida — y queda dicho."""
    e, inf = construido
    assert capa_de(e, "stampbanned")["sfx"] == "impacto"
    assert dice(inf, "stamp-banned", "impacto")


def test_la_afinidad_de_nombre_coloca_el_cue_en_su_capa(construido):
    """`unlock_click.wav` comparte «unlock» con `padlock-unlock` y
    `hud_lock.wav` comparte «hud» con `target-hud`: cada cue sustituye al
    sonido deducido de SU capa, no al de otra."""
    e, inf = construido
    assert capa_de(e, "padlockunlock")["sfx"] == "clic"
    assert capa_de(e, "targethud")["sfx"] == "tic"
    assert dice(inf, "unlock_click", "clic")


def test_un_cue_que_coincide_con_lo_deducido_confirma(construido):
    """`ping_success.wav` traduce a «acierto», que es exactamente lo que la
    tabla ya dedujo para `svg-checkmark`: se confirma y se anota, sin tocar
    la capa."""
    e, inf = construido
    assert capa_de(e, "svgcheckmark")["sfx"] == "acierto"
    assert dice(inf, "ping_success", "confirmado")


def test_un_cue_sin_capa_deja_linea(guion, tl):
    """Con `cursor-tap` ya en el catálogo, su cue encuentra capa en la pieza
    real; la rama «sin capa» sigue viva para el caso que queda: un micro-FX
    cuya palabra disparadora no se dijo se omite, y su cue se queda sin
    dónde sonar. Y se DICE, porque la regla del script es que nada
    desaparece sin línea."""
    g = json.loads(json.dumps(guion))
    g["timeline"][3]["micro_fx"][0]["trigger_word"] = "quimera"
    _, inf = leer_guion.construir(g, dict(tl))
    assert dice(inf, "cursor-tap", "quimera", "Se omite")
    assert dice(inf, "mouse_click", "cursor-tap", "no tiene dónde sonar")


def test_el_cue_del_guion_confirma_al_micro_fx_nuevo(construido):
    """`mouse_click.wav` (→ clic) acompañaba a `cursor-tap` y se quedaba sin
    capa porque la capa no existía. Ahora coincide con el sonido deducido y
    la cascada lo anota como confirmado — el cue dejó de evaporarse."""
    _, inf = construido
    assert dice(inf, "mouse_click", "cursor-tap", "confirmado")


def test_una_plantilla_que_suena_sola_no_lleva_golpe_encima(construido):
    """`terminal` y `code-mockup` publican sus PROPIOS cues (teclean solas).
    Un `capa.sfx` encima añadiría un golpe de entrada sobre su tecleo."""
    e, _ = construido
    for c in e.tarjetas + e.microfx:
        if c["template"] in ("terminal.html", "code-mockup.html"):
            assert "sfx" not in c, c["capa"]


def test_el_resumen_de_sonido_enumera_lo_hecho(construido):
    """El resumen ya no promete («AÚN NO se colocan»): enumera colocados,
    confirmados, cubiertos por la frontera y sin capa, con sus cuentas.
    Con `cursor-tap` en el catálogo, `mouse_click.wav` pasó de «sin capa» a
    confirmado: 3+3+2+0. Si algún día cursor-tap.html publica cues SIN
    «clic», esta cuenta baja a 3+2+2+1 — y eso es una regresión que mirar
    (el cue del guionista vuelve a quedarse sin sitio), no un falso
    positivo de esta prueba."""
    _, inf = construido
    assert dice(inf, "3 colocado(s)", "3 confirmado(s)",
                "2 cubierto(s)", "0 sin capa")
    assert not dice(inf, "AÚN NO")


# ==========================================================================
#  la tabla ampliada: las tarjetas tech que el guionista no podía pedir
# ==========================================================================

def test_data_diagram_llega_con_su_ranura_y_su_cristal(guion, tl):
    """`data-diagram` era inalcanzable desde un guion. Su ranura es `titulo`
    (verificada en el defaults de la plantilla) y el cristal NO lo declara
    leer_guion: lo activa `escaleta.tarjeta` sola para toda plantilla de
    `dirigir.CRISTAL` — pasarlo a mano saltaría su guarda y perdería los
    valores de blur/sat/desplazar calibrados por plantilla."""
    g = json.loads(json.dumps(guion))
    g["timeline"][1]["visual_trigger"] = {
        "component_type": "standard", "name": "data-diagram.html",
        "position": "POS_CENTER", "card_copy": "ARQUITECTURA DE AUDITORÍA"}
    e, _ = leer_guion.construir(g, dict(tl))
    c = capa_de(e, "datadiagram")
    assert c["config"]["titulo"] == "ARQUITECTURA DE AUDITORÍA"
    assert c["cristal"] is True
    assert c["blur"] == 26 and c["desplazar"] == 0.22


def test_antes_despues_cortinilla_doble_ranura_e_imagen(guion, tl):
    """La única plantilla de DOS ranuras: `COPY` pasó de una clave por
    plantilla a admitir una lista, y `card_copy` trae las dos partes. La
    capa sale con `cortinilla: true` e `imagen` ARRIBA, no en config (§17):
    la plantilla no lee cfg.imagen —la revela el compositor— y dejarla en
    config es la clave muerta que lint_config --estricto tumba."""
    g = json.loads(json.dumps(guion))
    g["timeline"][2]["visual_trigger"] = {
        "component_type": "standard", "name": "antes-despues.html",
        "position": "POS_CENTER",
        "card_copy": ["LO QUE ENCONTRÓ", "LO QUE HICE"],
        "config": {"hasta": 0.64,
                   "imagen": "assets/broll/auditoria_antes.png"}}
    e, inf = leer_guion.construir(g, dict(tl))
    c = capa_de(e, "antesdespues")
    assert c["cortinilla"] is True
    assert c["imagen"] == "assets/broll/auditoria_antes.png"
    assert "imagen" not in c["config"]
    assert c["config"]["antes"] == "LO QUE ENCONTRÓ"
    assert c["config"]["despues"] == "LO QUE HICE"
    assert dice(inf, "antes-despues", "cortinilla", "CAPA")

    # La misma doble ranura desde una CADENA con separador « → ».
    g["timeline"][2]["visual_trigger"]["card_copy"] = \
        "LO QUE ENCONTRÓ → LO QUE HICE"
    e2, _ = leer_guion.construir(g, dict(tl))
    c2 = capa_de(e2, "antesdespues")
    assert c2["config"]["antes"] == "LO QUE ENCONTRÓ"
    assert c2["config"]["despues"] == "LO QUE HICE"


def test_antes_despues_sin_imagen_avisa_del_revelado_invisible(guion, tl):
    """Sin `imagen` la cortinilla revela el metraje SIN LUT, y con el grado
    de marca ese revelado cambia la imagen un ~2 %: no se ve (§17). El
    guionista tiene que leerlo en el informe, no descubrirlo en el render."""
    g = json.loads(json.dumps(guion))
    g["timeline"][2]["visual_trigger"] = {
        "component_type": "standard", "name": "antes-despues.html",
        "position": "POS_CENTER", "card_copy": "ANTES → DESPUÉS"}
    _, inf = leer_guion.construir(g, dict(tl))
    assert dice(inf, "antes-despues", "SIN LUT")


def test_un_alias_de_banco_nuevo_traduce_por_intencion(guion, tl):
    """7 de los 21 sonidos sintetizados eran alcanzables desde un guion.
    Los alias son por INTENCIÓN —un whoosh ES un barrido— y cada
    traducción apunta a un sonido que `hacer_sfx.catalogo()` reconoce:
    un alias hacia un nombre inexistente sería el mismo cue mudo de antes
    con un paso más de disfraz."""
    import hacer_sfx
    for banco, trad in {"whoosh.wav": "barrido", "sub_drop.wav": "subgrave",
                        "error_buzz.wav": "fallo",
                        "notification.wav": "notificacion",
                        "pop.wav": "pop", "sparkle.wav": "destello",
                        "subscribe_reminder.wav": "suscribir",
                        "appear.wav": "aparicion",
                        "music_bed.wav": "cama"}.items():
        assert leer_guion.SFX[banco] == trad
    assert set(leer_guion.SFX.values()) <= hacer_sfx.catalogo()

    # Y de punta a punta: un cue con alias nuevo ya no revienta — se
    # traduce y el informe dice qué fue de él.
    g = json.loads(json.dumps(guion))
    g["timeline"][0]["sfx"].append("error_buzz.wav")
    _, inf = leer_guion.construir(g, dict(tl))
    assert dice(inf, "error_buzz", "fallo")


# ==========================================================================
#  --json: el agente guionista deja de iterar contra prosa
# ==========================================================================

def test_json_emite_solo_el_objeto_pactado(guion, tl, tmp_path):
    """Con --json el stdout es DEL OBJETO: `json.loads` directo, sin regex
    sobre prosa. La salida humana entera se va a stderr y el exit code no
    cambia. Subproceso sobre el guion real y SIN --escribir: esta prueba no
    puede tocar build/."""
    ruta_tl = tmp_path / "timeline.json"
    ruta_tl.write_text(json.dumps(tl), encoding="utf-8")
    r = subprocess.run(
        [sys.executable, os.path.join(RAIZ, "scripts", "leer_guion.py"),
         GUION, "--timeline", str(ruta_tl), "--json"],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)          # stdout parsea ENTERO o la prueba cae
    assert set(obj) == {"actos", "informe", "desviaciones", "errores",
                        "lint", "escrito"}
    assert obj["escrito"] is False and obj["errores"] == []
    assert obj["actos"][0]["nombre"] == "hook"
    assert all(a["ini"] < a["fin"] for a in obj["actos"])
    assert any("bucle:" in x for x in obj["informe"])
    assert "GUION → PLAN" in r.stderr   # la prosa sigue existiendo, en stderr


# ==========================================================================
#  la costura del bucle: se mide y se dice
# ==========================================================================

def test_infinite_loop_informa_el_gap(construido, tl):
    """El guion declara `infinite_loop` y nadie medía si el montaje podía
    cumplirlo: la costura estaba en 0,00 s de cabeza y ni eso se decía.
    Medir y decir, no tocar — recortar es de silencios.py."""
    e, inf = construido
    linea = dice(inf, "bucle:")
    assert linea, "el guion declara infinite_loop y el informe no lo mide"
    cola = float(tl["keep"][-1]["src_end"]) - float(tl["words"][-1]["end"])
    assert "cola %.2f s" % cola in linea[0]
    assert "cabeza 0.00 s" in linea[0]
    # 0,08 s de costura no llegan al tope de 0,35: hoy no es desviación.
    assert cola + 0.0 <= leer_guion.BUCLE_TOPE


def test_un_guion_sin_bucle_no_mide_costura(guion, tl):
    g = json.loads(json.dumps(guion))
    del g["infinite_loop"]
    _, inf = leer_guion.construir(g, dict(tl))
    assert not dice(inf, "bucle:")


# ==========================================================================
#  el tema: uno por pieza, lo pide el guion
# ==========================================================================

def test_tema_paper_llega_a_todas_las_configs(guion, tl):
    """`metadata.tema` sustituye a los «carbon» cableados: tarjetas,
    micro-FX y fondo lo llevan en config.tema. El LUT no viaja con él —lo
    decide --lut del compositor— y el informe lo dice."""
    g = json.loads(json.dumps(guion))
    g["metadata"]["tema"] = "paper"
    e, inf = leer_guion.construir(g, dict(tl))
    assert capa_de(e, "headlineclipper")["config"]["tema"] == "paper"
    assert capa_de(e, "stampbanned")["config"]["tema"] == "paper"
    fondo = next(c for c in e.cromo if c["template"] == "fondo.html")
    assert fondo["config"]["tema"] == "paper"
    assert dice(inf, "tema", "paper", "--lut")


def test_tema_por_defecto_es_carbon(construido):
    e, inf = construido
    assert capa_de(e, "headlineclipper")["config"]["tema"] == "carbon"
    assert dice(inf, "tema", "carbon", "--lut")


def test_un_tema_inventado_revienta_nombrando_los_validos(guion, tl):
    """Un tema mal escrito no puede degradar en silencio a carbon: el error
    nombra los dos válidos, que es lo que el guionista necesita para
    corregir sin abrir BRAND_RULES."""
    g = json.loads(json.dumps(guion))
    g["metadata"]["tema"] = "sepia"
    with pytest.raises(SystemExit) as ex:
        leer_guion.construir(g, dict(tl))
    assert "sepia" in str(ex.value)
    assert "carbon" in str(ex.value) and "paper" in str(ex.value)


# ==========================================================================
#  media: declarado en el guion, resuelto EN LOCAL — nada se descarga
# ==========================================================================

def test_media_local_entra_como_escena_en_reloj_de_origen(construido):
    """El tramo «o muchísimo trabajo» (3,8→5,2 s de origen) no está en el
    texto de ningún acto: quedaba a cara sola. `media_local` lo cubre
    anclado a la PALABRA —«muchísimo», 4,2 s—, así que volver a transcribir
    mueve la escena con la grabación, no con un segundo escrito a mano."""
    e, inf = construido
    escudo = [x for x in e.media if "shield" in x["files"][0]]
    assert len(escudo) == 1, "una escena del escudo, sin duplicar"
    esc = escudo[0]
    assert esc["t"] == pytest.approx(4.2, abs=0.05)
    assert esc["dur"] == pytest.approx(2.2)
    assert esc["tipo"] == "media"
    # ABSOLUTA: composite mira os.path.exists y DESCARTA en silencio la que
    # no encuentre — una ruta relativa dependería del cwd de quien compone.
    assert os.path.isabs(esc["files"][0])
    assert dice(inf, "media_local", "muchísimo")


def test_media_local_valido_escribe_broll_plan_en_origen(construido, tmp_path):
    """La escena llega a broll_plan en reloj de ORIGEN —quien la pasa a
    salida es silencios.py, no este script— y el plan escrito cumple su
    contrato (contratos.broll: forma, solapes, ficheros en disco)."""
    import contratos
    e, _ = construido
    destino = tmp_path / "broll_plan.json"
    leer_guion.escribir_broll(e.media, str(destino))
    d = json.loads(destino.read_text(encoding="utf-8"))
    assert d["reloj"] == "origen"
    assert [x["id"] for x in d["escenas"]]
    assert contratos.broll(d) == []


def test_un_media_ausente_revienta_nombrando_fichero_y_manifiesto(guion, tl):
    """Los media no se versionan: si falta, el error dice CUÁL y a dónde
    mirar para bajarlo (guiones/MEDIA.md). Evaporar la escena en silencio
    sería componer un montaje distinto del que el guion pidió."""
    g = json.loads(json.dumps(guion))
    g["timeline"][0]["media_local"] = [
        {"file": "assets/broll/no_existe_escudo.mp4",
         "ancla": "fallos", "dur": 2.0}]
    with pytest.raises(SystemExit) as ex:
        leer_guion.construir(g, dict(tl))
    assert "no_existe_escudo.mp4" in str(ex.value)
    assert "MEDIA.md" in str(ex.value)


def test_media_fetch_resuelto_por_media_local_no_duplica(construido):
    """El guion pide «shield security via pexels» en el stamp-banned y el
    acto 1 ya coloca ese MISMO fichero por media_local: la petición se
    confirma —la misma cascada que los cues de sonido— en vez de apilar dos
    escudos solapados, que además violarían el contrato del broll_plan."""
    e, inf = construido
    assert dice(inf, "media_fetch resuelto en local", "no se duplica")
    assert len([x for x in e.media if "shield" in x["files"][0]]) == 1


def test_media_fetch_sin_media_local_crea_su_escena_junto_al_micro(guion, tl):
    """Sin media_local, el slug resuelto crea SU escena junto al micro que
    lo pedía (stamp-banned dispara en «dólares») con la duración por
    defecto: una escena pedida por un micro es un acento, no un acto."""
    g = json.loads(json.dumps(guion))
    del g["timeline"][0]["media_local"]
    e, inf = leer_guion.construir(g, dict(tl))
    escudo = [x for x in e.media if "shield" in x["files"][0]]
    assert len(escudo) == 1
    assert escudo[0]["t"] == pytest.approx(capa_de(e, "stampbanned")["t"],
                                           abs=0.05)
    assert escudo[0]["dur"] == pytest.approx(2.0)
    assert dice(inf, "media_fetch resuelto en local", "stamp-banned")


def test_un_slug_que_no_casa_informa_el_paso_que_falta(guion, tl):
    """«quantum cryptography» no casa ningún fichero por tokens: el FX va
    sin material y el informe dice el paso completo — bajar el fichero a
    assets/broll y declararlo en guiones/MEDIA.md. El encogerse de hombros
    a secas era la línea que escondió que el escudo YA estaba en disco."""
    g = json.loads(json.dumps(guion))
    g["timeline"][0]["micro_fx"][0]["media_fetch"] = \
        "quantum cryptography via pexels"
    e, inf = leer_guion.construir(g, dict(tl))
    assert dice(inf, "quantum cryptography", "material externo", "MEDIA.md")
    # la media_local del acto sigue en pie; lo que no hay es escena inventada
    assert len(e.media) == 1


def test_sin_media_el_broll_plan_se_sella_vacio(guion, tl, tmp_path):
    """`--escribir` escribe broll_plan SIEMPRE. El incidente: generate sin
    clave sale limpio (exit 4) SIN escribir, el broll_plan de la pieza
    ANTERIOR sobrevive en build/ y el compositor lo consume. Un vacío
    sellado no es lo mismo que un fichero ausente: es la lápida del
    huérfano."""
    g = json.loads(json.dumps(guion))
    del g["timeline"][0]["media_local"]
    for a in g["timeline"]:
        for fx in a.get("micro_fx") or []:
            fx["media_fetch"] = None
    e, _ = leer_guion.construir(g, dict(tl))
    assert e.media == []
    destino = tmp_path / "broll_plan.json"
    leer_guion.escribir_broll(e.media, str(destino))
    d = json.loads(destino.read_text(encoding="utf-8"))
    assert d == {"reloj": "origen", "escenas": []}


# ==========================================================================
#  lo que ningún acto reclama
# ==========================================================================
# `plano()` encadena: el hueco entre un tramo de cámara y el siguiente se
# rellena solo. Es lo que hay que querer entre dos actos —ahí hay una
# respiración, y cortarla deja la voz pegada y se come el ataque de la
# palabra siguiente— y es exactamente lo contrario de lo que hace falta en una
# grabación con cinco hooks seguidos, donde entre el acto 1 de una pieza y su
# acto 2 hay treinta segundos de las OTRAS cuatro entradas.
#
# La primera pieza de sesgos salió así: 78,7 s en vez de 61,7, con los cinco
# ganchos encadenados. Plan válido, alfa correcto, vídeo compuesto, cero
# errores. Solo se ve escuchando.

def _tl_con_hueco():
    """Dos actos con material sin reclamar en medio: «uno dos | HUECO | cinco»."""
    palabra = lambda w, s, e: {"w": w, "start": s, "end": e, "p": 1.0}
    ws = [palabra("uno", 0.0, 0.4), palabra("dos", 0.5, 0.9),
          palabra("intruso", 3.0, 3.4), palabra("colado", 3.5, 3.9),
          palabra("cinco", 6.0, 6.4)]
    return {"reloj": "origen", "source": "x.mp4", "words": ws, "blocks": [],
            "keep": [{"src_start": 0.0, "src_end": 7.0,
                      "out_start": 0.0, "out_end": 7.0}],
            "duration_original": 7.0, "duration_final": 7.0}


def _guion_con_hueco(**meta):
    acto = lambda n, txt: {
        "act": n, "act_name": "acto %d" % n, "screen_mode": "MODE_A_ROLL",
        "framing": "FRAME_CLOSE_UP", "voice_speech": txt,
        "blue_highlight_words": [], "micro_fx": [], "sfx": []}
    return {"metadata": dict(meta), "timeline": [acto(1, "uno dos"),
                                                 acto(2, "cinco")]}


def test_lo_no_reclamado_se_queda_si_nadie_pide_lo_contrario():
    """El defecto conserva: en la pieza de Codex el hueco entre dos actos son
    tres palabras —«o muchísimo trabajo.»— que se dijeron a propósito y que el
    guion no modela. Tirarlas por medirlas sería inventarse un umbral."""
    e, inf = leer_guion.construir(_guion_con_hueco(), _tl_con_hueco())
    cubierto = [(a, b) for a, b, _ in e.camara]
    assert any(a <= 3.0 and b >= 3.9 for a, b in cubierto), \
        "el hueco debería seguir cubierto: %s" % cubierto
    assert dice(inf, "sin acto", "se quedan en el montaje")


def test_lo_no_reclamado_se_cae_cuando_el_guion_lo_declara():
    e, inf = leer_guion.construir(
        _guion_con_hueco(descartar_no_reclamado=True), _tl_con_hueco())
    cubierto = [(a, b) for a, b, _ in e.camara]
    assert not any(a <= 3.2 and b >= 3.8 for a, b in cubierto), \
        "«intruso colado» no lo reclama ningún acto y sigue cubierto: %s" % cubierto
    assert dice(inf, "sin acto", "se caen del montaje")


def test_una_respiracion_no_es_material_sin_reclamar():
    """Sin palabras huérfanas no se corta nada, ni con la marca puesta: el
    hueco entre dos actos contiguos es aire, y cortarlo pega la voz."""
    tl = _tl_con_hueco()
    tl["words"] = [w for w in tl["words"] if w["w"] not in ("intruso", "colado")]
    e, inf = leer_guion.construir(
        _guion_con_hueco(descartar_no_reclamado=True), tl)
    assert any(a <= 0.9 and b >= 6.0 for a, b, _ in e.camara), \
        "sin palabras en medio la cámara debe seguir encadenando: %s" % e.camara
    assert not dice(inf, "sin acto")


# ==========================================================================
#  dos actos que piden la misma plantilla
# ==========================================================================

def test_dos_actos_con_la_misma_plantilla_no_comparten_capa():
    """El nombre de capa sale de la plantilla y el renderizador escribe los
    fotogramas en `build/frames/<capa>/`: dos capas homónimas y la segunda
    pisa a la primera. Pasa solo al montar un guion con hooks —el cuerpo es
    común y el hook elige su tarjeta sin saber qué usa el cuerpo—, y de diez
    piezas chocaban cinco."""
    g = _guion_con_hueco()
    for a in g["timeline"]:
        a["visual_trigger"] = {"name": "headline-clipper.html",
                               "card_copy": "IGUAL"}
    e, _ = leer_guion.construir(g, _tl_con_hueco())
    capas = [c["capa"] for c in e.tarjetas]
    assert capas == ["headlineclipper", "headlineclipper2"], capas


def test_un_microfx_no_pisa_la_capa_de_una_tarjeta():
    """El directorio de fotogramas es uno para los dos carriles, así que una
    tarjeta `strokecrossout` y un micro-FX `stroke-crossout` colisionaban
    igual — y ese no lo cazaba nadie hasta el render."""
    g = _guion_con_hueco()
    g["timeline"][0]["visual_trigger"] = {"name": "stroke-crossout.html",
                                          "card_copy": "UNO"}
    g["timeline"][0]["micro_fx"] = [{"trigger_word": "dos",
                                     "fx_id": "stroke-crossout",
                                     "config": {"texto": "DOS"}}]
    e, _ = leer_guion.construir(g, _tl_con_hueco())
    capas = [c["capa"] for c in e.tarjetas + e.microfx]
    assert len(capas) == len(set(capas)), capas


# ==========================================================================
#  un micro-FX sin copy enseña el de su plantilla
# ==========================================================================
# Una tarjeta sin copy se nota en la revisión: sale el titular de otra pieza.
# Un micro-FX dura 1,3 s y nadie lo lee dos veces, así que se coló entero: en
# las diez piezas de sesgos se compuso «NO» tachado mientras la voz decía «es
# completamente falso», «ELIMINAR» sobre la cara, «OBSOLETO» sobre el flujo de
# los cuatro momentos y «point at things» —la demo del bloque importado— junto
# a la mano. El PNG salía bien, el alfa correcto y el vídeo se componía.
#
# Y no era de ese guion: al poner la puerta, el de Codex —la pieza de
# referencia de este repo— falló en el primer acto por lo mismo.

def test_un_microfx_sin_copy_no_pasa():
    g = _guion_con_hueco()
    g["timeline"][0]["micro_fx"] = [{"trigger_word": "dos",
                                     "fx_id": "stamp-banned"}]
    with pytest.raises(SystemExit) as e:
        leer_guion.construir(g, _tl_con_hueco())
    assert "OBSOLETO" in str(e.value), str(e.value)


def test_con_copy_pasa():
    g = _guion_con_hueco()
    g["timeline"][0]["micro_fx"] = [{"trigger_word": "dos",
                                     "fx_id": "stamp-banned",
                                     "config": {"texto": "A MANO"}}]
    e, _ = leer_guion.construir(g, _tl_con_hueco())
    assert any(c["capa"] == "stampbanned" for c in e.microfx)


def test_las_ranuras_se_leen_de_la_plantilla_no_de_una_tabla():
    """Incluidas las que declaran sus defaults en UNA línea, que eran justo
    las tres que se colaron: con la expresión anclada a principio de línea la
    puerta daba por limpias a `stroke-crossout`, `stamp-banned` y
    `gold-glint`."""
    assert leer_guion._ranuras_de_texto("stroke-crossout.html") == {"texto": "NO"}
    assert leer_guion._ranuras_de_texto("stamp-banned.html") == {"texto": "OBSOLETO"}
    assert leer_guion._ranuras_de_texto("gold-glint.html") == {"texto": "PREMIUM"}
    # Un bloque importado no lleva el copy en `defaults` sino en el marcado, y
    # `importar_bloque.js` deja el mapa de ranuras: cuenta igual.
    assert "lineas" in leer_guion._ranuras_de_texto("hf-hw-underline.html")
    # Y una plantilla sin texto no exige nada: `neural-node-pulse` son nodos.
    assert leer_guion._ranuras_de_texto("neural-node-pulse.html") == {}


def test_un_bloque_que_no_admite_copy_no_pasa():
    """97 de los 125 bloques importados llevan su texto en el MARCADO y no
    exponen ninguna ranura: `importar_bloque.js` solo lo consiguió en 28.
    Usar uno compone «Unleash Full Potential» dentro de la pieza y no hay
    config que lo cambie — y la puerta de `_copy_sin_dar` no los veía,
    precisamente por no declarar nada que llenar."""
    g = _guion_con_hueco()
    g["timeline"][0]["visual_trigger"] = {"name": "hf-app-showcase.html"}
    with pytest.raises(SystemExit) as e:
        leer_guion.construir(g, _tl_con_hueco())
    assert "no admite copy" in str(e.value).lower()
    assert "Unleash Full Potential" in str(e.value)


def test_hasta_las_transiciones_traen_copy_de_demo():
    """Se comprobó rasterizando: no hay un solo bloque importado sin texto de
    demo en el marcado. `hf-whip-pan` —una TRANSICIÓN— compone «SCENE A»
    sobre un panel gris; `hf-app-showcase`, tres maquetas de móvil con
    «Unleash Full Potential»; `hf-caption-highlight`, «JUST CODE THAT
    BECOMES». La suposición de que un VFX no lleva copy que pueda estar mal
    era falsa, y por eso la puerta no exime a ninguna familia."""
    assert "SCENE A" in leer_guion._texto_de_fabrica("hf-whip-pan.html")


def test_las_nuestras_no_pasan_por_esta_puerta():
    """Construyen su DOM desde `config`, así que su texto de muestra vive en
    `defaults` y lo caza la otra puerta. Mirarles el marcado daría falsos
    positivos con cualquier rótulo de andamiaje."""
    assert leer_guion._texto_de_fabrica("hero-stat.html") == []


def test_una_tarjeta_sin_copy_tampoco_pasa():
    """La misma puerta que los micro-FX. Con la tabla `COPY` ampliada de 9
    ranuras a 35, una tarjeta que declara titular y no lo recibe rasteriza el
    de muestra — y son 26 plantillas más que antes ni siquiera eran
    elegibles."""
    g = _guion_con_hueco()
    g["timeline"][0]["visual_trigger"] = {"name": "definition-card.html"}
    with pytest.raises(SystemExit) as e:
        leer_guion.construir(g, _tl_con_hueco())
    assert "Comodización" in str(e.value)


def test_card_copy_llega_a_la_ranura_nueva():
    g = _guion_con_hueco()
    g["timeline"][0]["visual_trigger"] = {"name": "definition-card.html",
                                          "card_copy": "SESGO"}
    e, _ = leer_guion.construir(g, _tl_con_hueco())
    c = next(c for c in e.tarjetas if c["capa"] == "definitioncard")
    assert c["config"]["palabra"] == "SESGO"


def test_las_de_lista_siguen_sin_titular():
    """`terminal` tiene `titulo: 'zsh'`, que es el chrome de la ventana y no
    el copy de la pieza. Darle `card_copy` ahí escribiría «zsh» donde va el
    nombre de la terminal. Su contenido son `lineas[]` y va por config."""
    assert leer_guion.COPY["terminal.html"] is None
    assert leer_guion.COPY["pasos-flow.html"] is None


# ==========================================================================
#  el acento del plan en los subtítulos
# ==========================================================================

def test_kinetic_captions_declara_acento():
    """La palabra con carga va en `--accent`, el azul de esta marca. Para una
    pieza ajena hacía falta un `preset`, que cambia la VOZ entera —familia,
    pastilla, bloom— para reproducir un catálogo externo. Cambiar de tinta no
    debería costar cambiar de estilo, así que la plantilla acepta un color del
    PLAN. No es un hexadecimal a pelo de §2: no lo decide la plantilla."""
    src = open(os.path.join(RAIZ, "templates", "kinetic-captions.html"),
               encoding="utf-8").read()
    assert "acento: ''" in src
    assert '.zona[data-acento] .w.clave' in src
    # El filete se va con el acento: el bronce es la marca de ESTA marca.
    assert '.zona[data-acento] .w .filo' in src


# ==========================================================================
#  el grado de marca se PIDE, no se evita
# ==========================================================================

def test_el_lut_no_se_aplica_por_defecto():
    """`--lut` traía `carbon_bronze.cube` de fábrica, así que llegaba por la
    puerta de atrás a cualquiera que no lo desactivara. `solo_subs.py` no lo
    pasaba, su comentario decía «sin LUT» y los cuatro clips de un cliente
    salieron graduados igual: la pared neutra en beige y la piel más cálida.
    Medido sobre el mismo fotograma contra el original, en la zona sin
    subtítulo: 30,6 dB de PSNR con el LUT, 44,2 dB sin él.

    Un defecto que ALTERA la imagen tiene que pedirse. Las piezas propias lo
    piden —`piezas.py` lo pasa explícito— y no cambian."""
    src = open(os.path.join(RAIZ, "scripts", "composite_ffmpeg.py"),
               encoding="utf-8").read()
    assert 'ap.add_argument("--lut", default="none"' in src
    # Y quien SÍ lo quiere sigue pidiéndolo.
    piezas = open(os.path.join(RAIZ, "scripts", "piezas.py"),
                  encoding="utf-8").read()
    assert 'default="assets/luts/carbon_bronze.cube"' in piezas
    subs = open(os.path.join(RAIZ, "scripts", "solo_subs.py"),
                encoding="utf-8").read()
    assert '"--lut", "none"' in subs


def test_solo_subs_respeta_los_fps_del_origen():
    """El pipeline trabaja a 30 y eso está bien para lo que se graba aquí.
    Imponérselos a un clip ajeno lo REMUESTREA: los cuatro de un encargo
    venían a 24 y salieron a 30, o sea 240 fotogramas convertidos en 300
    duplicando uno de cada cuatro. En una imagen quieta no se nota; en
    movimiento es un tirón por segundo, y al recomprimir, el codificador
    reparte bits distintos entre fotogramas idénticos — que es la suciedad
    que se veía en pantalla.

    Medido sobre el mismo fotograma contra el original, zona sin subtítulo:
    30,6 dB con LUT y 30 fps · 44,2 sin LUT a 30 fps · 46,3 sin LUT a 24 fps
    y CRF 14."""
    src = open(os.path.join(RAIZ, "scripts", "solo_subs.py"),
               encoding="utf-8").read()
    assert "def fps_de(" in src
    assert '"--fps", "%g" % fps' in src
    # Y el codificador no tira más de lo necesario sobre material intacto.
    assert 'ap.add_argument("--crf", type=int, default=14)' in src
    assert '"--preset-x264", args.preset' in src
