# Generación — research pack, guion, SEO y juez de alineación

Componente: worker `script:*`. Entrada: una idea `approved`. Salida: `master_json.script`

- `master_json.seo` en estado `guion_borrador`. Modelo por defecto: GPT-5 Mini con
  Structured Outputs; el escalón de calidad es configurable por canal en `settings.llm`.

## 1. Research pack

1. Toma las 3–5 mejores fuentes del cluster de la idea (por señal externa y diversidad
   de dominio) y descarga el texto completo (trafilatura; límite 20k chars/fuente).
2. Una llamada LLM produce el pack:

```
research: {
  sources: [{url, title, domain, published_at}],
  summary: string,                  // 300–500 palabras, neutro
  claims:  [{text, source_idx}],    // toda cifra o afirmación fuerte, con su fuente
  angles:  [string]                 // 3 ángulos posibles detectados
}
```

3. Regla de seguridad factual que se propaga al guion: el guion NO puede introducir
   cifras ni afirmaciones fuertes que no estén en `claims`. Si falta un dato, el guion
   lo formula sin cifra o lo omite.

## 2. Prompt de guion

- System: render del `channel_profile` (posicionamiento, espectador, tono, prohibiciones,
  estilo de gancho) + reglas de formato de salida + reglas factuales (§1.3).
- User: idea (ángulo elegido), research pack, duración objetivo, idioma.
- Salida (Structured Output, esquema en docs/contratos.md):

```
script: {
  scenes: [{id, section: hook|body|cta, text, visual_query, emphasis?: bool}],
  hook_notes: string          // qué promesa abre y cómo se paga al final
}
```

- Duración → palabras: narración a WORDS_PER_MIN (139, MEDIDO con la voz real del canal; historial en docs/voz-y-beats.md). 8 min ⇒ ~1.110 palabras.
  Validador post-generación: total dentro de ±10%; si no, pasada de ajuste que corta o
  expande secciones `body` (nunca el hook aprobado).
- `visual_query`: 3–8 palabras concretas y filmables («macro de placa GPU», «sala de
  servidores pasillo frío»), en el idioma con mejor stock (inglés por defecto aunque el
  guion sea en español; flag por canal).

## 3. Paquete SEO

Generado en la misma pasada:

- 3 títulos aplicando `title_patterns` del perfil (cada uno indica qué patrón usa),
  ≤ 70 caracteres, sin promesas que el guion no pague.
- Descripción: 2 párrafos (el primero con la keyword principal en la primera frase) +
  bloque de capítulos con placeholders `{timestamps}` que el render rellena con los
  tiempos reales de sección + disclosure fijo de asistencia de IA si el canal lo activa.
- Tags: 10–15, mezcla de cabeza (2–3) y cola larga extraída de los títulos de fuentes y
  competidores del cluster.
- 2 conceptos de miniatura: {texto ≤ 4 palabras, descripción visual} → alimentan
  `thumbnail_template` en el render.

## 4. Gate humano y juez de alineación

1. El humano ve el guion como documento (hook destacado, secciones plegables), elige 1
   título y puede editar cualquier texto (los cambios marcan `edited_by_human`).
2. Al confirmar título: juez de alineación (misma familia de modelo, prompt corto,
   salida estructurada):

```
{verdict: aligned|misaligned, reasons: [..], patch_targets: [scene_ids]}
```

3. Si `misaligned`: pasada de refinamiento SOLO sobre `patch_targets` (parche, nunca
   regenerar entero; jamás tocar texto `edited_by_human` sin avisar en UI).
4. Flag `packaging_first` (por canal): al aprobar la idea se generan solo títulos +
   conceptos de miniatura → gate → el guion se escribe después "para cumplir la promesa"
   y el juez pasa a ser casi siempre `aligned`.

## 5. Costes y registro

Cada llamada (research, guion, juez, refinamiento) escribe en `cost_ledger` con tokens
de entrada/salida y coste estimado. Presupuesto orientativo por vídeo: < 0,02 $.

## Refinado con verificación (y por qué)

El juez encola la reparación con notas por escena `{axis, issue, fix}` y el linter
determinista añade las suyas (sus avisos duros entran aunque el juez no los marque).
Tras reescribir, `loQueSigueMal` vuelve a pasar el linter sobre las escenas tocadas y
re-encola SOLO las que siguen mal, avisando al modelo de que ya se intentó — sin eso
repite la misma reescritura. Tope `MAX_VUELTAS=2`: a la tercera no es el modelo, es el
prompt, y lo ve el humano en la puerta. Motivado por un caso real: una escena que abría
con el rótulo «Qué hacer ya:» llegó a la puerta con el rótulo intacto después de pasar
por el refinado.

## Iterar el prompt sin pasar por la cola

`pnpm guion` (banco de guiones congelado por caso) — ver docs/calidad.md §3.
