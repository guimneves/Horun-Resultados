import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useChartSelection } from '../components/ChartSelection'
import { Button, card, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { downloadChartPng } from '../lib/chartExport'

export const axisProps = {
  stroke: 'var(--color-text-muted)',
  tick: { fill: 'var(--color-text-muted)', fontSize: 12 },
  tickLine: false,
} as const

export const gridProps = { stroke: 'var(--color-border)', strokeDasharray: '0', vertical: false } as const

export const tooltipStyle = {
  contentStyle: { background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontSize: 12 },
  labelStyle: { color: 'var(--color-text)' },
  itemStyle: { color: 'var(--color-text)' },
} as const

/** Moldura de gráfico: título, "Baixar PNG" e a alternativa em tabela
 * (acessibilidade: a informação nunca depende só da cor). O PNG sai com
 * título, subtítulo e legenda (lib/chartExport.ts); com a seleção ligada
 * (components/ChartSelection.tsx) aparece a caixa para baixar vários. O
 * gráfico fica montado mesmo em "Ver tabela" (fora da tela), para exportar. */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  filename,
  empty,
  sources = [],
}: {
  title: string
  subtitle?: string
  /** Técnicas de onde vêm os dados (chaves do catálogo) — viram etiquetas. */
  sources?: string[]
  children: ReactNode
  table?: ReactNode
  filename?: string
  empty?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showTable, setShowTable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const selection = useChartSelection()
  const { sourceLabel } = useApp()
  // no PNG, o subtítulo leva também de onde vêm os dados ("C × temperatura" sozinho não diz se é CHNSO ou LECO)
  const sourceText = sources.length ? `Dados: ${Array.from(new Set(sources)).map(sourceLabel).join(', ')}` : ''
  const exportSubtitle = [subtitle, sourceText].filter(Boolean).join(' — ') || undefined
  const exportable = !empty
  const latest = useRef({ title, subtitle: exportSubtitle })
  latest.current = { title, subtitle: exportSubtitle }
  useEffect(() => {
    if (!selection || !exportable) return
    return selection.register(id, {
      get: () => (ref.current ? { chart: ref.current, title: latest.current.title, subtitle: latest.current.subtitle } : null),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.register, id, exportable])
  const picked = !!selection?.selected.has(id)

  async function exportOne() {
    setError(null)
    try {
      if (ref.current) await downloadChartPng({ chart: ref.current, title, subtitle: exportSubtitle }, filename ?? title)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section
      className="relative min-w-0 overflow-hidden rounded-lg border p-3 md:p-4"
      style={picked ? { ...card, borderColor: 'var(--color-primary)', boxShadow: '0 0 0 2px var(--color-primary)' } : card}
      data-chart={title}
    >
      {selection?.selecting && exportable && (
        <label className="absolute bottom-2 right-2 z-10 flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs" style={{ background: 'var(--color-bg)' }}>
          <input type="checkbox" checked={picked} onChange={() => selection.toggle(id)} aria-label={`Selecionar ${title}`} />
          incluir
        </label>
      )}
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {sources.length > 0 && <SourceChips sources={sources} />}
          {subtitle && (
            <p className="text-xs" style={muted}>
              {subtitle}
            </p>
          )}
        </div>
        {!empty && (
          <div className="flex gap-1 print:hidden">
            {table && (
              <Button variant="ghost" onClick={() => setShowTable(!showTable)}>
                {showTable ? 'Ver gráfico' : 'Ver tabela'}
              </Button>
            )}
            <Button variant="ghost" onClick={exportOne}>
              Baixar PNG
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p className="mb-1 text-xs" style={{ color: '#a12020' }}>
          {error}
        </p>
      )}
      {empty ? (
        <p className="py-8 text-center text-sm" style={muted}>
          {empty}
        </p>
      ) : (
        <>
          {showTable && table && <div className="table-wrap text-xs">{table}</div>}
          {/* em "Ver tabela" o gráfico continua montado, fora da tela, para o PNG */}
          <div
            ref={ref}
            className={showTable && table ? '' : 'h-72 w-full md:h-80'}
            style={showTable && table ? { position: 'absolute', left: -10000, top: 0, width: 800, height: 320 } : undefined}
            aria-hidden={showTable && table ? true : undefined}
          >
            {children}
          </div>
        </>
      )}
    </section>
  )
}

export function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full">
      <thead>
        <tr style={muted}>
          {head.map((h) => (
            <th key={h} className="px-2 py-1 text-left font-medium whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
            {r.map((c, j) => (
              <td key={j} className="px-2 py-1 whitespace-nowrap tabular-nums">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Etiquetas "de onde vêm os dados": análise e equipamento. */
export function SourceChips({ sources }: { sources: string[] }) {
  const { sourceLabel } = useApp()
  return (
    <div className="my-1 flex flex-wrap gap-1" aria-label="Análises usadas">
      {Array.from(new Set(sources)).map((t) => (
        <span
          key={t}
          className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
        >
          {sourceLabel(t)}
        </span>
      ))}
    </div>
  )
}
