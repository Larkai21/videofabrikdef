import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_NAMES, type SfxName } from '@fabrica/shared';

// Biblioteca de efectos de sonido SINTETIZADA en packages/video/public/sfx/.
// Nada se descarga: todo sale de expresiones `aevalsrc` de ffmpeg, así que no
// hay licencias que respetar ni binarios que falten al clonar. Los .wav se
// commitean y el render los carga por convención: staticFile('sfx/<nombre>.wav').
//
// Portado de editor-youtube/scripts/hacer_sfx.py.
//
// Cómo se construye cada golpe:
//
//   · La ALTURA baja con el tiempo. Un impacto real no tiene tono fijo: la
//     membrana se tensa y se relaja. Para una frecuencia f(t) = f0 - k·t la fase
//     es la INTEGRAL, 2π(f0·t - k·t²/2). Usar 2π·f(t)·t da un barrido del doble
//     de pendiente y suena a dibujos animados.
//   · La ENVOLVENTE es exponencial decreciente. Una lineal suena sintética.
//   · El TRANSITORIO (los primeros milisegundos de ruido) es lo que hace que un
//     golpe se perciba fuerte sin subir el volumen.
//
//   pnpm sfx

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(pkgDir, 'public', 'sfx');
const SR = 44_100;
const GANANCIA = 0.85;

/** Fase de un barrido lineal de f0 a f1 en `dur` segundos. */
function barridoFase(f0: number, f1: number, dur: number): string {
  const k = (f0 - f1) / dur;
  return `2*PI*(${f0.toFixed(4)}*t-${(k / 2).toFixed(4)}*t*t)`;
}

/** Una pulsación de tecla desplazada a `t0`, para montar una ráfaga. */
function tecla(t0: number): string {
  const d = t0 === 0 ? 't' : `(t-${t0.toFixed(3)})`;
  const puerta = t0 === 0 ? '' : `gt(t,${t0.toFixed(3)})*`;
  return (
    `${puerta}(0.50*exp(-260*${d})*random(0)` +
    ` + 0.28*exp(-200*${d})*sin(2*PI*640*${d})` +
    ` + 0.16*exp(-240*${d})*sin(2*PI*1450*${d}))`
  );
}

interface Efecto {
  /** expresión para aevalsrc */
  readonly expr: string;
  readonly durS: number;
  /** cadena de filtros, sin el volume ni el limitador finales */
  readonly filtros: string;
  /** para qué sirve; se documenta en docs/edicion.md */
  readonly desc: string;
}

// Record<SfxName, …>: el compilador exige que TODO nombre del enum tenga receta.
// Añadir a SFX_NAMES sin definirla aquí no compila.
const EFECTOS: Record<SfxName, Efecto> = {
  // Barrido de ruido filtrado que sube, con cola de aire. Marca el cambio de
  // sección: es el único sonido que significa «cambiamos de tema».
  whoosh: {
    expr: `0.5*(exp(-2.2*t)*random(0)) + 0.22*exp(-3.5*t)*sin(${barridoFase(300, 2400, 0.6)})`,
    durS: 0.6,
    filtros: 'highpass=f=320,lowpass=f=9000,afade=t=in:d=0.06,afade=t=out:st=0.42:d=0.18',
    desc: 'cambio de sección',
  },

  // Un «pop» es un tono que SUBE mientras se apaga: la burbuja se abre. Con
  // frecuencia fija suena a bloque de madera, no a burbuja.
  pop: {
    expr: `0.55*exp(-38*t)*sin(${barridoFase(420, 1150, 0.13)}) + 0.14*exp(-120*t)*random(0)`,
    durS: 0.16,
    filtros: 'highpass=f=240,lowpass=f=7000',
    desc: 'entrada de tarjeta o etiqueta',
  },

  // Tensión que sube antes del cuerpo. La amplitud crece con una potencia > 1
  // para que la última mitad concentre casi todo el empuje; una rampa lineal se
  // percibe plana y llega tarde.
  riser: {
    expr:
      `0.5*pow(t/1.0,2.3)*random(0)` +
      ` + 0.26*pow(t/1.0,2.0)*sin(${barridoFase(180, 1500, 1.0)})`,
    durS: 1.0,
    filtros: 'highpass=f=170,lowpass=f=11000,afade=t=in:d=0.15,afade=t=out:st=0.94:d=0.06',
    desc: 'arranque del cuerpo, sobre el gancho',
  },

  // Quinta justa (880 → 1320 Hz, razón 3:2). Un intervalo consonante suena a
  // «hecho»; uno disonante, a error. Por eso marca la cifra.
  ding: {
    expr: '0.42*exp(-9*t)*(sin(2*PI*880*t) + 0.5*sin(2*PI*1320*t)) + 0.10*exp(-70*t)*random(0)',
    durS: 0.45,
    filtros: 'highpass=f=400,lowpass=f=12000,afade=t=out:st=0.32:d=0.13',
    desc: 'cifra destacada',
  },

  // Cuerpo grave que cae + chasquido de ataque. Aterriza el gancho tras el riser.
  impacto: {
    expr: `0.86*exp(-13*t)*sin(${barridoFase(190, 42, 0.5)}) + 0.30*exp(-70*t)*random(0)`,
    durS: 0.5,
    filtros:
      'highpass=f=28,lowpass=f=7000,acompressor=threshold=0.35:ratio=4:attack=1:release=90',
    desc: 'aterrizaje del gancho',
  },

  // Contacto eléctrico: breve y agudo.
  clic: {
    expr: '0.55*exp(-150*t)*random(0) + 0.35*exp(-90*t)*sin(2*PI*1750*t)',
    durS: 0.09,
    filtros: 'highpass=f=800,lowpass=f=11000',
    desc: 'acento de tachado o candado',
  },

  // Trinquete de un tambor que encaja. Más corto y más grave que `clic`: dos
  // parciales inarmónicos, porque una madera golpeada no da un tono puro.
  tic: {
    expr:
      '0.45*exp(-190*t)*random(0)' +
      ' + 0.40*exp(-110*t)*sin(2*PI*1180*t)' +
      ' + 0.22*exp(-150*t)*sin(2*PI*1970*t)',
    durS: 0.055,
    filtros: 'highpass=f=420,lowpass=f=9000',
    desc: 'acento de foco o cronómetro',
  },

  // Ráfaga de seis pulsaciones. El original del hermano es UNA tecla de 45 ms,
  // inaudible como acento de entrada; aquí acompaña a la URL que se teclea en el
  // marco de navegador, así que tiene que durar lo que dura el tecleo.
  // Una tecla es masa golpeando un tope, no un contacto: cae en 8 ms.
  tecleo: {
    expr: [0, 0.13, 0.26, 0.39, 0.52, 0.65].map(tecla).join(' + '),
    durS: 0.8,
    filtros: 'highpass=f=200,lowpass=f=6500,afade=t=out:st=0.7:d=0.1',
    desc: 'marco de navegador con texto tecleándose',
  },

  // Aire corto y filtrado: una tarjeta que entra de lado, sin el golpe de
  // `impacto` ni el barrido largo de `whoosh`.
  // La amplitud de origen es alta (0,95) porque el paso de banda 700-7000 Hz se
  // come casi toda la energía del ruido: con la 0,34 del original salía a −25 dB
  // de pico, once por debajo del resto del pack, e inaudible bajo la voz.
  deslizar: {
    expr: '0.95*exp(-9*t)*random(0)',
    durS: 0.32,
    filtros: 'highpass=f=700,lowpass=f=7000,afade=t=in:d=0.05,afade=t=out:st=0.16:d=0.16',
    desc: 'entrada de la tarjeta de cita',
  },

  // Chispa corta y brillante para el flash de acento.
  destello: {
    expr: '0.5*exp(-40*t)*random(0) + 0.4*exp(-24*t)*sin(2*PI*2600*t)',
    durS: 0.22,
    filtros: 'highpass=f=1200,lowpass=f=13000,afade=t=out:st=0.12:d=0.1',
    desc: 'remate de la tipografía cinética',
  },

  // Presión grave, casi sin tono audible: se siente más que se oye.
  subgrave: {
    expr: `0.9*exp(-4.2*t)*sin(${barridoFase(72, 28, 1.2)})`,
    durS: 1.2,
    filtros: 'lowpass=f=180,afade=t=out:st=0.85:d=0.35',
    desc: 'acento de desplome',
  },

  // Tono ascendente muy suave, sin ataque: algo que aparece sin golpear.
  aparicion: {
    expr:
      `0.42*(1-exp(-26*t))*exp(-4.5*t)*(sin(${barridoFase(420, 900, 0.45)})` +
      `+0.35*sin(2*${barridoFase(420, 900, 0.45)}))`,
    durS: 0.45,
    filtros: 'highpass=f=200,lowpass=f=6500,afade=t=out:st=0.3:d=0.15',
    desc: 'acento de crecimiento',
  },

  // Dos tonos MUY juntos en el tiempo y separados en altura: es la firma de un
  // aviso. Si se separan más de ~85 ms, deja de leerse como uno solo.
  notificacion: {
    expr:
      '0.34*exp(-13*t)*sin(2*PI*1568*t)' +
      ' + 0.32*gt(t,0.085)*exp(-11*(t-0.085))*sin(2*PI*2093*(t-0.085))' +
      ' + 0.10*exp(-60*t)*random(0)',
    durS: 0.42,
    filtros: 'highpass=f=600,lowpass=f=11000,afade=t=out:st=0.3:d=0.12',
    desc: 'acento de confirmación',
  },

  // Acorde mayor grave que se abre y se sostiene. Cierra la pieza: da la
  // sensación de final que un fundido por sí solo no da.
  resolucion: {
    expr:
      '0.30*(1-exp(-14*t))*exp(-2.1*t)*(' +
      'sin(2*PI*130.8*t) + 0.7*sin(2*PI*196*t)' +
      ' + 0.5*sin(2*PI*261.6*t) + 0.3*sin(2*PI*392*t))',
    durS: 1.6,
    filtros: 'highpass=f=70,lowpass=f=4200,afade=t=out:st=1.1:d=0.5',
    desc: 'cierre del último beat',
  },
};

function generar(nombre: SfxName): boolean {
  const { expr, durS, filtros } = EFECTOS[nombre];
  // alimiter evita que un pico se pase de 0 dBFS: en Remotion dos SFX solapados
  // se suman y sin él pueden saturar
  const cadena = `${filtros},volume=${GANANCIA.toFixed(3)},alimiter=limit=0.94:level=false`;
  try {
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `aevalsrc='${expr}':s=${SR}:d=${durS.toFixed(3)}`,
        '-af',
        cadena,
        '-ar',
        String(SR),
        '-ac',
        '2',
        path.join(outDir, `${nombre}.wav`),
      ],
      { stdio: 'inherit' },
    );
    return true;
  } catch {
    console.error(`ffmpeg falló para ${nombre}`);
    return false;
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const ok = SFX_NAMES.filter((n) => generar(n));
  console.log(
    JSON.stringify({ ok: ok.length === SFX_NAMES.length, dir: outDir, files: ok.length }),
  );
  if (ok.length !== SFX_NAMES.length) process.exitCode = 1;
}

main();
