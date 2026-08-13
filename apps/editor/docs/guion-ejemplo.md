# Guion — «Claude Opus 5» · 30 s vertical

Pieza de demostración: **sin A-Roll**, todo motion graphics sobre fondo
Carbon & Bronze. Sirve además como prueba de carga del pipeline, porque usa
las seis plantillas, el LUT y la cadena completa.

---

## Locución

| # | Texto | ≈ |
|---|---|---|
| 1 | Claude Opus 5. | 0–2 s |
| 2 | El modelo más capaz de la familia Claude 5. | 2–6 s |
| 3 | Hasta un millón de tokens de contexto: un repositorio entero, sin trocearlo. | 6–13 s |
| 4 | Razona sobre código complejo y mantiene el hilo donde otros lo pierden. | 13–19 s |
| 5 | Está en Claude Code, en la API y en la web. | 19–23 s |
| 6 | Y este vídeo lo ha montado él: transcripción, corte, motion graphics y color. | 23–28 s |
| 7 | Todo en local. En un MacBook Pro. | 28–30 s |

Texto plano para el TTS:

> Claude Opus 5. El modelo más capaz de la familia Claude 5. Hasta un millón
> de tokens de contexto: un repositorio entero, sin trocearlo. Razona sobre
> código complejo y mantiene el hilo donde otros lo pierden. Está en Claude
> Code, en la API y en la web. Y este vídeo lo ha montado él: transcripción,
> corte, motion graphics y color. Todo en local. En un MacBook Pro.

---

## Escaleta visual

| Tramo | Capa | Contenido |
|---|---|---|
| 0–5 s | **kicker-hud** | Kicker `ANTHROPIC` · Titular «Claude *Opus 5*» · `[ CLAUDE 5 ]` |
| 4–11 s | **pip-frame** | Marco con badge `[ 1M CONTEXTO ]` sobre el fondo |
| 10–17 s | **code-mockup** | `main.py` — llamada real al modelo `claude-opus-5` |
| 16–23 s | **data-diagram** (nodos) | La familia: Opus 5 · Sonnet 5 · Fable 5 · Haiku 4.5 |
| 22–27 s | **data-diagram** (tabla) | Etapas de este mismo montaje con tiempos medidos |
| 26–30 s | **pills** | `/transcribe` · `/motion` · `LOCAL` |
| 0–30 s | **karaoke-subs** | Palabra a palabra, sincronizado con la locución |

Fondo: carbón `#121212` con rejilla en deriva lenta y una veladura de bronce
que respira. Nada de movimiento agresivo — la marca es sobria.

---

## Verificación de datos

Solo se afirma lo comprobable. **No hay benchmarks inventados.**

| Afirmación | Base |
|---|---|
| Familia Claude 5; Opus 5 el más capaz | Conocido |
| Hasta 1M de tokens de contexto | Variante `claude-opus-5[1m]` |
| Disponible en Claude Code | Conocido |
| ID de modelo `claude-opus-5` | Conocido |
| Tiempos de la tabla | **Medidos en esta máquina**, no estimados |

La tabla usa los tiempos reales del pipeline sobre `testAI.mov`, no cifras
de adorno: si aparece un número en pantalla, salió de una ejecución.
