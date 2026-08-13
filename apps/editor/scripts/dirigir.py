#!/usr/bin/env python3
"""Dirige un vídeo a partir de la transcripción: ritmo, variedad y cámara.

Esto NO es un colocador de tarjetas. Es lo que evita el fallo que hundía las
piezas anteriores: **una gráfica cada vez, centrada, sobre fondo vacío**, seis
minutos seguidos. Medido en la pieza de la inversión en IA, el 93,6 % del
metraje tenía exactamente UNA capa de contenido en pantalla.

Cuatro reglas, todas comprobables sobre el plan que sale:

  DENSIDAD    Cuatro gráficos por pieza, uno por acto, con doce segundos
              de aire como mínimo entre ellos. El 60-80 % del metraje es
              cara y subtítulos y nada más. La versión anterior repartía
              uno cada tres segundos: eso no es ritmo, es que el
              espectador deja de mirar a quien habla y se pasa el vídeo
              leyendo tarjetas.
  ACTOS       Gancho, dos núcleos y cierre, en fracciones de la duración
              —0-10 %, 10-42 %, 42-75 %, 75-100 %—, que en un vídeo de
              60 s dan exactamente 0-6, 6-25, 25-45 y 45-60.
  SEMÁNTICA   Hay plantillas que AFIRMAN algo: `chapter-card` dice «esto
              es el paso 2» y `search-bar` dice «alguien preguntó esto».
              Solo salen si el guion lo dice de verdad. Ver `GUARDIAS`.
  VARIEDAD    Ninguna plantilla dos veces en la misma pieza.
  CÁMARA      Saltos de corte en el A-Roll: 1.15x en el gancho, alternando
              1.00x y 1.12x en el desarrollo, 1.20x en el cierre. Se
              emiten como tramos `keep` con `zoom`, así que son cortes de
              verdad y no una rampa.
  SONIDO      Cada entrada de gráfico lleva su efecto.

La elección de componente sale de la INTENCIÓN de la frase, no del orden.
Ver `INTENCIONES`: es la tabla que traduce lo que se dice a cómo se enseña.

Uso:
    python3 scripts/dirigir.py --transcript build/transcript.json
    python3 scripts/dirigir.py --transcript build/transcript.json --formato 16:9
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                 # noqa: E402
import reloj                                              # noqa: E402

# --------------------------------------------------------------------------
# Intención -> componente. El orden importa: gana la primera que case.
# Cada entrada es (nombre, patrones, plantillas candidatas).
# --------------------------------------------------------------------------
INTENCIONES = [
    ("pregunta_audiencia",
     r"\b(muchos me pregunt|me preguntais|os pregunt|much[oa]s de vosotros)\b",
     ["comment-bubble", "chat-bubbles"]),

    ("dato_porcentaje",
     r"(\d+\s*%|\bpor ciento\b|\bla mitad\b|\bun tercio\b|\bdos de cada\b)",
     ["poll-rating", "hero-stat", "mapa-calor"]),

    ("paso_numerado",
     r"\b(el primer paso|paso \w+|primero[,:]|segundo[,:]|tercero[,:]|"
     r"regla \w+|error \w+)\b",
     ["chapter-card", "pasos-flow"]),

    ("comparacion",
     r"\b(antes\b.{0,40}\bahora|frente a|en vez de|mientras que|"
     r"por un lado\b.{0,60}\bpor otro|versus|vs\.?)\b",
     ["compare-ab"]),

    ("cita_frase",
     r"\b(como dijo|segun \w+|la regla es|qu[eé]date con|la idea es|"
     r"en una frase)\b",
     ["highlighter-text", "cita", "kinetic-quote"]),

    ("busqueda_pregunta",
     r"^\s*(¿|como |c[oó]mo |qu[eé] pasa|por qu[eé])",
     ["search-bar", "kinetic-quote"]),

    ("definicion",
     r"\b(se llama|se conoce como|es decir|dicho de otra forma|"
     r"significa que|consiste en)\b",
     ["definition-card", "pills"]),

    ("herramienta_tecnica",
     r"\b(ffmpeg|whisper|playwright|python|node|api|modelo|servidor|"
     r"terminal|comando|script)\b",
     ["terminal", "code-mockup", "data-diagram"]),

    ("estructura_lista",
     r"\b(cinco|cuatro|tres|dos)\s+(capas|riesgos|ideas|razones|pasos|"
     r"claves|formas|motivos)\b",
     ["data-diagram", "pasos-flow", "cinta"]),

    ("resultado_logro",
     r"\b(nueva venta|seguidores|ingresos|resultado|conseguim|logram)\b",
     ["notification-pop", "hero-stat"]),

    ("autoridad_noticia",
     r"\b(un estudio|seg[uú]n el informe|public[oó]|titular|la prensa)\b",
     ["headline-clipper", "tweet-card"]),

    ("alcance_global",
     r"\b(en todo el mundo|a nivel mundial|mundialmente|globalmente|"
     r"en cualquier pa[ií]s|desde cualquier parte|todo el planeta|"
     r"internacional(?:es|mente)?|deslocaliz|remoto desde)\b",
     # La guardia de `globo` exige DOS lugares nombrados, así que esta
     # intención propone y el guion decide. Sin eso, cualquier «a nivel
     # mundial» sacaba una esfera girando sin nada que señalar.
     ["globo"]),

    ("cierre_cta",
     r"\b(gu[aá]rdalo|comparte|s[ií]gueme|suscr[ií]b|dale a|antes de irte)\b",
     # `engagement-cta` del catálogo pedido ES `cierre-cta`: ya entra un
     # puntero y pulsa el botón. Se deja el alias documentado y se apunta
     # a la que existe, en vez de duplicar una plantilla idéntica.
     ["cierre-cta"]),
]

# Reserva por defecto cuando ninguna intención casa. Se rota para no repetir.
NEUTRAS = ["kinetic-quote", "highlighter-text", "pills", "cita",
           "definition-card", "cinta", "data-diagram"]

# Cuáles existen hoy. El director avisa de las que faltan en vez de emitir
# un plan que el renderizador no puede cumplir.
def plantillas_disponibles() -> set:
    d = os.path.join(RAIZ, "templates")
    return {f[:-5] for f in os.listdir(d)
            if f.endswith(".html") and not f.startswith("_")}


# Cromo: no son gráficos de contenido y no entran en el reparto.
#
# `cinta` NO está aquí, aunque lo estuvo: es candidata de la intención
# `estructura_lista`, está en RELLENABLES y en NEUTRAS, y `contenido_de` la
# rellena con contenido real. Declararla cromo y candidata a la vez era una
# contradicción dentro del mismo fichero, y de las dos la que decía la verdad
# es la segunda.
CROMO = {"fondo", "karaoke-subs", "capitulos", "transicion"}

VACIAS = {"a", "e", "y", "o", "u", "de", "del", "la", "el", "los", "las",
          "un", "una", "unos", "unas", "que", "en", "por", "para", "con",
          "sin", "su", "sus", "se", "lo", "al", "es", "son", "no", "ni",
          "mas", "pero", "como", "cuando", "si", "ya", "muy", "tu", "te",
          "esta", "este", "esa", "ese", "hay", "ser", "son", "eso"}


def clave(txt, n=3):
    """Las n palabras con más carga de la frase.

    Se ordena por longitud y no por frecuencia: en una sola oración todas
    aparecen una vez, y la longitud es el indicador barato de que una
    palabra lleva significado."""
    ws = [w.strip('.,;:!?¿¡«»"\'()') for w in txt.split()]
    ws = [w for w in ws if len(w) > 3 and sin_tildes(w) not in VACIAS]
    vistas, out = set(), []
    for w in sorted(ws, key=len, reverse=True):
        k = sin_tildes(w)
        if k not in vistas:
            vistas.add(k); out.append(w)
    return out[:n]


def cola(txt):
    """Última cláusula: lo que se subraya casi siempre es el remate."""
    t = txt.strip().rstrip(".!?")
    for sep in (": ", " — ", ", "):
        if sep in t:
            return t.rsplit(sep, 1)[1]
    ws = t.split()
    return " ".join(ws[-4:]) if len(ws) > 5 else t


def numeros(txt):
    a = [int(x) for x in re.findall(r"\b(\d{1,3})\s*%", txt)]
    return a or [int(x) for x in re.findall(r"\b(\d{2,6})\b", txt)]


def compensa(cfg, esc):
    """Agranda los cuerpos de letra por el inverso de la escala de capa.

    Al meter los gráficos en una columna se encoge la capa entera, y con
    ella la tipografía: el texto acaba ilegible. Dibujarlo grande y dejar
    que el escalado lo reduzca da el tamaño correcto en pantalla y, de
    paso, más nitidez que rasterizarlo pequeño."""
    if esc >= 0.999:
        return cfg
    k = 1.0 / esc
    for clave in ("tam", "anchoMax"):
        if isinstance(cfg.get(clave), (int, float)):
            cfg[clave] = int(cfg[clave] * k)
    return cfg


# --------------------------------------------------------------------------
# REFINADO DE TITULARES
#
# Un titular no es un trozo de transcripción. Cortar la frase por donde cae
# el reloj produce cosas como «encoder a un LLM, pero Kimi»: gramaticalmente
# incompleto y, en pantalla, ruido. Esto convierte el fragmento en 2-4
# palabras que se sostienen solas.
#
# No inventa contenido: solo escoge y ordena palabras que YA están en la
# frase. Un resumen que añade términos nuevos diría cosas que el guion no
# dice, y eso en un vídeo con voz encima se nota inmediatamente.
# --------------------------------------------------------------------------

# Arranques que dejan la frase colgando si sobreviven al recorte.
COLGANTES = {
    "pero", "y", "e", "o", "u", "ni", "que", "porque", "aunque", "sino",
    "como", "cuando", "si", "pues", "así", "entonces", "además", "también",
    "es", "son", "era", "eran", "está", "están", "hay", "sea", "ser",
    # Auxiliares: «KIMI K3 HA» deja el titular esperando el participio.
    "ha", "han", "he", "has", "hemos", "habéis", "había", "habían",
    "va", "van", "vas", "voy", "puede", "pueden", "debe", "deben",
    "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
    "en", "con", "por", "para", "sin", "sobre", "a", "al", "lo", "su",
    "sus", "se", "le", "les", "me", "te", "nos", "muy", "más", "ya",
    # Pronombres y demostrativos: apuntan a algo que ya no está en el
    # titular, así que lo dejan cojo igual que una conjunción suelta.
    "ella", "ellas", "ello", "ellos", "esto", "eso", "aquello",
    "esta", "este", "estas", "estos", "esa", "ese", "esas", "esos",
    "mismo", "misma", "otro", "otra", "otros", "otras", "algo", "nada",
}

# Términos con peso propio: si aparecen, el titular se construye a su
# alrededor. Se detectan por forma, no por lista cerrada.
import re as _re


def _limpia(w):
    return w.strip(' .,;:!?¿¡«»"\'()[]—–-')


def _peso(w):
    """Cuánta carga lleva una palabra. Sirve para ordenar, no para juzgar."""
    l = _limpia(w)
    if not l:
        return -1
    b = sin_tildes(l)
    if b in COLGANTES:
        return -1
    p = len(l)
    if l[0].isupper():          # nombre propio o marca
        p += 6
    if any(c.isdigit() for c in l):
        p += 8
    if _re.search(r"(cion|ción|dad|miento|encia|ancia)$", b):
        p += 3                  # sustantivos abstractos: suelen ser el tema
    if b.endswith("mente"):
        # Un adverbio nunca es el TEMA de nada, y en castellano son las
        # palabras más largas de la frase: `automáticamente` son quince
        # letras y `directamente` doce, así que una ordenación por longitud
        # los pone siempre arriba. Medido sobre la pieza de Codex, los
        # cuatro capítulos salían «seguridad muchísimo», «vulnerabilidades
        # específicamente», «automáticamente directamente» y «repositorio
        # instalación»: tres de cuatro encabezados por un adverbio.
        #
        # −5 y no −99: si en el tramo no hay otra cosa, un adverbio sigue
        # siendo mejor que nada.
        p -= 5
    return p


_CAPS = [0]   # contador de capítulos, no de gráficos

# Plantillas que solo tienen sentido en el último 15 % del vídeo.
SOLO_FINAL = {"cierre-cta"}

NEGACIONES = {"no", "ni", "nunca", "jamas", "tampoco", "sin", "nada", "nadie"}

# Una conjunción DENTRO de la ventana es un límite de oración: la ventana
# «LLM pero Kimi» empieza y acaba bien, pero por dentro son dos frases
# distintas cosidas. Recortar por los extremos no lo detecta.
CONJUNCIONES = {"pero", "aunque", "sino", "porque", "que", "y", "o", "e",
                "u", "ni", "mientras", "cuando", "si", "pues", "aunque"}


def _niega(txt):
    return any(sin_tildes(_limpia(w)) in NEGACIONES for w in str(txt).split())


def refinar_titular(txt, maximo=4, minimo=2, mayus=True):
    """Fragmento crudo -> titular de 2-4 palabras, en mayúsculas.

    Devuelve None si la frase no da para un titular limpio. Devolver algo
    a la fuerza es lo que producía los recortes incompletos: es preferible
    que el director elija otro componente."""
    ws = [w for w in str(txt).split() if _limpia(w)]
    if not ws:
        return None

    # Se puntúan y se toman las mejores CONSERVANDO el orden del guion:
    # reordenarlas cambiaría el sentido de la frase.
    puntuadas = [(i, w, _peso(w)) for i, w in enumerate(ws)]
    utiles = [x for x in puntuadas if x[2] > 0]
    if len(utiles) < minimo:
        return None

    mejor, tope_p = None, -1
    for n in range(min(maximo, len(ws)), minimo - 1, -1):
        for a in range(0, len(ws) - n + 1):
            trozo = puntuadas[a:a + n]
            # Media, no suma: si no, la ventana más larga gana siempre por
            # acumulación aunque arrastre palabras vacías.
            pts = sum(max(0, x[2]) for x in trozo) / float(n)
            if _re.search(r"(ado|ido|ando|iendo|ar|er|ir)$",
                          sin_tildes(_limpia(trozo[-1][1]))):
                pts -= 4
            if any(sin_tildes(_limpia(x[1])) in CONJUNCIONES
                   for x in trozo[1:-1]):
                pts -= 20
            if pts > tope_p:
                tope_p, mejor = pts, trozo
    if not mejor:
        return None
    elegidas = [w for _, w, _ in mejor]

    # Nunca empezar ni terminar en una palabra que deja la frase colgando.
    while elegidas and sin_tildes(_limpia(elegidas[0])) in COLGANTES:
        elegidas.pop(0)
    while elegidas and (sin_tildes(_limpia(elegidas[-1])) in COLGANTES
                        or sin_tildes(_limpia(elegidas[-1])) in NEGACIONES):
        # Terminar en negación deja el titular a medias («KIMI K3 NO»).
        # Al quitarla salta el guardia de abajo y no se pone titular: es
        # la respuesta correcta, porque ese fragmento no da uno limpio.
        elegidas.pop()
    if len(elegidas) < minimo:
        return None

    res = " ".join(_limpia(w) for w in elegidas)
    if not mayus:
        # Se conserva la caja original —las siglas son siglas— y solo se
        # levanta la inicial. `.capitalize()` haría «llm» de «LLM».
        return None if (_niega(txt) and not _niega(res)) else res[:1].upper() + res[1:]
    # Si la frase negaba y el resumen ya no, el titular dice lo contrario
    # que la voz en off. Antes que eso, ningún titular.
    if _niega(txt) and not _niega(res):
        return None
    return res.upper()


def refinar_frase(txt, palabras=9):
    """Para componentes que admiten una línea entera —cita, rotulador—:
    recorta por la última coma o punto que quepa, nunca a media palabra."""
    t = " ".join(str(txt).split())
    ws = t.split()
    if len(ws) <= palabras:
        corte = t
    else:
        corte = " ".join(ws[:palabras])
        for sep in (", ", "; ", ": "):
            if sep in corte:
                corte = corte.rsplit(sep, 1)[0]
                break
    # Cortar por coma no garantiza una frase completa: «problemas de
    # decaimiento en» termina en preposición. El saneado va al final de
    # AMBAS ramas: una frase ya corta puede colgar igual.
    cs = corte.split()
    while cs and sin_tildes(_limpia(cs[-1])) in COLGANTES:
        cs.pop()
    # Una conjunción seguida de UNA sola palabra abre una oración que ya no
    # cierra: «encoder a un LLM, pero Kimi». Se corta la cola entera.
    if len(cs) >= 4 and sin_tildes(_limpia(cs[-2])) in COLGANTES:
        cs = cs[:-2]
        while cs and sin_tildes(_limpia(cs[-1])) in COLGANTES:
            cs.pop()
    # Marcadores del discurso al principio: no aportan y delatan el recorte.
    # «que» va en la lista porque los marcadores lo arrastran: quitar «Así»
    # de «Así que sígueme» dejaba «que sígueme», que es peor que el original.
    while len(cs) > 3 and sin_tildes(_limpia(cs[0])) in (
            "y", "pero", "asi", "pues", "entonces", "que", "o", "e",
            "ademas", "tambien", "incluso", "luego", "despues"):
        cs.pop(0)
    if len(cs) < 3:
        return None
    res = " ".join(cs).rstrip(",;:").rstrip()
    if _niega(txt) and not _niega(res):
        return None
    return res


def contenido_de(tpl, txt, i):
    """Rellena la plantilla con lo que se está DICIENDO.

    Sin esto el director coloca componentes con su contenido de fábrica: el
    montaje queda bien repartido y no dice nada. Solo se ofrecen plantillas
    que se puedan rellenar de verdad — ver RELLENABLES."""
    t = txt.strip()
    corto = t if len(t) <= 92 else t[:89].rsplit(" ", 1)[0] + "…"
    k = clave(t)
    kk = " ".join(k[:2])
    if tpl == "kinetic-quote":
        tit = refinar_titular(t, maximo=3, minimo=1)
        if not tit:
            return None
        return {"texto": tit, "resaltar": tit.split()[0], "tam": 170}
    if tpl == "highlighter-text":
        frase = refinar_frase(t, 10)
        # `refinar_frase` devuelve None cuando no sale copia limpia —menos de
        # tres palabras útiles, o un recorte que se ha comido la negación— y
        # esta rama era la única que no lo comprobaba: `cola(None)` reventaba
        # con un AttributeError y se llevaba por delante toda la pasada del
        # director. Las demás ramas ya hacían `if not tit: return None`.
        # BRAND_RULES §12 dice qué hacer: «cuando no sale copia limpia, el
        # componente NO se coloca. Un hueco es mejor que media frase».
        if not frase:
            return None
        marca = cola(frase)
        return {"texto": frase, "marcar": [marca] if marca in frase else [],
                "tam": 62}
    if tpl == "cita":
        frase = refinar_frase(t, 11)
        if not frase:
            return None
        return {"cita": frase, "resaltar": k[:2],
                "autor": "", "cargo": "", "tam": 58}
    if tpl == "definition-card":
        if not k:
            return None
        return {"palabra": k[0].capitalize(), "fonetica": "",
                "categoria": "concepto", "definicion": refinar_frase(t, 12)}
    if tpl == "search-bar":
        # Un desplegable real propone consultas DISTINTAS, no baraja las
        # palabras de la que ya está escrita. Antes devolvía «disonancias
        # detecta» / «disonancias» para la consulta «detecta disonancias»:
        # tres veces lo mismo en pantalla.
        q = refinar_frase(t, 6)
        if not q or len(k) < 2:
            return None
        q = q.lower()
        # Una consulta que empieza en interrogación o en muletilla no es una
        # búsqueda: es relleno del guion («¿vale? un saludo»).
        if sin_tildes(_limpia(q.split()[0])) in COLGANTES or q[0] in "¿¡":
            return None
        vistas, sug = set(q.split()), []
        for w in k:
            w = w.lower()
            if w in vistas:
                continue
            vistas.add(w)
            sug.append("%s %s" % (q.split()[0], w))
            if len(sug) == 2:
                break
        if len(sug) < 2:
            return None
        return {"consulta": q, "sugerencias": sug}
    if tpl == "comment-bubble":
        return {"texto": corto, "nombre": "Pregunta frecuente",
                "usuario": "@audiencia", "likes": 120 + i, "respuestas": 4}
    if tpl == "tweet-card":
        return {"texto": corto, "nombre": "Nota del guion", "usuario": "@guion",
                "red": "publicación", "verificado": False,
                "metricas": [{"etq": "me gusta", "n": 300 + i * 7}]}
    if tpl == "headline-clipper":
        tit = refinar_titular(t, maximo=5, minimo=3, mayus=False)
        if not tit:
            return None
        return {"titular": tit, "resaltar": "",
                "entradilla": "", "medio": "El Medio", "firma": "", "fecha": ""}
    if tpl == "chapter-card":
        tit = refinar_titular(t, maximo=3, minimo=2)
        if not tit:
            return None
        _CAPS[0] += 1
        return {"n": "%02d" % _CAPS[0], "titulo": tit}
    if tpl == "poll-rating":
        ns = numeros(t)
        a = max(8, min(92, ns[0] if ns else 74))
        return {"titulo": corto[:58],
                "opciones": [{"txt": (kk or "Sí")[:34], "pct": a},
                             {"txt": "El resto", "pct": 100 - a}]}
    if tpl == "split-versus":
        p2 = re.split(r"\b(?:pero|mientras que|en vez de|frente a|ahora)\b", t, 1)
        return {"a": {"rotulo": "ANTES", "titulo": p2[0].strip()[:38], "pie": ""},
                "b": {"rotulo": "AHORA",
                      "titulo": (p2[1].strip()[:38] if len(p2) > 1 else corto[:38]),
                      "pie": ""}}
    if tpl == "hero-stat":
        ns = numeros(t)
        return {"valor": ns[0] if ns else max(2, len(k)), "unidad": "",
                "rotulo": kk[:28].upper(), "etiqueta": corto[:52],
                "nota": "", "separador": "."}
    if tpl == "notification-pop":
        tit = refinar_titular(t, maximo=5, minimo=2, mayus=False)
        if not tit:
            return None
        return {"app": "Aviso", "icono": "▲", "titulo": tit,
                "sub": refinar_frase(t, 7), "hora": "ahora"}
    if tpl == "pills":
        return {"items": [{"txt": w.lower(), "tipo": "stat" if j == 0 else "cmd",
                           "punto": j == 0} for j, w in enumerate(k[:3])]}
    if tpl == "cinta":
        # DOS bandas pegadas y girando en sentidos contrarios, que es lo que
        # hace que se lean como un mecanismo y no como una marquesina. El
        # director emitía UNA sola, así que el rediseño de la plantilla no
        # habría aparecido nunca en un vídeo: es el mismo error que el plan
        # avisa para `capitulos`, `glass-dock` y `globo` —rediseñar algo que
        # el director no coloca es trabajo que no se ve—.
        #
        # La segunda banda solo sale si hay material PROPIO para ella. Con
        # menos de cinco palabras clave repetiría las mismas tres, y dos
        # bandas diciendo lo mismo son relleno: peor que una sola.
        alto = int(56 * 1.55)
        giro = -1 if i % 2 else 1
        arriba = {"items": [w.upper() for w in k[:3]] or ["·"],
                  "y": 300, "tam": 56, "velocidad": 110,
                  "dir": giro, "estilo": "placa", "canto": True,
                  "opacidad": 0.72}
        if len(k) < 5:
            return {"bandas": [arriba]}
        # 110 y 68 no son dos números cualesquiera: son una relación de
        # engranaje. Dos rodillos del mismo diámetro girando a distinta
        # velocidad no son un mecanismo, son dos cintas.
        return {"bandas": [arriba,
                           {"items": [w.upper() for w in k[3:6]],
                            "y": 300 + alto, "tam": 56, "velocidad": 68,
                            "dir": -giro, "estilo": "filete",
                            "opacidad": 0.6}]}
    if tpl == "globo":
        # Los puntos salen del guion, no de una lista bonita: si la frase
        # nombra Madrid y Tokio, el globo enseña Madrid y Tokio. Cuatro como
        # mucho — con más, cada parada dura menos de medio segundo y el globo
        # da tumbos en vez de visitar.
        sitios = lugares_en(t)[:4]
        if len(sitios) < MIN_LUGARES:
            return None
        return {"puntos": [{"lat": c[0], "lon": c[1], "txt": nom.upper()}
                           for nom, c in sitios]}
    if tpl == "lower-third":
        return {"nombre": kk[:30], "rol": corto[:46], "bug": ""}
    if tpl == "cierre-cta":
        # Una llamada a la acción NO es un resumen de la frase: es una
        # instrucción. Resumir aquí producía titulares como «ASÍ SÍGUEME
        # APRENDER», que no dice ni resume.
        return {"rotulo": "", "titular": "Sígueme",
                "sub": "", "boton": "Seguir", "marca": "", "ico": "+"}
    if tpl == "compare-ab":
        return {"titulo": kk[:34],
                "a": {"titulo": (k[0] if k else "A")[:18], "sub": "", "valor": "ALTO",
                      "unidad": "", "barra": 1.0, "pie": ""},
                "b": {"titulo": (k[1] if len(k) > 1 else "B")[:18], "sub": "",
                      "valor": "BAJO", "unidad": "", "barra": 0.3, "pie": ""}}
    if tpl == "pasos-flow":
        return {"y": 520, "pasos": [{"n": "%02d" % (j + 1), "titulo": w[:22],
                                     "desc": "", "meta": ""}
                                    for j, w in enumerate(k[:3])]}
    return {}


# Solo estas se ofrecen. Ofrecer las demás daría variedad de cartón:
# componentes distintos repitiendo su texto de fábrica.
RELLENABLES = {"kinetic-quote", "highlighter-text", "cita", "definition-card",
               "search-bar", "comment-bubble", "tweet-card", "headline-clipper",
               "chapter-card", "poll-rating", "hero-stat",
               "notification-pop", "pills", "cinta",
               "cierre-cta"}
# `pasos-flow` queda fuera del reparto automático: son tres pasos con
# título Y descripción, y de una sola frase no se sacan tres descripciones
# reales. Con `desc` vacía el componente se dibuja como tres barras sin
# contenido, que es peor que no ponerlo.

# Componentes que MUESTRAN una cifra. Si la frase no la trae, no se usan:
# rellenarlos con un número deducido es inventarse un dato, y un gráfico que
# inventa datos es peor que no poner gráfico. `lower-third` queda fuera de
# los rellenables por lo mismo en otro plano: es una ficha de nombre y
# cargo, y llenarla con fragmentos de la frase no dice nada.
REQUIERE_CIFRA = {"poll-rating", "hero-stat", "odometro"}

# Componentes cuyo contenido ES un titular: si el refinador no saca uno
# limpio, no se usan.
EXIGE_TEXTO = {"headline-clipper", "kinetic-quote", "definition-card",
               "chapter-card", "notification-pop"}

_DIR_PLANTILLAS = os.path.join(RAIZ, "templates")
SFX_POR_TIPO = {
    "entrada":    ("aparicion", 0.7),
    "pastilla":   ("clic", 0.6),
    "pantalla":   ("impacto", 1.4),
    "transicion": ("barrido", 1.0),
}

# El sonido de entrada según QUÉ entra. Con `aparicion` para todo, cuatro
# gráficos distintos sonaban igual y el oído dejaba de distinguirlos: el
# efecto pasaba de subrayar a ser un tic. Lo que no está aquí usa
# `entrada`, que sigue siendo la elección neutra correcta.
# Qué capas piden REFRACCIÓN REAL al compositor.
#
# El mecanismo lleva funcionando desde la tanda 9: la plantilla emite una
# segunda pasada con la silueta de sus `.cristal` (`render_playwright.js:437`)
# y ffmpeg difumina el metraje, lo desplaza con el mapa de turbulencia y lo
# recorta con esa silueta (`composite_ffmpeg.py`). Está probado y documentado.
#
# Y NADIE LO HA EMITIDO NUNCA: `grep -c cristal dirigir.py` daba **cero**, y la
# hoja de contactos tampoco. Así que las cinco plantillas que llevan `.cristal`
# en su marcado —`glass-dock`, `pills`, `data-diagram`, `kinetic-quote` y
# `fondo`— se capturaban siempre sobre alfa vacío, donde `backdrop-filter` no
# tiene nada que muestrear, y quedaban en `rgba(255,255,255,0.10)` más un
# borde: una pastilla gris translúcida. Es exactamente el fallo que
# `_tokens.css § LIQUID GLASS` describe y da por resuelto.
#
# `desplazar` es lo que separa el cristal del plástico esmerilado, así que va
# en todas. Los valores son por plantilla porque el área importa: un dock de
# 52 px de alto con el blur de una tarjeta a pantalla completa se ve como una
# mancha, y al revés se ve como un plástico.
CRISTAL = {
    "glass-dock":    {"blur": 24, "sat": 1.5, "desplazar": 0.26},
    # `pills` SALE de esta tabla en la tanda 15. Dejó de ser una pastilla de
    # vidrio y pasó a ser una chapa troquelada con la cara opaca, así que la
    # refracción queda DEBAJO del metal y no se ve — y aun así seguía costando
    # una pasada de máscara entera y su filtro de ffmpeg en cada fotograma.
    # La plantilla conserva `.silueta` para que la región siga siendo
    # coincidente si algún día vuelve a hacer falta.
    "kinetic-quote": {"blur": 30, "sat": 1.6, "desplazar": 0.24},
    "data-diagram":  {"blur": 26, "sat": 1.5, "desplazar": 0.22},
}


_PROPIOS: dict[str, frozenset | None] = {}


def sonidos_propios(template: str) -> frozenset | None:
    """Sonidos que la plantilla publica POR SÍ MISMA, o None si no publica.

    `terminal` y `code-mockup` teclean solas: devuelven `cues` desde su
    `register()` y el renderizador los vuelca al manifiesto
    (`render_playwright.js:428`). Ponerles `capa.sfx` encima añadiría un golpe
    de entrada SOBRE su propio tecleo. Se detecta en el FUENTE de la
    plantilla y no en `build/layers.json`, porque build/ es compartido entre
    piezas y sus cues pueden ser de OTRO montaje.

    Vive AQUÍ y no en leer_guion porque el propio dirigir cometía el
    fallo que esta función evita: ponía `capa.sfx=tecleo` a `terminal` y
    `code-mockup` por SFX_POR_PLANTILLA, sumando un golpe de entrada al
    tecleo que ya publican — doble sonido en toda pieza dirigida.

    El patrón exige los dos puntos (`cues:`) a propósito: las plantillas que
    NO publican lo dicen en prosa —`target-hud` lleva «Sin `cues` a
    propósito»— y un patrón sin los dos puntos las confundiría con las que
    sí. Medido sobre las 56: las cinco de esta pieza que publican casan y
    las cuatro mudas no."""
    if template not in _PROPIOS:
        try:
            src = open(os.path.join(_DIR_PLANTILLAS, template),
                       encoding="utf-8").read()
        except OSError:
            src = ""
        _PROPIOS[template] = (
            frozenset(re.findall(r"\bsfx:\s*['\"]([a-z_]+)['\"]", src))
            if re.search(r"\bcues\s*:", src) else None)
    return _PROPIOS[template]


SFX_POR_PLANTILLA = {
    "notification-pop": ("notificacion", 0.75),
    "comment-bubble":   ("pop", 0.7),
    "chat-bubbles":     ("pop", 0.7),
    "pills":            ("pop", 0.6),
    "tweet-card":       ("pop", 0.65),
    "terminal":         ("tecleo", 0.9),
    "code-mockup":      ("tecleo", 0.9),
    "search-bar":       ("tecleo", 0.8),
    "hero-stat":        ("tic", 0.8),
    "odometro":         ("tic", 0.8),
    "poll-rating":      ("clic", 0.6),
    "chapter-card":     ("impacto", 1.1),
    "kinetic-quote":    ("impacto", 1.0),
    "headline-clipper": ("deslizar", 0.85),
    "definition-card":  ("deslizar", 0.8),
    "cita":             ("deslizar", 0.7),
    # El cierre lleva el acorde grave; el clic del botón lo declara la
    # propia plantilla, que es la única que sabe cuándo se pulsa.
    "cierre-cta":       ("resolucion", 0.8),
    # Las que enseñan DATOS leyéndose. Antes caían al `aparicion` genérico del
    # respaldo, así que un diagrama de nodos y una tarjeta de definición
    # entraban con el mismo sonido — y §14 ya dice que «el sonido de entrada
    # depende de QUÉ entra», porque con `aparicion` para todo el oído deja de
    # distinguirlos y el efecto pasa de subrayar a ser un tic.
    "data-diagram":     ("escaner", 0.8),
    "mapa-calor":       ("escaner", 0.85),
    "security-pipeline-nodes": ("escaner", 0.8),
    # Las que COMPARAN dos cosas: el gesto es la anticipación, no el golpe.
    "compare-ab":       ("preimpacto", 0.7),
    "split-versus":     ("preimpacto", 0.8),
    "antes-despues":    ("barrido", 1.0),
}

# Qué suena en cada micro-FX. Cinco de estos mapeos MENTÍAN, y no por
# descuido: el catálogo solo tenía la mitad positiva del vocabulario, así
# que lo negativo se cubría con golpes neutros y lo correcto con un aviso.
#
#   red-crash      subgrave      -> fallo      un seno grave dice «peso»,
#                                              no dice «mal». Sin dos
#                                              alturas no hay intervalo y
#                                              sin intervalo no hay
#                                              disonancia.
#   stamp-banned   impacto       -> fallo      un sello de PROHIBIDO no es
#                                              un corte de montaje.
#   svg-checkmark  notificacion  -> acierto    un aviso de móvil dice
#                                              «mira», no «correcto».
#   padlock-unlock clic          -> acierto    abrirse es el resultado
#                                              positivo, no el gesto.
#   target-hud     tic           -> escaner    una mira que barre es
#                                              lectura, no madera.
#   neural-node-pulse aparicion  -> escaner    ídem: nodos leyéndose.
#
# A nivel de módulo, junto a `SFX_POR_PLANTILLA`, y no local de `main()`: la
# lee también `leer_guion.py` para deducir el sonido de los micro-FX que
# coloca desde guion. Mientras fue local era inalcanzable desde fuera, y los
# micro-FX de la pieza de Codex —el sello, el HUD, el candado— entraron en
# mudo: capa sin `sfx`, cue sin emitir, y ningún log lo dijo.
SFX_MICRO = {"stroke-crossout": ("clic", 0.7), "stamp-banned": ("fallo", 1.1),
             "cut-strip": ("barrido", 0.8), "green-spike": ("aparicion", 0.8),
             "red-crash": ("fallo", 1.0), "head-explode": ("impacto", 1.3),
             "gold-glint": ("destello", 0.9), "target-hud": ("escaner", 0.8),
             "neural-node-pulse": ("escaner", 0.7),
             "svg-checkmark": ("acierto", 0.9),
             "padlock-unlock": ("acierto", 0.7), "timer-ring": ("tic", 0.8),
             "text-stack-offset": ("pop", 0.7),
             "cursor-tap": ("clic", 0.7)}


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn").lower()


def frases(words: list, pausa: float = 0.32) -> list:
    """Agrupa palabras en frases por puntuación o por pausa larga.

    La pausa cuenta tanto como el punto: en una locución real, dos ideas
    separadas por 400 ms son dos ideas aunque no haya punto escrito."""
    out, act = [], []
    for i, w in enumerate(words):
        act.append(w)
        fin_punt = w["w"].rstrip()[-1:] in ".!?"
        hueco = (i + 1 < len(words)
                 and words[i + 1]["start"] - w["end"] >= pausa)
        if fin_punt or hueco:
            out.append(act); act = []
    if act:
        out.append(act)
    return [{"ini": g[0]["start"], "fin": g[-1]["end"],
             "txt": " ".join(x["w"] for x in g),
             "palabras": g} for g in out if g]


def intencion_de(txt: str) -> tuple:
    plano = sin_tildes(txt)
    for nombre, patron, candidatas in INTENCIONES:
        if re.search(patron, plano, re.I):
            return nombre, candidatas
    return "neutra", NEUTRAS


def candidatas_para(preferidas: list, intencion: list, usos: dict,
                    ultima: str, disponibles: set,
                    hay_cifra: bool = True) -> list:
    """Las plantillas a probar para un tramo, EN ORDEN, con el respaldo puesto.

    Sustituye a la vieja `elegir()`, que devolvía una sola y **no se llamaba
    desde ningún sitio**: el bucle de reparto tenía su propia lista y con ella
    se perdían las dos reglas que aquella función documentaba.

      · **El filtro de RELLENABLES**, que vale para TODAS las candidatas y no
        solo para el respaldo. Sin él, `pasos-flow` y `compare-ab` eran
        candidatas automáticas —de las intenciones `estructura_lista` y
        `comparacion`— y podían colocarse con `desc` y `meta` vacíos: tres
        barras sin contenido, que es el defecto exacto que el comentario de
        `RELLENABLES` describe como razón para excluirlas. §12 lo dice sin
        rodeos: «quedan para planes escritos a mano».
      · **El respaldo**: cuando la intención agota sus candidatas se coge la
        MENOS usada del catálogo, nunca se repite la anterior. Sin él, un acto
        que agotaba sus opciones no colocaba nada, y §13 pide uno por acto.

    Devuelve una LISTA y no una elección porque el bucle tiene que aplicar
    después las comprobaciones caras —contenido, repetición de subtítulo, aire
    con la anterior— y si una falla hay que seguir probando.
    """
    def vale(c):
        return (c in disponibles and c != ultima and c in RELLENABLES
                and (hay_cifra or c not in REQUIERE_CIFRA)
                # §13: cuatro gráficos por pieza, uno por acto. Con cuatro,
                # ninguna plantilla se repite: es más estricto que cualquier
                # tope calculado y hace innecesario el de §11.
                and not usos.get(c, 0))

    orden = [c for c in preferidas if vale(c)]
    orden += [c for c in intencion if vale(c) and c not in orden]
    # El respaldo va al final, ordenado por menos usada: reparte el catálogo
    # entero en vez de gastar siempre los mismos tres componentes.
    resto = sorted((c for c in disponibles if vale(c) and c not in orden),
                   key=lambda c: (usos.get(c, 0), c))
    return orden + resto


def zoom_de(i: int, n: int, ini: float, dur_total: float) -> float:
    """Gancho, desarrollo alterno y cierre. La alternancia es por índice y
    no aleatoria: un patrón regular se lee como intención, y uno aleatorio
    como error de montaje.

    Las fronteras son FRACCIONES de la duración, no segundos absolutos. Antes
    eran `ini < 3.0` y `ini > dur_total - 8.0`, calibrados para el vídeo de
    referencia de 60 s, y no escalaban: en una pieza de 40 s el «gancho» de
    cámara cubría el 7,5 % mientras el gancho narrativo de §13 es el 10 %, y el
    «cierre» cubría el 20 % frente al 25 % del acto de cierre. O sea que la
    cámara y los actos dejaban de coincidir justo en las piezas cortas, que son
    las que se hacen. Se derivan de `ACTOS` para que sean la misma frontera.
    """
    frac = (ini / dur_total) if dur_total > 0 else 0.0
    fin_gancho = ACTOS[0][2]        # 0.10
    ini_cierre = ACTOS[-1][1]       # 0.75
    if frac < fin_gancho:
        return 1.15
    if i >= n - 2 or frac >= ini_cierre:
        return 1.20
    return 1.12 if i % 2 else 1.00


# --------------------------------------------------------------------------
# ORQUESTACIÓN NARRATIVA
#
# Las fracciones dan EXACTAMENTE los tramos del guion de realización en un
# vídeo de 60 s —0-6, 6-25, 25-45, 45-60— y escalan solas en uno de 81 o de
# 40. Fijarlas en segundos absolutos habría dejado el acto de cierre fuera
# de cualquier vídeo más largo del previsto.
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# NO REPETIR EL SUBTÍTULO
#
# Si la tarjeta dice literalmente lo que se está leyendo abajo, la segunda
# capa de texto no aporta: son los mismos ojos leyendo dos veces la misma
# frase. Compartir TÉRMINOS está bien —refuerza—; reproducir una tirada de
# palabras seguidas, no.
#
# El texto del gráfico sale del mismo fragmento que el subtítulo, así que
# por construcción coinciden. La salida no es cambiar el texto sino
# DESPLAZAR el gráfico: aparece justo después de la frase que condensa, que
# además es como se monta a mano.
# --------------------------------------------------------------------------
# Dos palabras CON CARGA seguidas, no tres: los enlaces se filtran antes,
# así que un titular de cuatro palabras como «Encoder a un LLM» aporta solo
# dos —«encoder llm»— y con el umbral en tres no saltaba nunca, que es
# justo el caso que hay que cazar.
RACHA_MAX = 2


def _contenido(txt):
    """Palabras con carga, normalizadas. Los enlaces coinciden siempre y
    contarlos daría repetición en cualquier par de frases en español."""
    out = []
    for w in str(txt).split():
        b = sin_tildes(_limpia(w)).lower()
        if b and b not in VACIAS and b not in COLGANTES:
            out.append(b)
    return out


def texto_visible(cont):
    """Todo lo que la tarjeta pinta, venga de la clave que venga."""
    trozos = []
    def rec(v):
        if isinstance(v, str):
            trozos.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                rec(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                rec(x)
    rec(cont)
    return " ".join(trozos)


def repite_subtitulo(cont, palabras, t0, t1) -> bool:
    """¿La tarjeta reproduce lo que se oye mientras está en pantalla?"""
    dichas = _contenido(" ".join(
        w["w"] for w in palabras if t0 <= w["start"] < t1))
    graf = _contenido(texto_visible(cont))
    if len(dichas) < RACHA_MAX or len(graf) < RACHA_MAX:
        return False
    for a in range(len(graf) - RACHA_MAX + 1):
        tirada = graf[a:a + RACHA_MAX]
        for b in range(len(dichas) - RACHA_MAX + 1):
            if dichas[b:b + RACHA_MAX] == tirada:
                return True
    return False


ACTOS = [
    ("hook", 0.00, 0.10,
     ["headline-clipper", "kinetic-quote"]),
    ("nucleo1", 0.10, 0.42,
     ["definition-card", "data-diagram", "notification-pop"]),
    ("nucleo2", 0.42, 0.75,
     ["hero-stat", "odometro", "terminal", "code-mockup",
      "poll-rating", "notification-pop"]),
    ("outro", 0.75, 1.00,
     ["cierre-cta"]),
]

def capitulos_de(tr, D):
    """Los cuatro actos como capítulos, con el nombre sacado del guion.

    `capitulos.html` estaba en `ORDEN`, en `CROMO` y en el catálogo, y el
    director no la emitía NUNCA: `CROMO` es un conjunto que se declara en la
    línea 131 y que dentro de este fichero no lee nadie —solo lo miran
    `colocar.py` y una prueba de invariante—, así que no excluía de nada; y
    `capitulos` tampoco está en `INTENCIONES` ni en `NEUTRAS`. O sea que no la
    colocaba ni el reparto ni el cromo. Rediseñarla sin esto habría sido
    trabajo que no se ve, que es lo que el plan avisa para tres plantillas.

    Los actos ya existen y ya mandan: `ACTOS` reparte los gráficos y de él se
    derivan los tramos de cámara. Usarlos aquí no inventa una estructura, la
    ENSEÑA — y por eso la regla dice la verdad sobre la pieza en vez de ser
    una barra de progreso decorativa.

    El nombre sale de `clave()` sobre las palabras del acto, que es el mismo
    mecanismo con el que se rellena cualquier tarjeta. Un acto sin palabras
    —pasa en piezas muy cortas, donde el gancho es medio segundo— no puede
    nombrarse, y entonces no hay regla: es preferible no dibujarla a dibujar
    un capítulo llamado nada.
    """
    ws = tr.get("words", [])
    caps = []
    for nombre, ini, fin, _ in ACTOS:
        t0, t1 = ini * D, fin * D
        tramo = [w for w in ws if t0 <= w.get("start", 0) < t1]
        if not tramo:
            return []
        # Fuera las palabras que ABREN frase. `_peso` da +6 a la mayúscula
        # inicial —«nombre propio o marca»— y en una transcripción de Whisper
        # esa mayúscula la lleva también toda palabra que empieza oración, así
        # que el bono se dispara con cualquier verbo conjugado. Medido: el
        # cuarto capítulo salía «instalación Tienes», y «Tienes» ganaba por
        # seis puntos que solo estaban ahí porque había un punto delante.
        #
        # Se filtra AQUÍ y no dentro de `_peso` porque una palabra suelta no
        # puede saber si abre frase: hace falta la anterior, y eso solo lo
        # sabe quien tiene la lista en orden. Tocar `_peso` por su cuenta
        # habría cambiado además todos los titulares del catálogo.
        dentro, abre = [], True
        for w in tramo:
            if not abre:
                dentro.append(w["w"])
            abre = str(w["w"]).rstrip().endswith((".", "!", "?", "…"))
        if not dentro:
            return []
        # `_peso` y no `clave`: `clave` ordena por longitud pura y para un
        # TÍTULO eso elige mal —premia la palabra larga, no la que carga—.
        # `_peso` ya penaliza los colgantes y premia nombres propios, cifras
        # y sustantivos abstractos, que es exactamente lo que titula.
        vistas, mejores = set(), []
        for w in sorted(dentro, key=_peso, reverse=True):
            l = _limpia(w)
            b = sin_tildes(l).lower()
            if not l or b in vistas or _peso(w) < 4:
                continue
            vistas.add(b)
            mejores.append(l)
            if len(mejores) == 2:
                break
        if not mejores:
            return []
        caps.append({"nom": " ".join(mejores), "dur": round(t1 - t0, 3)})
    return caps


MIN_FIJO, MAX_FIJO = 2.5, 3.5     # segundos en pantalla por gráfico
# Aire mínimo entre el final de un gráfico y el principio del siguiente.
# Sin esto, el acto de gancho y el primer núcleo caían a 0,4 s uno de otro:
# formalmente son dos actos distintos, pero en pantalla es un bloque de
# siete segundos de tarjetas seguidas, que es justo lo que se quería quitar.
SEPARACION_MIN = 12.0
# Cuánto se puede retrasar un gráfico para no repetir el subtítulo, y con
# qué paso. Más de tres segundos y ya no acompaña a la frase que condensa.
DESPLAZA_MAX, DESPLAZA_PASO = 3.0, 0.4
CANDIDATOS_POR_ACTO = 6           # tramos que se prueban antes de rendirse

# --------------------------------------------------------------------------
# GUARDIAS SEMÁNTICAS
#
# Estas plantillas AFIRMAN algo sobre el guion: un `chapter-card` dice «esto
# es el paso 2», un `search-bar` dice «alguien preguntó esto». Ponerlas
# porque tocaba rellenar un hueco convierte el vídeo en una mentira
# pequeña pero constante. Solo salen si el guion lo dice.
# --------------------------------------------------------------------------
GUARDIAS = {
    "chapter-card": r"\b(paso|pasos|numero|n[uú]mero|primero|primera|segundo|"
                    r"segunda|tercero|tercera|clave|claves|error|errores|"
                    r"punto|apartado)\b",
    "split-versus": r"(frente a|versus|\bvs\b|antes y (ahora|despu[eé]s)|"
                    r"en vez de|a diferencia de|mientras que|en cambio)",
    "compare-ab":   r"(frente a|versus|\bvs\b|antes y (ahora|despu[eé]s)|"
                    r"en vez de|a diferencia de|mientras que|en cambio)",
    "terminal":     r"\b(comando|terminal|consola|script|c[oó]digo|shell|"
                    r"ffmpeg|python|node|npm|git|instala|ejecuta|compil)\b",
    "code-mockup":  r"\b(c[oó]digo|funci[oó]n|clase|variable|script|api|"
                    r"json|python|javascript|compil|implementa)\b",
}
# Estas exigen una pregunta literal, no una palabra suelta.
# `faq-card` no existe en templates/ y la guardia sobre ella era inofensiva
# pero mentía sobre el catálogo. Si algún día se crea, se vuelve a añadir.
PREGUNTA = {"search-bar"}


# Sitios que un globo puede señalar, con sus coordenadas. No es un atlas: es
# la lista de los que salen de verdad en un vídeo técnico en castellano. La
# clave va sin tildes y en minúscula porque así es como llega de `sin_tildes`.
#
# Existe para que la GUARDIA de `globo` pueda contar lugares. Un globo AFIRMA
# «esto pasa en estos sitios», y ponerlo porque tocaba rellenar un hueco es
# justo lo que §GUARDIAS SEMÁNTICAS llama una mentira pequeña pero constante.
# Con menos de dos lugares nombrados no hay nada que conectar y no hay globo.
LUGARES = {
    "madrid": (40.4, -3.7), "barcelona": (41.4, 2.2), "espana": (40.4, -3.7),
    "lisboa": (38.7, -9.1), "portugal": (38.7, -9.1),
    "londres": (51.5, -0.1), "reino unido": (51.5, -0.1),
    "paris": (48.9, 2.4), "francia": (48.9, 2.4),
    "berlin": (52.5, 13.4), "alemania": (52.5, 13.4),
    "frankfurt": (50.1, 8.7), "amsterdam": (52.4, 4.9),
    "dublin": (53.3, -6.3), "irlanda": (53.3, -6.3),
    "estocolmo": (59.3, 18.1), "europa": (50.0, 10.0),
    "nueva york": (40.7, -74.0), "washington": (38.9, -77.0),
    "virginia": (37.5, -78.7), "oregon": (44.0, -120.5),
    "san francisco": (37.8, -122.4), "california": (36.8, -119.4),
    "silicon valley": (37.4, -122.1), "seattle": (47.6, -122.3),
    "estados unidos": (39.8, -98.6), "eeuu": (39.8, -98.6),
    "mexico": (19.4, -99.1), "bogota": (4.7, -74.1), "colombia": (4.7, -74.1),
    "buenos aires": (-34.6, -58.4), "argentina": (-34.6, -58.4),
    "santiago": (-33.5, -70.7), "chile": (-33.5, -70.7),
    "sao paulo": (-23.6, -46.6), "brasil": (-15.8, -47.9),
    "tokio": (35.7, 139.7), "japon": (35.7, 139.7),
    "sel": (37.6, 127.0), "seul": (37.6, 127.0), "corea": (37.6, 127.0),
    "pekin": (39.9, 116.4), "shanghai": (31.2, 121.5), "china": (39.9, 116.4),
    "singapur": (1.35, 103.8), "india": (28.6, 77.2), "bangalore": (13.0, 77.6),
    "dubai": (25.2, 55.3), "tel aviv": (32.1, 34.8), "israel": (32.1, 34.8),
    "sidney": (-33.9, 151.2), "australia": (-33.9, 151.2),
    "ciudad del cabo": (-33.9, 18.4), "africa": (9.1, 18.4),
    "toronto": (43.7, -79.4), "canada": (45.4, -75.7),
}
# Ordenados de más largo a más corto: si no, «china» casaría dentro de
# «shanghai» —no, pero «espana» sí dentro de «espana»— y en general el nombre
# corto se comería el compuesto. «nueva york» tiene que ganar a «york».
_LUGARES_ORD = sorted(LUGARES, key=len, reverse=True)


def lugares_en(txt: str):
    """Los lugares del gazetteer que nombra el texto, en orden de aparición
    y sin repetir. Se busca sobre el texto SIN TILDES para que «Japón» y
    «Japon» sean el mismo sitio, que es como los escribe Whisper a medias."""
    base = sin_tildes(str(txt)).lower()
    hall = []
    for nom in _LUGARES_ORD:
        i = base.find(nom)
        if i < 0:
            continue
        # Palabra completa: sin esto, «india» casa dentro de «indianapolis» y
        # «sel» dentro de «seleccion», que es un error de verdad y no teórico.
        ini_ok = i == 0 or not base[i - 1].isalpha()
        j = i + len(nom)
        fin_ok = j >= len(base) or not base[j].isalpha()
        if ini_ok and fin_ok:
            hall.append((i, nom))
    vistos, fuera = set(), []
    for i, nom in sorted(hall):
        c = LUGARES[nom]
        if c in vistos:
            continue
        vistos.add(c)
        fuera.append((nom, c))
    return fuera


MIN_LUGARES = 2


def permite(tpl: str, txt: str) -> bool:
    """¿El guion justifica esta plantilla?"""
    if tpl in PREGUNTA:
        return "?" in txt or "¿" in txt
    if tpl == "globo":
        # La única guardia que CUENTA en vez de casar un patrón: un globo con
        # un solo punto no conecta nada, y con ninguno es un adorno giratorio.
        return len(lugares_en(txt)) >= MIN_LUGARES
    pat = GUARDIAS.get(tpl)
    return True if not pat else bool(re.search(pat, sin_tildes(txt), re.I)
                                     or re.search(pat, txt, re.I))


def riqueza(txt: str) -> int:
    """Cuánto sostiene un fragmento como momento gráfico. Cifras y nombres
    propios pesan: son lo que un gráfico puede mostrar mejor que la voz."""
    ws = [w for w in str(txt).split() if _limpia(w)]
    if len(ws) < 4:
        return -1
    n = len(ws)
    n += 4 * sum(1 for w in ws if any(c.isdigit() for c in w))
    n += 2 * sum(1 for w in ws[1:] if w[:1].isupper())
    n -= 3 * sum(1 for w in ws if sin_tildes(_limpia(w)) in COLGANTES) // 2
    return n



# --------------------------------------------------------------------------
# MICRO-FX POR PALABRA
#
# Otra clase de gráfico: duran menos de segundo y medio, se anclan a UNA
# palabra y no ocupan la pantalla como una tarjeta. Por eso viven en su
# propio carril y con su propio presupuesto — si entraran en el reparto de
# actos, volveríamos al problema que ese reparto vino a resolver.
#
# Siete de los veinte del catálogo YA existían con otro nombre: `odometro`,
# `highlighter-text`, `terminal`, `code-mockup`, `split-versus`,
# `notification-pop` y `search-bar`. No se duplican.
#
# Los disparadores se comparan SIN TILDES y con límites de palabra: «no» no
# puede casar dentro de «nota», y «jamás» tiene que casar escrito de las dos
# maneras que devuelve Whisper.
# --------------------------------------------------------------------------
MICRO_FX = [
    # 1 · Negación y error
    ("stroke-crossout",
     r"\b(no|jamas|nunca|olvida|olvidate|error|errores|fallo|fallos|"
     r"mito|mentira|falso)\b"),
    ("stamp-banned",
     r"\b(prohibido|ilegal|obsoleto|obsoleta|basura|roto|rota|muerto|"
     r"caducado|inservible)\b"),
    ("cut-strip",
     r"\b(cortar|corta|eliminar|elimina|reducir|reduce|simplificar|"
     r"simplifica|quitar|quita|borrar|borra)\b"),

    # 2 · Crecimiento y métricas
    ("green-spike",
     r"\b(crecer|crece|multiplicar|multiplica|escalar|escala|subir|sube|"
     r"disparar|dispara|exponencial|duplica|triplica)\b"),
    ("red-crash",
     r"\b(caer|cae|caida|perder|pierde|desplom\w*|bajar|baja|hundir|"
     r"hunde|cero)\b"),

    # 3 · Impacto y revelación
    ("head-explode",
     r"\b(explotar|explota|explosion|locura|brutal|flipas|flipante|"
     r"alucinante|increible|bestial)\b"),
    ("gold-glint",
     r"\b(oro|valor|top|premium|gratis|calidad|joya|tesoro|mejor)\b"),

    # 4 · Enfoque y análisis
    ("target-hud",
     r"\b(mira|mirad|fijate|fijaos|detalle|detalles|detectar|detecta|"
     r"especifico|concreto|exacto)\b"),
    ("neural-node-pulse",
     r"\b(ia|inteligencia|cerebro|pensar|piensa|razona|razonar|modelo|"
     r"modelos|agente|agentes|neuronal|red)\b"),

    # 5 · Estructura
    ("svg-checkmark",
     r"\b(correcto|correcta|funciona|funcionan|solucion|resuelto|"
     r"listo|lista|hecho|conseguido|perfecto)\b"),
    ("padlock-unlock",
     r"\b(truco|trucos|estrategia|desbloquear|desbloquea|acceso|"
     r"secreto|atajo)\b"),

    # 6 · Tiempo y volumen
    ("timer-ring",
     r"\b(rapido|rapida|urgente|segundos|minutos|deprisa|ya mismo|"
     r"en seguida|enseguida)\b"),
    ("text-stack-offset",
     r"\b(muchos|muchas|miles|millones|mapear|repetir|repite|multiples|"
     r"decenas|cientos|montones)\b"),
]

# Presupuesto propio. Sin él, «no» y «modelo» aparecen tantas veces en un
# guion técnico que el vídeo se llena de destellos: el efecto pasa de
# subrayar a ser ruido de fondo, que es exactamente lo que la regla de
# densidad de los actos vino a evitar.
MAX_MICRO = 6           # por pieza
SEP_MICRO = 7.0         # segundos entre dos micro-FX
GUARDA_TARJETA = 0.6    # aire alrededor de una tarjeta de acto


def micro_de(palabra: str):
    """Efecto que dispara esta palabra, o None."""
    b = sin_tildes(_limpia(palabra))
    for tpl, patron in MICRO_FX:
        if re.fullmatch(patron.replace("\\b", ""), b) or re.search(patron, b):
            return tpl
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", default=os.path.join(comun.build_dir(), "transcript.json"))
    ap.add_argument("--salida", default=os.path.join(comun.build_dir(), "plan.json"))
    ap.add_argument("--timeline", default=os.path.join(comun.build_dir(), "timeline.json"))
    ap.add_argument("--formato", default="9:16", choices=["9:16", "16:9", "1:1"])
    ap.add_argument("--tema", default="carbon")
    ap.add_argument("--max-fijo", type=float, default=4.0,
                    help="segundos máximos que una gráfica puede estar fija")
    ap.add_argument("--min-cambio", type=float, default=2.5,
                    help="segundos mínimos entre cambios visuales")
    # `--tope-uso` desaparece con el `tope` que no decidía nada. Una opción que
    # no cambia el resultado es peor que no tenerla: quien la pasa cree haber
    # ajustado algo. §13 fija cuatro gráficos por pieza y con eso ninguna
    # plantilla se repite; si algún día vuelve a hacer falta un tope, saldrá de
    # una regla y no de una división.
    ap.add_argument("--fondo", action="store_true",
                    help="añade la capa de fondo; NO usar si hay A-Roll "
                         "debajo, porque lo tapa por completo")
    ap.add_argument("--capitulos", action="store_true",
                    help="añade la regla de capítulos: los cuatro actos con "
                         "su nombre sacado del propio guion. Es una decisión "
                         "editorial fuerte —enseña el mapa del vídeo entero— "
                         "así que va como opción, igual que --fondo")
    ap.add_argument("--columna", type=float, default=None,
                    help="en 16:9, fracción del lienzo para los gráficos")
    ap.add_argument("--max-micro", type=int, default=MAX_MICRO,
                    help="micro-FX por pieza; §15 fija 6 y subirlo es una "
                         "decisión, no un ajuste: el mismo destello repetido "
                         "deja de subrayar y pasa a ser un tic del montaje")
    args = ap.parse_args()
    tope_micro = args.max_micro

    with open(args.transcript, encoding="utf-8") as f:
        tr = json.load(f)
    W, H = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}[args.formato]
    D = float(tr["duration"])
    fr = frases(tr["words"])
    disp = plantillas_disponibles()

    # ---------------- ritmo ----------------
    # Se parten las frases largas y se fusionan las muy cortas hasta que
    # todos los tramos caen en la ventana [min_cambio, max_fijo].
    tramos = []
    for f in fr:
        dur = f["fin"] - f["ini"]
        if dur > args.max_fijo:
            n = int(dur // args.max_fijo) + 1
            paso = dur / n
            for k in range(n):
                a = f["ini"] + k * paso
                b = f["ini"] + (k + 1) * paso
                # Cada fragmento se queda con SUS palabras, no con la frase
                # entera. Copiando el texto completo, dos fragmentos de la
                # misma frase producen dos gráficos idénticos seguidos:
                # variedad en la plantilla y repetición en el contenido,
                # que es lo peor de los dos mundos.
                dentro = [w["w"] for w in f.get("palabras", [])
                          if a <= (w["start"] + w["end"]) / 2 < b]
                tramos.append({"ini": a, "fin": b,
                               "txt": " ".join(dentro) or f["txt"]})
        else:
            tramos.append(dict(f))
    fusion = []
    for t in tramos:
        if fusion and (t["fin"] - fusion[-1]["ini"]) <= args.max_fijo \
                and (fusion[-1]["fin"] - fusion[-1]["ini"]) < args.min_cambio:
            fusion[-1]["fin"] = t["fin"]
            fusion[-1]["txt"] += " " + t["txt"]
        else:
            fusion.append(dict(t))
    tramos = fusion

    # ---------------- cámara ----------------
    # Los tramos se hacen CONTIGUOS antes de emitirlos. Si se dejaran
    # huecos, el compositor los cortaría y el reloj de salida dejaría de
    # coincidir con el de origen: los gráficos y los subtítulos, que van en
    # tiempos del original, se descuadrarían enteros. Es el aviso que ya
    # está escrito en CLAUDE.md sobre `keep.src_*` frente a `words`.
    # Además, las pausas de una locución llevan intención: quitarlas
    # aprieta el montaje pero se lleva por delante el ritmo del habla.
    for a, b in zip(tramos, tramos[1:]):
        a["fin"] = b["ini"]
    if tramos:
        tramos[0]["ini"] = 0.0
        tramos[-1]["fin"] = D

    keep = []
    for i, t in enumerate(tramos):
        keep.append({"src_start": round(t["ini"], 3), "src_end": round(t["fin"], 3),
                     "out_start": round(t["ini"], 3), "out_end": round(t["fin"], 3),
                     "zoom": zoom_de(i, len(tramos), t["ini"], D)})

    # ---------------- gráficos ----------------
    # El «tope de usos por plantilla» de §11 se calculaba aquí y no se usaba en
    # ninguna parte. No se resucita: §13 lo dejó OBSOLETO. Cuatro gráficos por
    # pieza significa que ninguna plantilla se repite, que es más estricto que
    # cualquier tope calculado, y eso es lo que aplica `candidatas_para`. Un
    # número que se calcula, se imprime en el informe y no decide nada hace
    # pensar que hay una regla activa donde no la hay.

    usos, ultima, capas, faltan = {}, None, [], set()
    # En apaisado los gráficos viven en una columna: se ENCOGEN a su
    # fracción y se desplazan para que su centro caiga en el centro de esa
    # columna. Solo desplazar los sacaría del cuadro.
    # `overlay` sitúa la ESQUINA de la capa, no su centro. Al escalar a la
    # fracción de la columna, la capa pasa a ocupar [0, W*col] y su centro
    # ya cae donde toca: el desplazamiento sobra. Aplicar los dos a la vez
    # —que es lo que hice primero— la saca del cuadro por la izquierda.
    dx, esc = 0, 1.0
    if args.formato == "16:9":
        col = args.columna if args.columna is not None else 0.44
        esc = col

    # ---------------- orquestación en cuatro actos ----------------
    # Un gráfico cada tres segundos no es ritmo: es ruido. El espectador
    # deja de mirar la cara —que es lo que sostiene el vídeo— y se pasa el
    # minuto leyendo tarjetas. La densidad se fija por ACTO, no por tramo:
    # el vídeo entero recibe cuatro o cinco gráficos y el resto es A-Roll
    # con los subtítulos cinéticos.
    # Por qué se queda vacío un acto. `faltan` solo recogía plantillas
    # ausentes del DISCO, así que un acto que no colocaba nada porque sus
    # candidatas estaban ya usadas, o porque una guardia semántica las
    # bloqueó, salía del director sin dejar rastro: el informe decía «3
    # gráficos» y §13 pide cuatro, y no había manera de saber cuál faltaba.
    actos_vacios: list[tuple[str, str]] = []
    for k_acto, (nombre_acto, f0, f1, preferidas) in enumerate(ACTOS):
        a0, a1 = f0 * D, f1 * D
        dentro = [(i, t) for i, t in enumerate(tramos)
                  if a0 <= t["ini"] < a1 and t["fin"] - t["ini"] >= MIN_FIJO]
        if not dentro:
            actos_vacios.append(
                (nombre_acto, "no hay ningún tramo de al menos %.1f s en su "
                              "ventana (%.1f-%.1f s)" % (MIN_FIJO, a0, a1)))
            continue
        # Dentro del acto se elige el tramo con más carga, no el primero:
        # el momento que merece un gráfico es el que dice algo, y en un
        # acto de veinte segundos rara vez es la frase de entrada.
        dentro.sort(key=lambda p: -riqueza(p[1]["txt"]))

        # UNA TARJETA PUEDE EMPEZAR DENTRO DE SU TRAMO, no solo en su primera
        # palabra. Exigir que el tramo ENTERO caiga después del aire mínimo era
        # demasiado estricto y hacía infactible §13 por granularidad, no por
        # presupuesto: medido sobre esta pieza, de las 120 combinaciones de un
        # tramo por acto NINGUNA cumplía el aire de 12 s, porque las fronteras
        # de tramo las pone el troceado en frases y no caen donde hace falta.
        # Permitiendo empezar dentro, hay solución con 12,00 s de aire exactos
        # entre las cuatro.
        #
        # No es una relajación nueva: el retraso por repetición de subtítulo ya
        # mueve el inicio dentro del tramo. Lo que se conserva es que la tarjeta
        # siga cayendo SOBRE esa frase, y de ahí el segundo de margen: una
        # tarjeta que entra 0,1 s antes de que la frase acabe no está sobre ella.
        fin_previo = capas[-1]["t"] + capas[-1]["duracion"] if capas else -99
        ini_minimo = fin_previo + SEPARACION_MIN
        antes_del_aire = len(dentro)
        dentro = [p for p in dentro
                  if max(p[1]["ini"], ini_minimo) <= p[1]["fin"] - 1.0]
        if not dentro:
            actos_vacios.append(
                (nombre_acto, "ninguno de sus %d tramo(s) llega a %.2f s con "
                              "un segundo de frase por delante (§13 pide %.0f s "
                              "de aire tras el gráfico anterior)"
                              % (antes_del_aire, ini_minimo, SEPARACION_MIN)))
            continue

        # PRESUPUESTO PARA LOS ACTOS QUE QUEDAN.
        #
        # Sin esto el reparto es voraz: cada acto coge su tramo más rico y se
        # queda con hasta 3,5 s, y los que vienen detrás se encuentran sin
        # sitio. En la pieza de referencia el `outro` se quedaba vacío **por 4
        # centésimas de segundo**: la tarjeta anterior acabó en 37,88 y la del
        # outro tendría que haber empezado en 49,88 con la pieza acabando en
        # 49,84. Con 49,8 s, cuatro tarjetas y 12 s de aire el margen total es
        # de un segundo y medio, así que basta con que un acto se estire un poco
        # para que el último no quepa — y el último es el del CTA.
        #
        # Cada acto reserva lo que necesitan los siguientes: por cada uno que
        # queda, su aire más la duración mínima de su tarjeta.
        restantes = len(ACTOS) - k_acto - 1
        reserva = restantes * (SEPARACION_MIN + MIN_FIJO)
        limite_ini = D - reserva - MIN_FIJO
        antes_del_presupuesto = len(dentro)
        if restantes:
            dentro = [p for p in dentro if p[1]["ini"] <= limite_ini]
        if not dentro:
            actos_vacios.append(
                (nombre_acto,
                 "sus %d tramo(s) empiezan después de %.2f s, y colocar ahí "
                 "dejaría sin sitio a los %d acto(s) que vienen detrás"
                 % (antes_del_presupuesto, limite_ini, restantes)))
            continue
        colocado = False
        for i, t in dentro[:CANDIDATOS_POR_ACTO]:
            if colocado:
                break
            _, cand = intencion_de(t["txt"])
            # Las preferidas del acto van primero, las de la intención después
            # —el acto manda sobre la frase— y al final el respaldo de la menos
            # usada del catálogo, que es lo que evita que un acto se quede sin
            # gráfico. El filtro de RELLENABLES y el de repetición van dentro.
            orden = candidatas_para(preferidas, cand, usos, ultima, disp,
                                    hay_cifra=bool(numeros(t["txt"])))
            for tpl in orden:
                if not permite(tpl, t["txt"]):
                    continue        # guardia semántica
                if tpl in REQUIERE_CIFRA and not numeros(t["txt"]):
                    continue
                cont = compensa(contenido_de(tpl, t["txt"], i) or {}, esc)
                if not cont and tpl in EXIGE_TEXTO:
                    continue

                # El inicio arranca en el tramo o en cuanto lo permita el aire,
                # lo que sea más tarde.
                arranque = max(t["ini"], ini_minimo)

                # Entre 2.5 y 3.5 s: menos no se lee, más se queda quieto
                # encima de la cara y el vídeo se para.
                #
                # Se mide desde el ARRANQUE y no desde el inicio del tramo. Con
                # `t["fin"] - t["ini"]` la tarjeta del cierre pedía 3,5 s
                # —el largo del tramo entero— arrancando 1,1 s dentro de él, así
                # que se salía de la pieza por 0,48 s y se descartaba con el
                # mensaje «ninguna candidata sirvió», que señalaba a la elección
                # de plantilla cuando el problema era aritmético.
                dur = max(MIN_FIJO, min(MAX_FIJO, t["fin"] - arranque))

                # Si la tarjeta repite lo que se lee abajo, se retrasa hasta
                # que esa frase haya pasado: la tarjeta condensa lo que
                # ACABA de decirse mientras el subtítulo sigue adelante.
                ini, ok = arranque, False
                for _ in range(int(DESPLAZA_MAX / DESPLAZA_PASO) + 1):
                    if not repite_subtitulo(cont, tr["words"], ini, ini + dur):
                        ok = True
                        break
                    ini += DESPLAZA_PASO
                if not ok or ini + dur > D:
                    continue        # sin hueco limpio: se prueba otra plantilla

                # La tarjeta se ENCOGE si estirarse dejaría sin sitio a los
                # actos que vienen detrás. Es la otra mitad del presupuesto:
                # reservar el hueco no basta si el acto anterior se come el
                # margen. En la pieza de referencia `nucleo1` se estiraba a
                # 3,10 s y con eso `nucleo2` se quedaba fuera por 0,44 s; con
                # 2,66 s entran los cuatro. Entre una tarjeta medio segundo más
                # corta y un acto sin gráfico, §13 no deja duda.
                #
                # Va DESPUÉS del retraso y no antes: la tarjeta empieza en
                # `ini`, no en `t["ini"]`, y con el retraso puesto la diferencia
                # llega a los 0,8 s que hacían que el recorte no se aplicara
                # justo cuando hacía falta. Encoger después es seguro: si con la
                # ventana larga no repetía el subtítulo, con una más corta
                # tampoco.
                if restantes and ini + dur > D - reserva:
                    dur = max(MIN_FIJO, (D - reserva) - ini)
                    if ini + dur > D - reserva:
                        continue    # ni con el mínimo cabe: otro tramo
                if capas and ini - (capas[-1]["t"] + capas[-1]["duracion"]) < SEPARACION_MIN:
                    continue        # el retraso se comió el aire con el anterior

                usos[tpl] = usos.get(tpl, 0) + 1
                ultima = tpl
                capa = {
                    "capa": "%s_%d" % (tpl.replace("-", ""), i),
                    "template": tpl + ".html",
                    "t": round(ini, 3),
                    "duracion": round(dur, 3),
                    "intencion": nombre_acto,
                    "parallax": 6 + (i % 3) * 4,
                    "sfx": SFX_POR_PLANTILLA.get(
                        tpl, SFX_POR_TIPO["entrada"])[0],
                    "sfxGain": SFX_POR_PLANTILLA.get(
                        tpl, SFX_POR_TIPO["entrada"])[1],
                    "config": dict({"tema": args.tema, "duration": round(dur, 3)},
                                   **cont),
                }
                # Una plantilla que publica sus propios cues (terminal y
                # code-mockup teclean solas) no lleva golpe de entrada
                # encima: capa.sfx SUMA al manifiesto (render_playwright
                # vuelca r.cues Y capa.sfx), así que aquí se restaba nada y
                # se doblaba el tecleo en toda pieza dirigida. leer_guion ya
                # lo evitaba; dirigir, que es de donde salió la tabla, no.
                if sonidos_propios(tpl) is not None:
                    del capa["sfx"], capa["sfxGain"]
                if dx:
                    capa["dx"] = dx
                if esc != 1.0:
                    capa["escala"] = round(esc, 4)
                # Refracción real. Sin esto la plantilla se captura sobre alfa
                # vacío y su `.cristal` queda en una pastilla gris: el
                # mecanismo existe desde la tanda 9 y nunca se había emitido.
                if tpl in CRISTAL:
                    capa["cristal"] = True
                    capa.update(CRISTAL[tpl])
                capas.append(capa)
                colocado = True
                break
        if not colocado:
            faltan.update(c for c in preferidas if c not in disp)
            ausentes = [c for c in preferidas if c not in disp]
            actos_vacios.append(
                (nombre_acto,
                 "ninguna candidata sirvió" + (
                     " (faltan en templates/: %s)" % ", ".join(ausentes)
                     if ausentes else
                     " — estaban ya usadas, las bloqueó una guardia semántica "
                     "o no salía copia limpia")))

    capas.sort(key=lambda c: c["t"])
    # Cuántas TARJETAS DE ACTO hay, medido aquí y no al final: después de esta
    # línea se añaden los micro-FX y el cromo, y contar `capas` al final daba
    # cinco donde §13 cuenta tres.
    tarjetas_de_acto = len(capas)


    # ---------------- micro-FX por palabra ----------------
    # Carril aparte del reparto de actos: son acentos de menos de segundo y
    # medio anclados a una palabra, no tarjetas. Se emiten DESPUÉS para
    # poder esquivar las tarjetas ya colocadas.
    DUR_MICRO = {"stroke-crossout": 1.0, "stamp-banned": 1.4, "cut-strip": 1.3,
                 "green-spike": 1.2, "red-crash": 1.1, "head-explode": 1.1,
                 "gold-glint": 1.3, "target-hud": 1.3,
                 "neural-node-pulse": 1.4, "svg-checkmark": 1.2,
                 "padlock-unlock": 1.3, "timer-ring": 1.4,
                 "text-stack-offset": 1.2}
    # Los que PINTAN la palabra que los dispara. El resto son icónicos y
    # ponerles texto sería repetir lo que se está oyendo.
    CON_TEXTO = {"stroke-crossout", "stamp-banned", "cut-strip",
                 "gold-glint", "text-stack-offset"}
    # `SFX_MICRO` vive a nivel de módulo, junto a `SFX_POR_PLANTILLA`: la
    # comparte `leer_guion.py`. El porqué de cada mapeo está sobre la tabla.

    micros, usados_fx, ult_t = [], set(), -99.0
    # Se cuentan los que se quedan fuera por presupuesto, no solo los que
    # entran. Truncar en silencio hace que el informe diga «6 micro-FX» tanto
    # si el guion daba para 6 como si daba para 20, y son dos situaciones
    # distintas: en la segunda hay que subir el tope o mirar por qué el
    # material dispara tanto.
    descartados_por_tope = []
    for w in tr["words"]:
        tpl_posible = micro_de(w["w"])
        if len(micros) >= tope_micro:
            if tpl_posible and tpl_posible in disp and tpl_posible not in usados_fx:
                descartados_por_tope.append(
                    {"t": round(float(w["start"]), 2), "palabra": w["w"],
                     "plantilla": tpl_posible})
            continue
        tpl = micro_de(w["w"])
        if not tpl or tpl not in disp:
            continue
        # Cada efecto una sola vez: el mismo destello tres veces deja de
        # significar algo y pasa a ser un tic del montaje.
        if tpl in usados_fx:
            continue
        t0 = float(w["start"])
        dur = DUR_MICRO.get(tpl, 1.2)
        if t0 - ult_t < SEP_MICRO or t0 + dur > D:
            continue
        # Nunca encima de una tarjeta de acto.
        if any(t0 < c["t"] + c["duracion"] + GUARDA_TARJETA
               and c["t"] - GUARDA_TARJETA < t0 + dur for c in capas):
            continue

        cfg = {"tema": args.tema, "duration": round(dur, 3), "y": 760}
        if tpl in CON_TEXTO:
            cfg["texto"] = _limpia(w["w"]).upper()
        if tpl in ("head-explode", "target-hud", "neural-node-pulse",
                   "svg-checkmark", "padlock-unlock", "timer-ring"):
            cfg["x"] = 540
            cfg["y"] = 700
        # La misma guarda que en las tarjetas: un micro que publique sus
        # propios cues no lleva golpe de entrada encima.
        if sonidos_propios(tpl) is not None:
            sfx, gan = None, None
        else:
            sfx, gan = SFX_MICRO.get(tpl, ("aparicion", 0.7))
        micro = {
            "capa": "%s_fx%d" % (tpl.replace("-", ""), len(micros)),
            "template": tpl + ".html",
            "t": round(t0, 3), "duracion": round(dur, 3),
            "intencion": "micro",
            "config": compensa(cfg, esc),
        }
        if sfx is not None:
            micro["sfx"], micro["sfxGain"] = sfx, gan
        micros.append(micro)
        usados_fx.add(tpl)
        ult_t = t0 + dur

    capas += micros
    capas.sort(key=lambda c: c["t"])

    faltan |= {c for _, _, cs in INTENCIONES for c in cs if c not in disp}

    # ---------------- cromo ----------------
    # Un plan sin subtítulos no es un vídeo, es una colección de tarjetas.
    # El fondo solo se añade si NO hay metraje debajo: sobre A-Roll tapa.
    # Aquí se agrupaban las palabras en bloques de karaoke, y el resultado no se
    # usaba en ningún sitio: el director emite subtítulos CINÉTICOS, que llevan
    # la lista plana de palabras, y `tl["blocks"]` se escribe siempre vacío. El
    # cómputo estaba muerto. Se quita en vez de dejarlo: código que parece
    # producir algo y no lo produce es lo que hace pensar que una función existe.
    # Si algún día un plan pide `karaoke-subs`, los bloques los calcula
    # `clean_transcript.bloques_karaoke`, que es donde viven de verdad.
    if args.fondo:
        plan_final = [{"capa": "fondo", "template": "fondo.html", "t": 0,
                       "duracion": round(D, 3), "fps": 5,
                       "config": {"tema": args.tema, "duration": round(D, 3),
                                  "blobs": 0.85, "grano": 0.55}}]
    else:
        plan_final = []
    plan_final += capas
    if args.capitulos:
        caps_reg = capitulos_de(tr, D)
        if caps_reg:
            plan_final.append({
                "capa": "capitulos", "template": "capitulos.html",
                # `fps: 8` y no 30: la regla solo mueve un índice y un peso.
                # A 30 son 660 PNG para una pieza de 22 s que se ven igual.
                "t": 0, "duracion": round(D, 3), "fps": 8,
                "config": {"tema": args.tema, "duration": round(D, 3),
                           "capitulos": caps_reg, "y": 118,
                           "restante": False, "opacidad": 0.82}})
        else:
            print("  · sin regla de capítulos: algún acto se queda sin "
                  "palabras con carga y un capítulo sin nombre no se dibuja",
                  file=sys.stderr)
    # Subtítulos CINÉTICOS: grupos de 1-3 palabras con entrada elástica,
    # en vez del karaoke por bloques. El karaoke sigue existiendo para
    # quien lo quiera; el director usa el cinético por defecto.
    plan_final.append({
        "capa": "kineticcaptions", "template": "kinetic-captions.html",
        "t": 0, "duracion": round(D, 3),
        "config": {"tema": args.tema, "duration": round(D, 3),
                   "zona": "abajo", "max": 3,
                   "tam": 62 if H < 1400 else 96,
                   # Ventanas en las que hay una tarjeta en pantalla. Dentro
                   # de ellas los subtítulos bajan a la franja fija de 150 px
                   # y no escalan: dos capas de texto compitiendo por la
                   # mirada es peor que cualquiera de las dos sola.
                   "ventanas": [{"ini": round(c["t"], 2),
                                 "fin": round(c["t"] + c["duracion"], 2)}
                                for c in capas],
                   "palabras": [{"w": w["w"], "ini": round(w["start"], 2),
                                 "fin": round(w["end"], 2)}
                                for w in tr["words"]]}})

    plan = plan_final
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)

    tl = {"source": tr.get("source", "build/base.mp4"), "language": "es",
          "duration_original": D, "duration_final": D, "keep": keep,
          "words": [{"w": w["w"], "start": w["start"], "end": w["end"]}
                    for w in tr["words"]],
          "blocks": [], "stats": {"cortes": len(keep)}}
    # SELLADO. `contratos.py` exige `reloj` en `timeline.json` y este fichero
    # lo escribía sin él: el timeline que produce el director INCUMPLE el
    # contrato del director. No saltaba porque el flujo normal pasa por
    # `clean_transcript.py`, que sí sella, y el de aquí solo se ve cuando se
    # dirige sin limpiar antes — que es exactamente el caso en que más falta
    # hace saber en qué reloj están estas palabras.
    #
    # Y son de ORIGEN: salen de `tr["words"]`, la transcripción cruda, sin
    # pasar por ningún mapa. Es la regla de CLAUDE.md.
    tl = reloj.sella(tl, "origen")
    with open(args.timeline, "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=1)

    # ---------------- informe ----------------
    huecos = sum(1 for i in range(int(D)) if not any(
        c["t"] <= i < c["t"] + c["duracion"] for c in capas))
    dur_media = sum(c["duracion"] for c in capas) / max(1, len(capas))
    print(json.dumps({
        "plan": args.salida,
        "timeline": args.timeline,
        "formato": "%dx%d" % (W, H),
        "tramos": len(tramos),
        "graficos": len(capas),
        "duracion_media_grafico": round(dur_media, 2),
        "cambio_visual_cada_s": round(D / max(1, len(capas)), 2),
        "plantillas_distintas": len(usos),
        "mas_repetida": max(usos.values()) if usos else 0,
        "reparto": dict(sorted(usos.items(), key=lambda x: -x[1])),
        "zooms": {str(z): sum(1 for k in keep if k["zoom"] == z)
                  for z in sorted({k["zoom"] for k in keep})},
        "segundos_sin_grafico": huecos,
        "plantillas_que_faltan": sorted(faltan),
        "tarjetas_de_acto": tarjetas_de_acto,
        "actos_sin_grafico": [n for n, _ in actos_vacios],
        "microfx": len(micros),
        "microfx_descartados_por_tope": len(descartados_por_tope),
    }, indent=2, ensure_ascii=False))

    # Los avisos van por stderr y CUENTAN como fallo. Antes esta función
    # devolvía 0 siempre, así que de una pasada del director solo se podía
    # afirmar «salió 0», que era cierto incluso cuando el informe decía que
    # faltaban plantillas o que había veinte segundos sin nada en pantalla.
    # Un pipeline encadenado necesita poder pararse aquí.
    avisos = []
    if faltan:
        avisos.append(
            "faltan %d plantilla(s) que el reparto pedía: %s.\n"
            "     Créalas en templates/ o quítalas de las listas de "
            "candidatas de este script." % (len(faltan), ", ".join(sorted(faltan))))
    if descartados_por_tope:
        d = descartados_por_tope
        avisos.append(
            "%d micro-FX descartados por el tope de %d (§15). Primeros: %s.\n"
            "     Si el guion da para más, súbelo con --max-micro; si no, es "
            "que el material dispara demasiado y hay que revisar los "
            "disparadores."
            % (len(d), tope_micro,
               ", ".join("«%s» -> %s" % (x["palabra"], x["plantilla"])
                         for x in d[:3])))
    if actos_vacios:
        avisos.append(
            "%d de %d actos sin gráfico (§13 pide uno por acto):\n%s"
            % (len(actos_vacios), len(ACTOS),
               "\n".join("       · %s: %s" % (n, por) for n, por in actos_vacios)))

    for a in avisos:
        print("  ⚠ %s" % a, file=sys.stderr)
    return 1 if avisos else 0


if __name__ == "__main__":
    sys.exit(main())
