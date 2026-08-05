import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { Cue, DesignTokens, Word } from '@fabrica/shared';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { scrim } from '../effects';
import { clamp, Ease, span } from '../effects/motion';
import { displayText, FONT_FAMILY } from '../fonts';
import { agruparPalabras, cuerpoDeGrupo, type Grupo } from './agrupar';
import type { SubtitleThemeProps } from './SubtitlesBasicos';

// Tema 'subtitulos-cineticos@0.1.0': la gramática de subtítulo del formato
// vertical. Una o dos palabras enormes que se relevan al ritmo de la voz, en
// vez del cue entero repartido en dos líneas.
//
// Coreografías portadas del catálogo de HyperFrames (caption-kinetic-slam,
// caption-pill-karaoke, caption-weight-shift, caption-highlight) con dos
// rechazos deliberados de kinetic-slam: su `back.out(2.2)` se pasa un ~22 %
// cuando la guía de marca fija el tope en 6 % —aquí se usa outBack6, que es esa
// curva calibrada—, y su barrido lateral entra y sale por el borde derecho,
// justo encima de la columna de botones de la plataforma.
//
// La píldora sólida de caption-pill-karaoke tampoco se porta: es el cromo de
// los subtítulos automáticos de la plataforma, y ponerla es firmar el vídeo con
// la marca de otro. El fondo lo da el `scrim` del canal.

/** Alternan por paridad: dos gestos que se turnan se leen como ritmo. */
const ENTRADA_GOLPE_MS = 130;
const ENTRADA_PESO_MS = 160;
const ENTRADA_OPACIDAD_MS = 90;
/** Se sostiene tras la última palabra, o hasta el grupo siguiente. */
const COLA_MS = 300;
const SALIDA_MS = 80;
/** A 128 px un 12 % son 15 px de crecimiento que empujan al vecino. */
const POP_MS = 110;
const POP_ESCALA = 1.1;
const SUBRAYADO_MS = 140;

const PESO_BASE = 800;
const PESO_KEYWORD = 900;

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
}

/** Pop de la palabra al pronunciarse: sube con overshoot y baja con cubic. */
function popDe(word: Word, currentMs: number): number {
  const t = currentMs - word.from_ms;
  if (t < 0 || t > POP_MS) return 1;
  const subida = POP_MS * 0.4;
  if (t <= subida) return 1 + (POP_ESCALA - 1) * span(t, 0, subida, Ease.outBack6);
  return POP_ESCALA - (POP_ESCALA - 1) * span(t, subida, POP_MS - subida, Ease.outCubic);
}

function colorDe(word: Word, currentMs: number, d: DesignTokens): string {
  if (currentMs >= word.from_ms && currentMs < word.to_ms) return d.accent;
  if (currentMs >= word.to_ms) return d.foreground;
  // `muted` a 128 px sobre un plano deja media pantalla ilegible; un
  // foreground translúcido se sigue leyendo y no compite con la palabra activa
  return hexToRgba(d.foreground, 0.45);
}

interface Gesto {
  escala: number;
  peso: number;
  opacidad: number;
  tracking: string;
}

function gestoDe(grupo: Grupo, idx: number, currentMs: number, finMs: number): Gesto {
  const t = currentMs - grupo.from_ms;
  const restante = finMs - currentMs;
  const opacidadSalida = restante < SALIDA_MS ? span(restante, 0, SALIDA_MS, Ease.inCubic) : 1;

  if (idx % 2 === 0) {
    // golpe: entra encogido y se asienta con el overshoot calibrado al 6 %
    const p = span(t, 0, ENTRADA_GOLPE_MS, Ease.outBack6);
    return {
      escala: 0.86 + 0.14 * p,
      peso: PESO_BASE,
      opacidad: Math.min(
        clamp(span(t, 0, ENTRADA_OPACIDAD_MS, Ease.outExpo), 0, 1),
        opacidadSalida,
      ),
      // el tracking que se asienta, ya escrito en WordsReveal
      tracking: `${(0.05 * (1 - p) - 0.02 * p).toFixed(3)}em`,
    };
  }
  // impulso de peso: escala fija y la fuente engorda. Es el gesto que mejor
  // encaja con la marca heredada, que destaca con contraste y peso y nunca
  // con luz.
  const p = span(t, 0, ENTRADA_PESO_MS, Ease.outCubic);
  return {
    escala: 1,
    peso: Math.round(400 + 400 * p),
    opacidad: Math.min(clamp(span(t, 0, ENTRADA_OPACIDAD_MS, Ease.outExpo), 0, 1), opacidadSalida),
    tracking: '-0.02em',
  };
}

export const SubtitulosCineticos: React.FC<SubtitleThemeProps> = ({
  cues,
  currentMs,
  design,
  highlightKeywords,
  safeArea,
}) => {
  const { width: anchoLienzo } = useVideoConfig();
  const d = design ?? defaultDesign();
  const highlightSet = new Set((highlightKeywords ?? []).map((k) => normalizeWord(k)));
  const typedCues = cues as Cue[];
  const active = typedCues.find((c) => currentMs >= c.from_ms && currentMs < c.to_ms);
  if (!active || active.words.length === 0) return null;

  const grupos = agruparPalabras(active.words);
  if (grupos.length === 0) return null;

  const idx = grupos.findIndex((g, i) => {
    const siguiente = grupos[i + 1];
    const fin = siguiente !== undefined ? siguiente.from_ms : g.to_ms + COLA_MS;
    return currentMs >= g.from_ms && currentMs < fin;
  });
  if (idx === -1) return null;
  const grupo = grupos[idx]!;
  const siguiente = grupos[idx + 1];
  const finMs = siguiente !== undefined ? siguiente.from_ms : grupo.to_ms + COLA_MS;

  const texto = grupo.words.map((w) => w.w).join(' ');
  // el ancho del lienzo no viaja por props —el contrato del brand kit no lo
  // lleva— pero el tema se monta DENTRO de la composición, así que lo tiene
  const cuerpo = cuerpoDeGrupo(texto, anchoLienzo - safeArea.left - safeArea.right);
  const gesto = gestoDe(grupo, idx, currentMs, finMs);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* el fondo es el scrim del canal, con su máscara lateral: una banda
          recta detrás del texto se ve como un rectángulo pegado, no como una
          sombra */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: safeArea.bottom - 110,
          height: 520,
          ...scrim(d, { fuerza: 0.62 }),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: safeArea.left,
          right: safeArea.right,
          bottom: safeArea.bottom,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-end',
          fontFamily: FONT_FAMILY,
          // El cuerpo va en el CONTENEDOR y no en cada palabra: el separador
          // mide 0,36em, y con el tamaño puesto solo en los <span> de palabra
          // ese `em` resolvía contra los 16 px por defecto del padre —unos 6 px
          // a 128 de cuerpo—, así que las palabras salían pegadas
          // («Paraentenderlo»).
          fontSize: cuerpo,
          // una sola línea por grupo: 1,2 solo abre un cañón bajo las descendentes
          lineHeight: 1.05,
          textAlign: 'center',
          letterSpacing: gesto.tracking,
          opacity: gesto.opacidad,
          transform: `scale(${gesto.escala})`,
          transformOrigin: 'center bottom',
        }}
      >
        <div style={{ whiteSpace: 'nowrap' }}>
          {grupo.words.map((word, wi) => {
            const esKeyword = highlightSet.has(normalizeWord(word.w)) && currentMs >= word.from_ms;
            const dibujo =
              esKeyword && currentMs >= word.from_ms
                ? clamp(span(currentMs - word.from_ms, 0, SUBRAYADO_MS, Ease.outExpo), 0, 1)
                : 0;
            return (
              <React.Fragment key={wi}>
                <span
                  style={{
                    ...displayText(esKeyword ? PESO_KEYWORD : gesto.peso),
                    color: esKeyword ? d.accent : colorDe(word, currentMs, d),
                    display: 'inline-block',
                    position: 'relative',
                    transform: `scale(${popDe(word, currentMs)})`,
                  }}
                >
                  {word.w}
                  {/* el resalte va con subrayado dibujado, no con una caja: a
                      este cuerpo una caja de color tapa el plano entero */}
                  {dibujo > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        bottom: -Math.round(cuerpo * 0.12),
                        height: Math.max(4, Math.round(cuerpo * 0.07)),
                        width: `${dibujo * 100}%`,
                        background: d.accent,
                        borderRadius: 999,
                      }}
                    />
                  ) : null}
                </span>
                {/* Separador con ancho propio: el mismo arreglo que el tema
                    apaisado. El pop no ocupa más caja, así que se come el hueco
                    del vecino, y a 128 px el problema es peor, no menor. */}
                {wi < grupo.words.length - 1 ? (
                  <span style={{ display: 'inline-block', width: '0.36em' }} />
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
