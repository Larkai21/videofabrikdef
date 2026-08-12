import { fabricaEventSchema } from '@fabrica/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { API_URL } from './api';
import { useToasts } from './toasts';

export interface JobNote {
  queue: string;
  progress: number;
  detail?: string;
}

export interface SourcePollNote {
  source_id: string;
  kind: string;
  channel_id: string | null;
  items: number;
  nuevos: number;
  error?: string;
  // reloj del cliente: el radar filtra por «desde que pulsé buscar»
  at: number;
}

interface LiveState {
  // progreso de render por vídeo (0–100)
  renderProgress: Record<string, number>;
  /** progreso del render de cada SHORT, indexado por su id */
  shortProgress: Record<string, number>;
  // última nota de progreso de job por vídeo
  jobNotes: Record<string, JobNote>;
  // feed de polls de fuentes (radar de ideas), acotado a los últimos 100
  sourcePolls: SourcePollNote[];
  // último scoring por canal: cuántas ideas nuevas dejó y cuándo
  ideasScored: Record<string, { nuevas: number; at: number }>;
}

const EMPTY_LIVE: LiveState = {
  renderProgress: {},
  shortProgress: {},
  jobNotes: {},
  sourcePolls: [],
  ideasScored: {},
};

const LiveContext = createContext<LiveState>(EMPTY_LIVE);

/**
 * Abre el EventSource a GET /events y traduce cada evento en invalidaciones de
 * TanStack Query + estado vivo (progresos) + toasts de incidencias.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { push } = useToasts();
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/events`);

    source.onmessage = (raw: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.data);
      } catch {
        return;
      }
      const result = fabricaEventSchema.safeParse(parsed);
      if (!result.success) return;
      const event = result.data;

      switch (event.type) {
        case 'video_state': {
          void queryClient.invalidateQueries({ queryKey: ['inbox'] });
          void queryClient.invalidateQueries({ queryKey: ['video', event.video_id] });
          void queryClient.invalidateQueries({ queryKey: ['timeline', event.video_id] });
          break;
        }
        case 'job_progress': {
          setLive((prev) => ({
            ...prev,
            jobNotes: {
              ...prev.jobNotes,
              [event.video_id]: {
                queue: event.queue,
                progress: event.progress,
                ...(event.detail !== undefined ? { detail: event.detail } : {}),
              },
            },
          }));
          if (event.progress >= 100) {
            void queryClient.invalidateQueries({ queryKey: ['inbox'] });
            // invalidación dedicada del brand kit: al terminar la validación
            // de un zip la lista de componentes se refresca sola
            if (event.queue === 'components') {
              void queryClient.invalidateQueries({ queryKey: ['componentes'] });
            }
          }
          break;
        }
        case 'render_progress': {
          // Un short renderizando NO enciende la barra del vídeo largo: la
          // bandeja indexa renderProgress por video_id y pintaría progreso en
          // la tarjeta de un vídeo ya entregado.
          if (event.short_id !== undefined) {
            const shortId = event.short_id;
            setLive((prev) => ({
              ...prev,
              shortProgress: { ...prev.shortProgress, [shortId]: event.progress },
            }));
            break;
          }
          if (event.video_id !== undefined) {
            const videoId = event.video_id;
            setLive((prev) => ({
              ...prev,
              renderProgress: { ...prev.renderProgress, [videoId]: event.progress },
            }));
          }
          break;
        }
        case 'short_state': {
          void queryClient.invalidateQueries({ queryKey: ['shorts', event.video_id] });
          void queryClient.invalidateQueries({ queryKey: ['short', event.short_id] });
          break;
        }
        case 'episode_state': {
          void queryClient.invalidateQueries({ queryKey: ['episodios'] });
          break;
        }
        case 'incident': {
          push(event.message, 'danger');
          void queryClient.invalidateQueries({ queryKey: ['inbox'] });
          break;
        }
        case 'ideas_updated': {
          void queryClient.invalidateQueries({ queryKey: ['ideas'] });
          if (event.nuevas !== undefined) {
            const nuevas = event.nuevas;
            setLive((prev) => ({
              ...prev,
              ideasScored: {
                ...prev.ideasScored,
                [event.channel_id]: { nuevas, at: Date.now() },
              },
            }));
          }
          break;
        }
        case 'source_poll': {
          setLive((prev) => ({
            ...prev,
            sourcePolls: [
              ...prev.sourcePolls.slice(-99),
              {
                source_id: event.source_id,
                kind: event.kind,
                channel_id: event.channel_id,
                items: event.items,
                nuevos: event.nuevos,
                ...(event.error !== undefined ? { error: event.error } : {}),
                at: Date.now(),
              },
            ],
          }));
          break;
        }
        case 'inbox_changed': {
          void queryClient.invalidateQueries({ queryKey: ['inbox'] });
          // los workers publican inbox_changed también al validar componentes;
          // la clave del brand kit ya no cuelga del prefijo 'inbox'
          void queryClient.invalidateQueries({ queryKey: ['componentes'] });
          break;
        }
      }
    };

    // EventSource reintenta solo; no hace falta lógica de reconexión propia.
    return () => {
      source.close();
    };
  }, [queryClient, push]);

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}
