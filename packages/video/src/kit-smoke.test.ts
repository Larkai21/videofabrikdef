import { describe, expect, it } from 'vitest';
import { SMOKE_FRAMES_DEFAULT, SMOKE_FRAMES_MAX, smokeDurationInFrames } from './kit-smoke';

describe('smokeDurationInFrames', () => {
  it('respeta fixed_duration_frames del manifest con tope 300', () => {
    expect(smokeDurationInFrames(90)).toBe(90);
    expect(smokeDurationInFrames(300)).toBe(300);
    expect(smokeDurationInFrames(4_500)).toBe(SMOKE_FRAMES_MAX);
  });

  it('sin valor (o con basura) cae a los 60 frames de siempre', () => {
    expect(smokeDurationInFrames(undefined)).toBe(SMOKE_FRAMES_DEFAULT);
    expect(smokeDurationInFrames('90')).toBe(SMOKE_FRAMES_DEFAULT);
    expect(smokeDurationInFrames(Number.NaN)).toBe(SMOKE_FRAMES_DEFAULT);
  });

  it('nunca baja de 1 frame', () => {
    expect(smokeDurationInFrames(0)).toBe(1);
    expect(smokeDurationInFrames(-10)).toBe(1);
  });
});
