import { CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesResponse } from '../api/types'
import { ChartLook } from '../components/ChartLook'
import { fractionKey, lineLook, useChartPrefs } from '../lib/chartPrefs'
import { familyColor, fractionColor, REPLICATE_DASH } from '../lib/colors'
import { fmt, fmtMeanSd } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

/** Parâmetro × temperatura: uma linha por fração (H, E...), média ± desvio
 * (barras de erro). A rocha original (sem temperatura) é um PONTO no começo
 * do eixo, rotulado "Original", e cada linha sai dela até a 1ª temperatura —
 * pedido do usuário, 21/10/2026 (antes era só uma linha de referência).
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
  // posição da rocha original no eixo: um passo antes da 1ª temperatura
  const temps = Array.from(new Set((data?.series ?? []).flatMap((x) => x.points.map((p) => p.temperature_c)))).sort((a, b) => a - b)
  const steps = temps.slice(1).map((t, i) => t - temps[i]).filter((d) => d > 0).sort((a, b) => a - b)
  const step = steps.length ? Math.max(10, steps[Math.floor(steps.length / 2)]) : 20
  const origin = (data?.baseline ?? []).filter((b) => b.mean != null)
  const originMeans = origin.map((b) => b.mean as number)
  const xOrig = temps.length ? temps[0] - step : 0
  const originPoint = originMeans.length
    ? (() => {
        const mean = originMeans.reduce((a, b) => a + b, 0) / originMeans.length
        const sd =
          originMeans.length > 1
            ? Math.sqrt(originMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / (originMeans.length - 1))
            : (origin[0].sd ?? null)
        return { temperature_c: xOrig, mean, sd, sdBar: sd ?? 0, n_samples: origin.length, original: true }
      })()
    : null
  const ticks = originPoint ? [xOrig, ...temps] : temps
  const name = title ?? `${data?.label ?? ''} × temperatura`
  const unit = data?.unit ? ` (${data.unit})` : ''
  const hasData = !!data && (data.series.some((s) => s.points.length) || data.baseline.length)
  const subtitle = data ? `média ± desvio-padrão${data.mode === 'validas' ? ' · só validadas' : data.mode === 'todas' ? ' · inclui inválidas' : ''}` : undefined

  const rows: (string | number)[][] = []
  data?.series.forEach((s) =>
    s.points.forEach((p) => rows.push([s.label, p.temperature_c, fmtMeanSd(p), p.n_samples, p.samples.map((x) => x.code).join(', ')])),
  )
  data?.baseline.forEach((b) => rows.push(['Rocha original', 'Original', fmtMeanSd(b), 1, b.code]))

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
            ticks={ticks.length ? ticks : undefined}
            tickFormatter={(v: number) => (originPoint && v === xOrig ? 'Original' : String(v))}
            allowDuplicatedCategory={false}
            {...axisProps}
            label={{ value: 'Temperatura (°C)', position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => (originPoint && Number(t) === xOrig ? 'Rocha original' : `${t} °C`)}
            formatter={(value, nameKey, item) => {
              const p = item?.payload as { sd?: number | null; n_samples?: number } | undefined
              const sd = p?.sd ? ` ± ${fmt(p.sd)}` : ''
              return [`${fmt(Number(value))}${sd}${unit} (${p?.n_samples ?? 1} amostra(s))`, String(nameKey)]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {data?.series.map((s, i) => (
            <Line
              key={s.key}
              name={s.label}
              // cada fração sai da rocha original (o ponto de partida da maturação)
              data={[...(originPoint && s.points.length ? [originPoint] : []), ...s.points.map((p) => ({ ...p, sdBar: p.sd ?? 0 }))]}
              dataKey="mean"
              {...lineLook(style, looks[i].color, REPLICATE_DASH[s.replicate_letter])}
              isAnimationActive={false}
            >
              <ErrorBar dataKey="sdBar" width={6} strokeWidth={1.5} stroke={looks[i].color} direction="y" />
            </Line>
          ))}
          {originPoint && (
            <Line
              name={origin.length === 1 ? `Rocha original (${origin[0].code})` : `Rocha original (${origin.length} amostras)`}
              data={[originPoint]}
              dataKey="mean"
              stroke={fractionColor('O')}
              strokeWidth={0}
              dot={{ r: 6, fill: fractionColor('O'), stroke: 'var(--color-bg)', strokeWidth: 2 }}
              activeDot={{ r: 7 }}
              legendType="diamond"
              isAnimationActive={false}
            >
              <ErrorBar dataKey="sdBar" width={6} strokeWidth={1.5} stroke={fractionColor('O')} direction="y" />
            </Line>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
