# Estado de la fábrica — 15-ago-2026

Foto del sistema tal y como está HOY, verificada leyendo el código y la base de
datos (no lo planeado). El README resume esto para quien llega; aquí va el
detalle y lo que falta. Fuente de los números: consultas a Postgres del 15-ago
y `calibracion/variedad-baseline.json`.

## Lo que ya produce

| Producto | Hechos | Dónde |
| --- | --- | --- |
| Vídeos largos | 7 | `outputs/<id>/` |
| Shorts verticales | 10 | `outputs/<id>/shorts/` |
| Clips de episodios ajenos | 7 (de 3 episodios) | `outputs/episodios/` |
| Reels de A-roll propio | pipeline completo, sin producción real aún | `outputs/reels/` |

Cada vídeo largo entrega MP4, `title.txt`, `description.txt` (con capítulos
reales y atribuciones), `tags.txt`, subtítulos SRT/VTT, dos miniaturas
auto-generadas e informe de calidad HTML con fotogramas.

Calidad medida del último vídeo («Actrices sintéticas», 4,2 min): 22 beats, 67
planos, 51 efectos, 0 planos repetidos, 15,8 planos/min, 4,0 efectos/min.

Variedad medida entre vídeos (`pnpm variedad`, baseline 14-ago sobre 7 vídeos):
79,7 planos/vídeo, 50,6 únicos, **14,5 % de planos repetidos** contra la ventana
de los 8 anteriores (picos del 22 %), jaccard medio 0,042. Tres assets aparecen
en 4 de los 7 vídeos.

## Lo que está construido pero apagado

- **Publicación en YouTube**: OAuth por canal, subida, programación y marcado
  manual están codificados (`apps/api/src/routes/youtube.ts`), pero
  `PUBLISH_PROVIDER=mock` por defecto. Falta: credenciales OAuth propias y la
  auditoría de la YouTube Data API (sin ella los vídeos subirían bloqueados en
  privado). El MVP entrega para subida manual, con checklist en la pantalla de
  entrega.
- **Música de fondo**: mezcla con ducking sidechain, normalización, registro de
  la pista en el maestro y anti-repetición entre vídeos están hechos. La
  biblioteca tiene **cero pistas `kind=music`**, así que el toggle del canal no
  tiene efecto. Falta: subir 15-20 pistas con licencia limpia.
- **Corte semántico de relleno en clips** (`clips_relleno`): implementado,
  apagado por defecto — quita material y cuesta una llamada por clip.
- **Cosecha semanal de biblioteca**: programada para los lunes a las 6:00;
  probada a mano, aún sin correr en su horario.

## Lo que falta (en orden de valor)

1. **Emparejamiento visual** (`docs/plan-variedad-matching.md` §S4). Hoy el
   matching compara texto con texto (caption del plano contra consulta) y esa
   señal **no separa**: los candidatos de un beat caben en 0,037 de coseno y el
   AUC es 0,707 sin umbral útil. Quien sostiene la calidad es el juez LLM que
   lee los pies de foto (96 % sin disparate). El salto es embeber el
   **fotograma** con SigLIP2 en local (coste 0) y usarlo para recuperar, no para
   decidir. Bloqueado por el banco (abajo).
2. **Banco de etiquetas**. Solo hay 25 beats etiquetados y la varianza del juez
   entre corridas es ±3: cualquier mejora del matching es hoy indistinguible del
   ruido. Se cierra con una tarde de curación en el dashboard y
   `exportar-etiquetas.ts`.
3. **Audio audible**. La cama de música vive a ~28-31 dB bajo la voz (−22 dB más
   un ducking casi permanente): se paga su riesgo sin oírla. Subirla a −17/−18 y
   bajar el ratio es el cambio con efecto audible; exige re-nivelar los SFX y
   re-medir pico.
4. **Más fuentes libres**: Internet Archive y el vídeo de Wikimedia Commons. El
   habilitador (licencia y atribución por asset hasta `description.txt`) ya está
   hecho.

## Decisiones pendientes del usuario

| # | Decisión | Bloquea |
| --- | --- | --- |
| D1 | Rechazo formal de `yt-dlp` como b-roll ajeno + auditar la exposición del clipping de podcasts (misma cuenta que monetiza) | Riesgo legal vivo |
| D2 | Coverr sí/no (pide logo en el dashboard; prohíbe usar su material como dataset, lo que roza el índice visual) | Un proveedor más |
| D3 | ¿La música se oye (−17/−18 dB) o se quita? El estado actual (inaudible pero con riesgo de Content ID) es lo indefendible | Sprint de audio |
| D4 | Confirmar que no se paga stock (nada con API baja de 50 $/mes) | Cierra el tema |
| D5 | Una tarde de curación para llegar a ≥100 etiquetas | Medir el matching |
| D6 | Autorizar un sidecar Python en workers (precedente: `apps/editor`) | Emparejamiento visual |

## Deuda conocida

- Los tags basura ya guardados en biblioteca no se reconstruyen, aunque la raíz
  del bug de tokenización esté arreglada.
- Dos vídeos quedaron a medias en `outputs/` (solo llegaron a la fase de audio).
- `pnpm variedad` sobrescribe su propia baseline en cada corrida: si se relanza
  sin querer, se pierde la foto anterior.
- El default de `STT_PROVIDER` en código es `whisper` (API de pago) mientras
  `.env.example` fija `mlx` (local, gratis): copiar el ejemplo es lo correcto.
- El criterio de Hecho de S2 del SPEC («5 vídeos consecutivos sin tocar código»)
  está en 1 de 5: el último vídeo necesitó dos arreglos del resolver de Google
  News.
