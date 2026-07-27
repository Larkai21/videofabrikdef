import type { Db } from '@fabrica/db';
import type { Enqueuer } from './enqueuer.js';
import type { EventBus } from './events.js';

export interface ApiContext {
  db: Db;
  enqueuer: Enqueuer;
  events: EventBus;
  libraryDir: string;
  outputsDir: string;
}
