import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { AnalysisData, PyPeaks, PyroData, SampleRow } from '../api/types'
import { dashFor, fractionColor, GAS_COLORS, seriesColor } from '../lib/colors'
import { fmt, fmtMeanSd } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'
import { pointId, pointLabels, pointText, PointTooltip } from './PointLabels'

// ---------------------------------------------------------------- HI × Tmax

// Campos de tipo de querogênio (simplificado, faixas usuais de HI) e janela
// de óleo (Tmax 435–470 °C) — referência visual, não classificação.
const KEROGEN_BANDS = [
  { y1: 600, y2: 1000, label: 'Tipo I' },
  { y1: 300, y2: 600, label: 'Tipo II' },
  { y1: 200, y2: 300, label: 'Tipo II/III' },
  { y1: 50, y2: 200, label: 'Tipo III' },
  { y1: 0, y2: 50, label: 'Tipo IV' },
]

export function HiTmaxChart({ samples, fractionLabel }: { samples: SampleRow[]; fractionLabel: (c: string) => string }) {
  const points = samples
    .filter((s) => s.values['rockeval.HI']?.mean != null && s.values['rockeval.Tmax']?.mean != null)
    .map((s) => ({ ...pointId(s), fraction: s.fraction, hi: s.values['rockeval.HI'].mean as number, tmax: s.values['rockeval.Tmax'].mean as number }))
  const fractions = Array.from(new Set(points.map((p) => p.fraction)))
  return (
    <ChartCard
      title="HI × Tmax"
      sources={['rockeval']}
      subtitle="Campos de querogênio aproximados; linhas em Tmax 435 e 470 °C (janela de óleo)"
      empty={points.length ? null : 'Sem amostras com HI e Tmax (Rock-Eval).'}
      table={
        <SimpleTable
          head={['Amostra', 'Fração', 'Tmax (°C)', 'HI']}
          rows={points.map((p) => [pointText(p), fractionLabel(p.fraction), fmt(p.tmax), fmt(p.hi)])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          {KEROGEN_BANDS.map((b, i) => (
            <ReferenceArea
              key={b.label}
              y1={b.y1}
              y2={b.y2}
              fill={i % 2 ? 'var(--color-surface)' : 'transparent'}
              fillOpacity={0.6}
              label={{ value: b.label, position: 'insideRight', fill: 'var(--color-text-muted)', fontSize: 11 }}
              ifOverflow="hidden"
            />
          ))}
          <ReferenceLine x={435} stroke="var(--color-text-muted)" strokeDasharray="4 4" />
          <ReferenceLine x={470} stroke="var(--color-text-muted)" strokeDasharray="4 4" />
          <XAxis type="number" dataKey="tmax" name="Tmax" unit=" °C" domain={['dataMin - 10', 'dataMax + 10']} {...axisProps} height={36} />
          <YAxis type="number" dataKey="hi" name="HI" domain={[0, 'auto']} {...axisProps} width={48} />
          <ZAxis range={[70, 70]} />
          <Tooltip content={<PointTooltip xKey="tmax" yKey="hi" xLabel="Tmax (°C)" yLabel="HI" />} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {fractions.map((f) => {
            const data = points.filter((p) => p.fraction === f)
            return (
              <Scatter
                key={f}
                name={fractionLabel(f)}
                data={data}
                fill={fractionColor(f)}
                stroke="var(--color-bg-elevated)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {pointLabels(data)}
              </Scatter>
            )
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- gás

const GAS_PARTS = [
  { key: 'H2', label: 'H₂' },
  { key: 'CO2', label: 'CO₂' },
  { key: 'C1', label: 'C1' },
  { key: 'C2', label: 'C2' },
  { key: 'C3', label: 'C3' },
  { key: 'C4', label: 'C4' },
  { key: 'C5p', label: 'C5+' },
]

/** Composição do gás por experimento, empilhada (soma 100%). Usa a
 * planilha de cálculo de gás (normalizada, sem o gás de enchimento); sem
 * ela, a distribuição de hidrocarbonetos do GC-FID. */
export function GasCompositionChart({ samples }: { samples: SampleRow[] }) {
  const rows = samples
    .filter((s) => s.fraction === 'G')
    .map((s) => {
      const fromBalance = GAS_PARTS.some((p) => s.values[`gas_balanco.comp_${p.key}`])
      const row: Record<string, string | number> = { code: (s.experiment_code ?? s.code).replace(' (gás)', ''), source: fromBalance ? 'balanço' : 'GC-FID' }
      GAS_PARTS.forEach((p) => {
        const v = fromBalance ? s.values[`gas_balanco.comp_${p.key}`] : s.values[`gc_fid.pct_${p.key}`]
        if (v?.mean != null) row[p.key] = v.mean
      })
      row.temp = s.temperature_c ?? 0
      return row
    })
    .filter((r) => GAS_PARTS.some((p) => r[p.key] !== undefined))
    .sort((a, b) => Number(a.temp) - Number(b.temp))
  const onlyFid = rows.length > 0 && rows.every((r) => r.source === 'GC-FID')
  return (
    <ChartCard
      title="Composição do gás por experimento"
      sources={rows.some((r) => r.source === 'balanço') ? ['gas_balanco', 'gc_fid'] : ['gc_fid']}
      subtitle={
        onlyFid ? 'Só hidrocarbonetos (GC-FID, % de área)' : 'Planilha de cálculo de gás, normalizada sem o gás de enchimento (%); GC-FID quando faltar'
      }
      empty={rows.length ? null : 'Sem dados de gás (importe a planilha de cálculo de gás ou o GC-FID).'}
      table={
        <SimpleTable
          head={['Experimento', 'Fonte', ...GAS_PARTS.map((p) => `${p.label} (%)`)]}
          rows={rows.map((r) => [r.code, r.source, ...GAS_PARTS.map((p) => (r[p.key] !== undefined ? fmt(Number(r[p.key])) : '—'))])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="code" {...axisProps} interval={0} angle={-30} textAnchor="end" height={56} />
          <YAxis {...axisProps} width={40} domain={[0, 100]} unit="%" />
          <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v))} %`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {GAS_PARTS.map((p, i) => (
            <Bar
              key={p.key}
              dataKey={p.key}
              name={p.label}
              stackId="gas"
              fill={GAS_COLORS[p.key]}
              stroke="var(--color-bg-elevated)"
              strokeWidth={1}
              radius={i === GAS_PARTS.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Temperatura de uma amostra com dados de gás: a da amostra ou, se faltar,
 * a do código do experimento (HP320NA2 → 320). */
export function gasTemperature(s: SampleRow): number | null {
  if (s.temperature_c != null) return s.temperature_c
  const m = /^[A-Z]*?(\d{3})/i.exec((s.experiment_code ?? s.code).replace(/\s+/g, ''))
  return m ? Number(m[1]) : null
}

/** Amostra com composição do gás (de qualquer fração: o gás pode ter sido
 * ligado a uma amostra que não é a "(gás)"). */
export function hasGasComposition(s: SampleRow): boolean {
  return Object.keys(s.values).some((k) => k.startsWith('gas_balanco.comp_') && s.values[k]?.mean != null)
}

/** Amostra com dados de gás do FID/TCD (planilhas "Dados FID"/"Dados TCD"). */
export function hasGcData(s: SampleRow, tech: 'gc_fid' | 'gc_tcd'): boolean {
  return Object.keys(s.values).some((k) => k.startsWith(`${tech}.pct_`) && s.values[k]?.mean != null)
}

type GasKey = 'H2' | 'CO2' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5p'

/** Gás × temperatura em BARRAS (pedido do mantenedor, 09/10/2026) — base dos
 * gráficos "Composição do gás × temperatura" (empilhado, soma 100%),
 * "Gás — FID" (C1–C5+) e "Gás — TCD" (H₂ e CO₂), lado a lado. Valor = composição
 * da planilha de cálculo de gás / tabela consolidada (% molar sem o gás de
 * enchimento); sem ela, o % de área do GC-FID/GC-TCD. Experimentos da mesma
 * temperatura (A, B, C...) viram média ± desvio. */
export function GasBarsChart({
  samples,
  keys,
  title,
  subtitle,
  stacked = false,
}: {
  samples: SampleRow[]
  keys: GasKey[]
  title: string
  subtitle: string
  stacked?: boolean
}) {
  const parts = keys.map((k) => GAS_PARTS.find((p) => p.key === k)!)
  const byTemp = new Map<number, { codes: string[]; sources: Set<string>; values: Record<string, number[]> }>()
  for (const s of samples) {
    const temp = gasTemperature(s)
    if (temp == null) continue
    const fromBalance = parts.some((p) => s.values[`gas_balanco.comp_${p.key}`]?.mean != null)
    const tech = (k: string) => (k === 'H2' || k === 'CO2' ? 'gc_tcd' : 'gc_fid')
    const vals = parts
      .map((p) => [p.key, fromBalance ? s.values[`gas_balanco.comp_${p.key}`]?.mean : s.values[`${tech(p.key)}.pct_${p.key}`]?.mean] as const)
      .filter(([, v]) => v != null)
    if (!vals.length) continue
    const entry = byTemp.get(temp) ?? { codes: [], sources: new Set<string>(), values: {} }
    entry.codes.push((s.experiment_code ?? s.code).replace(' (gás)', ''))
    entry.sources.add(fromBalance ? 'balanço' : 'GC')
    for (const [k, v] of vals) (entry.values[k] ??= []).push(v as number)
    byTemp.set(temp, entry)
  }
  const stats = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : null
    return { mean, sd }
  }
  const rows = [...byTemp.entries()]
    .sort(([a], [b]) => a - b)
    .map(([temp, e]) => {
      const row: Record<string, number | string | null> = { t: `${temp}`, temp, codes: e.codes.join(', '), source: [...e.sources].join(' + ') }
      for (const p of parts) {
        const xs = e.values[p.key]
        if (xs?.length) {
          const st = stats(xs)
          row[p.key] = st.mean
          row[`${p.key}_sd`] = st.sd ?? 0
          row[`${p.key}_sdText`] = st.sd
        }
      }
      return row
    })
  const onlyGc = rows.length > 0 && rows.every((r) => r.source === 'GC')
  const sources = onlyGc ? [...new Set(keys.map((k) => (k === 'H2' || k === 'CO2' ? 'gc_tcd' : 'gc_fid')))] : ['gas_balanco']
  return (
    <ChartCard
      title={title}
      subtitle={`${subtitle} · ${onlyGc ? '% de área (GC)' : '% molar sem o gás de enchimento'}${stacked ? '' : ' · média ± desvio entre os experimentos da mesma temperatura'}`}
      sources={sources}
      empty={rows.length ? null : 'Sem dados de gás (importe a planilha de cálculo de gás, a tabela consolidada ou o GC).'}
      table={
        <SimpleTable
          head={['Temp. (°C)', 'Experimentos', 'Fonte', ...parts.map((p) => `${p.label} (%)`)]}
          rows={rows.map((r) => [
            Number(r.temp),
            String(r.codes),
            String(r.source),
            ...parts.map((p) =>
              r[p.key] != null ? `${fmt(Number(r[p.key]))}${r[`${p.key}_sdText`] != null ? ` ± ${fmt(Number(r[`${p.key}_sdText`]))}` : ''}` : '—',
            ),
          ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={1} barCategoryGap={stacked ? '25%' : '18%'}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="t"
            {...axisProps}
            label={{ value: 'Temperatura (°C)', position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis {...axisProps} width={44} unit="%" domain={stacked ? [0, 100] : [0, 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(t) => `${t} °C`} formatter={(v, name) => [`${fmt(Number(v))} %`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {parts.map((p, i) => (
            <Bar
              key={p.key}
              dataKey={p.key}
              name={p.label}
              fill={GAS_COLORS[p.key]}
              stackId={stacked ? 'gas' : undefined}
              stroke={stacked ? 'var(--color-bg-elevated)' : undefined}
              strokeWidth={stacked ? 1 : 0}
              radius={stacked ? (i === parts.length - 1 ? [4, 4, 0, 0] : 0) : [3, 3, 0, 0]}
              isAnimationActive={false}
            >
              {!stacked && <ErrorBar dataKey={`${p.key}_sd`} width={3} stroke="var(--color-text-muted)" direction="y" />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Composição do gás × temperatura (CO₂, H₂, C1–C4 e C5+), barras empilhadas. */
export function GasSeriesChart({ samples }: { samples: SampleRow[] }) {
  return (
    <GasBarsChart
      samples={samples}
      keys={['CO2', 'H2', 'C1', 'C2', 'C3', 'C4', 'C5p']}
      title="Composição do gás × temperatura"
      subtitle="CO₂, H₂, C1–C4 e C5+ (soma ≥ C5), empilhados (soma 100%)"
      stacked
    />
  )
}

// ---------------------------------------------------------------- pirogramas

export function PyrogramChart({ curves, xAxis, signal }: { curves: AnalysisData<PyroData>[]; xAxis: 'Temp' | 'Time'; signal: string }) {
  const lines = curves
    .filter((c) => c.data.pyro?.series[signal] && c.data.pyro.series[xAxis])
    .map((c) => {
      const s = c.data.pyro!.series
      return {
        id: c.analysis_id,
        name: c.replicate != null ? `${c.sample_code} · réplica ${c.replicate}` : c.sample_code,
        points: s[xAxis].map((x, i) => ({ x, y: s[signal][i] })),
      }
    })
  return (
    <ChartCard
      title={`Pirogramas sobrepostos — ${signal}`}
      sources={['rockeval']}
      subtitle={`Pirólise · eixo X: ${xAxis === 'Temp' ? 'temperatura (°C)' : 'tempo'} · sinal em µg/g rocha/s`}
      empty={lines.length ? null : 'Escolha amostras com curvas de Rock-Eval.'}
      table={
        <SimpleTable
          head={['Medição', 'Pontos', `Máximo de ${signal}`]}
          rows={lines.map((l) => [l.name, l.points.length, fmt(Math.max(...l.points.map((p) => p.y)))])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            allowDuplicatedCategory={false}
            {...axisProps}
            height={36}
            tickFormatter={(v: number) => fmt(v)}
          />
          <YAxis {...axisProps} width={48} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(v) => `${fmt(Number(v))}${xAxis === 'Temp' ? ' °C' : ''}`} formatter={(v) => fmt(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l, i) => (
            <Line
              key={l.id}
              name={l.name}
              data={l.points}
              dataKey="y"
              stroke={seriesColor(i)}
              strokeDasharray={dashFor(i)}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- n-alcanos

export function alkaneDistribution(peaks: PyPeaks['peaks']): { n: number; pct: number }[] {
  const byN = new Map<number, number>()
  peaks.forEach((p) => {
    if (p.n_carbon != null && p.area != null) byN.set(p.n_carbon, (byN.get(p.n_carbon) ?? 0) + p.area)
  })
  const total = Array.from(byN.values()).reduce((a, b) => a + b, 0)
  return Array.from(byN.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, area]) => ({ n, pct: total ? (100 * area) / total : 0 }))
}

export function AlkaneChart({ data }: { data: AnalysisData<PyPeaks>[] }) {
  const lines = data.map((d) => ({ id: d.analysis_id, name: d.sample_code, points: alkaneDistribution(d.data.peaks) })).filter((l) => l.points.length)
  const allN = Array.from(new Set(lines.flatMap((l) => l.points.map((p) => p.n)))).sort((a, b) => a - b)
  // uma linha por n-alcano, uma coluna por medição (barras finas lado a lado)
  const rows = allN.map((n) => {
    const row: Record<string, number | string> = { n: `C${n}` }
    lines.forEach((l) => {
      const p = l.points.find((x) => x.n === n)
      if (p) row[`m${l.id}`] = p.pct
    })
    return row
  })
  const barSize = Math.max(2, Math.min(8, Math.floor(24 / Math.max(1, lines.length))))
  return (
    <ChartCard
      title="Distribuição de n-alcanos"
      sources={['pygcms']}
      subtitle="Área de cada n-alcano em % da soma dos n-alcanos da amostra"
      empty={lines.length ? null : 'Sem dados de Py-GC-MS nas amostras escolhidas.'}
      table={
        <SimpleTable
          head={['n-alcano', ...lines.map((l) => l.name)]}
          rows={allN.map((n) => [`n-C${n}`, ...lines.map((l) => fmt(l.points.find((p) => p.n === n)?.pct))])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={1} barCategoryGap="20%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="n" {...axisProps} height={36} interval="preserveStartEnd" />
          <YAxis {...axisProps} width={40} unit="%" />
          <Tooltip {...tooltipStyle} labelFormatter={(v) => `n-${v}`} formatter={(v) => `${fmt(Number(v))} %`} cursor={{ fill: 'var(--color-surface)' }} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {lines.map((l, i) => (
            <Bar key={l.id} dataKey={`m${l.id}`} name={l.name} fill={seriesColor(i)} barSize={barSize} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- Van Krevelen

export function VanKrevelenChart({ samples, fractionLabel }: { samples: SampleRow[]; fractionLabel: (c: string) => string }) {
  const points = samples
    .filter((s) => s.values['chnso.HC_at']?.mean != null && s.values['chnso.OC_at']?.mean != null)
    .map((s) => ({ ...pointId(s), fraction: s.fraction, hc: s.values['chnso.HC_at'].mean as number, oc: s.values['chnso.OC_at'].mean as number }))
  const fractions = Array.from(new Set(points.map((p) => p.fraction)))
  return (
    <ChartCard
      title="Van Krevelen (H/C × O/C)"
      sources={['chnso']}
      subtitle="Razões atômicas, por fração"
      empty={points.length ? null : 'Sem amostras com H/C e O/C (CHNSO com oxigênio).'}
      table={
        <SimpleTable head={['Amostra', 'Fração', 'O/C', 'H/C']} rows={points.map((p) => [pointText(p), fractionLabel(p.fraction), fmt(p.oc), fmt(p.hc)])} />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis type="number" dataKey="oc" name="O/C" domain={[0, 'auto']} {...axisProps} height={36} tickFormatter={(v: number) => fmt(v)} />
          <YAxis type="number" dataKey="hc" name="H/C" domain={[0, 'auto']} {...axisProps} width={48} tickFormatter={(v: number) => fmt(v)} />
          <ZAxis range={[70, 70]} />
          <Tooltip content={<PointTooltip xKey="oc" yKey="hc" xLabel="O/C" yLabel="H/C" />} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {fractions.map((f) => {
            const data = points.filter((p) => p.fraction === f)
            return (
              <Scatter
                key={f}
                name={fractionLabel(f)}
                data={data}
                fill={fractionColor(f)}
                stroke="var(--color-bg-elevated)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {pointLabels(data)}
              </Scatter>
            )
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- comparação

export function CompareBarChart({ samples, column, label }: { samples: SampleRow[]; column: string; label: string }) {
  const rows = samples
    .filter((s) => s.values[column]?.mean != null)
    .map((s) => ({ ...pointId(s), mean: s.values[column].mean as number, fraction: s.fraction, stat: s.values[column] }))
  return (
    <ChartCard
      title={label}
      sources={[column.split('.')[0]]}
      subtitle="Média ± desvio de cada amostra escolhida"
      empty={rows.length ? null : 'Nenhuma das amostras escolhidas tem este parâmetro.'}
      table={<SimpleTable head={['Amostra', label]} rows={rows.map((r) => [pointText(r), fmtMeanSd(r.stat)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="code" {...axisProps} interval={0} angle={-30} textAnchor="end" height={56} />
          <YAxis {...axisProps} width={48} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} />
          <Bar dataKey="mean" name={label} radius={[4, 4, 0, 0]} isAnimationActive={false} fill="#2a78d6" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- correlação entre duas medidas

/** Reta de mínimos quadrados y = a·x + b e o R² (1 − SQres/SQtot). */
export function linearFit(points: { x: number; y: number }[]): { a: number; b: number; r2: number } | null {
  const n = points.length
  if (n < 3) return null
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const syy = points.reduce((s, p) => s + (p.y - my) ** 2, 0)
  if (sxx === 0 || syy === 0) return null
  const a = sxy / sxx
  const b = my - a * mx
  const ssRes = points.reduce((s, p) => s + (p.y - (a * p.x + b)) ** 2, 0)
  return { a, b, r2: 1 - ssRes / syy }
}

/** Uma medida contra a outra, amostra por amostra (ex.: COT do Rock-Eval × C
 * total do LECO), com a reta ajustada, o R² e a linha 1:1 de referência. */
export function CorrelationChart({
  samples,
  x,
  y,
  xLabel,
  yLabel,
  title,
  fractionLabel,
}: {
  samples: SampleRow[]
  x: string
  y: string
  xLabel: string
  yLabel: string
  title: string
  fractionLabel: (c: string) => string
}) {
  const points = samples
    .filter((s) => s.values[x]?.mean != null && s.values[y]?.mean != null)
    .map((s) => ({ ...pointId(s), fraction: s.fraction, x: s.values[x].mean as number, y: s.values[y].mean as number }))
  const fit = linearFit(points)
  const fractions = Array.from(new Set(points.map((p) => p.fraction)))
  const lo = Math.min(0, ...points.map((p) => Math.min(p.x, p.y)))
  const hi = Math.max(...points.map((p) => Math.max(p.x, p.y)), 1)
  const xs = points.map((p) => p.x)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const sign = fit && fit.b < 0 ? '−' : '+'
  const equation = fit ? `y = ${fmt(fit.a)}·x ${sign} ${fmt(Math.abs(fit.b))}` : ''
  return (
    <ChartCard
      title={title}
      sources={[x.split('.')[0], y.split('.')[0]]}
      subtitle={
        fit
          ? `${equation} · n = ${points.length} amostras · linha cheia: reta ajustada; tracejada: 1:1`
          : `Precisa de pelo menos 3 amostras com as duas medidas (há ${points.length}).`
      }
      empty={points.length ? null : 'Nenhuma amostra tem as duas medidas.'}
      table={
        <SimpleTable
          head={['Amostra', 'Fração', xLabel, yLabel, 'Diferença (y − x)']}
          rows={points.map((p) => [pointText(p), fractionLabel(p.fraction), fmt(p.x), fmt(p.y), fmt(p.y - p.x)])}
        />
      }
    >
      <div className="flex h-full flex-col">
        {fit && (
          <p className="mb-1 text-sm font-semibold tabular-nums" data-testid="r2">
            R² = {fit.r2.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis
                type="number"
                dataKey="x"
                name={xLabel}
                domain={[lo, Math.ceil(hi * 1.05)]}
                {...axisProps}
                height={40}
                tickFormatter={(v: number) => fmt(v)}
                label={{ value: xLabel, position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={yLabel}
                domain={[lo, Math.ceil(hi * 1.05)]}
                {...axisProps}
                width={52}
                tickFormatter={(v: number) => fmt(v)}
                label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--color-text-muted)', fontSize: 12 }}
              />
              <ZAxis range={[70, 70]} />
              <ReferenceLine
                segment={[
                  { x: lo, y: lo },
                  { x: hi, y: hi },
                ]}
                stroke="var(--color-text-muted)"
                strokeDasharray="4 4"
                ifOverflow="hidden"
              />
              {fit && (
                <ReferenceLine
                  segment={[
                    { x: x0, y: fit.a * x0 + fit.b },
                    { x: x1, y: fit.a * x1 + fit.b },
                  ]}
                  stroke="var(--color-text)"
                  strokeWidth={2}
                  ifOverflow="hidden"
                />
              )}
              <Tooltip content={<PointTooltip xKey="x" yKey="y" xLabel={xLabel} yLabel={yLabel} />} cursor={{ strokeDasharray: '3 3' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {fractions.map((f) => {
                const data = points.filter((p) => p.fraction === f)
                return (
                  <Scatter
                    key={f}
                    name={fractionLabel(f)}
                    data={data}
                    fill={fractionColor(f)}
                    stroke="var(--color-bg-elevated)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {pointLabels(data)}
                  </Scatter>
                )
              })}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartCard>
  )
}
