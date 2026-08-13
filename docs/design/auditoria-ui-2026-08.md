# Auditoría UI/UX — 13-ago-2026 (Sprint 4, S4.1)

Método: todas las rutas con datos reales, tema oscuro completo + spot-check de
claro, densidad compacta y estados de carga, mirando capturas (el criterio del
repo: se juzga mirando). Cada hallazgo lleva a qué tarea va. Lo que está bien
también se dice: es lo que NO hay que tocar.

## Fortalezas (no tocar sin motivo)

- **Guion**: documento serif con avisos al margen, títulos con longitud
  medida y atajos — el mejor nivel del producto.
- **Timeline**: preview + pista de beats + panel de candidato con similitud y
  procedencia; curación con teclado.
- **Entrega**: checklist de subida manual YA existe, copiar por campo YA
  existe, publicación con enlace y corrección. (El plan del sprint 6 lo
  daba por hacer: recalibrado.)
- **Raíl de la Bandeja**: «2 vídeos esperan tu firma · unos 15 min» es
  exactamente la voz correcta.
- **Brand kit** y **Biblioteca** (filtros, atajos `/` y `E`, favoritos, purga).
- **Shorts/EpisodioClips**: tarjetas con confianza + preview del player real.

## P1 — rompe uso o principio

1. **RETRACTADO tras re-verificar**: el tema claro funciona BIEN (paleta
   completa, ámbar AA legible, fondo y cabecera cambian) y el oscuro
   explícito también. Las capturas «rotas» eran un artefacto del método:
   capturar en el mismo tick del swap de atributo pilla el recálculo de CSS
   a medias. Lección para la próxima auditoría: tras cambiar data-tema,
   esperar un frame antes de capturar. Se deja escrito porque una mención
   equivocada en un informe es exactamente la clase de fallo que este repo
   persigue.
2. **Alta de reel enseña JSON crudo** (textarea con placeholder
   `{"pieces": …}`) — viola el principio 2 — y el input de fichero es el
   nativo en inglés («Choose File»). → S5.1 (editor por actos) + S4.2
   (file input propio).
3. **Las incidencias vuelcan el error crudo**: en EpisodioClips una
   incidencia real enseña `EPERM … /node_modules/.remotion/chrome-headless-
   shell/mac-arm64` a lo ancho de la tarjeta. El humano necesita «El render
   no pudo abrir el navegador — Reintentar suele bastar» + detalle plegado.
   → S4.2 (componente Incidencia con resumen humano, detalle colapsado,
   acción sugerida destacada).
4. **Ideas: esqueleto infinito y contador contradictorio** («0 ideas
   puntuadas» en cabecera con 672 en el ranking del radar). Bug de
   query/estado además de UX. → investigar en S4.4.
5. **Cabecera inconsistente por ruta**: Costes y Ajustes pierden el selector
   de canal y el badge de coste, y la búsqueda cambia de posición. La
   cabecera es el ancla espacial: no puede mutar por pantalla. → S4.3.

## P2 — fricción real

6. **«Clips y reels» (ámbar = tu firma) queda BAJO el radar**, fuera del
   pliegue: lo accionable segundo, el lanzador primero. → S4.4 (orden:
   raíl → puertas fuera del raíl → radar → galería → coste).
7. **Nav plana de 11 ítems** mezcla productos (Reels), vistas (En curso),
   anclas (#publicados) y ACCIONES (Nuevo canal). → S4.3 (hub por producto
   + breadcrumbs; «Nuevo canal» a botón, no a nav).
8. **Cargas sin patrón**: Costes y Ajustes muestran «Cargando…» en texto
   plano (el resto usa SkeletonRows). → S4.2 (skeleton en todas).
9. **Inputs nativos sin locale**: date `mm/dd/yyyy` (filtros de galería),
   month «August 2026» (Costes), file «Choose File» (Reels). → S4.2.
10. **Biblioteca: clips sin póster** — tarjetas play-sobre-gris; el póster
    existe para unos assets y no para otros. → S6.2 (generar/backfill
    thumbnails) — anotado también como posible job de workers.
11. **Biblioteca: tags rotos por tokenización** («sen», «alando», «con» —
    «señalando» partido): ensucia chips Y búsqueda. Bug de
    `tagsFromFilename`/captioner, no de UI. → ticket aparte, no es de estos
    sprints de UI pero se DETECTÓ aquí.
12. **Episodios: lista pobre** — sin miniatura del episodio, duración solo
    como texto, mucho vacío a ancho completo. → S5.3/S6.
13. **Ideas dentro del radar**: 672 ideas en grid de tarjetas pesa; falta
    compactar/paginar visualmente. → S4.4.

## P3 — pulido

14. Galería de plantillas: sin hover-play ni comparador de temas (S6.1, ya
    planificado); `pointer-events: none` impide probar gestos interactivos.
15. Wordmark «Fábrica» no navega a la Bandeja. → S4.3 (menor).
16. Wizard sobrio y correcto; validación visible de URLs de competidores
    pendiente (menor).
17. Guion: falta el diff visible al pedir reescritura (S5.4).
18. EpisodioClips: el player no marca dónde caen los cortes del apretado
    (S5.3).

## Estado observado que exige acción fuera de UI

- Una incidencia real viva: el render de un clip murió con EPERM durante la
  revocación de permisos de macOS del 13-ago → reintentar desde la UI.
- Ideas a 0 con 672 en ranking: puede ser filtro `status=new` agotado tras
  aprobar/descartar — verificar antes de tocar UI.
