import { describe, expect, it } from 'vitest';
import { componentMeta, resolveComponent } from './registry.generated';
import { IntroBasica } from './themes/IntroBasica';
import { OutroBasica } from './themes/OutroBasica';
import { SubtitlesBasicos } from './themes/SubtitlesBasicos';

describe('resolveComponent', () => {
  it('resuelve el tema de subtítulos integrado', () => {
    const component = resolveComponent('subtitle_theme', 'subtitulos-basicos@0.1.0');
    expect(component).toBe(SubtitlesBasicos);
  });

  it('resuelve la intro y la outro integradas', () => {
    expect(resolveComponent('intro', 'intro-basica@0.1.0')).toBe(IntroBasica);
    expect(resolveComponent('outro', 'outro-basica@0.1.0')).toBe(OutroBasica);
  });

  it('falla con error claro si la referencia no está registrada', () => {
    expect(() => resolveComponent('subtitle_theme', 'otro-tema@1.0.0')).toThrowError(
      /no registrado.*otro-tema@1\.0\.0/,
    );
    expect(() => resolveComponent('intro', 'intro-inexistente@0.1.0')).toThrowError(
      /no registrado/,
    );
  });
});

describe('componentMeta', () => {
  it('publica las duraciones fijas de los integrados (nunca se leen de BD)', () => {
    expect(componentMeta['intro-basica@0.1.0']).toEqual({ fixed_duration_frames: 80 });
    expect(componentMeta['outro-basica@0.1.0']).toEqual({ fixed_duration_frames: 90 });
    expect(componentMeta['subtitulos-basicos@0.1.0']).toEqual({});
  });
});
