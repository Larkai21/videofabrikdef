# OIC6LvB17pOtsK3tOkbqx · base · muestra 1

- `prompt_sha` 3086a28cd65f · `git_sha` 24a743abeab9
- familia: google-news-reparado (1 claim antes de arreglar el fetcher, 8 después)
- 544 palabras · 16 escenas

## Notas

| eje | nota | por qué |
|---|---|---|
| promesa | 3 | El gancho promete «el conflicto, los riesgos concretos y pasos que puedes aplicar hoy» y el cuerpo entrega las tres cosas. El título sigue siendo descriptivo. |
| estructura | 3 | Hay arco de verdad: conflicto, las dos partes, giro hacia el espectador, pasos. Se rompe en el bloque 8-10. |
| ritmo | 3 | Todas las escenas entre 29 y 37 palabras. |
| factualidad | 5 | Nvidia, Microsoft, Dell, IBM, Meta, Jensen Huang, la Casa Blanca, «más de 70 empresas». |
| estilo | 3 | Menos rotulado que el resto (2 de 16), pero sigue narrando su arco. |

## Lo primero: este guion es MUCHO mejor que su versión publicada

El vídeo que salió de este mismo caso el 30 de julio tenía **cero entidades reales** y su
único claim era «Existe un artículo titulado 'Los modelos de pesos abiertos enfrentan a
empresas contra EEUU'». Con eso se escribieron 864 palabras. La versión de hoy abre así:

> «Una carta firmada por **más de 70 empresas** pide a la Casa Blanca que no prohíba los
> modelos de pesos abiertos.» — sc-hook

> «en la lista aparecen **Nvidia, Microsoft, Dell, IBM y Meta**» — sc-body-1

> «**Jensen Huang, CEO de Nvidia**, advirtió que medidas prematuras podrían reprimir la
> competencia» — sc-body-5

No se tocó el prompt entre una y otra: lo único que cambió es que el research dejó de ser
un titular. Es la medida más limpia que tengo de cuánto pesaba el fetcher roto.

## Defecto dominante: tres objeciones seguidas, intercambiables

> «**Podrías pensar que** simplemente dejar de usar modelos abiertos evita problemas.» — sc-body-8
> «**También podrías creer que** usar solo proveedores grandes te cubre legalmente.» — sc-body-9
> «**Otra objeción común**: los atacantes ya pueden acceder a modelos…» — sc-body-10

Tres escenas consecutivas con la misma función y la misma forma de apertura. Barajarlas no
cambia nada. Es el mismo patrón que las cuatro «Sí, pero:» seguidas de
`zZ0X0SRh7OusaNdtPK8dd` y las tres pegas seguidas de `EKPfJAWT9OOMy3wF098Bp`: aparece en
tres casos de familias distintas, así que no es del tema.

**Causa probable:** `craftRules()` dice «Tensión: alterna afirmación y objeción. Después de
una idea fuerte, dile al espectador por qué podría no cumplirse en su caso». El modelo lo
cumple, pero agrupando: hace el bloque de afirmaciones y luego el bloque de objeciones. La
regla pide alternancia y no dice que no se puedan encadenar.

## Segundo defecto: sigue narrando su propio arco

> «**Hasta aquí parece** un choque entre 'abrir' y 'controlar'. Pero lo que cambia para
> ti…» — sc-body-7
> «**Lo contraintuitivo es** que protegerse solo con cumplimiento jurídico…» — sc-body-12
> «**Has visto** el choque entre apertura y control, los riesgos principales y tres
> medidas» — sc-cta

«Lo contraintuitivo es» aparece aquí y en EKPf: dos casos, así que entra.

## Prueba de reordenación

Aguanta parcialmente. El tramo 1-7 tiene cadena real (la carta → qué son los pesos
abiertos → la postura del gobierno → la de las empresas → la cita → qué te toca a ti).
El tramo 8-10 no. El 11-14 tampoco: son tres medidas numeradas.

## Lo que el linter NO vio y debería

- Las tres objeciones seguidas. → métrica de guion.
- «Lo contraintuitivo es», «Aquí cumplo la promesa». → `meta_narracion`.

## Lo que el linter vio y está mal

`escena_corta: 14` de 16, con escenas de 29-37 palabras que se leen bien. El mínimo de 40
está mal calibrado y empuja a rellenar.
