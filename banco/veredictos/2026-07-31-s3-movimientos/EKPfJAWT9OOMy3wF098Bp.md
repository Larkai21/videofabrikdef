# EKPfJAWT9OOMy3wF098Bp · s3-movimientos · muestra 1

- `prompt_sha` 61eb32a859bf · `git_sha` 8b4e544806a4
- 681 palabras · 16 escenas
- comparar con `2026-07-31-base/EKPfJAWT9OOMy3wF098Bp.md`, mismo caso y mismo research

## Notas

| eje | base | ahora | por qué |
|---|---|---|---|
| promesa | 2 | 3 | El gancho promete tres cosas concretas y el cuerpo entrega dos. Sigue prometiendo una demo. |
| estructura | 2 | **4** | El cuerpo encadena. Ya no es un manual. |
| ritmo | 3 | 3 | Ver la corrección de abajo: el defecto no es el que escribí. |
| factualidad | 4 | 4 | Sinai.ai, My Smart Book. |
| estilo | 2 | **4** | Cero rótulos. Cero meta-narración. |

## Qué cambió, y es un cambio grande

El único cambio del prompt es que `sceneBlueprint` dejó de asignarle un papel a cada
escena y ahora reparte el cuerpo en movimientos definidos por la PREGUNTA que responden.

En la versión base este mismo caso escribía:

> «**Cómo usarlo: paso uno**, el flujo básico.» · «**Paso dos**, prompts efectivos.» ·
> «**Demo rápida**: tomo un libro que sí puedo usar.» · «**Otra objeción**: la veracidad.» ·
> «**Aquí cumplo la promesa práctica**…»

Ahora:

> «Abre una carpeta con PDFs. El primer paso es elegir la herramienta: hay servicios que
> indexan el texto completo y otros que trabajan con resúmenes.» — sc-body-1

> «**Sin embargo**, no todos los sistemas indexan igual: unos guardan el texto íntegro y
> otros crean resúmenes.» — sc-body-6

> «**Esa limitación implica** una rutina nueva: cuando obtienes una cita, comprueba la
> página en el PDF, pide la cita literal y registra metadatos.» — sc-body-9

Las escenas empiezan enlazando con la anterior («Esa limitación implica», «Sin embargo»,
«Además») en vez de anunciándose. Es la diferencia entre un índice y un hilo.

## Prueba de reordenación

**Aguanta.** sc-body-8 («la velocidad no garantiza precisión») y sc-body-9 («esa
limitación implica una rutina nueva») no se pueden intercambiar: la 9 empieza por «esa
limitación», que es la 8. Igual la 6 y la 7. En la versión base las tres objeciones eran
barajables.

Falla todavía entre sc-body-1 y sc-body-2, que dicen casi lo mismo con otras palabras
(«hay servicios que indexan el texto completo y otros que trabajan con resúmenes» /
«plataformas como Sinai.ai y My Smart Book ofrecen chat sobre libros»). Repetición dentro
de un movimiento: el reparto le dio tres escenas a la pregunta y hay materia para dos.

## Defecto dominante que queda

**El gancho sigue prometiendo una demo.**

> «Vas a ver cómo configurar uno, qué extrae bien y qué falla al pedir citas verificables.
> **Empezamos con una demo práctica** y un flujo que puedas aplicar ya.» — sc-hook

El aviso `promesa_no_producible` NO lo cazó: mi patrón exigía la preposición «en» («en la
demo») y aquí es «con una demo». Se amplió el patrón con esta frase como fixture, más un
control para que «la demo de OpenAI duró doce minutos» siga pasando: hablar de la demo de
otro es contenido, prometer la propia no.

## Medición

Contra las cuatro corridas de línea base agrupadas (67 guiones):

| métrica | base | s3 | banda |
|---|---|---|---|
| escenas rotuladas | 37,9 % | **14,7 %** | ±20 → **señal** |
| meta-narración por guion | 1,0 | **0** | señal |
| promesas por guion | 0,5 | 0,3 | ±0,6 → ruido |
| palabras medias | 580 | 628 | señal |

Con un solo cambio de variable. La hipótesis era que el problema no es cómo se llama el
papel de la escena sino que exista un papel por escena, porque un papel es una etiqueta y
una etiqueta se anuncia. Se confirma.


## CORRECCIÓN (misma sesión, tras medir)

Escribí «sigue sin un golpe corto» y es **falso**. Medido sobre las 544 escenas de esta
corrida, el 32 % de las frases tienen ocho palabras o menos y los 34 guiones tienen al
menos una. El golpe corto existe; lo que falla es **dónde cae**.

La medida que sí separa es la **última frase de cada escena**:

| | última frase de escena | ≤8 palabras | última frase del gancho |
|---|---|---|---|
| `O9WieZkLPrbjAAXcDxq1f` (el que se lee bien) | 11,2 palabras | **30 %** | **4** |
| banco `s3-movimientos` | 15,9 | 11 % | 19,8 |
| corpus publicado | 17,1 | 8 % | 18,8 |

Y no es solo largo. O9Wie cierra en consecuencia:

> «Todo el contenido, desaparecido.» · «Sin claves, tus datos son puro ruido.» · «La misma
> función que te blinda puede volverse en tu contra.»

El banco cierra resumiendo lo que acaba de decir, y las tres empiezan igual:

> «**Esa diferencia** cambia qué respuestas esperas…» · «**Esa variedad** significa que
> puedes escoger…» · «**Esa política** determina si puedes usar una obra protegida…»

`craftRules()` ya lo dice, pero enterrado en el comentario del ejemplo: «una última frase
que empuja hacia la escena siguiente». Está como observación sobre el ejemplo, no como
regla.
