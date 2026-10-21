import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Mode, SampleRow } from '../api/types'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from '../charts/ChartCard'
import { hasTg, TgSection } from '../charts/TgCharts'
import { GcSection, hasGc } from '../charts/GcCharts'
import { SelectChartsButton } from '../components/ChartSelection'
import { card, ErrorBox, inputClass, inputStyle, muted, Segmented } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fractionColor } from '../lib/colors'
import { fmt, fmtMeanSd } from '../lib/format'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'
import { MODE_OPTIONS } from './SamplesTab'

// Séries dos projetos de tabaco (pedido do usuário, 19/10/2026): uma aba por
// tipo de produto — Charutos, Cigarros, Essências de Narguilé — com a tabela
// de resultados (média ± desvio das réplicas de cada produto) e um gráfico de
// barras por parâmetro, produto a produto. Sem eixo de temperatura.

type TypeCode = 'CHA' | 'CIG' | 'NAR' | 'TAB'
const TYPES: { code: TypeCode; label: string }[] = [
  { code: 'CHA', label: 'Charutos' },
  { code: 'CIG', label: 'Cigarros' },
  { code: 'NAR', label: 'Essências de Narguilé' },
]
const TAB_KEY = (projectId: number) => `resultados.tabaco.series.tipo.${projectId}`

function readType(projectId: number): TypeCode {
  try {
    const v = localStorage.getItem(TAB_KEY(projectId))
    return v === 'CIG' || v === 'NAR' || v === 'TAB' ? v : 'CHA'
  } catch {
    return 'CHA'
  }
}

function ProductBarChart({ samples, column, label, color }: { samples: SampleRow[]; column: string; label: string; color: string }) {
  const rows = samples
    .filter((s) => s.values[column]?.mean != null)
    .map((s) => ({ code: s.code, mean: s.values[column].mean as number, sd: s.values[column].sd ?? 0, stat: s.values[column] }))
  return (
    <ChartCard
      title={label}
      sources={[column.split('.')[0]]}
      subtitle="Média ± desvio das réplicas de cada produto"
      empty={rows.length ? null : 'Nenhum produto deste tipo tem este parâmetro.'}
      table={<SimpleTable head={['Produto', label]} rows={rows.map((r) => [r.code, fmtMeanSd(r.stat)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="code" {...axisProps} interval={0} angle={-30} textAnchor="end" height={64} />
          <YAxis {...axisProps} width={52} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} />
          <Bar dataKey="mean" name={label} radius={[4, 4, 0, 0]} isAnimationActive={false} fill={color}>
            <ErrorBar dataKey="sd" width={6} stroke="var(--color-text-muted)" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function TobaccoSeriesTab() {
  const { project } = useProject()
  const { catalog, paramLabel, techniqueLabel } = useApp()
  const [mode, setMode] = useState<Mode>('padrao')
  const { samples, error } = useSamples(project.id, mode)
  const [type, setTypeState] = useState<TypeCode>(() => readType(project.id))
  const setType = (t: TypeCode) => {
    setTypeState(t)
    try {
      localStorage.setItem(TAB_KEY(project.id), t)
    } catch {
      /* sem armazenamento: só não lembra a aba */
    }
  }

  const products = useMemo(() => (samples ?? []).filter((s) => s.kind === 'sample'), [samples])
  const count = (t: TypeCode) => products.filter((s) => s.fraction === t).length
  const undefinedCount = count('TAB')
  const shown = useMemo(() => products.filter((s) => s.fraction === type).sort((a, b) => a.code.localeCompare(b.code)), [products, type])
  useEffect(() => {
    if (type === 'TAB' && undefinedCount === 0) setType('CHA')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, undefinedCount])

  // parâmetros: os do perfil do projeto (ou os principais do catálogo), na
  // ordem das análises, só os que algum produto deste tipo tem
  const columns = useMemo(() => {
    const present = new Set(shown.flatMap((s) => Object.keys(s.values)))
    const profile = project.profile?.parameters ?? {}
    const out: { col: string; tech: string }[] = []
    for (const t of catalog) {
      const keys = profile[t.key] ?? t.params.filter((p) => p.main).map((p) => p.key)
      for (const k of keys) {
        const col = `${t.key}.${k}`
        if (present.has(col)) out.push({ col, tech: t.key })
      }
    }
    return out
  }, [shown, catalog, project.profile])
  const byTech = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of columns) m.set(c.tech, [...(m.get(c.tech) ?? []), c.col])
    return Array.from(m.entries())
  }, [columns])
  const tgIds = useMemo(() => shown.filter(hasTg).map((s) => s.id), [shown])
  const gcIds = useMemo(() => shown.filter((s) => hasGc(s)).map((s) => s.id), [shown])
  const color = fractionColor(type)
  const typeOptions = [
    ...TYPES.map((t) => ({ value: t.code, label: `${t.label} (${count(t.code)})` })),
    ...(undefinedCount ? [{ value: 'TAB' as TypeCode, label: `Tipo a definir (${undefinedCount})` }] : []),
  ]
  const header = (col: string) => `${paramLabel(col)}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={type} options={typeOptions} onChange={setType} label="Tipo de produto" />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputClass} md:max-w-xs`}
            style={inputStyle}
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            aria-label="Quais resultados entram"
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <SelectChartsButton />
        </div>
      </div>
      <ErrorBox message={error} />
      {undefinedCount > 0 && type !== 'TAB' && (
        <p className="text-xs" style={muted}>
          {undefinedCount} produto(s) sem tipo (o nome não dizia charuto, cigarro ou essência) — escolha o tipo na aba Amostras
          (abra a amostra → Editar → Tipo) ou veja em "Tipo a definir".
        </p>
      )}

      {samples === null ? (
        <p className="text-sm" style={muted}>
          Carregando…
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ ...card, ...muted }}>
          Nenhum produto deste tipo no projeto ainda.
        </p>
      ) : (
        <>
          <section className="rounded-lg border p-3 md:p-4" style={card}>
            <h3 className="mb-2 font-semibold">
              Resultados — {TYPES.find((t) => t.code === type)?.label ?? 'tipo a definir'} ({shown.length})
            </h3>
            {columns.length === 0 ? (
              <p className="text-sm" style={muted}>
                Ainda sem resultados importados para estes produtos.
              </p>
            ) : (
              <div className="table-wrap text-xs">
                <table className="w-full text-left">
                  <thead style={muted}>
                    <tr>
                      <th className="px-2 py-1 font-medium">Produto</th>
                      {columns.map((c) => (
                        <th key={c.col} className="px-2 py-1 text-right font-medium whitespace-nowrap" title={techniqueLabel(c.tech)}>
                          {header(c.col)}
                          <span className="block font-normal">{techniqueLabel(c.tech)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <td className="px-2 py-1 font-medium whitespace-nowrap">{s.code}</td>
                        {columns.map((c) => (
                          <td key={c.col} className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                            {s.values[c.col] ? fmtMeanSd(s.values[c.col]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {byTech.map(([tech, cols]) => (
            <section key={tech} className="space-y-2">
              <h3 className="font-semibold">{techniqueLabel(tech)}</h3>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {cols.map((col) => (
                  <ProductBarChart key={col} samples={shown} column={col} label={paramLabel(col)} color={color} />
                ))}
              </div>
            </section>
          ))}

          {gcIds.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold">Cromatografia — cromatogramas</h3>
              <GcSection projectId={project.id} mode={mode} ids={gcIds} showTables={false} />
            </section>
          )}

          {tgIds.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold">{techniqueLabel('tg')} — curvas</h3>
              <div className="rounded-lg border p-3" style={card}>
                <TgSection projectId={project.id} mode={mode} ids={tgIds} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
