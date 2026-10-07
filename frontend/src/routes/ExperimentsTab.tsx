import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Experiment } from '../api/types'
import { BulkCreate } from '../components/BulkCreate'
import { Button, card, Empty, ErrorBox, Field, inputClass, inputStyle, Modal, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmt, fmtTemp } from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import { useProject } from './ProjectLayout'

const EMPTY = { code: '', temperature_c: '', atmosphere: '', replicate_letter: '', duration_h: '', reactor: '', initial_mass_g: '', date: '', notes: '' }
type Form = typeof EMPTY

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

function ExperimentForm({ projectId, initial, onClose, onDone }: { projectId: number; initial?: Experiment; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Form>(
    initial
      ? {
          code: initial.code,
          temperature_c: initial.temperature_c?.toString() ?? '',
          atmosphere: initial.atmosphere,
          replicate_letter: initial.replicate_letter,
          duration_h: initial.duration_h?.toString() ?? '',
          reactor: initial.reactor,
          initial_mass_g: initial.initial_mass_g?.toString() ?? '',
          date: initial.date,
          notes: initial.notes,
        }
      : EMPTY,
  )
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  async function save() {
    const body = {
      code: form.code,
      temperature_c: num(form.temperature_c),
      atmosphere: initial || form.atmosphere ? form.atmosphere : null,
      replicate_letter: initial || form.replicate_letter ? form.replicate_letter : null,
      duration_h: num(form.duration_h),
      reactor: form.reactor,
      initial_mass_g: num(form.initial_mass_g),
      date: form.date,
      notes: form.notes,
    }
    try {
      if (initial) await api.patch(`/projects/${projectId}/experiments/${initial.id}`, body)
      else await api.post(`/projects/${projectId}/experiments`, body)
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title={initial ? `Experimento ${initial.code}` : 'Novo experimento'} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Código" hint="Ex.: HP300NA (temperatura, N = nitrogênio, A = réplica). O resto é sugerido pelo código.">
          <input className={inputClass} style={inputStyle} value={form.code} onChange={set('code')} />
        </Field>
        <Field label="Temperatura (°C)">
          <input className={inputClass} style={inputStyle} inputMode="decimal" value={form.temperature_c} onChange={set('temperature_c')} />
        </Field>
        <Field label="Atmosfera">
          <input className={inputClass} style={inputStyle} value={form.atmosphere} onChange={set('atmosphere')} placeholder="nitrogênio" />
        </Field>
        <Field label="Réplica do experimento">
          <input className={inputClass} style={inputStyle} value={form.replicate_letter} onChange={set('replicate_letter')} placeholder="A, B, C" />
        </Field>
        <Field label="Tempo (h)">
          <input className={inputClass} style={inputStyle} inputMode="decimal" value={form.duration_h} onChange={set('duration_h')} />
        </Field>
        <Field label="Reator">
          <input className={inputClass} style={inputStyle} value={form.reactor} onChange={set('reactor')} />
        </Field>
        <Field label="Massa inicial (g)">
          <input className={inputClass} style={inputStyle} inputMode="decimal" value={form.initial_mass_g} onChange={set('initial_mass_g')} />
        </Field>
        <Field label="Data">
          <input type="date" className={inputClass} style={inputStyle} value={form.date} onChange={set('date')} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Observações">
            <textarea className={inputClass} style={inputStyle} rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!form.code.trim()} onClick={save}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Conditions({ exp }: { exp: Experiment }) {
  const blocks = [
    ['Condições (planilha de gás)', exp.conditions.condicoes],
    ['Resultados (planilha de gás)', exp.conditions.resultados],
  ] as const
  if (!blocks.some(([, b]) => b && Object.keys(b).length)) return null
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer" style={{ color: 'var(--color-primary)' }}>
        Ver condições lidas da planilha de gás
      </summary>
      {blocks.map(([title, block]) =>
        block && Object.keys(block).length ? (
          <div key={title} className="mt-2">
            <div className="font-semibold">{title}</div>
            <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {Object.entries(block).map(([label, v]) => (
                <div key={label} className="flex justify-between gap-2 border-b py-0.5" style={{ borderColor: 'var(--color-border)' }}>
                  <dt style={muted}>{label}</dt>
                  <dd className="text-right tabular-nums">
                    {typeof v.value === 'number' ? fmt(v.value) : String(v.value ?? '')} {v.unit}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null,
      )}
    </details>
  )
}

export function ExperimentsTab() {
  const { project, readOnly } = useProject()
  const { me, fractionLabel } = useApp()
  const mobile = useIsMobile()
  const [list, setList] = useState<Experiment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Experiment | 'new' | null>(null)
  const [bulk, setBulk] = useState(false)

  const load = useCallback(async () => {
    try {
      setList(await api.get<Experiment[]>(`/projects/${project.id}/experiments`))
    } catch (err) {
      setError(errorText(err))
    }
  }, [project.id])
  useEffect(() => {
    load()
  }, [load])

  async function remove(exp: Experiment) {
    if (!window.confirm(`Excluir o experimento ${exp.code}? As amostras ficam, só perdem o vínculo.`)) return
    try {
      await api.delete(`/projects/${project.id}/experiments/${exp.id}`)
      load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const actions = (exp: Experiment) =>
    readOnly ? null : (
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditing(exp)}>Editar</Button>
        {me?.is_coordenador && (
          <Button variant="ghost" onClick={() => remove(exp)}>
            Excluir
          </Button>
        )}
      </div>
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={muted}>
          Cada experimento é uma corrida de hidropirólise (ex.: HP300NA = 300 °C, atmosfera de nitrogênio, réplica A). A importação da
          cromatografia cria e completa os experimentos sozinha.
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setBulk(true)}>Criar vários</Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              + Novo experimento
            </Button>
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      {list === null ? (
        <p style={muted}>Carregando…</p>
      ) : list.length === 0 ? (
        <Empty>Nenhum experimento ainda.</Empty>
      ) : mobile ? (
        <div className="space-y-2">
          {list.map((e) => (
            <div key={e.id} className="rounded-lg border p-3" style={card}>
              <div className="font-semibold">{e.code}</div>
              <div className="text-xs" style={muted}>
                {fmtTemp(e.temperature_c)} · {e.atmosphere || 'atmosfera não informada'}
                {e.replicate_letter ? ` · réplica ${e.replicate_letter}` : ''}
                {e.reactor ? ` · ${e.reactor}` : ''}
              </div>
              <div className="mt-1 text-xs">{e.samples.map((s) => s.code).join(', ') || 'sem amostras'}</div>
              <Conditions exp={e} />
              <div className="mt-2">{actions(e)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap rounded-lg border" style={card}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={muted}>
                {['Código', 'Temp.', 'Atmosfera', 'Réplica', 'Reator', 'Massa inicial', 'Amostras', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium">
                    {e.code}
                    <Conditions exp={e} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTemp(e.temperature_c)}</td>
                  <td className="px-3 py-2">{e.atmosphere || '—'}</td>
                  <td className="px-3 py-2">{e.replicate_letter || '—'}</td>
                  <td className="px-3 py-2">{e.reactor || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.initial_mass_g !== null ? `${fmt(e.initial_mass_g)} g` : '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {e.samples.map((s) => (
                      <div key={s.id}>
                        {s.code} <span style={muted}>({fractionLabel(s.fraction)})</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2">{actions(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bulk && (
        <BulkCreate
          title="Criar vários experimentos"
          path={`/projects/${project.id}/experiments/bulk`}
          hint="Cole os códigos, um por linha (ex.: HP300NA, HP300NB, HP320NC). Temperatura, atmosfera e réplica são lidas do código."
          onClose={() => setBulk(false)}
          onDone={() => {
            setBulk(false)
            load()
          }}
        />
      )}
      {editing && (
        <ExperimentForm
          projectId={project.id}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
