# EKPfJAWT9OOMy3wF098Bp · base · muestra 1

- `prompt_sha` 2eceeb793ef5 · `git_sha` 24a743abeab9
- familia: research-vacio (0 claims antes de arreglar el fetcher, 12 después)
- 600 palabras · 16 escenas

## Notas

| eje | nota | por qué |
|---|---|---|
| promesa | 2 | El título describe («Por qué conversar con libros está cambiando la lectura profesional»). El guion anuncia que paga la promesa en vez de pagarla. |
| estructura | 2 | El cuerpo es un manual. Las escenas 9, 10 y 11 son tres objeciones seguidas e intercambiables. |
| ritmo | 3 | Dieciséis escenas de entre 33 y 44 palabras. Ni un golpe corto. |
| factualidad | 4 | **Mejora grande**: nombra Sinai.ai, My Smart Book, Kindle «Ask this Book», Audible «Ask a Question». Este caso tenía cero entidades antes de arreglar el fetcher. |
| estilo | 2 | Narra su propio andamiaje. |

## Defecto dominante

**El guion cuenta una demostración en pantalla que no existe.** Este canal monta con
metraje de archivo: no hay cámara, no hay captura de pantalla y no hay adjuntos.

> «Demo rápida: tomo un libro que sí puedo usar y lo subo. Pido: 'encuentra la definición
> de X y copia la frase exacta con referencia de página'.» — sc-body-5

> «En la demo ves además opciones: exportar las citas, generar un resumen ejecutivo…» —
> sc-body-6

> «en la demo configuré, subí el libro, pedí citas y obtuve fragmentos con ubicación. **Te
> mostré** cómo exportarlos» — sc-body-13

> «dejo enlaces y un **checklist descargable en la descripción**» — sc-cta

Cuatro escenas de dieciséis le dicen al espectador que ha visto algo que no ha visto. No
es un defecto de estilo: es una promesa que el formato hace imposible cumplir.

**Causa probable:** `craftRules()` (`prompts.ts`) tiene nueve reglas de oficio y ninguna de
producibilidad. `scriptSystem` dice «faceless» sin decir qué implica eso para lo que se
puede prometer.

## Segundo defecto: el guion narra sus propios movimientos retóricos

> «**Aquí cumplo la promesa práctica**: en la demo configuré…» — sc-body-13
> «**Lo contraintuitivo es** que ahorrar tiempo puede costarte trabajo extra…» — sc-body-12
> «**Otra objeción**: la veracidad.» — sc-body-9
> «**Cómo usarlo: paso uno**, el flujo básico.» / «**Paso dos**, prompts efectivos.» — sc-body-3, 4

Es la misma enfermedad que los rótulos con dos puntos, un nivel más arriba: no anuncia el
nombre de la escena, anuncia su función. Cumplir una promesa no se avisa, se hace.

**Causa probable:** `sceneBlueprint()` le asigna a cada escena un papel nombrable. Se
reescribió de mayúsculas a prosa y el modelo pasó de decir «PUNTO MEDIO:» a decir «Lo
contraintuitivo es que…». El nombre cambió; la conducta no.

## Prueba de reordenación

Falla. sc-body-9 (veracidad), sc-body-10 (memoria técnica) y sc-body-11 (tres controles)
se pueden barajar sin que nada chirríe: son tres entradas de una lista de pegas. Igual
sc-body-1 y sc-body-2.

## Lo que el linter NO vio y debería

- La demo inexistente y el descargable. → aviso nuevo `promesa_no_producible`.
- «Aquí cumplo la promesa práctica». → aviso nuevo `meta_narracion`.
- Tres objeciones consecutivas. → métrica de guion, no de escena.

## Lo que el linter vio y está mal

`escena_corta: 11` de 16. Las escenas miden 33-44 palabras y se leen bien; el mínimo de 40
empuja a rellenar, que es lo contrario de lo que hace falta. El defecto de ritmo real es
que **todas miden lo mismo**, no que sean cortas.
