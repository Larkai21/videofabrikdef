# Calidad y medición — informes, bancos y conjuntos etiquetados

Cómo se sabe si un cambio mejora o empeora el vídeo, sin discutirlo. Tres
herramientas con la misma filosofía: congelar la entrada, medir la salida,
guardar el histórico. La lección que las motivó está pagada: en una vuelta de
mejora de guion se leyó ruido como señal (+13/+27 en una corrida, −31 al repetir
el mismo prompt) y una métrica «más es mejor» se dejó jugar hasta el 74 %
empeorando el texto. Desde entonces, banda de ruido y comparaciones pareadas.

## 1. `pnpm calidad <videoId>` — el informe del vídeo producido

Corre solo al terminar el render y bajo demanda. Todo sale de `master.json` y de
la BD; el análisis vive en `packages/shared/src/calidad.ts` y el CLI en
`apps/workers/scripts/calidad.ts`. Produce un resumen en terminal, un
`informe.html` con hoja de contactos (fotogramas ffmpeg del gancho, de cada
cambio de plano y de cada efecto) en `outputs/<id>/calidad/`.

Avisos que emite (los umbrales, en el propio fichero):

| aviso               | qué mide                                                        |
| ------------------- | --------------------------------------------------------------- |
| demasiada_imagen    | % del TIEMPO en pantalla en imagen fija > techo del canal (30 %) |
| imagen_larga        | imagen fija > IMAGE_MAX_S en pantalla (el troceo no pudo)        |
| plano_largo         | clip > CLIP_MAX_S sin corte                                      |
| camara_lenta        | stretch por debajo de 0,95× (se percibe como error)              |
| bucle               | planos con `fit.mode === 'loop'`                                 |
| repeticion          | el mismo asset en más de un beat (el troceo intra-beat no cuenta) |
| cadencia            | planos/min fuera de 6–16                                         |
| minuto_mudo         | minutos de reloj sin ningún overlay visual                       |
| palabra_vacia       | keyword_highlight sobre una palabra no resaltable                |
| copy_largo          | copy de tarjeta > 4 palabras                                     |
| cifra_sin_separador | el DISPLAY (displayCifra) con 5+ dígitos sin separador           |
| ancla_perdida       | keyword no pronunciada en su tramo                               |
| solape              | dos overlays a menos de FX_CARD_GUARD_MS                         |

Dos métricas se miden por TIEMPO en pantalla y no por número de planos:
`demasiada_imagen` (el troceo parte una imagen larga en varios planos cortos —
contar planos inflaba el ratio, 37 % por planos vs 20 % por tiempo en el mismo
vídeo) y `cuota_biblioteca` (qué parte del tiempo ganó el tier 0; sale del
`origin` que la ingesta congela en cada plano, `null` en maestros anteriores).

El informe audita contra lo que se pidió al producir (el techo de imágenes se
congela en `broll_telemetry` antes de matchear): producir contra un objetivo y
auditar contra otro haría el informe inútil. La misma regla vale para las
cifras: el aviso audita `displayCifra(value)` —lo que el espectador ve—, no el
value crudo, porque StatCard y StatOdometer formatean con ese mismo formateador.

## 2. `pnpm rerank` — el banco de matching

`calibracion/planos-etiquetados.jsonl`: 25 beats de un vídeo real con sus
candidatos, el plano elegido por un humano y —lo que de verdad sirve— **qué
planos serían aceptables**. La métrica es «sin disparate», no «coincide con el
humano»: con cinco planos casi iguales, elegir el tercero en vez del cuarto no
es un error; el plano que NO pega sí. Detalles y resultados en
`calibracion/README.md`.

El resultado que justifica el juez de planos (`broll_rerank`): ninguna
combinación de los números del embedding despega (los seis candidatos de un beat
caben en 0,037 de coseno), y un juez que LEE los pies de foto pasa de 17/25 a
24/25 sin disparate. `--juez` incluye esa llamada; `--detalle`, el beat a beat.

## 3. `pnpm guion` — el banco de guiones

Itera el prompt del guion sin pasar por la cola (la cadena real tarda 92 s por
el estado, no por el reloj). Briefs congelados por caso en `banco/casos/`, con
`prompt_sha` y separación dev/control. Subcomandos: `preparar`, `--variante`,
`--medir`, `--diff` (con banda de ruido y detección de comparaciones pareadas),
`--porteria`, `--leer`. La rúbrica del juez vive en `banco/RUBRICA.md`; las
vueltas medidas y sus lecciones, en `banco/HISTORIAL.md`.

**`banco/perfil.json` conserva a propósito la identidad vieja («Señal y
ruido»):** cambiarla invalidaría la comparación con todas las corridas
históricas. Cuando toque re-medir guiones con la marca nueva, se abre una
familia de casos nueva; no se edita la vieja.

## 4. `calibracion/coste-historico.csv` — el ledger exportado

2.478 llamadas reales y 3,2173 $ de histórico (jul-2026), exportado antes de
vaciar `cost_ledger` en la limpieza del 3-ago. Es de donde salen los precios por
operación que se usan para decidir (guion ~0,007 $, captions ~0,0005 $/imagen,
vídeo completo 0,06–0,20 $). La tabla viva se repuebla sola con cada vídeo.

## 5. `pnpm metricas <csv>` — la telemetría de rendimiento

El MVP no toca la YouTube API (principio 7), así que el bucle de datos se
cierra a mano: exportar el CSV de YouTube Studio (pestaña Contenido →
Exportar) y correr `pnpm metricas <ruta.csv>`. Casa las filas por TÍTULO
normalizado (cabeceras en español o inglés, coma decimal, duraciones m:ss) y
guarda en `videos.metrics` las cinco cifras que cambian decisiones: vistas,
impresiones, CTR, duración media y horas. Lo que no casa se lista en ambos
sentidos; nunca se adivina.

## 6. Qué medir antes de tocar

- ¿El cambio toca la señal de matching? → `pnpm rerank` antes y después.
- ¿Toca el prompt del guion? → `pnpm guion --diff` contra la variante base.
- ¿Toca el render o la edición? → `pnpm calidad` sobre un vídeo real y comparar
  informes; para ver dos montajes del mismo maestro, `render-master`.
- ¿Cambia la voz o el modelo TTS? → `pnpm probar:voz` (los modelos no son
  intercambiables: el mismo texto por `eleven_multilingual_v2` sale bastante más
  lento que por Flash).
