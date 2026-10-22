import { useEffect, useMemo, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Mode, SampleVariable, SeriesResponse } from '../api/types'
import { SourceChips } from '../charts/ChartCard'
import { SeriesChart } from '../charts/SeriesChart'
import { SelectChartsButton } from '../components/ChartSelection'
import { ErrorBox, inputClass, inputStyle, muted, Segmented } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'
import { MODE_OPTIONS } from './SamplesTab'
import { variableTitle } from './VariablesTab'

// Séries em função de uma variável de amostra criada pelas pessoas (pedido do
// usuário, 22/10/2026): grupos de parâmetros (rocha: Matéria orgânica,
// Elementar...; outros tipos: por análise), um gráfico por parâmetro —
// número → linhas por fração; categoria → barras.

export type ParamGroup = { id: string; label: string; series: string[] }

function Loader({ projectId, col, mode, split, variable }: { projectId: number; col: string; mode: Mode; split: boolean; variable: string }) {
  const [data, setData] = useState<SeriesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [technique, parameter] = col.split('.')
  useEffect(() => {
    setData(null)
    setError(null)
    api
      .get<SeriesResponse>(
        `/projects/${projectId}/series?technique=${technique}&parameter=${encodeURIComponent(parameter)}&mode=${mode}&split_replicates=${split}&variable=${encodeURIComponent(variable)}`,
      )
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [projectId, technique, parameter, mode, split, variable])
  if (error) return <ErrorBox message={error} />
  return <SeriesChart data={data} />
}

export function VariableSeriesView({ variable, groups }: { variable: SampleVariable; groups: ParamGroup[] | null }) {
  const { project } = useProject()
  const { catalog } = useApp()
  const [mode, setMode] = useState<Mode>('padrao')
  const [split, setSplit] = useState(false)
  const [group, setGroup] = useState('todos')
  const { samples, error } = useSamples(project.id, mode)
  const withValue = useMemo(() => (samples ?? []).filter((s) => s.kind === 'sample' && s.variables?.[variable.key] != null), [samples, variable.key])
  const base: ParamGroup[] = useMemo(() => {
    if (groups) return groups
    const profile = project.profile?.parameters ?? {}
    return catalog.map((t) => ({
      id: t.key,
      label: t.label,
      series: (profile[t.key] ?? t.params.filter((p) => p.main).map((p) => p.key)).map((k) => `${t.key}.${k}`),
    }))
  }, [groups, catalog, project.profile])
  const present = (col: string) => withValue.some((s) => s.values[col]?.mean != null)
  const shown = base.map((g) => ({ ...g, series: g.series.filter(present) })).filter((g) => g.series.length)
  const visible = group === 'todos' ? shown : shown.filter((g) => g.id === group)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {shown.length > 1 && (
          <Segmented label="Parâmetros" value={group} onChange={setGroup} options={[{ value: 'todos', label: 'Todos' }, ...shown.map((g) => ({ value: g.id, label: g.label }))]} />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SelectChartsButton />
          <select className={`${inputClass} w-auto`} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Quais medições entram">
            {MODE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            Separar réplicas A, B, C
          </label>
        </div>
      </div>
      <ErrorBox message={error} />
      {samples === null ? (
        <p style={muted}>Carregando…</p>
      ) : withValue.length === 0 ? (
        <p style={muted}>
          Nenhuma amostra tem "{variableTitle(variable)}" preenchida ainda. Preencha na aba <strong>Variáveis</strong> (dá para marcar várias amostras e
          preencher de uma vez).
        </p>
      ) : shown.length === 0 ? (
        <p style={muted}>As {withValue.length} amostra(s) com "{variable.label}" ainda não têm resultados importados.</p>
      ) : (
        visible.map((g) => (
          <section key={g.id}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3">
              <h2 className="font-semibold">{g.label}</h2>
              <SourceChips sources={Array.from(new Set(g.series.map((c) => c.split('.')[0])))} />
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {g.series.map((col) => (
                <Loader key={col} projectId={project.id} col={col} mode={mode} split={split} variable={variable.key} />
              ))}
            </div>
          </section>
        ))
      )}
      <p className="text-xs" style={muted}>
        {withValue.length} amostra(s) com "{variable.label}" preenchida. Cada ponto junta as amostras da mesma fração com o mesmo valor: com várias, média ±
        desvio entre elas; com uma só, média ± desvio das réplicas de análise. Amostras sem valor ficam de fora.
      </p>
    </div>
  )
}
