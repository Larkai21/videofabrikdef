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

| 31-jul-2026 | `s3-ritmo` | 0b2d1ee | «la última frase de cada escena es corta —ocho palabras o menos— y dice la consecuencia» | `cierre_medio` 15,7 → **6,9** · cierres cortos 10,6 % → **74 %**. Los dos criterios superados de largo | **REVERTIDA.** La métrica pasó y el texto EMPEORÓ |
| 31-jul-2026 | `s3-ritmo-v2` | 0b2d1ee | la misma idea pedida como variación, prohibiendo el latiguillo genérico y el arranque por «Eso» | cierres cortos 13,5 %, `cierre_medio` 15,0: la línea base. Nada supera la banda | **REVERTIDA.** Tres de cada ocho cierres siguen empezando por «Eso»: la regla se ignora |

| 31-jul-2026 | `s4-titulos` | 46c9350 | los patrones del perfil pasan de 2 a 6 y el prompt deja de pedir «cada título aplicando uno de estos patrones»: ahora exige que los tres se diferencien en FORMA, que alguno nombre algo del research, y prohíbe «Por qué» | títulos que empiezan por «Por qué»: **100 % → 0 %** (54 títulos). Aperturas repartidas entre «Cómo», «Habla», nombres propios | **se queda** |

| 31-jul-2026 | `s4-huecos` | c0d0747 | nombrar la escena de cada tarjeta (`huecosDeTarjeta`) en vez de pedirlas «repartidas» | escenas con intención **81 → 49**; cobertura de la ÚLTIMA escena del cuerpo **6/6 → 0/6** | **REVERTIDO.** Acotar los huecos acota también el techo: el modelo se ciñe al mínimo |

| 31-jul-2026 | `control` | 3f471d9 | **primera evaluación del conjunto de control**, sin haberlo mirado en todo el sprint | rotuladas **12,5 %** (dev 16,7 %, corpus 37,9 %) · promesas impagables **0** · meta-narración **0** | **el control va mejor que dev: no hay sobreajuste.** La portería devuelve NO PASA porque la comprobación 1 exige CERO rótulos |

| 31-jul-2026 | `s6-rotulos` + reparación | eb66c7a | aviso `cierre_resumen` bloqueante, tope de reparación 4→8, e instrucción por aviso | `cierre_resumen` **56 → 7** · rotuladas 6,3 % → **1,0 %** · promesas 0,5 → 0,1 · meta 0,1 → **0** | **se queda.** El ritmo se ataca nombrando el defecto y reparándolo, no con reglas de oficio |

## Los minutos mudos: dos hipótesis falsas y una causa real

El vídeo salió con 1 tarjeta y cinco minutos mudos de seis. Tres intentos:

1. **«El guion no declara repartido».** Falso: declaró 8 intenciones y 7 anclaban
   correctamente en el audio.
2. **«Las rejillas no encajan»** — el reparto usa ventanas de duración/presupuesto (51 s) y
   el informe cuenta por minuto de reloj. Se alineó a 60 s y salió PEOR: 4 tarjetas en vez
   de 5 y los mismos 2 minutos mudos. Revertido.
3. **La causa real**: `dedupeAndCap` deja un overlay por beat elegido por prioridad de tipo,
   y `zoom_punch` (4) aplastaba a `text_callout` (2) antes de que la bonificación de
   «declarado» pudiera salvarla. Arreglado → 5 tarjetas en vez de 1, reparto de
   `[0 0 0 1 0 0]` a `[0 1 2 1 1 0]`.

Y el intento de «nombrar los huecos» fue contraproducente por su cuenta: medido, bajó las
declaraciones de 81 a 49. La lección se repite: **acotar dónde puede declarar el modelo
acota también cuánto declara**. El reparto en el tiempo ya lo hace el montador; del guion
hace falta cantidad y cobertura, no puntería.

## La vuelta del ritmo: dos intentos, los dos fallidos, y lo que enseñan

El diagnóstico era bueno y está medido: el único guion del corpus que se lee bien cierra
sus escenas con 11,2 palabras y el 30 % con ocho o menos; los generados, con 15,7 y el
10,6 %. La regla que lo pedía falló dos veces, cada una a un lado.

**Pedirlo como longitud fija** disparó la métrica al 74 % y produjo esto en cada escena:

> «Mantén el control local.» · «Tienes que medir influencia real.» · «Queda la duda
> regulatoria.» · «Decide según tu riesgo.» · «Sigue leyendo.» (en un vídeo)

Es el tic de «Sí, pero:» movido al final. Si todas las escenas rematan, ninguna remata.
**La métrica pasó de sobra y el texto empeoró**, que es exactamente contra lo que la
rúbrica avisa: una medida es un proxy, y un proxy se puede satisfacer sin traer lo que
representaba.

**Pedirlo como variación** volvió a la línea base y la regla se ignoró: tres de cada ocho
cierres seguían empezando por «Eso», que la propia regla prohibía por escrito.

Dos consecuencias, y valen más que la regla:

1. **`cierres_cortos_pct` pasa a ser una BANDA (20-45 %), no un «más es mejor».** Una
   métrica en la que un valor extremo no puede ser malo no está midiendo calidad.
   `pnpm guion --medir` marca cuando se sale por arriba.
2. **`craftRules()` está saturado.** Son diez reglas largas y ya van dos esta sesión que no
   mueven nada medible (esta y la de «no narres tu propio movimiento»). Lo que SÍ movió la
   aguja fue estructural —`sceneBlueprint` por movimientos, que bajó los rótulos del 37,9 %
   al 14,7 %— o mecánico, los avisos del linter. **La próxima idea de calidad de guion no
   debería empezar por añadir una línea aquí.**

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
