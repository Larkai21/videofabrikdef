import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  defaultDesign,
  formatCifra,
  hexToRgba,
  tokenCifra,
  type DesignTokens,
} from '@fabrica/shared';
import { displayText, FONT_FAMILY } from '../fonts';
import { useLienzo } from '../lienzo';
import { isRenderableSrc, toSrc } from '../media-src';
import { hashSeed } from '../seed';
import { clamp, Ease, mix, noise, pulse, span, typed } from './motion';
import { familias, R, S, SENAL, T } from './tokens';

// Biblioteca de efectos de edición: overlays deterministas que el director de
// edición coloca en la línea de tiempo para que el vídeo se sienta editado. Cada
// uno se monta como <Sequence> propia en LongForm, así useCurrentFrame arranca en
// 0 al inicio del efecto. Solo useCurrentFrame + el kit de movimiento (matemática
// pura con easing), sin spring/red — mismo movimiento "editado" que editor-youtube.

// enter/exit estándar relativo a la Sequence del efecto. `opacity`: fade-in
// suave (outExpo) + fade-out al final. `enter`: 0..1 suave para desplazamientos.
// `pop`: entrada con overshoot (outBack, puede pasar de 1) para escalas con rebote.
function useInOut(opts?: { enterFrames?: number; exitFrames?: number }): {
  opacity: number;
  enter: number;
  pop: number;
} {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enterFrames = opts?.enterFrames ?? 10;
  const exitFrames = opts?.exitFrames ?? 8;
  const fadeIn = span(frame, 0, enterFrames, Ease.outExpo);
  const fadeOut = 1 - span(frame, durationInFrames - exitFrames, exitFrames, Ease.outCubic);
  return {
    opacity: Math.min(clamp(fadeIn, 0, 1), fadeOut),
    enter: clamp(fadeIn, 0, 1),
    pop: span(frame, 0, enterFrames, Ease.outBack),
  };
}

// Superficie "liquid glass" compartida por las tarjetas: blur, borde sutil (o de
// acento) y un brillo interior en el canto superior que da el look de cristal.
/**
 * Banda de oscurecimiento detrás de un overlay que pinta trazo o glifo DESNUDO.
 *
 * Las tarjetas (callout, stat, quote, device) llevan `glassSurface`, que ya es
 * una superficie opaca, y se leen sobre cualquier fondo. Los que no la llevan
 * dependían de lo que hubiera detrás: medido sobre un vídeo real, el texto
 * cinético del gancho —el efecto más importante del vídeo, sus tres primeros
 * segundos— salía en azul de acento sobre una captura de pantalla BLANCA, a
 * ~1,5:1 de contraste. Ilegible.
 *
 * El render no puede mirar el fotograma (principio 6: sin fetch ni análisis en
 * tiempo de render), así que la solución no es adivinar el fondo sino dejar de
 * depender de él: un degradado vertical suave garantiza el contraste sin tapar
 * el b-roll, que es lo que hace cualquier cadena de televisión.
 */
export function scrim(d: DesignTokens, opts?: { fuerza?: number }): React.CSSProperties {
  const f = opts?.fuerza ?? 0.84;
  return {
    background: `linear-gradient(180deg, ${hexToRgba(d.background, 0)} 0%, ${hexToRgba(
      d.background,
      f,
    )} 38%, ${hexToRgba(d.background, f)} 62%, ${hexToRgba(d.background, 0)} 100%)`,
    // El degradado solo se apagaba arriba y abajo, así que a los lados dejaba
    // un CANTO RECTO: sobre el b-roll se veía un rectángulo oscuro pegado
    // detrás de la cifra en vez de una sombra. Se nota más cuanto más brillante
    // es el texto, y con el acento del canal se ve a la primera.
    maskImage: 'linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
    WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
  };
}

/**
 * La superficie de TODAS las tarjetas del vídeo: cristal oscuro sobre el
 * b-roll, con un chaflán en la esquina inferior derecha.
 *
 * El chaflán no es decoración: es la celda hexagonal del entramado de la marca
 * reducida a la marca más pequeña que cabe en una tarjeta de cuatro palabras.
 * Está aquí y no en cada tarjeta porque, si vive en cada una, a la segunda
 * revisión dejan de parecer del mismo canal.
 */
export function glassSurface(d: DesignTokens, opts?: { accent?: boolean }): React.CSSProperties {
  return {
    background: hexToRgba(d.background, 0.7),
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${opts?.accent ? hexToRgba(d.accent, 0.55) : hexToRgba(d.foreground, 0.16)}`,
    boxShadow: `0 24px 64px ${hexToRgba('#000000', 0.5)}, inset 0 1px 0 ${hexToRgba('#ffffff', 0.16)}`,
    maskImage: 'linear-gradient(315deg, transparent 0 18px, #000 18px)',
    WebkitMaskImage: 'linear-gradient(315deg, transparent 0 18px, #000 18px)',
  };
}

// Rótulo/callout que entra con pop en la banda superior (no choca con los
// subtítulos, anclados abajo). Para resaltar un término o una idea.
export const TextCallout: React.FC<{ text: string; design?: DesignTokens }> = ({
  text,
  design,
}) => {
  const d = design ?? defaultDesign();
  const lienzo = useLienzo();
  const { opacity, pop } = useInOut();
  if (text.trim() === '') return null;
  // en vertical un marginTop fijo caería dentro de la banda que tapa la
  // interfaz de la plataforma; el sitio es la cartela, que el lienzo ya sitúa
  const arriba = lienzo.vertical ? lienzo.zonas.cartela[1] + 20 : 130;
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'flex-start',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          marginTop: arriba,
          opacity,
          transform: `scale(${0.85 + 0.15 * pop})`,
          ...displayText(800),
          ...glassSurface(d, { accent: true }),
          color: d.foreground,
          fontSize: 46,
          padding: '12px 28px',
          borderRadius: 14,
          maxWidth: 1400,
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// Tarjeta de dato: cifra grande con count-up determinista + etiqueta. `value`
// puede traer sufijo/prefijo (p. ej. "70%", "$1.2B"); se anima la parte numérica.
export const StatCard: React.FC<{ value: string; label?: string; design?: DesignTokens }> = ({
  value,
  label,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { opacity, enter } = useInOut();
  // parte numérica para el count-up; el resto (símbolos) se conserva. El conteo
  // corre sobre el primer ~55% del efecto con outExpo (rápido y luego frena),
  // más satisfactorio que el spring anterior. El formato sale del formateador
  // compartido: la misma convención que el odómetro y que el informe audita
  // («17000» se pinta «17.000» en cada paso del conteo, no solo al final).
  const token = tokenCifra(value);
  let display = value;
  if (token) {
    const countFrames = Math.max(1, Math.round(durationInFrames * 0.55));
    const p = span(frame, 0, countFrames, Ease.outExpo);
    display = value.replace(token.raw, formatCifra(token.target * p, token));
  }
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - enter) * 20}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          ...glassSurface(d, { accent: true }),
          padding: '24px 46px',
          borderRadius: 20,
        }}
      >
        <div
          style={{
            ...displayText(800),
            fontSize: 130,
            lineHeight: 1,
            color: d.accent,
            letterSpacing: '-0.03em',
          }}
        >
          {display}
        </div>
        {label !== undefined && label.trim() !== '' ? (
          <div style={{ fontSize: 30, fontWeight: 500, color: d.foreground }}>{label}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// Tarjeta de cita centrada, con comillas de acento sobre un scrim.
export const QuoteCard: React.FC<{ text: string; design?: DesignTokens }> = ({ text, design }) => {
  const d = design ?? defaultDesign();
  const { opacity, pop } = useInOut();
  if (text.trim() === '') return null;
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          opacity,
          transform: `scale(${0.94 + 0.06 * pop})`,
          maxWidth: 1300,
          padding: '40px 60px',
          borderRadius: 20,
          ...glassSurface(d),
          borderLeft: `6px solid ${d.accent}`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 90, lineHeight: 0.6, color: d.accent, fontWeight: 800 }}>
          &ldquo;
        </div>
        <div style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.25, color: d.foreground }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Los 4 gestos de entrada de la tipografía cinética (adaptados de
// editor-youtube kinetic-type.html:78-87). `e` es el progreso de entrada 0..1;
// devuelven escala/desplazamiento/rotación/opacidad de la palabra.
const GESTOS: Array<(e: number) => { s: number; x: number; y: number; r: number; o: number }> = [
  // aterrizaje desde muy grande
  (e) => ({ s: 2.6 - 1.6 * e, x: 0, y: 0, r: 0, o: e }),
  // entra desde el lateral con rotación
  (e) => ({ s: 0.86 + 0.14 * e, x: (1 - e) * 620, y: 0, r: (1 - e) * 9, o: e }),
  // sube desde abajo, sobrepasando
  (e) => ({ s: 0.92 + 0.08 * e, x: 0, y: (1 - e) * 380, r: 0, o: e }),
  // crece desde cero con giro corto
  (e) => ({ s: e * 1.04, x: 0, y: 0, r: (1 - e) * -7, o: e }),
];

// Tipografía cinética: la frase se muestra palabra a palabra, en grande y
// centrada, cada una con un gesto de entrada distinto (rotan por índice, con
// desempate determinista por hashSeed). Para el gancho. Adaptado de
// editor-youtube kinetic-type.html:134-157. Solo useCurrentFrame + kit → puro.
export const KineticText: React.FC<{ text: string; seed?: number; design?: DesignTokens }> = ({
  text,
  seed = 0,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const lienzo = useLienzo();
  const { durationInFrames, fps } = useVideoConfig();
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  // fade global de cierre en los últimos ~0.35 s
  const closeF = Math.min(Math.round(0.35 * fps), Math.round(durationInFrames * 0.2));
  const cierre = 1 - span(frame, durationInFrames - closeF, closeF, Ease.outCubic);
  // cada palabra ocupa un tramo; se solapan un poco para que fluya
  const step = (durationInFrames - closeF) / words.length;
  // flash de acento breve al aparecer la palabra-remate (sutil)
  const lastAt = (words.length - 1) * step;
  const flash = pulse(frame, lastAt - 2, lastAt + 10, 3, 6, Ease.outCubic) * 0.16;

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      {flash > 0.001 ? <AbsoluteFill style={{ background: d.accent, opacity: flash }} /> : null}
      {/* banda de contraste: sin ella el gancho depende de que el b-roll sea
          oscuro, y sobre una captura blanca no se lee nada */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 420,
          transform: 'translateY(-50%)',
          opacity: cierre,
          ...scrim(d),
        }}
      />
      <div style={{ position: 'relative', width: '100%', height: 320 }}>
        {words.map((w, i) => {
          const at = i * step;
          const dur = step * 1.3;
          const e = span(frame, at, dur * 0.25, Ease.outExpo);
          const sale = span(frame, at + dur * 0.82, dur * 0.18, Ease.outCubic);
          const g = GESTOS[hashSeed(`${seed}:${i}`) % GESTOS.length]!(e);
          const drift = Math.sin(((frame - at) / fps) * 2.2) * 5;
          const y = g.y + drift - sale * 90;
          const visible = frame >= at && frame < at + dur;
          // la última palabra es el remate → acento; el resto rota estilo
          // (normal/bloque/contorno) de forma determinista para dar variedad
          const isLast = i === words.length - 1;
          // 1500 era el 78 % de 1920: la palabra ocupa esa parte del ancho.
          // Cableado, en 1080 daba palabras que se salían por los lados.
          const size = clamp((lienzo.ancho * 0.78) / Math.max(3, w.length), 90, 220);
          const variant = isLast
            ? 'acento'
            : // «contorno» (color transparente + trazo de 3 px del acento) era
              // invisible sobre cualquier fondo con textura: fuera del reparto
              (['normal', 'bloque'] as const)[hashSeed(`${seed}:st:${i}`) % 2]!;
          const variantStyle: React.CSSProperties =
            variant === 'bloque'
              ? { color: d.background, background: d.accent, padding: '0 24px', borderRadius: 14 }
              : variant === 'acento'
                ? { color: d.accent }
                : { color: d.foreground };
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                opacity: visible ? g.o * (1 - sale) * cierre : 0,
                transform: `translate(-50%, -50%) translate(${g.x}px, ${y}px) scale(${g.s * (1 - sale * 0.12)}) rotate(${g.r}deg)`,
                ...displayText(900),
                fontSize: size,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                // el contorno oscuro asegura el canto de la letra aunque el
                // scrim no baste; la sombra sola no define bordes
                WebkitTextStroke: `2px ${hexToRgba(d.background, 0.85)}`,
                paintOrder: 'stroke fill',
                textShadow: `0 8px 30px ${hexToRgba('#000000', 0.55)}`,
                ...variantStyle,
              }}
            >
              {w}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Count-up de rodillo mecánico: cada dígito es una columna continua que rueda;
// la `rigidez` concentra el giro en el tramo final para que el acarreo se sienta
// mecánico (adaptado de editor-youtube odometro.html:210-241). Para cifras.
export const StatOdometer: React.FC<{ value: string; label?: string; design?: DesignTokens }> = ({
  value,
  label,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { opacity, enter } = useInOut();

  // el MISMO tokenizador que StatCard y que el aviso del informe: lo que el
  // rodillo aterriza tiene que coincidir con displayCifra(value). Decimales y
  // negativos no van en columnas de dígitos — pickStatType ya los desvía a la
  // tarjeta, y si un maestro viejo los cuela, el rodillo degrada a pintar el
  // display estático en vez de columnas en blanco o un «-3» contando a 3.
  const token = tokenCifra(value);
  const raw = token?.raw ?? '';
  const idx = raw !== '' ? value.indexOf(raw) : 0;
  const prefix = raw !== '' ? value.slice(0, idx) : value;
  const suffix = raw !== '' ? value.slice(idx + raw.length) : '';
  const target = token !== null ? Math.round(token.target) : Number.NaN;
  const valid = token !== null && token.decimales === 0 && target >= 0 && Number.isFinite(target);

  // El conteo va con outExpo, no con outCubic: arranca rápido y frena al final.
  // Es la nota literal de `hero-stat.html` en el catálogo de motion graphics —
  // «un contador lineal parece un cronómetro; este parece que aterriza en la
  // cifra»— y aquí estaba con outCubic, que frena menos y se queda a medias.
  const startF = Math.round(durationInFrames * 0.12);
  const countF = Math.max(1, Math.round(durationInFrames * 0.5));
  const p = span(frame, startF, countF, Ease.outExpo);
  // 0,85 de la subida: la etiqueta espera a que la cifra aterrice
  const etiqueta = span(frame, startF + countF * 0.85, Math.max(1, countF * 0.35), Ease.outCubic);
  const current = valid ? target * p : 0;
  const numDigits = valid ? Math.max(1, String(target).length) : 0;
  const RIGIDEZ = 0.7;

  const columns: React.ReactNode[] = [];
  for (let peso = numDigits - 1; peso >= 0; peso--) {
    const pos = (current / Math.pow(10, peso)) % 10;
    const dg = Math.floor(pos);
    const u = clamp((pos - dg - RIGIDEZ) / (1 - RIGIDEZ), 0, 1);
    const ty = -(dg + Ease.inOutCubic(u));
    columns.push(
      <div key={`c${peso}`} style={{ height: '1em', width: '0.62em', overflow: 'hidden' }}>
        <div style={{ transform: `translateY(${ty}em)` }}>
          {Array.from({ length: 11 }, (_, n) => (
            <div key={n} style={{ height: '1em', lineHeight: '1em', textAlign: 'center' }}>
              {n % 10}
            </div>
          ))}
        </div>
      </div>,
    );
    // separador de millar
    if (peso > 0 && peso % 3 === 0) {
      columns.push(
        <div key={`s${peso}`} style={{ width: '0.24em', textAlign: 'center' }}>
          .
        </div>,
      );
    }
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - enter) * 20}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          ...glassSurface(d, { accent: true }),
          padding: '24px 46px',
          borderRadius: 20,
        }}
      >
        <div
          style={{
            ...displayText(800),
            fontSize: 130,
            lineHeight: 1,
            color: d.accent,
            letterSpacing: '-0.03em',
            display: 'flex',
            alignItems: 'baseline',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {prefix ? <span>{prefix}</span> : null}
          {valid ? (
            <div style={{ display: 'flex', height: '1em', alignItems: 'flex-start' }}>
              {columns}
            </div>
          ) : (
            // sin rodillo posible: al menos la cifra formateada y quieta
            <span>{token !== null ? formatCifra(token.target, token) : raw}</span>
          )}
          {suffix ? <span>{suffix}</span> : null}
        </div>
        {/* La etiqueta entra DESPUÉS de que el contador haya parado. Si entra
            antes compite con la cifra y no se lee ninguna de las dos: es la
            coreografía de `hero-stat.html`, que retrasa la nota al 85 % de la
            subida del contador. Aquí entraba a la vez que todo lo demás. */}
        {label !== undefined && label.trim() !== '' ? (
          <div
            style={{
              fontSize: 30,
              fontWeight: 500,
              color: d.foreground,
              opacity: etiqueta,
              transform: `translateY(${(1 - etiqueta) * 14}px)`,
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---- Marco de navegador/móvil con texto tecleándose -------------------------
// La URL/comando se escribe con `typed` del kit (por frame) + cursor parpadeante.
// `style`: 'browser' (por defecto) | 'phone'. Determinista.
export const DeviceFrame: React.FC<{ text: string; style?: string; design?: DesignTokens }> = ({
  text,
  style,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, enter } = useInOut();
  const isPhone = style === 'phone';
  const shown = typed(text, frame / fps, 0.35, isPhone ? 16 : 14);
  const cursorOn = Math.floor(frame / Math.max(1, Math.round(fps * 0.5))) % 2 === 0;
  const line = hexToRgba(d.foreground, 0.12);

  if (isPhone) {
    return (
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          fontFamily: FONT_FAMILY,
        }}
      >
        <div
          style={{
            width: 380,
            height: 760,
            opacity,
            transform: `translateY(${(1 - enter) * 24}px) scale(${0.94 + 0.06 * enter})`,
            ...glassSurface(d),
            border: `3px solid ${hexToRgba(d.foreground, 0.25)}`,
            borderRadius: 46,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* notch */}
          <div
            style={{
              alignSelf: 'center',
              width: 150,
              height: 26,
              borderRadius: 14,
              background: hexToRgba(d.foreground, 0.22),
              marginBottom: 22,
            }}
          />
          {/* barra de búsqueda */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: hexToRgba(d.foreground, 0.1),
              borderRadius: 14,
              padding: '14px 18px',
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                border: `3px solid ${d.accent}`,
              }}
            />
            <span style={{ fontSize: 30, color: d.foreground, fontWeight: 600 }}>
              {shown}
              <span style={{ opacity: cursorOn ? 1 : 0, color: d.accent }}>|</span>
            </span>
          </div>
          {/* skeleton de contenido */}
          <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[0.9, 0.7, 0.8, 0.55].map((w, i) => (
              <div
                key={i}
                style={{ height: 22, width: `${w * 100}%`, borderRadius: 8, background: line }}
              />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          width: 1180,
          opacity,
          transform: `translateY(${(1 - enter) * 24}px) scale(${0.96 + 0.04 * enter})`,
          ...glassSurface(d),
          borderRadius: 18,
          overflow: 'hidden',
        }}
      >
        {/* chrome: 3 puntos + barra de direcciones */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '18px 24px',
            borderBottom: `1px solid ${line}`,
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            {[0.5, 0.7, 0.9].map((o, i) => (
              <div
                key={i}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: hexToRgba(d.foreground, 0.2 + o * 0.1),
                }}
              />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: hexToRgba(d.foreground, 0.08),
              borderRadius: 12,
              padding: '12px 20px',
            }}
          >
            {/* candado */}
            <div
              style={{
                width: 16,
                height: 14,
                borderRadius: 3,
                border: `2px solid ${d.accent}`,
                position: 'relative',
              }}
            />
            <span
              style={{
                fontSize: 34,
                color: d.foreground,
                fontWeight: 600,
                letterSpacing: '-0.01em',
              }}
            >
              {shown}
              <span style={{ opacity: cursorOn ? 1 : 0, color: d.accent }}>|</span>
            </span>
          </div>
        </div>
        {/* cuerpo: skeleton de página */}
        <div style={{ padding: '34px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              height: 40,
              width: '52%',
              borderRadius: 10,
              background: hexToRgba(d.accent, 0.35),
            }}
          />
          {[0.95, 0.85, 0.9, 0.6].map((w, i) => (
            <div
              key={i}
              style={{ height: 20, width: `${w * 100}%`, borderRadius: 7, background: line }}
            />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- Anotación dibujada a mano (círculo/subrayado/flecha) -------------------
// El temblor "hecho a mano" sale de noise(hash), no de Math.random, para que dos
// renders del mismo frame sean idénticos. Adaptado de editor-youtube anotacion.html.
const ANNOTATION_SHAPES = ['circle', 'underline', 'arrow', 'strike', 'check'] as const;
type AnnotationShape = (typeof ANNOTATION_SHAPES)[number];

function circlePath(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const N = 40;
  const start = -0.3;
  const end = Math.PI * 2 + 0.35; // sobrepasa el cierre → lazo abierto, más "a mano"
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const a = start + (end - start) * (i / N);
    const x = cx + Math.cos(a) * rx + (noise(i * 2, seed) - 0.5) * 20;
    const y = cy + Math.sin(a) * ry + (noise(i * 2 + 1, seed) - 0.5) * 20;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function underlinePath(x0: number, x1: number, y: number, seed: number): string {
  const N = 22;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const x = x0 + (x1 - x0) * (i / N);
    const jy = (noise(i, seed) - 0.5) * 12 + Math.sin(i * 0.6) * 5;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(y + jy).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Tachado: como el subrayado pero cruzando el elemento y con inclinación, que es
// lo que distingue «esto está mal» de «esto es importante».
function strikePath(x0: number, x1: number, y: number, seed: number): string {
  const N = 18;
  const pts: string[] = [];
  const caida = 26; // el trazo baja de izquierda a derecha, como a mano
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const x = x0 + (x1 - x0) * p;
    const jy = (noise(i, seed) - 0.5) * 10 + (p - 0.5) * caida;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(y + jy).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Visto: dos trazos, el corto bajando y el largo subiendo. Se dibuja en orden,
// así que con strokeDashoffset sale como si lo trazara una mano.
function checkPath(cx: number, cy: number, size: number, seed: number): string {
  const w = (noise(1, seed) - 0.5) * 12;
  const x0 = cx - size * 0.55;
  const y0 = cy;
  const x1 = cx - size * 0.15 + w * 0.3;
  const y1 = cy + size * 0.42;
  const x2 = cx + size * 0.6;
  const y2 = cy - size * 0.5 + w;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function arrowPath(x0: number, y0: number, x1: number, y1: number, seed: number): string {
  const midx = (x0 + x1) / 2 + (noise(1, seed) - 0.5) * 40;
  const midy = (y0 + y1) / 2 + (noise(2, seed) - 0.5) * 40;
  const ang = Math.atan2(y1 - midy, x1 - midx);
  const hl = 52;
  const a1 = ang + Math.PI - 0.5;
  const a2 = ang + Math.PI + 0.5;
  return (
    `M ${x0} ${y0} Q ${midx.toFixed(1)} ${midy.toFixed(1)} ${x1} ${y1} ` +
    `M ${x1} ${y1} L ${(x1 + Math.cos(a1) * hl).toFixed(1)} ${(y1 + Math.sin(a1) * hl).toFixed(1)} ` +
    `M ${x1} ${y1} L ${(x1 + Math.cos(a2) * hl).toFixed(1)} ${(y1 + Math.sin(a2) * hl).toFixed(1)}`
  );
}

// Micro-FX: acento gráfico de menos de segundo y medio anclado a UNA palabra
// pronunciada (catálogo en @fabrica/shared micro-fx.ts). No es una tarjeta: no
// ocupa el centro ni tapa el b-roll, entra por una esquina alta y se va.
// Determinismo: todo sale de span/pulse sobre useCurrentFrame.
const MICRO_SHAPES = ['spark_up', 'spark_down', 'padlock', 'timer'] as const;
type MicroShape = (typeof MICRO_SHAPES)[number];

export const MicroFx: React.FC<{ shape?: string; design?: DesignTokens }> = ({ shape, design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { opacity, pop } = useInOut({ enterFrames: 8, exitFrames: 8 });
  const lienzo = useLienzo();
  const kind: MicroShape = (MICRO_SHAPES as readonly string[]).includes(shape ?? '')
    ? (shape as MicroShape)
    : 'spark_up';

  // el trazo se dibuja en el primer tercio; luego se sostiene
  const drawFrames = Math.max(5, Math.round(durationInFrames * 0.35));
  const draw = span(frame, 0, drawFrames, Ease.outExpo);

  const sube = kind === 'spark_up';
  const color = kind === 'spark_down' ? '#ff6b6b' : kind === 'spark_up' ? '#3ddc84' : d.accent;

  // el ancla la fija el lienzo: en apaisado arriba a la derecha (no compite con
  // las tarjetas ni con los subtítulos), en vertical el centro de la ventana
  const { cx, cy } = lienzo.anclajes.microFx;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg
        viewBox={lienzo.viewBox}
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, opacity }}
      >
        <g transform={`translate(${cx} ${cy}) scale(${mix(0.7, 1, clamp(pop, 0, 1.2))})`}>
          {kind === 'spark_up' || kind === 'spark_down' ? (
            <>
              <path
                d={
                  sube
                    ? 'M -110 70 L -30 10 L 30 45 L 110 -70'
                    : 'M -110 -70 L -30 -10 L 30 -45 L 110 70'
                }
                pathLength={1}
                fill="none"
                stroke={color}
                strokeWidth={12}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={1}
                strokeDashoffset={1 - draw}
              />
              {/* punta de flecha, entra cuando el trazo ya ha llegado */}
              <path
                d={
                  sube
                    ? 'M 110 -70 L 60 -62 M 110 -70 L 102 -20'
                    : 'M 110 70 L 60 62 M 110 70 L 102 20'
                }
                fill="none"
                stroke={color}
                strokeWidth={12}
                strokeLinecap="round"
                opacity={clamp(span(frame, drawFrames * 0.8, 6), 0, 1)}
              />
            </>
          ) : kind === 'padlock' ? (
            <>
              {/* arco que salta al abrirse: el gesto ES la apertura */}
              <path
                d="M -46 -20 A 46 46 0 0 1 46 -20"
                fill="none"
                stroke={color}
                strokeWidth={12}
                strokeLinecap="round"
                transform={`translate(${mix(0, 26, draw).toFixed(1)} ${mix(0, -22, draw).toFixed(1)}) rotate(${mix(0, 22, draw).toFixed(1)})`}
              />
              <rect x={-58} y={-20} width={116} height={92} rx={14} fill={color} opacity={0.92} />
            </>
          ) : (
            <>
              {/* anillo que se vacía en sentido horario */}
              <circle
                cx={0}
                cy={0}
                r={62}
                fill="none"
                stroke={hexToRgba(d.foreground, 0.25)}
                strokeWidth={12}
              />
              <circle
                cx={0}
                cy={0}
                r={62}
                fill="none"
                stroke={color}
                strokeWidth={12}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={span(frame, 0, durationInFrames, Ease.linear)}
                transform="rotate(-90)"
              />
            </>
          )}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

// Las tres piezas de GRAMÁTICA VERTICAL portadas del catálogo hermano
// (stamp-banned, notification-pop, text-stack-offset). No son marcas SVG sobre
// el b-roll sino texto en escena: la palabra disparadora es la pieza. Se
// descartaron en 16:9 porque a 46 px se pierden; a 1080 de ancho ocupan media
// pantalla, que es su hábitat. Solo las produce el catálogo con soloVertical.
const VERTICAL_WORD_STYLES = ['sello', 'aviso', 'apilado'] as const;

const PalabraVertical: React.FC<{
  estilo: (typeof VERTICAL_WORD_STYLES)[number];
  palabra: string;
  design: DesignTokens;
}> = ({ estilo, palabra, design: d }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const { opacity } = useInOut({ exitFrames: 8 });
  const lienzo = useLienzo();
  const { cy } = lienzo.anclajes.microFx;
  const anchoUtil = lienzo.ancho - lienzo.safe.left - lienzo.safe.right;
  const texto = palabra.trim().toUpperCase();
  const chars = Math.max(3, texto.length);

  if (estilo === 'sello') {
    // Cae de golpe y rebota: un sello que baja suave parece una tarjeta
    // apareciendo; lo que lo hace un SELLO es llegar antes de que el ojo lo
    // siga y asentarse (coreografía del hermano, exp-amortiguada = determinista
    // sobre el frame). Rojo semántico, no el acento: es un rechazo.
    const golpeFrames = Math.max(4, Math.round(fps * 0.26));
    const c = span(frame, 0, golpeFrames, Ease.outCubic);
    const t = Math.max(0, (frame - golpeFrames) / fps);
    const rebote = frame > golpeFrames ? Math.exp(-9 * t) * Math.sin(26 * t) * 0.05 : 0;
    const escala = 1.9 - 0.9 * c + rebote;
    const cuerpo = Math.min(Math.round(lienzo.ancho * 0.1), Math.floor(anchoUtil / (0.62 * chars)));
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
        <div
          style={{
            position: 'absolute',
            top: cy,
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            opacity: Math.min(1, c * 2.4) * opacity,
            transform: `rotate(-9deg) scale(${escala.toFixed(3)}) translateY(${((1 - c) * -40).toFixed(1)}px)`,
          }}
        >
          <span
            style={{
              ...displayText(800),
              fontSize: cuerpo,
              letterSpacing: '0.06em',
              color: '#ff6b6b',
              border: `${Math.max(4, Math.round(cuerpo * 0.09))}px solid #ff6b6b`,
              borderRadius: Math.round(cuerpo * 0.12),
              padding: `${Math.round(cuerpo * 0.16)}px ${Math.round(cuerpo * 0.34)}px`,
              textShadow: `0 2px 14px ${hexToRgba('#000000', 0.55)}`,
            }}
          >
            {texto}
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  if (estilo === 'aviso') {
    // Notificación de sistema: entra y sale por ARRIBA (salir por abajo la
    // haría parecer una tarjeta que se cae, no un aviso que se retira).
    const entradaFrames = Math.max(6, Math.round(fps * 0.42));
    const salidaFrames = Math.max(5, Math.round(fps * 0.34));
    const e = clamp(span(frame, 0, entradaFrames, Ease.outBack6), 0, 1.06);
    const s = span(frame, durationInFrames - salidaFrames, salidaFrames, Ease.inOutCubic);
    const dy = (1 - e) * -140 - s * 140;
    const [ventanaIni] = lienzo.zonas.ventana;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
        <div
          style={{
            position: 'absolute',
            top: ventanaIni + 24,
            left: lienzo.safe.left,
            right: lienzo.safe.right,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '20px 26px',
            background: hexToRgba('#0b0f13', 0.82),
            border: `1px solid ${hexToRgba(d.foreground, 0.22)}`,
            borderRadius: 26,
            boxShadow: `0 24px 56px -18px ${hexToRgba('#000000', 0.7)}`,
            opacity: clamp(e, 0, 1) * (1 - s) * opacity,
            transform: `translateY(${dy.toFixed(1)}px)`,
          }}
        >
          <div
            style={{
              flex: 'none',
              width: 62,
              height: 62,
              borderRadius: 15,
              display: 'grid',
              placeItems: 'center',
              background: d.accent,
              color: d.accent_fg,
              ...displayText(800),
              fontSize: 34,
            }}
          >
            ↑
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 22,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: hexToRgba(d.foreground, 0.55),
              }}
            >
              Resultado
            </div>
            <div style={{ ...displayText(700), fontSize: 40, color: d.foreground, marginTop: 2 }}>
              {texto.charAt(0) + texto.slice(1).toLowerCase()}
            </div>
          </div>
          <div style={{ flex: 'none', fontSize: 22, color: hexToRgba(d.foreground, 0.45) }}>
            ahora
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  // apilado: la palabra tres veces con offset alternado y peso creciente, cada
  // línea entra desde su lado con retardo — el eje vertical es el que este
  // formato tiene, y la repetición ES el énfasis
  const cuerpo = Math.min(Math.round(lienzo.ancho * 0.089), Math.floor(anchoUtil / (0.6 * chars)));
  const lineas = [
    { dx: -0.06, peso: 400 as const, color: hexToRgba(d.foreground, 0.55) },
    { dx: 0.04, peso: 700 as const, color: d.foreground },
    { dx: -0.02, peso: 800 as const, color: d.accent },
  ];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          position: 'absolute',
          top: cy - cuerpo * 1.6,
          width: '100%',
          display: 'grid',
          justifyItems: 'center',
          opacity,
        }}
      >
        {lineas.map((l, i) => {
          const e = clamp(span(frame, i * 4, 10, Ease.outExpo), 0, 1);
          const desde = (i % 2 === 0 ? -1 : 1) * 120;
          return (
            <span
              key={i}
              style={{
                ...displayText(l.peso),
                fontSize: cuerpo,
                lineHeight: 1.04,
                color: l.color,
                opacity: e,
                transform: `translateX(${(l.dx * lienzo.ancho + (1 - e) * desde).toFixed(1)}px)`,
                textShadow: `0 2px 12px ${hexToRgba('#000000', 0.5)}`,
              }}
            >
              {texto}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Annotation: React.FC<{
  shape?: string;
  text?: string;
  seed?: number;
  design?: DesignTokens;
}> = ({ shape, text, seed = 0, design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { opacity } = useInOut({ exitFrames: 10 });
  // se dibuja en el primer ~45% del efecto; luego se queda
  const drawFrames = Math.max(6, Math.round(durationInFrames * 0.45));
  const draw = span(frame, 0, drawFrames, Ease.outExpo);
  const lienzo = useLienzo();
  // las piezas de palabra vertical no son marcas SVG: componente propio
  if ((VERTICAL_WORD_STYLES as readonly string[]).includes(shape ?? '')) {
    return (
      <PalabraVertical
        estilo={shape as (typeof VERTICAL_WORD_STYLES)[number]}
        palabra={text ?? ''}
        design={d}
      />
    );
  }
  const kind: AnnotationShape = (ANNOTATION_SHAPES as readonly string[]).includes(shape ?? '')
    ? (shape as AnnotationShape)
    : ANNOTATION_SHAPES[seed % ANNOTATION_SHAPES.length]!;

  // las coordenadas salen del lienzo: en apaisado son las de siempre, en
  // vertical se centran en la ventana limpia
  const a = lienzo.anclajes;
  const path =
    kind === 'circle'
      ? circlePath(a.circulo.cx, a.circulo.cy, a.circulo.rx, a.circulo.ry, seed)
      : kind === 'underline'
        ? underlinePath(a.subrayado.x1, a.subrayado.x2, a.subrayado.y, seed)
        : kind === 'strike'
          ? strikePath(a.tachado.x1, a.tachado.x2, a.tachado.y, seed)
          : kind === 'check'
            ? checkPath(a.visto.cx, a.visto.cy, a.visto.r, seed)
            : arrowPath(a.flecha.x1, a.flecha.y1, a.flecha.x2, a.flecha.y2, seed);
  // etiqueta opcional sobre la marca
  const labelTop =
    kind === 'underline'
      ? a.etiqueta.subrayado
      : kind === 'arrow'
        ? a.etiqueta.flecha
        : kind === 'strike'
          ? a.etiqueta.tachado
          : a.etiqueta.otras;
  // el visto va en verde de acierto, no en el acento de marca: es semántico
  const stroke = kind === 'check' ? '#3ddc84' : d.accent;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <svg
        viewBox={lienzo.viewBox}
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, opacity }}
      >
        <path
          d={path}
          pathLength={1}
          fill="none"
          stroke={stroke}
          strokeWidth={13}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
          style={{ filter: `drop-shadow(0 4px 10px ${hexToRgba('#000000', 0.45)})` }}
        />
      </svg>
      {text !== undefined && text.trim() !== '' ? (
        <div
          style={{
            position: 'absolute',
            top: labelTop,
            width: '100%',
            textAlign: 'center',
            opacity: opacity * clamp(span(frame, drawFrames * 0.6, 8), 0, 1),
          }}
        >
          <span
            style={{
              ...displayText(800),
              fontSize: 40,
              color: d.foreground,
              background: hexToRgba(d.accent, 0.9),
              padding: '6px 20px',
              borderRadius: 10,
              transform: 'rotate(-2deg)',
              display: 'inline-block',
            }}
          >
            {text}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// Barra de progreso fina de acento abajo del todo; se llena en toda la duración
// de la composición (se monta como Sequence de 0 a totalFrames).
export const ProgressBar: React.FC<{ design?: DesignTokens }> = ({ design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', justifyContent: 'flex-end' }}>
      <div style={{ height: 6, background: hexToRgba(d.foreground, 0.12) }}>
        <div style={{ width: `${pct}%`, height: '100%', background: d.accent }} />
      </div>
    </AbsoluteFill>
  );
};

// Ambiente: viñeta + grano de película sutil. El grano usa feTurbulence con la
// semilla derivada del frame → ruido que cambia cada fotograma, determinista.
export const Ambience: React.FC<{ design?: DesignTokens }> = ({ design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const seed = frame % 100;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* viñeta */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, transparent 55%, ${hexToRgba(d.background, 0.55)} 100%)`,
        }}
      />
      {/* grano de película */}
      <AbsoluteFill style={{ opacity: 0.05, mixBlendMode: 'overlay' }}>
        <svg width="100%" height="100%">
          <filter id={`grain-${seed}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- Los tres del catálogo de motion graphics -------------------------------
// Portados de `editor-youtube/templates/`: split-versus, pasos-flow y
// green-spike/red-crash. Existen por un motivo editorial, no por tener más
// efectos: son las tres formas en que un guion de este nicho se pone a
// ENUMERAR, y enumerar en voz alta es lo que produce los rótulos locutados que
// costó todo un sprint quitar. Si la lista se dibuja, la voz puede dejar de
// recitarla.

/**
 * Dos cosas enfrentadas. El corte se abre DESDE EL CENTRO hacia los dos
 * extremos, con `inOutCubic` y no `outCubic`.
 *
 * La nota es literal de `split-versus.html` y explica por qué: «una punta que
 * traza arranca contra el material y frena contra él. Con outCubic el trazo
 * aparece hecho a medias en el primer fotograma y se lee como un barrido
 * automático, que es justo lo que esto no es».
 */
export const SplitVersus: React.FC<{ items: string[]; design?: DesignTokens }> = ({
  items,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const lienzo = useLienzo();
  const { opacity } = useInOut();
  const [a, b] = items;
  if (a === undefined || b === undefined) return null;
  // En vertical los dos lados se apilan: 1500 px de ancho no caben en 1080, y
  // partir la pantalla por la mitad EN ALTO es el mismo gesto —dos cosas
  // enfrentadas con un canto entre ellas— en el eje que el formato sí tiene.
  const col = lienzo.vertical;

  const corte = span(frame, 4, 16, Ease.inOutCubic);
  // el trazo gana CUERPO al abrirse: 2 px de raya a 13 px de canto
  const grosor = mix(2, 13, corte);
  const ladoA = span(frame, 8, 14, Ease.outCubic);
  const ladoB = span(frame, 13, 14, Ease.outCubic);

  const lado = (texto: string, p: number, desde: number): React.ReactNode => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${S[6]}px`,
        opacity: p,
        transform: col ? `translateY(${(1 - p) * desde}px)` : `translateX(${(1 - p) * desde}px)`,
        ...displayText(800),
        fontSize: T.xl,
        lineHeight: 1.1,
        color: d.foreground,
        textAlign: 'center',
      }}
    >
      {texto}
    </div>
  );

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          opacity,
          display: 'flex',
          flexDirection: col ? 'column' : 'row',
          alignItems: 'stretch',
          width: col ? lienzo.ancho - lienzo.safe.left - lienzo.safe.right : 1500,
          height: col ? 520 : 260,
          borderRadius: R.lg,
          ...glassSurface(d),
          overflow: 'hidden',
        }}
      >
        {lado(a, ladoA, -40)}
        <div
          style={{
            ...(col ? { height: grosor } : { width: grosor }),
            alignSelf: 'stretch',
            background: d.accent,
            // se abre desde el centro: el canto se apoya en la junta
            clipPath: col
              ? `inset(0 ${((1 - corte) * 50).toFixed(2)}% 0 ${((1 - corte) * 50).toFixed(2)}%)`
              : `inset(${((1 - corte) * 50).toFixed(2)}% 0 ${((1 - corte) * 50).toFixed(2)}% 0)`,
          }}
        />
        {lado(b, ladoB, 40)}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Un proceso de 2 a 4 estaciones, escalonadas en el tiempo.
 *
 * El hueco entre fichas es de 40 px y no de 22, que es la corrección anotada en
 * `pasos-flow.html`: el cromo de la ficha activa se sale 14 px por arriba y 16
 * por abajo, así que con 22 se solapaba sobre el título de la de al lado.
 */
export const PasosFlow: React.FC<{ items: string[]; design?: DesignTokens }> = ({
  items,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const lienzo = useLienzo();
  const { opacity } = useInOut();
  const pasos = items.filter((s) => s.trim() !== '').slice(0, 4);
  if (pasos.length < 2) return null;
  const ESCALON = 9; // frames entre estaciones
  // Cuatro fichas en fila piden 4x240 + 3x40 = 1080: el ancho ENTERO del
  // lienzo vertical, sin margen. Apiladas, el proceso se lee de arriba abajo,
  // que además es como se desliza en este formato.
  const col = lienzo.vertical;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          opacity,
          display: 'flex',
          flexDirection: col ? 'column' : 'row',
          gap: 40,
          alignItems: 'stretch',
          ...(col ? { width: lienzo.ancho - lienzo.safe.left - lienzo.safe.right } : {}),
        }}
      >
        {pasos.map((paso, i) => {
          const p = span(frame, 4 + i * ESCALON, 14, Ease.outBack6);
          return (
            <div
              key={`${i}-${paso}`}
              style={{
                opacity: Math.min(1, p),
                transform: col
                  ? `translateX(${(1 - Math.min(1, p)) * 22}px) scale(${0.94 + 0.06 * Math.min(1, p)})`
                  : `translateY(${(1 - Math.min(1, p)) * 22}px) scale(${0.94 + 0.06 * Math.min(1, p)})`,
                ...glassSurface(d, { accent: i === pasos.length - 1 }),
                borderRadius: R.md,
                padding: `${S[5]}px ${S[6]}px`,
                minWidth: 240,
                display: 'flex',
                flexDirection: 'column',
                gap: S[2],
              }}
            >
              <div
                style={{
                  fontFamily: familias(d).mono,
                  fontSize: T.xs,
                  letterSpacing: '0.22em',
                  color: d.accent,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  ...displayText(700),
                  fontSize: T.lg,
                  lineHeight: 1.15,
                  color: d.foreground,
                }}
              >
                {paso}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Una cifra que se dispara o se hunde.
 *
 * El perfil de la curva es deliberado y viene de `green-spike.html`: «casi
 * plano al principio y disparado al final. Una recta diagonal dice "sube";
 * esto dice "se dispara", que es la palabra que lo activa».
 *
 * El color NO sale de la paleta del canal: verde de acierto y rojo de choque
 * son señales, y su significado no se negocia por coherencia de marca. Es la
 * misma regla que aplica el catálogo de origen.
 */
export const Tendencia: React.FC<{
  value: string;
  direccion: string;
  label?: string;
  design?: DesignTokens;
}> = ({ value, direccion, label, design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { opacity } = useInOut();
  const sube = direccion !== 'baja';
  const color = sube ? SENAL.ok : SENAL.no;
  const ANCHO = 640;
  const ALTO = 300;

  // el perfil literal del original; para «baja» se invierte en vertical
  const perfil: [number, number][] = [
    [0, 0],
    [0.22, 0.06],
    [0.4, 0.02],
    [0.58, 0.22],
    [0.74, 0.3],
    [0.88, 0.62],
    [1, 1],
  ];
  const trazo = span(frame, 6, 26, Ease.outCubic);
  const puntos = perfil
    .map(([x, y]) => {
      const yy = sube ? y : 1 - y;
      return `${(x * ANCHO).toFixed(1)},${((1 - yy) * ALTO).toFixed(1)}`;
    })
    .join(' ');

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          opacity,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: S[3],
        }}
      >
        <div
          style={{
            ...displayText(800),
            fontSize: T.hero,
            lineHeight: 1,
            color,
            letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
            ...scrim(d, { fuerza: 0.7 }),
            padding: `${S[2]}px ${S[5]}px`,
          }}
        >
          {value}
        </div>
        <svg width={ANCHO} height={ALTO} viewBox={`0 0 ${ANCHO} ${ALTO}`}>
          <polyline
            points={puntos}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - trazo}
          />
        </svg>
        {label !== undefined && label.trim() !== '' ? (
          <div style={{ fontSize: T.md, fontWeight: 600, color: d.foreground }}>{label}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// Imagen REAL de referencia de una entidad con nombre (producto, empresa,
// modelo), superpuesta al plano mientras la voz la menciona. La resuelve el
// worker (foto de stock → Wikimedia Commons, con veto del juez de planos) y
// llega con `imagePath` congelado y reescrito a /files; aquí solo se pinta.
// Si la ruta no es cargable (maestro a medio construir en el player del
// dashboard), degrada a nada — un marco vacío sería peor que ningún inserto.
export const ImagenApoyo: React.FC<{
  imagePath?: string;
  text?: string;
  credit?: string;
  design?: DesignTokens;
}> = ({ imagePath, text, credit, design }) => {
  const d = design ?? defaultDesign();
  const { opacity, enter } = useInOut();
  if (imagePath === undefined || imagePath === '' || !isRenderableSrc(imagePath)) return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          marginTop: 110,
          opacity,
          transform: `translateY(${(1 - enter) * 24}px) scale(${0.96 + 0.04 * enter})`,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 14,
          ...glassSurface(d),
          borderRadius: 20,
        }}
      >
        <Img
          src={toSrc(imagePath)}
          style={{
            // El recuadro se ADAPTA a la imagen en vez de imponerle un 16:9.
            // La mayoría de retratos de Wikimedia Commons son verticales, y en
            // un marco apaisado fijo la foto quedaba en una franja estrecha
            // rodeada de cristal vacío: se lee como un fallo de montaje, no
            // como un inserto. Con límites en los dos ejes, un retrato sale
            // vertical, un logo apaisado sale ancho y ninguno se recorta.
            maxWidth: 560,
            maxHeight: 400,
            width: 'auto',
            height: 'auto',
            display: 'block',
            objectFit: 'contain',
            borderRadius: 12,
            background: hexToRgba(d.background, 0.55),
          }}
        />
        {(text !== undefined && text.trim() !== '') || (credit !== undefined && credit !== '') ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '0 4px',
              // el texto NO puede ensanchar el marco por encima de la foto: si
              // lo hace, un retrato vertical queda flotando entre cristal
              maxWidth: 560,
            }}
          >
            {text !== undefined && text.trim() !== '' ? (
              <div style={{ ...displayText(700), fontSize: 26, color: d.foreground }}>{text}</div>
            ) : null}
            {credit !== undefined && credit !== '' ? (
              // La atribución que exige la licencia: pequeña pero legible. En
              // pantalla va la forma corta (autor + licencia); la completa,
              // con «via Wikimedia Commons», ya viaja en description.txt, que
              // es donde la licencia pide que conste.
              <div style={{ fontSize: 14, color: hexToRgba(d.foreground, 0.5) }}>
                {credit.replace(/,\s*(via|from)\s.*$/i, '')}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
