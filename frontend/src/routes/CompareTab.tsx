import { useMemo, useState } from 'react'
import type { Mode } from '../api/types'
import { CompareBarChart } from '../charts/MoreCharts'
import { card, Empty, inputClass, inputStyle, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmtMeanSd, fmtTemp } from '../lib/format'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'
import { AlkaneSection, PyroSection, SamplePicker } from './SeriesTab'
import { MODE_OPTIONS } from './SamplesTab'

/** Comparar amostras/experimentos livres: tabela lado a lado + gráficos. */
export function CompareTab() {
  const { project } = useProject()
  const { catalog, paramLabel, techniqueLabel, fractionLabel } = useApp()
  const [mode, setMode] = useState<Mode>('padrao')
  const { samples } = useSamples(project.id, mode)
  const [selected, setSelected] = useState<number[]>([])
  const [column, setColumn] = useState('')

  const chosen = useMemo(() => (samples ?? []).filter((s) => selected.includes(s.id)), [samples, selected])
  const columns = useMemo(() => {
    const present = new Set(chosen.flatMap((s) => Object.keys(s.values)))
    return catalog.flatMap((t) => t.params.map((p) => `${t.key}.${p.key}`)).filter((c) => present.has(c))
  }, [catalog, chosen])
  const activeColumn = columns.includes(column) ? column : (columns[0] ?? '')
  const hasRe = chosen.some((s) => s.techniques?.includes('rockeval'))
  const hasPy = chosen.some((s) => s.techniques?.includes('pygcms'))
  const reIds = useMemo(() => chosen.filter((s) => s.techniques?.includes('rockeval')).map((s) => s.id), [chosen])
  const pyIds = useMemo(() => chosen.filter((s) => s.techniques?.includes('pygcms')).map((s) => s.id), [chosen])

  if (samples === null) return <p style={muted}>Carregando…</p>
  if (!samples.length) return <Empty>Nenhuma amostra ainda. Comece pela aba Importar.</Empty>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <select className={inputClass} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Validade">
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <SamplePicker samples={samples} selected={selected} onChange={setSelected} max={16} />
      {chosen.length === 0 ? (
        <Empty>Toque nas amostras acima para comparar (até 16).</Empty>
      ) : (
        <>
          <div className="table-wrap rounded-lg border" style={card}>
            <table className="w-full text-sm">
              <thead>
                <tr style={muted}>
                  <th className="px-3 py-2 text-left font-medium">Parâmetro</th>
                  {chosen.map((s) => (
                    <th key={s.id} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      {s.code}
                      <div className="text-xs font-normal">
                        {fractionLabel(s.fraction)} · {fmtTemp(s.temperature_c)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span style={muted}>{techniqueLabel(c.split('.')[0])} · </span>
                      {paramLabel(c)}
                    </td>
                    {chosen.map((s) => (
                      <td key={s.id} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {fmtMeanSd(s.values[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {columns.length > 0 && (
            <div className="space-y-2">
              <select className={inputClass} style={inputStyle} value={activeColumn} onChange={(e) => setColumn(e.target.value)} aria-label="Parâmetro do gráfico">
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {techniqueLabel(c.split('.')[0])} · {paramLabel(c)}
                  </option>
                ))}
              </select>
              <CompareBarChart samples={chosen} column={activeColumn} label={`${techniqueLabel(activeColumn.split('.')[0])} · ${paramLabel(activeColumn)}`} />
            </div>
          )}
          {hasRe && <PyroSection projectId={project.id} samples={samples} mode={mode} initial={reIds} />}
          {hasPy && <AlkaneSection projectId={project.id} samples={samples} mode={mode} initial={pyIds} />}
        </>
      )}
    </div>
  )
}
