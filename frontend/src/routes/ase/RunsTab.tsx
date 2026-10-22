import { useMemo, useState } from 'react'
import { api, errorText } from '../../api/client'
import type { AseField, DoePlan, DoeRun } from '../../api/types'
import { Button, card, ErrorBox, Field, inputClass, inputStyle, Modal, muted, Segmented } from '../../components/ui'
import { useSamples } from '../../lib/useSamples'
import { useProject } from '../ProjectLayout'
import { val, withUnit } from './aseLib'

// Resultados finais de cada extração (pedido de 22/10/2026): só o que já foi
// apurado e corrigido pelo branco — sem pesagens intermediárias. Principais
// em destaque, complementares recolhidos, eficiências e diagnósticos
// calculados (não se digitam), Rock-Eval vindo da rocha pós-ASE ligada.

const TABLE_KEYS = ['m1_mg', 'y_m1', 'm6_mg', 'm3_mg', 'm4_mg', 'solvent_ml', 'time_min', 'eff_solvent']

export function RunsTab({ plan, onChange }: { plan: DoePlan; onChange: (p: DoePlan) => void }) {
  const { canEdit } = useProject()
  const [rep, setRep] = useState<string>('todas')
  const [onlyPending, setOnlyPending] = useState(false)
  const [editing, setEditing] = useState<DoeRun | null>(null)
  const fields = useMemo(() => new Map(plan.fields.map((f) => [f.key, f])), [plan.fields])
  const reps = Array.from(new Set(plan.runs.map((r) => r.replicate))).sort((a, b) => a - b)
  const shown = plan.runs.filter((r) => (rep === 'todas' || String(r.replicate) === rep) && (!onlyPending || !r.done))

  return (
    <section className="rounded-lg border p-3 md:p-4" style={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Resultados por execução</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Réplica"
            value={rep}
            onChange={setRep}
            options={[{ value: 'todas', label: 'Todas' }, ...reps.map((r) => ({ value: String(r), label: `R${r}` }))]}
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
            só pendentes
          </label>
        </div>
      </div>
      <div className="table-wrap max-h-[65vh] overflow-y-auto text-sm">
        <table className="w-full">
          <thead style={muted}>
            <tr>
              <th className="px-2 py-1 text-left font-medium">Execução</th>
              {plan.factors.map((f) => (
                <th key={f.letter} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                  {f.letter}
                </th>
              ))}
              {TABLE_KEYS.map((k) => (
                <th key={k} className="px-2 py-1 text-right font-medium" title={fields.get(k)?.label}>
                  {fields.get(k) ? withUnit(fields.get(k) as AseField) : k}
                </th>
              ))}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)', opacity: r.valid ? 1 : 0.55 }}>
                <td className="px-2 py-1 font-medium whitespace-nowrap">
                  {r.label}
                  {!r.valid && <span className="block text-xs font-normal">inválida</span>}
                  {r.flags.length > 0 && (
                    <span className="block text-xs font-normal" style={{ color: '#a15c00' }} title={r.flags.join('\n')}>
                      ⚠ {r.flags.length} aviso(s)
                    </span>
                  )}
                </td>
                {plan.factors.map((f) => (
                  <td key={f.letter} className="px-2 py-1 text-xs whitespace-nowrap">
                    {r.levels[f.letter]}
                  </td>
                ))}
                {TABLE_KEYS.map((k) => (
                  <td key={k} className="px-2 py-1 text-right tabular-nums">
                    {val(r.values[k])}
                    {k === 'solvent_ml' && r.values[k] != null && r.solvent_ml_kind && (
                      <span className="block text-[10px]" style={muted}>
                        {r.solvent_ml_kind}
                      </span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  <Button variant="ghost" onClick={() => setEditing(r)}>
                    {canEdit ? (r.done ? 'Editar' : 'Lançar') : 'Ver'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs" style={muted}>
        Valores ausentes aparecem como "—" (nunca como zero). Execução marcada como inválida fica fora das médias e da análise.
      </p>
      {editing && (
        <RunModal
          plan={plan}
          run={editing}
          readOnly={!canEdit}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null)
            onChange(p)
          }}
        />
      )}
    </section>
  )
}

function NumberInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input className={`${inputClass} text-right tabular-nums`} style={inputStyle} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
}

function RunModal({ plan, run, readOnly, onClose, onSaved }: { plan: DoePlan; run: DoeRun; readOnly: boolean; onClose: () => void; onSaved: (p: DoePlan) => void }) {
  const { project } = useProject()
  const inputs = plan.fields.filter((f) => f.input)
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((f) => [f.key, run.values[f.key] == null ? '' : String(run.values[f.key]).replace('.', ',')])),
  )
  const [kind, setKind] = useState<string>(run.solvent_ml_kind ?? 'estimado')
  const [code, setCode] = useState(run.code)
  const [actualOrder, setActualOrder] = useState(run.actual_order == null ? '' : String(run.actual_order))
  const [date, setDate] = useState(run.run_date)
  const [sample, setSample] = useState<number | ''>(run.sample_linked_by === 'escolhida' ? (run.sample_id ?? '') : '')
  const [valid, setValid] = useState(run.valid)
  const [notes, setNotes] = useState(run.notes)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { samples } = useSamples(project.id, 'todas')
  const rocks = (samples ?? []).filter((s) => s.kind === 'sample')

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const results: Record<string, string> = {}
      for (const f of inputs) if (draft[f.key].trim()) results[f.key] = draft[f.key].trim()
      if (results.solvent_ml) results.solvent_ml_kind = kind
      onSaved(
        await api.patch<DoePlan>(`/projects/${project.id}/doe/${plan.id}/runs/${run.id}`, {
          results,
          code,
          actual_order: actualOrder.trim() ? Number(actualOrder) : null,
          run_date: date,
          sample_id: sample || null,
          valid,
          notes,
        }),
      )
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const group = (g: string) => plan.fields.filter((f) => f.group === g)
  const inputGrid = (fs: AseField[]) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fs.map((f) => (
        <Field key={f.key} label={`${f.label} (${f.unit})`}>
          {readOnly ? (
            <span className="tabular-nums">{val(run.values[f.key])}</span>
          ) : (
            <NumberInput value={draft[f.key] ?? ''} onChange={(v) => setDraft({ ...draft, [f.key]: v })} label={f.label} />
          )}
          {f.key === 'solvent_ml' && !readOnly && (
            <span className="mt-1 flex gap-3 text-xs">
              {['medido', 'estimado'].map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                  {k === 'medido' ? 'medido (lido no equipamento/proveta)' : 'estimado (massa ÷ densidade)'}
                </label>
              ))}
            </span>
          )}
        </Field>
      ))}
    </div>
  )
  const readList = (fs: AseField[]) => (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {fs.map((f) => (
        <div key={f.key} className="flex justify-between gap-2 border-b py-0.5" style={{ borderColor: 'var(--color-border)' }}>
          <dt style={muted}>{f.label}</dt>
          <dd className="tabular-nums">
            {val(run.values[f.key])} {run.values[f.key] != null ? f.unit : ''}
          </dd>
        </div>
      ))}
    </dl>
  )

  return (
    <Modal title={`${run.label} — ${plan.factors.map((f) => run.levels[f.letter]).join(' · ')}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field label="Código da extração">
            <input className={inputClass} style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Ordem efetiva">
            <input className={inputClass} style={inputStyle} inputMode="numeric" value={actualOrder} onChange={(e) => setActualOrder(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Data">
            <input type="date" className={inputClass} style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} disabled={readOnly} />
          </Field>
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" checked={valid} onChange={(e) => setValid(e.target.checked)} disabled={readOnly} />
            Execução válida
          </label>
        </div>

        <section>
          <h4 className="mb-1 font-semibold">Resultados principais (finais, corrigidos pelo branco)</h4>
          {inputGrid(group('principal'))}
        </section>
        <details>
          <summary className="cursor-pointer font-semibold">Complementares (rendimentos M3/M4/M6, massa de solvente, massa de rocha)</summary>
          <div className="mt-2">{inputGrid(group('complementar'))}</div>
        </details>
        <section>
          <h4 className="mb-1 font-semibold">Eficiências e diagnósticos (calculados)</h4>
          {readList([...group('eficiencia'), ...group('diagnostico')])}
          <p className="mt-1 text-xs" style={muted}>
            As recuperações comparam métodos diferentes; não são eficiência absoluta de extração. Os valores mostrados são os salvos — salve para atualizar.
          </p>
          {run.flags.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs" style={{ color: '#a15c00' }}>
              {run.flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4 className="mb-1 font-semibold">Rock-Eval da rocha pós-ASE</h4>
          <p className="mb-2 text-xs" style={muted}>
            {run.sample_id
              ? run.sample_linked_by === 'código'
                ? 'Amostra ligada pelo código igual ao da extração. '
                : 'Amostra escolhida. '
              : 'Sem amostra ligada: importe o Rock-Eval da rocha residual com o mesmo código da extração, ou escolha a amostra abaixo. '}
            {run.sample_id && <strong>{rocks.find((x) => x.id === run.sample_id)?.code}</strong>}
          </p>
          {!readOnly && (
            <select className={`${inputClass} mb-2 max-w-md`} style={inputStyle} value={sample} onChange={(e) => setSample(e.target.value ? Number(e.target.value) : '')} aria-label="Amostra da rocha pós-ASE">
              <option value="">(pelo código da extração)</option>
              {rocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          )}
          {readList([...group('rockeval'), ...group('rockeval_delta')])}
        </section>
        <Field label="Observações">
          <textarea className={inputClass} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} />
        </Field>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{readOnly ? 'Fechar' : 'Cancelar'}</Button>
          {!readOnly && (
            <Button variant="primary" disabled={busy} onClick={save}>
              Salvar
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

