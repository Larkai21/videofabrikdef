/**
 * Fotogramas sueltos de las cuatro piezas del brand kit con la MARCA REAL del
 * canal (tokens, avatar, nombre y coletilla), a out/marca/.
 *
 *   pnpm --filter @fabrica/video preview:marca                      # sin avatar
 *   pnpm --filter @fabrica/video preview:marca demo/avatar.jpg      # con él
 *   pnpm --filter @fabrica/video preview:marca --video              # y los clips
 *   pnpm --filter @fabrica/video preview:marca --vertical           # el short
 *
 * Existe porque `render:smoke` usa el maestro de demo con la paleta por defecto:
 * comprueba que el montaje no se rompe, no que la marca se vea bien. Y una
 * decisión de diseño no se juzga leyendo el código, se juzga mirando el
 * fotograma.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { makeDemoMaster, makeDemoShort, type Edit, type MasterVideoJson } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(pkgDir, 'out', 'marca');

// Tokens medidos con cuentagotas sobre el avatar y la cabecera del canal.
const MARCA = {
  background: '#12151A',
  surface: '#1E232A',
  foreground: '#E8EDF2',
  muted: '#8E999F',
  accent: '#43D5E0',
  accent_fg: '#08181B',
  font_family: 'Inter',
} as const;

async function main(): Promise<void> {
  // el primer argumento que NO es una bandera es la ruta del avatar; sin este
  // filtro `--video` se colaba como ruta de imagen y el render moría pidiendo
  // http://localhost:3000/public/--video
  const avatar = process.argv.slice(2).find((a) => !a.startsWith('--'));
  mkdirSync(outDir, { recursive: true });
  await ensureBrowser();

  const master: MasterVideoJson = makeDemoMaster({
    audioPath: 'demo/silence.wav',
    clipPath: 'demo/clip-1.mp4',
    imagePath: 'demo/image.png',
  });
  master.brand = {
    channel_name: 'Kernel AI',
    tagline: 'Noticias de tecnología e IA',
    design: MARCA,
    ...(avatar ? { avatar_path: avatar } : {}),
    components: {
      subtitle_theme: 'subtitulos-basicos@0.1.0',
      intro: 'intro-basica@0.1.0',
      outro: 'outro-basica@0.1.0',
      title_card: 'titulo-seccion@0.1.0',
      lower_third: 'rotulo-basico@0.1.0',
    },
  };
  // una sección al principio del cuerpo fuerza la tarjeta y el rótulo
  master.segments = [{ title: 'Lo que ha pasado', beat_idx: 0, from_ms: 0 }];
  // y las tarjetas del catálogo, para verlas con la paleta del canal: son
  // «todos los motion graphics» y no valen de nada si solo se comprueba la intro
  master.edits = [
    { type: 'text_callout', from_ms: 1500, to_ms: 4000, text: 'pesos abiertos' },
    { type: 'stat_card', from_ms: 5000, to_ms: 7600, value: '70%', label: 'de los modelos' },
    { type: 'quote_card', from_ms: 8500, to_ms: 11500, text: 'Nadie audita lo que no se publica' },
    {
      type: 'split_versus',
      from_ms: 12500,
      to_ms: 15900,
      items: ['Pesos abiertos', 'API cerrada'],
    },
    {
      type: 'pasos_flow',
      from_ms: 16800,
      to_ms: 21000,
      items: ['Descarga', 'Ajusta', 'Mide', 'Publica'],
    },
    { type: 'tendencia', from_ms: 22000, to_ms: 25000, value: '3x', style: 'sube', label: 'uso' },
    { type: 'device_frame', from_ms: 26000, to_ms: 28600, style: 'browser', text: 'kernel.ai' },
    {
      type: 'barras',
      from_ms: 29600,
      to_ms: 33000,
      items: ['Entrenar', 'Inferir'],
      values: ['40 h', '3 h'],
      label: 'coste por corrida',
    },
    {
      type: 'linea_tiempo',
      from_ms: 33800,
      to_ms: 38000,
      hitos: [
        { fecha: 'julio', texto: 'Se filtra el modelo' },
        { fecha: 'agosto', texto: 'Réplicas abiertas' },
        { fecha: 'hoy', texto: 'Nadie paga API' },
      ],
    },
    {
      type: 'ciclo',
      from_ms: 38600,
      to_ms: 42800,
      items: ['Alerta', 'Contención', 'Aprendizaje'],
    },
  ];

  const serveUrl = await bundle({
    entryPoint: path.join(pkgDir, 'src', 'entry.ts'),
    webpackOverride,
  });
  const composition = await selectComposition({ serveUrl, id: 'LongForm', inputProps: master });

  // intro 0-95, cuerpo con tarjeta y rótulo, outro al final
  const total = composition.durationInFrames;
  const frames: [string, number][] = [
    ['intro-10', 10],
    ['intro-34', 34],
    ['intro-56', 56],
    ['intro-80', 80],
    ['cuerpo-tarjeta', 108],
    ['cuerpo-rotulo', 132],
    ['fx-callout', 96 + 75],
    ['fx-stat', 96 + 180],
    ['fx-quote', 96 + 285],
    ['fx-versus', 96 + 425],
    ['fx-pasos', 96 + 575],
    ['fx-tendencia', 96 + 690],
    ['fx-device', 96 + 810],
    ['fx-barras', 96 + 940],
    ['fx-linea-tiempo', 96 + 1075],
    ['fx-ciclo', 96 + 1220],
    ['outro-a', total - 90],
    ['outro-b', total - 40],
  ];
  for (const [nombre, frame] of frames) {
    if (frame < 0 || frame >= total) continue;
    await renderStill({
      composition,
      serveUrl,
      output: path.join(outDir, `${nombre}.png`),
      frame,
      inputProps: master,
      overwrite: true,
    });
    console.log(`  ${nombre} (frame ${frame})`);
  }

  // Los clips: una intro se juzga por cómo se MUEVE, y un fotograma no dice si
  // el entramado se dibuja o simplemente aparece.
  if (process.argv.includes('--video')) {
    const clips: [string, number, number][] = [
      ['intro', 0, 95],
      ['tarjetas', 96 + 40, 96 + 900],
      ['outro', Math.max(0, total - 120), total - 1],
    ];
    for (const [nombre, desde, hasta] of clips) {
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: path.join(outDir, `${nombre}.mp4`),
        frameRange: [desde, Math.min(hasta, total - 1)],
        inputProps: master,
        overwrite: true,
      });
      console.log(`  ${nombre}.mp4 (frames ${desde}-${hasta})`);
    }
  }

  // El lienzo VERTICAL. La gramática del short —cuerpo de subtítulo, cartela,
  // recorte con foco— no se puede juzgar en 16:9, y una decisión de diseño se
  // juzga mirando el fotograma.
  if (process.argv.includes('--vertical')) {
    const short = makeDemoShort({
      audioPath: 'demo/silence.wav',
      clipPath: 'demo/clip-1.mp4',
      imagePath: 'demo/image.png',
    });
    short.brand = { ...short.brand, channel_name: 'Kernel AI', design: MARCA };
    const shortComposition = await selectComposition({
      serveUrl,
      id: 'ShortForm',
      inputProps: short,
    });
    const totalShort = shortComposition.durationInFrames;
    const framesShort: [string, number][] = [
      ['short-cartela', 20],
      ['short-cartela-fin', 90],
      ['short-cuerpo', Math.round(totalShort * 0.35)],
      ['short-cuerpo-b', Math.round(totalShort * 0.6)],
      ['short-final', Math.max(0, totalShort - 20)],
    ];
    for (const [nombre, frame] of framesShort) {
      if (frame < 0 || frame >= totalShort) continue;
      await renderStill({
        composition: shortComposition,
        serveUrl,
        output: path.join(outDir, `${nombre}.png`),
        frame,
        inputProps: short,
        overwrite: true,
      });
      console.log(`  ${nombre} (frame ${frame})`);
    }
    if (process.argv.includes('--video')) {
      await renderMedia({
        composition: shortComposition,
        serveUrl,
        codec: 'h264',
        outputLocation: path.join(outDir, 'short.mp4'),
        frameRange: [0, Math.min(150, totalShort - 1)],
        inputProps: short,
        overwrite: true,
      });
      console.log('  short.mp4 (frames 0-150)');
    }

    // Banco de legibilidad a 1080 de ancho: un still de CADA forma del
    // catálogo permitida en vertical, cada una sola en su pieza para que no se
    // pisen. Existe desde que el callout «Qué es real» salió a 26 px efectivos
    // en el primer short renderizado (commit 3efcb57): aquel commit verificó a
    // 1080 solo las piezas que tocó, y las demás nunca tuvieron hoja. Quedan
    // fuera sfx (no dibuja), zoom_punch (mueve la cámara, no pone texto) y
    // keyword_highlight (tiñe una palabra del subtítulo, cuyo cuerpo ya
    // gobierna cuerpoDeGrupo con sus propios tests).
    const VENTANA_FX: [number, number] = [2_000, 5_000];
    const FX_BANCO: Edit[] = [
      { type: 'text_callout', from_ms: VENTANA_FX[0], to_ms: VENTANA_FX[1], text: 'Qué es real' },
      {
        type: 'quote_card',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        text: 'La cita entera que alguien dijo y que hay que poder leer',
      },
      { type: 'kinetic_text', from_ms: VENTANA_FX[0], to_ms: VENTANA_FX[1], text: 'Sin trucos' },
      {
        type: 'stat_card',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        value: '1.000.000',
        label: 'tokens por dólar',
      },
      {
        type: 'stat_odometer',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        value: '42.500',
        label: 'GPU en el clúster',
      },
      {
        type: 'split_versus',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        items: ['Entrenar', 'Inferir'],
      },
      {
        type: 'pasos_flow',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        items: ['Datos', 'Modelo', 'Despliegue'],
      },
      {
        type: 'tendencia',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        value: '−72 %',
        style: 'baja',
        label: 'coste por token',
      },
      {
        type: 'barras',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        items: ['Parchear', 'Explotar'],
        values: ['504 h', '2 h'],
        label: 'ventana real',
      },
      {
        type: 'linea_tiempo',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        hitos: [
          { fecha: 'julio', texto: 'Se filtra el modelo' },
          { fecha: 'agosto', texto: 'Réplicas abiertas' },
          { fecha: 'hoy', texto: 'Nadie paga API' },
        ],
      },
      {
        type: 'ciclo',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        items: ['Alerta', 'Contención', 'Aprendizaje'],
      },
      { type: 'annotation', from_ms: VENTANA_FX[0], to_ms: VENTANA_FX[1], style: 'circulo' },
      { type: 'micro_fx', from_ms: VENTANA_FX[0], to_ms: VENTANA_FX[1], style: 'tachado' },
      // las tres piezas de palabra vertical (solo existen en 9:16)
      {
        type: 'annotation',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        style: 'sello',
        text: 'prohibido',
      },
      {
        type: 'annotation',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        style: 'aviso',
        text: 'suscriptores',
      },
      {
        type: 'annotation',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        style: 'apilado',
        text: 'importante',
      },
      {
        type: 'annotation',
        from_ms: VENTANA_FX[0],
        to_ms: VENTANA_FX[1],
        style: 'emoji',
        text: 'cohete',
      },
    ];
    // OJO: renderStill usa las props RESUELTAS por selectComposition, no las
    // que se le pasen a él — cada variante necesita su propia selección (se
    // descubrió mirando la hoja: todos los stills salían sin su efecto)
    const frameFx = Math.round(((VENTANA_FX[0] + VENTANA_FX[1]) / 2 / 1000) * shortComposition.fps);
    for (const edit of FX_BANCO) {
      const conFx = { ...short, edits: [edit] };
      const comp = await selectComposition({ serveUrl, id: 'ShortForm', inputProps: conFx });
      // el estilo distingue las variantes del mismo tipo (annotation ×4)
      const nombre =
        'style' in edit && typeof edit.style === 'string'
          ? `${edit.type}-${edit.style}`
          : edit.type;
      await renderStill({
        composition: comp,
        serveUrl,
        output: path.join(outDir, `short-fx-${nombre}.png`),
        frame: Math.min(frameFx, comp.durationInFrames - 1),
        inputProps: conFx,
        overwrite: true,
      });
      console.log(`  short-fx-${nombre} (frame ${frameFx})`);
    }
    // y la cartela al máximo del contrato (60 caracteres): el auto-ajuste debe
    // bajar el cuerpo y contenerla en dos líneas dentro de su banda
    const conTituloLargo = {
      ...short,
      short: {
        ...short.short,
        title: 'La cifra que nadie esperaba y que cambia el precio de todo',
      },
    };
    const compTitulo = await selectComposition({
      serveUrl,
      id: 'ShortForm',
      inputProps: conTituloLargo,
    });
    await renderStill({
      composition: compTitulo,
      serveUrl,
      output: path.join(outDir, 'short-cartela-60.png'),
      frame: 45,
      inputProps: conTituloLargo,
      overwrite: true,
    });
    console.log('  short-cartela-60 (frame 45)');
  }

  console.log(`Marca en ${outDir}`);
}

await main();
