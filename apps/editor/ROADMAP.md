# Objetivo de trabajo autónomo

> **Meta:** que `editor-youtube` produzca piezas indistinguibles de un montaje
> hecho a mano por un editor con criterio — sin que nadie toque un ratón.

Ahora mismo el sistema compone bien pero **suena a nada y se le ven las
costuras**. Ese es el hueco.

## Criterio de trabajo

1. **Verificar mirando y escuchando.** Nada se da por bueno sin renderizar y
   abrir el resultado. Un JSON correcto no prueba que se vea ni que suene.
2. **Nada de assets con dueño.** Todo el audio se sintetiza; todo el arte se
   genera. Cero descargas de material ajeno.
3. **Cada tanda deja el repo funcionando.** Si algo queda a medias, se
   documenta en la bitácora de abajo.
4. **Registrar los fallos, no solo los aciertos.** El valor de este proyecto
   está en los límites descubiertos, que no están documentados en ningún sitio.

---

## Cola de trabajo, por valor

### A · Sonido (lo que más falta)
`assets/sfx/` está vacío y el compositor ya sabe mezclar. Un golpe en cada
transición cambia la percepción más que cualquier gráfico nuevo.

- [x] `scripts/hacer_sfx.py` — síntesis con ffmpeg: impacto, barrido, clic,
      tono de aparición, subgrave de cierre. Sin muestras ajenas.
- [x] Disparo automático: los SFX se colocan solos en los `cortes` del plan
      y en los `flashEn`, leyendo el propio plan.
- [x] Ducking de la locución bajo los golpes (`sidechaincompress`).
- [x] Lecho ambiental muy bajo para que el silencio no suene a hueco.

### B · Cerrar lo que quedó a medias
- [x] Tarjeta 3D con paralaje (pen de thebabydino) — prometida y no hecha.
- [x] `--only` no re-renderiza la pasada de máscara si la capa es de cristal:
      revisar que no deje máscaras desincronizadas.
- [x] `hoja_contactos.js` no incluía las plantillas nuevas (globo, pasos,
      kinetic, transición, dock).
- [x] **`--preview` estaba roto** con capas de cristal: el render sale truncado.
      Detectado al intentar una comparación A/B rápida.
- [x] El aviso "casi mudo" de `hacer_sfx.py` da falso positivo en `lecho`,
      que está diseñado para ser inaudible.

### C · Componentes nuevos
- [x] Cita / pull-quote a pantalla completa.
- [x] Barra de progreso de capítulo (para piezas largas).
- [x] Mapa de calor / rejilla de datos.
- [x] Marco de navegador y de móvil para capturas.
- [x] Tarjeta de cierre con llamada a la acción.
- [x] Terminal con salida en streaming.
- [x] Onda de audio alimentada por el audio real, no inventada.
- [x] **Rejilla de logos / lockup de marca** → `rejilla-logos.html`. Dos
      vistas en una plantilla, porque son la misma relación a dos escalas.
      La clave es `vista` y **no** `modo`: `modo` la pisa el renderizador con
      la pasada de render, y una plantilla que la use para otra cosa tiene un
      valor inalcanzable por el pipeline. Es la tercera vez que aparece esa
      colisión —`data-diagram` sigue con su `tabla` muerto—, así que esta nace
      ya con el nombre bueno.

      Las marcas son **monogramas tipográficos** por defecto: dibujar de
      memoria el logo de otro sale mal y no es nuestro para redibujarlo.
      Cuando haga falta el de verdad se pega su trazado en `marca`. Lo que NO
      se acepta es un `<img>`, y no por estética: una imagen se decodifica de
      forma asíncrona y Playwright puede capturar antes de que esté pintada,
      así que el mismo `seek(t)` daría dos píxeles distintos según lo que
      tardara el disco.

      Dos defectos que salieron de MIRAR el fotograma, no de leer el JSON: la
      nota del elegido, medida desde su tesela, caía cruzada sobre dos marcas
      de la fila siguiente —ahora se mide desde la rejilla—; y con título y
      subtítulo vacíos la cabecera seguía ocupando su margen y descentraba el
      bloque 13 px, que no se lee como un fallo sino como una maqueta mal
      hecha.

- [x] **Antes/después con cortinilla arrastrable sobre metraje** →
      `antes-despues.html`. El primer componente del catálogo que toca al
      METRAJE en vez de pintarse encima, y por eso su corrección no vive en la
      plantilla sino en el filtergraph.

      **El «antes» es el material de verdad sin grading**, no una imitación.
      Es todo el valor del componente: un «antes» falseado bajando la
      saturación demuestra el efecto que se le aplique, no el grading que
      lleva la pieza. Se consigue **reusando el motor de máscaras del
      cristal**, que resultó ser más general de lo que su nombre decía —la
      plantilla emite su segunda pasada y ffmpeg recorta con esa silueta una
      segunda cadena de A-Roll idéntica salvo en el LUT—. Mismo corte, mismo
      recorte por rostro, mismo zoom por tramo, porque sale de llamar DOS
      VECES a la misma función: así solo puede diferir lo que se le pasa.

      De ahí `.silueta` en `_tokens.css`: una región de máscara **sin vidrio**.
      El cristal es UN uso de la máscara, no la máscara.

      Verificado midiendo sobre un montaje real, no por el grafo: el lado
      «antes» casa con el montaje SIN LUT **2,7 veces mejor** que con el
      graduado (2,99 frente a 8,06 de diferencia media por píxel), y el lado
      «después» al revés (3,43 frente a 6,56). El suelo de ~3 es ruido de tres
      codificaciones x264 independientes, el mismo que
      `comparar_fotogramas.py` ya tenía calibrado como «ruido de
      rasterización».

      **Pero ese número mide la fontanería, no el componente, y hay que decirlo
      con esa precisión: la comparación NO SE VE.** Lo dijo el usuario mirando
      el vídeo, y al medirlo tenía razón — el LUT de marca cambia la imagen una
      **mediana de 5/255, un 2 %**, con el percentil 95 en 18 y solo el 26 % de
      los píxeles moviéndose más de 8/255. Con un LUT deliberadamente fuerte
      (`--fuerza 3 --contraste 0.75 --desaturacion 0.45`) la cortinilla se lee
      de sobra, así que el mecanismo no tiene ningún clamp escondido.

      La causa es de diseño y no un fallo: **la cámara ya entrega S-Cinetone**,
      así que al LUT le queda poco que hacer — es lo mismo que reconoce el
      preset `scinetone` de `make_lut.py`, «parte de material ya perfilado en
      cámara»—. O sea que «con grading frente a sin grading» es la comparación
      equivocada PARA ESTE pipeline, por buena que sea la fontanería. Y es un
      recordatorio de que «verificado midiendo» no significa nada si no se dice
      QUÉ se midió: aquí se midió que cada lado venía de la cadena correcta,
      que es cierto y no es lo que hacía falta saber.

      **Resuelto con `imagen`**, que pasa a ser el uso principal: el lado
      «antes» es una captura —el fallo, el diseño viejo, el diff— y el
      «después» eres tú contándolo. Es la comparación que de verdad hace una
      pieza técnica y **se ve siempre**, porque los dos lados no tienen por qué
      parecerse. Se descartaron las otras dos salidas: un `.cube` propio para
      ese lado es honesto y casi gratis pero solo interesa a quien hable de
      color, y un tratamiento simulado tipo `movil` se ve mucho pero hace que
      el rótulo ANTES afirme algo del metraje que no es cierto.

      El revelado por metraje se conserva: el día que se use un look fuerte
      sirve, y es el único que no necesita ningún asset. Con `imagen` **decaen
      sus dos avisos** —ni el LUT ni `--aroll completo` hacen falta— porque la
      imagen no tiene que casar con el encuadre de nada.

      **Y de ahí el peor fallo de toda la tanda, que no da error:** `-loop 1`
      sin `-t` es una entrada infinita y `alphamerge` espera a que terminen
      todas las suyas, así que la composición **no falla, se cuelga**. Medido:
      diez minutos sin escribir un fotograma más. Se acota a la duración de la
      pieza y no a la de su capa, para que el reloj de la imagen coincida con el
      del A-Roll — la máscara viene desplazada a `t0` y una imagen que empezara
      en 0 se emparejaría descolocada. Es el tipo de fallo para el que existe
      este repo, así que tiene prueba propia: quitar el `-t` la pone en rojo.

      «Arrastrable» en vídeo **no puede significar interacción**: no hay ratón
      y el fotograma se calcula, no se reacciona. Significa que se ve el
      AGARRE y que el canto se mueve con inercia de mano — `inOutCubic`,
      porque con `outCubic` sale disparado en el primer fotograma y se lee
      como un barrido automático.

      Dos casos en los que el compositor **avisa y omite el revelado** en vez
      de componer algo que parece funcionar: sin LUT los dos lados serían el
      mismo píxel, y con el metraje en columna el lado crudo tendría que
      repetir el escalado y el relleno y cualquier diferencia se vería como un
      salto en el canto.

      **Un agujero encontrado de paso, y no tapado a propósito:** el barrido de
      `comprobar_relojes.py` **no puede proponer una clave de tiempo con nombre
      nuevo**. Sus candidatas salen de `_EXACTAS` —que es la propia tabla más
      seis palabras— y de los sufijos `En/At/Dur/Ini/Fin`, así que solo propone
      nombres que ya conoce o que llevan la marca puesta. `vuelta` es la prueba:
      es una duración en segundos y el auditor no la vio; la clasificó una
      persona. No se amplía por nombre porque entonces reclamaría `lado`,
      `hueco`, `celda` y `columnas`, y una auditoría que grita en falso se deja
      de leer — es el mismo razonamiento que ya está escrito junto a `_SUFIJOS`.
      Si algún día se cierra, la señal buena no es el nombre: es que la clave
      aparezca como argumento de `span(` o `pulse(` en el JS de su plantilla.

      Las dos quedan **para planes escritos a mano**, como `compare-ab`: su
      contenido no se puede inventar. `candidatas_para` exige `RELLENABLES` y no
      están, así que el director no puede elegirlas, y **no llevan guardia a
      propósito**: una guardia sobre una plantilla inalcanzable es el error de
      `faq-card` al revés.

      El golden `anclas.json` cambia **solo por adición** —54 → 56 entradas,
      ninguna existente movida—, que es la comprobación de que `.silueta` no ha
      tocado el resto del catálogo.

### D · Robustez
- [x] Validador de plan: avisar de solapes, capas fuera de `ORDEN`, tiempos
      que se salen de la duración, `flashEn` en tiempo absoluto por error.
- [x] Comprobación de canal alfa antes de componer (el bug del `rgb24` que
      truncaba el render sin decir por qué).
- [x] Presupuesto de duración: avisar si el plan no cubre toda la locución.

### E · Exploración
- [x] Más referencias de motion en la web, con la extensión de Chrome.
- [x] Portar la tarjeta 3D y cualquier técnica que aporte algo nuevo.

---

## Ronda 2 — cola nueva

La cola inicial está terminada. Esta sale de lo aprendido montándola, no de
imaginar qué faltaría.

### F · Trampas descubiertas que aún muerden
- [x] Una plantilla que pinte fondo sobre `html` pierde el canal alfa en
      silencio: el fondo del elemento raíz se propaga al lienzo y queda
      fuera del grupo de opacidad del `body`. Detectarlo al renderizar, no
      al componer.
- [x] `hoja_contactos.js` ya mide 6600 px de ancho con 22 plantillas. A una
      fila por tema deja de ser legible: pasarla a rejilla.

### G · Sonido, segunda vuelta
- [x] Tic mecánico para el odómetro, disparado en cada acarreo. El
      componente ya sabe cuándo ocurre; el sonido debería salir del mismo
      cálculo, como los golpes de `transicion`.
- [x] Riser: subida de tensión antes de un corte fuerte. Es el efecto que
      más se nota que falta cuando el vídeo acelera.

### H · Componentes que aún faltan
- [x] Cinta / marquesina en bucle para créditos o listados largos.
- [x] Trazo SVG que se dibuja solo, para los diagramas.

### F2 · Sistema de color — CERRADO: cardenillo
- [x] **`--accent-2` no contrastaba en carbon**: ΔE 9,2 frente al acento, o sea
      el mismo bronce otra vez, con doce plantillas usándolo para diferenciar
      algo. Estuvo abierto trece tandas esperando una decisión de marca.

      Resuelto eligiendo un segundo acento de verdad: **cardenillo `#4E9A8F`**,
      el bronce oxidado. Y elegido midiendo, no a ojo — la aritmética se validó
      primero contra los 9,2 y 97,2 publicados aquí, para que sus veredictos
      fueran comparables con la medición original.

      | frente al bronce `#CD7F32` | antes | ahora |
      |---|---|---|
      | ΔE(CIELab) | 9,2 | **73,7** |
      | saturación (el bronce marca 0,61) | 0,57 | **0,33** |
      | contraste sobre `#121212` | 4,9:1 | **5,7:1** |
      | peso frente a los 6,0:1 del bronce | −1,1 | **−0,3** |

      Las dos últimas columnas descartaron las alternativas: el verde de paper
      puesto tal cual se queda en **3,4:1** y no llega al 4,5 que necesita el
      texto —lo usan los números de tabla y las líneas `ok` del terminal—, y los
      tonos más claros salen **más brillantes que el propio bronce**, que es lo
      que un acento secundario no puede hacer.

      No hacía falta el token nuevo tipo `--contraste` que se planteaba como
      salida (b): el cardenillo cabe en `--accent-2` porque no es un color
      importado, es lo que le pasa al bronce con el tiempo. Sigue dentro del
      material de §1 y su matiz (171°) coincide con el del acento-2 de paper
      (175°), así que los dos temas pasan a significar lo mismo: acento cálido,
      acento-2 frío.

      **La lista de afectados de esta nota estaba mal**, y se comprobó al
      arreglarlo: nombraba «la comparativa A/B» y «la llamada del cierre», y
      **ninguna de las dos usa el token**. Los consumidores reales son doce:
      `anotacion`, `code-mockup`, `data-diagram`, `fondo`, `hero-stat`,
      `kicker-hud`, `mapa-calor`, `pills`, `pasos-flow`, `marcos`, `pip-frame`
      y `terminal`.

      Verificado MIRANDO y midiendo el píxel: el color nuevo llega al render de
      todos —tabla 5464 px, anotación 3741, terminal 3703, pastillas 1556, mapa
      de calor 980, hero-stat 58— y ahora la pastilla `stat` se distingue de la
      `cmd`, la línea `ok` del terminal del comando, y la flecha `frio` del
      círculo en bronce.

      Y un cuidado que casi se me pasa: `--metal-2` tenía el MISMO valor que el
      viejo acento-2 (`#B87333`) y es otra cosa —un stop del degradado
      metálico—. Cambiarlo habría desteñido el acabado de todas las tarjetas.

      `tests/test_color.py` fija las propiedades, no el color: ΔE mínimo de 40
      —muy por encima del 9,2 que había y holgadamente por debajo del 73,7 que
      hay—, AA para texto, techo de saturación en el propio bronce, temperatura
      por tema, y que los dos bloques de carbon de `_tokens.css` no se
      desincronicen. Con el color viejo puesto, dos de ellas fallan.

      **Un fallo mío en esas pruebas**: la de «el acento-2 no grita más que el
      primero» la escribí con el contraste contra el fondo en los dos temas y
      falló en paper con razón — sobre fondo claro más contraste significa más
      OSCURO, no más ruidoso. La regla que quería era «no más brillante», y solo
      se puede escribir con la luminancia y solo en el tema oscuro.

### I · Liquid glass
- [x] La refracción usa un mapa de desplazamiento fijo. Que varíe con el
      movimiento de la capa daría cristal que reacciona en vez de cristal
      estampado.

---

## Ronda 3 — cola nueva

- [x] Componer una pieza nueva que estrene odómetro, cinta, anotaciones y
      marcos. Trece tandas de componentes sin un vídeo que los use es
      biblioteca, no resultado.
- [x] `hoja_contactos.js` renderiza 28 fichas en serie; con Playwright ya
      abierto podría reutilizar la página entre plantillas del mismo tema.
      **Medido y descartado**: no ahorra tiempo. Ver tanda 16.
- [x] El aviso de raíz opaca solo mira `background-color`. Un
      `background-image` a sangre en `html` haría lo mismo y no se detecta.
- [x] Presets de anotación (`sobre: 'karaoke'`) que coloquen la marca a
      partir de la geometría de otra capa, en vez de a mano por coordenadas.

---

## Ronda 4 — cola nueva

- [x] Publicar anclas en el resto de plantillas anotables: `cita.texto`,
      `hero-stat.valor`, `kinetic-type.ultima`, `marcos.pantalla`.
- [x] `validar_plan.py` no comprueba las referencias `sobre:`. Debería
      avisar de un ancla inexistente ANTES de renderizar, y de que la capa
      de destino vaya después en el plan.
- [x] Barrer el resto del código en busca de no-determinismo del mismo tipo
      que el `hash()` del compositor. **El código está limpio, pero el
      render NO es reproducible al 100 %.** Ver tanda 21 — queda abierto
      abajo.

### J · Cerrado en el Sprint 4: NO SE REPRODUCE
- [x] Dos renders del plan completo a 25 fps daban fotogramas distintos en la
      capa `kinetic`. **Cuantificado, y el resultado es que ya no pasa.**

      Medido sobre el plan REAL de la pieza «Codex Security» —8 capas, 1431
      fotogramas, 25 fps, dos renders completos—:

      | capa | difieren |
      |---|---|
      | `kineticcaptions` | 0 de 962 |
      | `securitypipelinenodes` | 0 de 162 |
      | `cierrecta` | 0 de 88 |
      | `codemockup` | 0 de 68 |
      | `headlineclipper` | 0 de 63 |
      | `targethud` | 0 de 33 |
      | `stampbanned` | 0 de 30 |
      | `svgcheckmark` | 0 de 25 |
      | **total** | **0 de 1431 (0,00 %)** |

      Y con la capa `kinetic` aislada, 0 de 100. Bit a bit idénticos en los dos
      casos, así que el render ES reproducible hoy.

      **No se sabe qué lo arregló**, y conviene decirlo en vez de atribuirlo:
      la nota original apuntaba a «rasterización del navegador bajo carga», que
      es una causa que depende de la máquina y del momento, no del código. Pudo
      cambiar Playwright, pudo cambiar el catálogo, o pudo ser la carga.

      Lo que queda no es una nota esperando: `tests/test_oro.py` mide esto en
      cada ejecución del nivel de render, con DOS pruebas —capa aislada y plan
      multicapa, porque aislada nunca falló y medirla sola no responde a la
      pregunta— y usando el umbral que este repo ya calibró en
      `comparar_fotogramas`: `max <= 4` y `media < 0.05`. Si vuelve, salta ahí.

---

## Bitácora

Se anota aquí cada tanda: qué se hizo, qué falló y qué queda.

<!-- BITÁCORA -->

### Tanda 1 — biblioteca de sonido

**Hecho:** `hacer_sfx.py` sintetiza 7 efectos con `aevalsrc`, sin muestras
ajenas. Los golpes se colocan solos: cada capa deduce sus señales del propio
plan (`cortes`, `flashEn`) y las publica en el manifiesto, así que mover una
transición mueve su sonido. Ducking de la voz con `sidechaincompress`.

**Verificación.** No puedo oír, así que fue por medida y por vista:
espectrogramas para confirmar que la energía cae donde se diseñó (el barrido
sube de 300 a 2400 Hz, el subgrave vive por debajo de 180 Hz), y una
comparación A/B con y sin efectos para aislar su aporte real.

**Lo que falló y cómo se corrigió:**
- La medición devolvía `None` en todo: `astats` escribe a nivel INFO y yo
  lanzaba ffmpeg con `-v error`, silenciándome a mí mismo.
- La primera mezcla dejaba los impactos en **+1,5 dB sobre la voz**, o sea
  inaudibles. Los barridos sí funcionaban (+65 dB) porque caen en pausas de
  la locución. Corregido subiendo el peso de los impactos a 1,7 y apretando
  el ducking: ahora aportan +3,2 dB. Sigue siendo un mix conservador.
- Se descubrió de paso que `--preview` está roto con capas de cristal.

**Pendiente de juicio humano:** el criterio estético del sonido. Las medidas
dicen que está bien colocado y no satura; si suena *bien* no lo puedo saber.

### Tanda 2 — cerrar lo pendiente

**Hecho:** lecho ambiental en la mezcla, `--preview` arreglado, la hoja de
contactos ya cubre las 18 plantillas, y por fin la tarjeta 3D con paralaje.

**Lo que falló y cómo se corrigió:**

- **`--preview` con cristal:** `Parsed_alphaextract_26` no podía negociar
  formato. Al escalar, ffmpeg elige un formato sin alfa y `alphaextract` se
  queda sin canal que extraer. La cadena era correcta a resolución nativa,
  por eso solo se manifestaba en `--preview`. Se repite `format=rgba`
  *después* del `scale`.
- **El lecho medía −91,4 dB en las pausas**, o sea silencio digital. Ahora
  −60,5 dB: presente, 40 dB por debajo de la voz. Se mezcla **antes** de los
  golpes para que el ducking actúe sobre el total y no solo sobre la voz.
- **Tarjeta 3D, tres fallos que solo se vieron mirando el render:**
  1. El `\n` del plan llega como salto de línea real, pero el `replace`
     buscaba la secuencia literal `\\n`. El título nunca cortaba. Ahora
     acepta las dos formas.
  2. El reflejo especular en `mix-blend-mode: screen` era invisible: sobre
     una superficie blanca no hay nada más claro que blanco. Sustituido por
     un sombreado direccional — el canto que se aleja se apaga — cuya
     dirección sale de `atan2(rx, -ry)`. Eso sí lee como volumen.
  3. Con `perspective: 1600px` y profundidades de 26–96 px el paralaje era
     imperceptible. A 1050 px y 40–165 px el texto ya se despega de la
     rejilla. La rejilla interior no es decoración: sin una textura regular
     el ojo no tiene referencia y la inclinación se lee como un escalado.

**Nota de método:** los tres fallos de la tarjeta pasaban cualquier log. El
render terminaba sin un aviso y el JSON era correcto.

### Tanda 3 — cita y barra de capítulos

**Hecho:** `cita.html` (cita a pantalla completa con revelado línea a línea)
y `capitulos.html` (barra de progreso por capítulos). Las dos verificadas en
los dos temas con la hoja de contactos, que ya cubre 20 plantillas.

**Lo que falló:**

- **La comilla salía partida.** Con `line-height: 0.62` el medio-interlineado
  es negativo: el glifo desborda la caja por arriba, así que el `overflow:
  hidden` recortaba su cuerpo y dejaba ver solo la base — dos manchas sin
  forma. Con `line-height: 1` el recorte cae donde se esperaba. Regla:
  para recortar un glifo por abajo hace falta interlineado ≥ 1.

**Decisiones de diseño que costaron una versión:**

- En la cita, los saltos de línea NO se calculan: se envuelve palabra a
  palabra, se deja maquetar al navegador y luego se agrupan por `offsetTop`.
  Medir anchos de texto a mano es reimplementar peor lo que ya hace el motor
  de maquetación.
- En la barra, cada capítulo es su propio carril en vez de un carril único
  con marcas. Solo así el capítulo terminado puede quedarse lleno mientras
  el actual avanza, que es lo que hace legible el progreso de un vistazo.
- El ancho de cada carril es proporcional a su duración, así la velocidad de
  avance es constante en toda la barra.

### Tanda 4 — mapa de calor

**Hecho:** `mapa-calor.html`, rejilla de datos con entrada en onda diagonal,
foco sobre una celda y llamada asociada.

**Lo que falló:** el color del número se decidía con un umbral sobre el
valor (`v >= 0.55 → texto claro`). Funcionaba en tema claro y fallaba en
oscuro, y el motivo es que la premisa se invierte: sobre papel la celda se
**oscurece** al subir el valor, sobre carbón se **aclara**. Un solo umbral no
puede acertar en los dos. Ahora el color se elige midiendo el contraste WCAG
real de la celda ya mezclada contra `--ink` y contra `--bg`, y gana el mayor.
El parámetro `umbral` desapareció: era una decisión que el propio dato puede
tomar.

**Falsa alarma anotada, por método:** creí ver un segundo fallo —el 86 en
carbon parecía claro sobre naranja saturado— y era mi lectura de una tira
reducida. Sondeando el DOM con Playwright, la celda tenía `var(--bg)`, justo
lo que decía la tabla de contrastes. Mirar el render es imprescindible, pero
a tamaño reducido engaña: para juzgar contraste hay que ampliar o medir.

**Nota:** la mezcla asume `--surface` como fondo. El fondo real es el metraje
y no se puede conocer desde la plantilla; la aproximación solo afectaría a
celdas de valor muy bajo, donde ambos colores contrastan de sobra.

### Tanda 5 — marcos de navegador y de móvil

**Hecho:** `marcos.html` con dos variantes. Todo el contenido de pantalla se
dibuja con geometría —barras, bloques, un titular—: no se usa ninguna captura
real, porque no habría de quién. La URL se teclea en tiempo determinista y el
contenido se desplaza *después* de que termine de escribirse: primero se
navega, luego se lee.

**Lo que falló, los tres mirando el render:**

1. **El bisel del móvil salía crema.** Usaba `var(--chrome)`, que en tema
   claro es un gris cálido, y el resultado se leía como una tarjeta
   redondeada, no como un teléfono. Un bisel es un objeto físico: no debe
   tematizarse. Ahora es un valor fijo oscuro con una franja de luz en el
   canto. Regla general: **lo que representa materia real queda fuera del
   sistema de temas.**
2. **Media pantalla vacía.** En vertical no caben tres columnas, pero dejar
   una sola dejaba el móvil medio vacío. Ahora apila bloques hasta llenar el
   alto disponible.
3. **La hora quedó invisible.** Al oscurecer el chasis, la barra de estado
   —que no tenía fondo propio— heredó el negro del bisel y pintó `--ink`
   oscuro sobre negro. La barra de estado pertenece a la pantalla, no al
   chasis, y ahora lleva `background: var(--bg)`.

El fallo 3 lo **causó** el arreglo del 1. Un cambio de fondo se propaga a
todo lo que no declaraba el suyo, y eso no aparece hasta que se mira.

### Tanda 6 — tarjeta de cierre

**Hecho:** `cierre-cta.html`. El botón se pulsa y de la pulsación salen ondas
concéntricas; un puntero entra desde abajo-derecha, toca y se retira. La
pulsación no es adorno: sin el gesto, un botón en un vídeo es una imagen, no
una instrucción. Bloque C cerrado.

**Lo que falló:** el puntero nunca llegaba al botón, se quedaba 100 px por
debajo. `.puntero` es `position: absolute` pero no declaraba `left`/`top`, así
que partía de su **posición estática** —detrás del botón en el flujo, o sea
debajo— y el `translate` lo alejaba todavía más. Anclado en `0,0` el translate
pasa a ser coordenada dentro del envoltorio, y el destino se calcula midiendo
el botón. Se apunta a la **punta** de la flecha, no a su esquina: en el
`viewBox` de 24 está en (5,3), que en 46 px cae en (10,6).

**Segunda falsa alarma en dos tandas.** Di también por descentradas las ondas
mirando la tira reducida; sondeando el DOM estaban exactas sobre el botón
(540, 1079). Van dos veces que una tira a escala pequeña me hace ver un fallo
que no existe. **Conclusión de método: la tira sirve para juzgar ritmo y
composición; para geometría y contraste hay que ampliar o medir el DOM.**

### Tanda 7 — validador de plan

**Hecho:** `scripts/validar_plan.py`, paso 4 del pipeline en `CLAUDE.md`.
Comprueba estructura, existencia de la plantilla, pertenencia a `ORDEN`,
tiempos relativos escritos en absoluto, desajuste entre `duracion` y
`config.duration`, solapes por carril, capas fuera del vídeo y huecos sin
gráficos. Devuelve 1 si hay errores.

Cada regla sale de un fallo que ya ocurrió aquí, no de imaginar qué podría
salir mal. Por eso el aviso de `ORDEN` explica *por qué* importa —la capa se
renderiza y el compositor la tira sin decir nada— en vez de limitarse a
señalar la línea.

**Verificado contra un plan roto a propósito** con los siete fallos: los
detecta todos (3 errores, 5 avisos) y el plan real sigue saliendo limpio. Un
validador que solo se prueba con entradas buenas no está probado.

**Lo que falló:** la detección de huecos inventaba uno de 23 a 25 s en un
vídeo de 20, porque incluía en el cálculo una capa que ella misma acababa de
marcar como posterior al final. Ahora los tramos se recortan a `[0,
duracion]` antes de buscar huecos.

**Decisión:** `ORDEN` se lee del compositor con una expresión regular en vez
de importarlo. Importarlo arrastraría sus dependencias y el validador tiene
que poder correr solo, que es justo lo que lo hace barato de ejecutar.

### Tanda 8 — comprobación de canal alfa

**Hecho:** `scripts/comprobar_alfa.py`, paso 6 del pipeline. Lee el tipo de
color en la cabecera IHDR de cada PNG —26 bytes por archivo, sin decodificar
ni llamar a ffprobe— y clasifica cada capa. Barrido completo en **0,73 s**.

La severidad no es «tiene alfa o no»: **el fallo caro es que se MEZCLEN**
formatos dentro de una secuencia, porque ahí ffmpeg reconfigura el grafo a
mitad y trunca. Una capa uniformemente opaca no trunca nada, así que es
aviso. Y una capa de cristal sin alfa es error: su máscara se queda sin nada
que recortar.

**Verificado contra una secuencia rota a propósito:** 8 fotogramas RGBA y 2
RGB. Los detecta, nombra el primero culpable y devuelve 1.

**Tres cosas que salieron por el camino, ninguna buscada:**

1. **`fondo` no tiene alfa, y la garantía no le llega.** `fondo.html` pinta
   `html, body { background }`. El fondo del **elemento raíz** se propaga al
   lienzo y queda FUERA del grupo de opacidad del `body`, así que el truco
   de `body { opacity: 0.998 }` no lo cubre. En `fondo` es intencionado —es
   la capa base—, pero cualquier plantilla que pinte sobre `html` pierde el
   alfa sin avisar.
2. **iCloud estaba corrompiendo `build/`.** El repo vive en `~/Documents`,
   sincronizado. Había **1348 copias de conflicto** (`00140 3.png`) y los
   originales desalojados: cada `open()` bloqueaba segundos descargando, y
   el barrido pasaba de 0,73 s a más de 6 minutos. El compositor se salva
   porque lee con patrón `%05d.png` e ignora esos nombres. Copias borradas y
   aviso puesto en `CLAUDE.md`.
3. **El comprobador estaba comprobando lo que no toca.** Recorría `*.png`,
   o sea 1348 archivos que ffmpeg no abre jamás. Ahora filtra por el mismo
   patrón que consume el compositor. No era una optimización: comprobar
   archivos que no entran en el vídeo es comprobar otra cosa.

**Lo que falló de mi parte:** borré los directorios vacíos mientras el
barrido corría y lo reventé con un `FileNotFoundError`. Listar y leer no es
atómico; ahora tolera que un directorio desaparezca a mitad.

### Tanda 9 — máscaras de cristal y `--only`

**La premisa del backlog era falsa.** `--only` **sí** rehace la pasada de
máscara: `renderizarCapa` la lanza siempre que la capa lleva `cristal`, y
`renderizarPasada` vacía el directorio antes de escribir. Comprobado bajando
una capa de 5 s a 3 s con `--only`: capa y máscara pasan las dos de 125 a 75
fotogramas. Ahí no había nada que arreglar.

**Pero buscando eso aparecieron dos fallos que sí son reales**, y ninguno
tiene que ver con `--only`: el manifiesto **sobrevive** a que la máscara se
estropee por fuera.

1. **Directorio ausente.** El filtro `vivas` solo comprobaba `c.dir`, no
   `c.mask`. Si la máscara se borra y luego se renderiza otra capa, el
   manifiesto conserva una ruta muerta y ffmpeg falla con un error suyo,
   ilegible.
2. **Fotogramas de menos.** Máscara con 65 y capa con 75: la silueta se
   acaba antes, la refracción se desincroniza y **no avisa nadie**. Este era
   el peligroso.

Ahora se comprueban ambos al escribir el manifiesto. Si algo no cuadra se
quitan las claves de cristal —mejor perder la refracción con un aviso que
reventar el compositor con una ruta rota— y se imprime el comando exacto que
lo arregla. Los avisos van también en la salida JSON, para que sean visibles
a máquina y no solo por `stderr`. Verificado que ese comando restaura el
cristal y deja capa y máscara en 75/75.

**Comprobación de extremo a extremo:** `final_output.mp4` sale de 23,000 s y
575 fotogramas a 540×960, con cristal. El pipeline está entero.

**Mi error, y ya van tres esta noche.** Di el render por truncado —7,48 s en
vez de 23— midiendo con un glob `renders/*preview*.mp4` que no apuntaba al
archivo recién escrito, sino a un `preview.mp4` de la víspera. Antes había
dado por rotas las ondas del CTA y el contraste del mapa de calor leyendo
tiras reducidas.

> **Las tres veces el fallo fue mío, no del código, y siempre el mismo:
> mirar deprisa algo que no era lo que creía estar mirando.** Verificar
> mirando sigue siendo la regla, pero exige comprobar antes *qué* se está
> mirando: la ruta exacta del archivo, la escala de la imagen, el fotograma
> concreto. Una medición descuidada no es una verificación: es una
> suposición con aspecto de dato.

### Tanda 10 — exploración y odómetro

**Hecho:** `odometro.html`, contador de tambores. Cola inicial terminada,
19 de 19.

**De la exploración web.** El pen de referencia era React con un
`easeInOutCubic` empujando el valor; los paneles de código llegaron a medias
porque el navegador bloqueó parte del contenido. No hacía falta más: lo que
importaba era **la idea**, y está implementada desde cero, sin copiar código
ajeno —lo mismo que se aplica al audio y al arte.

**La idea que valía el viaje:** la posición de cada columna debe ser una
función **continua** del valor —`valor / 10^peso`, módulo 10— y no un dígito
discreto. Al ser continua, cuando las unidades pasan de 9 a 0 la columna de
las decenas **ya está girando**, que es de donde sale la sensación de
acarreo mecánico. Con un dígito por columna cada una saltaría por su cuenta
y parecería un marcador digital, no un odómetro.

Dos detalles que lo rematan y que no venían del pen:

- La tira lleva **once** dígitos, `0…9` más un `0` de cierre. Sin ese cero
  repetido el acarreo tiene que saltar de golpe al principio de la tira.
- El velo degradado arriba y abajo no es adorno: sin él las columnas se leen
  como listas recortadas; con él parecen tambores que siguen girando fuera
  de cuadro. Toma el color de `--bg`, así que funciona en los dos temas.

Añadido `rigidez`: concentra el giro en el tramo final del dígito, de modo
que la columna se queda quieta y rueda de golpe al acarrear. A 0 giran todas
a la vez y parece una noria.

**Verificado** en los dos temas. Nada que corregir esta vez.

---

## Estado al terminar la cola inicial

19 de 19. Bloques A (sonido), B (pendientes), C (componentes), D (robustez) y
E (exploración) cerrados. 23 plantillas, dos temas, dos validadores en el
pipeline y una bitácora de diez tandas.

**Lo que más ha rendido no es ningún componente: es el método.** Renderizar y
mirar ha encontrado fallos que ningún log delataba —comillas partidas,
paralaje imperceptible, hora invisible sobre bisel negro, texto ilegible
sobre celdas saturadas—. Y sus tres fallos propios, todos míos, apuntan a lo
mismo: **medir deprisa algo que no es lo que uno cree estar mirando** —una
tira reducida, un archivo de la víspera— no es verificar, es suponer con
aspecto de dato. La regla completa es: verificar mirando, y comprobar antes
qué se está mirando.

### Tanda 11 — la trampa de la raíz, y la hoja en rejilla

**Raíz opaca.** El renderizador mira ahora el `background-color` calculado
del elemento raíz **antes** de capturar, y avisa si no es transparente:
nombra la capa, la plantilla, el color exacto y qué hacer. Es la causa;
`comprobar_alfa.py` seguía viendo solo el síntoma en los PNG ya escritos.

Como `fondo.html` lo hace a propósito —es la capa base—, una plantilla puede
declararlo con `<meta name="capa-opaca" content="1">`. Así el aviso solo
suena cuando es un descuido. Verificado en los dos sentidos: silencio en
`fondo`, y aviso inmediato en una copia de `cita.html` con un
`html { background: #ff0000 }` metido a mano.

Si la capa es además de cristal, el mensaje lo dice aparte: sin alfa la
máscara no tiene silueta y la refracción se aplicaría al fotograma entero.

**Hoja de contactos en rejilla.** De 6600×1066 a **2100×4440**, 7 columnas.
Dos cambios, y el segundo importa más que el primero:

1. Los dos temas de una plantilla van **apilados en la misma ficha**, no en
   dos filas separadas a lo largo de toda la hoja. Comparar temas es el
   motivo de existir de esta herramienta, y con filas largas hay que contar
   columnas a ojo para emparejarlos.
2. **Cada ficha lleva su nombre debajo.** Esto no es cosmética: esta misma
   noche conté columnas mal dos veces y recorté la plantilla equivocada. Una
   herramienta de verificación que obliga a contar a ojo para saber qué se
   está mirando fabrica exactamente el error que debería evitar.

Las etiquetas se dibujan con Playwright, no con `drawtext`: este ffmpeg no
trae `libfreetype`. Estando ya el navegador abierto, era el camino corto.

### Tanda 12 — tic de trinquete y riser

**Contrato nuevo: la plantilla publica su propio sonido.** `def.setup` puede
devolver `cues: [{at, sfx, gain}]` en tiempo relativo, el motor los pasa y el
renderizador los coloca. Deducirlos fuera obligaba a duplicar la fórmula de
la animación, y esa copia se desfasa en cuanto se toca la curva. Quien sabe
cuándo pasa algo es quien lo anima.

**El tic no suena en cada acarreo, y esa es la decisión.** Subir a 34.500 son
34.500 acarreos en las unidades: un zumbido, no un sonido. Lo que se oye —y
lo que significa— es cuándo cada tambor **se para**. Se detienen del más
significativo al menos, así que salen tres tics (1,19 s, 1,69 s y 2,15 s) que
cierran justo cuando la cifra queda fija. Los tiempos se obtienen muestreando
la misma función que dibuja `draw`, no una copia de su fórmula.

**Lo que hubo que corregir:** con un valor acabado en ceros, centenas,
decenas y unidades se paran **en el mismo instante** —la rampa termina y los
tambores paran con el eje—. Físicamente correcto, sonoramente inútil: tres
tics apilados no se oyen como tres, se oyen como uno más fuerte, y sumados
pueden saturar. Se funden en uno solo algo más recio.

**El riser anuncia el corte, no lo acompaña.** Se coloca su propia duración
por delante para que el pico caiga encima. Si no cabe, se **descarta con
aviso** en vez de recortarlo: medio riser suena a error de montaje, no a
tensión. Verificado en los dos casos — colocado en 2,300 para un corte en
4,000, y omitido con aviso para un corte en 1,0.

**Verificación, que no puedo oír:**
- Tic: decae 25 dB en 45 ms, o sea un chasquido seco y no un tono.
- Riser: sube 37,5 dB de energía, y el reparto grave/agudo vuelca de −10,4 a
  +11,9 dB, así que el barrido sube de verdad.
- En la mezcla real, los tics aportan +6,1, +15,8 y +9,6 dB en su banda,
  frente a +0,0 dB en un instante de control.
- El riser crece de −61,4 a −25,1 dB y **culmina en el corte**, soltando
  después.

**Mi cuarto error de medición esta noche**, cazado antes de concluir nada: el
centroide espectral me salía clavado en 4000 Hz en todos los tramos. No era
el riser: mi DFT diezmaba la señal tomando una muestra de cada cuatro sin
corregir el índice de frecuencia, y devolvía ruido plano. Sustituido por una
comparación de energía entre bandas con ffmpeg, que no tiene ese margen de
error. **Una medida sospechosamente constante casi siempre acusa al
instrumento, no al objeto.**

### Tanda 13 — cinta en bucle y anotaciones a mano

**Hecho:** `cinta.html` y `anotacion.html`.

**La cinta no usa animación CSS, y no es un capricho.** El desplazamiento es
`(t · velocidad) mod anchoGrupo`, función pura del reloj de la plantilla, así
que `seek` a cualquier instante da el mismo fotograma. Una animación CSS
capturada frame a frame produce repetidos y saltados — el mismo motivo por el
que todo el motor funciona así.

Para que el bucle no deje hueco, la pista repite el grupo
`ceil(ancho/anchoGrupo) + 2` veces: uno para cubrir lo visible y otro para
que siempre haya material entrando cuando el primero se va. Verificado en
cuatro instantes repartidos, con varias vueltas del módulo por medio: texto
continuo y bandas en direcciones opuestas.

**Las anotaciones tiemblan a propósito.** Un trazo perfecto se lee como un
`div` con borde; el pequeño error de pulso es lo que lo hace parecer dibujado.
El temblor sale de `Engine.noise`, no de `Math.random`, para que dos renders
del mismo plan den el mismo trazo. La longitud del `stroke-dasharray` se toma
de `getTotalLength()`: estimarla haría que el trazo acabara antes o después
según la forma. Y los trazos de una misma marca van **en serie** —las barbas
de la flecha después del asta—: dibujarlos a la vez delata la animación en
vez de imitar un gesto.

**Lo que destapó la hoja de contactos, y no buscaba:** en carbon la flecha
marcada como `frio` es indistinguible de las demás. Medido, ΔE entre
`--accent` y `--accent-2` es **9,2 en carbon** y **97,2 en paper**: diez veces
menos separación. En carbon son el mismo bronce con otro matiz.

No he tocado la paleta. Carbon & Bronze es monocromo a propósito y elegir si
la marca quiere un segundo color no me corresponde; queda anotado en el
bloque F2 con las dos salidas posibles y la medida que lo respalda. Esto es
justo lo que la hoja de contactos existe para encontrar, y solo apareció al
ponerla en rejilla con los dos temas juntos en la misma ficha.

### Tanda 14 — el cristal se despegaba de lo que refracta

**La tarea era estética y resultó ser un fallo de alineación.**

El paralaje desplaza cada capa con una expresión en `t`, pero la **máscara**
del cristal se componía en `overlay=0:0`, en coordenadas de pantalla fijas.
Resultado: el panel viaja y su propio agujero difuminado se queda quieto. Con
`parallax: 5` es un borde sucio que se puede confundir con una sombra; subido
a 40 para la prueba, el halo asoma como una banda naranja bajo la pastilla.

**Verificado mirando, y solo así se ve.** Ningún log podía delatarlo: el
grafo era válido, el render completo y el JSON correcto. Un antes/después
recortado al mismo instante lo deja sin discusión.

**El arreglo cubre las dos cosas de una vez.** El cálculo del paralaje sube
por encima del bloque de cristal y ahora arrastra tres flujos con la misma
expresión: la capa, la máscara y el mapa de refracción. Alinear la máscara
quita el halo; arrastrar el mapa es lo que pedía el backlog — con el mapa
clavado a la pantalla, el dibujo de la refracción se queda quieto mientras el
cristal pasa por encima, y eso se lee como un estampado, no como un vidrio.

**Dos detalles que costaron pensarlos:**

- `crop` acepta expresiones con `t` pero no puede salirse del cuadro, así que
  hay que **acolchar antes** por los cuatro lados y recortar con
  desplazamiento negativo. El margen es `|paralaje| + 2`.
- El acolchado del mapa **no puede ser negro**: en un mapa de desplazamiento
  el neutro es 128. Rellenar con negro habría desplazado el borde a saco.
  Va en `0x808080`.

**Comprobado de punta a punta** tras el cambio: canal alfa correcto en las 20
capas, plan válido, y `final_output.mp4` en 1080×1920, 575 fotogramas,
23,000 s.

### Tanda 15 — «Treinta segundos», la pieza que usa lo construido

**Hecho:** `renders/treinta_segundos.mp4`, 23,6 s en 1080×1920. Locución con
edge-tts, alineada con el guion, y diez capas: odómetro, cinta, anotación,
marcos de navegador, pasos, capítulos, cinético, transiciones con riser y
subtítulos. Cuatro de los componentes se estrenan aquí.

**El fallo que solo podía aparecer en un vídeo real.** El odómetro pintaba
una **caja clara detrás de la cifra**. Su velo superior e inferior era un
degradado de `--bg` a transparente, y sobre una capa transparente eso no
funde con nada: **pinta ese color**. En la hoja de contactos era invisible
porque allí la ficha se compone justo sobre el mismo `--bg`; sobre el vídeo,
con fondo texturado debajo, saltaba a la vista.

Corregido con `mask-image`, que ataca el **alfa** en lugar de pintar color.
Regla general, y vale para cualquier plantilla: **en una capa con alfa, un
desvanecido hacia el fondo tiene que hacerse con máscara, nunca con un
degradado al color del fondo.** La hoja de contactos no puede cazar esta
clase de fallo por construcción — compone cada ficha sobre su propio fondo,
que es justo la condición en la que el error se esconde.

**Lo que falló de la primera pasada, todo visible solo al mirar:**
- «TREINTA» y «SEGUNDOS» se solapaban: 160 px de separación son pocos a ese
  cuerpo. A 250 px respiran.
- El remate del guion —«Ya ha terminado.»— se iba de pantalla porque el
  marco de navegador se desplazaba 120 px. Bajado a 40: la frase es el
  remate, la maqueta es el decorado.

**Dos tropiezos de encaje, no de código:**
- `clean_transcript.py` recortaba 6,8 s de silencios. Está pensado para
  metraje real; con locución sintetizada no hay nada que recortar y sus
  cortes habrían desincronizado el audio. El timeline se construye con un
  único tramo.
- Puse `voz.mp3` como fuente del timeline y el grafo murió con «Stream
  specifier ':v' matches no streams»: un mp3 no tiene pista de vídeo. La
  base tiene que llevar las dos, aunque su imagen quede tapada por `fondo`.

**Y una fragilidad del entorno, otra vez iCloud:** vaciar un directorio de
fotogramas falló con `EACCES` porque el sincronizador tenía un archivo
retenido en ese instante. Al segundo intento entra. `render_playwright` ahora
reintenta cuatro veces antes de rendirse; la solución de fondo sigue siendo
sacar `build/` de la sincronización.

### Tanda 16 — una optimización que no lo era

**La tarea partía de una premisa falsa y la medida la tumbó.**

`hoja_contactos.js` navegaba una vez por plantilla **y por tema**: 56
navegaciones donde bastaban 28. Lo implementé, y las 56 celdas salieron
**idénticas al byte**, así que ninguna plantilla ensucia el DOM entre temas.
Funcionaba.

Pero el A/B dice: **6,67 s con 28 navegaciones frente a 6,45 s con 56.**
Dentro del ruido, y si acaso al revés. `goto` sobre un `file://` local es
barato; el coste está en las capturas y en el montaje de ffmpeg.

**Lo revertí.** El cambio introducía una regla implícita —«todo `setup` debe
limpiar su contenedor»— a cambio de cero. Comprobarlo hoy no protege a la
plantilla que se escriba mañana, y una invariante tácita que nadie recuerda
es exactamente como se rompen las cosas. El motivo queda escrito junto al
código, con las cifras, para que nadie vuelva a intentarlo a ciegas.

**De dónde salía la premisa:** escribí esa tarea creyendo que la hoja era
lenta. Lo era, pero no por las navegaciones — era iCloud bloqueando lecturas
de fotogramas, que ya estaba arreglado cuando llegué aquí. **Anoté un
síntoma como si fuera una causa**, y el backlog heredó el diagnóstico
equivocado.

### Tanda 17 — el aviso de raíz opaca se dejaba una puerta

`background-image` en `html` tapa igual que un color y no aparece en
`backgroundColor`. Mirar solo el color dejaba pasar el mismo fallo por otra
propiedad. Ahora el aviso comprueba las dos y **dice por cuál** de ellas
entra, que es lo que hace falta para arreglarlo sin buscar a ciegas.

Verificado en los dos sentidos: un degradado en la raíz lo dispara nombrando
`background-image`, y las diez capas del plan real no producen ni un falso
positivo.

### Tanda 18 — anclas, y el compositor que tiraba los dados

**Hecho:** una capa puede colocarse sobre la geometría de otra con
`{sobre: 'odometro.cifra', margen: 78}` en vez de copiar coordenadas. La
plantilla publica sus cajas devolviendo `anclas` desde `setup` —el mismo
canal que ya usaban las señales de sonido—, el renderizador las guarda en el
manifiesto y las resuelve en memoria. **El plan en disco conserva `sobre`
sin resolver**: sigue siendo declarativo, y si cambia el cuerpo de la cifra
la marca se recoloca sola.

Si el ancla no existe, avisa diciendo cuáles hay y preguntando si la capa de
destino se renderizó antes. Me pasó a mí en la primera prueba y el mensaje
me dio el diagnóstico entero.

**Y buscando por qué el círculo derivaba respecto a la cifra, apareció algo
mucho peor.**

La fase del paralaje salía de `hash(nombre)`. **Python aleatoriza el hash de
cadenas en cada proceso**: medido, `hash('odometro')` dio 0,56 / 0,89 / 0,87
en tres ejecuciones seguidas. O sea que **dos composiciones del mismo plan no
daban los mismos fotogramas**, y todo el proyecto se apoya en lo contrario —
las plantillas prohíben `Math.random`, usan `Engine.noise` con semilla y
llaman a `seek(t)` en vez de dejar correr el reloj, y luego el compositor
tiraba los dados en la última etapa.

Sustituido por `zlib.crc32`, estable entre procesos. **Verificado: dos
composiciones seguidas del mismo plan dan ahora archivos idénticos al byte.**

**El fallo original también está arreglado, y con la misma pieza.** Una capa
anclada a otra hereda su desfase (`faseCon`): si oscilan a distinto ritmo, la
marca se despega de lo que señala por mucho que su posición inicial sea
exacta.

**Lo que me llevo de esta tanda:** el determinismo estaba defendido a
conciencia en la capa donde alguien se acordó de defenderlo, y roto en la
etapa que nadie miró. Un no-determinismo de 5 píxeles no rompe nada visible
— por eso llevaba ahí desde el principio.

### Tanda 19 — las anclas medían en el momento equivocado

**Hecho:** publican anclas `cita`, `hero-stat`, `kinetic-type`, `marcos` y
`odometro`. Pero hacerlo destapó que el diseño de la tanda anterior estaba
mal, y para el odómetro colaba de casualidad.

**Las anclas se medían dentro de `setup`, o sea con los elementos en
reposo**, antes de que `draw` aplicara ningún transform. Para el odómetro
daba igual —la cifra no se mueve— y por eso pasó desapercibido. Al añadir
las demás saltó a la vista:

| ancla | medida en `setup` | medida con la animación puesta |
|---|---|---|
| `hero-stat.valor` | 82 × 182 | **636 × 193** |
| `kinetic-type.ultima` | centro en x=1010 | **centro en x=540** |
| `marcos.pantalla` | 827 × 489 | **880 × 520** (lo configurado) |

El ancho de 82 px era el del contador **antes de contar**; el centro en 1010
era el de una palabra **antes de que su gesto la colocara**; y los 827×489
eran los 880×520 reales encogidos por la animación de entrada.

**Corregido sacando la medición de `setup` a un método propio**,
`TPL.anclas()`, que el renderizador llama **después** de `seek(tAncla)`
—por defecto a mitad de capa, ajustable con `tAncla` en el plan—. Así la
caja es la real en ese instante.

**Lo que me llevo:** un componente que no se mueve no prueba nada sobre un
sistema que mide posiciones. El odómetro validó el diseño por ser el caso
más fácil, y el fallo estaba esperando al primer elemento animado.

**Y un error mío, de los tontos:** inserté el `return` de hero-stat por
número de línea y cayó dentro de `defaults`, entre dos propiedades. Error de
sintaxis, `window.TPL` sin definir y la sonda colgada 30 s en un
`waitForFunction`. Editar por posición en vez de por contexto no vale la
prisa que ahorra. De paso, la sonda ahora corta a los 4 s y dice «script
roto» en vez de reventar con un timeout que no explica nada.

### Tanda 20 — el validador ya entiende las anclas

`validar_plan.py` comprueba las referencias `sobre:` **antes** de renderizar:
que la capa de destino exista, que vaya **antes** en el plan —las anclas se
publican al renderizar, así que una referencia hacia adelante solo funciona
por accidente, si quedó un manifiesto de una pasada previa— y, si hay
manifiesto, que la clave exista.

Probado contra tres planes rotos a propósito. Los tres caen, y el del ancla
inexistente además **sugiere la clave correcta** de esa capa.

### Tanda 21 — el barrido de determinismo, y lo que encontró

**El código está limpio.** Ni `Math.random` ni `hash()` fuera de los
comentarios que los prohíben; los `Date.now()` que quedan son la espera del
reintento de borrado y no tocan un solo píxel; los `time.time()` solo miden
velocidad para el informe; todos los recorridos de directorio van con
`sorted()`; y el compositor itera la lista fija `ORDEN`, no un conjunto.

**Pero un grep no demuestra determinismo, y la prueba empírica falló.**
Renderizando el plan completo dos veces seguidas, sin tocar nada, la capa
`kinetic` sale distinta:

| escenario | ¿coincide? |
|---|---|
| `--only kinetic`, dos veces | **sí** (0 de 108 fotogramas difieren) |
| `fondo` + `kinetic`, dos veces | **sí** |
| plan completo a 5 fps | **sí** (0 de 22) |
| plan completo a 25 fps | **NO** |

Descartado que sea `ajustar()`, que es lo único que mide texto: en cuatro
páginas nuevas devuelve exactamente los mismos cuerpos
(280 / 267,229 / 150,435 px). Aparece solo con carga alta, lo que apunta al
rasterizador del navegador y no a la lógica — **pero eso hay que medirlo, no
suponerlo.**

Escrito `scripts/comparar_fotogramas.py`, que cuantifica la diferencia real
de imagen con `blend=difference` en vez de comparar bytes: dos PNG pueden
diferir en bytes y ser idénticos en píxeles. Si la desviación máxima es de
1-2 valores sobre 255 y la media es cero, son bordes antialiasados; si hay
desviación grande, algo se movió de verdad. La comparación está lanzada y
queda para la próxima tanda.

**Anotado como abierto, no como resuelto.** El compositor sí es reproducible
—verificado, archivos idénticos al byte—; el render no del todo, y hasta
tener la medida no sé de qué tamaño es el problema.

### Tanda 22 — terminal y onda de audio (bloque C ampliado)

**Terminal.** Los comandos se teclean con el reloj de la plantilla; la
salida **no**, aparece de golpe: una máquina no escribe letra a letra y
fingirlo se nota. Prompt en acento, `ok` en el segundo acento, `err` en el
principal, y autodesplazamiento midiendo el alto real en cada fotograma,
porque el contenido crece mientras se teclea.

**Lo que falló:** todos los comandos conservaban su cursor. En el último
fotograma había cuatro cursores a la vez, y una terminal real tiene uno.
Ahora solo lo lleva el último comando que ya ha empezado.

**Onda de audio, y esta es la que importa.** No anima nada inventado: la
envolvente sale de `scripts/extraer_niveles.py`, que decodifica el audio a
8 kHz mono y calcula **RMS por ventana**. RMS y no pico a propósito — el
pico de una locución lo marcan las consonantes explosivas y da una
envolvente que salta como un sismógrafo; el RMS sigue la energía que se
percibe. La caída va frenada y el ataque no: el oído sigue los ataques y
perdona las caídas, así que una envolvente simétrica se ve nerviosa.

**Verificado contra el propio guion, no contra sí misma:** el nivel en mitad
de palabra da 0,44–0,84 y en las pausas largas 0,03–0,09. En el render se
distinguen los cinco grupos de frase separados por valles, que son las cinco
oraciones del guion.

La onda dibuja el clip **entero** con un cabezal que avanza, no una ventana
móvil: así se ve de un vistazo cuánto queda, que es lo que hace útil una
onda en pantalla y no solo decorativa.

**De paso, en carbon vuelve a asomar lo del bloque F2:** las líneas `ok` de
la terminal salen del mismo bronce que el prompt. Es el tercer componente al
que le pasa. La decisión sigue siendo tuya.

### Tanda 23 — el fondo costaba 2,5 segundos por fotograma

Montando una pieza de seis minutos, el render iba a **47 fotogramas en
minuto y medio**: horas. La causa no era el volumen, era una plantilla.

`fondo.html` aplicaba `filter: url(#grano)` —un `feTurbulence` de tres
octavas— a un elemento con `inset: -50%`. Eso son **2160×3840, 8,3
megapíxeles de ruido procedural recalculados en cada fotograma**, con
`seed` fijo. Es decir: recomputar miles de veces algo que no cambia nunca.

Sustituido por una teja de 256 px generada una sola vez en `setup` y
repetida. **De ~0,3 a 3,9 fotogramas por segundo: entre 8 y 13 veces más
rápido**, con la imagen indistinguible en un A/B a ocho aumentos.

**Además, frecuencia por capa.** Un fondo de manchas difuminadas no necesita
25 fps: su contenido no tiene detalle fino. Ahora cada capa declara la suya
—fondo 4, capítulos 10, cinta 12, subtítulos y transiciones 25— y el
compositor consume cada secuencia a su ritmo. De 44 691 fotogramas a 31 673.
Verificado de punta a punta: una capa a 4 fps y otra a 25 dan las dos 4,000 s
exactos en la salida.

**Dos errores míos por el camino, los dos por razonar sin medir:**

1. Vi una trama en cruz al ampliar el grano y la atribuí a mi teja. Estaba
   **también en el original**: no era mía.
2. Deduje que `Engine.noise` daría un patrón periódico con índices
   consecutivos, porque la fase del seno avanza siempre lo mismo. Reescribí
   la función con un hash entero. Luego lo medí: la autocorrelación a
   desfases 1-5 es 0.012, 0.008, 0.001, -0.003, 0.003 — **ruido blanco**. Me
   había olvidado del multiplicador de 43758.5453 antes de la parte
   fraccionaria, que es exactamente lo que decorrelaciona y convierte el
   seno en un hash. Revertido, y la medida anotada en el comentario para que
   nadie repita el razonamiento.

Van cinco veces esta noche que concluyo algo antes de medirlo. Las cinco he
tenido razón sobre que **algo** pasaba y me he equivocado sobre **qué**.

### Tanda 24 — «Por qué la inversión en IA rota de capa» (5:58)

**Hecho:** `renders/capas_ia.mp4`, 5:58 en 1080×1920, 17 capas, 31 680
fotogramas, 7 efectos. La pieza más larga hasta ahora, y la que ha obligado
a arreglar el rendimiento del fondo (tanda 23).

**Restricción del encargo:** ninguna cifra de mercado. El argumento se
sostiene sobre estructura —las cinco capas de la pila—, cuatro riesgos,
cuatro listas de verificación y tres señales observables. Eso condiciona los
componentes: nada de contadores ni de gráficas con números inventados.

**Lo que falló:**

- **La comparativa mostraba «NaN».** Le pasé «ALTO» y «BAJO» como valores y
  `compare-ab` los multiplicaba por el progreso para animar un contador.
  Error mío en el plan, pero la plantilla tampoco debía rendirse: **muchas
  comparaciones honestas no tienen número**, y precisamente este vídeo no
  puede tenerlo. Ahora, si el valor no es numérico, se escribe tal cual y
  solo la barra se anima.
- Al revisar capas sueltas di por vacías `pasos2` y `pasos3`. No lo estaban:
  muestreé el fotograma 60, antes de que su primer paso entrara. Sexta vez
  esta noche que leo mal una medición propia.

**Lo que el validador evitó:** cinco capas (`pasos2`…`pasos5`, `kinetic3`)
no estaban en `ORDEN`. Las detectó **antes** de renderizar. Sin él habría
esperado media hora para descubrir que el compositor las descartaba en
silencio. Es la primera vez que una herramienta de esta lista se paga sola
de forma tan clara.

**Mejora de plantilla:** `pasos-flow` admite ahora un `at` por paso. Un
escalonado uniforme obliga a que la locución hable de los pasos a intervalos
iguales, y eso no pasa nunca — el gráfico se desincronizaba de lo que se
está diciendo. Con las cinco capas de la pila entrando en 26,0 / 42,3 /
56,4 / 71,7 / 79,9 s la diferencia es evidente.

### Tanda 25 — el director, y por qué las reglas tienen que ser alcanzables

**Hecho:** `scripts/dirigir.py` produce el plan desde la transcripción con
ritmo, variedad, cámara y sonido. Zoom por tramo en el compositor. Cinco
plantillas nuevas: `kinetic-quote`, `chapter-card`, `highlighter-text`,
`split-versus`, `poll-rating`. Tabla de intenciones en `BRAND_RULES.md §11`.

**Medido sobre la locución real de 6 minutos:** cambio visual cada 3,41 s,
gráfico medio de 2,72 s, **28 plantillas distintas** y ninguna por encima de
5 usos.

**Mi propio fallo, y es instructivo:** escribí la regla de variedad con un
tope de 2 usos y, tres líneas más abajo, un respaldo que lo saltaba «si no
hay otra». Resultado de la primera pasada: `pills` 40 veces y `cita` 35 — o
sea exactamente el defecto que el script existía para evitar. **Una regla con
una salida de emergencia no es una regla.**

Y había un segundo error debajo: el tope de 2 era **imposible** con 101
huecos y 27 plantillas, así que el respaldo tenía que dispararse siempre. Una
restricción inalcanzable garantiza que se incumpla. Ahora el tope se calcula
de `huecos / plantillas útiles` y el respaldo coge la **menos usada**, nunca
repite.

**Tercera vez con la misma trampa:** `split-versus` pintaba su lado oscuro
con `var(--ink)`, que en carbon es casi blanco. Ya había pasado con las hojas
de transición y con el bisel del móvil. Anotado como regla explícita en §11.

### Tanda 26 — las seis plantillas que faltaban

**Hecho:** `comment-bubble`, `notification-pop`, `definition-card`,
`search-bar`, `tweet-card` y `headline-clipper`. Con las cinco de la tanda
anterior, el catálogo pedido queda **completo**: 38 plantillas.

**Decisión sobre marcas ajenas.** `tweet-card` y `headline-clipper` NO
replican el logotipo ni la tipografía de ninguna plataforma ni de ningún
medio: el nombre de la red y la cabecera del periódico son campos de
configuración con valores neutros por defecto. Se cita a quien de verdad se
cita, sin arrastrar marca de nadie al vídeo. La insignia de verificado es un
check en color de acento, no la de ninguna red.

**Avatares generados, no descargados.** Iniciales sobre un tono derivado del
propio nombre con `Engine.noise`. Es determinista, así que el mismo usuario
conserva su color entre planos — que es lo que lo hace creíble.

**`notification-pop` publica su propio sonido** devolviendo `cues` desde
`setup`: quien sabe cuándo entra el aviso es la plantilla, no el plan. Mismo
contrato que los tics del odómetro.

**Lo que falló:** la entradilla del recorte de prensa iba a dos columnas
siempre, y con texto corto dejaba tres palabras solas en la segunda — se lee
como error de maquetación, no como prensa. Ahora las dos columnas dependen
de la longitud. Y el resaltado del titular usaba `--accent-soft`, que está
al 12 % y sobre papel blanco no se veía: un subrayado imperceptible ocupa
decisión de diseño sin dar resultado.

**`engagement-cta` no se ha creado**: es `cierre-cta`, que ya hace entrar un
puntero y pulsar el botón. Resuelto como alias en la tabla de intenciones.

---

## Bitácora — centrado, subtítulos cinéticos y refinado de copia

**Tarjetas centradas.** `.tarjeta` lleva `left:50%` +
`transform:translateX(-50%)`, `width:90%`, `max-width:900px`. El problema es
que `transform` es la propiedad con la que animan la entrada casi todas las
plantillas: en cuanto `draw()` escribía la suya, borraba el translate y la
tarjeta quedaba clavada por su borde izquierdo, medio fuera de cuadro desde
el primer fotograma.

La salida no es cambiar el método de centrado, sino **separar el elemento
que posiciona del que anima**. `_engine.js` envuelve cada `.tarjeta` una
sola vez: el envoltorio se queda con el centrado y el nodo original con el
vidrio y su animación. Una plantilla nueva solo tiene que poner
`class="tarjeta"`. Se añadieron `.tarjeta` y `.vidrio-apple` a
`_tokens.css` y se aplicaron a `definition-card`, `poll-rating`,
`comment-bubble`, `tweet-card`, `terminal` y `cierre-cta`, quitándoles su
posicionamiento propio y el `place-items:center` del `.stage`, que competía
con el posicionamiento absoluto.

**`kinetic-captions`.** Sustituye al karaoke: 1-3 palabras por golpe, corte
por puntuación **o por pausa > 0.42 s** —dos palabras separadas por medio
segundo no se leen juntas por mucho que la gramática las una—, pop elástico
0.85 → 1.0 en 0.1 s y conectores en cursiva caligráfica amarilla. Solo un
grupo visible a la vez: los invisibles salen del flujo con `display:none`,
porque apilados en el mismo hueco del flex se solapaban. Montserrat, Caveat
y Yellowtail **no estaban instaladas** pese a que `document.fonts.check`
decía que sí; se detectó midiendo el ancho del texto contra la monoespaciada
de respaldo, y se instalaron con `brew`.

**Refinador de copia.** Un titular no es un trozo de transcripción. El
refinador escoge 2-4 palabras de las que YA están en la frase —nunca añade
términos que el guion no dice— y recorta las colgantes de principio y fin.
Lo que fue apareciendo al mirar los fotogramas, en orden:

- «encoder a un LLM, **pero Kimi**»: una conjunción seguida de una sola
  palabra abre una oración que ya no cierra. Se corta la cola entera.
- «problemas de decaimiento **en**»: el saneado estaba solo en la rama de
  frase larga; la frase que ya medía 8 palabras salía sin pasar por él.
- «**Así que** sígueme» → «que sígueme»: quitar el marcador del discurso sin
  su subordinante deja algo peor que el original.
- **«Kimi K3 no solo mira tu pantalla» → «Kimi k3 solo mira pantalla».** El
  refinador puntúa por longitud, así que «no» era la primera en caer... y
  con ella el sentido. Perder una negación no es un recorte feo: es afirmar
  lo contrario que la voz en off. Ahora, si la frase negaba y el resumen no,
  no hay titular.

**Componentes que el director ya no reparte solo.** `pasos-flow` pide tres
pasos con título Y descripción; de una frase no salen tres descripciones, y
con `desc` vacía se dibujaba como tres barras sin contenido. `split-versus`
y `compare-ab` piden dos cosas contrastadas: salía el mismo texto a los dos
lados —una comparación que no compara— o un marcador «B». Los tres siguen
disponibles para planes escritos a mano.

**`cierre-cta`**: solo en el último 15 % y una sola vez. Un «Sígueme» en el
segundo 49 de 81 no es una llamada a la acción, es una interrupción; y dos
seguidos se anulan. Su `sub` traía la transcripción, así que se leía
«Sígueme / es razonar espacialmente». Va vacío.

**Lo que solo se vio mirando**: el número del capítulo era el índice del
gráfico («13», «22»), y el bloque del CTA flotaba sin fondo — texto claro
sobre una pared clara, ilegible. Ninguna de las dos cosas da error en
ningún log.

---

## Bitácora — orquestación en cuatro actos

El director repartía **25 gráficos en 81 s**. Ahora reparte **4**, y el 84 %
del metraje es A-Roll con subtítulos. El cambio no es de parámetro: la
selección pasó de recorrer tramo a tramo —cada hueco pedía su tarjeta— a
recorrer ACTOS, colocando uno por acto y descartando el resto.

**La distancia mínima hizo falta aparte.** Con solo la regla de actos, el
gancho cayó en 6,9 s y el primer núcleo en 10,8: formalmente dos actos
distintos, en pantalla un bloque de siete segundos de tarjetas seguidas.
Doce segundos de separación obligatoria entre gráficos lo resuelve.

**Las guardias semánticas destaparon contenido inventado que llevaba ahí
todo el rato**: un `terminal` mostrando `$ python3 script` mientras el guion
hablaba de otra cosa. No daba error, no lo detectaba ningún validador, y
era una afirmación falsa en pantalla. Ahora `terminal` exige que el guion
diga «comando», «script», «código»…

**Titulares por ventana contigua.** El refinador escogía las N palabras con
más peso conservando el orden, y con eso salía «K3 ha demostrado cambiado
completo»: palabras del guion, sí, pero salteadas. Ahora elige la mejor
VENTANA CONTIGUA, así que el titular es siempre un trozo literal. Hizo
falta añadirle tres castigos, cada uno descubierto mirando el fotograma
siguiente:

- Ventana que acaba en participio o infinitivo → «K3 ha demostrado» deja
  al lector esperando el complemento.
- Auxiliares en la lista de colgantes → «KIMI K3 HA».
- **Conjunción INTERIOR** → «LLM pero Kimi» empieza y acaba bien, pero por
  dentro son dos frases cosidas. Recortar por los extremos no lo ve.

Y `.capitalize()` arrasaba las siglas: «Encoder a un LLM» salía «Encoder a
un llm». Los titulares en caja natural ya no pasan por él.

**Verificado midiendo, no mirando la tira reducida**: centro horizontal de
las tres tarjetas en 538, 536 y 538 sobre 540 —los 2-4 px son la sombra—, y
los subtítulos a 284 px del borde inferior sin tarjeta, a 136 px con ella.

**El gráfico ya no repite el subtítulo.** En la versión anterior, el
`highlighter-text` del segundo 59 decía exactamente lo mismo que el
subtítulo de debajo. La tensión de fondo es que el texto de la tarjeta sale
del mismo fragmento que el subtítulo, así que por construcción coinciden:
cualquier regla que exija textos distintos mataría todos los componentes
con texto. La salida fue no tocar el texto y **desplazar el gráfico** —hasta
3 s, en pasos de 0,4— hasta que la frase que condensa ya haya pasado.

El umbral tuvo que bajar de tres palabras seguidas a dos: los enlaces se
filtran antes de comparar, así que «Encoder a un LLM» aporta solo dos
palabras con carga y con el umbral en tres la comprobación no saltaba nunca
—devolvía «no repite» para el caso exacto que había que cazar.

Resultado medido sobre el plan: las cuatro tarjetas se retrasaron entre 0,4
y 2 s, y ninguna comparte ya una tirada con lo que se oye mientras está en
pantalla. La del segundo 60 dice «Kimi K3 no solo mira tu pantalla»
mientras se escucha «detecta disonancias a nivel de».

---

## Bitácora — sonido del cierre y color de cámara

**Siete efectos nuevos, todos sintetizados.** Verificados midiendo el
espectro, no leyendo la expresión: `suscribir` da 886 y 1175 Hz frente a los
880 y 1174 de diseño, `notificacion` 1571 → 2088, y `tecleo` cae a −40 dB en
17 ms frente a los 47 ms de `clic`, que es la diferencia que justifica que
sean dos efectos y no uno.

**El cue del clic salió `null` la primera vez.** El contrato es
`cues: [{at, sfx, gain}]` en tiempo RELATIVO —está escrito en
`_engine.js:142`— y yo usé `t` absoluto. Estaba documentado; no lo leí.

**Las chispas «no aparecían» y sí aparecían.** Las coloqué dentro del
envoltorio relativo del botón dándoles coordenadas de viewport: el mismo
error de dos sistemas de coordenadas que ya había cometido con el puntero
del CTA. Pero después de moverlas seguía sin verlas — y esa segunda vez el
fallo era MÍO, no del código: mi recorte de verificación las reducía a
1,4 px. Consultar el DOM lo resolvió en un intento: estaban en su sitio, con
opacidad 0,64 y color bronce. Aparte, 7 px en un lienzo de 1080 es una
mota; ahora son 14.

**El LUT.** El metraje es S-Cinetone de una ZV-E10 II: perfil listo para
usar, no log. `carbon_bronze` le subía el negro de 21 a 33 y le quitaba
saturación a algo que ya viene desaturado. El preset nuevo usa pie
NEGATIVO —hubo que dar signo al parámetro— y un hombro.

El hombro salió mal a la primera: mandaba el blanco de 0.98 a 0.887, o sea
blancos grises, que es peor que el recorte que quería evitar. La fórmula no
pasaba por (1,1). Con una parábola de pendiente 1,25 al entrar y 0,75 al
salir, el blanco vuelve a ser blanco (1.00 → 0.983) y solo se comprime al
acercarse.

**El clic del botón, medido en el mix final**: −8,4 dBFS, unos 6 dB bajo el
pico de la voz, sin una sola muestra al tope. Creí que quedaba enterrado
bajo la locución, pero al mirar el perfil de energía la fricativa fuerte
está 300 ms ANTES del clic, no encima: en su instante, el clic manda.

---

## Bitácora — micro-FX por palabra

Trece plantillas nuevas, verificadas fotograma a fotograma en tres hojas.
Las otras siete del catálogo pedido ya existían con otro nombre y no se han
duplicado.

**Dos fallos que el propio repo ya sabía atrapar.**

`validar_plan.py` avisó de que las plantillas nuevas no estaban en `ORDEN`:
sin eso, el compositor las habría descartado **en silencio** y el vídeo
habría salido sin ellas sin un solo error en el log. Es exactamente el caso
para el que se escribió ese paso.

Y al añadirlas puse el comentario DENTRO de la lista. El validador lee
`ORDEN` con una expresión regular y parte por comas, así que el comentario
se coló como si fuera una capa y rompió la SIGUIENTE entrada real — con un
mensaje que señalaba al sitio equivocado. Arreglado por los dos lados: el
comentario fuera de los corchetes, y el parser leyendo literales entrecomillados
en vez de trozos entre comas.

**Un fallo nuevo, y de los buenos.** `colocar.py` mandó el pulso neuronal
`dy = +881`: resolvió el choque con la cara empujándolo a la única banda
libre, que es donde se están leyendo los subtítulos. Evitaba la cara pero no
sabía que el texto ocupa sitio. Ahora la franja de subtítulos se mide por su
propio alfa y se trata como obstáculo; el mismo efecto pasó a `dy = -344`,
hacia arriba.

**Lo que este guion no dispara.** De los veinte efectos, solo tres tienen
disparador en la transcripción de Kimi —habla de IA multimodal, no dice
«premium» ni «obsoleto» ni «miles»—, y con el presupuesto se colocan dos.
El diccionario cubre los veinte; el guion decide cuántos se usan.

---

## Bitácora — módulo de silencios

`scripts/silencios.py`. Lo que faltaba no era detectar el silencio —eso es
una línea de ffmpeg— sino **remapear todo el reloj**: al quitar un silencio
se adelanta todo lo que viene detrás, y si se remapean los subtítulos pero
no los gráficos, cada tarjeta llega tarde y cada vez más tarde. Ya había
pasado en este repo: un vídeo de 59 s con la narración de 74 s encima. Por
eso el módulo toma el plan y el timeline JUNTOS.

Sobre el metraje de Kimi: el silencio muerto más largo baja de **2,29 s a
0,75 s**, el total de 13,2 s a 7,3 s, y la pieza de 80,8 s a 75,9 s. Lo que
queda es el aire de 0,14 s que se conserva a propósito — pegar las frases
sin respiración da ese montaje ametrallado que delata la automatización.

**Dos fallos míos, los dos encontrados midiendo.**

El primero: usé el final de palabra de Whisper para proteger el habla,
después de haber escrito tres líneas más arriba que ese final no es fiable
porque alarga hasta el siguiente ataque. Resultado: 17 silencios
detectados, 5 supervivientes, 1,7 % de recorte. Ahora se estima la duración
real por longitud —como ya hacía `clean_transcript.recortar_colas`— y se
protege la menor de las dos. Pasó a 6 %.

El segundo es peor porque lo escribí como afirmación en el informe del
propio módulo: «los fotogramas ya renderizados siguen valiendo». Es falso
para las capas que cambian con el tiempo. Una tarjeta aguanta el remapeo;
los subtítulos cinéticos llevan grabado en cada fotograma qué palabra toca
en el reloj viejo. Lo vi mirando el vídeo: en el segundo 30 se leía
«ESPACIO LATENTE» mientras se oía «desde la primera capa». El módulo va
entre el director y el renderizador, y ahora avisa si encuentra fotogramas
del reloj anterior.

**La prueba que vale**: no es cuántos segundos quita, sino que los gráficos
sigan cayendo sobre la misma palabra. 6 de 6 tras comprimir el reloje un
6 %.

---

## Bitácora — pieza «Codex Security»

Plan escrito a mano siguiendo la escaleta, no generado por el director: el
guion venía con actos, disparadores y copy exactos.

**Los clips no estaban en orden narrativo.** `C0042` es el outro y venía en
segunda posición alfabética. Montarlos por nombre de archivo habría puesto
el cierre en el segundo 10. Se detectó leyendo la transcripción, no
suponiendo. Orden real: C0035 → C0053 → C0055 → C0058 → C0042.

Rotación de 270° en los cinco, como la vez anterior. `comprobar_fuentes.py`
lo dijo antes de tocar nada.

Whisper oyó «Codec Security»; se corrigió a «Codex» conservando tiempos.

**Bucle infinito.** El guion pide que «…solo necesitas…» enlace con
«AUDITAR». La grabación abre con «Vale, tenemos buenas noticias», que es un
arranque no guionizado, y cierra con 1,9 s mudos. Se recortan los dos
extremos: 54,7 s → 50,1 s, y el enlace cierra.

**Cuatro fallos, todos de reloj o de herramienta.**

1. El mapa de recorte **aplastaba** a 0 las palabras anteriores al corte en
   vez de descartarlas: los subtítulos abrían con «Vale tenemos buenas
   noticias» apilado en el segundo 0.
2. `colocar.py --aplicar` corrige de forma INCREMENTAL sobre el `dy` que ya
   haya. Al rehacer el montaje para el bucle, el `dy` viejo pertenecía a
   otra composición y mandó la ventana de código 218 px por encima del
   borde. Añadido `--reiniciar`.
3. `render_playwright.js --only` aceptaba **un solo valor** y el segundo
   pisaba al primero en silencio: se rehacía una capa y la otra conservaba
   sus fotogramas viejos. Ahora admite repetirse y lista por comas.
4. El candado se recolocó DESPUÉS del remapeo, así que se quedó en el reloj
   viejo, a 4,4 s de su palabra disparadora.

**Y un fallo de medición mío**: di por ausente el visor porque lo muestreé
en el segundo 20,9 cuando vive de 17,48 a 18,78. El gráfico estaba bien.

**B-Roll**: la clave de Pexels devuelve 403 —parece caducada—; se usó
Pixabay, que sí responde. El CDN además rechaza la descarga sin
`User-Agent`. Clip 262696 de iwsky, centro de datos con paneles de
seguridad: no es un escudo literal, pero es lo más ajustado al tema.

**Revisión de la pieza Codex.** Cuatro correcciones pedidas tras verla:

1. **Silencio al final de los clips**, donde se nota que se para la cámara.
   El detector de audio NO lo veía: `silencedetect` mide PICO, y un
   chasquido de boca de −8 dB mantenía el tramo por encima del umbral
   aunque su nivel MEDIO fuera −47 dB y no hablara nadie durante 1,5 s.
   Añadida a `silencios.py` la segunda señal —**hueco entre palabras
   transcritas**—, que es independiente del nivel y para decidir si sobra
   metraje es la que manda. Los ocho huecos (8,3 s, el mayor de 2,5 s)
   desaparecen; la pieza baja de 54,7 s a 43,1 s.

   Mi comparación inicial estaba mal: medí la MEDIA de la ventana y la
   comparé con un umbral de PICO. Con esa medición el detector parecía
   equivocado y no lo estaba.

2. **Gráficos demasiado grandes.** La pieza es casi toda plano cerrado y a
   tamaño completo no acompañan a la cámara: la sustituyen. Reducidos en
   bloque con el `zoom` de raíz del motor (0,58–0,76), que escala la
   maquetación dentro del mismo lienzo y deja intactos el posicionamiento
   y la evitación de rostro.

3. **`code-mockup` tapaba la cara**: escala 0,58 y dos líneas menos.

4. **Iconos centrados sobre la nariz** (candado, check): movidos a la sien,
   x=840.

**Y un fallo de reloj mío.** Apliqué `silencios.py` sobre un plan que ya
estaba en reloj de SALIDA usando un mapa construido desde `keep`, que está
en reloj de ORIGEN. El titular colapsó de 3,4 s a 0,4 s. La pieza se
rehízo entera con los tiempos en origen y **un solo remapeo** al final.
Es el mismo error que el módulo existe para evitar, cometido al usarlo.

---

## Bitácora — catálogo de subtítulos

`templates/subtitles-showcase.html`: diez presets, vista en rejilla 2×5 y
vista individual a tamaño real.

**Faltaban dos fuentes.** Montserrat y Playfair Display no estaban
instaladas. Se comprobó ANTES de escribir el CSS: sin ellas, los presets 3,
5 y 6 se habrían maquetado contra una sans de respaldo y se habría juzgado
otra cosa. Un `@import` de Google Fonts no sirve aquí —falla en silencio y
el renderizador no tiene garantía de red—, así que van del sistema.

**Colisión de nombres con el renderizador.** Usé `modo` como clave de
config y `render_playwright.js` hace
`Object.assign({}, capa.config, { modo })`: la sobrescribe con la suya. La
plantilla salía SIEMPRE en rejilla aunque el plan pidiera `solo`, y sin un
solo error. Renombrada a `vista`, y añadido un aviso en el renderizador
para que la próxima vez se vea.

**Dos mediciones mías mal hechas, las dos corregidas antes de concluir:**

- Di por no pintado el trazo de 4 px del preset 3 porque no lo veía. Sí se
  pinta: al quitarlo cambian 18.225 píxeles, con bordes de 5 a 19 px. Lo
  que pasaba es que era negro sobre un fondo casi negro. De ahí salió el
  cambio de fondo del catálogo a medio tono, que era el fallo de verdad.
- Al medir el bloom del coral tomé como «glifo» la píldora negra opaca del
  preset, no la letra, y leí el `filter` DESPUÉS de anularlo. Repetida
  sobre un glifo aislado: halo de 45 px a cada lado, rojo, decayendo de
  alfa 104 a 24.

**Sobre «réplica exacta del vídeo»**: no tengo el vídeo de referencia, así
que lo verificable es que el navegador aplica el filtro literal del
encargo y que produce un halo real. Eso está medido; la comparación contra
el vídeo no puedo hacerla.

---

## Bitácora — reedición de «Codex Security» con escaleta

Segunda pasada sobre el mismo metraje de `assets/aroll/video2`, ahora con
una escaleta de dirección escrita: cuatro actos con disparador, copy y SFX
por acto. 54,72 s de bruto → **44,17 s**.

**El plan dejó de escribirse a mano.** `scripts/plan_codex.py` lo genera
buscando cada instante por la PALABRA a la que el guion lo ancla, no por
segundos escritos a ojo. Es lo que evita el fallo de la vez anterior, donde
el candado se quedó a 4,4 s de su disparadora: si se vuelve a transcribir y
los tiempos se mueven, el plan se mueve con ellos.

**El reloj, resuelto de raíz en vez de con cuidado.** `silencios.py` remapea
con un mapa origen→salida, así que `words` tiene que llegarle en reloj de
ORIGEN; `clean_transcript.py` los devuelve en el de SALIDA. Aplicar uno
detrás del otro es el error que esta bitácora ya documenta dos veces. La
salida no es acordarse: es **recortar la fuente al rango guionizado** y
correr `clean_transcript.py --silencio 5`, por encima del hueco mayor
(2,34 s), para que deje un solo tramo y los dos relojes coincidan. Los
tramos de cámara se escriben CONTIGUOS por lo mismo. Un único remapeo, y la
identidad se comprueba con un `assert` en el generador.

**Tres fallos nuevos, los tres invisibles en el log.**

1. **Astillas de plano.** Los tramos de cámara del director y los cortes de
   silencio son dos rejillas independientes, y al cruzarse dejan trozos que
   no son planos: salieron cuatro por debajo de 0,5 s y uno de **0,10 s** —
   dos fotogramas y medio con OTRO encuadre entre dos saltos—. Se lee como
   un parpadeo. `recortar` solo descartaba por debajo de 0,08 s, que es el
   umbral de «fotograma suelto», no el de «plano». Añadido
   `--minima-toma 0.45`: la astilla se absorbe en el vecino con el que es
   continua en el original y adopta SU zoom, así que no se pierde metraje y
   el cambio de encuadre pasa a coincidir con el corte, que es lo que §11
   pedía de entrada.
2. **`colocar.py` resolviendo un choque que no existe.** El lienzo
   full-motion tapa la cara A PROPÓSITO; el colocador informaba de que «no
   cabe en ninguna banda, reduce su tamaño» y empujaba el visor 644 px
   fuera del nodo sobre el que la escaleta lo superpone, para esquivar una
   cara que en esa ventana ya está tapada. `A_SANGRE` no servía: es una
   lista de PLANTILLAS y este componente solo ocupa el lienzo entero con
   `lienzo: true`. Ahora el plan lo declara con `colocar: false`, y
   `--reiniciar` ya no borra un `dy` puesto a mano — lo borraba, dejando el
   gráfico donde la plantilla lo pinta y sin decir nada.
3. **El sello debajo de los subtítulos.** `stamp-banned` a `y=1500` ocupaba
   1496-1804 y los subtítulos viven en 1507-1690: texto rojo justo debajo
   de texto blanco. No lo avisaba nadie — §15 pone los micro-FX POR DEBAJO
   de los subtítulos, así que el orden de capas era correcto, y
   `colocar.py` solo mira los subtítulos cuando ya tiene que mover algo por
   el rostro. Se ve en el fotograma y en ningún otro sitio. Movido a
   1290-1503, la ventana libre entre la franja intocable de la cara y el
   techo del texto.

**Y dos claves mías ignoradas en silencio**, las dos cazadas mirando el PNG:
`escala` en `headline-clipper` —el motor escala la maquetación con `zoom`, y
`escala` solo existe dentro de `code-mockup`— y `zona`, que `_engine.js`
aplica únicamente a elementos con `class="tarjeta"`: `headline-clipper` y
`cierre-cta` posicionan a sangre, así que la banda la tiene que resolver
`colocar.py` con `dy` de composición.

**La medición que engaña.** `cierre-cta` «no cabe en ninguna banda» con
640 px de alto medidos, pero la tarjeta ocupa 315 px: la caja de alfa
incluye su anillo de ondas decorativo, que crece durante toda la capa y que
las cinco muestras siempre pillan grande. No es el gráfico el que no cabe,
es la medida. Colocada a mano en la banda «arriba» de §12, con el coste de
que el anillo queda cortado por el borde superior.

**El LUT no es el del comando por defecto.** Material Sony XAVC con
YMIN=20, que es la medición de §14 para S-Cinetone. Se usa
`scinetone_s11.cube`; `carbon_bronze` le subiría el negro doce niveles y
desaturaría lo que ya viene desaturado.

**Lo que la escaleta pide y el sistema no da.** Los `POS_*_RIGHT` de
tarjeta no son representables: §12 fija el eje X de toda tarjeta en el 50 %
y solo deja elegir banda vertical. Los micro-FX sí llevan x/y y ahí se
respetan. El inserto de escudo por `media-fetch` tampoco: el compositor
pega B-Rolls a pantalla completa y desde imagen fija, y un escudo a
pantalla completa entierra la cara en los 6 s más importantes. Y
`padlock-unlock` se queda fuera porque sus disparadores —«truco»,
«desbloquear», «acceso», «secreto»— no salen en la locución: ponerlo era la
mentira pequeña de §13.

**El conflicto que no tiene solución, solo elección.** §13 pide cuatro
tarjetas de 2,5-3,5 s con 12 s de aire entre ellas: son 48 s de mínimo y la
pieza tiene 44,17. Con el acto 2 a pantalla completa durando 7,6 s, los dos
primeros huecos bajan a 7,9 s y 7,7 s. O el lienzo full-motion, o §13. El
generador lo dice por `stderr` en cada pasada en vez de esconderlo.

**Copias de conflicto de iCloud, otra vez y con carpetas.** CLAUDE.md avisa
de `00140 3.png`; aquí aparecieron `cierrecta 2/`, `codemockup 2/` y
`securitypipelinenodes 2/`, vacías, en cuanto el renderizador vació y
recreó esos directorios. No estorban al compositor —lee del manifiesto—
pero confirman el aviso: `build/` fuera de la sincronización.

**Whisper, cuatro veces.** «Codec»→Codex y «prs»→PRs por sustitución
directa; «open ella ya»→OpenAI fusionando tres entradas en una para que el
recuento cuadrase y `alinear_guion.py` pudiera hacer la correspondencia 1 a
1; y con ella, «quizá»→GitHub. No se alineó el guion ESCRITO sino el
hablado: la grabación dice «dentro de GitHub Actions» y «subir a
producción» donde la escaleta decía otra cosa, y forzar el texto de la
escaleta habría desplazado los subtítulos respecto al audio.

---

## Bitácora — Sprint 1 · el contrato de reloj

El fallo más caro del repo, arreglado de raíz. No era «hay que acordarse del
orden»: era que dos etapas hablaban de relojes distintos y ninguna lo decía.

**Lo que estaba roto, medido antes de tocar nada.** `clean_transcript.py`
devolvía `words` remapeados al vídeo de SALIDA; `silencios.py` construye su
mapa de `keep.src_*`, que es ORIGEN, y lo aplicaba a esas palabras. Por la vía
documentada de CLAUDE.md, con una sola pasada:

| | antes | después |
|---|---|---|
| gráficos sobre su palabra | **2 de 8**, peor desfase 8,245 s | 8 de 8, y 8 de 8 tiempos relativos |
| habla pisada por los cortes | 0,186 s (0,132 s del ATAQUE de «Tienes») | 0 s |
| señal de huecos entre palabras | **0 tramos** | 12 tramos |
| silencio detectado | 2,19 s | **17,68 s** |
| dos pasadas de `--aplicar` | keep 14→15, palabras −3,806 s | byte a byte idénticas |
| `blocks` frente a la pieza | **+5,533 s fuera del vídeo** | coincide con `words` al milisegundo |

La deriva del anclaje **crecía a lo largo de la pieza** —«de» −1,79 s,
«detectar» −2,99 s, «PRs» −5,46 s, «rápida» −8,245 s—, que es literalmente lo
que la cabecera de `silencios.py` describe y que nadie había medido.

**Y `build/timeline.json` estaba roto en disco mientras se escribía esto.**
`blocks` acababa 5,533 s fuera del vídeo. No se vio porque la pieza usaba
`kinetic-captions`, que lee `config.palabras`; con `karaoke-subs`, que lee
`tl.blocks`, habría reproducido el fallo «ESPACIO LATENTE» que el repo ya
tenía documentado, por una ruta paralela que `silencios.py` nunca remapeaba.

**La regla, una sola.** `words` y `blocks` van SIEMPRE en reloj de ORIGEN;
`keep` es el único registro de la traducción; el reloj de salida se DERIVA. Dos
representaciones del mismo hecho en el mismo fichero es cómo nació todo esto.

**La corrección que no estaba en el plan.** `at`, `ini`, `fin` y compañía son
RELATIVOS al inicio de su capa, y `remapea_config` los trataba como absolutos.
Acertaba **por accidente**: las únicas capas con listas de tiempos son los
subtítulos y viven en `t: 0`, donde `mapa(0+o)−mapa(0)` colapsa a `mapa(o)`.
Añadir `"cortes"` a la lista vieja habría metido un fallo NUEVO, porque
`cortes[].at` también es relativo. La prueba de que ahora está bien: el
puntero de `cierre-cta` cae en 34,405 s y «perfil.» acaba en 34,405 s, con un
reloj completamente distinto al del render anterior.

**Había TRES registros de lo mismo y no coincidían.** `CLAVES_TIEMPO` indexaba
por CONTENEDOR y cubría 2 de las 12 que hay en el catálogo;
`CLAVES_RELATIVAS` por HOJA; y se contradecían sobre `{ini, fin, at}`. Ahora
hay una tabla de 31 claves hoja —que son estables, mientras los contenedores
crecen con cada plantilla— y `comprobar_relojes.py` falla si aparece una sin
clasificar, diciendo fichero, línea y las dos opciones.

Eso último **no se puede automatizar y hay que decirlo**: el idiom
`span(t, fin - cfg.salida, cfg.salida, ...)` pone `salida` en el hueco de
posición Y en el de duración, en 34 plantillas. El barrido propone, una
persona clasifica una vez leyendo la firma `span(t, INICIO, DURACIÓN)`.

**Cuatro fallos más, encontrados por el camino.**

1. `Mapa` asumía `keep` ordenado sin comprobarlo. Desordenado devolvía el
   reloj de otro tramo, en silencio, para todo: palabras, capas y configs.
   La garantía era accidental —`recortar` sí ordena—.
2. `bloques_karaoke` se agrupaba sobre las palabras YA remapeadas, donde los
   cortes habían cerrado las pausas: el criterio «parte por pausa mayor que
   el umbral» no actuaba nunca y quedaba reducido al tope de palabras.
3. `plan_codex.py` REEMPLAZABA los `keep` de silencio por los de cámara.
   Salía bien de milagro porque `silencios.py` vuelve a medir el audio, pero
   cualquier recorte que solo supiera el timeline —una toma falsa detectada
   por Levenshtein, que el audio no delata— se perdía. Ahora se INTERSECAN.
4. `render_playwright.js` se ejecutaba al IMPORTARLO. Un `require()` para
   probar una función lanzaba el render del plan por defecto: borró
   fotogramas y dejó cinco directorios de otro montaje. Pasó de verdad,
   comprobando `mapaDe`. Ahora lleva `require.main === module`, que es el
   equivalente del `if __name__` que todos los scripts de Python ya tenían.

**Tres fallos míos, los tres detectados porque una comprobación pasaba cuando
no debía.**

- La primera versión del check de anclaje comparaba la capa remapeada contra
  las PALABRAS remapeadas. Las dos cruzan el mismo mapa, derivan juntas y el
  error se cancela: pasaba 8/8 con el pipeline roto. **Una comprobación que no
  puede fallar no comprueba nada.** La referencia tiene que ser el audio.
- El check de coherencia comparaba el fin de `blocks` (reloj de origen) contra
  `keep[-1].out_end` (reloj de salida) y daba un falso positivo de 11,215 s.
  Es el mismo error de categoría que este sprint arregla, cometido al medirlo.
- `sin_comentarios` colapsaba los comentarios de bloque, así que el auditor
  señalaba la línea 96 cuando la clave estaba en la 102. Un aviso que dice
  «edita esta línea» y apunta a otra es peor que no dar la línea.

**Lo que la documentación no decía.** Los comandos rápidos consumían
`build/plan.json` en tres pasos y **ningún paso lo producía**: faltaba
`dirigir.py`/`plan_codex.py`. Ese hueco es la razón de que el orden roto
pareciera el canónico. Y la skill `tech-editor-m4` no ejecutaba `silencios.py`
en ninguna fase. Las dos cosas corregidas.

---

## Bitácora — Sprint 2 · identidad de pieza y estado limpio

`build/` es compartido entre piezas y ningún contrato llevaba id, hash ni
nombre: `plan.json` y `layers.json` se emparejaban solo por el string de la
capa, y los nombres se repiten por diseño —`kicker`, `pip`, `diagram`,
`karaoke`—. En este repo han convivido en el mismo `build/` artefactos de tres
piezas distintas.

**El manifiesto se fusionaba SIEMPRE, no solo con `--only`.** Su propio
comentario decía «con --only», pero el código no distinguía el caso. Efecto:
las capas de una pieza anterior sobrevivían a un render COMPLETO mientras su
directorio de fotogramas siguiera en disco, con su `t` y su `dur` originales.
El compositor itera el manifiesto y coloca cada capa donde diga su entrada, así
que el resultado era un gráfico de otro montaje apareciendo en el momento
equivocado de la narración nueva. Ahora se reemplaza en render completo, y con
`--only` lo que sobrevive tiene que estar en el plan y con la misma plantilla.

Los dos casos del descarte se distinguen, porque la acción es distinta: una
capa que ya no está en el plan es de otro montaje y se tira; una que SÍ está
pero con otra plantilla hay que rehacerla, y el aviso da el comando.

**No hacía falta inventar un campo de identidad.** El plan ya dice qué capas
tiene la pieza, con qué plantilla y en qué instante; el manifiesto dice qué se
renderizó; el disco dice cuántos fotogramas hay. Que las tres cosas cuadren ES
la identidad. `scripts/comprobar_montaje.py` lo comprueba sin tocar ningún
formato: plantilla, `t`, `dur`, recuento de fotogramas, la máscara de las capas
de cristal, y los directorios que no usa nadie.

Probado contra un montaje mezclado a propósito —plan de la pieza nueva,
manifiesto con los tiempos de la vieja— y los caza todos: 16 errores, incluidas
las siete capas con el reloj desplazado y el nombre duplicado.

**`colocar.py` aborta en vez de avisar.** Emparejaba por nombre y podía medir
el ALFA de los fotogramas de una pieza decidiendo el `dy` con la VENTANA
TEMPORAL de otra, y con `--aplicar` lo escribía en los dos ficheros. Un `dy`
calculado con datos cruzados es peor que ninguno, porque el siguiente que lo
mire lo dará por bueno.

**Dos descartes silenciosos más.**

1. El compositor tiraba una capa cuyo directorio no existía sin decir nada
   —a diferencia de las huérfanas de `ORDEN`, que sí tienen aviso—. El vídeo
   salía sin ese gráfico y el manifiesto seguía anunciándolo, así que ni
   contando capas se notaba. Ahora avisa con el comando que lo rehace.
2. **F6, nombres de capa duplicados.** `composite_ffmpeg.py` documenta que dos
   instancias necesitan nombres distintos y nadie lo comprobaba. El
   renderizador vacía y reescribe `build/frames/<capa>` por nombre y el
   manifiesto indexa por nombre: de dos entradas homónimas solo sobrevive la
   última, y los fotogramas de la primera ya se han borrado. Un gráfico
   desaparece del vídeo sin rastro. `validar_plan.py` solo lo pillaba si además
   solapaban en el tiempo, y dos apariciones de la misma tarjeta en momentos
   distintos es justo el caso que NO solapa. Ahora es error, no aviso: no hay
   ninguna configuración en la que funcione.

**El redondeo del banquero, anotado antes de que muerda.** El renderizador usa
el `Math.round` de JavaScript, que lleva 62.5 a 63; el `round` de Python usa
redondeo del banquero y da 62. La comprobación de recuento de fotogramas usa
`math.floor(x + 0.5)`. Con `round` habría nacido en rojo para cualquier capa
cuya duración cayera en un medio exacto, y una comprobación que falla sin
motivo se desactiva.

**Y las copias de conflicto de iCloud se distinguen de los restos de otro
montaje**, porque el arreglo no es el mismo: unas se borran y se saca `build/`
de la sincronización; los otros indican que el montaje está mezclado. El
barrido de huérfanos las separa y da el `find` que las limpia.

---

## Bitácora — Sprint 3 · el nivel rápido: lint, unitarias y contratos

El repo no tenía **ni una** prueba automática: cero `assert` en `scripts/`, sin
`tests/`, sin CI. Y su valor entero está en una clase de fallo concreta —los que
no dan error—, que es justo la que una prueba de regresión caza.

**140 pruebas en 0,08 s, y `make rapido` completo en 0,49 s.** Ese número
importa: por encima de dos segundos no se ejecuta, y un arnés que no se ejecuta
no protege nada.

No hizo falta refactorizar nada. Los 17 módulos de `scripts/` se importan en
menos de 15 ms en total, sin efectos de módulo y con todo `main()` bajo
`if __name__`: basta con poner `scripts/` en el path.

### Se prueban INVARIANTES, no valores

Los umbrales de este pipeline se ajustan —`--silencio`, `--minima`,
`--minima-toma`— y una prueba que fije «aquí salen 13 tramos» se pone roja en
cuanto alguien afina uno, aunque el comportamiento siga siendo correcto. «Ningún
tramo está invertido» sobrevive a cualquier ajuste y sigue cazando el fallo.

### F1 y F3, arreglados ANTES de escribir las pruebas

Un golden creado sobre un bug lo convierte en especificación.

**F1** · `tramos_utiles` hacía `min(fin, dur_total)` sin acotar también el
INICIO. Con una palabra que empieza pasada la duración declarada salía un tramo
invertido `[4.82, 2.0]`, y de ahí una cascada silenciosa: `remapear` descarta
sin avisar toda palabra que no caiga en ningún tramo, así que la palabra
desaparecía, `duration_final` salía **−1,68 s** y `reduccion_pct` pasaba de 100.
El disparador es real y el margen estrecho: en el transcript de Codex,
`duration` es 49,84 y la última palabra acaba en 49,70. Una sola alucinación de
cola de `large-v3` lo activa.

**F3** · `Mapa([])` era la identidad en `__call__` y devolvía 0 en `duracion()`:
dos respuestas que se contradicen. De ahí salía `duration_final: 0` con los
tiempos de las palabras intactos y una capa de fondo de duración cero. Ahora las
dos dicen lo mismo y hay `hay_metraje()` para preguntarlo; `silencios.py` aborta
si el recorte no deja nada, y `clean_transcript.py` también.

### El lint es la pieza de más valor por coste

`scripts/lint_config.py` cruza cuatro artefactos en dos lenguajes —el plan, las
54 plantillas, `render_playwright.js` y `composite_ffmpeg.py`— que hasta ahora
nadie comparaba. Ninguna prueba unitaria puede cubrir eso.

Medido: **0 falsos positivos** sobre las 54 plantillas usando sus propios
`defaults` como config, y caza los fallos históricos. Tres como error —la
colisión de `modo` que sigue viva en `data-diagram`, `escala` donde el motor
usa `zoom`, `zona` sin nodo `.tarjeta`— y dos como aviso.

La salvaguarda es lo que lo hace fiable: si el extractor saca menos de tres
claves y no encuentra `defaults`, la plantilla sale como **DESCONOCIDA** y eso
cuenta como error. Una plantilla que el lint no ha conseguido leer no puede
parecerse a una limpia.

**R8, quince líneas de expresión regular**, cruza lo que el compositor LEE del
manifiesto contra lo que el renderizador ESCRIBE. Convierte en imposible un
fallo que ya ocurrió **dos veces** —con `parallax` y con `dx`—, y que
`colocar.py` documenta en un comentario.

### Contratos a mano, no jsonschema

Tres razones: ninguno de los fallos históricos fue una violación de FORMA;
sería una dependencia contra la corriente del repo; y la forma documentada en
CLAUDE.md **ya estaba desincronizada** —el `face.json` real tiene `muestras`,
`con_rostro`, `tasa_deteccion` y `banda_libre`, y ninguna aparecía—. De ahí el
diseño: claves requeridas presentes + invariantes, claves extra permitidas.

Y el mismo módulo se expone como `scripts/comprobar_contratos.py`, para que
corra sobre los artefactos reales en cada sesión. Es la diferencia entre una
prueba que protege al que la escribió y una que protege al que edita Reels.

### El plan roto, congelado

La tanda 7 dice: «verificado contra un plan roto a propósito con los siete
fallos: los detecta todos». Esa verificación fue manual y se tiró.
`tests/fixtures/plan_roto.json` la congela y añade el octavo: el nombre
duplicado sin solape temporal. Cada fallo se comprueba POR SEPARADO, con una
frase que lo identifica: contar errores no vale, porque si un cambio rompe una
detección y a la vez añade un aviso, el total no se mueve.

### Tres fallos MÍOS en las pruebas, los tres detectados porque fallaban

- La prueba de fusión de astillas exigía `n >= 1` en un caso que es una unión de
  **mismo zoom**, y el contador solo cuenta las fusiones que arreglan un
  parpadeo de encuadre. El código estaba bien; la prueba pedía otra cosa. Se
  separó en tres casos con el invariante explícito.
- `MICRO_FX` son tuplas de dos y yo desempaquetaba tres. De rebote salió una
  prueba mejor: en vez de confiar en la tabla, extrae una palabra de cada patrón
  y comprueba que `micro_de` la dispara de verdad.
- La prueba de cero falsos positivos daba un número a TODAS las claves de los
  `defaults`, y así `barridoEn: null` —que en realidad es `{at, dur}` y cuyas
  hojas ya están clasificadas— parecía un tiempo suelto sin clasificar. Hay que
  reproducir cómo se usa la clave, no inventarle un valor.

Y un detalle del fixture: puse una capa «fuera de ORDEN» con `template:
pills.html`, pero el validador acepta una capa si su NOMBRE o su PLANTILLA está
registrada, y `pills` lo está. La única plantilla del catálogo fuera de `ORDEN`
es `subtitles-showcase`, y con razón: es la hoja de muestra de presets, no un
componente de pieza.

### El redondeo del banquero, con prueba propia

2,5 s a 25 fps son 62,5 fotogramas. El renderizador usa el `Math.round` de JS y
escribe 63; el `round` de Python daría 62. Los contratos usan
`math.floor(x + 0.5)` y hay una prueba que lo fija, porque sin ella la
comprobación de recuento nace en rojo para cualquier duración que caiga en un
medio exacto — y una comprobación que falla sin motivo se desactiva.

---

## Bitácora — Sprint 4 · humo del catálogo, cadena completa y goldens

**172 pruebas repartidas en tres niveles**: 153 en el rápido (1,2 s), 13 en el
de render (44 s) y 6 en la cadena completa. `make rapido` sigue por debajo de
los 2 s, que es la condición para que se ejecute de verdad.

### El humo del catálogo cabe en el nivel rápido

La medición del propio repo lo decía y se confirma: **0,158 s por plantilla**,
las 54 en 8,5 s. Lo caro de este pipeline son los fotogramas de una pieza —1431
en la última—, no abrir el navegador. Así que el catálogo entero se revisa sin
que sea opt-in, que era lo contrario de lo que yo asumía al planificarlo.

No compara píxeles con ninguna referencia: todo sale del DOM y del canal alfa.
Lo único que se compara es una captura contra OTRA de la misma plantilla, para
saber si se mueve.

**Y encontró dos cosas a la primera.**

1. **La colisión de `modo` en `data-diagram`, cazada desde el otro lado.** El
   humo comprueba que el motor deja `body.dataset.modo === 'detalle'`, y ahí
   salía `tabla`. Es el fallo que la auditoría había predicho: el renderizador
   inyecta su `modo` con `Object.assign({}, capa.config, { modo })`, así que la
   vista tabla era **inalcanzable desde el pipeline** aunque funcionara en
   `hoja_contactos.js`, que llama a `setup()` directo — y eso es justo lo que la
   hacía difícil de ver. Renombrada a `vista`, igual que se hizo con
   `subtitles-showcase`. Verificado MIRANDO las dos vistas renderizadas: la
   tabla sale con sus columnas y sus barras de bronce por primera vez desde el
   pipeline.

2. **`kinetic-captions` no se movía.** Su config de muestra era
   `{ duration: 6 }` y nada más, así que `palabras` quedaba vacío y la
   plantilla no pintaba NADA. Es la más usada del repo —va en todas las
   piezas— y era la única sin muestra de verdad: la hoja de contactos llevaba
   un hueco donde debía estar el ejemplo del componente principal.

### Dos scripts de Node más que se ejecutaban al importarlos

`hoja_contactos.js` y `mapa_desplazamiento.js` tenían el mismo fallo que el
renderizador: un `require()` para reutilizar sus datos lanzaba el trabajo
entero. Los tres llevan ya `require.main === module`, que es el equivalente del
`if __name__` que todos los scripts de Python tenían desde el principio.

### La cadena completa: 6 pruebas en 1,9 s

Sale mucho más rápido de lo estimado —1-2 min en el plan— porque el clip son
3 s y los silencios van INYECTADOS, así que Whisper y `silencedetect` quedan
fuera del arnés entero.

La prueba que justifica este nivel es la **invariante de reloj de punta a
punta**: para cada palabra, el instante en que SE OYE —derivado de `keep`, que
es el recorte que ffmpeg aplica— tiene que coincidir con el instante en que el
subtítulo la DIBUJA. Es la única prueba automática posible del remapeo doble, y
no hace falta mirar un píxel.

**Un fallo mío al escribirla, y de los buenos**: la comparaba con un
diccionario `{palabra: instante}`, y «de» aparece dos veces en tres segundos de
habla, así que la segunda sobrescribía a la primera y la prueba informaba de un
desfase de 2 s que no existía. Se compara por índice.

**Y una medida que aclara un límite**: el vídeo compuesto dura EXACTAMENTE lo
que dice el timeline a 25 fps (3,000 s, 75 fotogramas), y a 5 fps sobran dos
fotogramas —0,4 s—. O sea que el exceso es del ajuste que la prueba usa para ir
rápido, no del pipeline, y la tolerancia tiene que ir en fotogramas de la salida
y no en segundos fijos.

Para «cada capa se compone de verdad» se lee el GRAFO de filtros y no los
píxeles: cada capa tiene que aportar su `overlay` con su ventana temporal.
Comparar fotogramas obligaría a componer dos veces, y contra un golden de
píxeles no se puede.

### Los goldens, y lo que NO se fija

Se fija el `timeline.json` completo, el resultado de `silencios --aplicar` con
la lista inyectada —**el de más valor: fija la etapa cuyo fallo es invisible por
definición, y sin necesitar audio**—, el md5 de los tres `.cube`, las
duraciones y picos de los SFX, las `anclas()` de las 54 plantillas y el RESUMEN
del plan del director.

Del plan solo el resumen, porque `plantillas_disponibles()` lee el directorio:
un golden completo se pondría rojo cada tanda y se desactivaría. El resumen
sobrevive a lo cosmético y sigue cazando que el director deje de emitir
micro-FX.

**Dos fallos míos en el generador de goldens**, los dos de la misma familia
—medir sin comprobar la unidad—:

- `hacer_sfx.medir` devuelve `pico_dB` y `rms_dB`, no `pico`/`rms`. Mi filtro de
  claves buscaba las que no eran, y el golden salió con quince diccionarios
  vacíos que habrían pasado la prueba sin comprobar nada.
- El comparador de `--diff` no incluía el salto de línea final que sí escribía,
  así que decía que los seis goldens cambiarían justo después de generarlos. Un
  comparador que siempre dice «cambia» es igual de inútil que uno que siempre
  dice «igual».
- Y el golden de silencios llevaba dentro las rutas del directorio temporal, que
  son distintas en cada pasada. Fuera del golden.

Ahora tres pasadas de `oro.py --diff` dan cero cambios: son deterministas.

---

## Bitácora — Sprint 5 · los planes a mano, como módulo

Lo que de verdad se usa. `dirigir.py` reparte por intención y sirve cuando no
hay escaleta; cuando el guion trae actos, disparadores y copy exactos —el caso
normal— repartir otra vez lo contradice, y eso significaba escribir el plan a
pelo.

`scripts/escaleta.py` se lleva la mecánica y `plan_codex.py` queda como
DECISIÓN: 407 líneas de contenido y mecánica mezclados pasan a 199 de escaleta
declarada. Lo que queda ahí es qué gráfico, en qué palabra, cuánto dura y por
qué.

**La prueba de que la extracción es fiel: la pieza sale byte a byte idéntica.**
`plan.json` y `timeline.json` con el mismo md5 que antes del refactor, y tras
`silencios --aplicar` los ocho tiempos remapeados coinciden valor por valor.

### Las tres cosas que el módulo conserva y por qué

**Anclar por PALABRA.** `e.tarjeta(..., ancla="dólares", desfase=0.11)` y no
`t=3.65`. Si se vuelve a transcribir, el plan se mueve con la transcripción.
Escribir los segundos a mano fue lo que dejó el candado a 4,4 s de su palabra
disparadora al rehacer el montaje para el bucle.

Y el buscador ahora **sugiere lo parecido** cuando la palabra no está: «¿querías
una de estas?» con las candidatas, en vez de obligar a abrir el JSON.

**Auditar en cada pasada, distinguiendo error de desviación.** Esa distinción es
lo que hace la auditoría utilizable: si todo fuera error, la pieza de Codex —que
baja el aire entre tarjetas de 12 s a 7,9 s a propósito, porque su acto 2 es
full-motion— no se podría escribir; si todo fuera aviso, repetir un micro-FX
pasaría desapercibido, y para eso no hay ninguna configuración en la que esté
bien. Las desviaciones salen por `stderr` y se ven.

**Intersecar los tramos de cámara** con los `keep` que ya haya, en vez de
reemplazarlos. Reemplazar descartaba el recorte de tomas falsas —detectadas por
Levenshtein sobre n-gramas, que el audio no delata— y `silencios.py` no puede
recuperarlo porque él solo mide sonido.

### Un fallo que salió al hacerlo, y lo cazó la red del Sprint 3

`escribir()` reescribía `keep` y dejaba `duration_final` con el valor de
`clean_transcript.py`. Al intersecar los tramos de cámara se descartan los
trozos de menos de 0,20 s —no son un plano— así que la suma cambia: 38,645
declarados frente a 38,485 reales. `silencios.py` lo corregía después, pero
entre los dos pasos el timeline quedaba internamente incoherente. **Lo detectó
la comprobación de contratos**, que es exactamente para lo que se escribió.

### Y un fallo en una prueba mía del sprint anterior

`test_validar_pasa_el_plan_bueno` llevaba la duración escrita a mano (38.485), y
eso hacía que dependiera de en qué punto del pipeline estuviera `build/`: entre
`plan_codex.py` y `silencios --aplicar` el plan está en reloj de ORIGEN y sus
tiempos llegan a 49 s, así que comparar contra la duración de SALIDA fallaba por
un motivo que no tenía nada que ver con el plan. Ahora la deriva del mismo
timeline que el plan, y vale en los dos estados.

### Detalle pequeño con efecto real

`duration` va PRIMERO en la config y no añadida al final. El orden de las claves
es el que sale al fichero, así que ponerla al final cambiaba el JSON byte a byte
sin cambiar nada del contenido: los diffs enseñaban ruido y los goldens
dejarían de coincidir sin motivo. Fue justo lo que impidió que la primera
versión del refactor saliera idéntica.

### Sobre el «catálogo de escaletas por tipo de Reel»

El plan lo pedía y no lo he escrito. Con una sola pieza real no hay de dónde
sacar los tipos: inventar tres plantillas de escaleta a partir de un caso sería
adivinar la estructura, y este repo ya tiene bastantes reglas calibradas sobre
un solo vídeo. `plan_codex.py` es el ejemplo trabajado y el catálogo crece
cuando haya piezas de las que abstraerlo.

---

## Bitácora — Sprint 6 · el director

Seis cosas que el propio fichero declaraba y no hacía, y una que hacía mal.

### `elegir()` no se llamaba desde ningún sitio

Cero invocaciones. Con ella se perdían las dos reglas que su docstring
documentaba, porque el bucle de reparto tenía su propia lista de candidatas:

- **El filtro de `RELLENABLES`.** Sin él, `pasos-flow` y `compare-ab` eran
  candidatas automáticas —de las intenciones `estructura_lista` y
  `comparacion`— y podían colocarse con `desc` y `meta` vacíos: tres barras sin
  contenido, que es el defecto exacto que el comentario de `RELLENABLES`
  describe como razón para excluirlas. §12 lo dice sin rodeos: «quedan para
  planes escritos a mano».
- **El respaldo de la menos usada del catálogo.** Sin él, un acto que agotaba
  sus candidatas no colocaba nada.

Sustituida por `candidatas_para()`, que devuelve la LISTA ordenada con el
respaldo puesto —una lista y no una elección, porque el bucle tiene que aplicar
después las comprobaciones caras y si una falla hay que seguir probando—.

### El «tope» de §11 no se resucita: §13 lo dejó obsoleto

Se calculaba, se imprimía en el informe y no decidía nada. La tentación era
conectarlo; la decisión correcta es quitarlo. §13 pide cuatro gráficos por
pieza, y con cuatro ninguna plantilla se repite: es más estricto que cualquier
tope calculado. Un número que se calcula y no decide hace pensar que hay una
regla activa donde no la hay, y `--tope-uso` era peor todavía — una opción que
no cambia el resultado hace creer a quien la pasa que ha ajustado algo.

### «Cuatro gráficos, uno por acto» pasa de aspiración a comportamiento

Salían 3 de 4, y el que faltaba era el `outro` — o sea el CTA. Tres capas de
diagnóstico, cada una descubierta arreglando la anterior:

1. **El reparto era voraz.** Cada acto cogía su tramo más rico y hasta 3,5 s, y
   los siguientes se quedaban sin sitio. Medido: la tarjeta anterior acababa en
   37,88 y la del outro tendría que haber empezado en 49,88 con la pieza
   acabando en 49,84. **Por cuatro centésimas.** Añadido el presupuesto: cada
   acto reserva lo que necesitan los que quedan.

2. **Con el presupuesto, faltaba `nucleo2` por 0,44 s**, porque `nucleo1` se
   estiraba a 3,10 s. La tarjeta ahora se ENCOGE cuando estirarse dejaría sin
   sitio a lo que viene detrás. Entre una tarjeta medio segundo más corta y un
   acto sin gráfico, §13 no deja duda.

   Y el recorte va DESPUÉS del retraso por repetición de subtítulo, no antes: la
   tarjeta empieza en `ini` y no en `t["ini"]`, y con el retraso puesto la
   diferencia llegaba a 0,8 s, que era justo cuando el recorte hacía falta y no
   se aplicaba.

3. **Aun así seguía siendo infactible, y lo comprobé por fuerza bruta**: de las
   120 combinaciones de un tramo por acto, **ninguna** cumplía el aire de 12 s.
   La causa no era el presupuesto —cuatro tarjetas de 2,5 s con 12 s de aire
   son 46 s en una pieza de 49,8— sino la GRANULARIDAD: las fronteras de tramo
   las pone el troceado en frases y no caen donde hacen falta.

   La relajación que lo resuelve no es nueva: **una tarjeta puede empezar DENTRO
   de su tramo**, que es lo que ya hacía el retraso por subtítulo. Exigir que el
   tramo entero cayera después del aire era más estricto de lo que §13 pide. Se
   conserva que la tarjeta siga cayendo SOBRE esa frase, y de ahí el segundo de
   margen: una que entra 0,1 s antes de que la frase acabe no está sobre ella.

Resultado: **4 de 4 actos**, aire de 12,00 s exactos en el cierre, duraciones
todas en 2,5-3,5 s, ninguna plantilla repetida y código de salida 0.

**Y un cuarto fallo, aritmético, que se disfrazaba de otra cosa.** Con la
relajación puesta, el cierre se descartaba con «ninguna candidata sirvió» —un
mensaje que señalaba a la elección de plantilla— cuando el problema era que
`dur` se medía desde el inicio del TRAMO y no desde el arranque efectivo: pedía
3,5 s arrancando 1,1 s dentro del tramo y se salía de la pieza por 0,48 s.

### La cámara ya coincide con los actos

`zoom_de` usaba segundos absolutos —`ini < 3.0` y `ini > dur_total - 8.0`—
calibrados para el vídeo de referencia de 60 s. En una pieza de 40 s el gancho
de cámara cubría el 7,5 % mientras el narrativo es el 10 %, y el cierre el 20 %
frente al 25 %: dejaban de coincidir justo en las piezas cortas, que son las que
se hacen. Ahora las fronteras se derivan de `ACTOS`, y hay prueba de que la
misma FRACCIÓN de dos piezas de distinta duración da la misma escala.

### Tres contradicciones dentro del propio fichero

- **`cinta` estaba en `CROMO`** —«no son gráficos de contenido y no entran en el
  reparto»— y a la vez en `RELLENABLES`, en `NEUTRAS` y como candidata de
  `estructura_lista`, con `contenido_de` rellenándola. De las dos afirmaciones,
  la que decía la verdad es la segunda: fuera de `CROMO`.
- **`faq-card` no existe en `templates/`.** La guardia era inofensiva pero
  mentía sobre el catálogo. Hay prueba de que las guardias y las intenciones
  apunten solo a plantillas que existen.
- **Los bloques de karaoke se calculaban y se descartaban**: el director emite
  subtítulos cinéticos, que llevan la lista plana de palabras, y `tl["blocks"]`
  se escribía siempre vacío. Código que parece producir algo y no lo produce es
  lo que hace pensar que una función existe.

### Un fallo en el golden del Sprint 4

`resumen_de_plan` medía la «separación mínima» mezclando tarjetas de acto y
micro-FX, que van en carriles distintos con presupuestos distintos: §13 pide
12 s entre tarjetas y §15 pide 7 s entre micro-FX. El número que salía —2,6 s
antes, 0,7 s después— era la distancia entre una tarjeta y un destello, que por
diseño pueden estar cerca. Ahora son dos números y el golden fija los dos.

La pieza escrita a mano no se ve afectada: `plan.json` byte a byte idéntico.

---

## Ronda 3 — sonido, alma visual y publicación

Tres números abrieron esta ronda, y ninguno es una opinión:

| eje | medido | qué significaba |
|---|---|---|
| movimiento | `outCubic` en **52 de 56**; `pulse()` en **0**; **45 de 56** solo animan `opacity` y `transform` | una sola gramática de entrada para todo el catálogo |
| color | **43 de 56** sin nada fuera de `accent`/`ink`/`surface`; `.brushed` **2 usos** frente a 106 planos de bronce | §2 se incumplía en 106 de 108 casos |
| sonido | `loudnorm` **0**, `alimiter` **0**, `afade` **0**; **8 señales** en 44 s | el máster salía sin medir y las juntas a hueso |

Y un patrón que apareció **cuatro veces**: máquinas construidas, probadas y
nunca enchufadas. El riser, el cristal, la envolvente de voz y los `cortes`.
Ninguna daba error; todas estaban muertas.

### Sonido

- **Máster**: −17,7 → **−14,1 LUFS**, pico −2,7 → −1,3 dBFS, **LRA intacto**
  (1,8 con y sin normalizar, medido: el limitador no come rango). Dos pasadas,
  la primera de solo audio a **0,66 s** sobre un render que cuesta minutos.
  El techo del limitador es **−1,4 dBFS y no −1,2**: aislando el códec, −1,2
  entrega −0,7 en el fichero y −1,4 entrega −1,0.
- **Juntas**: escalón de **6446 → 50 LSB**, de 46,4× la mediana natural a 0,36×.
  `afade` y no `acrossfade`, que acorta 20 ms por junta y rompería la
  invariante de reloj.
- **`deslizar` no disparaba el ducking.** Pico −21,8 dBFS × gain × `--sfx-vol`
  = −27,9, y el umbral es −26,02: **1,9 dB corto**. Sonaba entero por debajo de
  la voz y era 2 de los 8 cues de la pieza. Aislado en la galería sonaba
  perfecto — ese hecho **solo existe contra la voz**.
- **Catálogo calibrado por familias**, no con una cifra: impulso por pico,
  gesto y sostenido por RMS. Con una sola medida, `tecleo` habría subido +18,9
  dB y se habría estrellado contra el limitador, matando el transitorio que es
  lo que lo hace leer como golpe. Dispersión de los gestos **18,5 → 1,6 dB**.
- **Seis sonidos nuevos** y el vocabulario completo: `fallo` (tritono a √2,
  verificado midiendo los dos bins), `acierto` (tres notas que resuelven, no
  dos que avisan), `escaner` (AM a 17 Hz, medida: 15 picos en 0,90 s),
  `preimpacto`, `aire` y la **cama**.
- **La cama** cierra «suena a nada». Bucle de 12 s con los parciales en la
  rejilla de 1/L y **el arranque de los filtros descartado**: costura de 5702 a
  20, exactamente 1,0× la mediana. Y el recorte va al FINAL de la cadena — con
  el `alimiter` detrás, la costura volvía a 2325.
- El **`lecho` latía** 19,6 dB cada 4 s porque llevaba sus fundidos dentro del
  fichero y se reproduce en bucle. Ahora 6,1, que es la variación del ruido.
- **Los actos se guardan.** Vivían en `informe()`, que se imprime y se pierde.
- **Tres risers suenan** por primera vez. Los cues pasan de 8 a 14.
- `make sonido` y `make escuchar`: la tabla y las fichas en CONTEXTO. Cierra la
  pregunta que quedó abierta en la tanda 1 — «si suena bien no lo puedo saber»—
  separando las dos preguntas que estaban mezcladas: el número dice si el
  efecto EXISTE, la escucha dice si está BIEN.

### Alma visual

- **El cristal se emite por primera vez.** `grep -c cristal dirigir.py` daba
  cero desde la tanda 9. Verificado midiendo dónde cambian los píxeles: 10,5
  dentro de la silueta contra 4,0 fuera (ruido de codificación).
- **Tipografía de un eje a cuatro roles**, con **Playfair Display** —variable,
  instalada, cero usos— dando el contraste que §1 pide. Escala modular real en
  dos razones, siete tokens de tracking, siete pesos.
- **El metal en sus cuatro formas.** `.brushed` es `background-image`, así que
  no servía para filetes ni trazos — y el 80 % del bronce del catálogo son
  filetes y trazos. La norma pedía metal y entregaba una cuarta parte.
- **`outBack6`**, con el sobrepaso resuelto numéricamente al 6 % de §10.
  `outBack` se pasa un 10,0 % y `glass-dock` lo reimplementaba peor: 12,1 %.
- **`auditar_estilo.js`** mide la monotonía, que ninguna prueba por plantilla
  puede ver. Con golden que se lee **al revés**: no «esto sigue igual» sino
  «esto no empeora».

### Documentación y publicación

README, `docs/`, `comprobar_docs.py`, hooks versionados, CI, y el repo subido
en privado con las nueve ramas de sprint convertidas en tags.

### Lo que NO se hizo, y hay que decirlo

**Siete de las diez plantillas señaladas siguen sin rediseñar**: `capitulos`,
`mapa-calor`, `pasos-flow`, `chat-bubbles`, `cinta`, `data-diagram` y `globo`.
(Escribí «seis» junto a una lista de siete nombres. Se arreglaron tres:
`chapter-card`, `glass-dock` y `highlighter-text`.)
Se arreglaron los SISTEMAS que les suben el suelo —tipografía, metal, textura,
curvas— y cuatro de ellas a mano, pero el trabajo por plantilla queda pendiente.
Las métricas lo dicen sin adornos: la dominancia de `outCubic` sigue en 92,9 %
y la textura en 2 de 56.

**El CI no ha llegado a ejecutarse.** El workflow está bien —los mismos
comandos pasan sobre un clon limpio, 248 pruebas— pero GitHub no asignó runner:
0 pasos, 3 segundos. Es cosa de minutos de Actions o del límite de gasto de la
cuenta, no del fichero.

### Cinco fallos míos, por si sirven

1. **`document.fonts.check` no vale** para saber si una fuente está: devuelve
   `true` para familias inexistentes. Verifiqué con él y se lo dije al usuario.
   La medida buena es el ancho, y con ella el control pasó de 0 avisos a 56.
2. Comparé un fichero **consigo mismo** al medir el efecto de `inCubic`, porque
   el backup ya llevaba el arreglo.
3. Leí **la cabecera WAV como muestras** y concluí que descartar el arranque
   empeoraba la costura del bucle.
4. Declaré `--metal-ang` **fuera de un selector**: CSS inválido, y arrastró
   consigo los degradados que lo usaban. Las hojas salían invisibles y el humo
   daba verde.
5. Puse `ebur128` como `-af` junto a `-filter_complex`, que ffmpeg no admite.
   El error se tragaba como «no he podido medir».

Las cinco se encontraron **mirando o midiendo**, ninguna leyendo el diff.

---

## Tanda 12 · Las siete plantillas, una a una

La tanda anterior cerró diciendo que **siete de las diez señaladas seguían sin
rediseñar**. Estas son esas siete, en el orden en que se hicieron y por el
mismo criterio: impacto = arquetípica × frecuencia real × visibilidad ÷ coste.

| # | Plantilla | Qué era | Qué es |
|---|---|---|---|
| 1 | `mapa-calor` | opacidad monocroma | material: cardenillo → bronce pulido, en `oklab` |
| 2 | `pasos-flow` | el mismo objeto tres veces | tres estados sobre un raíl con cabeza |
| 3 | `cinta` | movimiento lineal, dos marquesinas | inercia integrada, dos rodillos contrarrotando |
| 4 | `data-diagram` | hexágonos y hormigas marchantes | placa mecanizada, enrutado orto, un paquete |
| 5 | `chat-bubbles` | iMessage literal | una transcripción con etiquetas al margen |
| 6 | `capitulos` | barra de progreso de reproductor | regla de instrumento, los cuatro títulos siempre |
| 7 | `globo` | esfera de alambre girando en bucle | itinerario, arcos de círculo máximo, terminador |

El detalle de cada una está en su commit. Aquí solo lo que **no** es de una
plantilla.

### Tres máquinas más construidas y nunca enchufadas

La tanda anterior encontró cuatro. Aparecieron tres más, y las tres se
descubrieron al DARLES el primer uso real:

- **`Engine.gradienteMetal` no funciona sobre rectas**, que es justo para lo
  que se escribió. Un `<linearGradient>` usa `objectBoundingBox` por defecto y
  el SVG dice que un elemento con caja de ancho o alto CERO **no se dibuja**:
  una línea vertical pintada con el degradado del metal desaparece sin error,
  sin aviso y sin nada en consola. Estaba promovido al motor desde el sprint de
  materiales y **no lo llamaba ninguna de las 56**, así que nunca se había
  ejecutado. Ahora acepta `caja` y pasa a `userSpaceOnUse`.

- **`Engine.grano` borraba el fondo del elemento.** Escribía `backgroundImage`
  en línea, y su comentario decía que así «no peleaba con lo que el elemento ya
  tuviera de fondo» — al revés: un estilo en línea gana a cualquier clase. La
  placa de bronce de `cinta` salía gris plata, o sea aluminio cepillado. Ahora
  pinta en una capa hija.

- **`capitulos` no la emitía nadie.** Está en `ORDEN`, en `CROMO` y en el
  catálogo. Pero `CROMO` se declara en `dirigir.py:131` y dentro de ese fichero
  **no lo lee ninguna línea** —solo lo miran `colocar.py` y una prueba de
  invariante—, así que no excluía de nada; y tampoco estaba en `INTENCIONES` ni
  en `NEUTRAS`. No la colocaba ni el reparto ni el cromo.

### §10 exigía flotación de reposo y no la implementaba ninguna

«Cada elemento deriva con su propio periodo. Sin ella una fila parece una
captura fija.» Está escrito desde la primera versión de la norma. Cero de 56.

No es una opinión: el humo captura tres instantes de cada plantilla y compara
sus hashes, y en **20 de 56 dos de los tres son idénticos**. Esas veinte se
quedan congeladas byte a byte durante la mitad de su tiempo en pantalla.

`Engine.flota(t, i)` es función pura de `t` e `i`, con periodos inconmensurables
por elemento —si todos derivan a la vez el conjunto late— y 3 px de amplitud
sobre 1080. Se aplicó en las plantillas de esta tanda; **las otras diecisiete
siguen congeladas** y son trabajo pendiente.

### Un agujero del arnés: 4 de 45 fichas no se comprobaban

`humo_plantillas.js` indexaba las fichas de muestra con
`new Map(MUESTRAS.map(m => [m.f, m]))`. Un Map se queda con la última clave
repetida, así que de las cuatro plantillas que se muestran en DOS vistas
—`data-diagram`, `chat-bubbles`, `marcos`, `rejilla-logos`— solo se probaba
una, y siempre la segunda. La vista de nodos de `data-diagram` podía estar rota
entera y el humo salía verde. Lo mismo en `oro.py`: `anclas.json` se congelaba
por fichero, así que la mitad de las anclas de esas cuatro no estaba protegida.

Ahora el humo recorre `MUESTRAS`: **60 fichas** en vez de 56, todas medidas y
todas congeladas.

Y el detector de textura de `auditar_estilo.js` **infravaloraba**: buscaba
`.trama` con punto —el selector— y no la clase asignada desde JS. Decía 2 de 56
cuando eran 5. Una métrica que infravalora es peor que no tenerla: con el
trinquete puesto, habría bloqueado el trabajo siguiente por no haberlo contado.

### Dos contratos que los propios scripts incumplían

- **`dirigir.py` escribía `build/timeline.json` sin la clave `reloj`**, que
  `contratos.py` exige. No saltaba porque el flujo normal pasa por
  `clean_transcript.py`, que sí sella; el timeline del director solo se ve
  cuando se dirige sin limpiar antes, que es justo el caso en que más falta
  hace saber en qué reloj están esas palabras.

- **`_peso` premia la mayúscula inicial** como «nombre propio o marca», y en
  una transcripción de Whisper esa mayúscula la lleva también toda palabra que
  abre oración. Los capítulos salían «instalación Tienes». Se filtra en
  `capitulos_de` y no dentro de `_peso`: una palabra suelta no puede saber si
  abre frase, y tocar `_peso` habría cambiado todos los titulares del catálogo.

### Lo que se cableó, para que el rediseño se vea

El plan avisaba de que rediseñar lo que el director no coloca es trabajo que no
se ve. Tres cableados:

- **`cinta`** emitía UNA banda; ahora dos, con relación de engranaje, y la
  segunda solo si hay cinco palabras clave o más —con menos repetiría las
  mismas tres, y dos bandas diciendo lo mismo son relleno—.
- **`capitulos`** con `--capitulos`, y los actos de `ACTOS` como capítulos: no
  inventa una estructura, enseña la que ya reparte los gráficos.
- **`globo`** con una intención `alcance_global` y **la única guardia que
  CUENTA en vez de casar un patrón**: exige dos lugares nombrados en la frase,
  y los puntos salen de esos lugares. Un globo afirma «esto pasa en estos
  sitios»; sacarlo con cualquier «a nivel mundial» es la mentira pequeña y
  constante contra la que existe el bloque de guardias.

### Los números

| Métrica | Tanda 11 | Ahora | Meta |
|---|---|---|---|
| solo `opacity`+`transform` | 45/56 | **42/56** | ≤15 |
| con textura | 2/56 (mal contado; 3 reales) | **8/56** | ≥3 |
| props animadas (media) | 5,04 | **5,29** | — |
| familias por plantilla | 1,48 | **1,55** | — |
| px tipográficos sueltos | 42 | **36** | 0 |
| tracking sin token | 95 | **84** | 0 |
| hex literales | 80 | **79** | 0 |
| dominancia de curva | 92,9 % | **92,9 %** | ≤75 |

La dominancia de curva **no se ha movido**, y es la única puerta marcada. Las
siete plantillas usan más curvas que antes —`inOutCubic` en casi todas—, pero
`outCubic` sigue apareciendo en 52 de 56 porque la salida de capa la escribe
igual todo el catálogo. Bajarla de 92,9 no es trabajo de siete plantillas: es
un gesto de salida compartido en el motor, y no se ha hecho.

### Lo que NO se hizo

- **Las 49 plantillas restantes siguen sin tocar una a una.** Los sistemas les
  suben el suelo; el trabajo por plantilla queda.
- **17 plantillas siguen congelándose** media pantalla, con `Engine.flota` ya
  disponible y sin usar.
- **La dominancia de curva sigue en rojo**, por lo de arriba.
- **El CI sigue sin ejecutarse**: minutos de Actions de la cuenta, no el
  fichero.

### Cuatro fallos míos de esta tanda

1. **La última estación de `pasos-flow` no aparecía nunca.** Está a `yn = 1`
   exacto y su opacidad era `(pVia − 1) × 9`, que vale 0 mientras se traza. El
   humo la daba por buena: la plantilla se mueve, tiene 3 anclas y su PNG pesa
   27 KB. Lo delató abrir el fotograma.
2. **El globo salía iluminado por detrás**: al cerrar el terminador por el
   limbo elegí el sentido contrario, así que sombreaba la cara del sol.
3. **Le puse grano a la placa de bronce y me cargué el bronce.** Salía gris
   plata y ningún log dijo nada.
4. Escribí en el chat que un comentario mío era falso —el de que el barrido de
   relojes no caza `arranque` ni `frenada`— **antes de comprobarlo**. Era
   correcto: `_EXACTAS` se construye a partir de `SEMANTICA`, así que el salto
   de 26 a 28 candidatas que me hizo dudar era circular.

Las cuatro se encontraron **mirando o midiendo**. Ninguna leyendo el diff.

---

## Tanda 13 · Las 56, y una medida que no existía

La tanda 12 cerró con «49 plantillas sin tocar una a una». Esta las toca. El
trabajo se repartió en cuatro tandas de once con un agente por plantilla y un
auditor por tanda; la cuarta chocó con el límite semanal y va hecha a mano.

### Los números del catálogo entero

| Métrica | Tanda 11 | Tanda 12 | Ahora | Meta |
|---|---|---|---|---|
| solo `opacity`+`transform` | 45/56 | 42/56 | **11/56** | ≤15 ✓ |
| con textura | 2/56 | 8/56 | **41/56** | ≥3 ✓ |
| px tipográficos sueltos | 42 | 36 | **0** | 0 ✓ |
| tracking sin token | 95 | 84 | **0** | 0 ✓ |
| hex literales | 83 | 79 | **17** | 0 |
| con color más allá de 3 | 13/56 | 15/56 | **53/56** | — |
| pesos por plantilla | 1,04 | 2,50 | **2,71** | — |
| props animadas (media) | 5,04 | 5,29 | **8,38** | — |
| gestos declarados | 0 | 0 | **23** | — |
| dominancia de curva | 92,9 % | 91,1 % | **87,5 %** | ≤75 |
| **fichas que incumplen §10** | — | 20/60 | **0/60** | 0 ✓ |

Los 17 hexadecimales que quedan son excepción DECLARADA: reproducen estilos de
subtítulo de terceros en `subtitles-showcase` y en el preset 2 de
`kinetic-captions`. Están recogidos en variables con nombre, comentados como
excepción y no se usa ni uno fuera del bloque de su preset. Tokenizarlos
rompería lo único que esas plantillas hacen.

### La medida que faltaba

`humo_plantillas.js` pregunta «¿se mueve?» con TRES instantes: 0,15 · el de la
ficha · el 90 % de la duración. Con tres muestras basta para cazar una
plantilla muerta del todo y **para nada más**.

Lo encontró el auditor de los micro-FX: cinco de once pasaban el humo con la
acción agotada en el primer tercio y el fundido de salida sin arrancar hasta el
último cuarto. Hasta el **31 % de la capa parada**, con los tres hashes
distintos. O sea que el «0 de 60 congeladas» que se escribió a mitad de esta
tanda era cierto para la medida burda y engañoso.

`scripts/comprobar_movimiento.js` renderiza la capa ENTERA a 30 fps y mide la
diferencia de luma. Tres decisiones costaron llegar:

1. **No vale comparar bytes.** Una plantilla declaraba en un comentario haber
   arreglado sus «catorce fotogramas idénticos byte a byte» con una luz que no
   para, y la luz movía como mucho **10 de 255** acumulado sobre dieciocho
   fotogramas: sobrevivía al detector y no a la vista, y desaparece al
   codificar. El umbral son 6/255, que es lo que el cuantizador de H.264 se
   come a CRF 17-23.
2. **Se mide a MEDIO SEGUNDO, no contra el fotograma anterior.**
   `Engine.flota` deriva 3 px con periodo de 8 s: entre dos fotogramas son
   0,08 px, así que con la medida ingenua una plantilla que **sí** cumple §10
   sale marcada como muerta. §10 no pide que algo cambie entre dos fotogramas
   —eso es un efecto—, pide que la imagen no sea una captura fija.
3. **Hacen falta las dos**, y son fallos distintos. Un gesto puede pararse tres
   fotogramas sin que la capa sea una foto, y una capa puede ser una foto sin
   que ningún fotograma sea idéntico al anterior.

La primera foto honesta del catálogo dio **10 fichas incumpliendo §10**, la
peor con el 77 % de la capa parada. Hoy son 0. Quedan **21 con el gesto parado
en seco**, que es el fallo menor y es trabajo pendiente.

### Cuatro contadores que medían el fichero y no lo que se ve

El patrón se repitió cuatro veces, y las cuatro con el mismo mecanismo: el
trabajo consiste en sacar cosas del fichero —a un token, a un ayudante del
motor— y el contador, que lee el texto, baja.

- **Textura**: buscaba `.trama` con punto, o sea el SELECTOR, y no la clase
  asignada desde JS. Decía 2 de 56 cuando eran 5.
- **Curvas**: al mover el gesto de entrada y salida al motor, 51 plantillas
  dejaron de escribir `Ease.outCubic` y `curvas por plantilla` bajó de 1,73 a
  1,63. Con la cuenta honesta —resolviendo los ayudantes a sus curvas— sube a
  2,30.
- **Pesos**: buscaba `font-weight: 700` literal. Al pasar a los tokens `--w-*`
  bajó de 1,04 a 0,66 y el trinquete lo leyó como regresión tipográfica.
- **Movimiento**: los hashes del humo no distinguen «se mueve» de «cambia un
  nivel en veintiséis píxeles».

Y una vez **por el otro lado**, que es peor: `chapter-card` tenía `300px` a
pelo, el token `--t-titan` vale 194 y su comentario dice que es «el número de
chapter-card». Cambiarlo puso la métrica a cero y ENCOGIÓ el número un 35 % en
una hoja a sangre donde el número es lo único que hay. La salida honesta es
`calc(var(--t-titan) * 1.55)`: sin píxel suelto y sin tocar el diseño.

### Máquinas construidas y nunca enchufadas: van siete

A las cuatro de la tanda 11 y las tres de la 12 se suma que **`glass-dock`
seguía teniendo los dingbats `◴ ✂ ▤`** que la tanda 11 dio por quitados, en sus
`defaults` y en su ficha de catálogo.

### Cuatro fichas de muestra que medían mal

`hoja_contactos.js` alimenta el humo, el catálogo, la galería y el comprobador
de movimiento, así que una ficha floja empeora cuatro cosas a la vez:

- `transicion`: un corte de 0,7 s dentro de una capa de 3.
- `karaoke-subs`: una palabra durando 2,7 de los 5 segundos.
- `kinetic-type`: la última palabra acabando en 2,4 de 4.
- `kinetic-captions`: las palabras acabando en 4,8 con `duration: 6`, así que
  el tercer fotograma del humo caía en zona muerta y salía **vacío en los dos
  temas**. La prueba de «¿se mueve?» comparaba dos fotogramas vivos y uno en
  blanco.

Ninguna era un fallo de su plantilla. Todas hacían que el arnés valiera menos
de lo que aparentaba.

### Un agujero del arnés: 4 de 45 fichas no se comprobaban

`humo_plantillas.js` indexaba las muestras con `new Map(MUESTRAS.map(...))`, y
un Map se queda con la última clave repetida: de las cuatro plantillas que se
muestran en DOS vistas solo se probaba una, siempre la segunda. La vista de
nodos de `data-diagram` podía estar rota entera y el humo salía verde. Ahora
son 60 fichas y todas se miden y se congelan.

### Una alarma que investigué y no era

Un agente avisó de que dos renders del mismo instante daban PNG distintos.
Comprobado: llegando al mismo `t` por un barrido secuencial o por un salto
directo, 16 plantillas difieren en el **0,37 %** de los píxeles con el DOM
IDÉNTICO — es antialiasing de los glifos de fuente variable. Y con captura de
TODOS los fotogramas, que es lo que hace el renderizador, dos renders completos
dan los mismos bytes: 240/240, 180/180, 210/210, 150/150. La no determinista
era la prueba, que capturaba uno de cada veinticinco.

### Lo que NO se hizo

- **La dominancia de curva sigue en 87,5 %**, meta 75. Bajarla pide variar el
  gesto de ENTRADA por plantilla y que `dirigir.py` impida repetirlo en capas
  seguidas. Está en el plan y no está hecho.
- **21 fichas tienen el gesto parado en seco.** No incumplen §10; el efecto se
  agota antes de tiempo.
- **El CI sigue sin ejecutarse**: minutos de Actions de la cuenta.
- **`BRAND_RULES.md` describe plantillas que ya no son así.** §4A sigue
  llamando a `code-mockup` una «Code Card MacBook Pro con bisel de aluminio,
  muesca y tres botones», y eso se retiró en esta tanda.
  `comprobar_docs.py` detecta plantillas SIN mención, no menciones equivocadas.

---

## Tanda 14 · Las tres puertas que quedaban

La tanda 13 cerró con tres cosas abiertas: la dominancia de curva en 87,5 %
contra una meta de 75, veinte fichas con el gesto parado en seco, y
`BRAND_RULES` describiendo plantillas que ya no son así. Las tres se cierran, y
**dos de las tres resultaron ser un problema de medida antes que de trabajo**.

### 1 · La norma describía un catálogo que ya no existe

§4 afirmaba que `code-mockup` era «un marco que simula la pantalla de un
MacBook Pro con bisel de aluminio, muesca y tres botones» y que los nodos de
`data-diagram` eran «hexágonos con un pulso de luz que viaja». Las dos cosas se
retiraron en las tandas 12 y 13.

Peor: recomendaba **`config.modo`** para elegir la vista de `data-diagram`.
`modo` está RESERVADA por el renderizador —la inyecta con `detalle`/`mascara` y
pisa la del plan— y la plantilla la renombró a `vista` justamente por eso. La
norma recomendaba la clave que rompe la plantilla.

`comprobar_docs.py` cazaba plantillas SIN mención y rutas inexistentes; no
cazaba menciones EQUIVOCADAS. Ahora comprueba que toda clave `config.X` citada
exista en los `defaults` de su plantilla — lo poco de una descripción que se
puede verificar a máquina, y da la casualidad de que es donde estaba el error
que hace daño.

Dos decisiones que costaron una vuelta:

- La atribución se REINICIA en cada encabezado. Con «la última plantilla
  nombrada» arrastrando secciones enteras, `config.zona` y `config.ancho` —del
  sistema de tarjetas, que aplica el motor— se le colgaban a `fondo` por ser la
  última citada quince párrafos antes. **Dos falsos positivos de dos
  hallazgos**, y una auditoría que grita en falso se deja de leer.
- Las claves reservadas se LEEN de `_engine.js` (`_cfg.\w+`) en vez de
  mantener una lista, que es la única forma de que no se quede vieja.

### 2 · El gesto era una etiqueta, y la dominancia no medía dominancia

**La octava máquina construida y nunca enchufada.** `<meta name="gesto">`
existía desde el sprint de movimiento y lo leía UNA cosa: el auditor, para
contarlos. Y eran veintitrés nombres LIBRES distintos para veintitrés
plantillas, así que tampoco era un vocabulario.

Ahora el gesto DECIDE la curva de entrada, declarado `familia:nombre` — la
familia de un vocabulario cerrado de seis, el nombre libre y descriptivo. Las
curvas salen de lo que el gesto ES:

| familia | curva | por qué |
|---|---|---|
| `asentar` | `outCubic` | llega y se posa: decelera hasta pararse |
| `revelar` | `inOutCubic` | lo que arranca y frena es el obturador, no el objeto |
| `trazar` | `outExpo` | el trazo sale del ataque y se agota: es tinta |
| `golpear` | `inCubic` | acelera hasta el contacto — la inversa de `asentar` |
| `crecer` | `outBack6` | una masa que se pasa el 6 % que permite §10 |
| `correr` | `linear` | una correa no decelera al llegar al centro |

Y la métrica: `dominancia_pct` contaba en cuántas PLANTILLAS aparece cada
curva. Con un ayudante de entrada compartido y 3,3 curvas por plantilla de 6
que hay, eso se satura. Medido:

    por plantilla:  outCubic 89,1 %   inCubic 83,6 %   inOutCubic 76,4 %

**Tres curvas por encima del «máximo» de 75 a la vez.** Si tres curvas
distintas son dominantes al mismo tiempo, eso mide cobertura, no dominancia.
Contando cada APARICIÓN, que es lo que «una sola curva para todo el catálogo»
quiere decir: `outCubic` 39,4 %, `inOutCubic` 23,5 %, `inCubic` 15,6 %.

El listón pasa de 75 a 33 —el doble del reparto uniforme con seis curvas— y
**no es para que pase**: con la métrica corregida y antes de tocar nada, la
puerta seguía en rojo en 39,6. Lo que la cierra es el trabajo:

    39,6 %  métrica arreglada, gesto sin enchufar
    35,4 %  las 25 que ya declaraban gesto usan su curva
    32,6 %  once más declaran familia (solo las que usan `Engine.entra`:
            en las demás sería documentación sin efecto, y de esas ya hay ocho)

### 3 · El gesto parado en seco, y otra vez la medida

`comprobar_movimiento.js` preguntaba «¿ha cambiado algo respecto al fotograma
ANTERIOR?» con el umbral en 6/255. Eso es exigir **180/255 por segundo**: un
destello, no un gesto.

Lo delató `gold-glint`, marcada con el 49 % parado, cuya luz recorre la pieza
durante toda la capa: **2/255 entre fotogramas seguidos y 15/255 a tres
décimas**. La luz se mueve, y el H.264 la conserva porque el codificador ve la
rampa a lo largo del GOP, no cada delta por separado.

Midiendo contra el fotograma de hace un SEXTO de segundo —el tramo más corto en
el que un ojo distingue moviéndose de quieto—: **20 fichas -> 7, sin tocar una
sola plantilla**. Ninguna de las trece que salieron estaba mal; estaba mal la
pregunta.

Después, el trabajo. `Engine.reposo(t, entrada, fin, salida)` da el progreso a
lo largo de la PERMANENCIA, que es donde el catálogo se para, y lo que se anima
ahí no puede ser el mismo gesto otra vez:

- `chapter-card`: la luz cruza la placa y el número se asienta de 700 a 900.
- `timer-ring`: la cuenta llega a cero y SELLA — un anillo exterior se traza.
- `target-hud`: la lectura se congela al atracar, y eso está bien; lo que
  faltaba es lo que un calibre hace después, que es bloquearse.

    gestos parados   20 -> 7 (medida) -> 5 (trabajo)

Las cinco que quedan son pausas DELIBERADAS de entre el 2 % y el 5 %: el globo
detenido en una ciudad —que es su rediseño entero—, la transición antes de su
primer corte. Forzar movimiento ahí sería estropear el diseño para mover un
número.

### Ninguna métrica lleva ya el marcador de meta

| Métrica | Tanda 11 | Ahora | Meta |
|---|---|---|---|
| solo `opacity`+`transform` | 45/56 | 11/56 | ≤15 ✓ |
| con textura | 2/56 | 41/56 | ≥3 ✓ |
| px tipográficos sueltos | 42 | 0 | 0 ✓ |
| tracking sin token | 95 | 0 | 0 ✓ |
| dominancia de curva | 92,9 % | 32,6 % | ≤33 ✓ |
| fichas que incumplen §10 | 20/60 | 0/60 | 0 ✓ |

### Un patrón que ya va cinco veces

Contadores que miden el TEXTO del fichero y no lo que se ve: textura, curvas,
pesos, movimiento entre fotogramas y ahora dominancia. Siempre por el mismo
mecanismo — el trabajo consiste en sacar cosas del fichero, a un token o a un
ayudante del motor, y el contador baja.

Y una vez **por el otro lado**, que es peor: puse `px sueltos` a cero
cambiando `chapter-card` a su token y encogí el número un 35 % en una hoja a
sangre donde el número es lo único que hay. La salida honesta fue
`calc(var(--t-titan) * 1.55)`.

La regla que sale de las seis: **cuando una métrica se mueve, mirar el
fotograma antes de creérsela — en las dos direcciones.**

### Lo que sigue abierto

- **17 hexadecimales**, todos excepción declarada: reproducen estilos de
  subtítulo de terceros y tokenizarlos rompería lo único que esas plantillas
  hacen.
- **El CI sigue sin ejecutarse**: minutos de Actions de la cuenta, no el
  fichero.
- **`pills`, `onda` y `fondo`** no se rediseñaron: la tanda D chocó con el
  límite semanal y se hicieron a mano solo las que tenían tramo muerto medido.

---

## Tanda 15 · Las tres últimas, y ocho gestos que no existían

`pills`, `onda` y `fondo` eran las tres que faltaban del catálogo. El hallazgo
que salió de ellas vale más que las tres.

### Las tres

- **`pills`**: el chip de cualquier framework, con un `backdrop-filter` que NO
  HACÍA NADA —sobre `omitBackground` no hay píxeles detrás que desenfocar— y
  costaba una capa de composición por fotograma. Ahora es una etiqueta de chapa
  TROQUELADA: el troquel la corta, el golpe FORMA la cabeza del remache y un
  cabezal la rotula a avance constante.
- **`onda`**: 96 barras iguales con un cursor, o sea el widget de un
  reproductor. Y en la ruta que MÁS se da —`niveles: []`, porque
  `extraer_niveles.py` solo rellena la envolvente en la ruta TTS— las 96 caían
  al mínimo: lo que salía era una línea de puntos. Ahora es un registrador de
  banda, y sin envolvente dibuja su ruido de fondo y la cabecera lo DICE con un
  número.
- **`fondo`**: la capa más cara del catálogo. **2179,9 → 147,7 KB por fotograma
  en carbon y 3481,5 → 190,1 en paper**, de 255 MB a 17 MB la capa entera. El
  tiempo baja un 31 % en carbon y SUBE un 14 % en paper, declarado en el
  fichero: se cambia por leer 18 veces menos disco en cada composición.

### Ocho plantillas animaban el peso sin mover un píxel

`font-variation-settings` solo hace algo si la cara que el emparejado de CSS ha
elegido es el fichero VARIABLE. Esta máquina tiene la familia estática completa
instalada junto a la variable, así que `font-weight: 500` elige
`Geist-Medium.otf` — y una estática no tiene ejes.

    Geist Mono, font-weight 500, eje 200/500/900  ->  1 ráster de 3
    Geist,      font-weight 400, eje 200/900      ->  1 ráster de 2

`cierre-cta`, `comment-bubble`, `karaoke-subs`, `kicker-hud`, `onda`,
`poll-rating`, `search-bar` y `target-hud` escribían el eje en cada fotograma
sin efecto. **No lo ve nada**: no hay error, la propiedad se escribe, el DOM es
correcto, el humo pasa porque la plantilla se mueve por otras razones, y
`document.fonts.check` miente por diseño. Solo se ve comparando píxeles.

Y no se arregla desde CSS: el fichero variable y el estático **comparten nombre
PostScript** —los dos son `Geist-Regular`, leído del `name` table de los
`.ttf`—, así que un `@font-face` con `local()` elige uno u otro según el orden
del sistema. Comprobado: resucita `Geist Mono` y mata `Geist` con la misma
regla. Eso no es una solución, es una moneda.

`Engine.peso(el, n)` escribe las DOS propiedades: donde manda el variable el
eje gana y da interpolación continua, donde manda una estática `font-weight`
elige la cara más cercana y el gesto sale a escalones. Medido, 3 rásteres de 3
en las dos familias. **48 llamadas convertidas en 36 plantillas.**

### Séptima vez que el arnés mide el fichero

Al pasar a `Engine.peso`, el auditor dejó de ver `style.fontVariationSettings`
y `solo opacity+transform` subió de 8 a 15: el trinquete habría bloqueado un
arreglo que hace que ocho plantillas animen el peso de verdad. Van siete —la
textura, las curvas, los pesos, el movimiento entre fotogramas, la dominancia y
esto— y siempre por el mismo mecanismo.

### Dos comprobaciones nuevas, y por qué van en `make render`

`scripts/comprobar_eje.js` rasteriza una sonda con cada par (familia, peso) que
el catálogo ANIMA de verdad —recorriendo la capa en veinte instantes, porque
hay gestos que solo escriben en una fase— y falla si el PNG a 200 y a 900 sale
idéntico.

Con `comprobar_movimiento.js` son ya tres las comprobaciones que necesitan
navegador y comparan **píxeles y no texto**: «¿se ve algo?», «¿se mueve durante
toda la capa?» y «¿el peso que anima mueve un píxel?». Las tres cazan fallos
que ninguna comprobación de texto puede ver, y las tres van en `make render`
porque cada una abre Chromium.

### El catálogo, cerrado

| Métrica | Tanda 11 | Ahora | Meta |
|---|---|---|---|
| solo `opacity`+`transform` | 45/56 | **8/56** | ≤15 ✓ |
| con textura | 2/56 | **43/56** | ≥3 ✓ |
| px tipográficos sueltos | 42 | **0** | 0 ✓ |
| tracking sin token | 95 | **0** | 0 ✓ |
| dominancia de curva | 92,9 % | **31,5 %** | ≤33 ✓ |
| props animadas (media) | 5,04 | **9,38** | — |
| pesos por plantilla | 1,04 | **2,93** | — |
| gestos declarados | 0 | **35** | — |
| fichas que incumplen §10 | 20/60 | **0/60** | 0 ✓ |
| gestos parados en seco | 20 | **5** | — |

Las 56 rediseñadas. Las cinco pausas que quedan son deliberadas.

### Lo que sigue abierto

- **17 hexadecimales**, todos excepción declarada: reproducen estilos de
  subtítulo de terceros.
- **El CI sigue sin ejecutarse**: minutos de Actions de la cuenta.

## Tanda 16 · Fase 1 de empaquetado: el repo como módulo, sin mover nada

El destino es un monorepo donde otro código haga `import editor.reloj` sin
saber que detrás hay un pipeline de vídeo. La fase 1 prepara ese consumo IN
SITU: ni un fichero se mueve, los ~20 scripts con `sys.path.insert` e
imports planos siguen exactamente igual, y los dos mundos conviven. Cuatro
cambios.

### 1 · `pyproject.toml`: scripts/ ES el paquete `editor`

`package-dir = { "editor" = "scripts" }` y nada más. Tras
`pip install -e .` funcionan `import editor.reloj`, `.mezcla`,
`.contratos`, `.comun` y `.escaleta` — verificado desde un cwd neutro,
donde el import solo puede venir de la instalación.

Dos decisiones:

- **`scripts/__init__.py` SÍ existe**, y se comprobó antes que no cambia
  nada para los scripts: un directorio en `sys.path` expone sus módulos
  igual con él que sin él. Lo que aporta es el PUENTE: los módulos se
  importan entre sí por nombre plano (`contratos.py` hace `import reloj`),
  así que al entrar por `editor.contratos` el `__init__` añade scripts/ al
  path (con `append`, para no disputar precedencia a quien ya hace
  `insert(0)`). Consecuencia asumida: `editor.reloj` y `reloj` son dos
  objetos módulo si se usan las dos vías en el mismo proceso; para
  constantes y funciones puras da igual, y está escrito en el `__init__`.
- **`dependencies = []` a propósito**, y es deuda declarada: las de verdad
  siguen en requirements*.txt. Declararlas haría que un consumidor que solo
  quiere `editor.reloj` (stdlib puro) arrastrara mlx-whisper y Playwright.
  El reparto en extras es de la fase 2.

Y una trampa de ESTA máquina que costó una vuelta: el árbol de `.venv/`
lleva `UF_HIDDEN` y Python ≥ 3.12 ignora los `.pth` ocultos, así que la
instalación editable terminaba bien y `import editor` no existía — sin un
solo error. `chflags nohidden` sobre los `.pth` lo arregla; anotado en
CLAUDE.md, «Estado real de esta máquina».

### 2 · `ORDEN` deja de leerse con una regex

La lista de ~210 capas vivía como literal en `composite_ffmpeg.py` y
`validar_plan.py` la sacaba del FUENTE con una expresión regular — decisión
de la tanda del validador, para no importar el compositor ni arrastrar sus
dependencias. El desacoplo era correcto; el mecanismo, frágil: la regex se
colaba con comentarios dentro de los corchetes (pasó) y ataba el formato
del código a lo que ella supiera leer.

Ahora `ORDEN` es DATOS: `guiones/capas.json` —donde ya viven CATALOGO.json
y CONTRATO.md—, y los dos consumidores lo cargan de ahí. Mismo desacoplo,
cero regex, y el porqué queda comentado en ambos. `composite_ffmpeg.ORDEN`
sigue existiendo con su nombre: las pruebas que lo importan no se enteran.

### 3 · ffmpeg: entorno > PATH > Homebrew, resuelto UNA vez

Quince scripts de Python y tres de Node repetían
`os.environ.get("FFMPEG_BIN", "/opt/homebrew/bin/ffmpeg")` con la ruta de
Homebrew escrita a mano — el README lo describía tal cual («ninguno cae al
PATH»). La resolución vive ahora en `comun.py` (`_localiza_binario`) con un
espejo mínimo en `comun.js`, y todos los demás la importan.

El orden importa y quedó escrito: la variable de entorno manda SIEMPRE,
aunque apunte a la nada, porque es la palanca del CI y del arnés
(`FFMPEG_BIN=/no/existe make pruebas` tiene que seguir dando 27 en rojo);
sin variable se pregunta al PATH, que es lo que hace portable el repo; y
Homebrew queda de respaldo porque el PATH de un proceso lanzado fuera de
una shell (un hook de git) no siempre lo trae. En `scripts/` no queda ni
una ruta de Homebrew fuera de ese respaldo.

### 4 · `layers.json` con rutas relativas y `raiz`

El renderizador escribía `dir`/`mask` ABSOLUTOS: un build copiado o movido
—o el repo clonado en otra ruta— dejaba un manifiesto apuntando a los
fotogramas de otra máquina. Ahora escribe rutas RELATIVAS al build y anota
la raíz una vez en la cabecera (`raiz`); los lectores (compositor,
comprobar_montaje, contratos, colocar, la fusión de `--only` del propio
renderizador) resuelven con `comun.resolver_manifiesto`.

Retrocompatibilidad explícita y comentada en cada lector: un manifiesto
anterior trae absolutas y se aceptan tal cual — los builds en curso no se
regeneran solos, y el arnés corrió en verde sobre una pieza real del
formato viejo antes de tocar nada. Detalle que importa: `colocar.py`
--aplicar LEE por una vista resuelta y ESCRIBE el manifiesto original, para
no degradar las rutas relativas a absolutas al sincronizar `dy`.

### Verificado

`EDITOR_BUILD=build/piezas/H1A make rapido` en verde (823 pruebas, 8
saltadas) sobre un manifiesto del formato VIEJO, y `pytest -m lento`
(la cadena entera: render → validar → montaje → contratos → colocar →
composición) en verde produciendo y consumiendo el formato NUEVO. La
fusión `--only` conserva las rutas relativas en la ida y vuelta.

### Lo que queda para la fase 2

- El reparto de dependencias en extras (`editor[pipeline]`,
  `editor[arnés]`…) cuando el monorepo exista.
- `guiones/capas.json` se mantiene A MANO, como el literal que sustituye;
  si algún día duele, el generador es trivial.
- Los módulos comparten espacio de nombres plano dentro del paquete
  (`editor.contratos` importa `reloj`, no `editor.reloj`): unificarlo es
  de la mudanza real, no de esta fase.

## Tanda 17 · La mudanza: la copia canónica vive en el monorepo

La fase 2 se ejecutó el mismo día: los ficheros trackeados (más los nuevos
de la Tanda 16) se copiaron a `videofabric/apps/editor`, que desde hoy es
LA COPIA CANÓNICA. El repo editor-youtube queda como archivo histórico: lo
que se toque allí no viaja solo — tócalo aquí.

Qué cambia aquí y no allí: `package.json` se llama `@fabrica/editor` (regla
de nombres del workspace pnpm); el arnés en un clon sin builds es `make ci`
(776 en verde el día de la mudanza); el venv se crea en
`apps/editor/.venv` con `pip install -e . -r requirements.txt` (y el
`chflags nohidden` de los `.pth`, la trampa de la Tanda 16). El monorepo lo
consume desde una cola BullMQ (`edit`) que invoca estos scripts como
procesos con `EDITOR_BUILD` por reel — el mecanismo de `piezas.py`, tal
cual. El porqué completo: `videofabric/docs/reels.md`.

(Esta entrada nació en el ROADMAP del repo viejo y faltaba aquí: las dos
copias divergieron en el fichero que declara que no deben divergir. La
sincronía manual es exactamente la fricción que la mudanza elimina — si
vuelve a pasar, el repo viejo sobra.)
