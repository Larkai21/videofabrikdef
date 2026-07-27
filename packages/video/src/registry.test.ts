import { describe, expect, it } from 'vitest';
import { resolveComponent } from './registry.generated';
import { SubtitlesBasicos } from './themes/SubtitlesBasicos';

describe('resolveComponent', () => {
  it('resuelve el tema de subtítulos integrado', () => {
    const component = resolveComponent('subtitle_theme', 'subtitulos-basicos@0.1.0');
    expect(component).toBe(SubtitlesBasicos);
  });

  it('falla con error claro si la referencia no está registrada', () => {
    expect(() => resolveComponent('subtitle_theme', 'otro-tema@1.0.0')).toThrowError(
      /no registrado.*otro-tema@1\.0\.0/,
    );
    expect(() => resolveComponent('intro', 'intro-basica@0.1.0')).toThrowError(
      /no registrado/,
    );
  });
});
