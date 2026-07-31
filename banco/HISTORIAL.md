# Bitácora del banco

Una fila por vuelta. Sin esto, dentro de tres semanas no se sabe qué cambio produjo qué.

| fecha | variante | git | qué cambió | señal medida | decisión |
|---|---|---|---|---|---|
| 31-jul-2026 | `base` | 24a743a | línea base tras arreglar el fetcher de Google News | — | línea base: 16 guiones, 256 escenas, 95 rotuladas, 13 promesas impagables, 14 meta-narraciones |
| 31-jul-2026 | `s2-producible` | (sin commitear) | tres reglas a la vez en `craftRules()`: producibilidad, alternancia de objeciones, «no narres tu movimiento» + fusión de «Bucles abiertos» y «Re-ganchos» | `promesa_no_producible` 13→2, `cliche` 4→1. `andamiaje` 95→108 | **método mal**: tres variables a la vez, no se puede atribuir |
| 31-jul-2026 | `s2` | (sin commitear) | igual pero sin la regla «Invisible» | `promesa_no_producible` 13→8 (señal), `cliche` 4→1 (señal). `andamiaje` 95→122 | se queda |
| 31-jul-2026 | `s2-bis` | (sin commitear) | **nada: el mismo prompt que `s2`** | `andamiaje` 122→91 | **medición del ruido**. Banda ±31 en `andamiaje`, ±5 en `meta_narracion`, ±2 en `promesa_no_producible` |

## Lo que salió de la vuelta de S2

1. La regla de **producibilidad** funciona: es el único cambio del prompt que supera la
   banda de ruido. El guion deja de prometer demos y descargables.
2. La regla de **no narrar el propio movimiento** no se puede medir con este banco y se
   quitó. No porque empeorara —eso también era ruido— sino porque el presupuesto de líneas
   de `craftRules()` es escaso y una regla que no se puede medir no se gana su sitio.
3. El **andamiaje no se arregla desde `craftRules()`**. Las tres corridas dan 95, 108, 122 y
   91 sobre 256 escenas: pura dispersión. La causa está en `sceneBlueprint`, que le asigna a
   cada escena un papel nombrable, y eso es S3.
4. Se metieron tres cambios en una vuelta. Fue un error de método y está anotado en la
   rúbrica: **un cambio por vuelta**.
