import type { ChannelDto } from '@fabrica/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getChannels } from './api';
import {
  readStoredChannelId,
  resolveActiveChannelId,
  writeStoredChannelId,
} from './channel-core';

// Contexto del canal activo (multicanal, SPEC §14 S3). Se monta en main.tsx,
// dentro del QueryClientProvider, para que cualquier pantalla y el AppHeader
// compartan la misma selección sin tocar App.tsx.

interface ChannelContextValue {
  /** Lista de canales conocidos (undefined mientras carga). */
  channels: ChannelDto[] | undefined;
  /** Id del canal activo, ya validado contra la lista; null sin canales. */
  activeChannelId: string | null;
  /** DTO del canal activo, si la lista ya cargó. */
  activeChannel: ChannelDto | undefined;
  /** Cambia el canal activo y lo persiste en localStorage. */
  setActiveChannel: (id: string) => void;
  /** true mientras la lista de canales aún no respondió. */
  isPending: boolean;
  /** true si la lista de canales no se pudo cargar (≠ lista vacía). */
  isError: boolean;
  /** reintenta la carga de canales. */
  refetch: () => void;
}

const ChannelContext = createContext<ChannelContextValue>({
  channels: undefined,
  activeChannelId: null,
  activeChannel: undefined,
  setActiveChannel: () => undefined,
  isPending: true,
  isError: false,
  refetch: () => undefined,
});

export function ChannelProvider({ children }: { children: ReactNode }) {
  const channelsQ = useQuery({ queryKey: ['channels'], queryFn: getChannels });

  const [storedId, setStoredId] = useState<string | null>(() =>
    readStoredChannelId(window.localStorage),
  );

  const setActiveChannel = useCallback((id: string) => {
    setStoredId(id);
    writeStoredChannelId(window.localStorage, id);
  }, []);

  const channels = channelsQ.data;
  const value = useMemo<ChannelContextValue>(() => {
    const ids = (channels ?? []).map((c) => c.id);
    const activeChannelId = resolveActiveChannelId(storedId, ids);
    return {
      channels,
      activeChannelId,
      activeChannel: channels?.find((c) => c.id === activeChannelId),
      setActiveChannel,
      isPending: channelsQ.isPending,
      isError: channelsQ.isError,
      refetch: () => void channelsQ.refetch(),
    };
  }, [channels, storedId, setActiveChannel, channelsQ.isPending, channelsQ.isError, channelsQ]);

  return <ChannelContext.Provider value={value}>{children}</ChannelContext.Provider>;
}

export function useChannel(): ChannelContextValue {
  return useContext(ChannelContext);
}
