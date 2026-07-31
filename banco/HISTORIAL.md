# Bitácora del banco

Una fila por vuelta. Sin esto, dentro de tres semanas no se sabe qué cambio produjo qué.

| fecha | variante | git | qué cambió | señal medida | decisión |
|---|---|---|---|---|---|
| 31-jul-2026 | `base` | 24a743a | línea base tras arreglar el fetcher de Google News | — | línea base: 16 guiones, 256 escenas, 95 rotuladas, 13 promesas impagables, 14 meta-narraciones |
| 31-jul-2026 | `s2-producible` | (sin commitear) | tres reglas a la vez en `craftRules()`: producibilidad, alternancia de objeciones, «no narres tu movimiento» + fusión de «Bucles abiertos» y «Re-ganchos» | `promesa_no_producible` 13→2, `cliche` 4→1. `andamiaje` 95→108 | **método mal**: tres variables a la vez, no se puede atribuir |
| 31-jul-2026 | `s2` | (sin commitear) | igual pero sin la regla «Invisible» | `promesa_no_producible` 13→8 (señal), `cliche` 4→1 (señal). `andamiaje` 95→122 | se queda |
| 31-jul-2026 | `s2-bis` | (sin commitear) | **nada: el mismo prompt que `s2`** | `andamiaje` 122→91 | **medición del ruido**. Banda ±31 en `andamiaje`, ±5 en `meta_narracion`, ±2 en `promesa_no_producible` |
| 31-jul-2026 | `sem-a` / `sem-b` | 8b4e544 | se añadió `seed` al proveedor y se corrió dos veces el mismo prompt con la misma semilla | tasa de rótulos 38,2 % → 30,5 % | **la semilla NO se honra**: gpt-5-mini razona antes de responder. Descartada como vía. Con cuatro corridas idénticas (47,7 / 35,5 / 38,2 / 30,5) la banda queda en **±20 puntos de tasa** |
| 31-jul-2026 | `s3-movimientos` | 8b4e544 | **un solo cambio**: `sceneBlueprint` deja de asignar un papel por escena y reparte el cuerpo en movimientos definidos por la pregunta que responden | tasa de rótulos **37,9 % → 14,7 %** (banda ±20) · meta-narración 1,0 → **0** por guion | **se queda**. Es el cambio más grande medido hasta ahora |

| 31-jul-2026 | `s3-ritmo` | 0d4e7b1 | **un solo cambio**: la última frase de cada escena tiene que ser corta y decir la consecuencia, no resumir. Ascendida de comentario del ejemplo a regla | **SIN MEDIR** | la clave de OpenRouter llegó a su límite de cuenta (`403 Key limit exceeded`) antes de poder correr la variante. El cambio está implementado y NO verificado |

## Pendiente de verificar

`s3-ritmo` es el único cambio del repositorio que no ha pasado por el banco. Cuando la
clave vuelva a tener saldo, una sola orden lo cierra:

```
pnpm guion --variante s3-ritmo --casos dev --n 6
pnpm guion --diff s2,s2-bis,sem-a,sem-b,s3-movimientos s3-ritmo
```

Qué tiene que salir para aceptarlo: `cierre_medio` por debajo de 14,6 (banda ±1,3 sobre
una base de 15,8) y `cierres_cortos_pct` por encima de 18 (banda ±7 sobre 10,6). El
objetivo, medido sobre el único guion del corpus que se lee bien, es 11,2 palabras y 30 %.
Si no lo supera, se revierte la regla: el presupuesto de líneas de `craftRules()` no
admite reglas que no se puedan demostrar.

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
