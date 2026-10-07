const nf = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 4 })
const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

/** Número curto em pt-BR (4 algarismos significativos). */
export function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (Math.abs(value) >= 1000) return nf2.format(value)
  return nf.format(value)
}

export function fmtMeanSd(stat?: { mean: number | null; sd: number | null; n: number } | null): string {
  if (!stat || stat.mean === null) return '—'
  return stat.sd !== null && stat.n > 1 ? `${fmt(stat.mean)} ± ${fmt(stat.sd)}` : fmt(stat.mean)
}

export function fmtTemp(t: number | null | undefined): string {
  return t === null || t === undefined ? '—' : `${nf2.format(t)} °C`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function validityLabel(valid: boolean | null): string {
  return valid === true ? 'válida' : valid === false ? 'inválida' : 'pendente'
}
