import { describe, expect, it } from 'vitest';
import { makeDemoMaster, type IdeaDto, type InboxDto, type LibraryListDto, type TimelineDto, type VideoDetailDto } from '@fabrica/shared';
import { connectionErrorMessage, readableApiError } from './api.js';
import {
  currentMonthKey,
  formatCosts,
  formatIdeas,
  formatInbox,
  formatLibrary,
  formatTimeline,
  formatVideo,
  formatYoutube,
  msToS,
  roundUsd,
  truncate,
} from './format.js';

const inboxFixture: InboxDto = {
  gates: [
    {
      kind: 'timeline',
      video_id: 'vid-1',
      channel_id: 'ch-1',
      step_label: 'Curar timeline',
      title: 'El modelo que abarató la inteligencia',
      meta: '3/9 beats aprobados',
      eta_min: 4,
    },
  ],
  running: [
    {
      video_id: 'vid-2',
      title: 'Por qué todos copian a DeepSeek',
      state: 'render',
      detail: 'Renderizando vídeo',
      progress: null,
      cost_usd: 0.412345,
      incident: null,
    },
  ],
  done: [
    {
      video_id: 'vid-3',
      title: 'Copiar ya no es trampa',
      output_dir: '/outputs/vid-3',
      finished_at: '2026-07-20T10:00:00.000Z',
      thumbnail_url: '/files/outputs/vid-3/thumb_a.jpg',
      youtube: {
        status: 'subido',
        youtube_id: 'yt123',
        url: 'https://youtu.be/yt123',
        privacy_status: 'private',
        publish_at: '2026-07-28T17:00:00.000Z',
        uploaded_at: '2026-07-20T10:05:00.000Z',
        error: null,
      },
    },
  ],
  month_cost_usd: 1.23456,
  month_videos: 2,
  month_budget_usd: 25,
  stale_sources: [],
};

describe('helpers', () => {
  it('truncate corta con elipsis solo si hace falta', () => {
    expect(truncate('hola', 10)).toBe('hola');
    expect(truncate('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(truncate('a'.repeat(30), 10).length).toBe(10);
  });

  it('msToS redondea a décimas', () => {
    expect(msToS(11_000)).toBe(11);
    expect(msToS(9_540)).toBe(9.5);
    expect(msToS(0)).toBe(0);
  });

  it('roundUsd conserva cuatro decimales', () => {
    expect(roundUsd(0.412345)).toBe(0.4123);
    expect(roundUsd(1.00005)).toBe(1.0001);
  });

  it('currentMonthKey usa YYYY-MM en hora local', () => {
    expect(currentMonthKey(new Date(2026, 6, 27))).toBe('2026-07');
    expect(currentMonthKey(new Date(2026, 0, 3))).toBe('2026-01');
  });
});

describe('formatInbox', () => {
  it('resume puertas, en curso, entregas y coste del mes', () => {
    const out = formatInbox(inboxFixture) as {
      puertas_pendientes: unknown[];
      en_curso: { coste_usd: number }[];
      entregas: { youtube: { estado: string } | null }[];
      coste_del_mes: { restante_usd: number; total_usd: number };
    };
    expect(out.puertas_pendientes).toHaveLength(1);
    expect(out.en_curso[0]?.coste_usd).toBe(0.4123);
    expect(out.entregas[0]?.youtube?.estado).toBe('subido');
    expect(out.coste_del_mes.total_usd).toBe(1.2346);
    expect(out.coste_del_mes.restante_usd).toBe(roundUsd(25 - 1.23456));
  });
});

describe('formatIdeas', () => {
  const ideas: IdeaDto[] = [
    {
      id: 'idea-1',
      channel_id: 'ch-1',
      title: 'Idea uno',
      summary: 'resumen',
      angle: null,
      why_now: 'sale hoy',
      score: 0.91,
      status: 'new',
      manual_rank: null,
      source_refs: [{ url: 'https://example.com/x', domain: 'example.com' }],
      created_at: '2026-07-26T08:00:00.000Z',
    },
    {
      id: 'idea-2',
      channel_id: 'ch-2',
      title: 'Idea dos',
      summary: 'otro resumen',
      angle: 'ángulo',
      why_now: null,
      score: 0.7,
      status: 'new',
      manual_rank: null,
      source_refs: [{ url: 'https://sin-dominio.example/y' }],
      created_at: '2026-07-26T09:00:00.000Z',
    },
  ];

  it('conserva el ranking y extrae dominios de las fuentes', () => {
    const out = formatIdeas(ideas) as { total: number; ideas: { puesto: number; fuentes: string[] }[] };
    expect(out.total).toBe(2);
    expect(out.ideas[0]?.puesto).toBe(1);
    expect(out.ideas[0]?.fuentes).toEqual(['example.com']);
    expect(out.ideas[1]?.fuentes).toEqual(['https://sin-dominio.example/y']);
  });

  it('filtra por canal', () => {
    const out = formatIdeas(ideas, { channel: 'ch-2' }) as { total: number; ideas: { id: string }[] };
    expect(out.total).toBe(1);
    expect(out.ideas[0]?.id).toBe('idea-2');
  });
});

describe('formatVideo', () => {
  const video: VideoDetailDto = {
    id: 'vid-1',
    channel_id: 'ch-1',
    state: 'guion_borrador',
    title_chosen: null,
    master: makeDemoMaster(),
    costs_total: 0.1234567,
    youtube: null,
    thumbnail_url: null,
    incident: null,
    created_at: '2026-07-25T12:00:00.000Z',
    updated_at: '2026-07-25T12:30:00.000Z',
  };

  it('resume títulos, guion, beats por estado y coste', () => {
    const out = formatVideo(video) as {
      titulos: { idx: number; elegido: boolean }[];
      guion: { escenas: number; por_seccion: Record<string, number> };
      beats: { total: number; por_estado: Record<string, number> };
      coste_usd: number;
      youtube: null;
    };
    expect(out.titulos).toHaveLength(3);
    expect(out.titulos[0]?.elegido).toBe(true);
    expect(out.guion.escenas).toBe(4);
    expect(out.guion.por_seccion).toEqual({ hook: 1, body: 2, cta: 1 });
    expect(out.beats.total).toBe(4);
    expect(out.beats.por_estado).toEqual({ pending: 4 });
    expect(out.coste_usd).toBe(0.1235);
    expect(out.youtube).toBeNull();
  });

  it('degrada con secciones ausentes del maestro', () => {
    const bare: VideoDetailDto = {
      ...video,
      master: {
        version: '1',
        video: { id: 'vid-1', channel_id: 'ch-1', idea_id: 'idea-1', fps: 30, width: 1920, height: 1080 },
      },
    };
    const out = formatVideo(bare) as { titulos: null; guion: null; audio: null; beats: null };
    expect(out.titulos).toBeNull();
    expect(out.guion).toBeNull();
    expect(out.audio).toBeNull();
    expect(out.beats).toBeNull();
  });
});

describe('formatTimeline', () => {
  const timeline: TimelineDto = {
    video_id: 'vid-1',
    state: 'assets',
    audio_url: '/files/outputs/vid-1/voz.wav',
    duration_ms: 43_000,
    edits: [],
    beats: [
      {
        idx: 0,
        from_ms: 0,
        to_ms: 11_000,
        text: 'texto del beat',
        visual_query: 'server room',
        status: 'locked',
        chosen_origin: 'Pexels · clip 8842190',
        chosen_score: 0.83,
        candidates: [
          { ref: 'pexels:1', provider: 'pexels', score: 0.83 },
          { ref: 'pixabay:2', provider: 'pixabay', score: 0.7 },
        ],
      },
      {
        idx: 1,
        from_ms: 11_000,
        to_ms: 23_500,
        text: 'otro beat',
        visual_query: 'data chart',
        status: 'review',
        discard_reason: 'muy genérico',
      },
    ],
  };

  it('lista beats con estado, origen y puntuación y agrega el resumen', () => {
    const out = formatTimeline(timeline) as {
      duracion_s: number;
      resumen: Record<string, number>;
      beats: { origen: string | null; puntuacion: number | null; candidatos: number; motivo_descarte: string | null }[];
    };
    expect(out.duracion_s).toBe(43);
    expect(out.resumen).toEqual({ locked: 1, review: 1 });
    expect(out.beats[0]?.origen).toBe('Pexels · clip 8842190');
    expect(out.beats[0]?.puntuacion).toBe(0.83);
    expect(out.beats[0]?.candidatos).toBe(2);
    expect(out.beats[1]?.origen).toBeNull();
    expect(out.beats[1]?.motivo_descarte).toBe('muy genérico');
  });
});

describe('formatLibrary', () => {
  const list: LibraryListDto = {
    total: 41,
    assets: [
      {
        id: 'asset-1',
        scope: 'channel',
        channel_id: 'ch-1',
        kind: 'clip',
        url: '/files/library/assets/ch-1/x.mp4',
        thumb_url: null,
        source: 'pexels',
        license: 'pexels',
        duration_ms: 12_500,
        width: 1920,
        height: 1080,
        tags: ['server', 'room'],
        caption: 'pasillo de sala de servidores con luz azul',
        origin_query: 'server room',
        times_used: 3,
        last_video_id: 'vid-9',
        purge_candidate: false,
        favorite: false,
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  };

  it('resume los assets con duración en segundos y dimensiones', () => {
    const out = formatLibrary(list) as {
      total: number;
      mostrados: number;
      assets: { duracion_s: number | null; dimensiones: string | null; usos: number }[];
    };
    expect(out.total).toBe(41);
    expect(out.mostrados).toBe(1);
    expect(out.assets[0]?.duracion_s).toBe(12.5);
    expect(out.assets[0]?.dimensiones).toBe('1920x1080');
    expect(out.assets[0]?.usos).toBe(3);
  });
});

describe('formatCosts', () => {
  const now = new Date(2026, 6, 27);

  it('devuelve el agregado del mes en curso', () => {
    const out = formatCosts(inboxFixture, undefined, now);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.mes).toBe('2026-07');
      expect(out.value.coste_total_usd).toBe(1.2346);
      expect(out.value.videos_terminados).toBe(2);
    }
  });

  it('acepta el mes en curso explícito', () => {
    expect(formatCosts(inboxFixture, '2026-07', now).ok).toBe(true);
  });

  it('rechaza meses pasados con explicación', () => {
    const out = formatCosts(inboxFixture, '2026-05', now);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toContain('2026-05');
      expect(out.message).toContain('endpoint');
    }
  });
});

describe('formatYoutube', () => {
  it('null se queda en null', () => {
    expect(formatYoutube(null)).toBeNull();
  });

  it('traduce el estado de publicación', () => {
    const out = formatYoutube({
      status: 'fallido',
      youtube_id: null,
      url: null,
      privacy_status: null,
      publish_at: null,
      uploaded_at: null,
      error: 'cuota agotada',
    });
    expect(out).toMatchObject({ estado: 'fallido', error: 'cuota agotada' });
  });
});

describe('errores legibles de la API', () => {
  it('formatea {error, detail}', () => {
    expect(readableApiError(409, { error: 'conflicto de estado', detail: 'El vídeo no está en assets' }, 'POST', '/videos/v/approve-timeline')).toBe(
      'Error de la API (409, conflicto de estado): El vídeo no está en assets',
    );
  });

  it('distingue el 404 de endpoint inexistente del 404 de negocio', () => {
    expect(
      readableApiError(404, { error: 'no encontrado', detail: 'POST /videos/v1/publish' }, 'POST', '/videos/v1/publish'),
    ).toContain('aún no expone POST /videos/v1/publish');
    expect(
      readableApiError(404, { error: 'no encontrado', detail: 'Vídeo v1 no existe' }, 'GET', '/videos/v1'),
    ).toBe('Error de la API (404, no encontrado): Vídeo v1 no existe');
  });

  it('degrada con cuerpos no JSON', () => {
    expect(readableApiError(502, '<html>bad gateway</html>', 'GET', '/inbox')).toBe(
      'Error de la API (502) en GET /inbox',
    );
  });

  it('explica los fallos de conexión con la causa', () => {
    const cause = new Error('fetch failed');
    cause.cause = new Error('connect ECONNREFUSED 127.0.0.1:3001');
    const msg = connectionErrorMessage('http://localhost:3001', cause);
    expect(msg).toContain('http://localhost:3001');
    expect(msg).toContain('ECONNREFUSED');
    expect(msg).toContain('pnpm dev');
  });
});
