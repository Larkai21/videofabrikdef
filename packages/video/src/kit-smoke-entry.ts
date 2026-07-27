import { registerRoot } from 'remotion';
import { KitSmokeRoot } from './kit-smoke';

// Entry alternativo para bundle() del validador del brand kit: registra solo
// la composición de humo (KitSmoke/KitThumb) sin tocar el entry de producción.
registerRoot(KitSmokeRoot);
