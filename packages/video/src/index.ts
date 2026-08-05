// API pública de @fabrica/video: composiciones para @remotion/player en el
// dashboard y utilidades puras que también consume el worker de render.
export { LongForm } from './LongForm';
// la MISMA composición pinta los dos formatos; lo decide el tamaño del lienzo
export { Pieza } from './Pieza';
export { Root } from './Root';
export { BeatVisual } from './BeatVisual';
export { Subtitles, SAFE_AREA } from './Subtitles';
export {
  SubtitlesBasicos,
  splitCueLines,
  type SubtitleThemeProps,
} from './themes/SubtitlesBasicos';
export { ThumbnailTemplate, type ThumbnailTemplateProps } from './ThumbnailTemplate';
export { IntroBasica, type IntroOutroProps } from './themes/IntroBasica';
export { OutroBasica } from './themes/OutroBasica';
export {
  calculateLongFormMetadata,
  calculateShortFormMetadata,
  DEFAULT_DURATION_FRAMES,
} from './metadata';
export {
  beatWindow,
  computeBrandKitLayout,
  kitViewFrom,
  DEFAULT_LOWER_THIRD_FRAMES,
  DEFAULT_TITLE_CARD_FRAMES,
  type BrandKitLayout,
  type KitView,
} from './brand-kit';
export {
  componentMeta,
  componentRegistry,
  resolveComponent,
  type KitComponentMeta,
  type RegisteredComponent,
} from './registry.generated';
export { hashSeed } from './seed';
export { computeChapters, formatChapterTime, chaptersToText, type Chapter } from './chapters';
export { isRenderableSrc, toSrc } from './media-src';
export { FONT_FAMILY, ensureFontLoaded } from './fonts';
