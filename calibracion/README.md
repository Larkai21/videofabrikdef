# Conjunto etiquetado de planos

`planos-etiquetados.jsonl` — 25 beats de un vídeo real (`ygbmXSZhMbhaogwnk_2xA`)
con sus candidatos, el plano que eligió un humano y, sobre todo, **qué planos
serían aceptables**.

Esa segunda etiqueta es la que sirve. «Coincide con la elección del humano» es
demasiado estricta: con cinco planos casi iguales, elegir el tercero en vez del
cuarto no es un error. Lo que se nota en pantalla es el plano que NO pega —un
estudio de radio con el cartel «ON AIR» sobre una frase que habla de un informe
legal— y eso es lo que mide `aceptables`.

Un beat tiene `aceptables: []`: ninguno de sus cinco candidatos ilustraba el
gancho. Es un caso legítimo y la regla que lo detecta acierta al decir «ninguno».

## Cómo usarlo

    pnpm rerank              # compara reglas de ordenación (sin gastar llamadas)
    pnpm rerank --juez       # incluye el juez LLM (una llamada, ~7.500 tokens)
    pnpm rerank --detalle    # además, en qué beat falla cada regla

## Resultados (1-ago-2026)

| regla                  | acierto@1 | sin disparate |
|------------------------|-----------|---------------|
| pipeline (orden actual)| 13/24     | **17/25 (68 %)** |
| coseno crudo           |  6/24     | 18/25 |
| penalizar lo genérico  |  4/24     | 18/25 |
| contra la narración    |  8/24     | 19/25 |
| juez que lee (LLM)     | 10-12/24  | **24/25 (96 %)** |

La lectura importante no es que el juez gane, es que **ninguna combinación de
los números del embedding despega**. Los seis candidatos de un beat caben en
0,037 de coseno y el suelo de e5 para pares no relacionados es 0,72-0,78: el
pool entero aterriza justo encima del ruido. La información para distinguir
«informe legal» de «estudio de radio» no está en esos vectores, así que
reordenarlos mejor es imposible por construcción.

El juez saca MENOS acierto@1 que el pipeline y aun así es mucho mejor. Si solo
se hubiera mirado esa columna, se habría descartado.

## Por qué solo hay 25

Porque hasta el 31-jul-2026 la puerta de curación no funcionaba: el humano
elegía, la API respondía `ok` y la ingesta descargaba igualmente el candidato de
la máquina. De 181 beats «curados» en producción no salió ni un descarte. Estas
25 etiquetas son las primeras que existen.

## Estado 7-ago-2026 (arranque del plan de matching)

Línea base tomada antes de medir las fases en producción:

- Banco de reglas: pipeline 13/24 · 17/25 sin disparate (sin cambios tras
  ensanchar el pool: la fase 1 no toca la señal de ordenación).
- Juez con el PROMPT REAL del pipeline (el banco usaba una copia): 21-24/25
  según corrida — la varianza entre corridas de gpt-5-mini cubre ese rango, así
  que diferencias de ±3 no se leen como señal.
- Curva de pares: AUC 0,531 con 12 etiquetas (8 s / 4 n). `pares.jsonl`
  reampliado a 182 pares (34 consultas); las 12 etiquetas sobreviven.
  La variante `curva --pasaje` (asimetría e5) da hoy el mismo AUC: con 12
  muestras no distingue nada — se relee tras la sesión de etiquetado.
- Producción: `planos-produccion.jsonl` aún vacío; se llena con
  `exportar-etiquetas.ts` sobre vídeos curados CON OJOS (nunca aprobados en
  bloque) cuando la pila esté levantada.

## 11-ago-2026 — asimetría e5 adoptada (Exp A del plan)

Sesión de etiquetado completada: **182/182 pares** (12 iniciales + 17 del
usuario + 153 del agente mirando el fotograma, `quien:
"agente-fable-mirando-fotograma"` — etiquetados sobre la imagen real, no sobre
el caption, en hojas de contacto de 9).

- AUC uniforme (`curva --uniforme`): **0,669** — bajo la puerta de 0,70.
- AUC asimétrico (captions con `passage:`): **0,707** — cruza la puerta.
- Pero NINGÚN umbral da precisión útil ni aun así: 100 % de precisión solo con
  5 % de cobertura (t=0,85). Lectura: el coseno RECUPERA y ordena; decidir
  sigue siendo del juez. T_AUTO/T_REV/T_STOCK siguen descalibrados y ahora
  además viven en un espacio desplazado (~0,02-0,03 hacia abajo).
- Banco de reglas bajo el prefijo nuevo: IDÉNTICO (pipeline 13/24 · 17/25) —
  la asimetría casi no reordena dentro de un beat.
- Adoptado solo en el dominio de ASSETS (consultas `query:`, captions/títulos
  `passage:`); ideas/fuentes/beats siguen simétricos. Los 575 assets de la
  biblioteca, re-embebidos el mismo día.

---

# Banco de frases del director de formas

`frases-etiquetadas.json` — 39 frases LITERALES de los guiones de los cuatro
vídeos producidos, cada una con la forma que un editor humano elegiría para
dibujarla (plan-dibujar-ideas.md, Fase 5). Lo consume
`apps/workers/src/pipelines/assets/banco-frases.test.ts`, que valida el fichero
y reporta en el nombre del test el % del banco que el catálogo puede dibujar —
sin umbral duro a propósito: la lección del 74 % de docs/calidad.md.

Medido el 13-ago-2026, antes de las formas nuevas: **74 % (29/39)**. Frecuencia
de las seis formas propuestas: cuello 3 (ya expresable: `pasos_flow` con la
última estación acentuada), **barras 3**, linea_tiempo 2, capas 2, ciclo 2,
arbol 1. La Fase 2 implementa las tres más frecuentes NO expresables: `barras`
gana sola; del triple empate a 2 entran `linea_tiempo` y `ciclo` porque `capas`
tiene una aproximación honesta en el catálogo (fichas apiladas de `pasos_flow`
en columna) y las otras dos no tienen ninguna. `capas` y `arbol` quedan como
deuda declarada del plan.

