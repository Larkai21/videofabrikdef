# Media de guion — manifiesto

Qué ficheros de media usa cada guion, de dónde se bajan y con qué licencia.
**Escrito a mano a propósito** — al revés que `CONTRATO.md`, que se genera:
la fuente y la licencia de un clip no están en ningún fichero del repo del
que derivarlas. O se apuntan aquí al bajarlo, o se pierden — y un clip sin
procedencia es un clip que no se puede volver a bajar ni relicenciar.

## Política

- **Los media NO se versionan.** El escudo de la pieza de Codex mide
  ~10,5 MB — un solo clip de stock del orden del repo entero, y de la
  historia de git no se sale con un commit. `.gitignore` ya los excluye
  (`assets/broll/*` y `*.mp4`); esa exclusión no es un descuido, es esta
  política.
- **Un clon los baja según este fichero**: fuente, id y ruta EXACTA por
  fila. La ruta importa tanto como el contenido — `media_local` y la
  resolución de `media_fetch` casan contra lo que hay en `assets/broll/`.
- **`scripts/leer_guion.py` falla nombrando el que falte** y apunta aquí.
  No degrada en silencio: una escena declarada cuyo fichero no está es un
  montaje distinto del que el guion pidió.
- **El pipeline no descarga nada.** `media_fetch` se resuelve por tokens
  contra el disco; si nada casa, el paso es humano: bajar el fichero,
  dejarlo en `assets/broll/` y añadir su fila aquí.

## `codex-security.json`

| fichero | de dónde | licencia | qué hace en la pieza |
|---|---|---|---|
| `assets/broll/shield_security_pixabay_262696.mp4` | Pixabay, vídeo id 262696 — patrón `pixabay.com/videos/` + slug + id. La URL exacta lleva un slug delante del id que no se ha verificado desde esta máquina; se deja el patrón y el id porque una URL inventada es peor que un patrón honesto. | Pixabay License (uso libre sin atribución obligatoria; no redistribuir tal cual como stock) | Acto 1: `media_local` anclado a «muchísimo» (el tramo «o muchísimo trabajo», 3,8→5,2 s de origen, que el guion no contemplaba y quedaba a cara sola), 2,2 s. Resuelve además el `media_fetch` «shield security via pexels» del `stamp-banned`: casa por tokens («shield»+«security»), no por proveedor — el guion dijo Pexels y el clip vino de Pixabay. |

Medido en esta máquina con ffprobe, no copiado de la web: h264, 3840×2160,
60 fps, 5,000 s, ~16,9 Mbps, 10 533 060 bytes.
