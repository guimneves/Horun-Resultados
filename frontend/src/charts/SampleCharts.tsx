import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { api } from '../api/client'
import type { AnalysisData, PyPeaks, PyroData, SampleDetail, SampleRow } from '../api/types'
import { inputClass, inputStyle } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fractionColor } from '../lib/colors'
import { fmt, fmtTemp } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'
import { AlkaneChart, GasCompositionChart, PyrogramChart } from './MoreCharts'

// Gráficos do detalhe de UMA amostra: as curvas dela e onde ela fica em
// relação às outras amostras do projeto. A amostra aberta sempre em destaque
// (cor da fração, ponto maior com contorno); as demais em cinza neutro.

const OTHERS = '#9aa0ad'
const highlight = (fraction: string) => fractionColor(fraction)

function ParamSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: { col: string; label: string }[]
  onChange: (v: string) => void
  label: string
}) {
  return (
    <select className={`${inputClass} md:max-w-xs`} style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o.col} value={o.col}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------- elementos (CHNSO)

const ELEMENTS = ['C', 'H', 'N', 'S', 'O']

function ElementsChart({ detail }: { detail: SampleDetail }) {
  const rows = ELEMENTS.filter((e) => detail.values[`chnso.${e}`]?.mean != null).map((e) => {
    const s = detail.values[`chnso.${e}`]
    return { el: e, mean: s.mean as number, sd: s.sd ?? 0, n: s.n }
  })
  if (!rows.length) return null
  return (
    <ChartCard
      title="Composição elementar (CHNSO)"
      subtitle="Média em % de massa; a barra fina é o desvio-padrão entre réplicas"
      filename={`${detail.code}-chnso`}
      table={<SimpleTable head={['Elemento', 'Média (%)', 'Desvio', 'n']} rows={rows.map((r) => [r.el, fmt(r.mean), fmt(r.sd), r.n])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="el" {...axisProps} height={30} />
          <YAxis {...axisProps} width={40} unit="%" />
          <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v))} %`} />
          <Bar dataKey="mean" name="Média" fill={highlight(detail.fraction)} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <ErrorBar dataKey="sd" width={6} stroke="var(--color-text)" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- dispersão no projeto

function ProjectScatter({
  detail,
  samples,
  x,
  y,
  title,
  subtitle,
  xLabel,
  yLabel,
  refLinesX = [],
}: {
  detail: SampleDetail
  samples: SampleRow[]
  x: string
  y: string
  title: string
  subtitle: string
  xLabel: string
  yLabel: string
  refLinesX?: number[]
}) {
  const point = (s: SampleRow) => ({ code: s.code, x: s.values[x]?.mean as number, y: s.values[y]?.mean as number })
  const has = (s: SampleRow) => s.values[x]?.mean != null && s.values[y]?.mean != null
  if (detail.values[x]?.mean == null || detail.values[y]?.mean == null) return null
  const me = [point(detail)]
  const others = samples.filter((s) => s.id !== detail.id && has(s)).map(point)
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      filename={`${detail.code}-${title}`}
      table={
        <SimpleTable head={['Amostra', xLabel, yLabel]} rows={[...me, ...others].map((p, i) => [i === 0 ? `${p.code} (esta)` : p.code, fmt(p.x), fmt(p.y)])} />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          {refLinesX.map((v) => (
            <ReferenceLine key={v} x={v} stroke="var(--color-text-muted)" strokeDasharray="4 4" />
          ))}
          <XAxis type="number" dataKey="x" name={xLabel} domain={['auto', 'auto']} {...axisProps} height={36} tickFormatter={(v: number) => fmt(v)} />
          <YAxis type="number" dataKey="y" name={yLabel} domain={['auto', 'auto']} {...axisProps} width={52} tickFormatter={(v: number) => fmt(v)} />
          <ZAxis range={[60, 60]} />
          <Tooltip
            {...tooltipStyle}
            formatter={(v, n) => [fmt(Number(v)), n === 'x' ? xLabel : n === 'y' ? yLabel : String(n)]}
            labelFormatter={() => ''}
            cursor={{ strokeDasharray: '3 3' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Scatter name="Outras amostras do projeto" data={others} fill={OTHERS} fillOpacity={0.6} isAnimationActive={false} />
          <Scatter
            name={detail.code}
            data={me}
            fill={highlight(detail.fraction)}
            stroke="var(--color-text)"
            strokeWidth={2}
            shape="diamond"
            isAnimationActive={false}
            legendType="diamond"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- na série (mesma fração × temperatura)

function SeriesPosition({ detail, samples, options }: { detail: SampleDetail; samples: SampleRow[]; options: { col: string; label: string }[] }) {
  const { fractionLabel } = useApp()
  // começa por um parâmetro que costuma variar na série (COT, HI, C total, H/C)
  const preferred = ['rockeval.TOC', 'rockeval.HI', 'leco.C', 'chnso.HC_at'].find((c) => options.some((o) => o.col === c)) ?? options[0]?.col ?? ''
  const [col, setCol] = useState(preferred)
  const active = options.some((o) => o.col === col) ? col : preferred
  const label = options.find((o) => o.col === active)?.label ?? ''
  const line = samples
    .filter((s) => s.fraction === detail.fraction && s.temperature_c != null && s.values[active]?.mean != null)
    .map((s) => ({ t: s.temperature_c as number, v: s.values[active].mean as number, code: s.code }))
    .sort((a, b) => a.t - b.t)
  if (detail.temperature_c == null || !options.length) return null
  const me = detail.values[active]?.mean != null ? [{ t: detail.temperature_c, v: detail.values[active].mean as number, code: detail.code }] : []
  return (
    <ChartCard
      title={`Na série: ${fractionLabel(detail.fraction)}`}
      subtitle="Mesmo parâmetro nas amostras desta fração, por temperatura; esta amostra em destaque"
      filename={`${detail.code}-serie`}
      empty={line.length ? null : 'Sem outras amostras desta fração com este parâmetro.'}
      table={
        <SimpleTable
          head={['Amostra', 'Temperatura', label]}
          rows={line.map((p) => [p.code === detail.code ? `${p.code} (esta)` : p.code, fmtTemp(p.t), fmt(p.v)])}
        />
      }
    >
      <div className="flex h-full flex-col gap-2">
        <ParamSelect value={active} options={options} onChange={setCol} label="Parâmetro da série" />
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis
                type="number"
                dataKey="t"
                domain={['dataMin - 10', 'dataMax + 10']}
                unit=" °C"
                allowDuplicatedCategory={false}
                {...axisProps}
                height={32}
              />
              <YAxis type="number" {...axisProps} width={52} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip {...tooltipStyle} labelFormatter={(v) => `${fmt(Number(v))} °C`} formatter={(v) => fmt(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line data={line} dataKey="v" name={label} stroke={OTHERS} strokeWidth={2} dot={{ r: 3, fill: OTHERS }} isAnimationActive={false} />
              <Scatter
                data={me}
                dataKey="v"
                name={detail.code}
                fill={highlight(detail.fraction)}
                stroke="var(--color-text)"
                strokeWidth={2}
                shape="diamond"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- réplicas

function ReplicatesChart({ detail, options }: { detail: SampleDetail; options: { col: string; label: string }[] }) {
  // Cada valor medido (réplica/alíquota) de um parâmetro, com a média.
  const withReps = options.filter((o) => (detail.values[o.col]?.n ?? 0) > 1)
  const [col, setCol] = useState(withReps[0]?.col ?? '')
  const active = withReps.some((o) => o.col === col) ? col : (withReps[0]?.col ?? '')
  if (!withReps.length) return null
  const [tech, param] = active.split('.')
  const points = detail.analyses
    .filter((a) => a.technique === tech && a.valid !== false)
    .flatMap((a) =>
      a.values
        .filter((v) => v.parameter === param && v.value != null)
        .map((v) => ({
          label:
            [a.aliquot != null ? `alíq. ${a.aliquot}` : '', (v.replicate ?? a.replicate) != null ? `rep. ${v.replicate ?? a.replicate}` : '']
              .filter(Boolean)
              .join(' · ') || a.source_name,
          v: v.value as number,
        })),
    )
    .map((p, i) => ({ ...p, i: i + 1 }))
  const mean = detail.values[active]?.mean
  const label = withReps.find((o) => o.col === active)?.label ?? ''
  return (
    <ChartCard
      title="Réplicas"
      subtitle="Cada medição válida do parâmetro; a linha tracejada é a média"
      filename={`${detail.code}-replicas`}
      table={<SimpleTable head={['#', 'Medição', label]} rows={points.map((p) => [p.i, p.label, fmt(p.v)])} />}
    >
      <div className="flex h-full flex-col gap-2">
        <ParamSelect value={active} options={withReps} onChange={setCol} label="Parâmetro das réplicas" />
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis type="number" dataKey="i" name="Medição" domain={[0.5, points.length + 0.5]} ticks={points.map((p) => p.i)} {...axisProps} height={30} />
              <YAxis type="number" dataKey="v" name={label} domain={['auto', 'auto']} {...axisProps} width={52} tickFormatter={(v: number) => fmt(v)} />
              <ZAxis range={[70, 70]} />
              {mean != null && (
                <ReferenceLine
                  y={mean}
                  stroke="var(--color-text-muted)"
                  strokeDasharray="5 4"
                  label={{ value: 'média', fill: 'var(--color-text-muted)', fontSize: 11, position: 'insideTopRight' }}
                />
              )}
              <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} cursor={{ strokeDasharray: '3 3' }} />
              <Scatter name={label} data={points} fill={highlight(detail.fraction)} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- conjunto

export function SampleCharts({ projectId, detail, samples }: { projectId: number; detail: SampleDetail; samples: SampleRow[] }) {
  const { catalog, paramLabel, techniqueLabel } = useApp()
  const techs = useMemo(() => new Set(detail.analyses.map((a) => a.technique)), [detail])
  const [curves, setCurves] = useState<AnalysisData<PyroData>[]>([])
  const [peaks, setPeaks] = useState<AnalysisData<PyPeaks>[]>([])
  const [signal, setSignal] = useState('HC')

  useEffect(() => {
    // modo "todas": no detalhe, mostra também medições invalidadas da própria amostra
    if (techs.has('rockeval'))
      api
        .get<AnalysisData<PyroData>[]>(`/projects/${projectId}/analysis-data?technique=rockeval&mode=todas&sample_ids=${detail.id}`)
        .then(setCurves)
        .catch(() => setCurves([]))
    if (techs.has('pygcms'))
      api
        .get<AnalysisData<PyPeaks>[]>(`/projects/${projectId}/analysis-data?technique=pygcms&mode=todas&sample_ids=${detail.id}`)
        .then(setPeaks)
        .catch(() => setPeaks([]))
  }, [projectId, detail.id, techs])

  // parâmetros principais que a amostra tem (para "Na série" e "Réplicas")
  const options = catalog.flatMap((t) =>
    t.params
      .filter((p) => p.main && detail.values[`${t.key}.${p.key}`]?.mean != null)
      .map((p) => ({ col: `${t.key}.${p.key}`, label: `${techniqueLabel(t.key)} · ${paramLabel(`${t.key}.${p.key}`)}` })),
  )
  const signals = Array.from(new Set(curves.flatMap((c) => Object.keys(c.data.pyro?.series ?? {})))).filter((k) => !['Time', 'Temp', 'T°'].includes(k))
  const hasCurves = curves.some((c) => c.data.pyro)

  const charts = [
    hasCurves && (
      <div key="pyro" className="space-y-2">
        {signals.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Sinal do pirograma">
            {signals.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSignal(s)}
                aria-pressed={signal === s}
                className="rounded-md border px-2 py-1 text-xs"
                style={
                  signal === s
                    ? { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', borderColor: 'var(--color-primary)' }
                    : { borderColor: 'var(--color-border)' }
                }
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <PyrogramChart curves={curves} xAxis="Temp" signal={signals.includes(signal) ? signal : (signals[0] ?? 'HC')} />
      </div>
    ),
    peaks.length > 0 && <AlkaneChart key="alk" data={peaks} />,
    detail.fraction === 'G' && <GasCompositionChart key="gas" samples={[detail]} />,
    <ElementsChart key="el" detail={detail} />,
    <ProjectScatter
      key="hitmax"
      detail={detail}
      samples={samples}
      x="rockeval.Tmax"
      y="rockeval.HI"
      title="HI × Tmax no projeto"
      subtitle="Linhas em Tmax 435 e 470 °C (janela de óleo)"
      xLabel="Tmax (°C)"
      yLabel="HI (mg HC/g COT)"
      refLinesX={[435, 470]}
    />,
    <ProjectScatter
      key="vk"
      detail={detail}
      samples={samples}
      x="chnso.OC_at"
      y="chnso.HC_at"
      title="Van Krevelen no projeto"
      subtitle="Razões atômicas do CHNSO"
      xLabel="O/C atômica"
      yLabel="H/C atômica"
    />,
    <SeriesPosition key="serie" detail={detail} samples={samples} options={options} />,
    <ReplicatesChart key="reps" detail={detail} options={options} />,
  ].filter(Boolean)

  if (!detail.analyses.length) return null
  return (
    <section>
      <h3 className="mb-2 font-semibold">Gráficos</h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="sample-charts">
        {charts}
      </div>
    </section>
  )
}
