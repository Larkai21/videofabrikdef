# Rúbrica del banco de guiones

Con qué criterio se juzga un guion, escrito para que sobreviva a la sesión que lo
escribió. Todo lo que hay aquí está anclado en una cita literal de un guion real con su
`video_id`: sin cita, la nota es una opinión y no vale.

## Cómo se juzga

Una vuelta = una variante del prompt. Por vuelta:

1. Se leen los `.md` de `banco/corridas/<variante>/` **como lector**, enteros y en orden,
   sin mirar el prompt que los generó ni la tabla del linter que va al pie. El principio 2
   del proyecto ("el humano selecciona y aprueba; nunca ve JSON crudo") vale también aquí.
2. Se escribe un veredicto por caso en `banco/veredictos/<fecha>-<variante>/<caso>.md`:
   caso, variante, `prompt_sha`, nota de 0 a 5 por eje, **un** defecto dominante en una
   frase, citas **literales** con el eje que rompen, y la línea de código que probablemente
   lo produce.
3. Se propone **un** cambio, y solo si el defecto aparece en dos casos distintos.

Tres reglas que impiden que esto degenere en opinión:

- **Sin cita no hay veredicto.** Una cita que no aparezca carácter a carácter en el guion
  citado invalida el veredicto entero.
- **Lo que se pueda medir, se mide.** Todo defecto que se pueda nombrar mecánicamente baja
  en la misma vuelta a `packages/shared/src/script-quality.ts`, con un fixture copiado del
  guion real que lo motivó y un control de falso positivo. Nunca se vuelve a juzgar a mano
  lo que el código ya mide.
- **La vuelta N+1 tiene que ser más corta que la N.** Si la carga de lectura no baja, el
  bucle está mal montado: significa que se están añadiendo reglas al prompt en vez de
  bajarlas al código. Se para y se revisa.

## Sobreajuste

- La mitad de los casos son **control** y no se miran durante el sprint. Correr
  `--casos control` avisa por pantalla. Si se lee un caso de control para decidir un
  cambio, ese caso deja de serlo y se sustituye.
- **n ≥ 3 muestras por caso, y ni con esas basta.** El generador no fija `temperature` ni
  `seed`. Medido el 31-jul-2026 corriendo el MISMO prompt dos veces sobre los 6 casos dev
  con 3 muestras:

  | métrica | banda de ruido |
  |---|---|
  | escenas rotuladas / `andamiaje` | **±31** sobre ~100 |
  | `palabras_media` | ±30 |
  | `meta_narracion` | ±5 |
  | `promesa_no_producible` | ±2 |
  | `cliche`, `objeciones_seguidas` | ±1 |

  `pnpm guion --diff` marca cada delta como «señal» o «ruido» contra esta banda. **Un
  cambio que no la supere no se acepta como mejora**, por bien que suene la explicación.

  Esto no es teoría: pasó. Se leyó un +13 y luego un +27 de `andamiaje` como si el prompt
  hubiera empeorado, se escribió la conclusión en un comentario del código, y al medir el
  ruido salió −31 con el prompt sin tocar. Todo lo interpretado cabía en el azar.

  Para estrechar la banda hay dos vías, ninguna gratis: más muestras por caso, o comparar
  caso a caso en vez de en agregado.
- El banco **crece** dos casos por sprint, desde producción real. Un prompt no puede
  memorizar un conjunto que crece.

## Los cinco ejes

Anclas tomadas de guiones reales. Un 5 y un 2 por eje; lo de en medio se interpola.

### Promesa
- **5** — El título promete algo concreto y el cuerpo lo paga en una frase que se puede
  citar. `O9WieZkLPrbjAAXcDxq1f`: «Su móvil se borró solo en el aeropuerto (y acabó
  imputado)» y el cuerpo explica exactamente eso.
- **2** — El título describe en vez de prometer y el cuerpo no cierra nada.
  `OIC6LvB17pOtsK3tOkbqx`: «Por qué los modelos de pesos abiertos están en disputa». Nueve
  de once títulos elegidos del corpus empiezan por «Por qué».

### Estructura
- **5** — Intercambiar dos escenas del cuerpo rompe el guion de forma visible.
- **2** — El cuerpo se puede reordenar sin que cambie nada. `JBbfvawGXzsXdA92L1zcH`, 19
  escenas que son la ficha técnica de HuggingFace en el mismo orden en que está escrita:
  «Arquitectura:», «Novedades técnicas clave:», «Detalles de MoE y escala:», «Visión y
  multimodalidad:», «Cuantización y entrenamiento:». Es el guion con el research MÁS rico
  del corpus (23 claims), y esa es la prueba de que el material no es el problema.

### Ritmo
- **5** — Alterna frases cortas y largas; hay al menos un golpe corto por bloque.
  `O9WieZkLPrbjAAXcDxq1f`: «Un hombre cruza el control de un aeropuerto de Estados Unidos,
  saca el móvil, y en segundos el teléfono se borra solo. Todo el contenido, desaparecido.»
- **2** — Todas las escenas miden lo mismo y todas empiezan igual.
  `zZ0X0SRh7OusaNdtPK8dd`, cuatro escenas seguidas: «Sí, pero: no todos los nichos pagan
  igual», «Sí, pero: la calidad importa», «Sí, pero: automatizar cobros tiene costes»,
  «Sí, pero: si dependes de ayudas sociales…».
- **No se usa la desviación típica del largo de escena.** Medido sobre el cuerpo de los
  once vídeos, ordena el corpus al revés: el peor guion tiene la sd más alta (10,4) y el
  que mejor se lee, 4,0.

### Factualidad
- **5** — Las afirmaciones fuertes salen de los claims y se nombran las cosas.
- **2** — Mil palabras sin una sola entidad real. `uVkNtcYIrYqEX8D3dG1Ah`: 1008 palabras,
  cero nombres propios, un claim. La regla del prompt solo prohíbe cifras fuera de los
  claims y nunca exige concreción, así que el camino seguro es no decir nada — y el eje
  `factualidad` del juez premiaba ese camino con un 5.

### Estilo
- **5** — Suena a alguien hablando. Ninguna escena abre con rótulo.
- **2** — Es un documento leído en voz alta. `EKPfJAWT9OOMy3wF098Bp`: «PUNTO MEDIO: estas
  herramientas funcionan, pero no son cajas negras perfectas.» Esas dos palabras están en
  el MP4.

## Las ocho comprobaciones de terminado

No hay nota agregada. «22 de 25» no señala nada que arreglar, que es exactamente por lo
que hoy no se distingue un guion bueno de uno mediocre.

| # | Comprobación | Cómo se mide | Estado hoy |
|---|---|---|---|
| 1 | Ninguna escena abre con rótulo | `andamiaje` del linter | 91-122 de 256 escenas del banco. La horquilla ES la banda de ruido: no se puede afinar esta métrica con 6×3 |
| 2 | Ninguna promesa impagable | `promesa_no_producible` | 13 → 8 tras S2 (señal). En el corpus, 5 de 11 guiones |
| 3 | Ninguna mención de la fontanería | patrones de `research pack`, `no podemos confirmar` | **0**. Desapareció sola al arreglar el fetcher: el guion ya no confiesa que le falta material porque no le falta |
| 4 | **Prueba de reordenación** | a mano: se intercambian 3 pares de escenas del cuerpo; en ≥2 el guion se rompe | pasa en el caso leído tras los movimientos; JBbf y OZmR la aguantaban antes |
| 5 | **Prueba de corte** | a mano: se quita una escena cada vez; qué % no se echaría en falta. El umbral se calibra midiéndolo sobre un guion aprobado, no se inventa | sin calibrar |
| 6 | Una entidad real por minuto, y el título elegido lleva nombre propio o cifra | métrica, S4. La heurística **excluye** las palabras en mayúscula de los rótulos, o `PUNTO` y `MEDIO` cuentan como entidades y arreglar el andamiaje baja la concreción | 7 de 11 guiones a cero |
| 7 | La promesa se paga en una frase citable | a mano, se cita | — |
| 8 | **Minuto tres** | a mano: se lee de la escena 8 en frío y se dice si se seguiría viendo | — |

**Línea de meta:** tres casos de **control** consecutivos, de familias distintas, que pasen
las ocho.

### La pasada de REPARACIÓN, que el banco no estaba midiendo

El guion que se publica NO es el que sale del generador. El juez llama al refinado con las
escenas que el linter marca como duras (`blockingSceneIds` → `patch_targets`, y `andamiaje`
es una de ellas), así que hasta cuatro escenas se reescriben antes de llegar a la puerta
humana. El banco medía solo lo primero: su número de rótulos era el de ANTES de reparar.

`pnpm guion --reparar <variante>` cierra el bucle y demuestra que CIERRA — si el refinado
reescribiera una escena y le volviera a poner un rótulo, no serviría de nada:

| | dev | control |
|---|---|---|
| escenas rotuladas, generador | 6,3 % | 7,3 % |
| escenas rotuladas, **tras reparar** | **1,0 %** | **1,0 %** |
| muletillas | 4 → **0** | 1 → **0** |
| casos con CERO rótulos | 3 de 6 | **4 de 6** |

Las comparaciones antes/después son PAREADAS —los mismos guiones— así que la banda de
ruido no aplica y `--diff` lo dice en pantalla.

**Dónde está el techo.** El generador se estanca en torno al 8 % de escenas rotuladas: dos
vueltas seguidas dieron 7,6 % y 9,4 %, que están dentro de la banda, con un rastro de 24
patrones distintos y uno o dos casos cada uno. No hay una regla más que escribir. Lo que
baja del 8 % al 1 % es la reparación, no el prompt.

### Primera evaluación del control — 31-jul-2026

El conjunto de control se corrió por primera vez al cerrar el sprint, sin haberlo mirado
antes. Es el número que dice si las mejoras generalizan o si solo se afinó contra los seis
casos de desarrollo.

| | corpus publicado | dev | **control** |
|---|---|---|---|
| escenas rotuladas | 37,9 % | 16,7 % | **12,5 %** |
| promesas impagables / guion | 0,7 | 0,8 | **0** |
| meta-narración / guion | 0,5 | 0 | **0** |
| guiones sin ninguna entidad | 1 de 11 | 0 de 6 | **0 de 6** |

**El control va mejor que dev.** No hay sobreajuste: lo que se arregló era estructural
(`sceneBlueprint` por movimientos, el fetcher, los avisos del linter) y por eso viaja a
casos que el prompt nunca vio.

`pnpm guion --porteria control` devuelve **NO PASA**: 6 comprobaciones fallidas, las seis
de la comprobación 1, porque ningún guion llega a CERO escenas rotuladas. Bajar del 37,9 %
al 12,5 % no es lo mismo que llegar a cero, y la portería no se afloja para que pase.

## Lo que ya se aprendió, para no repetirlo

- **Un papel por escena es una etiqueta, y una etiqueta se anuncia. RESUELTO.**
  `sceneBlueprint` emitía «PUNTO MEDIO» y «GIRO» en mayúsculas y el modelo los locutaba.
  Se reescribieron en prosa y el modelo escribió «Lo contraintuitivo:» seis veces —
  copiando la redacción nueva. La conclusión no era «buscar mejores palabras» sino que
  sobraba el papel por escena. Al repartir el cuerpo en **movimientos definidos por la
  pregunta que responden**, la tasa de escenas rotuladas cayó de 37,9 % a 14,7 % (banda
  ±20) y la meta-narración desapareció (1,0 → 0 por guion). Una pregunta no se puede usar
  de encabezado, y responderla obliga a encadenar con la escena anterior.
- **La semilla no sirve para estrechar la banda.** Se añadió `seed` al proveedor y se
  midió: gpt-5-mini razona antes de responder y no la honra. Lo único que la estrecha es
  subir las muestras, y va con la raíz.
- **Comparar una corrida contra una corrida es la trampa.** Con banda ±20, el mismo
  resultado sale «señal» o «ruido» según contra cuál de las corridas base se compare.
  `--diff` acepta varias separadas por coma y las agrupa; y con corridas de distinto
  tamaño solo compara TASAS, porque 80 rótulos en 544 escenas es la mitad de tasa que 83
  en 272.
- **Una lista blanca de rótulos no puede ganar.** El modelo se los inventa:
  «Arquitectura:», «Demo rápida:», «Quién y dónde:», «Lo que cambia:». La lista blanca
  cubría 28 de 400 escenas reales; la regla genérica, 188.
- **Un juez con rúbrica no sustituye a una comprobación mecánica.** El juez dio 4 de 5 en
  estructura y en estilo a guiones que decían «PUNTO MEDIO» en voz alta, sin mencionarlo
  ni una vez.
- **El research no es el cuello de botella del guion.** Arreglarlo era necesario (los dos
  casos con cero claims pasaron a 12 y 11), pero el guion con más material del corpus es
  el peor estructuralmente.
- **Añadir reglas a `craftRules()` tiene rendimiento decreciente y no se puede medir.** En
  S2 se metieron tres reglas a la vez (producibilidad, alternancia de objeciones, no narrar
  el propio movimiento) y solo una dio señal: `promesa_no_producible` 13 → 8. Las otras dos
  quedaron dentro del ruido. Además fue un error de método meter tres cambios en una vuelta:
  con tres variables movidas a la vez no se puede atribuir nada. **Un cambio por vuelta.**
- **Medir el ruido ANTES de interpretar un diff.** Cuesta una corrida (~5 min, 0,08 $) y
  es lo único que separa iterar de dar vueltas.
- **Una métrica en la que «más es mejor» acaba jugada.** La regla de cierres cortos llevó
  la métrica del 11 % al 74 % y el texto empeoró: cada escena remataba con un imperativo
  genérico («Decide según tu riesgo», «Sigue leyendo»). Si un valor extremo no puede ser
  malo, la métrica no mide calidad. Toda métrica nueva necesita banda por arriba y por
  abajo, y **el número nunca cierra una vuelta sin leer un guion**.
- **`craftRules()` está saturado y ya no es la palanca.** Diez reglas largas, y dos
  añadidas esta sesión no movieron nada medible. Lo que sí movió la aguja fue estructural
  (`sceneBlueprint` por movimientos: rótulos del 37,9 % al 14,7 %) o mecánico (avisos del
  linter). Antes de escribir una regla nueva ahí, buscar dónde está la causa.


## El control del arnés del juez

`banco/control-juez.json` nombra el guion contra el que se calibra el juez, y se nombra A
MANO por una razón concreta: `juez-calibra.ts` lo elegía como «el más largo de outputs/»,
que es `JBbfvawGXzsXdA92L1zcH` — el guion que el linter marca 29 veces, con 16 de sus 19
escenas rotuladas y una promesa impagable. El arnés le exigía al juez APROBAR un guion malo
mientras le pedía suspender los fixtures malos. Con eso no se puede calibrar nada.

El control actual es `VnAHZKG_bWBNfsqfRzxF4`, leído entero: cero rótulos, cero
meta-narración, cero promesas impagables, longitud real de producción. Su punto flojo está
anotado en el propio fichero — solo 2 entidades distintas — para que quien lo sustituya
sepa por qué.
