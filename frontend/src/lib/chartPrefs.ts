import { useSyncExternalStore } from 'react'

// Preferências dos gráficos (pedido do mantenedor, 15/10/2026): tipo de
// gráfico (barras / pontos e linha / só pontos) e cores escolhidas pela
// pessoa. Ficam neste navegador e valem para todos os projetos.
//
// - Tipo: um por "escopo" — 'gas' (composição, FID, TCD; padrão barras) e
//   'linhas' (todos os gráficos × temperatura/TR; padrão pontos e linha).
//   Trocar num gráfico troca nos outros do mesmo escopo.
// - Cores: por SIGNIFICADO (fração, série, gás, massa), nunca por posição —
//   a mesma série tem a mesma cor em todo gráfico.

export type ChartStyle = 'barras' | 'linhas' | 'pontos'
export interface ColorEntry {
  /** chave estável: 'fracao:H', 'serie:H|N2|A', 'gas:H2', 'massa:oil_mass_g'... */
  key: string
  label: string
  /** cor padrão (sem escolha da pessoa) */
  color: string
}
interface Prefs {
  styles: Record<string, ChartStyle>
  colors: Record<string, string>
}

const KEY = 'resultados.graficos.preferencias'
const OLD_GAS_KEY = 'resultados.gas.estilo' // antes só o gás tinha escolha
const STYLES: ChartStyle[] = ['barras', 'linhas', 'pontos']
const HEX = /^#[0-9a-f]{6}$/i

function load(): Prefs {
  const prefs: Prefs = { styles: {}, colors: {} }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw.styles ?? {})) if (STYLES.includes(v as ChartStyle)) prefs.styles[k] = v as ChartStyle
      for (const [k, v] of Object.entries(raw.colors ?? {})) if (typeof v === 'string' && HEX.test(v)) prefs.colors[k] = v
    } else {
      const old = localStorage.getItem(OLD_GAS_KEY)
      if (old === 'linhas' || old === 'barras') prefs.styles.gas = old
    }
  } catch {
    /* sem armazenamento: padrões */
  }
  return prefs
}

let current = load()
const listeners = new Set<() => void>()

function update(next: Prefs) {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // outra aba mudou: acompanha
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = load()
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const snapshot = () => current

export function useChartPrefs() {
  const prefs = useSyncExternalStore(subscribe, snapshot, snapshot)
  return {
    styleOf: (scope: string, fallback: ChartStyle): ChartStyle => prefs.styles[scope] ?? fallback,
    setStyle: (scope: string, style: ChartStyle) => update({ ...current, styles: { ...current.styles, [scope]: style } }),
    color: (key: string, fallback: string): string => prefs.colors[key] ?? fallback,
    customized: (key: string) => key in prefs.colors,
    setColor: (key: string, value: string | null) => {
      const colors = { ...current.colors }
      if (value && HEX.test(value)) colors[key] = value
      else delete colors[key]
      update({ ...current, colors })
    },
    resetColors: (keys: string[]) => {
      const colors = { ...current.colors }
      for (const k of keys) delete colors[k]
      update({ ...current, colors })
    },
  }
}

export const fractionKey = (code: string) => `fracao:${code === 'SE' ? 'H' : code}`

/** Props de uma <Line> no tipo escolhido: "só pontos" some com o traço e o
 * ícone da legenda vira círculo; o resto (cor, marcador) é igual. */
export function lineLook(style: ChartStyle, color: string, dash?: string) {
  const pointsOnly = style === 'pontos'
  return {
    stroke: color,
    strokeWidth: pointsOnly ? 0 : 2,
    strokeDasharray: pointsOnly ? undefined : dash,
    legendType: pointsOnly ? ('circle' as const) : ('line' as const),
    dot: { r: pointsOnly ? 5 : 4, strokeWidth: 1.5, stroke: 'var(--color-bg-elevated)', fill: color },
    activeDot: { r: 6 },
  }
}
