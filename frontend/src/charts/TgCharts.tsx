import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { AnalysisData, Mode, SampleRow, TgData } from '../api/types'
import { Segmented } from '../components/ui'
import { dashFor, seriesColor } from '../lib/colors'
import { fmt } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

export type TgSignal = 'mass' | 'dtg'

/** Curvas do TG sobrepostas: massa (% da inicial) × temperatura, ou a DTG
 * (dm/dT, %/°C). Uma coisa de cada vez — nada de eixo duplo. */
export function TgChart({ curves, signal }: { curves: AnalysisData<TgData>[]; signal: TgSignal }) {
  const lines = curves
    .filter((c) => c.data?.temperature?.length)
    .map((c) => {
      const d = c.data
      const ys = signal === 'mass' ? d.mass_pct : d.dtg
      return {
        id: c.analysis_id,
        name: c.replicate != null ? `${c.sample_code} · réplica ${c.replicate}` : c.sample_code,
        points: d.temperature.map((x, i) => ({ x, y: ys[i] ?? null })).filter((p) => p.y !== null),
        residue: d.mass_pct[d.mass_pct.length - 1],
        peak: peakOf(d),
      }
    })
  const title = signal === 'mass' ? 'TG sobrepostas — massa × temperatura' : 'DTG sobrepostas — taxa de perda × temperatura'
  return (
    <ChartCard
      title={title}
      sources={['tg']}
      subtitle={signal === 'mass' ? 'Massa em % da massa inicial' : 'DTG = dm/dT da curva suavizada (%/°C); o vale mais fundo é a maior perda'}
      empty={lines.length ? null : 'Escolha amostras com curvas de TG.'}
      filename={signal === 'mass' ? 'tg_sobrepostas' : 'dtg_sobrepostas'}
      table={
        <SimpleTable
          head={['Medição', 'Pontos', 'Massa final (%)', 'Pico da DTG (°C)']}
          rows={lines.map((l) => [l.name, l.points.length, fmt(l.residue), l.peak != null ? fmt(l.peak) : '—'])}
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
            label={{ value: 'Temperatura (°C)', position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }}
          />
          <YAxis
            {...axisProps}
            width={56}
            domain={signal === 'mass' ? [0, 'auto'] : ['auto', 'auto']}
            tickFormatter={(v: number) => fmt(v)}
            label={{ value: signal === 'mass' ? 'Massa (%)' : 'DTG (%/°C)', angle: -90, position: 'insideLeft', fill: 'var(--color-text-muted)', fontSize: 12 }}
          />
          <Tooltip {...tooltipStyle} labelFormatter={(v) => `${fmt(Number(v))} °C`} formatter={(v) => fmt(Number(v))} />
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

function peakOf(d: TgData): number | null {
  let best: number | null = null
  let at: number | null = null
  d.dtg.forEach((v, i) => {
    if (v != null && i > 0 && (best == null || v < best)) {
      best = v
      at = d.temperature[i]
    }
  })
  return at
}

export function TgSignalSwitch({ value, onChange }: { value: TgSignal; onChange: (v: TgSignal) => void }) {
  return (
    <Segmented
      label="Curva do TG"
      value={value}
      onChange={onChange}
      options={[
        { value: 'mass', label: 'TG (massa)' },
        { value: 'dtg', label: 'DTG' },
      ]}
    />
  )
}

/** Comparar: TG/DTG das amostras escolhidas (todas as réplicas). */
export function TgSection({ projectId, mode, ids }: { projectId: number; mode: Mode; ids: number[] }) {
  const [curves, setCurves] = useState<AnalysisData<TgData>[]>([])
  const [signal, setSignal] = useState<TgSignal>('mass')
  const key = useMemo(() => ids.join(','), [ids])
  useEffect(() => {
    if (!key) {
      setCurves([])
      return
    }
    api
      .get<AnalysisData<TgData>[]>(`/projects/${projectId}/analysis-data?technique=tg&mode=${mode}&sample_ids=${key}`)
      .then(setCurves)
      .catch(() => setCurves([]))
  }, [projectId, mode, key])
  return (
    <div className="space-y-2">
      <TgSignalSwitch value={signal} onChange={setSignal} />
      <TgChart curves={curves} signal={signal} />
    </div>
  )
}

export function hasTg(s: SampleRow): boolean {
  return !!s.techniques?.includes('tg')
}
