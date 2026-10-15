import { useEffect, useId, useRef, useState } from 'react'
import { useChartPrefs, type ChartStyle, type ColorEntry } from '../lib/chartPrefs'
import { muted, Segmented } from './ui'

const STYLE_LABELS: Record<ChartStyle, string> = { barras: 'Barras', linhas: 'Pontos e linha', pontos: 'Só pontos' }

/** Cabeçalho do gráfico: tipo (barras / pontos e linha / só pontos) e
 * "Cores" — escolher a cor de cada série. Tudo fica neste navegador
 * (lib/chartPrefs.ts) e vale para os outros gráficos com a mesma série. */
export function ChartLook({
  scope,
  styles,
  fallback,
  colors: rawColors = [],
}: {
  /** escopo do tipo ('gas', 'linhas'); sem escopo, só o botão de cores */
  scope?: string
  styles?: ChartStyle[]
  fallback?: ChartStyle
  colors?: ColorEntry[]
}) {
  const prefs = useChartPrefs()
  // H e SE dividem a mesma cor (fracao:H): uma linha só na lista
  const colors = rawColors.filter((c, i) => rawColors.findIndex((x) => x.key === c.key) === i)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const anyCustom = colors.some((c) => prefs.customized(c.key))
  return (
    <div ref={wrap} className="relative flex flex-wrap items-center gap-1">
      {scope && styles && fallback && (
        <Segmented
          label="Tipo de gráfico"
          value={prefs.styleOf(scope, fallback)}
          onChange={(v) => prefs.setStyle(scope, v)}
          options={styles.map((s) => ({ value: s, label: STYLE_LABELS[s] }))}
        />
      )}
      {colors.length > 0 && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <span className="flex" aria-hidden="true">
            {colors.slice(0, 4).map((c) => (
              <span key={c.key} className="-ml-0.5 inline-block h-2.5 w-2.5 rounded-full first:ml-0" style={{ background: prefs.color(c.key, c.color) }} />
            ))}
          </span>
          Cores
        </button>
      )}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Cores do gráfico"
          className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border p-3 text-xs shadow-lg"
          style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border)' }}
        >
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {colors.map((c) => {
              const value = prefs.color(c.key, c.color)
              return (
                <li key={c.key} className="flex min-h-8 items-center gap-2">
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => prefs.setColor(c.key, e.target.value)}
                    aria-label={`Cor de ${c.label}`}
                    className="h-7 w-9 cursor-pointer rounded border p-0.5"
                    style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                  />
                  <span className="min-w-0 flex-1 truncate" title={c.label}>
                    {c.label}
                  </span>
                  {prefs.customized(c.key) && (
                    <button type="button" className="underline" style={{ color: 'var(--color-primary)' }} onClick={() => prefs.setColor(c.key, null)}>
                      padrão
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-2" style={muted}>
            Vale para todos os gráficos com a mesma série, neste navegador. Hidropirolisada em tons frios e extraída em tons quentes por padrão.
          </p>
          {anyCustom && (
            <button
              type="button"
              className="mt-1 underline"
              style={{ color: 'var(--color-primary)' }}
              onClick={() => prefs.resetColors(colors.map((c) => c.key))}
            >
              Voltar todas às cores padrão
            </button>
          )}
        </div>
      )}
    </div>
  )
}
