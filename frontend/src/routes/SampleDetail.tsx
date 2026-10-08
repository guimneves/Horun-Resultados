import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { AnalysisOut, Experiment, SampleDetail, SampleRow } from '../api/types'
import { SampleCharts } from '../charts/SampleCharts'
import { Button, Dropdown, ErrorBox, Field, inputClass, inputStyle, MenuItem, Modal, muted, ValidityBadge } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmt, fmtMeanSd, fmtTemp } from '../lib/format'

function ValidationButtons({ valid, onSet }: { valid: boolean | null; onSet: (v: boolean | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button variant={valid === true ? 'primary' : 'secondary'} onClick={() => onSet(true)}>
        Válida
      </Button>
      <Button variant={valid === false ? 'danger' : 'secondary'} onClick={() => onSet(false)}>
        Inválida
      </Button>
      {valid !== null && (
        <Button variant="ghost" onClick={() => onSet(null)}>
          Voltar a pendente
        </Button>
      )}
    </div>
  )
}

function AnalysisCard({
  a,
  canValidate,
  onValidate,
  onDelete,
  projectId,
}: {
  a: AnalysisOut
  canValidate: boolean
  onValidate: (v: boolean | null) => void
  onDelete: () => void
  projectId: number
}) {
  const { paramLabel } = useApp()
  const params = Array.from(new Set(a.values.map((v) => v.parameter)))
  const reps = Array.from(new Set(a.values.map((v) => v.replicate ?? 0))).sort()
  return (
    <div className="rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <strong>{a.source_name}</strong>
          {a.aliquot !== null && <span style={muted}> · alíquota {a.aliquot}</span>}
          {a.replicate !== null && <span style={muted}> · réplica {a.replicate}</span>}
          {a.analyzed_at && <span style={muted}> · {a.analyzed_at}</span>}
          {a.file && (
            <button
              type="button"
              className="ml-2 underline"
              style={{ color: 'var(--color-primary)' }}
              onClick={() => api.download(`/projects/${projectId}/files/${a.file!.id}/download`, a.file!.filename)}
            >
              {a.file.filename}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ValidityBadge valid={a.valid} />
          {canValidate && (
            <>
              <Button onClick={() => onValidate(a.valid === false ? null : false)}>{a.valid === false ? 'Reativar' : 'Invalidar'}</Button>
              <Button variant="ghost" onClick={onDelete}>
                Excluir
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="w-full text-xs">
          <thead>
            <tr style={muted}>
              <th className="py-1 pr-2 text-left font-medium">Parâmetro</th>
              {reps.map((r) => (
                <th key={r} className="px-2 py-1 text-right font-medium">
                  {r ? `rep. ${r}` : 'valor'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-1 pr-2">{paramLabel(`${a.technique}.${p}`)}</td>
                {reps.map((r) => (
                  <td key={r} className="px-2 py-1 text-right tabular-nums">
                    {fmt(a.values.find((v) => v.parameter === p && (v.replicate ?? 0) === r)?.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SampleDetailModal({
  projectId,
  sampleId,
  readOnly,
  samples = [],
  onClose,
  onChanged,
}: {
  projectId: number
  sampleId: number
  readOnly: boolean
  samples?: SampleRow[]
  onClose: () => void
  onChanged: () => void
}) {
  const { me, catalog, fractions, techniqueLabel, paramLabel, fractionLabel } = useApp()
  const [detail, setDetail] = useState<SampleDetail | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    code: '',
    fraction: '',
    temperature_c: '',
    experiment_id: '',
    notes: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [newAlias, setNewAlias] = useState('')
  const canValidate = !!me?.is_coordenador && !readOnly

  const load = useCallback(async () => {
    try {
      const d = await api.get<SampleDetail>(`/projects/${projectId}/samples/${sampleId}`)
      setDetail(d)
      setForm({
        code: d.code,
        fraction: d.fraction,
        temperature_c: d.temperature_c?.toString() ?? '',
        experiment_id: d.experiment_id?.toString() ?? '',
        notes: d.notes,
      })
    } catch (err) {
      setError(errorText(err))
    }
  }, [projectId, sampleId])

  useEffect(() => {
    load()
    api
      .get<Experiment[]>(`/projects/${projectId}/experiments`)
      .then(setExperiments)
      .catch(() => setExperiments([]))
  }, [load, projectId])

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function save() {
    await act(() =>
      api.patch(`/projects/${projectId}/samples/${sampleId}`, {
        code: form.code,
        fraction: form.fraction,
        temperature_c: form.temperature_c === '' ? null : Number(form.temperature_c.replace(',', '.')),
        experiment_id: form.experiment_id === '' ? null : Number(form.experiment_id),
        notes: form.notes,
      }),
    )
    setEditing(false)
  }

  const techniques = detail ? Array.from(new Set(detail.analyses.map((a) => a.technique))) : []
  // Resumo: por técnica, só os parâmetros principais (os mesmos das colunas padrão da tabela).
  const summaryCards = detail
    ? catalog
        .filter((t) => techniques.includes(t.key))
        .map((t) => {
          const rows = t.params
            .filter((p) => p.main && detail.values[`${t.key}.${p.key}`])
            .map((p) => [`${t.key}.${p.key}`, detail.values[`${t.key}.${p.key}`]] as const)
          return {
            key: t.key,
            label: t.label,
            count: detail.analyses.filter((a) => a.technique === t.key).length,
            rows,
          }
        })
        .filter((t) => t.rows.length > 0)
    : []

  return (
    <Modal title={detail ? `Amostra ${detail.code}` : 'Amostra'} onClose={onClose} wide="xl">
      {!detail ? (
        <p style={muted}>{error ?? 'Carregando…'}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <ErrorBox message={error} />
          {!editing ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
              <div>
                <span style={muted}>Fração</span>
                <div>{fractionLabel(detail.fraction)}</div>
              </div>
              <div>
                <span style={muted}>Temperatura</span>
                <div>{fmtTemp(detail.temperature_c)}</div>
              </div>
              <div>
                <span style={muted}>Experimento</span>
                <div>
                  {detail.experiment_code ?? '—'}
                  {detail.replicate_letter && <span style={muted}> (réplica {detail.replicate_letter})</span>}
                </div>
              </div>
              <div>
                <span style={muted}>Validade</span>
                <div>
                  <ValidityBadge valid={detail.valid} />
                  {detail.validated_by && (
                    <span className="ml-1 text-xs" style={muted}>
                      por {detail.validated_by}
                    </span>
                  )}
                </div>
              </div>
              {detail.notes && <p className="col-span-2 md:col-span-4">{detail.notes}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Código">
                <input className={inputClass} style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label="Fração">
                <select className={inputClass} style={inputStyle} value={form.fraction} onChange={(e) => setForm({ ...form, fraction: e.target.value })}>
                  {fractions.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.label} ({f.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Temperatura (°C)">
                <input
                  className={inputClass}
                  style={inputStyle}
                  inputMode="decimal"
                  value={form.temperature_c}
                  onChange={(e) => setForm({ ...form, temperature_c: e.target.value })}
                />
              </Field>
              <Field label="Experimento">
                <select
                  className={inputClass}
                  style={inputStyle}
                  value={form.experiment_id}
                  onChange={(e) => setForm({ ...form, experiment_id: e.target.value })}
                >
                  <option value="">(nenhum)</option>
                  {experiments.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Observações">
                  <textarea
                    className={inputClass}
                    style={inputStyle}
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <Button variant="primary" onClick={save}>
                    Salvar
                  </Button>
                  <Button onClick={() => setEditing(false)}>Cancelar</Button>
                </>
              ) : (
                <>
                  {canValidate && (
                    <ValidationButtons
                      valid={detail.valid}
                      onSet={(v) => act(() => api.post(`/projects/${projectId}/samples/${sampleId}/validation`, { valid: v }))}
                    />
                  )}
                  <Dropdown label="Mais" ariaLabel="Mais ações da amostra">
                    <MenuItem onClick={() => setEditing(true)}>Editar dados</MenuItem>
                    {canValidate && (
                      <MenuItem
                        danger
                        onClick={() => {
                          if (window.confirm(`Excluir a amostra ${detail.code} e todas as medições dela?`)) {
                            api
                              .delete(`/projects/${projectId}/samples/${sampleId}`)
                              .then(() => {
                                onChanged()
                                onClose()
                              })
                              .catch((err) => setError(errorText(err)))
                          }
                        }}
                      >
                        Excluir amostra
                      </MenuItem>
                    )}
                  </Dropdown>
                </>
              )}
            </div>
          )}

          <SampleCharts projectId={projectId} detail={detail} samples={samples} />

          {summaryCards.length > 0 && (
            <section>
              <h3 className="mb-2 font-semibold">Valores principais</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="sample-summary">
                {summaryCards.map((t) => (
                  <div key={t.key} className="rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{t.label}</span>
                      <span className="text-xs" style={muted}>
                        {t.count} medição(ões)
                      </span>
                    </div>
                    {t.rows.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2 py-0.5">
                        <span style={muted}>{paramLabel(k)}</span>
                        <span className="tabular-nums">{fmtMeanSd(v)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {detail.analyses.length > 0 && (
            <details className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
              <summary className="cursor-pointer font-semibold">Todos os valores e medições</summary>
              <div className="mt-3 space-y-4">
                {Object.keys(detail.values).length > 0 && (
                  <section>
                    <h3 className="mb-1 font-semibold">Todas as médias (réplicas e alíquotas)</h3>
                    <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 md:grid-cols-3">
                      {Object.entries(detail.values).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b py-1" style={{ borderColor: 'var(--color-border)' }}>
                          <span>
                            <span style={muted}>{techniqueLabel(k.split('.')[0])} · </span>
                            {paramLabel(k)}
                          </span>
                          <span className="tabular-nums">
                            {fmtMeanSd(v)} <span style={muted}>(n={v.n})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {detail.aliquots.length > 0 && (
                  <section>
                    <h3 className="mb-1 font-semibold">Por alíquota</h3>
                    <div className="table-wrap">
                      <table className="w-full text-xs">
                        <tbody>
                          {detail.aliquots.map((al) => (
                            <tr key={`${al.technique}-${al.aliquot}`} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                              <td className="py-1 pr-2 font-medium whitespace-nowrap">
                                {techniqueLabel(al.technique)} · alíquota {al.aliquot}
                              </td>
                              <td className="py-1">
                                {Object.entries(al.values)
                                  .map(([p, s]) => `${paramLabel(`${al.technique}.${p}`, false)}: ${fmtMeanSd(s)}`)
                                  .join(' · ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {techniques.map((t) => (
                  <section key={t}>
                    <h3 className="mb-1 font-semibold">{techniqueLabel(t)}</h3>
                    <div className="space-y-2">
                      {detail.analyses
                        .filter((a) => a.technique === t)
                        .map((a) => (
                          <AnalysisCard
                            key={a.id}
                            a={a}
                            projectId={projectId}
                            canValidate={canValidate}
                            onValidate={(v) => act(() => api.post(`/projects/${projectId}/analyses/${a.id}/validation`, { valid: v }))}
                            onDelete={() => {
                              if (window.confirm(`Excluir a medição ${a.source_name}?`)) act(() => api.delete(`/projects/${projectId}/analyses/${a.id}`))
                            }}
                          />
                        ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
            <summary className="cursor-pointer font-semibold">Nomes lembrados nos arquivos ({detail.aliases.length})</summary>
            <div className="mt-2">
              <p className="mb-1 text-xs" style={muted}>
                Quando um arquivo traz um destes nomes, a importação já atribui os resultados a esta amostra.
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {detail.aliases.length === 0 && <span style={muted}>nenhum</span>}
                {detail.aliases.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    {a.alias}
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Esquecer o nome ${a.alias}`}
                        className="flex h-6 w-6 items-center justify-center"
                        onClick={() => act(() => api.delete(`/projects/${projectId}/samples/${sampleId}/aliases/${a.id}`))}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {!readOnly && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    className={`${inputClass} max-w-xs`}
                    style={inputStyle}
                    placeholder="Outro nome usado nos arquivos"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    aria-label="Novo nome lembrado"
                  />
                  <Button
                    disabled={!newAlias.trim()}
                    onClick={() => act(() => api.post(`/projects/${projectId}/samples/${sampleId}/aliases`, { alias: newAlias })).then(() => setNewAlias(''))}
                  >
                    Lembrar nome
                  </Button>
                </div>
              )}
            </div>
          </details>
          {detail.analyses.length === 0 && <p style={muted}>Nenhuma medição ainda. Importe arquivos na aba Importar.</p>}
        </div>
      )}
    </Modal>
  )
}
