import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { AnalysisOut } from '../api/types'
import { useApp } from '../context/AppContext'
import { fmt } from '../lib/format'
import { Button, muted, ValidityBadge } from './ui'

// Medições de uma técnica numa amostra, lado a lado (pedido do usuário,
// 21/10/2026: "melhore a visualização dos resultados de cada análise ... para
// facilitar validar e invalidar"). Uma linha por medição, uma coluna por
// parâmetro principal; a última linha é a média ± desvio SEM as inválidas,
// que muda na hora ao invalidar. Valor que destoa das outras medições fica
// destacado (mais de 10 % da mediana das outras — e acima do espalhamento
// delas), para guiar o olho, não para decidir sozinho.

const OUTLIER_REL = 0.1

function analysisValue(a: AnalysisOut, param: string): number | null {
  const vs = a.values.filter((v) => v.parameter === param).map((v) => v.value)
  return vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

function meanSd(v: number[]): { mean: number; sd: number | null } | null {
  if (!v.length) return null
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  if (v.length < 2) return { mean, sd: null }
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1))
  return { mean, sd }
}

/** Destoa das OUTRAS medições válidas/pendentes? (precisa de ao menos 2 outras) */
function outlierNote(x: number, others: number[]): string | null {
  if (others.length < 2) return null
  const med = median(others)
  const mad = median(others.map((o) => Math.abs(o - med))) * 1.4826
  const diff = Math.abs(x - med)
  if (diff > Math.max(OUTLIER_REL * Math.abs(med), 2 * mad) && diff > 0) {
    const pct = med !== 0 ? ` (${diff / Math.abs(med) >= 10 ? '>1000' : Math.round((100 * diff) / Math.abs(med))} %)` : ''
    return `Destoa das outras medições: mediana delas ${fmt(med)}${pct}`
  }
  return null
}

export function MeasurementsLegend() {
  return (
    <p className="text-[11px]" style={muted}>
      Uma linha por medição. ✓ válida · ✗ inválida (clique de novo para voltar a pendente). Inválidas ficam riscadas e saem da média
      ± desvio da última linha. ⚠ = o valor destoa das outras medições (mais de 10 % da mediana delas) — é só um aviso para conferir.
    </p>
  )
}

export function MeasurementsTable({
  technique,
  analyses,
  projectId,
  canValidate,
  canDelete,
  onChanged,
  onError,
}: {
  technique: string
  analyses: AnalysisOut[]
  projectId: number
  canValidate: boolean
  canDelete: boolean
  onChanged: () => Promise<void> | void
  onError: (msg: string) => void
}) {
  const { catalog, paramLabel, techniqueLabel } = useApp()
  const [allParams, setAllParams] = useState(false)
  const [busy, setBusy] = useState(false)

  const params = useMemo(() => {
    const present = new Set(analyses.flatMap((a) => a.values.map((v) => v.parameter)))
    const def = catalog.find((t) => t.key === technique)?.params ?? []
    const main = def.filter((p) => p.main && present.has(p.key)).map((p) => p.key)
    const all = [...def.filter((p) => present.has(p.key)).map((p) => p.key), ...[...present].filter((k) => !def.some((p) => p.key === k))]
    return allParams || main.length === 0 ? all : main
  }, [analyses, catalog, technique, allParams])
  const hasMore = useMemo(() => {
    const present = new Set(analyses.flatMap((a) => a.values.map((v) => v.parameter)))
    return present.size > params.length
  }, [analyses, params])

  const counted = analyses.filter((a) => a.valid !== false)
  const counts = {
    valid: analyses.filter((a) => a.valid === true).length,
    pending: analyses.filter((a) => a.valid === null).length,
    invalid: analyses.filter((a) => a.valid === false).length,
  }

  async function setValid(ids: number[], valid: boolean | null) {
    setBusy(true)
    try {
      for (const id of ids) await api.post(`/projects/${projectId}/analyses/${id}/validation`, { valid })
      await onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: AnalysisOut) {
    if (!window.confirm(`Excluir a medição ${a.source_name}?`)) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/analyses/${a.id}`)
      await onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }} data-testid={`measurements-${technique}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold">{techniqueLabel(technique)}</h4>
          <p className="text-xs" style={muted}>
            {analyses.length} medição(ões): {counts.valid} válida(s) · {counts.pending} pendente(s) · {counts.invalid} inválida(s)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {hasMore || allParams ? (
            <Button variant="ghost" onClick={() => setAllParams(!allParams)}>
              {allParams ? 'Só os principais' : 'Todos os parâmetros'}
            </Button>
          ) : null}
          {canValidate && counts.pending > 0 && (
            <Button disabled={busy} onClick={() => setValid(analyses.filter((a) => a.valid === null).map((a) => a.id), true)}>
              Validar pendentes ({counts.pending})
            </Button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="w-full text-xs">
          <thead>
            <tr style={muted}>
              <th className="py-1 pr-2 text-left font-medium">Medição</th>
              {params.map((p) => (
                <th key={p} className="px-2 py-1 text-right font-medium whitespace-nowrap">
                  {paramLabel(`${technique}.${p}`)}
                </th>
              ))}
              <th className="px-2 py-1 text-left font-medium">Situação</th>
              {canValidate && <th className="px-2 py-1 text-right font-medium">Validar</th>}
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => {
              const invalid = a.valid === false
              return (
                <tr key={a.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)', opacity: invalid ? 0.55 : 1 }}>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium" style={invalid ? { textDecoration: 'line-through' } : undefined}>
                      {a.source_name || `#${a.id}`}
                    </span>
                    <span className="block" style={muted}>
                      {[a.aliquot !== null ? `alíquota ${a.aliquot}` : '', a.replicate !== null ? `réplica ${a.replicate}` : '', a.analyzed_at]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {a.file && (
                      <button
                        type="button"
                        className="block max-w-[14rem] truncate text-left underline"
                        style={{ color: 'var(--color-primary)' }}
                        title={a.file.filename}
                        onClick={() => api.download(`/projects/${projectId}/files/${a.file!.id}/download`, a.file!.filename)}
                      >
                        {a.file.filename}
                      </button>
                    )}
                  </td>
                  {params.map((p) => {
                    const x = analysisValue(a, p)
                    const others = counted.filter((o) => o.id !== a.id).map((o) => analysisValue(o, p)).filter((v): v is number => v !== null)
                    const note = x !== null && !invalid ? outlierNote(x, others) : null
                    return (
                      <td
                        key={p}
                        className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
                        style={note ? { background: 'rgba(237,161,0,0.18)', fontWeight: 600 } : undefined}
                        title={note ?? undefined}
                      >
                        {x === null ? '—' : fmt(x)}
                        {note && <span aria-label={note}> ⚠</span>}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5">
                    <ValidityBadge valid={a.valid} />
                    {a.validated_by && <span className="block" style={muted}>{a.validated_by}</span>}
                  </td>
                  {canValidate && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <span className="inline-flex gap-1">
                        <Button variant={a.valid === true ? 'primary' : 'secondary'} disabled={busy} onClick={() => setValid([a.id], a.valid === true ? null : true)}>
                          ✓
                        </Button>
                        <Button variant={a.valid === false ? 'danger' : 'secondary'} disabled={busy} onClick={() => setValid([a.id], a.valid === false ? null : false)}>
                          ✗
                        </Button>
                        {canDelete && (
                          <Button variant="ghost" disabled={busy} onClick={() => remove(a)}>
                            excluir
                          </Button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: 'var(--color-border)' }}>
              <td className="py-1.5 pr-2 font-semibold">
                Média ± desvio
                <span className="block font-normal" style={muted}>
                  sem as inválidas (n = {counted.length})
                </span>
              </td>
              {params.map((p) => {
                const st = meanSd(counted.map((a) => analysisValue(a, p)).filter((v): v is number => v !== null))
                return (
                  <td key={p} className="px-2 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">
                    {st ? `${fmt(st.mean)}${st.sd !== null ? ` ± ${fmt(st.sd)}` : ''}` : '—'}
                    {st && st.sd !== null && st.mean !== 0 && (
                      <span className="block font-normal" style={muted}>
                        DPR {Math.abs((100 * st.sd) / st.mean).toFixed(1)} %
                      </span>
                    )}
                  </td>
                )
              })}
              <td />
              {canValidate && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
