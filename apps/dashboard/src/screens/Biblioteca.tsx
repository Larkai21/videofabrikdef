// TODO(agente biblioteca): grid de assets con filtros por tipo, tags y
// procedencia, detalle con licencia y usos, subida manual y candidatos a
// purga con borrado manual. SPEC §11.
export function Biblioteca() {
  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
      <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
        Biblioteca
      </h1>
      <p className="muted fs-sm" style={{ margin: 0 }}>
        La biblioteca etiquetada llega en este sprint.
      </p>
    </div>
  );
}
