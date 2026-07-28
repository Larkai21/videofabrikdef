import type { ChannelProfile, Research, Scene } from '@fabrica/shared';
import type { ResearchDoc } from './research.js';

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

export function scriptSystem(profile: ChannelProfile, targetWords: number): string {
  const patterns = profile.title_patterns
    .map((p) => `«${p.template}» (ej.: ${p.example})`)
    .join(' · ');
  return [
    'Eres el guionista del canal.',
    renderProfile(profile),
    'Reglas factuales: el guion NO puede introducir cifras ni afirmaciones fuertes que no estén en research.claims; si falta un dato, formúlalo sin cifra o omítelo.',
    `Duración: ~${targetWords} palabras en total (tolerancia ±10%). Escenas de 40-70 palabras.`,
    'Estructura: 1 escena hook, varias body, 1 cta. Ids estables tipo sc-hook, sc-body-1, sc-cta.',
    // oficio de guion: ritmo y sustantivos visuales concretos (el b-roll se
    // ancla a esas palabras). La puntuación gobierna las pausas del TTS.
    'Ritmo: alterna frases cortas y medias; evita frases largas encadenadas. Puntuación limpia (puntos y comas) para marcar respiraciones naturales; una idea por frase.',
    'El hook (primera escena) abre con un gancho concreto en la primera frase, sin rodeos.',
    'Anclaje visual: nombra sustantivos CONCRETOS y filmables cuando cambies de sujeto (p. ej. "una biblioteca", "una nave industrial", "un centro de datos"), para que el b-roll pueda ilustrar cada idea; evita abstracciones ("la confianza", "el impacto") como único apoyo visual de una frase.',
    `visual_query: 3-8 palabras concretas y filmables, en ${profile.style.stock_query_lang === 'en' ? 'inglés' : 'español'} (p. ej. "server room aisle cold blue lights").`,
    'emphasis: pon emphasis=true en las 2-4 escenas MÁS importantes (giro, dato clave, conclusión); el editor las realza con un zoom. No abuses: la mayoría de escenas van sin emphasis.',
    'Salida JSON: { script: { scenes: [{id, section: hook|body|cta, text, visual_query, emphasis?}], hook_notes }, seo: { titles, description, tags, thumbnails } }.',
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
    `Research pack: ${JSON.stringify({ summary: opts.research.summary, claims: opts.research.claims, angles: opts.research.angles })}`,
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

export function judgeSystem(): string {
  return [
    'Eres el juez de alineación de un canal de YouTube.',
    'Compara la promesa del título elegido con el gancho y el cierre del guion.',
    'Devuelve JSON: { verdict: "aligned" | "misaligned", reasons: [frases cortas], patch_targets: [ids de escenas a retocar] }.',
    'Marca misaligned solo si la promesa del título no se paga; no seas quisquilloso con matices de estilo.',
  ].join('\n');
}

export function judgeUser(opts: {
  title: string;
  hook: string;
  closing: string;
  hookNotes: string;
}): string {
  return [
    `Título elegido: ${opts.title}`,
    `Gancho (hook): ${opts.hook}`,
    `Cierre: ${opts.closing}`,
    `Notas del gancho: ${opts.hookNotes}`,
  ].join('\n');
}

export function refineSystem(profile: ChannelProfile): string {
  return [
    'Eres el guionista del canal en una pasada de refinamiento dirigido.',
    renderProfile(profile),
    'Reescribe SOLO las escenas indicadas, conservando su id, su papel en la estructura y las reglas factuales (sin cifras nuevas).',
    'Devuelve JSON: { scenes: [{id, text}] } únicamente con las escenas reescritas.',
    'Sin exclamaciones.',
  ].join('\n');
}
