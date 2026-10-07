import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { AnalysisData, Mode, PyPeaks, PyroData, SampleRow, SeriesResponse } from '../api/types'
import { SeriesChart } from '../charts/SeriesChart'
import { AlkaneChart, GasCompositionChart, HiTmaxChart, PyrogramChart } from '../charts/MoreCharts'
import { card, ErrorBox, inputClass, inputStyle, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'
import { MODE_OPTIONS } from './SamplesTab'

type ChartSpec =
  | { kind: 'series'; technique: string; parameter: string }
  | { kind: 'hi_tmax' }
  | { kind: 'gas' }
  | { kind: 'pyro' }
  | { kind: 'alkanes' }

const PRESETS: { id: string; label: string; charts: ChartSpec[] }[] = [
  { id: 'custom', label: 'Personalizado (escolha técnica e parâmetro)', charts: [] },
  {
    id: 'cot',
    label: 'COT × temperatura (Rock-Eval e LECO)',
    charts: [
      { kind: 'series', technique: 'rockeval', parameter: 'TOC' },
      { kind: 'series', technique: 'leco', parameter: 'C' },
    ],
  },
  {
    id: 'hi_oi',
    label: 'HI e OI × temperatura',
    charts: [
      { kind: 'series', technique: 'rockeval', parameter: 'HI' },
      { kind: 'series', technique: 'rockeval', parameter: 'OI' },
    ],
  },
  { id: 'hi_tmax', label: 'HI × Tmax (tipo de querogênio)', charts: [{ kind: 'hi_tmax' }] },
  { id: 'hc', label: 'H/C atômica × temperatura (CHNSO)', charts: [{ kind: 'series', technique: 'chnso', parameter: 'HC_at' }] },
  {
    id: 's',
    label: 'Enxofre × temperatura (CHNSO e LECO)',
    charts: [
      { kind: 'series', technique: 'chnso', parameter: 'S' },
      { kind: 'series', technique: 'leco', parameter: 'S' },
    ],
  },
  { id: 'gas', label: 'Composição do gás por experimento', charts: [{ kind: 'gas' }] },
  {
    id: 'gas_mass',
    label: 'Massa de gás gerada × temperatura',
    charts: [
      { kind: 'series', technique: 'gas_balanco', parameter: 'gas_mass_g' },
      { kind: 'series', technique: 'gas_balanco', parameter: 'gas_yield_mg_g' },
    ],
  },
  { id: 'alkanes', label: 'Distribuição de n-alcanos (Py-GC-MS)', charts: [{ kind: 'alkanes' }] },
  { id: 'pyro', label: 'Sobreposição de pirogramas (Rock-Eval)', charts: [{ kind: 'pyro' }] },
]

function SeriesLoader({ projectId, spec, mode, split }: { projectId: number; spec: { technique: string; parameter: string }; mode: Mode; split: boolean }) {
  const { techniqueLabel } = useApp()
  const [data, setData] = useState<SeriesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    api
      .get<SeriesResponse>(`/projects/${projectId}/series?technique=${spec.technique}&parameter=${encodeURIComponent(spec.parameter)}&mode=${mode}&split_replicates=${split}`)
      .then(setData)
      .catch((err) => setError(String(err.message ?? err)))
  }, [projectId, spec.technique, spec.parameter, mode, split])
  if (error) return <ErrorBox message={error} />
  return <SeriesChart data={data} techniqueLabel={techniqueLabel(spec.technique)} />
}

/** Escolha de amostras para os gráficos por amostra (pirogramas, n-alcanos). */
export function SamplePicker({ samples, selected, onChange, max = 12 }: { samples: SampleRow[]; selected: number[]; onChange: (ids: number[]) => void; max?: number }) {
  const [q, setQ] = useState('')
  const shown = samples.filter((s) => s.code.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="rounded-lg border p-3" style={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Amostras ({selected.length} de {samples.length}; até {max})
        </span>
        <input className={`${inputClass} max-w-xs`} style={inputStyle} placeholder="Filtrar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar amostras" />
      </div>
      <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {shown.map((s) => {
          const on = selected.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(on ? selected.filter((x) => x !== s.id) : selected.length < max ? [...selected, s.id] : selected)}
              className="rounded-full border px-3 py-1 text-xs"
              style={{
                borderColor: on ? 'var(--color-primary)' : 'var(--color-border)',
                background: on ? 'var(--color-primary)' : 'transparent',
                color: on ? 'var(--color-primary-contrast)' : 'var(--color-text)',
              }}
              aria-pressed={on}
            >
              {s.code}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PyroSection({ projectId, samples, mode, initial }: { projectId: number; samples: SampleRow[]; mode: Mode; initial?: number[] }) {
  const withRe = useMemo(() => samples.filter((s) => s.techniques?.includes('rockeval')), [samples])
  const [selected, setSelected] = useState<number[]>(initial ?? [])
  const [curves, setCurves] = useState<AnalysisData<PyroData>[]>([])
  const [xAxis, setXAxis] = useState<'Temp' | 'Time'>('Temp')
  const [signal, setSignal] = useState('HC')
  useEffect(() => {
    if (!initial && selected.length === 0 && withRe.length) setSelected(withRe.slice(0, 4).map((s) => s.id))
  }, [withRe, selected.length, initial])
  useEffect(() => {
    if (initial) setSelected(initial)
  }, [initial])
  useEffect(() => {
    if (!selected.length) {
      setCurves([])
      return
    }
    api.get<AnalysisData<PyroData>[]>(`/projects/${projectId}/analysis-data?technique=rockeval&mode=${mode}&sample_ids=${selected.join(',')}`).then(setCurves)
  }, [projectId, selected, mode])
  const signals = Array.from(new Set(curves.flatMap((c) => c.data.pyro?.legend ?? []))).filter((k) => !['Time', 'Temp', 'T°'].includes(k))
  return (
    <div className="space-y-2">
      {!initial && <SamplePicker samples={withRe} selected={selected} onChange={setSelected} />}
      <div className="flex flex-wrap gap-2 text-sm">
        <select className={`${inputClass} w-auto`} style={inputStyle} value={signal} onChange={(e) => setSignal(e.target.value)} aria-label="Sinal">
          {(signals.length ? signals : ['HC']).map((s) => (
            <option key={s} value={s}>
              Sinal: {s}
            </option>
          ))}
        </select>
        <select className={`${inputClass} w-auto`} style={inputStyle} value={xAxis} onChange={(e) => setXAxis(e.target.value as 'Temp' | 'Time')} aria-label="Eixo X">
          <option value="Temp">Eixo X: temperatura</option>
          <option value="Time">Eixo X: tempo</option>
        </select>
      </div>
      <PyrogramChart curves={curves} xAxis={xAxis} signal={signal} />
    </div>
  )
}

export function AlkaneSection({ projectId, samples, mode, initial }: { projectId: number; samples: SampleRow[]; mode: Mode; initial?: number[] }) {
  const withPy = useMemo(() => samples.filter((s) => s.techniques?.includes('pygcms')), [samples])
  const [selected, setSelected] = useState<number[]>(initial ?? [])
  const [data, setData] = useState<AnalysisData<PyPeaks>[]>([])
  useEffect(() => {
    if (!initial && selected.length === 0 && withPy.length) setSelected(withPy.slice(0, 6).map((s) => s.id))
  }, [withPy, selected.length, initial])
  useEffect(() => {
    if (initial) setSelected(initial)
  }, [initial])
  useEffect(() => {
    if (!selected.length) {
      setData([])
      return
    }
    api.get<AnalysisData<PyPeaks>[]>(`/projects/${projectId}/analysis-data?technique=pygcms&mode=${mode}&sample_ids=${selected.join(',')}`).then(setData)
  }, [projectId, selected, mode])
  return (
    <div className="space-y-2">
      {!initial && <SamplePicker samples={withPy} selected={selected} onChange={setSelected} />}
      <AlkaneChart data={data} />
    </div>
  )
}

export function SeriesTab() {
  const { project } = useProject()
  const { catalog, fractionLabel } = useApp()
  const [preset, setPreset] = useState('cot')
  const [mode, setMode] = useState<Mode>('padrao')
  const [split, setSplit] = useState(false)
  const [technique, setTechnique] = useState('rockeval')
  const [parameter, setParameter] = useState('TOC')
  const { samples } = useSamples(project.id, mode)

  const current = PRESETS.find((p) => p.id === preset) ?? PRESETS[0]
  const charts: ChartSpec[] = preset === 'custom' ? [{ kind: 'series', technique, parameter }] : current.charts
  const params = catalog.find((t) => t.key === technique)?.params ?? []

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <select className={inputClass} style={inputStyle} value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Gráfico">
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select className={inputClass} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Validade">
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          Separar réplicas do experimento (A, B, C)
        </label>
      </div>
      {preset === 'custom' && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <select
            className={inputClass}
            style={inputStyle}
            value={technique}
            onChange={(e) => {
              setTechnique(e.target.value)
              setParameter(catalog.find((t) => t.key === e.target.value)?.params[0]?.key ?? '')
            }}
            aria-label="Técnica"
          >
            {catalog.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <select className={inputClass} style={inputStyle} value={parameter} onChange={(e) => setParameter(e.target.value)} aria-label="Parâmetro">
            {params.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
                {p.unit ? ` (${p.unit})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-xs" style={muted}>
        Cada ponto junta as amostras da mesma fração e temperatura: com várias amostras (ex.: réplicas A, B, C do experimento), média ± desvio
        entre elas; com uma só, média ± desvio das réplicas de análise. SE (sem extração) entra na mesma linha de H.
      </p>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {charts.map((spec, i) => {
          if (spec.kind === 'series') return <SeriesLoader key={`${spec.technique}.${spec.parameter}`} projectId={project.id} spec={spec} mode={mode} split={split} />
          if (spec.kind === 'hi_tmax') return <HiTmaxChart key={i} samples={samples ?? []} fractionLabel={fractionLabel} />
          if (spec.kind === 'gas') return <GasCompositionChart key={i} samples={samples ?? []} />
          if (spec.kind === 'pyro')
            return (
              <div key={i} className="xl:col-span-2">
                <PyroSection projectId={project.id} samples={samples ?? []} mode={mode} />
              </div>
            )
          return (
            <div key={i} className="xl:col-span-2">
              <AlkaneSection projectId={project.id} samples={samples ?? []} mode={mode} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
