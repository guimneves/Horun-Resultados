import {
  Bar,
  BarChart,
  CartesianGrid,
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
    .map((s) => ({ code: s.code, fraction: s.fraction, hi: s.values['rockeval.HI'].mean as number, tmax: s.values['rockeval.Tmax'].mean as number }))
  const fractions = Array.from(new Set(points.map((p) => p.fraction)))
  return (
    <ChartCard
      title="HI × Tmax"
      subtitle="Campos de querogênio aproximados; linhas em Tmax 435 e 470 °C (janela de óleo)"
      empty={points.length ? null : 'Sem amostras com HI e Tmax (Rock-Eval).'}
      table={
        <SimpleTable head={['Amostra', 'Fração', 'Tmax (°C)', 'HI']} rows={points.map((p) => [p.code, fractionLabel(p.fraction), fmt(p.tmax), fmt(p.hi)])} />
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
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {fractions.map((f) => (
            <Scatter
              key={f}
              name={fractionLabel(f)}
              data={points.filter((p) => p.fraction === f)}
              fill={fractionColor(f)}
              stroke="var(--color-bg-elevated)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
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
      subtitle={`Rock-Eval, pirólise · eixo X: ${xAxis === 'Temp' ? 'temperatura (°C)' : 'tempo'} · sinal em µg/g rocha/s`}
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
      title="Distribuição de n-alcanos (Py-GC-MS)"
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
    .map((s) => ({ code: s.code, fraction: s.fraction, hc: s.values['chnso.HC_at'].mean as number, oc: s.values['chnso.OC_at'].mean as number }))
  const fractions = Array.from(new Set(points.map((p) => p.fraction)))
  return (
    <ChartCard
      title="Van Krevelen (H/C × O/C)"
      subtitle="Razões atômicas do CHNSO, por fração"
      empty={points.length ? null : 'Sem amostras com H/C e O/C (CHNSO com oxigênio).'}
      table={<SimpleTable head={['Amostra', 'Fração', 'O/C', 'H/C']} rows={points.map((p) => [p.code, fractionLabel(p.fraction), fmt(p.oc), fmt(p.hc)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis type="number" dataKey="oc" name="O/C" domain={[0, 'auto']} {...axisProps} height={36} tickFormatter={(v: number) => fmt(v)} />
          <YAxis type="number" dataKey="hc" name="H/C" domain={[0, 'auto']} {...axisProps} width={48} tickFormatter={(v: number) => fmt(v)} />
          <ZAxis range={[70, 70]} />
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {fractions.map((f) => (
            <Scatter
              key={f}
              name={fractionLabel(f)}
              data={points.filter((p) => p.fraction === f)}
              fill={fractionColor(f)}
              stroke="var(--color-bg-elevated)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------- comparação

export function CompareBarChart({ samples, column, label }: { samples: SampleRow[]; column: string; label: string }) {
  const rows = samples
    .filter((s) => s.values[column]?.mean != null)
    .map((s) => ({ code: s.code, mean: s.values[column].mean as number, fraction: s.fraction, stat: s.values[column] }))
  return (
    <ChartCard
      title={label}
      subtitle="Média ± desvio de cada amostra escolhida"
      empty={rows.length ? null : 'Nenhuma das amostras escolhidas tem este parâmetro.'}
      table={<SimpleTable head={['Amostra', label]} rows={rows.map((r) => [r.code, fmtMeanSd(r.stat)])} />}
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
