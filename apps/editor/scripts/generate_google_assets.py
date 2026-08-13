#!/usr/bin/env python3
"""Genera B-Rolls PNG 9:16 con el SDK oficial de Google GenAI.

Lee el timeline limpio, detecta los momentos que piden apoyo visual y
sintetiza una imagen por cada uno, siempre bajo la guía Obsidian
Cyber-Tech para que el vídeo entero se vea del mismo mundo.

Requiere una clave:  GEMINI_API_KEY  o  GOOGLE_GENAI_API_KEY

Modelos (configurables; verifica los IDs vigentes en ai.google.dev,
cambian con frecuencia):
    --model gemini-2.5-flash-image     imagen conversacional ("nano banana")
    --model imagen-4.0-generate-001    Imagen, mayor fidelidad fotográfica

Uso:
    python3 scripts/generate_google_assets.py --timeline build/timeline.json
    python3 scripts/generate_google_assets.py --dry-run      # solo prompts
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

import comun

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
ASSETS = os.path.join(RAIZ, "assets", "broll")

# ---------------------------------------------------------------------------
#  Guía de estilo. Se antepone a TODO prompt: es lo que da coherencia visual.
# ---------------------------------------------------------------------------
ESTILO = (
    "Carbon & Bronze visual style. Deep carbon black background (#121212) "
    "with brushed graphite surfaces (#1E1E24). The only accent is brushed "
    "bronze and warm copper metal (#CD7F32 / #B87333), appearing as polished "
    "metal surfaces, machined edges and warm rim light. Sober, formal, "
    "restrained and premium — like high-end industrial product photography. "
    "Precise geometry, carbon fibre and anodised metal textures, soft "
    "directional studio lighting, shallow depth of field, fine micro detail, "
    "low saturation. "
    "NO neon, no glowing cyan or magenta, no sci-fi holograms, no lens "
    "flares, no digital rain. "
    "Absolutely no text, no letters, no logos, no watermarks, no UI labels. "
    "Vertical 9:16 composition, subject off-centre, lower third kept clean "
    "and uncluttered for subtitles."
)

NEGATIVO = ("text, words, letters, typography, watermark, logo, signature, "
            "neon, cyberpunk, glowing blue, magenta, teal, lens flare, "
            "oversaturated, cluttered, low quality, blurry, jpeg artifacts")

# --- Reglas de correspondencia guión -> recurso (BRAND_RULES §5) ---
# Los temas que tienen plantilla propia NO se mandan a la API: quedan
# mejor y salen gratis como motion graphic vectorial.
TEMAS_PLANTILLA = {
    "code-mockup": ["código", "codigo", "función", "funcion", "script",
                    "programa", "comando", "terminal", "librería", "libreria"],
    "data-diagram-nodos": ["arquitectura", "red", "redes", "agente", "agentes",
                           "flujo", "pipeline", "sistema", "estructura",
                           "conexión", "conexion"],
    "data-diagram-tabla": ["métrica", "metrica", "métricas", "metricas",
                           "comparativa", "rendimiento", "benchmark",
                           "velocidad", "coste", "tiempo", "porcentaje"],
}

# Temas para B-Roll fotorrealista, ya en clave Carbon & Bronze
CONCEPTOS = {
    "gpu": "a machined silicon processor on brushed bronze, macro, studio lit",
    "chip": "a macro shot of a processor die resting on dark carbon fibre",
    "modelo": "an abstract sculpture of interlocking bronze rings on carbon",
    "ia": "abstract bronze geometric lattice on a deep carbon surface",
    "vídeo": "a cinema camera body in dark anodised metal with bronze accents",
    "video": "a cinema camera body in dark anodised metal with bronze accents",
    "audio": "a precision studio microphone in brushed bronze, dark backdrop",
    "local": "a compact aluminium laptop closed on a carbon fibre desk",
    "mac": "a closed dark aluminium laptop on carbon fibre, warm rim light",
    "nube": "an empty dark server rack, powered down, cold and distant",
    "tiempo": "a machined bronze mechanical timepiece movement, macro",
}


def clasificar(texto: str):
    """Devuelve (tipo, detalle) según las reglas de correspondencia."""
    for plantilla, claves in TEMAS_PLANTILLA.items():
        if any(k in texto for k in claves):
            return "plantilla", plantilla
    for clave, desc in CONCEPTOS.items():
        if clave in texto:
            return "broll", desc
    return "broll", None


def escenas_desde_timeline(tl: dict, cada: float, maximo: int,
                           avisos: list | None = None) -> list[dict]:
    """Recorre el guión y decide qué recurso pide cada tramo.

    No todo va a la API: si el tema encaja con una plantilla (código,
    arquitectura, métricas) se marca como tal y se genera en vectorial,
    que queda más limpio y no cuesta llamadas.
    """
    bloques = tl.get("blocks") or []
    if not bloques:
        return []

    escenas, siguiente = [], 0.0
    for b in bloques:
        if b["ini"] < siguiente:
            continue
        texto = " ".join(p["w"] for p in b["palabras"]).lower()
        tipo, detalle = clasificar(texto)

        escena = {
            "id": "escena_%02d" % (len(escenas) + 1),
            "t": round(b["ini"], 2),
            "dur": round(max(1.5, b["fin"] - b["ini"]), 2),
            "texto": texto,
            "tipo": tipo,
        }
        if tipo == "plantilla":
            escena["plantilla"] = detalle
        else:
            if detalle is None:
                largas = sorted(
                    (re.sub(r"\W", "", p["w"].lower()) for p in b["palabras"]),
                    key=len, reverse=True)
                concepto = largas[0] if largas else "technology"
                detalle = ("an abstract still life evoking '%s', machined "
                           "bronze forms on carbon" % concepto)
            escena["prompt"] = "%s %s" % (detalle, ESTILO)
        escenas.append(escena)

        siguiente = b["ini"] + cada
        if len(escenas) >= maximo:
            # Se dice cuánto se queda fuera. Cortar en silencio hacía que el
            # informe dijera «8 escenas» tanto si el guion daba para 8 como
            # si daba para 40, y en el segundo caso el vídeo se queda sin
            # B-Roll en toda su segunda mitad sin que nada lo delate.
            restantes = sum(1 for x in bloques if x["ini"] >= siguiente)
            if restantes and avisos is not None:
                avisos.append(
                    "tope de %d escenas alcanzado en el segundo %.1f: quedan "
                    "%d bloque(s) sin B-Roll, o sea el resto de la pieza.\n"
                    "     Súbelo con --max si la API lo aguanta."
                    % (maximo, b["ini"], restantes))
            break
    return escenas


def despejar_plan_ajeno(plan: str, timeline: str, modelo: str) -> None:
    """Que abortar sin escribir no deje vivo el plan de OTRA pieza.

    Salir con 4 por falta de clave parecía limpio y no lo era: hasta ese punto
    no se había escrito nada, así que el `broll_plan.json` de la pieza
    ANTERIOR seguía en `build/` y el compositor lo consumía — escenas de otra
    narración, en los instantes de otra pieza, sin un error en ninguna etapa.
    `comprobar_montaje.py` no cubre este fichero: casa plan, manifiesto y
    fotogramas por su CONTENIDO, sin ningún campo de identidad, y el plan de
    B-Roll no participa en esa comparación.

    Sin campo de sellado de montaje que casar, el criterio es el MTIME contra
    el timeline —documentado aquí para converger con `leer_guion.py`, que
    también escribe artefactos de la pieza—:

      · plan MÁS NUEVO que el timeline → es de ESTE montaje (lo escribió una
        pasada anterior con clave, un `--dry-run` o el guion): se respeta;
      · plan más viejo, o ausente → se sustituye por uno VACÍO y sellado.
        `escenas: []` es «no hay B-Roll» para `contratos.broll` y para el
        compositor, no un error, así que ninguna etapa posterior tropieza.

    El sello sigue siendo `reloj: "origen"`, como todo plan que escribe este
    script: con cero escenas no hay nada que remapear, pero un artefacto sin
    declarar reloj es exactamente lo que `reloj.exige_reloj` existe para
    impedir.
    """
    if os.path.exists(plan) and \
            os.path.getmtime(plan) >= os.path.getmtime(timeline):
        return
    habia = os.path.exists(plan)
    with open(plan, "w", encoding="utf-8") as f:
        json.dump({"reloj": "origen", "model": modelo, "escenas": []}, f,
                  ensure_ascii=False, indent=2)
    if habia:
        print("el broll_plan.json de build/ era más viejo que el timeline — "
              "es de OTRA pieza.\n"
              "  Se sustituye por un plan vacío sellado para que el "
              "compositor no lo consuma;\n"
              "  el de esta pieza lo escribe:  "
              "python3 scripts/generate_google_assets.py "
              "--timeline %s" % timeline, file=sys.stderr)


def cliente():
    clave = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_GENAI_API_KEY")
    if not clave:
        print("Falta la clave. Exporta una de estas:\n"
              "  export GEMINI_API_KEY=...\n"
              "  export GOOGLE_GENAI_API_KEY=...\n"
              "Consíguela en https://aistudio.google.com/apikey", file=sys.stderr)
        sys.exit(4)
    try:
        from google import genai
    except ImportError:
        print("falta el SDK. Instala con:  pip install google-genai",
              file=sys.stderr)
        sys.exit(3)
    return genai, genai.Client(api_key=clave)


def guardar_imagenes(resp, destino_base: str) -> list[str]:
    """El SDK devuelve la imagen en sitios distintos según el modelo.
    Se cubren las dos formas en vez de asumir una."""
    escritos = []

    # forma A: generate_images -> resp.generated_images[].image
    for i, gi in enumerate(getattr(resp, "generated_images", None) or []):
        img = getattr(gi, "image", None)
        if img is None:
            continue
        ruta = "%s.png" % destino_base if i == 0 else "%s_%d.png" % (destino_base, i)
        if hasattr(img, "save"):
            img.save(ruta)
        elif getattr(img, "image_bytes", None):
            with open(ruta, "wb") as f:
                f.write(img.image_bytes)
        else:
            continue
        escritos.append(ruta)
    if escritos:
        return escritos

    # forma B: generate_content -> candidates[].content.parts[].inline_data
    for cand in (getattr(resp, "candidates", None) or []):
        partes = getattr(getattr(cand, "content", None), "parts", None) or []
        for i, parte in enumerate(partes):
            datos = getattr(parte, "inline_data", None)
            if datos is None or not getattr(datos, "data", None):
                continue
            ruta = "%s.png" % destino_base if not escritos else \
                   "%s_%d.png" % (destino_base, i)
            with open(ruta, "wb") as f:
                f.write(datos.data)
            escritos.append(ruta)
    return escritos


def generar(genai, client, modelo: str, prompt: str, destino_base: str) -> list[str]:
    from google.genai import types

    if modelo.startswith("imagen"):
        resp = client.models.generate_images(
            model=modelo,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="9:16",
                negative_prompt=NEGATIVO,
            ),
        )
    else:
        resp = client.models.generate_content(
            model=modelo,
            contents=prompt + " Vertical 9:16 aspect ratio.",
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )
    return guardar_imagenes(resp, destino_base)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(BUILD, "timeline.json"))
    ap.add_argument("--model", default="gemini-2.5-flash-image")
    ap.add_argument("--cada", type=float, default=9.0,
                    help="segundos mínimos entre B-Rolls")
    ap.add_argument("--max", type=int, default=8, help="tope de assets")
    ap.add_argument("--outdir", default=ASSETS)
    ap.add_argument("--dry-run", action="store_true",
                    help="escribe los prompts y no llama a la API")
    args = ap.parse_args()

    if not os.path.exists(args.timeline):
        print("falta %s — ejecuta antes clean_transcript.py" % args.timeline,
              file=sys.stderr)
        return 2

    with open(args.timeline, encoding="utf-8") as f:
        tl = json.load(f)
    plan = os.path.join(BUILD, "broll_plan.json")

    avisos_tope: list[str] = []
    escenas = escenas_desde_timeline(tl, args.cada, args.max, avisos_tope)
    if not escenas:
        # Salir sin escribir dejaría vivo el plan de la pieza anterior; para
        # un timeline sin habla, el plan coherente ES el vacío.
        despejar_plan_ajeno(plan, args.timeline, args.model)
        print("el timeline no tiene bloques de habla; nada que ilustrar",
              file=sys.stderr)
        return 2
    for a in avisos_tope:
        print("  ⚠ %s" % a, file=sys.stderr)

    os.makedirs(args.outdir, exist_ok=True)
    a_generar = [e for e in escenas if e["tipo"] == "broll"]
    con_plantilla = [e for e in escenas if e["tipo"] == "plantilla"]

    def guardar_plan():
        with open(plan, "w", encoding="utf-8") as f:
            # Las escenas salen del `blocks` del timeline, que va en reloj de
            # ORIGEN, así que este plan también. `silencios.py --aplicar` lo
            # pasa a salida y lo vuelve a sellar; el compositor lo exige.
            # Sin el sello, el B-Roll heredaba la deriva entera del reloj sin
            # que nada lo dijera — y esta es la única ruta del fallo que
            # llegaba al compositor, no solo a los píxeles de los subtítulos.
            json.dump({"reloj": "origen",
                       "model": args.model, "escenas": escenas}, f,
                      ensure_ascii=False, indent=2)

    if args.dry_run:
        guardar_plan()
        print(json.dumps({"dry_run": True, "plan": plan,
                          "total": len(escenas),
                          "a_la_api": len(a_generar),
                          "resueltas_con_plantilla": len(con_plantilla)},
                         ensure_ascii=False, indent=2))
        for e in con_plantilla:
            print("\n[%s] t=%ss  -> plantilla %s\n  «%s»"
                  % (e["id"], e["t"], e["plantilla"], e["texto"][:60]))
        for e in a_generar:
            print("\n[%s] t=%ss  -> B-Roll\n  %s..."
                  % (e["id"], e["t"], e["prompt"][:150]))
        return 0

    if not a_generar:
        guardar_plan()
        print("todas las escenas se resuelven con plantillas; no hace falta la API")
        return 0

    # ANTES de pedir el cliente: `cliente()` aborta si faltan la clave (4) o
    # el SDK (3), y hasta aquí no se ha escrito nada. El guard va fuera de
    # `cliente()` a propósito: así cubre los dos abortos, y también un fallo
    # inesperado a mitad de generación — el plan vacío ya está en disco y
    # `guardar_plan()` lo sobrescribe con el bueno si se llega al final.
    despejar_plan_ajeno(plan, args.timeline, args.model)
    genai, client = cliente()
    hechos = []
    for e in a_generar:
        base = os.path.join(args.outdir, e["id"])
        try:
            rutas = generar(genai, client, args.model, e["prompt"], base)
            if not rutas:
                raise RuntimeError("la respuesta no traía ninguna imagen")
            e["files"] = rutas
            hechos.append(e)
            print("  ✓ %s -> %s" % (e["id"], os.path.basename(rutas[0])),
                  file=sys.stderr)
        except Exception as exc:
            e["error"] = str(exc)
            print("  ✗ %s: %s" % (e["id"], exc), file=sys.stderr)

    guardar_plan()
    print(json.dumps({"plan": plan, "generados": len(hechos),
                      "fallidos": len(a_generar) - len(hechos),
                      "resueltas_con_plantilla": len(con_plantilla),
                      "carpeta": args.outdir}, ensure_ascii=False, indent=2))
    return 0 if hechos else 1


if __name__ == "__main__":
    sys.exit(main())
