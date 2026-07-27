// API pública de @fabrica/video: composiciones para @remotion/player en el
// dashboard y utilidades puras que también consume el worker de render.
export { LongForm } from './LongForm';
export { Root } from './Root';
export { BeatVisual } from './BeatVisual';
export { Subtitles, SAFE_AREA } from './Subtitles';
export {
  SubtitlesBasicos,
  splitCueLines,
  type SubtitleThemeProps,
} from './themes/SubtitlesBasicos';
export { ThumbnailTemplate, type ThumbnailTemplateProps } from './ThumbnailTemplate';
export { calculateLongFormMetadata, DEFAULT_DURATION_FRAMES } from './metadata';
export {
  componentRegistry,
  resolveComponent,
  type RegisteredComponent,
} from './registry.generated';
export { hashSeed } from './seed';
export { computeChapters, formatChapterTime, chaptersToText, type Chapter } from './chapters';
export { isRenderableSrc, toSrc } from './media-src';
export { FONT_FAMILY, ensureFontLoaded } from './fonts';
