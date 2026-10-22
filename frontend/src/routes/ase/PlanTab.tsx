import { useMemo, useState } from 'react'
import { api, errorText } from '../../api/client'
import type { DoePlan } from '../../api/types'
import { Button, card, ErrorBox, Field, inputClass, inputStyle, Modal, muted, Segmented } from '../../components/ui'
import { useSamples } from '../../lib/useSamples'
import { useProject } from '../ProjectLayout'
import { codedText, conditionLabel, KIND_LABELS, levelText, METHOD_LABELS } from './aseLib'

// Planejamento: fatores e níveis, condições fixas do método, a matriz (valores
// reais e codificados) e as execuções previstas, com a ordem planejada e a
// efetiva e o que já tem resultado.

export function PlanTab({ plan, onChange, onDeleted }: { plan: DoePlan; onChange: (p: DoePlan) => void; onDeleted: () => void }) {
  const { project, canEdit } = useProject()
  const [matrix, setMatrix] = useState<'reais' | 'codificados'>('reais')
  const [order, setOrder] = useState<'condicao' | 'planejada' | 'efetiva'>('condicao')
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runs = useMemo(() => {
    const rs = [...plan.runs]
    if (order === 'planejada') rs.sort((a, b) => (a.planned_order ?? 999) - (b.planned_order ?? 999))
    if (order === 'efetiva') rs.sort((a, b) => (a.actual_order ?? 999) - (b.actual_order ?? 999) || (a.planned_order ?? 0) - (b.planned_order ?? 0))
    return rs
  }, [plan.runs, order])

  async function randomize() {
    if (!window.confirm('Sortear de novo a ordem planejada? A ordem efetiva (o que já foi feito) não muda.')) return
    try {
      onChange(await api.post<DoePlan>(`/projects/${project.id}/doe/${plan.id}/randomize`))
    } catch (err) {
      setError(errorText(err))
    }
  }
  async function remove() {
    if (!window.confirm(`Excluir o planejamento "${plan.name}" e TODOS os resultados das ${plan.n_runs} execuções? Não dá para desfazer.`)) return
    try {
      await api.delete(`/projects/${project.id}/doe/${plan.id}`)
      onDeleted()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const method = Object.entries(plan.method).filter(([, v]) => v)
  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <section className="rounded-lg border p-3 md:p-4" style={card}>
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="text-sm" style={muted}>
              Fatorial completo 2{['', '', '²', '³', '⁴'][plan.factors.length]} · {plan.conditions_matrix.length} condições × {plan.replicates} execução(ões)
              {plan.center_points ? ` + ${plan.center_points} ponto(s) central(is)` : ''} = {plan.n_runs} extrações · {plan.n_done} com resultado ·{' '}
              {plan.n_runs - plan.n_done} pendente(s)
            </p>
            {plan.description && <p className="mt-1 text-sm">{plan.description}</p>}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setImporting(true)}>Importar planilha de resultados</Button>
              <Button onClick={() => setEditing(true)}>Editar</Button>
              <Button variant="ghost" onClick={randomize}>
                Sortear ordem
              </Button>
              <Button variant="danger" onClick={remove}>
                Excluir
              </Button>
            </div>
          )}
        </div>
        <div className="table-wrap text-sm">
          <table className="w-full">
            <thead style={muted}>
              <tr>
                <th className="px-2 py-1 text-left font-medium">Fator</th>
                <th className="px-2 py-1 text-left font-medium">Tipo</th>
                <th className="px-2 py-1 text-left font-medium">Nível baixo (−1)</th>
                <th className="px-2 py-1 text-left font-medium">Nível alto (+1)</th>
              </tr>
            </thead>
            <tbody>
              {plan.factors.map((f) => (
                <tr key={f.letter} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-2 py-1 font-medium">
                    {f.letter} — {f.name}
                    {f.unit ? ` (${f.unit})` : ''}
                  </td>
                  <td className="px-2 py-1" style={muted}>
                    {KIND_LABELS[f.kind]}
                  </td>
                  <td className="px-2 py-1">{levelText(f, -1)}</td>
                  <td className="px-2 py-1">{levelText(f, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs" style={muted}>
          {plan.center_possible
            ? plan.center_points
              ? `Ponto central: ${plan.factors.map((f) => `${f.name} = ${levelText(f, 0)}`).join(', ')}.`
              : 'Ponto central possível (todos os fatores numéricos com ponto médio válido) — dá para acrescentar em Editar.'
            : plan.center_reason}
        </p>
        <div className="mt-2 grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-2">
          <p>
            <span style={muted}>Rocha pré-extração (Rock-Eval antes): </span>
            {plan.pre_sample ? plan.pre_sample.code : <span style={muted}>não escolhida — escolha em Editar para ver reduções de S1, S2 e COT</span>}
          </p>
          {method.map(([k, v]) => (
            <p key={k}>
              <span style={muted}>{METHOD_LABELS[k] ?? k}: </span>
              {v}
            </p>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-3 md:p-4" style={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Matriz do planejamento</h3>
          <Segmented
            label="Valores da matriz"
            value={matrix}
            onChange={setMatrix}
            options={[
              { value: 'reais', label: 'Valores reais' },
              { value: 'codificados', label: 'Codificados (±1)' },
            ]}
          />
        </div>
        <div className="table-wrap text-sm">
          <table className="w-full">
            <thead style={muted}>
              <tr>
                <th className="px-2 py-1 text-left font-medium">Condição</th>
                {plan.factors.map((f) => (
                  <th key={f.letter} className="px-2 py-1 text-left font-medium">
                    {f.letter} — {f.name}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-medium">Com resultado</th>
              </tr>
            </thead>
            <tbody>
              {plan.conditions.map((c) => (
                <tr key={c.code} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-2 py-1 font-medium">{conditionLabel(c.code)}</td>
                  {plan.factors.map((f) => (
                    <td key={f.letter} className="px-2 py-1 tabular-nums">
                      {matrix === 'reais' ? c.levels[f.letter] : codedText(c.coded[f.letter])}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right tabular-nums">
                    {c.n_done}/{c.n_runs}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-3 md:p-4" style={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Execuções (extrações)</h3>
          <Segmented
            label="Ordenar"
            value={order}
            onChange={setOrder}
            options={[
              { value: 'condicao', label: 'Por condição' },
              { value: 'planejada', label: 'Ordem planejada' },
              { value: 'efetiva', label: 'Ordem efetiva' },
            ]}
          />
        </div>
        <div className="table-wrap max-h-[50vh] overflow-y-auto text-sm">
          <table className="w-full">
            <thead style={muted}>
              <tr>
                <th className="px-2 py-1 text-left font-medium">Execução</th>
                <th className="px-2 py-1 text-left font-medium">Código</th>
                <th className="px-2 py-1 text-right font-medium">Ordem planejada</th>
                <th className="px-2 py-1 text-right font-medium">Ordem efetiva</th>
                <th className="px-2 py-1 text-left font-medium">Rocha pós-ASE</th>
                <th className="px-2 py-1 text-left font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)', opacity: r.valid ? 1 : 0.55 }}>
                  <td className="px-2 py-1 font-medium whitespace-nowrap">{r.label}</td>
                  <td className="px-2 py-1 text-xs">{r.code || <span style={muted}>—</span>}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.planned_order ?? '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.actual_order ?? '—'}</td>
                  <td className="px-2 py-1 text-xs">{r.sample_id ? (r.sample_linked_by === 'código' ? 'ligada pelo código' : 'escolhida') : <span style={muted}>sem Rock-Eval</span>}</td>
                  <td className="px-2 py-1 text-xs">{!r.valid ? 'inválida' : r.done ? 'com resultado' : <span style={muted}>pendente</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && <PlanEditModal plan={plan} onClose={() => setEditing(false)} onSaved={(p) => { setEditing(false); onChange(p) }} />}
      {importing && <ImportModal plan={plan} onClose={() => setImporting(false)} onDone={(p) => { setImporting(false); onChange(p) }} />}
    </div>
  )
}

function PlanEditModal({ plan, onClose, onSaved }: { plan: DoePlan; onClose: () => void; onSaved: (p: DoePlan) => void }) {
  const { project } = useProject()
  const [name, setName] = useState(plan.name)
  const [description, setDescription] = useState(plan.description)
  const [replicates, setReplicates] = useState(plan.replicates)
  const [centers, setCenters] = useState(plan.center_points)
  const [pre, setPre] = useState<number | ''>(plan.pre_sample?.id ?? '')
  const [method, setMethod] = useState<Record<string, string>>(plan.method)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { samples } = useSamples(project.id, 'todas')
  async function save() {
    setBusy(true)
    setError(null)
    try {
      onSaved(
        await api.patch<DoePlan>(`/projects/${project.id}/doe/${plan.id}`, {
          name,
          description,
          replicates,
          center_points: plan.center_possible ? centers : 0,
          pre_sample_id: pre || null,
          method,
        }),
      )
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Modal title="Editar planejamento" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Nome">
            <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Descrição">
            <input className={inputClass} style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Execuções por condição" hint="Aumentar acrescenta R3, R4…; diminuir só tira execuções ainda sem resultado.">
            <input type="number" min={1} max={10} className={inputClass} style={inputStyle} value={replicates} onChange={(e) => setReplicates(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Pontos centrais" hint={plan.center_possible ? undefined : plan.center_reason}>
            <input type="number" min={0} max={10} className={inputClass} style={inputStyle} value={plan.center_possible ? centers : 0} disabled={!plan.center_possible} onChange={(e) => setCenters(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Rocha antes da extração (Rock-Eval pré)">
            <select className={inputClass} style={inputStyle} value={pre} onChange={(e) => setPre(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— nenhuma —</option>
              {(samples ?? [])
                .filter((s) => s.kind === 'sample')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {Object.entries(METHOD_LABELS).map(([key, label]) => (
            <Field key={key} label={label}>
              <input className={inputClass} style={inputStyle} value={method[key] ?? ''} onChange={(e) => setMethod({ ...method, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <p className="text-xs" style={muted}>
          Fatores e níveis não mudam depois de criado (as condições e os resultados dependem deles) — para outro estudo, crie outro planejamento.
        </p>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy} onClick={save}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

type ImportPreview = { dry_run: boolean; rows: { run: string; code: string; fields: string[]; code_changes: boolean }[]; not_in_plan: string[]; warnings: string[]; sheets: number }

function ImportModal({ plan, onClose, onDone }: { plan: DoePlan; onClose: () => void; onDone: (p: DoePlan) => void }) {
  const { project } = useProject()
  const [file, setFile] = useState<File | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function send(dry: boolean) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('dry_run', String(dry))
      form.append('overwrite', String(overwrite))
      const r = await api.postForm<ImportPreview>(`/projects/${project.id}/doe/${plan.id}/import`, form)
      if (dry) setPreview(r)
      else onDone(await api.get<DoePlan>(`/projects/${project.id}/doe/${plan.id}`))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Importar resultados da planilha" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p style={muted}>
          Planilha de resultados com as abas <strong>Consolidado R1</strong>, <strong>Consolidado R2</strong>… Cada coluna F01, F02… vira a execução da mesma
          condição e réplica. Entram só os resultados finais (corrigidos pelo branco): M1, rendimento, M6, M3/M4 corrigidos, volume e consumo de solvente,
          tempo, massa de rocha e rendimentos M3/M4/M6. Pesagens, brancos e valores sem correção não entram. A condição F01… da planilha precisa ser a mesma
          da matriz deste planejamento.
        </p>
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null) }} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={overwrite} onChange={(e) => { setOverwrite(e.target.checked); setPreview(null) }} />
          Substituir o que já foi digitado (sem marcar, só preenche o que está vazio)
        </label>
        {preview && (
          <div className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
            <p className="font-medium">
              {preview.sheets} aba(s) lida(s) · {preview.rows.length} execução(ões)
            </p>
            <ul className="mt-1 max-h-56 overflow-y-auto text-xs">
              {preview.rows.map((r) => (
                <li key={r.run}>
                  <strong>{r.run}</strong>
                  {r.code && r.code_changes ? ` · código ${r.code}` : ''} — {r.fields.length ? r.fields.join(', ') : <span style={muted}>nada novo</span>}
                </li>
              ))}
            </ul>
            {preview.not_in_plan.length > 0 && <p className="mt-1 text-xs">Fora deste planejamento (ignoradas): {preview.not_in_plan.join(', ')}.</p>}
            {preview.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs" style={{ color: '#a15c00' }}>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          {!preview ? (
            <Button variant="primary" disabled={!file || busy} onClick={() => send(true)}>
              Ver o que entra
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => send(false)}>
              Importar
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
