import { CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import type { MassesResponse, MassKey } from '../api/types'
import { atmosphereDash, MASS_COLORS } from '../lib/colors'
import { fmt, fmtMeanSd } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

export const MASS_TITLES: Record<MassKey, string> = {
  oil_mass_g: 'Massa de óleo',
  gas_mass_g: 'Massa de gás',
  bitumen_mass_g: 'Massa de betume',
}

/** De onde vem cada massa (etiquetas do gráfico). */
export const MASS_SOURCES: Record<MassKey, string[]> = {
  oil_mass_g: ['Condições experimentais'],
  gas_mass_g: ['Condições experimentais', 'Planilha cálculo gás / editado'],
  bitumen_mass_g: ['Condições experimentais'],
}

const has = (v: number | null | undefined): v is number => v != null && v !== 0

export function hasMassData(data: MassesResponse | null, mass: MassKey): boolean {
  return !!data?.groups.some((g) => g.temperature_c != null && g.replicates.some((r) => has(r[mass])))
}

/** Massa (g) × temperatura: média ± desvio das réplicas de cada amostra (linha),
 * uma linha por atmosfera quando há mais de uma, e as réplicas como pontos
 * vazados. Valores 0 ou vazios ficam de fora. */
export function MassChart({ data, mass }: { data: MassesResponse; mass: MassKey }) {
  const color = MASS_COLORS[mass]
  const title = MASS_TITLES[mass]
  const multi = data.atmospheres.length > 1
  const groups = data.groups.filter((g) => g.temperature_c != null && g.replicates.some((r) => has(r[mass])))
  const lineKeys = Array.from(new Set(groups.map((g) => (multi ? g.atmosphere || 'atmosfera não informada' : ''))))
  const lines = lineKeys.map((atm, i) => {
    const mine = groups.filter((g) => (multi ? g.atmosphere || 'atmosfera não informada' : '') === atm)
    return {
      atm,
      dash: atmosphereDash(i),
      means: mine
        .map((g) => ({ temperature_c: g.temperature_c as number, label: g.label, ...g.stats[mass], sdBar: g.stats[mass].sd ?? 0 }))
        .sort((a, b) => a.temperature_c - b.temperature_c),
      points: mine.flatMap((g) =>
        g.replicates.filter((r) => has(r[mass])).map((r) => ({ temperature_c: g.temperature_c as number, value: r[mass] as number, code: r.code })),
      ),
    }
  })
  const suffix = (atm: string) => (atm ? ` · ${atm}` : '')
  const rows: (string | number)[][] = groups.map((g) => [
    g.label,
    g.temperature_c as number,
    fmtMeanSd(g.stats[mass]),
    g.stats[mass].n,
    g.replicates.map((r) => `${r.code}: ${has(r[mass]) ? fmt(r[mass]) : '—'}`).join(', '),
  ])

  return (
    <ChartCard
      title={`${title} × temperatura`}
      subtitle="média ± desvio-padrão das réplicas (A, B, C) · pontos vazados = réplicas · valores 0 ou vazios não entram"
      sources={MASS_SOURCES[mass]}
      filename={title}
      empty={groups.length ? null : `Sem ${title.toLowerCase()} nas corridas do projeto.`}
      table={<SimpleTable head={['Amostra', 'Temp. (°C)', 'Média ± desvio (g)', 'n', 'Réplicas (g)']} rows={rows} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="temperature_c"
            domain={['dataMin - 10', 'dataMax + 10']}
            allowDuplicatedCategory={false}
            {...axisProps}
            label={{ value: 'Temperatura (°C)', position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis
            type="number"
            {...axisProps}
            width={56}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => fmt(v)}
            label={{ value: 'g', angle: -90, position: 'insideLeft', fill: 'var(--color-text-muted)', fontSize: 12 }}
          />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => `${t} °C`}
            formatter={(value, nameKey, item) => {
              const p = item?.payload as { sd?: number | null; n?: number; code?: string; label?: string } | undefined
              if (p?.code) return [`${fmt(Number(value))} g`, `${p.code}`]
              const sd = p?.sd ? ` ± ${fmt(p.sd)}` : ''
              return [`${fmt(Number(value))}${sd} g (n = ${p?.n ?? 1})`, `${p?.label ?? ''} ${String(nameKey)}`.trim()]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l) => (
            <Line
              key={`m-${l.atm}`}
              name={`Média${suffix(l.atm)}`}
              data={l.means}
              dataKey="mean"
              stroke={color}
              strokeWidth={2}
              strokeDasharray={l.dash}
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-bg-elevated)', fill: color }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            >
              <ErrorBar dataKey="sdBar" width={6} strokeWidth={1.5} stroke={color} direction="y" />
            </Line>
          ))}
          {lines.map((l) => (
            <Scatter
              key={`r-${l.atm}`}
              name={`Réplicas${suffix(l.atm)}`}
              data={l.points}
              dataKey="value"
              fill="var(--color-bg-elevated)"
              stroke={color}
              strokeWidth={1.5}
              shape={l.dash ? 'diamond' : 'circle'}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
