import { useRef, useState, type ReactNode } from 'react'
import { Button, card, muted } from '../components/ui'
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
 * (acessibilidade: a informação nunca depende só da cor). */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  filename,
  empty,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  table?: ReactNode
  filename?: string
  empty?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="min-w-0 rounded-lg border p-3 md:p-4" style={card} data-chart={title}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
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
            <Button variant="ghost" onClick={() => downloadChartPng(ref.current, filename ?? title)}>
              Baixar PNG
            </Button>
          </div>
        )}
      </div>
      {empty ? (
        <p className="py-8 text-center text-sm" style={muted}>
          {empty}
        </p>
      ) : showTable && table ? (
        <div className="table-wrap text-xs">{table}</div>
      ) : (
        <div ref={ref} className="h-72 w-full md:h-80">
          {children}
        </div>
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
