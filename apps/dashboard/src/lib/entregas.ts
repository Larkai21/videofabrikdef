import type { InboxDto } from '@fabrica/shared';

// Orden y filtro de la galería de entregas. Separado de la pantalla porque es
// aritmética de fechas con una trampa de zona horaria, y eso se prueba.
//
// Se hace en CLIENTE a propósito: /inbox devuelve las tres listas más los
// agregados de presupuesto del mes, y filtrar por fecha solo `done` en el
// servidor dejaría esos agregados hablando de un periodo distinto al de la
// galería, en la misma pantalla. Cuando `done` pase de ~200 filas o /inbox de
// ~300 ms, la vía es un GET /videos propio copiando el de /library, que ya
// tiene filtros, orden y paginación de servidor.

type Entregada = InboxDto['done'][number];

export type Orden = 'reciente' | 'antiguo';

export interface FiltroEntregas {
  /** 'YYYY-MM-DD' o '' — inclusivo, en hora local. */
  desde: string;
  /** 'YYYY-MM-DD' o '' — inclusivo hasta el final del día, en hora local. */
  hasta: string;
  orden: Orden;
  /** El buscador global, que ya filtraba antes por título. */
  q: string;
}

export const FILTRO_VACIO: FiltroEntregas = { desde: '', hasta: '', orden: 'reciente', q: '' };

export function hayFiltroDeFecha(f: Pick<FiltroEntregas, 'desde' | 'hasta'>): boolean {
  return f.desde !== '' || f.hasta !== '';
}

export function rangoImposible(f: Pick<FiltroEntregas, 'desde' | 'hasta'>): boolean {
  return f.desde !== '' && f.hasta !== '' && f.desde > f.hasta;
}

// `<input type="date">` da 'YYYY-MM-DD' en hora LOCAL y created_at es un
// instante ISO en UTC: comparar las cadenas es incorrecto por zona horaria y,
// peor, excluiría el día `hasta` entero. `new Date('YYYY-MM-DDTHH:mm:ss')` sin
// Z se interpreta en local, que es lo que el humano quiere decir.
function inicioLocal(dia: string): number {
  return dia === '' ? -Infinity : new Date(`${dia}T00:00:00`).getTime();
}
function finLocal(dia: string): number {
  return dia === '' ? Infinity : new Date(`${dia}T23:59:59.999`).getTime();
}

export function filtrarEntregas(done: Entregada[], f: FiltroEntregas): Entregada[] {
  const desdeMs = inicioLocal(f.desde);
  const hastaMs = finLocal(f.hasta);
  const q = f.q.trim().toLowerCase();

  const filtradas = done.filter((d) => {
    if (q !== '' && !d.title.toLowerCase().includes(q)) return false;
    if (!hayFiltroDeFecha(f)) return true;
    const t = new Date(d.created_at).getTime();
    // una fecha ilegible no debe hacer desaparecer el vídeo en silencio: se
    // conserva y el orden lo manda al final
    if (Number.isNaN(t)) return true;
    return t >= desdeMs && t <= hastaMs;
  });

  const dir = f.orden === 'reciente' ? -1 : 1;
  return filtradas.sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    const va = Number.isNaN(ta) ? null : ta;
    const vb = Number.isNaN(tb) ? null : tb;
    if (va === null && vb === null) return a.video_id.localeCompare(b.video_id);
    if (va === null) return 1; // las ilegibles, siempre al final
    if (vb === null) return -1;
    // desempate estable por id: dos vídeos creados en el mismo segundo no deben
    // bailar entre refetches
    if (va === vb) return a.video_id.localeCompare(b.video_id);
    return (va - vb) * dir;
  });
}
