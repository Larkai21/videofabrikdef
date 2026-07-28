import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { ensureFontLoaded, FONT_FAMILY } from './fonts';
import { isRenderableSrc, toSrc } from './media-src';

// Contrato: thumbnailTemplatePropsSchema en packages/shared (image_path aquí
// es opcional: en S1 las miniaturas salen solo con texto y marca).
export type ThumbnailTemplateProps = {
  text: string;
  image_path?: string;
  variant: 'a' | 'b';
  design?: DesignTokens;
};

// Miniatura 1280×720: fondo oscuro, texto enorme (≤4 palabras) y acento de
// marca. La variante cambia posición y el foco del degradado para el test A/B;
// el color de acento y el fondo salen de los tokens de diseño del canal.
export const ThumbnailTemplate: React.FC<ThumbnailTemplateProps> = ({
  text,
  image_path,
  variant,
  design,
}) => {
  ensureFontLoaded();
  const d = design ?? defaultDesign();
  const glow = hexToRgba(d.accent, 0.16);
  const hasImage = Boolean(image_path && isRenderableSrc(image_path));
  return (
    <AbsoluteFill style={{ backgroundColor: d.background, fontFamily: FONT_FAMILY }}>
      {hasImage && image_path ? (
        <AbsoluteFill>
          <Img
            src={toSrc(image_path)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          background:
            variant === 'a'
              ? `radial-gradient(circle at 20% 80%, ${glow}, transparent 55%)`
              : `radial-gradient(circle at 80% 20%, ${glow}, transparent 55%)`,
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: variant === 'a' ? 'flex-end' : 'flex-start',
          padding: 72,
        }}
      >
        <div
          style={{
            width: 180,
            height: 14,
            backgroundColor: d.accent,
            borderRadius: 7,
            marginBottom: 28,
            marginTop: variant === 'a' ? 0 : 24,
          }}
        />
        <div
          style={{
            fontSize: 132,
            fontWeight: 800,
            lineHeight: 1.04,
            color: d.foreground,
            letterSpacing: -2,
            textShadow: '0 6px 30px rgba(0, 0, 0, 0.8)',
            maxWidth: 1000,
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
