import { Bar, BarChart, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesResponse } from '../api/types'
import { ChartLook } from '../components/ChartLook'
import { fractionKey, lineLook, useChartPrefs } from '../lib/chartPrefs'
import { familyColor, fractionColor, REPLICATE_DASH } from '../lib/colors'
import { fmt, fmtMeanSd } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

/** Parâmetro × variável de amostra (temperatura de hidropirólise, por padrão):
 * uma linha por fração (H, E...), média ± desvio (barras de erro). Na
 * temperatura, a rocha original (sem temperatura) é um PONTO no começo do eixo,
 * rotulado "Original", e cada linha sai dela até a 1ª temperatura — pedido do
 * usuário, 21/10/2026. Variável de categoria (22/10/2026) → barras
 * (`CategorySeriesChart`). Cada série da mesma fração (réplicas, atmosferas)
 * ganha um tom da família da fração (lib/colors.ts); tipo e cores escolhíveis
 * (lib/chartPrefs.ts). */
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
  const onTemp = !raw?.variable || raw.variable.builtin === 'temperature'
  const data = raw
    ? {
        ...raw,
        series: raw.series
          .filter((s) => keepFraction(s.fraction))
          .map((s) => ({ ...s, points: s.points.filter((p) => !onTemp || keepTemperature(p.temperature_c)) })),
      }
    : null
  const looks = useSeriesLooks(data)
  const prefs = useChartPrefs()
  if (raw?.variable?.kind === 'categoria') return <CategorySeriesChart data={data} title={title} />
  const style = prefs.styleOf('linhas', 'linhas')
  const variable = raw?.variable
  const xUnit = onTemp ? '°C' : (variable?.unit ?? '')
  const xName = onTemp ? 'Temperatura' : (variable?.label ?? '')
  const xs = Array.from(new Set((data?.series ?? []).flatMap((x) => x.points.map((p) => Number(p.x))))).sort((a, b) => a - b)
  // posição da rocha original no eixo: um passo antes da 1ª temperatura
  const steps = xs.slice(1).map((t, i) => t - xs[i]).filter((d) => d > 0).sort((a, b) => a - b)
  const step = steps.length ? Math.max(10, steps[Math.floor(steps.length / 2)]) : 20
  const origin = onTemp ? (data?.baseline ?? []).filter((b) => b.mean != null) : []
  const originMeans = origin.map((b) => b.mean as number)
  const xOrig = xs.length ? xs[0] - step : 0
  const originPoint = originMeans.length
    ? (() => {
        const mean = originMeans.reduce((a, b) => a + b, 0) / originMeans.length
        const sd =
          originMeans.length > 1
            ? Math.sqrt(originMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / (originMeans.length - 1))
            : (origin[0].sd ?? null)
        return { x: xOrig, mean, sd, sdBar: sd ?? 0, n_samples: origin.length, original: true }
      })()
    : null
  const ticks = originPoint ? [xOrig, ...xs] : xs.length <= 12 ? xs : undefined
  const span = xs.length ? xs[xs.length - 1] - (originPoint ? xOrig : xs[0]) : 0
  const pad = onTemp ? 10 : span ? span * 0.05 : Math.abs(xs[0] ?? 1) * 0.1 || 1
  const name = title ?? `${data?.label ?? ''} × ${onTemp ? 'temperatura' : (variable?.label ?? '')}`
  const unit = data?.unit ? ` (${data.unit})` : ''
  const hasData = !!data && (data.series.some((s) => s.points.length) || origin.length > 0)
  const subtitle = data ? `média ± desvio-padrão${data.mode === 'validas' ? ' · só validadas' : data.mode === 'todas' ? ' · inclui inválidas' : ''}` : undefined
  const xLabel = `${xName}${xUnit ? ` (${xUnit})` : ''}`

  const rows: (string | number)[][] = []
  data?.series.forEach((s) => s.points.forEach((p) => rows.push([s.label, p.x, fmtMeanSd(p), p.n_samples, p.samples.map((x) => x.code).join(', ')])))
  origin.forEach((b) => rows.push(['Rocha original', 'Original', fmtMeanSd(b), 1, b.code]))

  return (
    <ChartCard
      title={name}
      subtitle={subtitle}
      sources={data ? [data.technique] : []}
      filename={name}
      empty={
        data === null ? 'Carregando…' : hasData ? null : onTemp ? 'Sem valores deste parâmetro nas amostras do projeto.' : `Nenhuma amostra com "${xName}" preenchida tem este parâmetro.`
      }
      table={<SimpleTable head={['Série', onTemp ? 'Temp. (°C)' : xLabel, `Média ± desvio${unit}`, 'Amostras', 'Códigos']} rows={rows} />}
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
            dataKey="x"
            domain={[(min: number) => min - pad, (max: number) => max + pad]}
            ticks={ticks?.length ? ticks : undefined}
            tickFormatter={(v: number) => (originPoint && v === xOrig ? 'Original' : fmt(v))}
            allowDuplicatedCategory={false}
            {...axisProps}
            label={{ value: xLabel, position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => (originPoint && Number(t) === xOrig ? 'Rocha original' : `${onTemp ? '' : `${xName}: `}${fmt(Number(t))}${xUnit ? ` ${xUnit}` : ''}`)}
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
              data={[...(originPoint && s.points.length ? [originPoint] : []), ...s.points.map((p) => ({ ...p, x: Number(p.x), sdBar: p.sd ?? 0 }))]}
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

/** Cor de cada série: escolhida → (1ª da fração: cor da fração) → tom da família. */
function useSeriesLooks(data: SeriesResponse | null) {
  const prefs = useChartPrefs()
  const seen = new Map<string, number>()
  return (data?.series ?? []).map((s) => {
    const i = seen.get(s.fraction) ?? 0
    seen.set(s.fraction, i + 1)
    // 1ª série da fração = cor da fração (a mesma dos gráficos de dispersão);
    // as seguintes (réplicas, atmosferas) têm cor própria
    const key = i === 0 ? fractionKey(s.fraction) : `serie:${s.key}`
    const fallback = s.fraction === 'todas' ? 'var(--color-primary)' : familyColor(s.fraction, i)
    return { key, label: s.label, color: prefs.color(key, fallback), fallback }
  })
}

/** Parâmetro × variável de categoria: barras lado a lado, uma cor por série
 * (fração), nas categorias na ordem definida na variável. */
function CategorySeriesChart({ data, title }: { data: SeriesResponse | null; title?: string }) {
  const looks = useSeriesLooks(data)
  const variable = data?.variable
  const cats = variable?.categories ?? []
  const series = data?.series ?? []
  const used = cats.filter((c) => series.some((s) => s.points.some((p) => p.x === c.value)))
  const rows = used.map((c) => {
    const row: Record<string, number | string | null> = { category: c.label }
    series.forEach((s, i) => {
      const p = s.points.find((x) => x.x === c.value)
      row[`s${i}`] = p?.mean ?? null
      row[`s${i}_sd`] = p?.sd ?? 0
      row[`s${i}_n`] = p?.n_samples ?? 0
    })
    return row
  })
  const name = title ?? `${data?.label ?? ''} × ${(variable?.label ?? '')}`
  const unit = data?.unit ? ` (${data.unit})` : ''
  const table: (string | number)[][] = []
  series.forEach((s) =>
    s.points.forEach((p) =>
      table.push([s.label, cats.find((c) => c.value === p.x)?.label ?? String(p.x), fmtMeanSd(p), p.n_samples, p.samples.map((x) => x.code).join(', ')]),
    ),
  )
  return (
    <ChartCard
      title={name}
      subtitle={data ? `média ± desvio-padrão${data.mode === 'validas' ? ' · só validadas' : data.mode === 'todas' ? ' · inclui inválidas' : ''}` : undefined}
      sources={data ? [data.technique] : []}
      filename={name}
      empty={data === null ? 'Carregando…' : rows.length ? null : `Nenhuma amostra com "${variable?.label ?? ''}" preenchida tem este parâmetro.`}
      table={<SimpleTable head={['Série', variable?.label ?? 'Categoria', `Média ± desvio${unit}`, 'Amostras', 'Códigos']} rows={table} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="category" {...axisProps} interval={0} height={40} />
          <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip
            {...tooltipStyle}
            formatter={(value, nameKey, item) => {
              const k = String(item?.dataKey ?? '')
              const p = item?.payload as Record<string, number> | undefined
              const sd = p?.[`${k}_sd`] ? ` ± ${fmt(p[`${k}_sd`])}` : ''
              return [`${fmt(Number(value))}${sd}${unit} (${p?.[`${k}_n`] ?? 1} amostra(s))`, String(nameKey)]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={`s${i}`} name={s.label} fill={looks[i].color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <ErrorBar dataKey={`s${i}_sd`} width={6} stroke="var(--color-text-muted)" />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
