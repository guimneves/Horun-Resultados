import { CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesResponse } from '../api/types'
import { ChartLook } from '../components/ChartLook'
import { fractionKey, lineLook, useChartPrefs } from '../lib/chartPrefs'
import { familyColor, fractionColor, REPLICATE_DASH } from '../lib/colors'
import { fmt, fmtMeanSd } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

/** Parâmetro × temperatura: uma linha por fração (H, E...), média ± desvio
 * (barras de erro); rocha original como linha de referência tracejada.
 * Cada série da mesma fração (réplicas, atmosferas) ganha um tom da família
 * da fração (lib/colors.ts); tipo e cores escolhíveis (lib/chartPrefs.ts). */
export function SeriesChart({
  data: raw,
  title,
  keepFraction = () => true,
  keepTemperature = () => true,
}: {
  data: SeriesResponse | null
  title?: string
  keepFraction?: (fraction: string) => boolean
  /** Temperaturas ocultadas em Séries → Opções ficam de fora. */
  keepTemperature?: (temperature: number) => boolean
}) {
  const data = raw
    ? {
        ...raw,
        series: raw.series.filter((s) => keepFraction(s.fraction)).map((s) => ({ ...s, points: s.points.filter((p) => keepTemperature(p.temperature_c)) })),
      }
    : null
  const prefs = useChartPrefs()
  const style = prefs.styleOf('linhas', 'linhas')
  // cor de cada série: escolhida → (1ª da fração: cor da fração) → tom da família
  const seen = new Map<string, number>()
  const looks = (data?.series ?? []).map((s) => {
    const i = seen.get(s.fraction) ?? 0
    seen.set(s.fraction, i + 1)
    // 1ª série da fração = cor da fração (a mesma dos gráficos de dispersão);
    // as seguintes (réplicas, atmosferas) têm cor própria
    const key = i === 0 ? fractionKey(s.fraction) : `serie:${s.key}`
    const fallback = familyColor(s.fraction, i)
    return { key, label: s.label, color: prefs.color(key, fallback), fallback }
  })
  const name = title ?? `${data?.label ?? ''} × temperatura`
  const unit = data?.unit ? ` (${data.unit})` : ''
  const hasData = !!data && (data.series.some((s) => s.points.length) || data.baseline.length)
  const subtitle = data ? `média ± desvio-padrão${data.mode === 'validas' ? ' · só validadas' : data.mode === 'todas' ? ' · inclui inválidas' : ''}` : undefined

  const rows: (string | number)[][] = []
  data?.series.forEach((s) =>
    s.points.forEach((p) => rows.push([s.label, p.temperature_c, fmtMeanSd(p), p.n_samples, p.samples.map((x) => x.code).join(', ')])),
  )
  data?.baseline.forEach((b) => rows.push(['Rocha original', '—', fmtMeanSd(b), 1, b.code]))

  return (
    <ChartCard
      title={name}
      subtitle={subtitle}
      sources={data ? [data.technique] : []}
      filename={name}
      empty={data === null ? 'Carregando…' : hasData ? null : 'Sem valores deste parâmetro nas amostras do projeto.'}
      table={<SimpleTable head={['Série', 'Temp. (°C)', `Média ± desvio${unit}`, 'Amostras', 'Códigos']} rows={rows} />}
      actions={
        <ChartLook
          scope="linhas"
          styles={['linhas', 'pontos']}
          fallback="linhas"
          colors={looks.map((l) => ({ key: l.key, label: l.label, color: l.fallback }))}
        />
      }
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
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => `${t} °C`}
            formatter={(value, nameKey, item) => {
              const p = item?.payload as { sd?: number | null; n_samples?: number } | undefined
              const sd = p?.sd ? ` ± ${fmt(p.sd)}` : ''
              return [`${fmt(Number(value))}${sd}${unit} (${p?.n_samples ?? 1} amostra(s))`, String(nameKey)]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {data?.baseline.map((b) => (
            <ReferenceLine
              key={b.sample_id}
              y={b.mean ?? undefined}
              stroke={fractionColor('O')}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: `${b.code} (original)`, position: 'insideTopLeft', fill: 'var(--color-text-muted)', fontSize: 11 }}
            />
          ))}
          {data?.series.map((s, i) => (
            <Line
              key={s.key}
              name={s.label}
              data={s.points.map((p) => ({ ...p, sdBar: p.sd ?? 0 }))}
              dataKey="mean"
              {...lineLook(style, looks[i].color, REPLICATE_DASH[s.replicate_letter])}
              isAnimationActive={false}
            >
              <ErrorBar dataKey="sdBar" width={6} strokeWidth={1.5} stroke={looks[i].color} direction="y" />
            </Line>
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
