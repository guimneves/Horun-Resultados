import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AseField, DoePlan } from '../../api/types'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from '../../charts/ChartCard'
import { SelectChartsButton } from '../../components/ChartSelection'
import { card, inputClass, inputStyle, muted, Segmented } from '../../components/ui'
import { PALETTE } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { byGroup, conditionLabel, withUnit } from './aseLib'

// Gráficos comparativos dos resultados do ASE e do Rock-Eval (pedido de
// 22/10/2026): dispersão com eixos livres (por execução ou pela média da
// condição, com desvio), barras por condição e mapa de calor de vários
// indicadores — este NORMALIZADO (escore z por variável, indicado no título),
// para comparar grandezas de unidades diferentes sem misturar eixos.

function FieldSelect({ fields, value, onChange, label }: { fields: AseField[]; value: string; onChange: (k: string) => void; label: string }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs" style={muted}>
        {label}
      </span>
      <select className={`${inputClass} min-w-[14rem]`} style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        {byGroup(fields).map((g) => (
          <optgroup key={g.group} label={g.label}>
            {g.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {withUnit(f)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

const condColor = (codes: string[], code: string) => PALETTE[Math.max(0, codes.indexOf(code)) % PALETTE.length]

export function AseChartsTab({ plan }: { plan: DoePlan }) {
  const fields = plan.fields.filter((f) => f.n > 0)
  const fmap = new Map(plan.fields.map((f) => [f.key, f]))
  const [x, setX] = useState(fields.find((f) => f.key === 'm1_mg')?.key ?? fields[0]?.key ?? '')
  const [y, setY] = useState(fields.find((f) => f.key === 're_S1')?.key ?? fields.find((f) => f.key === 'time_min')?.key ?? fields[1]?.key ?? '')
  const [bar, setBar] = useState(fields.find((f) => f.key === 'y_m1')?.key ?? fields[0]?.key ?? '')
  const [mode, setMode] = useState<'execucoes' | 'medias'>('execucoes')
  const codes = plan.conditions.map((c) => c.code)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [heat, setHeat] = useState<string[]>(() => ['m1_mg', 'y_m1', 'eff_solvent', 'eff_time', 'time_min', 'solvent_ml', 're_S1', 're_S2'].filter((k) => fields.some((f) => f.key === k)))
  const shownCodes = codes.filter((c) => !hidden.has(c))

  if (!fields.length)
    return (
      <p className="rounded-lg border p-4 text-sm" style={{ ...card, ...muted }}>
        Sem resultados para desenhar ainda.
      </p>
    )

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-3" style={card}>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            label="Pontos"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'execucoes', label: 'Cada execução (R1, R2…)' },
              { value: 'medias', label: 'Média da condição ± DP' },
            ]}
          />
          <div className="ml-auto">
            <SelectChartsButton />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span style={muted}>Condições:</span>
          {plan.conditions.map((c) => {
            const on = !hidden.has(c.code)
            return (
              <button
                key={c.code}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const n = new Set(hidden)
                  if (on) n.add(c.code)
                  else n.delete(c.code)
                  setHidden(n)
                }}
                className="rounded-full border px-2 py-0.5"
                title={plan.factors.map((f) => `${f.name}: ${c.levels[f.letter]}`).join(' · ')}
                style={{ borderColor: condColor(codes, c.code), background: on ? condColor(codes, c.code) : 'transparent', color: on ? '#fff' : 'var(--color-text)' }}
              >
                {conditionLabel(c.code)}
              </button>
            )
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <FieldSelect fields={fields} value={x} onChange={setX} label="Eixo X" />
            <FieldSelect fields={fields} value={y} onChange={setY} label="Eixo Y" />
          </div>
          <XYChart plan={plan} xf={fmap.get(x)} yf={fmap.get(y)} mode={mode} codes={shownCodes} allCodes={codes} />
        </div>
        <div className="space-y-2">
          <FieldSelect fields={fields} value={bar} onChange={setBar} label="Variável das barras" />
          <BarsChart plan={plan} f={fmap.get(bar)} codes={shownCodes} />
        </div>
      </div>

      <div className="space-y-2">
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Variáveis do mapa de calor ({heat.length})</summary>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {fields.map((f) => (
              <label key={f.key} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={heat.includes(f.key)} onChange={(e) => setHeat(e.target.checked ? [...heat, f.key] : heat.filter((k) => k !== f.key))} />
                {withUnit(f)}
              </label>
            ))}
          </div>
        </details>
        <HeatMap plan={plan} keys={heat} codes={shownCodes} />
      </div>
    </div>
  )
}

function XYChart({ plan, xf, yf, mode, codes, allCodes }: { plan: DoePlan; xf?: AseField; yf?: AseField; mode: 'execucoes' | 'medias'; codes: string[]; allCodes: string[] }) {
  if (!xf || !yf) return null
  const groups = codes.map((code) => {
    if (mode === 'execucoes') {
      const pts = plan.runs
        .filter((r) => r.condition === code && r.valid && r.values[xf.key] != null && r.values[yf.key] != null)
        .map((r) => ({ x: r.values[xf.key] as number, y: r.values[yf.key] as number, label: r.label }))
      return { code, pts }
    }
    const c = plan.conditions.find((k) => k.code === code)
    const sx = c?.stats[xf.key]
    const sy = c?.stats[yf.key]
    const pts = sx?.mean != null && sy?.mean != null ? [{ x: sx.mean, y: sy.mean, ex: sx.sd ?? 0, ey: sy.sd ?? 0, label: `${conditionLabel(code)} (n = ${Math.min(sx.n, sy.n)})` }] : []
    return { code, pts }
  })
  const n = groups.reduce((a, g) => a + g.pts.length, 0)
  const title = `${yf.short} × ${xf.short}`
  return (
    <ChartCard
      title={title}
      subtitle={mode === 'medias' ? 'Média da condição; barras = desvio-padrão entre execuções' : 'Uma marca por execução independente; cor = condição'}
      filename={`dispersao_${yf.key}_${xf.key}`}
      empty={n ? null : 'Nenhuma execução tem as duas variáveis.'}
      table={<SimpleTable head={['Ponto', withUnit(xf), withUnit(yf)]} rows={groups.flatMap((g) => g.pts.map((p) => [p.label, fmt(p.x), fmt(p.y)]))} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis type="number" dataKey="x" name={xf.short} {...axisProps} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} label={{ value: withUnit(xf), position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }} height={40} />
          <YAxis type="number" dataKey="y" name={yf.short} {...axisProps} width={60} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v, name) => [fmt(Number(v)), String(name)]} labelFormatter={() => ''} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {groups
            .filter((g) => g.pts.length)
            .map((g) => (
              <Scatter key={g.code} name={conditionLabel(g.code)} data={g.pts} fill={condColor(allCodes, g.code)} isAnimationActive={false}>
                {mode === 'medias' && <ErrorBar dataKey="ey" direction="y" width={4} stroke={condColor(allCodes, g.code)} />}
                {mode === 'medias' && <ErrorBar dataKey="ex" direction="x" width={4} stroke={condColor(allCodes, g.code)} />}
              </Scatter>
            ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function BarsChart({ plan, f, codes }: { plan: DoePlan; f?: AseField; codes: string[] }) {
  if (!f) return null
  const reps = Array.from(new Set(plan.runs.map((r) => r.replicate))).sort((a, b) => a - b)
  const rows = codes.map((code) => {
    const c = plan.conditions.find((k) => k.code === code)
    const st = c?.stats[f.key]
    const row: Record<string, number | string | null> = { code: conditionLabel(code), mean: st?.mean ?? null, sd: st?.sd ?? 0 }
    for (const rep of reps) {
      const run = plan.runs.find((r) => r.condition === code && r.replicate === rep && r.valid)
      row[`R${rep}`] = (run?.values[f.key] as number | null) ?? null
    }
    return row
  })
  const any = rows.some((r) => r.mean != null)
  return (
    <ChartCard
      title={`${f.short} por condição`}
      subtitle={`Média ± desvio-padrão (${f.unit}); marcas = cada execução`}
      filename={`barras_${f.key}`}
      empty={any ? null : 'Sem valores desta variável.'}
      table={<SimpleTable head={['Condição', `Média (${f.unit})`, 'DP', ...reps.map((r) => `R${r}`)]} rows={rows.map((r) => [String(r.code), fmt(r.mean as number | null), fmt(r.sd as number | null), ...reps.map((rep) => fmt(r[`R${rep}`] as number | null))])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="code" {...axisProps} interval={0} />
          <YAxis {...axisProps} width={60} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v))} ${f.unit}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="mean" name="Média" fill={PALETTE[0]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <ErrorBar dataKey="sd" width={6} stroke="var(--color-text-muted)" />
          </Bar>
          {reps.map((rep, i) => (
            <Bar key={rep} dataKey={`R${rep}`} name={`R${rep}`} fill={PALETTE[(i + 2) % PALETTE.length]} fillOpacity={0.55} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function zColor(z: number | null): string {
  if (z == null) return 'var(--color-surface)'
  const t = Math.max(-2, Math.min(2, z)) / 2 // −1…1
  // divergente: laranja (abaixo da média) ↔ azul (acima), branco no meio
  const [r1, g1, b1] = t >= 0 ? [42, 120, 214] : [235, 104, 52]
  const a = Math.abs(t)
  const mix = (c: number) => Math.round(255 + (c - 255) * a)
  return `rgb(${mix(r1)}, ${mix(g1)}, ${mix(b1)})`
}

function HeatMap({ plan, keys, codes }: { plan: DoePlan; keys: string[]; codes: string[] }) {
  const fmap = new Map(plan.fields.map((f) => [f.key, f]))
  const cells = useMemo(() => {
    const out: { x: number; y: number; z: number | null; mean: number | null; var: string; cond: string }[] = []
    keys.forEach((k, yi) => {
      const means = codes.map((c) => plan.conditions.find((cc) => cc.code === c)?.stats[k]?.mean ?? null)
      const vals = means.filter((v): v is number => v != null)
      const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1)) : 0
      means.forEach((v, xi) => out.push({ x: xi, y: yi, z: v == null ? null : sd > 0 ? (v - m) / sd : 0, mean: v, var: fmap.get(k)?.short ?? k, cond: conditionLabel(codes[xi]) }))
    })
    return out
  }, [keys, codes, plan.conditions, fmap])
  return (
    <ChartCard
      title="Mapa de calor — indicadores × condições (normalizado)"
      subtitle="Escore z por variável (média das condições = 0): azul acima da média, laranja abaixo. Os valores reais estão em Ver tabela."
      filename="mapa_de_calor_ase"
      empty={keys.length && codes.length ? null : 'Escolha variáveis e condições.'}
      table={
        <SimpleTable
          head={['Variável', ...codes.map(conditionLabel)]}
          rows={keys.map((k, yi) => [withUnit(fmap.get(k) as AseField), ...codes.map((_c, xi) => fmt(cells.find((c) => c.x === xi && c.y === yi)?.mean ?? null))])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <XAxis type="number" dataKey="x" domain={[-0.5, codes.length - 0.5]} ticks={codes.map((_c, i) => i)} tickFormatter={(i: number) => conditionLabel(codes[i] ?? '')} {...axisProps} interval={0} />
            <YAxis
              type="number"
              dataKey="y"
              domain={[-0.5, keys.length - 0.5]}
              ticks={keys.map((_k, i) => i)}
              tickFormatter={(i: number) => fmap.get(keys[i])?.short ?? ''}
              {...axisProps}
              width={150}
              reversed
              interval={0}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(_v, _n, item) => {
                const p = item?.payload as (typeof cells)[number]
                return [`${fmt(p.mean)} (z = ${p.z == null ? '—' : fmt(p.z)})`, `${p.var} · ${p.cond}`]
              }}
              labelFormatter={() => ''}
            />
            <Scatter
              data={cells}
              isAnimationActive={false}
              shape={(props: { cx?: number; cy?: number; payload?: (typeof cells)[number]; xAxis?: { width: number }; yAxis?: { height: number } }) => {
                const w = props.xAxis ? props.xAxis.width / Math.max(1, codes.length) : 40
                const hh = props.yAxis ? props.yAxis.height / Math.max(1, keys.length) : 30
                return (
                  <rect
                    x={(props.cx ?? 0) - w / 2 + 1}
                    y={(props.cy ?? 0) - hh / 2 + 1}
                    width={Math.max(1, w - 2)}
                    height={Math.max(1, hh - 2)}
                    rx={3}
                    fill={zColor(props.payload?.z ?? null)}
                  />
                )
              }}
            />
          </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
