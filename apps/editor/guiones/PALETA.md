# Paleta de marca — para quien escribe el guion

**Papel y Tinta.** Dos temas que dicen lo mismo con la luz al revés. `carbon`
es el de por defecto y el que se usa sobre A-Roll.

```json
{
  "carbon": {
    "bg":        "#16161A",
    "surface":   "#1F1F24",
    "ink":       "#EDE8DF",
    "ink_soft":  "#9E9A92",
    "ink_faint": "#6A665F",
    "accent":    "#6FA0D6",
    "accent_2":  "#C97068",
    "rule":      "#2E2C30"
  },
  "paper": {
    "bg":        "#EDE8DF",
    "surface":   "#F7F3EC",
    "ink":       "#16161A",
    "ink_soft":  "#4A4650",
    "ink_faint": "#8A8478",
    "accent":    "#1F4E79",
    "accent_2":  "#8A3A32",
    "rule":      "#CFC6B7"
  },
  "senal": {
    "ok": { "carbon": "#3DD68C", "paper": "#256B43" },
    "no": { "carbon": "#E5484D", "paper": "#C0261F" }
  }
}
```

## Lo único que hay que saber para escribir un guion

**No hace falta elegir color.** `blue_highlight_words` basta: la palabra sale
en `--accent`, un 16 % mayor y cien puntos de peso por encima. El pipeline
pone el color; el guion decide **qué palabra carga la frase**, que es lo que
solo sabe quien la escribió.

Por eso `brand_highlight_color` en `metadata` sobra. Si va, tiene que ser el
`accent` del tema — cualquier otro se ignora y se avisa.

## La regla que rechaza un color

> **Nada de neón.** El techo de saturación lo pone el propio acento.

`#4CC2FF` satura 0,70 sobre valor 1,00 y por eso se rechazó: es luz de
pantalla, no tinta. El acento de marca satura 0,48 sobre 0,84. La prueba está
en `tests/test_color.py::test_ningun_acento_es_neon`.

## Qué significa cada uno

| Token | Qué dice | Cuándo NO |
|---|---|---|
| `accent` | esto es lo importante de la frase | nunca para «correcto» |
| `accent_2` | lo secundario, el contrapunto cálido | nunca dos acentos en el mismo gráfico |
| `ink_soft` | texto de apoyo, entradillas | para un titular |
| `ink_faint` | metadatos, sellos, firmas | para nada que haya que leer |
| `senal_ok` / `senal_no` | correcto y fallo, y **solo** eso | como color decorativo |

`senal_*` **no son colores de marca**: no cambian con ella. Un check verde es
verde en cualquier marca, y usarlos para decorar rompe justo eso.

La norma completa, con el porqué de cada valor: `BRAND_RULES.md` §1-§2.
