import type { ChannelProfile, Research, Scene } from '@fabrica/shared';
import type { ResearchDoc } from './research.js';
import { sceneTarget } from './wordcount.js';

export function renderProfile(profile: ChannelProfile): string {
  return [
    `Canal: ${profile.identity.name}. Posicionamiento: ${profile.identity.positioning}.`,
    `Espectador: ${profile.identity.audience}. Tono: ${profile.identity.tone.join(', ')}.`,
    `Idioma del guion: ${profile.language}.`,
    `Prohibido: ${profile.style.banned.join('; ') || 'nada explícito'}.`,
    `Pilares: ${profile.pillars.map((p) => p.name).join(', ')}.`,
  ].join('\n');
}

export function researchSystem(): string {
  return [
    'Eres un investigador riguroso para un canal de YouTube.',
    'A partir de las fuentes aportadas, produce un research pack en JSON con:',
    'sources: [{url, title, domain, published_at (string o null)}] en el mismo orden que las fuentes de entrada.',
    'summary: resumen neutro de 300-500 palabras.',
    'claims: toda cifra o afirmación fuerte como {text, source_idx} donde source_idx apunta a sources.',
    'angles: 3 ángulos posibles detectados.',
    'No inventes datos: si las fuentes no traen texto, limita el pack a lo que digan título y contexto.',
  ].join('\n');
}

export function researchUser(
  idea: { title: string; angle: string | null; summary: string },
  docs: ResearchDoc[],
): string {
  const parts = [
    `Idea: ${idea.title}`,
    idea.angle ? `Ángulo propuesto: ${idea.angle}` : '',
    `Resumen de la idea: ${idea.summary}`,
    '',
    'Fuentes:',
  ];
  docs.forEach((doc, i) => {
    parts.push(`[${i}] ${doc.title ?? doc.url} — ${doc.url}`);
    parts.push(doc.text ? doc.text : '(sin texto descargado)');
  });
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * Oficio de escritura del canal. Lo comparten scriptSystem y refineSystem: sin
 * esto, una escena que el juez marca por muletilla vuelve reescrita con otra,
 * porque el refinado no sabía cómo se escribe aquí.
 */
export function craftRules(): string {
  return [
    'Arco: el vídeo responde UNA sola pregunta central. El hook la plantea, el cuerpo la responde por partes y el cierre la cierra. Si una escena no empuja esa pregunta, sobra.',
    'Promesa y pago: lo que prometes en la primera escena se paga de forma explícita antes del cta, y el espectador tiene que reconocer que se le ha pagado.',
    'Bucles abiertos: al cerrar un bloque deja una pregunta pendiente que obligue a seguir, y ciérrala como mucho dos escenas después. Nunca más de dos bucles abiertos a la vez, y ninguno sin cerrar al final.',
    'Re-ganchos: cada tres o cuatro escenas renueva el interés con algo nuevo: un dato de los claims, un contraste o una consecuencia directa para quien escucha.',
    'Tensión: alterna afirmación y objeción. Después de una idea fuerte escribe el «sí, pero» antes de pasar a la siguiente.',
    'Transiciones: cada escena arranca enlazando con la anterior, sin resumirla. Dos escenas seguidas no pueden empezar con el mismo tipo de frase.',
    'Concreción: cada bloque baja a un caso, una cifra de los claims o algo que se pueda ver. Prohibido encadenar dos escenas que solo generalicen.',
    'Ritmo: alterna frases cortas y medias, máximo 25 palabras por frase, una idea por frase. Puntuación limpia para marcar las respiraciones del locutor.',
    'Voz: segunda persona del singular, presente, voz activa. Le hablas a una persona, no a una audiencia. Como mucho una pregunta retórica cada tres escenas.',
    '',
    'Muletillas prohibidas, son marcas de texto generado:',
    '- aperturas: «en un mundo donde», «en la era de», «hoy en día», «en el mundo actual»',
    '- falsas antítesis: «no es solo X, es Y», «no se trata solo de», «más que nunca», «la punta del iceberg»',
    '- ganchos huecos: «la pregunta es», «y aquí viene lo interesante», «prepárate», «presta atención»',
    '- cierres de redacción: «en resumen», «en conclusión», «en definitiva», «dicho esto»',
    '- hipérboles: «revolucionario», «cambia las reglas del juego», «imparable», «el santo grial»',
    '- verbos de folleto: «sumérgete», «descubre», «desbloquea», «el poder de», «el secreto de»',
    '- relleno académico: «es importante destacar», «cabe señalar», «vale la pena mencionar»',
    'Tampoco tríos de adjetivos, ni frases que empiecen por «y es que». Si una frase suena a artículo de blog, reescríbela como algo que dirías en voz alta.',
    '',
    // ejemplo de tema deliberadamente AJENO al nicho: da la forma sin dar el
    // contenido, que es el riesgo real de un few-shot
    'Ejemplo de oficio (tema ajeno al canal; fíjate en la forma, no copies el contenido):',
    'Mal: «En un mundo donde la logística lo es todo, los puertos son más importantes que nunca. La pregunta es: ¿qué está pasando realmente?»',
    'Bien: «Un contenedor sale de Shanghái y llega a Róterdam en treinta días. El barco tarda veintiocho. Los dos que faltan se pierden en una oficina de aduanas, y ese papeleo cuesta más que el combustible. Por eso el precio que pagas no baja aunque el petróleo sí.»',
    'En el bueno: primero un dato concreto, después la anomalía, luego la consecuencia para quien escucha, y una última frase que empuja hacia la escena siguiente.',
  ].join('\n');
}

export function scriptSystem(profile: ChannelProfile, targetWords: number): string {
  const patterns = profile.title_patterns
    .map((p) => `«${p.template}» (ej.: ${p.example})`)
    .join(' · ');
  return [
    'Eres el guionista del canal.',
    renderProfile(profile),
    'Reglas factuales: el guion NO puede introducir cifras ni afirmaciones fuertes que no estén en research.claims; si falta un dato, formúlalo sin cifra o omítelo.',
    'Formato: vídeo largo de YouTube, faceless, pensado para verse entero. No es un short: hay espacio para desarrollar, y por eso hay que sostener la atención a propósito.',
    `Duración: ~${targetWords} palabras en total (tolerancia ±10%). Escenas de 40-70 palabras.`,
    `Escribe exactamente ${sceneTarget(targetWords)} escenas: 1 hook, ${sceneTarget(targetWords) - 2} body y 1 cta. Ids estables: sc-hook, sc-body-1 … sc-body-${sceneTarget(targetWords) - 2}, sc-cta.`,
    'Reparto del cuerpo: 1-2 escenas de contexto, 3 o 4 bloques de desarrollo con una idea propia cada uno, 1 escena de giro (lo que contradice la intuición, o el coste que nadie cuenta) y 1-2 de conclusión antes del cta.',
    // oficio de guion: ritmo, arco y sustantivos visuales concretos (el b-roll
    // se ancla a esas palabras). La puntuación gobierna las pausas del TTS.
    craftRules(),
    'El hook (primera escena) abre con un gancho concreto en la primera frase, sin rodeos: un hecho, una cifra de los claims o una anomalía. Nada de contexto previo ni de presentaciones.',
    'Anclaje visual: nombra sustantivos CONCRETOS y filmables cuando cambies de sujeto (p. ej. "una biblioteca", "una nave industrial", "un centro de datos"), para que el b-roll pueda ilustrar cada idea; evita abstracciones ("la confianza", "el impacto") como único apoyo visual de una frase.',
    `visual_query: 3-8 palabras concretas y filmables, en ${profile.style.stock_query_lang === 'en' ? 'inglés' : 'español'} (p. ej. "server room aisle cold blue lights").`,
    'emphasis: pon emphasis=true en las 2-4 escenas MÁS importantes (giro, dato clave, conclusión); el editor las realza con un zoom. No abuses: la mayoría de escenas van sin emphasis.',
    '',
    // El montaje deja de adivinar: la escena declara qué efecto quiere y en qué
    // palabra entra. Como la palabra la acaba de escribir el propio guionista,
    // el anclaje temporal no puede fallar.
    'edit_intents: de 0 a 2 por escena, solo en las que lo merecen (un dato, un giro, una cita). Es tu instrucción al montador: sin ella el montaje tiene que adivinar.',
    '- trigger_word: una palabra EXACTA que tú acabas de escribir en el `text` de ESA MISMA escena. No vale una palabra de otra escena, ni una variante, ni una que no se pronuncie. Si no puedes citar una literal, no declares la intención.',
    '- card_text: el copy de la tarjeta, de 2 a 4 palabras, sentence case, sin comillas ni signos. Resume la frase, no añade información nueva ni la contradice.',
    '- effect: callout (etiqueta que refuerza la idea) · stat (cifra) · quote (frase citable) · kinetic (solo en el hook, como mucho uno en todo el guion) · keyword (resaltar esa palabra en el subtítulo) · annotation (marca de «mira esto») · device (una web o un comando concretos).',
    '- Para effect=stat: value en DÍGITOS y claim_idx OBLIGATORIO, el índice del claim del que sale la cifra. Si la cifra no está en los claims, NO declares el stat: la misma regla factual del guion vale para lo que aparece en pantalla.',
    'Salida JSON: { script: { scenes: [{id, section: hook|body|cta, text, visual_query, emphasis?, edit_intents?}], hook_notes }, seo: { titles, description, tags, thumbnails } }.',
    'hook_notes: qué promesa abre el vídeo y cómo se paga al final.',
    `seo.titles: exactamente 3 títulos de 70 caracteres máximo, cada uno aplicando uno de estos patrones: ${patterns || 'los del nicho'}. Sin promesas que el guion no pague.`,
    'seo.description: 2 párrafos (el primero abre con la keyword principal) y al final un bloque de capítulos EXACTAMENTE así:\nCapítulos:\n{timestamps}',
    profile.flags.ai_disclosure
      ? 'Añade al final de la descripción una línea de transparencia sobre asistencia de IA.'
      : '',
    'seo.tags: 10-15 tags, mezcla de cabeza (2-3) y cola larga.',
    'seo.thumbnails: 2 conceptos {text (4 palabras máximo), visual (descripción de la imagen)}.',
    'Sin exclamaciones. Sentence case en títulos y textos.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function scriptUser(opts: {
  idea: { title: string; angle: string | null; summary: string; whyNow: string | null };
  research: Research;
  targetWords: number;
  language: string;
  rewriteReason?: string;
  // packaging_first: título ya confirmado por el humano antes de escribir
  chosenTitle?: string;
  editedScenes: Scene[];
}): string {
  const parts = [
    `Idea aprobada: ${opts.idea.title}`,
    opts.idea.angle ? `Ángulo: ${opts.idea.angle}` : '',
    `Resumen: ${opts.idea.summary}`,
    opts.idea.whyNow ? `Por qué ahora: ${opts.idea.whyNow}` : '',
    `Duración objetivo: ${opts.targetWords} palabras. Idioma: ${opts.language}.`,
    '',
    `Research pack: ${JSON.stringify({ summary: opts.research.summary, angles: opts.research.angles })}`,
    '',
    // numerados y fuera del JSON: el modelo no puede citar claim_idx con
    // fiabilidad si los claims van dentro de un objeto sin índice visible
    'Claims del research (única fuente de cifras permitida; cita el índice en claim_idx si declaras un stat):',
    ...opts.research.claims.map((c, i) => `[${i}] ${c.text}`),
  ];
  if (opts.chosenTitle) {
    parts.push(
      '',
      `El título del vídeo YA está elegido y es una promesa al espectador: «${opts.chosenTitle}».`,
      'Escribe el guion para cumplir exactamente esa promesa: el gancho la enuncia y el cierre la paga.',
    );
  }
  if (opts.rewriteReason) {
    parts.push('', `Motivo de la reescritura pedido por el humano: ${opts.rewriteReason}`);
  }
  if (opts.editedScenes.length > 0) {
    parts.push(
      '',
      'Estas escenas las editó el humano: consérvalas EXACTAMENTE con el mismo id y el mismo texto:',
      ...opts.editedScenes.map((s) => `- ${s.id}: ${s.text}`),
    );
  }
  return parts.filter((p) => p !== '').join('\n');
}

// packaging_first (docs/generacion-guion.md §4.4): al aprobar la idea se
// genera SOLO el paquete seo (títulos + miniaturas); el guion llega después.
export function packagingSystem(profile: ChannelProfile): string {
  const patterns = profile.title_patterns
    .map((p) => `«${p.template}» (ej.: ${p.example})`)
    .join(' · ');
  return [
    'Eres el estratega de packaging del canal: el título y la miniatura se deciden ANTES de escribir el guion.',
    renderProfile(profile),
    'Salida JSON: { seo: { titles, description, tags, thumbnails } }. Nada más: el guion se escribirá después para cumplir la promesa del título elegido.',
    `seo.titles: exactamente 3 títulos de 70 caracteres máximo, cada uno aplicando uno de estos patrones: ${patterns || 'los del nicho'}. Promesas concretas que un guion pueda pagar.`,
    'seo.description: 2 párrafos (el primero abre con la keyword principal) y al final un bloque de capítulos EXACTAMENTE así:\nCapítulos:\n{timestamps}',
    profile.flags.ai_disclosure
      ? 'Añade al final de la descripción una línea de transparencia sobre asistencia de IA.'
      : '',
    'seo.tags: 10-15 tags, mezcla de cabeza (2-3) y cola larga.',
    'seo.thumbnails: 2 conceptos {text (4 palabras máximo), visual (descripción de la imagen)}.',
    'Sin exclamaciones. Sentence case en títulos y textos.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function packagingUser(opts: {
  idea: { title: string; angle: string | null; summary: string; whyNow: string | null };
  language: string;
}): string {
  return [
    `Idea aprobada: ${opts.idea.title}`,
    opts.idea.angle ? `Ángulo: ${opts.idea.angle}` : '',
    `Resumen: ${opts.idea.summary}`,
    opts.idea.whyNow ? `Por qué ahora: ${opts.idea.whyNow}` : '',
    `Idioma: ${opts.language}.`,
  ]
    .filter((p) => p !== '')
    .join('\n');
}

// El juez PUNTÚA; el veredicto lo deriva el código de unos umbrales. Antes el
// prompt le pedía «no seas quisquilloso», que es una invitación a aprobarlo todo.
export function judgeSystem(): string {
  return [
    'Eres el editor jefe del canal: revisas el guion antes de que lo lea el humano. No reescribes nada, puntúas y señalas escenas.',
    'Puntúa de 0 a 5 cada eje. 5 = publicable tal cual, por encima de la media del nicho. 4 = correcto. 3 = un defecto localizado. 2 = el defecto se nota al ver el vídeo. 1 = el eje falla. 0 = no se puede evaluar.',
    '- promesa: lo que promete el gancho, y el título si te lo paso, se paga de forma explícita antes del cierre.',
    '- estructura: hay una pregunta central, bloques con idea propia, bucles abiertos que se cierran y una conclusión que concluye.',
    '- ritmo: frases de longitud variada, una idea por frase, sin párrafos que se arrastran, sin dos escenas seguidas de generalidades.',
    '- factualidad: ninguna cifra ni afirmación fuerte fuera de la lista de claims. Si aparece una sola, este eje no puede pasar de 2.',
    '- estilo: sin muletillas de texto generado, sin exclamaciones, voz activa, sustantivos concretos.',
    'Devuelve JSON: { scores: {promesa, estructura, ritmo, factualidad, estilo}, reasons: [máximo 4 frases cortas, cada una nombrando el eje que falla], scene_notes: [{id, axis, issue, fix}] máximo 6 y solo de escenas que de verdad haya que tocar, patch_targets: [ids, máximo 4, de más grave a menos] }.',
    'Todo id de patch_targets tiene que aparecer en scene_notes. Cada fix es una instrucción concreta de una frase, no un comentario.',
    'No propongas cambios de longitud ni de duración: de eso se encarga otra pasada.',
    'No bajes nota por gustos de tono: el tono del canal ya está decidido.',
    'Si te paso avisos automáticos, verifícalos antes de darlos por buenos, pero no los ignores.',
  ].join('\n');
}

export function judgeUser(opts: {
  title?: string;
  hookNotes: string;
  scenes: Scene[];
  claims: readonly { text: string }[];
  words: number;
  lint: readonly { id: string; kind: string; detail: string }[];
}): string {
  const parts = [
    opts.title !== undefined
      ? `Título elegido: «${opts.title}»`
      : 'Aún no hay título elegido: evalúa la promesa que enuncia el propio gancho.',
    `Promesa declarada: ${opts.hookNotes}`,
    `Extensión: ${opts.words} palabras.`,
    '',
    'Claims disponibles (única fuente de cifras permitida):',
    ...(opts.claims.length > 0 ? opts.claims.map((c) => `- ${c.text}`) : ['- (el research no trajo claims)']),
  ];
  if (opts.lint.length > 0) {
    parts.push(
      '',
      'Avisos automáticos:',
      ...opts.lint.slice(0, 12).map((h) => `- ${h.id} · ${h.kind} · ${h.detail}`),
    );
  }
  parts.push(
    '',
    // el guion ENTERO: antes solo veía título, gancho y cierre, así que no podía
    // juzgar ni ritmo ni estructura ni factualidad del cuerpo
    'Guion completo:',
    ...opts.scenes.map(
      (s) => `${s.id} · ${s.section} · ${s.text.split(/\s+/).filter(Boolean).length} palabras · ${s.text}`,
    ),
  );
  return parts.join('\n');
}

export function refineSystem(profile: ChannelProfile): string {
  return [
    'Eres el guionista del canal en una pasada de refinamiento dirigido.',
    renderProfile(profile),
    // sin el oficio, la escena marcada por muletilla vuelve con otra muletilla
    craftRules(),
    'Reescribe SOLO las escenas indicadas, conservando su id, su papel en la estructura y las reglas factuales (sin cifras nuevas).',
    'Si reescribes una escena, conserva las palabras que el montaje usa como disparador; si no puedes, el efecto se caerá solo.',
    'Devuelve JSON: { scenes: [{id, text}] } únicamente con las escenas reescritas.',
    'Sin exclamaciones.',
  ].join('\n');
}
