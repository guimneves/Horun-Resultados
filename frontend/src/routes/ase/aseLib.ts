import type { AseField, AseGroup, DoeFactor } from '../../api/types'
import { fmt } from '../../lib/format'

export const METHOD_LABELS: Record<string, string> = {
  equipment: 'Equipamento',
  cell: 'Tamanho da célula',
  pressure: 'Pressão',
  heat_time: 'Heat time',
  static_time: 'Tempo estático por ciclo',
  rinse: 'Rinse',
  purge: 'Purge',
  nominal_mass: 'Massa nominal de amostra',
  rock: 'Rocha / amostra',
  packing: 'Acondicionamento',
  notes: 'Outras condições',
}

export const KIND_LABELS: Record<DoeFactor['kind'], string> = {
  continuo: 'Numérico contínuo',
  discreto: 'Numérico inteiro (ex.: nº de ciclos)',
  categorico: 'Categórico (ex.: solvente)',
}

export const GROUP_ORDER: AseGroup[] = ['principal', 'complementar', 'eficiencia', 'diagnostico', 'rockeval', 'rockeval_delta']

export function byGroup(fields: AseField[]): { group: AseGroup; label: string; fields: AseField[] }[] {
  return GROUP_ORDER.map((g) => ({ group: g, label: fields.find((f) => f.group === g)?.group_label ?? g, fields: fields.filter((f) => f.group === g) })).filter(
    (g) => g.fields.length,
  )
}

export function withUnit(f: Pick<AseField, 'short' | 'unit'>): string {
  return f.unit && f.unit !== '–' ? `${f.short} (${f.unit})` : f.short
}

export function val(v: number | null | undefined): string {
  return v == null ? '—' : fmt(v)
}

export function levelText(f: DoeFactor, coded: number): string {
  if (coded === 0) return `${fmt(((f.low as number) + (f.high as number)) / 2)}${f.unit ? ` ${f.unit}` : ''}`
  const label = coded > 0 ? f.high_label : f.low_label
  if (label) return label
  const v = coded > 0 ? f.high : f.low
  return typeof v === 'number' ? `${fmt(v)}${f.unit ? ` ${f.unit}` : ''}` : String(v)
}

export function codedText(c: number): string {
  return c > 0 ? '+1' : c < 0 ? '−1' : '0'
}

export function designLabel(design: string): string {
  return design.replace('^2', '²').replace('^3', '³').replace('^4', '⁴')
}

export function conditionLabel(code: string): string {
  return code === 'C' ? 'Centro' : code
}
