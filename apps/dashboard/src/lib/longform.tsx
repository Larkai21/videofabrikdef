import type { MasterVideoJson } from '@fabrica/shared';
import { Component, type ComponentType, type ReactNode } from 'react';

// La composición recibe el maestro directamente como props (igual que el
// render SSR: inputProps = master).
export type LongFormProps = MasterVideoJson;

// Import dinámico literal: el Player lo consume como lazyComponent y así el
// bundle de Remotion no entra en el chunk inicial del dashboard.
export function loadLongForm(): Promise<{ default: ComponentType<LongFormProps> }> {
  return import('@fabrica/video').then((mod) => ({
    default: mod.LongForm as ComponentType<LongFormProps>,
  }));
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/** Aísla el Player: cualquier fallo de carga muestra el placeholder del mock. */
export class PlayerBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
