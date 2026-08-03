// Formato de cifras EN PANTALLA, compartido entre los componentes que las
// pintan (StatCard, StatOdometer) y el informe de calidad que las audita.
// Antes cada mitad iba por su cuenta: el odómetro insertaba puntos de millar,
// la tarjeta no, y el aviso `cifra_sin_separador` medía el value crudo del
// maestro — discrepaba de la pantalla en los dos sentidos (falso positivo con
// odómetro, silencio con tarjeta). Producir con una convención y auditar con
// otra hace el informe inútil; esta es la única.
//
// Convención: punto de millar (español) a partir de 5 dígitos enteros — «9999»
// se lee de un vistazo, «17000» no. El separador decimal del value original se
// conserva tal cual («1.2B» no se convierte en «1,2B»: puede ser notación de
// la fuente).

export interface CifraToken {
  /** el token numérico tal cual aparece en el value («17000», «1.2», «12,5») */
  raw: string;
  /** valor numérico a animar */
  target: number;
  /** nº de decimales (0 = entero) */
  decimales: number;
  /** separador decimal original ('' si entero) */
  sepDecimal: '' | '.' | ',';
}

const TOKEN_RE = /-?\d[\d.,]*/;
// separador seguido de 1-2 dígitos AL FINAL del token = parte decimal
// («1.2», «12,5», «3.50»); tres dígitos tras el separador es millar («10,000»)
const DECIMAL_TAIL_RE = /^(-?[\d.,]*?)([.,])(\d{1,2})$/;

/** Localiza y descompone el primer token numérico del value. */
export function tokenCifra(value: string): CifraToken | null {
  const match = value.match(TOKEN_RE);
  if (!match) return null;
  const raw = match[0];
  const tail = raw.match(DECIMAL_TAIL_RE);
  if (tail) {
    const entero = (tail[1] ?? '').replace(/[.,]/g, '');
    const sepDecimal = tail[2] as '.' | ',';
    const dec = tail[3] ?? '';
    const target = Number.parseFloat(`${entero === '' || entero === '-' ? `${entero}0` : entero}.${dec}`);
    if (!Number.isFinite(target)) return null;
    return { raw, target, decimales: dec.length, sepDecimal };
  }
  const digits = raw.replace(/[.,]/g, '');
  const target = Number.parseInt(digits, 10);
  if (!Number.isFinite(target)) return null;
  return { raw, target, decimales: 0, sepDecimal: '' };
}

/** Agrupa una parte entera con puntos de millar si tiene 5 dígitos o más. */
export function agrupaMillares(entero: string): string {
  const neg = entero.startsWith('-');
  const digits = neg ? entero.slice(1) : entero;
  if (digits.length < 5) return entero;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return neg ? `-${grouped}` : grouped;
}

/** Pinta `n` con la convención del token (millares agrupados, decimales suyos). */
export function formatCifra(n: number, token: CifraToken): string {
  if (token.decimales > 0) {
    const [entero = '0', dec = ''] = Math.abs(n).toFixed(token.decimales).split('.');
    const signo = n < 0 ? '-' : '';
    return `${signo}${agrupaMillares(entero)}${token.sepDecimal}${dec}`;
  }
  return agrupaMillares(String(Math.round(n)));
}

/** Cómo se verá `value` en pantalla, con su token numérico ya formateado. */
export function displayCifra(value: string): string {
  const token = tokenCifra(value);
  if (!token) return value;
  return value.replace(token.raw, formatCifra(token.target, token));
}
