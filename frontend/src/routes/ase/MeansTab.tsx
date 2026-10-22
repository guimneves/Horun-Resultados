import { useState } from 'react'
import type { AseStat, DoePlan } from '../../api/types'
import { Button, card, muted, Segmented } from '../../components/ui'
import { fmt } from '../../lib/format'
import { byGroup, conditionLabel } from './aseLib'

// Visão consolidada por condição (como a aba "Médias"): para cada indicador,
// nº de resultados válidos, média, desvio-padrão e RSD %. Uma réplica só =
// valor observado, sem desvio. A média é resumo — não entra como réplica.

type Show = 'media' | 'rsd' | 'n'

function cell(s: AseStat | undefined, show: Show): string {
  if (!s || s.n === 0) return '—'
  if (show === 'n') return String(s.n)
  if (show === 'rsd') return s.rsd == null ? (s.n === 1 ? 'n = 1' : '—') : `${fmt(s.rsd)} %`
  return s.sd == null ? `${fmt(s.mean)}${s.n === 1 ? ' (n = 1)' : ''}` : `${fmt(s.mean)} ± ${fmt(s.sd)}`
}

export function MeansTab({ plan }: { plan: DoePlan }) {
  const [show, setShow] = useState<Show>('media')
  const [onlyWithData, setOnlyWithData] = useState(true)
  const groups = byGroup(plan.fields)
    .map((g) => ({ ...g, fields: onlyWithData ? g.fields.filter((f) => f.n > 0) : g.fields }))
    .filter((g) => g.fields.length)

  function csv() {
    const head = ['Grupo', 'Variável', 'Unidade', ...plan.conditions.flatMap((c) => [`${c.code} n`, `${c.code} média`, `${c.code} DP`, `${c.code} RSD%`])]
    const lines = [head]
    for (const g of groups)
      for (const f of g.fields)
        lines.push([
          g.label,
          f.label,
          f.unit,
          ...plan.conditions.flatMap((c) => {
            const s = c.stats[f.key]
            return [String(s?.n ?? 0), s?.mean == null ? '' : String(s.mean), s?.sd == null ? '' : String(s.sd), s?.rsd == null ? '' : String(s.rsd)]
          }),
        ])
    const text = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
    a.download = `medias_${plan.name}.csv`
    a.click()
  }

  return (
    <section className="rounded-lg border p-3 md:p-4" style={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Médias por condição</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Mostrar"
            value={show}
            onChange={setShow}
            options={[
              { value: 'media', label: 'Média ± DP' },
              { value: 'rsd', label: 'RSD %' },
              { value: 'n', label: 'Nº de resultados' },
            ]}
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={onlyWithData} onChange={(e) => setOnlyWithData(e.target.checked)} />
            só variáveis com dados
          </label>
          <Button onClick={csv}>Baixar CSV</Button>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm" style={muted}>
          Ainda sem resultados — lance em "Resultados por execução" ou importe a planilha.
        </p>
      ) : (
        <div className="table-wrap max-h-[70vh] overflow-auto text-xs">
          <table className="w-full">
            <thead style={muted}>
              <tr>
                <th className="sticky left-0 px-2 py-1 text-left font-medium" style={{ background: 'var(--color-bg-elevated)' }}>
                  Variável
                </th>
                {plan.conditions.map((c) => (
                  <th key={c.code} className="px-2 py-1 text-right font-medium whitespace-nowrap">
                    {conditionLabel(c.code)}
                    <span className="block font-normal">{plan.factors.map((f) => c.levels[f.letter]).join(' · ')}</span>
                    <span className="block font-normal">
                      {c.n_done}/{c.n_runs} execução(ões)
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.group}>
                <tr>
                  <td colSpan={plan.conditions.length + 1} className="px-2 pt-3 pb-1 text-xs font-semibold uppercase" style={muted}>
                    {g.label}
                  </td>
                </tr>
                {g.fields.map((f) => (
                  <tr key={f.key} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="sticky left-0 px-2 py-1" style={{ background: 'var(--color-bg-elevated)' }} title={f.label}>
                      {f.short} <span style={muted}>({f.unit})</span>
                    </td>
                    {plan.conditions.map((c) => (
                      <td key={c.code} className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                        {cell(c.stats[f.key], show)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="mt-2 text-xs" style={muted}>
        Desvio-padrão amostral entre as execuções independentes da condição; RSD % = DP ÷ média × 100. Com uma execução só, aparece o valor observado,
        sem desvio. Rock-Eval: cada execução usa a média das leituras da sua rocha pós-ASE (leituras repetidas da mesma rocha não contam como réplicas).
      </p>
    </section>
  )
}
