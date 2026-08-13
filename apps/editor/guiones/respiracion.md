# Respiras mal y por eso vas acelerado — escaleta

Guion de dirección: [`guiones/respiracion.json`](respiracion.json).
52 s · 9:16 · bucle infinito · 196 palabras (≈3,8 palabras/s, ritmo de Reel).

Esto es la lectura humana. El JSON es lo que consume `leer_guion.py`; si los
dos discrepan, manda el JSON.

---

## La idea, antes que los gráficos

Un Reel sobre respiración se hunde por un sitio: **suena a espiritualidad**.
La decisión de dirección que ordena todo lo demás es tratarlo como
**fontanería** — un cable que va del pulmón al corazón y un interruptor que
tienes tú. De ahí salen las tres reglas de la pieza:

1. **Ninguna imagen de bienestar.** Ni atardeceres, ni siluetas de loto. El
   registro visual es **dibujo a mano**: casillas, flechas y círculos, como
   quien te lo explica en una servilleta. Es lo que compró el catálogo
   importado (`hw-*`) y es lo que este repo no tenía.
2. **La prueba va DESPUÉS de la explicación.** La gráfica del pulso cayendo
   está en el acto 4, no en el 1. Una gráfica al principio es decoración;
   después de explicar el mecanismo es una prueba.
3. **El bucle es literal.** La última frase ES la primera, grabada una vez y
   montada en los dos sitios. El que llega al final no nota que ha vuelto a
   empezar hasta la segunda vuelta.

---

## Escaleta

### Acto 1 · GANCHO — 0:00-0:07
> «Hoy vas a respirar **veinte** mil veces. Y unas dieciocho mil las vas a
> hacer **mal**. No es una forma de hablar: es la diferencia entre estar
> tranquilo y estar **acelerado** sin motivo.»

| | |
|---|---|
| En pantalla | `hero-stat` contando 0 → 20.000 · «RESPIRACIONES AL DÍA» |
| Sobre palabra | `hw-underline` subraya **mal**, a mano, mientras se dice |
| Sonido | `hud_lock` (trinquete del contador) + `appear` |
| Encuadre | primer plano |

**Por qué.** El gancho no es una promesa, es una cifra que el espectador no
ha contado nunca. El contador sube mientras hablas: el ojo se queda a ver en
qué número para. Y el subrayado a mano sobre «mal» es lo primero que dice
«esto te lo va a explicar alguien, no un folleto».

### Acto 2 · EL PROBLEMA — 0:07-0:19
> «Mira dónde se te mueve el cuerpo al coger aire. Si lo que sube son los
> **hombros**, estás respirando con el **pecho**, y el pecho es la respiración
> del **susto**. Tu cuerpo no distingue entre un correo y un **león**: si
> respiras como si hubiera un león, te prepara para uno.»

| | |
|---|---|
| En pantalla | `headline-clipper` · «LA RESPIRACIÓN DEL SUSTO», con «SUSTO» resaltado |
| Sobre palabra | `hw-callout-circle` rodea **el pecho del presentador** · `red-crash` en **león** |
| Sonido | `whoosh` + `error_buzz` |
| Encuadre | **medio, y no es un capricho**: el círculo tiene que rodear el torso, así que el torso tiene que verse |

**Por qué.** Es el único acto que le pide algo al espectador («mira dónde se
te mueve el cuerpo») y por eso va antes de cualquier explicación: engancha
por participación, no por dato. El círculo manuscrito señalando el pecho REAL
—no un icono de unos pulmones— es lo que hace que la frase «aquí no» se
entienda sin decirla.

### Acto 3 · EL MECANISMO — 0:19-0:32 · **full motion**
> «Cuando alargas la **exhalación** pasa algo mecánico. El **diafragma** baja,
> roza el **nervio** vago, y ese nervio le dice al corazón que puede bajar el
> ritmo. No es filosofía oriental: es un cable que va del pulmón al corazón y
> tú tienes el **interruptor**.»

| | |
|---|---|
| En pantalla | `hf-hw-pipeline` · cuatro casillas dibujadas que se encadenan: EXHALAS → DIAFRAGMA → NERVIO VAGO → PULSO |
| Sobre palabra | `svg-checkmark` en **interruptor** |
| Sonido | `tech_pulse` (frontera de acto) + `ping_success` |
| Encuadre | ninguno: el A-Roll desaparece, el gráfico ES el plano |

**Por qué.** Es el corazón de la pieza y el único sitio donde el presentador
estorba: lo que hay que mirar es la cadena. El dibujo a mano contra una voz
técnica es el contraste que lo sostiene — el mismo contenido con un diagrama
limpio suena a prospecto.

### Acto 4 · LA PRUEBA — 0:32-0:41 · **full motion**
> «**Seis** respiraciones por minuto. **Cinco** segundos dentro, cinco fuera.
> En dos minutos el pulso te baja entre ocho y **doce** latidos, y eso se
> **mide** con un reloj de cuarenta euros.»

| | |
|---|---|
| En pantalla | `hf-mk-line-graph` · la curva del pulso CAE mientras se dice la cifra |
| Sobre palabra | `timer-ring` en **cinco**, vaciándose en 5 s exactos |
| Sonido | `hud_lock` |

**Por qué.** El anillo no es un adorno: **se vacía en cinco segundos de
verdad**, así que el espectador puede respirar con él sin que nadie se lo
pida. Es la única pieza de la escaleta que hace algo además de ilustrar.

### Acto 5 · CIERRE Y BUCLE — 0:41-0:52
> «Hazlo **ahora** mismo, conmigo, una sola vez. Coge aire cinco segundos. Y
> suelta diez. Eso que acabas de notar es **gratis**, no se acaba, y lo tienes
> desde que **naciste**. Hoy vas a respirar veinte mil veces.»

| | |
|---|---|
| En pantalla | `engagement-cta` · «UNA VEZ. AHORA.» / «5 segundos dentro · 10 fuera» |
| Sobre palabra | `gold-glint` en **gratis** |
| Sonido | `sub_drop` + `subscribe_reminder` |

**Por qué.** La orden va antes que la petición de seguir: primero se cobra el
valor (respira conmigo), después se pide. Y la última frase devuelve al
principio sin avisar.

---

## Presupuesto, y en qué se ha gastado

| regla | tope | esta pieza |
|---|---|---|
| §13 tarjetas | 1 por acto | 5 |
| §15 micro-FX | **6 por pieza** | **6, al límite** |
| §15 repetir un efecto | prohibido | ninguno repetido |
| §12 `cierre-cta` | último 15 % | acto 5 |

**Las transiciones cuestan un micro-FX cada una, y por eso aquí no hay
ninguna con nombre.** El compositor ya pone barrido y riser automáticos en
cada frontera de acto; gastar dos de los seis huecos en
`hw-scribble-transition` o `whip-pan` habría dejado la pieza sin el círculo
del acto 2 o sin el anillo del 4, que son los que hacen trabajo. Con seis
huecos, un efecto que solo tapa el corte es el primero que sobra.

Están registradas y disponibles (`whip-pan`, `flash-through-white`,
`light-leak`, `hw-scribble-transition`, `freeze-frame-dressing`,
`morph-text`, `yt-circle-pointer`, `yt-feather-highlight`, `hw-box-label`,
`hw-arrow`): en una pieza de 90 s con seis actos sí caben.

---

## Lo que hay que grabar

- **Encuadre medio en el acto 2** o el círculo del pecho no tiene a qué
  agarrarse. Los demás actos, primer plano.
- **La frase del bucle, una sola toma.** Se monta al principio y al final. La
  cola tras la última palabra más la cabeza antes de la primera tienen que
  sumar menos de 0,35 s o el reinicio se oye como pausa; `leer_guion.py` lo
  mide y lo dice.
- **Respirar de verdad en el acto 5.** Los cinco segundos de inhalación son
  cinco segundos de silencio en la pista. `silencios.py` los recortaría por
  ser silencio: hay que declararlos con `--minima` o dejar ese tramo fuera
  del recorte.

## Lo que este guion todavía no puede pedir

Los bloques importados **traen su contenido escrito dentro**: `hf-hw-pipeline`
dibujará SUS cuatro casillas, no «EXHALAS → DIAFRAGMA → NERVIO VAGO → PULSO».
El `card_copy` de esos actos se avisa y se tira — está en el JSON como
intención de dirección, no como algo que el pipeline sepa cumplir hoy.
Parametrizarlos (una tabla de variables por bloque, como la `COPY` de las
nuestras) es el siguiente paso, y es lo que separa «tenemos 126 plantillas» de
«podemos usar 126 plantillas».
