import { fabricaEventSchema } from '@fabrica/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { API_URL } from './api';
import { useToasts } from './toasts';

export interface JobNote {
  queue: string;
  progress: number;
  detail?: string;
}

interface LiveState {
  // progreso de render por vídeo (0–100)
  renderProgress: Record<string, number>;
  // última nota de progreso de job por vídeo
  jobNotes: Record<string, JobNote>;
}

const LiveContext = createContext<LiveState>({ renderProgress: {}, jobNotes: {} });

/**
 * Abre el EventSource a GET /events y traduce cada evento en invalidaciones de
 * TanStack Query + estado vivo (progresos) + toasts de incidencias.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { push } = useToasts();
  const [live, setLive] = useState<LiveState>({ renderProgress: {}, jobNotes: {} });

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
          }
          break;
        }
        case 'render_progress': {
          setLive((prev) => ({
            ...prev,
            renderProgress: { ...prev.renderProgress, [event.video_id]: event.progress },
          }));
          break;
        }
        case 'incident': {
          push(event.message, 'danger');
          void queryClient.invalidateQueries({ queryKey: ['inbox'] });
          break;
        }
        case 'ideas_updated': {
          void queryClient.invalidateQueries({ queryKey: ['ideas'] });
          break;
        }
        case 'inbox_changed': {
          void queryClient.invalidateQueries({ queryKey: ['inbox'] });
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
