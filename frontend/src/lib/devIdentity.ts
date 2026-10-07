// Seletor "Ver como" — só existe no `npm run dev` (import.meta.env.DEV).
// Troca o CARGO no Horun (nível 1 a 5) mandando os mesmos cabeçalhos que o
// Core injetaria em produção. O backend só respeita esses cabeçalhos com
// HORUN_DEV_MODE=true; atrás do Core eles são descartados e reescritos.
const STORAGE_KEY = 'horun-resultados-dev-level'

export const LEVEL_LABELS: Record<number, string> = {
  1: 'administrador máximo',
  2: 'coordenador(a)',
  3: 'pesquisador(a)',
  4: 'técnico(a)',
  5: 'IC',
}

export function getDevLevel(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const level = raw ? Number(raw) : NaN
    return level >= 1 && level <= 5 ? level : null
  } catch {
    return null
  }
}

export function setDevLevel(level: number | null): void {
  try {
    if (level) localStorage.setItem(STORAGE_KEY, String(level))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // sem localStorage: sem persistência, sem erro
  }
}
