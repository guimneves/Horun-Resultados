import { useMemo, useState } from 'react'
import { CartesianGrid, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Fraction, SampleRow } from '../api/types'
import { inputClass, inputStyle, muted } from '../components/ui'
import { fractionColor } from '../lib/colors'
import { fmt } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

// Séries → "Artigo Spigolon" (pedido do mantenedor, 14/10/2026): parâmetros do
// Rock-Eval × taxa de transformação, como em Spigolon et al. —
//   TR (%) = (S2₀ − S2ₕ) / S2₀ × 100
// S2₀ = S2 da rocha original (a pessoa escolhe qual amostra é; fica guardado
// neste navegador, por projeto) e S2ₕ = S2 de cada amostra da série de
// hidropirólise. Uma linha por fração (H/SE juntas, E...), pontos ordenados
// pela TR e com a temperatura ao lado.

const PARAMS: { key: string; label: string; unit: string }[] = [
  { key: 'S2', label: 'S2', unit: 'mg HC/g rocha' },
  { key: 'TOC', label: 'COT', unit: '% peso' },
  { key: 'S1', label: 'S1', unit: 'mg HC/g rocha' },
  { key: 'HI', label: 'HI', unit: 'mg HC/g COT' },
  { key: 'PI', label: 'PI = S1/(S1+S2)', unit: '' },
  { key: 'OI', label: 'OI', unit: 'mg CO₂/g COT' },
  { key: 'Tmax', label: 'Tmax', unit: '°C' },
  { key: 'S3', label: 'S3', unit: 'mg CO₂/g rocha' },
  { key: 'MINC', label: 'MINC', unit: '%' },
]

const ORIGINAL_KEY = (projectId: number) => `resultados.spigolon.original.${projectId}`

const v = (s: SampleRow, key: string) => s.values[`rockeval.${key}`]?.mean ?? null

interface Point {
  tr: number
  y: number
  temp: number
  code: string
}

function ParamChart({
  param,
  groups,
  original,
}: {
  param: (typeof PARAMS)[number]
  groups: { key: string; label: string; color: string; samples: (SampleRow & { tr: number })[] }[]
  original: SampleRow
}) {
  const lines = groups
    .map((g) => ({
      ...g,
      points: g.samples
        .map((s) => ({ tr: s.tr, y: v(s, param.key), temp: s.temperature_c as number, code: s.code }))
        .filter((p): p is Point => p.y != null)
        .sort((a, b) => a.tr - b.tr),
    }))
    .filter((g) => g.points.length)
  const y0 = v(original, param.key)
  const unit = param.unit ? ` (${param.unit})` : ''
  return (
    <ChartCard
      title={`${param.label} × taxa de transformação`}
      subtitle={`TR = (S2₀ − S2ₕ)/S2₀ × 100 · S2₀ = ${original.code}${y0 != null ? ` · linha tracejada = ${param.label} da rocha original` : ''} · número ao lado do ponto = temperatura (°C)`}
      sources={['rockeval']}
      empty={lines.length ? null : `Sem ${param.label} nas amostras da série.`}
      table={
        <SimpleTable
          head={['Série', 'Amostra', 'Temp. (°C)', 'TR (%)', `${param.label}${unit}`]}
          rows={[
            ...(y0 != null ? [['Rocha original', original.code, '—', '0', fmt(y0)]] : []),
            ...lines.flatMap((g) => g.points.map((p) => [g.label, p.code, p.temp, fmt(p.tr), fmt(p.y)])),
          ]}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="tr"
            domain={[(min: number) => Math.min(0, Math.floor(min / 10) * 10), (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]}
            allowDuplicatedCategory={false}
            {...axisProps}
            tickFormatter={(x: number) => fmt(x)}
            label={{ value: 'Taxa de transformação (%)', position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(x: number) => fmt(x)} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => `TR ${fmt(Number(t))} %`}
            formatter={(value, name, item) => {
              const p = item?.payload as Point | undefined
              return [`${fmt(Number(value))}${param.unit ? ` ${param.unit}` : ''}${p ? ` · ${p.code} (${p.temp} °C)` : ''}`, String(name)]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {y0 != null && (
            <ReferenceLine
              y={y0}
              stroke={fractionColor('O')}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: `${original.code} (original)`, position: 'insideTopLeft', fill: 'var(--color-text-muted)', fontSize: 11 }}
            />
          )}
          {lines.map((g) => (
            <Line
              key={g.key}
              data={g.points}
              dataKey="y"
              name={g.label}
              stroke={g.color}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 1.5, stroke: 'var(--color-bg-elevated)', fill: g.color }}
              isAnimationActive={false}
            >
              <LabelList dataKey="temp" position="top" style={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function SpigolonView({
  projectId,
  samples,
  allSamples,
  fractions,
}: {
  projectId: number
  /** amostras já filtradas (fração, temperaturas ocultas) */
  samples: SampleRow[]
  /** todas, para escolher a rocha original */
  allSamples: SampleRow[]
  fractions: Fraction[]
}) {
  // candidatas a rocha original: com S2 no Rock-Eval; primeiro as sem temperatura
  const candidates = useMemo(
    () =>
      allSamples
        .filter((s) => v(s, 'S2') != null)
        .sort((a, b) => Number(a.temperature_c != null) - Number(b.temperature_c != null) || (a.fraction === 'O' ? -1 : 0) || a.code.localeCompare(b.code)),
    [allSamples],
  )
  const [chosen, setChosenState] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(ORIGINAL_KEY(projectId))
      return raw ? Number(raw) : null
    } catch {
      return null
    }
  })
  const setChosen = (id: number | null) => {
    setChosenState(id)
    try {
      if (id == null) localStorage.removeItem(ORIGINAL_KEY(projectId))
      else localStorage.setItem(ORIGINAL_KEY(projectId), String(id))
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }
  // sem escolha (ou escolha que sumiu): a rocha original do projeto, se houver
  const auto = candidates.find((s) => s.fraction === 'O' && s.temperature_c == null) ?? null
  const original = candidates.find((s) => s.id === chosen) ?? auto
  const s2o = original ? v(original, 'S2') : null

  const groups = useMemo(() => {
    if (!original || !s2o) return []
    const fr = new Map(fractions.map((f) => [f.code, f]))
    const byGroup = new Map<string, (SampleRow & { tr: number })[]>()
    for (const s of samples) {
      if (s.id === original.id || s.temperature_c == null) continue
      const f = fr.get(s.fraction)
      if (f && !f.in_series) continue
      const s2 = v(s, 'S2')
      if (s2 == null) continue
      const key = f?.series_group || s.fraction
      const list = byGroup.get(key) ?? []
      list.push({ ...s, tr: (100 * (s2o - s2)) / s2o })
      byGroup.set(key, list)
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => (fr.get(a)?.sort ?? 99) - (fr.get(b)?.sort ?? 99))
      .map(([key, list]) => ({ key, label: fr.get(key)?.label ?? key, color: fractionColor(key), samples: list }))
  }, [samples, fractions, original, s2o])

  return (
    <div className="space-y-3">
      <p className="text-sm" style={muted}>
        Parâmetros do Rock-Eval pela <strong>taxa de transformação</strong> (Spigolon et al.): TR = (S2₀ − S2ₕ)/S2₀ × 100, com S2₀ da rocha original e S2ₕ de
        cada amostra da série de hidropirólise. Uma linha por fração; o número ao lado de cada ponto é a temperatura.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="spigolon-original" style={muted}>
          Rocha original (S2₀)
        </label>
        <select
          id="spigolon-original"
          className={`${inputClass} w-auto max-w-xs`}
          style={inputStyle}
          value={original?.id ?? ''}
          onChange={(e) => setChosen(e.target.value ? Number(e.target.value) : null)}
        >
          {!original && <option value="">Escolha a amostra…</option>}
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
              {s.temperature_c != null ? ` · ${s.temperature_c} °C` : ''} · S2 = {fmt(v(s, 'S2') as number)}
            </option>
          ))}
        </select>
        {chosen != null && auto && chosen !== auto.id && (
          <button type="button" className="text-xs underline" style={{ color: 'var(--color-primary)' }} onClick={() => setChosen(null)}>
            usar a rocha original do projeto ({auto.code})
          </button>
        )}
        {original && <span style={muted}>S2₀ = {fmt(s2o as number)} mg HC/g rocha</span>}
      </div>
      {!candidates.length ? (
        <p style={muted}>Nenhuma amostra com S2 (Rock-Eval) ainda. Importe o Rock-Eval da rocha original e das amostras hidropirolisadas.</p>
      ) : !original ? (
        <p style={muted}>Escolha acima qual amostra é a rocha original (S2₀).</p>
      ) : !s2o ? (
        <p style={muted}>O S2 da amostra escolhida é zero — escolha outra.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {PARAMS.map((p) => (
            <ParamChart key={p.key} param={p} groups={groups} original={original} />
          ))}
        </div>
      )}
    </div>
  )
}
