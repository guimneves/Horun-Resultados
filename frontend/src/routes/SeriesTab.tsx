import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { AnalysisData, MassesResponse, MassKey, Mode, PyPeaks, PyroData, SampleRow, SeriesResponse } from '../api/types'
import { ArticleView } from '../charts/ArticleCharts'
import { SourceChips } from '../charts/ChartCard'
import { hasMassData, MassChart } from '../charts/MassCharts'
import { SeriesChart } from '../charts/SeriesChart'
import { AlkaneChart, CorrelationChart, GasCompositionChart, gasTemperature, GasSeriesChart, hasGasComposition, HiTmaxChart, PyrogramChart, VanKrevelenChart } from '../charts/MoreCharts'
import { SelectChartsButton } from '../components/ChartSelection'
import { Button, card, Dropdown, ErrorBox, inputClass, inputStyle, muted, Segmented } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fractionAllowed, FRACTION_CHOICES, type FractionChoice } from '../lib/fractionFilter'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'
import { MODE_OPTIONS } from './SamplesTab'

// Painel de séries: grupos de gráficos (só aparecem os que têm dados no projeto).
type Extra = 'toc_leco' | 'hi_tmax' | 'vk' | 'gas' | 'gas_series' | 'alkanes' | 'pyro'
const SECTIONS: { id: string; label: string; series: string[]; extras: Extra[] }[] = [
  {
    id: 'mo',
    label: 'Matéria orgânica',
    series: ['rockeval.TOC', 'leco.C', 'chnso.C', 'rockeval.HI', 'rockeval.OI', 'rockeval.Tmax', 'rockeval.S1', 'rockeval.S2', 'rockeval.PI'],
    extras: ['toc_leco', 'hi_tmax'],
  },
  { id: 'el', label: 'Elementar', series: ['chnso.HC_at', 'chnso.OC_at', 'chnso.H', 'chnso.N', 'chnso.S', 'leco.S', 'leco_ri.RI_pct'], extras: ['vk'] },
  // Gases da hidropirólise (pedido do mantenedor, 09/10/2026): composição
  // (CO2, H2, C1–C5+) num gráfico só, e as séries separadas pelo detector —
  // FID = hidrocarbonetos, TCD = H2 e CO2 (da planilha de cálculo de gás ou da
  // tabela consolidada; % de área quando vierem as planilhas "Dados FID/TCD").
  { id: 'gas', label: 'Gás — composição', series: [], extras: ['gas_series'] },
  {
    id: 'fid',
    label: 'Gás — FID (hidrocarbonetos)',
    series: [
      'gas_balanco.comp_C1',
      'gas_balanco.comp_C2',
      'gas_balanco.comp_C3',
      'gas_balanco.comp_C4',
      'gas_balanco.comp_C5p',
      'gc_fid.pct_C1',
      'gc_fid.pct_C2',
      'gc_fid.pct_C3',
      'gc_fid.pct_C4',
      'gc_fid.pct_C5p',
      'gc_fid.wetness',
    ],
    extras: [],
  },
  {
    id: 'tcd',
    label: 'Gás — TCD (H₂ e CO₂)',
    series: ['gas_balanco.comp_H2', 'gas_balanco.comp_CO2', 'gc_tcd.pct_H2', 'gc_tcd.pct_CO2', 'gc_tcd.pct_C1', 'gc_tcd.pct_C2', 'gc_tcd.pct_C3'],
    extras: [],
  },
  { id: 'py', label: 'Py-GC-MS', series: ['pygcms.pr_ph', 'pygcms.pr_nc17', 'pygcms.ph_nc18', 'pygcms.cpi'], extras: ['alkanes'] },
  { id: 'pyro', label: 'Pirogramas', series: [], extras: ['pyro'] },
]
// Aba "Balanço de massas" (pedido do mantenedor, 08/10/2026): massas de óleo,
// gás e betume das corridas + os gráficos do balanço de gás.
const GAS_SERIES = ['gas_balanco.gas_mass_g', 'gas_balanco.gas_yield_mg_g', 'gc_fid.wetness']
const MASS_ORDER: MassKey[] = ['oil_mass_g', 'gas_mass_g', 'bitumen_mass_g']
// 'artigo': figuras do artigo de hidropirólise (charts/ArticleCharts.tsx)
type View = 'parametros' | 'massas' | 'artigo'
const VIEW_KEY = 'resultados.series.view'
const CUSTOM_KEY = (projectId: number) => `resultados.series.extra.${projectId}`

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'massas' || v === 'artigo' ? v : 'parametros'
  } catch {
    return 'parametros'
  }
}

function useMasses(projectId: number) {
  const [data, setData] = useState<MassesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    api
      .get<MassesResponse>(`/projects/${projectId}/experiments/masses`)
      .then(setData)
      .catch((err) => setError(String(err.message ?? err)))
  }, [projectId])
  return { data, error }
}

function readCustom(projectId: number): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY(projectId)) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function SeriesLoader({
  projectId,
  spec,
  mode,
  split,
  keepFraction,
}: {
  projectId: number
  spec: { technique: string; parameter: string }
  mode: Mode
  split: boolean
  keepFraction?: (fraction: string) => boolean
}) {
  const [data, setData] = useState<SeriesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    api
      .get<SeriesResponse>(
        `/projects/${projectId}/series?technique=${spec.technique}&parameter=${encodeURIComponent(spec.parameter)}&mode=${mode}&split_replicates=${split}`,
      )
      .then(setData)
      .catch((err) => setError(String(err.message ?? err)))
  }, [projectId, spec.technique, spec.parameter, mode, split])
  if (error) return <ErrorBox message={error} />
  return <SeriesChart data={data} keepFraction={keepFraction} />
}

/** Escolha de amostras para os gráficos por amostra (pirogramas, n-alcanos). */
export function SamplePicker({
  samples,
  selected,
  onChange,
  max = 12,
}: {
  samples: SampleRow[]
  selected: number[]
  onChange: (ids: number[]) => void
  max?: number
}) {
  const [q, setQ] = useState('')
  const shown = samples.filter((s) => s.code.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="rounded-lg border p-3" style={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Amostras ({selected.length} de {samples.length}; até {max})
        </span>
        <input
          className={`${inputClass} max-w-xs`}
          style={inputStyle}
          placeholder="Filtrar"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filtrar amostras"
        />
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
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Eixo X"
          value={xAxis}
          onChange={setXAxis}
          options={[
            { value: 'Temp', label: 'Temperatura' },
            { value: 'Time', label: 'Tempo' },
          ]}
        />
        <Segmented label="Sinal" value={signal} onChange={setSignal} options={(signals.length ? signals : ['HC']).map((x) => ({ value: x, label: x }))} />
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
  const { catalog, fractionLabel, paramLabel, techniqueLabel } = useApp()
  const [mode, setMode] = useState<Mode>('padrao')
  const [split, setSplit] = useState(false)
  const [onlyFraction, setOnlyFraction] = useState<FractionChoice>('todas')
  const [section, setSection] = useState('todos')
  const [custom, setCustom] = useState<string[]>(() => readCustom(project.id))
  const [adding, setAdding] = useState(false)
  const [technique, setTechnique] = useState('rockeval')
  const [parameter, setParameter] = useState('TOC')
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }
  const masses = useMasses(project.id)
  const { samples } = useSamples(project.id, mode)
  const keepFraction = (f: string) => fractionAllowed(f, onlyFraction)
  const list = (samples ?? []).filter((s) => keepFraction(s.fraction))

  const saveCustom = (next: string[]) => {
    setCustom(next)
    try {
      localStorage.setItem(CUSTOM_KEY(project.id), JSON.stringify(next))
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }
  const hasSeries = (col: string) => list.some((s) => s.temperature_c != null && s.values[col]?.mean != null)
  const hasExtra = (e: Extra) =>
    e === 'toc_leco'
      ? list.some((s) => s.values['rockeval.TOC'] && s.values['leco.C'])
      : e === 'hi_tmax'
        ? list.some((s) => s.values['rockeval.HI'] && s.values['rockeval.Tmax'])
        : e === 'vk'
          ? list.some((s) => s.values['chnso.HC_at'] && s.values['chnso.OC_at'])
          : e === 'gas'
            ? list.some((s) => s.fraction === 'G')
            : e === 'gas_series'
              ? list.some((s) => hasGasComposition(s) && gasTemperature(s) != null)
            : e === 'alkanes'
              ? list.some((s) => s.techniques?.includes('pygcms'))
              : list.some((s) => s.techniques?.includes('rockeval'))
  const sections = SECTIONS.map((sec) => ({ ...sec, series: sec.series.filter(hasSeries), extras: sec.extras.filter(hasExtra) })).filter(
    (sec) => sec.series.length || sec.extras.length,
  )
  const shown = section === 'todos' ? sections : sections.filter((sec) => sec.id === section)
  const params = catalog.find((t) => t.key === technique)?.params ?? []
  const chart = (col: string) => {
    const [t, p] = col.split('.')
    return <SeriesLoader key={col} projectId={project.id} spec={{ technique: t, parameter: p }} mode={mode} split={split} keepFraction={keepFraction} />
  }
  const optionsActive = [mode !== 'padrao', split, onlyFraction !== 'todas'].filter(Boolean).length
  // de quais análises vem cada grupo (etiquetas no título do grupo)
  const EXTRA_SOURCES: Record<Extra, string[]> = {
    toc_leco: ['rockeval', 'leco'],
    hi_tmax: ['rockeval'],
    vk: ['chnso'],
    gas: ['gas_balanco', 'gc_fid'],
    gas_series: ['gas_balanco'],
    alkanes: ['pygcms'],
    pyro: ['rockeval'],
  }
  const sectionSources = (sec: { series: string[]; extras: Extra[] }) =>
    Array.from(new Set([...sec.series.map((c) => c.split('.')[0]), ...sec.extras.flatMap((e) => EXTRA_SOURCES[e])]))
  const extra = (e: Extra) => {
    if (e === 'toc_leco')
      return (
        <CorrelationChart
          key={e}
          samples={list}
          x="leco.C"
          y="rockeval.TOC"
          xLabel="C total LECO (%)"
          yLabel="COT Rock-Eval (%)"
          title="COT (Rock-Eval) × C total (LECO)"
          fractionLabel={fractionLabel}
        />
      )
    if (e === 'hi_tmax') return <HiTmaxChart key={e} samples={list} fractionLabel={fractionLabel} />
    if (e === 'vk') return <VanKrevelenChart key={e} samples={list} fractionLabel={fractionLabel} />
    if (e === 'gas') return <GasCompositionChart key={e} samples={list} />
    if (e === 'gas_series')
      return (
        <div key={e} className="xl:col-span-2">
          <GasSeriesChart samples={list} />
        </div>
      )
    if (e === 'alkanes')
      return (
        <div key={e} className="xl:col-span-2">
          <AlkaneSection projectId={project.id} samples={list} mode={mode} />
        </div>
      )
    return (
      <div key={e} className="xl:col-span-2">
        <PyroSection projectId={project.id} samples={list} mode={mode} />
      </div>
    )
  }
  const massCharts = MASS_ORDER.filter((m) => hasMassData(masses.data, m))
  const gasSeries = GAS_SERIES.filter(hasSeries)
  const gasComposition = hasExtra('gas')
  const gasByTemperature = hasExtra('gas_series')
  const balanceSources = Array.from(
    new Set([
      ...(massCharts.length ? ['Condições experimentais'] : []),
      ...gasSeries.map((c) => c.split('.')[0]),
      ...(gasComposition || gasByTemperature ? EXTRA_SOURCES.gas : []),
    ]),
  )
  const groups = [
    { value: 'todos', label: 'Todos' },
    ...sections.map((sec) => ({ value: sec.id, label: sec.label })),
    ...(custom.length ? [{ value: 'meus', label: 'Meus gráficos' }] : []),
  ]

  return (
    <div className="space-y-4">
      <Segmented
        label="Vista"
        value={view}
        onChange={setView}
        options={[
          { value: 'parametros', label: 'Parâmetros' },
          { value: 'massas', label: 'Balanço de massas' },
          { value: 'artigo', label: 'Artigo' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        {view === 'parametros' && <Segmented label="Grupo de gráficos" value={section} onChange={setSection} options={groups} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SelectChartsButton />
          {view === 'parametros' && <Button onClick={() => setAdding((v) => !v)}>+ Gráfico</Button>}
          <Dropdown label={`Opções${optionsActive ? ` (${optionsActive})` : ''}`} ariaLabel="Opções dos gráficos">
            <div className="space-y-2 p-2 text-sm" onClick={(e) => e.stopPropagation()}>
              <label className="block">
                <span className="mb-1 block text-xs" style={muted}>
                  Quais medições entram
                </span>
                <select className={inputClass} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Validade">
                  {MODE_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs" style={muted}>
                  Tratar apenas
                </span>
                <select
                  className={inputClass}
                  style={inputStyle}
                  value={onlyFraction}
                  onChange={(e) => setOnlyFraction(e.target.value as FractionChoice)}
                  aria-label="Tratar apenas"
                >
                  {FRACTION_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
                Separar réplicas A, B, C
              </label>
            </div>
          </Dropdown>
        </div>
      </div>

      {onlyFraction !== 'todas' && (
        <p className="text-sm" style={muted} role="status">
          Mostrando {onlyFraction === 'extraidas' ? 'só as frações extraídas' : 'só as frações normais (sem extração)'} — mude em Opções.
        </p>
      )}

      {view === 'massas' && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-x-3">
            <h2 className="font-semibold">Balanço de massas</h2>
            <SourceChips sources={balanceSources} />
          </div>
          <ErrorBox message={masses.error} />
          {masses.data === null && !masses.error ? (
            <p style={muted}>Carregando…</p>
          ) : massCharts.length === 0 && gasSeries.length === 0 && !gasComposition && !gasByTemperature ? (
            <p style={muted}>
              Sem massas nem dados de gás ainda. Digite as massas de óleo, gás e betume em Condições experimentais, ou importe a planilha de cálculo de gás.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {massCharts.map((m) => (
                <MassChart key={m} data={masses.data as MassesResponse} mass={m} />
              ))}
              {/* composição × temperatura também aqui, junto dos outros gráficos de gás */}
              {gasByTemperature && extra('gas_series')}
              {gasSeries.map(chart)}
              {gasComposition && extra('gas')}
            </div>
          )}
          <p className="mt-2 text-xs" style={muted}>
            Massas de óleo, gás e betume: digitadas por réplica em Condições experimentais (gás: o da planilha de cálculo de gás, ou o valor editado). Cada
            ponto cheio é a média ± desvio das réplicas da amostra (ex.: HP300NA, NB, NC → HP300N); valores 0 ou vazios não entram. Todos os gráficos de gás
            (inclusive "Massa de gás gerada" e "gás por massa de rocha") usam o valor editado quando houver.
          </p>
        </section>
      )}

      {view === 'artigo' && <ArticleView projectId={project.id} mode={mode} />}

      {view === 'parametros' && adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3" style={card}>
          <select
            className={`${inputClass} w-auto`}
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
          <select className={`${inputClass} w-auto`} style={inputStyle} value={parameter} onChange={(e) => setParameter(e.target.value)} aria-label="Parâmetro">
            {params.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
                {p.unit ? ` (${p.unit})` : ''}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            onClick={() => {
              const col = `${technique}.${parameter}`
              if (!custom.includes(col)) saveCustom([...custom, col])
              setAdding(false)
              setSection('meus')
            }}
          >
            Adicionar
          </Button>
          <span className="text-xs" style={muted}>
            Fica guardado neste navegador, em "Meus gráficos".
          </span>
        </div>
      )}

      {view === 'parametros' && sections.length === 0 && !custom.length && (
        <p style={muted}>Sem resultados com temperatura ainda. Comece por Importar resultados.</p>
      )}

      {view === 'parametros' && (section === 'todos' || section === 'meus') && custom.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Meus gráficos</h2>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {custom.map((col) => (
              <div key={col} className="space-y-1">
                {chart(col)}
                <Button variant="ghost" onClick={() => saveCustom(custom.filter((c) => c !== col))}>
                  Tirar "{techniqueLabel(col.split('.')[0])} {paramLabel(col)}" de Meus gráficos
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {view === 'parametros' &&
        section !== 'meus' &&
        shown.map((sec) => (
          <section key={sec.id}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3">
              <h2 className="font-semibold">{sec.label}</h2>
              <SourceChips sources={sectionSources(sec)} />
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {sec.series.map(chart)}
              {sec.extras.map(extra)}
            </div>
          </section>
        ))}

      <p className="text-xs" style={muted} hidden={view !== 'parametros'}>
        Cada ponto junta as amostras da mesma fração e temperatura: com várias amostras (ex.: réplicas A, B, C do experimento), média ± desvio entre elas; com
        uma só, média ± desvio das réplicas de análise. SE (sem extração) entra na mesma linha de H.
      </p>
    </div>
  )
}
