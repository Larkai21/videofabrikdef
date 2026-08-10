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

