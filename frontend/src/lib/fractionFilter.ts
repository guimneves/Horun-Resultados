// "Tratar apenas" (Séries → Opções): extraídas × normais (sem extração).
// Só mexe nas frações de rocha: gás (G) e rocha original (O, referência)
// ficam sempre.
export type FractionChoice = 'todas' | 'extraidas' | 'normais'

export const FRACTION_CHOICES: { value: FractionChoice; label: string }[] = [
  { value: 'todas', label: 'Todas as frações' },
  { value: 'extraidas', label: 'Só as extraídas (E)' },
  { value: 'normais', label: 'Só as normais, sem extração (H, SE, HP)' },
]

export function fractionAllowed(fraction: string, choice: FractionChoice): boolean {
  if (choice === 'todas' || fraction === 'G' || fraction === 'O') return true
  return choice === 'extraidas' ? fraction === 'E' : fraction !== 'E'
}
