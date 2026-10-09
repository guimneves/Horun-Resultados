import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { Mode } from '../api/types'
import { Button, ErrorBox, inputClass, inputStyle, muted } from '../components/ui'
import { GAS_COLORS } from '../lib/colors'
import { fmt } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

// Séries → "Artigo" (pedido do mantenedor, 09/10/2026): figuras no estilo do
// Supporting Information do artigo de hidropirólise, com os dados do projeto
// (backend: services/article.py). Ficam de fora FRX, MEV e DRX (sem dados).

interface Stat {
  mean: number | null
  sd: number | null
  n: number
}
type Group = 'C1' | 'C2' | 'C3' | 'C4' | 'C5p' | 'H2' | 'CO2'
interface GasPoint {
  temperature_c: number
  experiments: string[]
  yields: Record<Group, Stat>
  mole_pct: Record<'H2' | 'C1' | 'CO2', Stat>
  h2_share: Stat
  gas_mass_g: Stat
  rock_g: Stat
  water_g: Stat
}
interface ResiduePoint {
  temperature_c: number
  samples: string[]
  after: Record<string, Stat>
  s2_depletion: number | null
  transformation_rate: number | null
}
export interface ArticleData {
  mode: Mode
  toc0: number | null
  toc0_source: string
  toc0_samples: string[]
  gas_problems: string[]
  yield_unit: string
  yields_estimated: boolean
  before: Record<string, number>
  gas: GasPoint[]
  residue: ResiduePoint[]
}

const BEFORE = '#9aa8b8'
const AFTER = '#2f5a8a'
const H2_COLOR = GAS_COLORS.H2
const LABELS: Record<Group, string> = { C1: 'C1', C2: 'C2', C3: 'C3', C4: 'C4', C5p: 'C5+', H2: 'H₂', CO2: 'CO₂' }

const xTemp = {
  type: 'number' as const,
  dataKey: 'temperature_c',
  domain: ['dataMin - 10', 'dataMax + 10'] as [string, string],
  ...axisProps,
  label: { value: 'Temperatura (°C)', position: 'insideBottom' as const, offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 },
  height: 40,
}
const dot = (color: string) => ({ r: 4, strokeWidth: 1.5, stroke: 'var(--color-bg-elevated)', fill: color })
const val = (s?: Stat) => (s?.mean != null ? s.mean : null)
const cell = (s?: Stat) => (s?.mean != null ? `${fmt(s.mean)}${s.sd != null ? ` ± ${fmt(s.sd)}` : ''}` : '—')

function YieldChart({ data, groups, title, figure }: { data: ArticleData; groups: Group[]; title: string; figure: string }) {
  const rows = data.gas
    .map((g) => ({
      temperature_c: g.temperature_c,
      ...Object.fromEntries(
        groups.flatMap((k) => [
          [k, val(g.yields[k])],
          [`${k}_sd`, g.yields[k]?.sd ?? 0],
        ]),
      ),
    }))
    .filter((r) => groups.some((k) => (r as Record<string, unknown>)[k] != null))
  return (
    <ChartCard
      title={`${figure} — ${title}`}
      subtitle={`Rendimento (${data.yield_unit}) × temperatura${data.yields_estimated ? ' · mols estimados pela composição e massa total de gás' : ''}`}
      sources={['gas_balanco']}
      empty={
        rows.length
          ? null
          : data.gas_problems.length
            ? `Sem rendimento calculável — ${data.gas_problems.join('; ')}.`
            : 'Sem balanço de gás importado (planilha de cálculo de gás ou tabela consolidada).'
      }
      table={
        <SimpleTable
          head={['Temp. (°C)', 'Experimentos', ...groups.map((k) => `${LABELS[k]} (${data.yield_unit})`)]}
          rows={data.gas.map((g) => [g.temperature_c, g.experiments.join(', '), ...groups.map((k) => cell(g.yields[k]))])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xTemp} />
          <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(t) => `${t} °C`} formatter={(v, n) => [`${fmt(Number(v))} ${data.yield_unit}`, String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {groups.map((k) => (
            <Line key={k} dataKey={k} name={LABELS[k]} stroke={GAS_COLORS[k]} strokeWidth={2} dot={dot(GAS_COLORS[k])} connectNulls isAnimationActive={false}>
              <ErrorBar dataKey={`${k}_sd`} width={4} stroke={GAS_COLORS[k]} direction="y" />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function MoleFractionChart({ data }: { data: ArticleData }) {
  const parts = [
    { key: 'H2', label: 'H₂', color: GAS_COLORS.H2, shape: 'circle' },
    { key: 'C1', label: 'CH₄', color: GAS_COLORS.C1, shape: 'square' },
    { key: 'CO2', label: 'CO₂', color: GAS_COLORS.CO2, shape: 'triangle' },
  ] as const
  const rows = data.gas.map((g) => ({ temperature_c: g.temperature_c, H2: val(g.mole_pct.H2), C1: val(g.mole_pct.C1), CO2: val(g.mole_pct.CO2) }))
  return (
    <ChartCard
      title="Figura 3a — Frações molares de H₂, CH₄ e CO₂"
      subtitle="% molar sem o gás de enchimento (N₂) × temperatura"
      sources={['gas_balanco']}
      empty={rows.some((r) => r.H2 != null || r.CO2 != null) ? null : 'Sem composição de gás.'}
      table={
        <SimpleTable
          head={['Temp. (°C)', 'H₂ (%)', 'CH₄ (%)', 'CO₂ (%)']}
          rows={data.gas.map((g) => [g.temperature_c, cell(g.mole_pct.H2), cell(g.mole_pct.C1), cell(g.mole_pct.CO2)])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xTemp} />
          <YAxis {...axisProps} width={44} unit="%" tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(t) => `${t} °C`} formatter={(v, n) => [`${fmt(Number(v))} %`, String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {parts.map((p) => (
            <Line
              key={p.key}
              dataKey={p.key}
              name={p.label}
              stroke={p.color}
              strokeWidth={2}
              legendType={p.shape}
              dot={<Marker shape={p.shape} color={p.color} />}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function Marker({ cx, cy, shape, color }: { cx?: number; cy?: number; shape: 'circle' | 'square' | 'triangle'; color: string }) {
  if (cx == null || cy == null) return null
  if (shape === 'square') return <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={color} />
  if (shape === 'triangle') return <path d={`M${cx},${cy - 5} L${cx + 5},${cy + 4} L${cx - 5},${cy + 4} Z`} fill={color} />
  return <circle cx={cx} cy={cy} r={4} fill={color} />
}

function SimpleLineChart({
  title,
  subtitle,
  rows,
  yLabel,
  color,
  sources,
  unit,
  table,
}: {
  title: string
  subtitle: string
  rows: { temperature_c: number; y: number | null; sd?: number | null }[]
  yLabel: string
  color: string
  sources: string[]
  unit: string
  table: { head: string[]; rows: (string | number)[][] }
}) {
  const shown = rows.filter((r) => r.y != null).map((r) => ({ ...r, sdBar: r.sd ?? 0 }))
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      sources={sources}
      empty={shown.length ? null : 'Sem dados para esta figura.'}
      table={<SimpleTable {...table} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={shown} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xTemp} />
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(t) => `${t} °C`} formatter={(v) => [`${fmt(Number(v))}${unit ? ` ${unit}` : ''}`, yLabel]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line dataKey="y" name={yLabel} stroke={color} strokeWidth={2} dot={dot(color)} isAnimationActive={false}>
            <ErrorBar dataKey="sdBar" width={4} stroke={color} direction="y" />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const ROCK: { key: string; label: string; unit: string }[] = [
  { key: 'TOC', label: 'COT', unit: '% peso' },
  { key: 'S1', label: 'S1', unit: 'mg HC/g rocha' },
  { key: 'S2', label: 'S2', unit: 'mg HC/g rocha' },
  { key: 'HI', label: 'HI', unit: 'mg HC/g COT' },
  { key: 'OI', label: 'OI', unit: 'mg CO₂/g COT' },
  { key: 'Tmax', label: 'Tmax', unit: '°C' },
]

function BeforeAfterChart({ data, param }: { data: ArticleData; param: (typeof ROCK)[number] }) {
  const before = data.before[param.key]
  const rows = data.residue
    .filter((r) => r.after[param.key]?.mean != null)
    .map((r) => ({ temperature_c: r.temperature_c, after: r.after[param.key].mean, before: before ?? null, sdBar: r.after[param.key].sd ?? 0 }))
  return (
    <ChartCard
      title={`Figura 4 — ${param.label} antes e depois`}
      subtitle={`${param.unit} · antes = rocha original (${data.toc0_samples.join(', ') || '—'}) · depois = rocha hidropirolisada (H/SE)`}
      sources={['rockeval']}
      empty={rows.length ? null : 'Sem Rock-Eval da rocha hidropirolisada.'}
      table={
        <SimpleTable
          head={['Temp. (°C)', 'Amostras', `Antes (${param.unit})`, `Depois (${param.unit})`]}
          rows={data.residue.map((r) => [r.temperature_c, r.samples.join(', '), before != null ? fmt(before) : '—', cell(r.after[param.key])])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xTemp} />
          <YAxis {...axisProps} width={52} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(t) => `${t} °C`} formatter={(v, n) => [`${fmt(Number(v))} ${param.unit}`, String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {before != null && <Line dataKey="before" name="Antes" stroke={BEFORE} strokeWidth={2} dot={dot(BEFORE)} isAnimationActive={false} />}
          <Line
            dataKey="after"
            name="Depois"
            stroke={AFTER}
            strokeWidth={2}
            legendType="square"
            dot={<Marker shape="square" color={AFTER} />}
            isAnimationActive={false}
          >
            <ErrorBar dataKey="sdBar" width={4} stroke={AFTER} direction="y" />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function TransformationChart({ data }: { data: ArticleData }) {
  const rows = data.residue
    .filter((r) => r.s2_depletion != null || r.transformation_rate != null)
    .map((r) => ({ temperature_c: r.temperature_c, s2: r.s2_depletion, tr: r.transformation_rate }))
  const S2C = '#9b3a6a'
  const TRC = '#6a4c9c'
  return (
    <ChartCard
      title="Figura 5 — Consumo de S2 e taxa de transformação"
      subtitle="Consumo de S2 = (S2₀ − S2)/S2₀ × 100 · taxa de transformação = (HI₀ − HI)/HI₀ × 100 · índice 0 = rocha original"
      sources={['rockeval']}
      empty={rows.length ? null : 'Precisa do Rock-Eval da rocha original e da rocha hidropirolisada.'}
      table={
        <SimpleTable
          head={['Temp. (°C)', 'Consumo de S2 (%)', 'Taxa de transformação (%)']}
          rows={rows.map((r) => [r.temperature_c, r.s2 != null ? fmt(r.s2) : '—', r.tr != null ? fmt(r.tr) : '—'])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xTemp} />
          <YAxis {...axisProps} width={44} unit="%" domain={[0, 100]} />
          <Tooltip {...tooltipStyle} labelFormatter={(t) => `${t} °C`} formatter={(v, n) => [`${fmt(Number(v))} %`, String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line dataKey="s2" name="Consumo de S2" stroke={S2C} strokeWidth={2} dot={dot(S2C)} connectNulls isAnimationActive={false} />
          <Line
            dataKey="tr"
            name="Taxa de transformação"
            stroke={TRC}
            strokeWidth={2}
            strokeDasharray="6 4"
            legendType="square"
            dot={<Marker shape="square" color={TRC} />}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function LoadingChart({ data }: { data: ArticleData }) {
  const rows = data.gas.map((g) => ({ t: String(g.temperature_c), rock: val(g.rock_g), water: val(g.water_g) })).filter((r) => r.rock != null)
  const hasWater = rows.some((r) => r.water != null)
  return (
    <ChartCard
      title="Figura 7a — Massa carregada no reator"
      subtitle={
        hasWater ? 'Rocha e água carregadas (g) por temperatura' : 'Rocha carregada (g) por temperatura — a massa de água não está nas planilhas importadas'
      }
      sources={['gas_balanco']}
      empty={rows.length ? null : 'Sem massa inicial de amostra.'}
      table={<SimpleTable head={['Temp. (°C)', 'Rocha (g)', 'Água (g)']} rows={data.gas.map((g) => [g.temperature_c, cell(g.rock_g), cell(g.water_g)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="t"
            {...axisProps}
            label={{ value: 'Temperatura (°C)', position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis {...axisProps} width={48} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v, n) => [`${fmt(Number(v))} g`, String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="rock" name="Rocha" fill="#9aa8b8" isAnimationActive={false} />
          {hasWater && <Bar dataKey="water" name="Água" fill="#d7e6ee" stroke="#9aa8b8" isAnimationActive={false} />}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function H2ScatterChart({ data, x }: { data: ArticleData; x: 'tmax' | 's2' }) {
  const res = new Map(data.residue.map((r) => [r.temperature_c, r]))
  const points = data.gas
    .map((g) => {
      const r = res.get(g.temperature_c)
      const xv = x === 'tmax' ? r?.after.Tmax?.mean : r?.s2_depletion
      return { x: xv ?? null, y: val(g.yields.H2), t: g.temperature_c }
    })
    .filter((p): p is { x: number; y: number; t: number } => p.x != null && p.y != null)
  const color = x === 'tmax' ? H2_COLOR : '#b5573b'
  const xLabel = x === 'tmax' ? 'Tmax depois (°C)' : 'Consumo de S2 (%)'
  return (
    <ChartCard
      title={`Figura 8${x === 'tmax' ? 'a' : 'b'} — Rendimento de H₂ × ${x === 'tmax' ? 'Tmax depois' : 'consumo de S2'}`}
      subtitle={`H₂ (${data.yield_unit}) das temperaturas com gás e Rock-Eval do resíduo; o número ao lado do ponto é a temperatura (°C)`}
      sources={['gas_balanco', 'rockeval']}
      empty={points.length ? null : 'Precisa do gás e do Rock-Eval da rocha hidropirolisada nas mesmas temperaturas.'}
      table={<SimpleTable head={['Temp. (°C)', xLabel, `H₂ (${data.yield_unit})`]} rows={points.map((p) => [p.t, fmt(p.x), fmt(p.y)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            domain={['auto', 'auto']}
            {...axisProps}
            tickFormatter={(v: number) => fmt(v)}
            label={{ value: xLabel, position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis type="number" dataKey="y" name="H₂" {...axisProps} width={56} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v, n) => [fmt(Number(v)), String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Scatter data={points} name="Rendimento de H₂" fill={color} isAnimationActive={false}>
            <LabelList dataKey="t" position="right" style={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const TOC0_KEY = (projectId: number) => `resultados.artigo.toc0.${projectId}`

export function ArticleView({ projectId, mode, hiddenTemps = [] }: { projectId: number; mode: Mode; hiddenTemps?: number[] }) {
  const [raw, setData] = useState<ArticleData | null>(null)
  // temperaturas ocultadas em Séries → Opções saem de todas as figuras
  const data = raw
    ? {
        ...raw,
        gas: raw.gas.filter((g) => !hiddenTemps.includes(g.temperature_c)),
        residue: raw.residue.filter((r) => !hiddenTemps.includes(r.temperature_c)),
      }
    : null
  const [error, setError] = useState<string | null>(null)
  // COT inicial digitado (fica neste navegador, por projeto); vazio = automático
  const [toc0, setToc0] = useState<string>(() => {
    try {
      return localStorage.getItem(TOC0_KEY(projectId)) ?? ''
    } catch {
      return ''
    }
  })
  const [draft, setDraft] = useState(toc0)
  useEffect(() => {
    setData(null)
    setError(null)
    const q = toc0.trim() ? `&toc0=${encodeURIComponent(toc0.trim().replace(',', '.'))}` : ''
    api
      .get<ArticleData>(`/projects/${projectId}/article?mode=${mode}${q}`)
      .then(setData)
      .catch((err) => setError(String(err.message ?? err)))
  }, [projectId, mode, toc0])
  const applyToc0 = (value: string) => {
    setToc0(value)
    setDraft(value)
    try {
      if (value.trim()) localStorage.setItem(TOC0_KEY(projectId), value)
      else localStorage.removeItem(TOC0_KEY(projectId))
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }
  if (error)
    return (
      <div className="space-y-2">
        <ErrorBox message={error} />
        {toc0 && <Button onClick={() => applyToc0('')}>Usar o COT inicial automático</Button>}
      </div>
    )
  if (!data) return <p style={muted}>Carregando…</p>
  const gasRows = (pick: (g: GasPoint) => Stat) => data.gas.map((g) => ({ temperature_c: g.temperature_c, y: val(pick(g)), sd: pick(g).sd }))
  return (
    <div className="space-y-3">
      <p className="text-sm" style={muted}>
        Figuras no estilo do Supporting Information do artigo de hidropirólise, com os dados deste projeto. Rendimentos em <strong>{data.yield_unit}</strong>
        {data.toc0 != null
          ? ` (COT inicial = ${fmt(data.toc0)} % — ${data.toc0_source})`
          : ' — sem COT inicial: importe o Rock-Eval ou o LECO da rocha original, ou digite o valor abaixo'}
        . Ficam de fora as figuras de FRX, MEV e DRX.
      </p>
      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          applyToc0(draft)
        }}
      >
        <label htmlFor="toc0" style={muted}>
          COT inicial (%)
        </label>
        <input
          id="toc0"
          className={`${inputClass} w-28`}
          style={inputStyle}
          inputMode="decimal"
          placeholder="automático"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit">Aplicar</Button>
        {toc0 && <Button onClick={() => applyToc0('')}>Usar o automático</Button>}
      </form>
      {data.gas_problems.length > 0 && (
        <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--color-surface)' }} role="status">
          Corridas de gás com dados faltando (ficam de fora dos rendimentos): {data.gas_problems.join('; ')}.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <YieldChart data={data} groups={['C1', 'C2', 'C3', 'C4', 'C5p']} title="Rendimento dos hidrocarbonetos C1–C5+" figure="Figura 1" />
        <YieldChart data={data} groups={['H2', 'CO2']} title="Rendimento de H₂ e CO₂" figure="Figura 2" />
        <MoleFractionChart data={data} />
        <SimpleLineChart
          title="Figura 3b — Participação do H₂ nos produtos medidos"
          subtitle="H₂ ÷ (C1–C5+ + CO₂ + H₂), em mols × 100"
          rows={gasRows((g) => g.h2_share)}
          yLabel="H₂ nos produtos (%)"
          color={H2_COLOR}
          sources={['gas_balanco']}
          unit="%"
          table={{ head: ['Temp. (°C)', 'H₂ nos produtos (%)'], rows: data.gas.map((g) => [g.temperature_c, cell(g.h2_share)]) }}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ROCK.map((p) => (
          <BeforeAfterChart key={p.key} data={data} param={p} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TransformationChart data={data} />
        <LoadingChart data={data} />
        <SimpleLineChart
          title="Figura 7b — Massa de gás recuperada"
          subtitle="g × temperatura (vale a massa editada em Condições experimentais)"
          rows={gasRows((g) => g.gas_mass_g)}
          yLabel="Massa de gás (g)"
          color="#5b6670"
          sources={['gas_balanco']}
          unit="g"
          table={{
            head: ['Temp. (°C)', 'Experimentos', 'Massa de gás (g)'],
            rows: data.gas.map((g) => [g.temperature_c, g.experiments.join(', '), cell(g.gas_mass_g)]),
          }}
        />
        <H2ScatterChart data={data} x="tmax" />
        <H2ScatterChart data={data} x="s2" />
      </div>
    </div>
  )
}
