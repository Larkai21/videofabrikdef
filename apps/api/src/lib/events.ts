import { Redis } from 'ioredis';
import { EVENTS_CHANNEL, type FabricaEvent } from '@fabrica/shared';

// Bus de eventos: los workers publican en Redis pub/sub y la API reenvía por
// SSE; las rutas de puertas publican aquí también. Inyectable para tests.
export interface EventBus {
  publish(event: FabricaEvent): Promise<void>;
  subscribe(listener: (json: string) => void): () => void;
  close(): Promise<void>;
}

export function createRedisEventBus(redisUrl: string): EventBus {
  const pub = new Redis(redisUrl);
  const sub = new Redis(redisUrl);
  const listeners = new Set<(json: string) => void>();

  void sub.subscribe(EVENTS_CHANNEL);
  sub.on('message', (channel: string, message: string) => {
    if (channel !== EVENTS_CHANNEL) return;
    for (const listener of listeners) listener(message);
  });

  return {
    async publish(event) {
      await pub.publish(EVENTS_CHANNEL, JSON.stringify(event));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      listeners.clear();
      sub.disconnect();
      pub.disconnect();
    },
  };
}

export function createMemoryEventBus(): EventBus {
  const listeners = new Set<(json: string) => void>();
  return {
    async publish(event) {
      const json = JSON.stringify(event);
      for (const listener of listeners) listener(json);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      listeners.clear();
    },
  };
}
