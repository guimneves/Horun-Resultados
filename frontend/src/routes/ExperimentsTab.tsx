import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Experiment, SampleRow } from '../api/types'
import { GasCompositionChart } from '../charts/MoreCharts'
import { Button, card, Dropdown, Empty, ErrorBox, Field, inputClass, inputStyle, MenuItem, Modal, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmt, fmtTemp } from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import { useSamples } from '../lib/useSamples'
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
    <Modal title={initial ? `Corrida ${initial.code}` : 'Nova corrida'} onClose={onClose}>
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

// ---------------------------------------------------------------- ficha da corrida
// Espelha a "Planilha cálculo gás": blocos DADOS EXPERIMENTO (coluna A),
// REATOR / INICIAL / FINAL (coluna I) e a verificação da cromatografia.

type Entry = { value: unknown; unit: string }
type Block = { title: string; rows: [string, Entry][] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Divide os resultados da coluna I nos blocos da planilha, pela ordem dos rótulos. */
function splitResults(res: Record<string, Entry> | undefined): Block[] {
  const blocks: Block[] = [
    { title: 'Reator', rows: [] },
    { title: 'Inicial', rows: [] },
    { title: 'Final', rows: [] },
    { title: 'Verificação da cromatografia', rows: [] },
  ]
  let i = 0
  for (const [label, v] of Object.entries(res ?? {})) {
    const k = norm(label)
    if (i < 1 && (k.startsWith('massa de inicial') || k.startsWith('condicoes do teste') || k.startsWith('pressao atmosferica'))) i = 1
    if (i < 2 && (k.startsWith('pressao apos') || k.startsWith('pressao absoluta final'))) i = 2
    if (i < 3 && (k.startsWith('percentual molar % - demais') || k.startsWith('diferenca pvt') || k.startsWith('fechamento'))) i = 3
    blocks[i].rows.push([label, v])
  }
  return blocks.filter((b) => b.rows.length)
}

function findEntry(res: Record<string, Entry> | undefined, ...words: string[]): Entry | undefined {
  const hit = Object.entries(res ?? {}).find(([label]) => words.every((w) => norm(label).includes(w)))
  return hit?.[1]
}

const show = (v: Entry) => (typeof v.value === 'number' ? fmt(v.value) : String(v.value ?? '—'))

function SheetBlock({ block }: { block: Block }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
      <h3
        className="px-3 py-1.5 text-xs font-semibold tracking-wide uppercase"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}
      >
        {block.title}
      </h3>
      <table className="w-full text-sm">
        <tbody>
          {block.rows.map(([label, v], i) => (
            <tr key={label} style={{ background: i % 2 ? 'var(--color-surface)' : 'transparent' }}>
              <td className="px-3 py-1" style={muted}>
                {label.replace(/[:→←]/g, '').trim()}
              </td>
              <td className="px-2 py-1 text-right font-medium tabular-nums whitespace-nowrap">{show(v)}</td>
              <td className="w-14 py-1 pr-3 text-xs whitespace-nowrap" style={muted}>
                {v.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Highlight({ label, entry, unit }: { label: string; entry?: Entry | { value: number | null }; unit?: string }) {
  const value = entry?.value
  return (
    <div className="rounded-lg border px-3 py-2" style={card}>
      <div className="text-xs" style={muted}>
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">
        {typeof value === 'number' ? fmt(value) : '—'}
        <span className="ml-1 text-xs font-normal" style={muted}>
          {(entry as Entry | undefined)?.unit || unit || ''}
        </span>
      </div>
    </div>
  )
}

function RunSheet({
  exp,
  samples,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  exp: Experiment
  samples: SampleRow[]
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { fractionLabel } = useApp()
  const cond = exp.conditions.condicoes as Record<string, Entry> | undefined
  const res = exp.conditions.resultados as Record<string, Entry> | undefined
  const hasSheet = !!(cond && Object.keys(cond).length) || !!(res && Object.keys(res).length)
  const linked = samples.filter((s) => exp.samples.some((x) => x.id === s.id))
  const gas = linked.filter((s) => s.fraction === 'G')
  const yieldStat = gas.map((s) => s.values['gas_balanco.gas_yield_mg_g']).find((v) => v?.mean != null)
  const experimentBlock: Block = { title: 'Dados do experimento', rows: Object.entries(cond ?? {}) }

  return (
    <div className="space-y-4" data-testid="run-sheet">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{exp.code}</h2>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            {[
              fmtTemp(exp.temperature_c),
              exp.atmosphere || 'atmosfera não informada',
              exp.replicate_letter ? `réplica ${exp.replicate_letter}` : '',
              exp.reactor,
            ]
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="rounded-full px-2 py-0.5" style={{ background: 'var(--color-surface)' }}>
                  {t}
                </span>
              ))}
          </div>
        </div>
        {canEdit && (
          <Dropdown label="Mais" ariaLabel="Mais ações da corrida">
            <MenuItem onClick={onEdit}>Corrigir dados</MenuItem>
            {canDelete && (
              <MenuItem danger onClick={onDelete}>
                Excluir corrida
              </MenuItem>
            )}
          </Dropdown>
        )}
      </div>

      {!hasSheet ? (
        <Empty>A planilha de cálculo de gás desta corrida ainda não foi importada (Importar resultados → Balanço de gás).</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Highlight label="Massa inicial de amostra" entry={findEntry(cond, 'massa', 'inicial', 'amostra')} unit="g" />
            <Highlight label="Massa de gás gerada" entry={findEntry(res, 'massa de gas gerada')} unit="g" />
            <Highlight label="Gás gerado por massa de rocha" entry={yieldStat ? { value: yieldStat.mean } : undefined} unit="mg/g" />
            <Highlight label="Fechamento do balanço de pressão" entry={findEntry(res, 'fechamento')} unit="%" />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {experimentBlock.rows.length > 0 && <SheetBlock block={experimentBlock} />}
            <div className="space-y-3">
              {splitResults(res).map((b) => (
                <SheetBlock key={b.title} block={b} />
              ))}
            </div>
          </div>
        </>
      )}

      {gas.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase" style={muted}>
            Dados da cromatografia
          </h3>
          <GasCompositionChart samples={gas} />
        </div>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide uppercase" style={muted}>
          Amostras desta corrida
        </h3>
        <div className="flex flex-wrap gap-1">
          {exp.samples.length === 0 && <span style={muted}>nenhuma</span>}
          {exp.samples.map((s) => (
            <span key={s.id} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>
              {s.code} <span style={muted}>· {fractionLabel(s.fraction)}</span>
            </span>
          ))}
        </div>
      </div>
      {exp.notes && <p className="text-sm">{exp.notes}</p>}
    </div>
  )
}

export function ExperimentsTab() {
  const { project, canEdit } = useProject()
  const mobile = useIsMobile()
  const [list, setList] = useState<Experiment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Experiment | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const { samples } = useSamples(project.id, 'todas')

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
    if (!window.confirm(`Excluir a corrida ${exp.code}? As amostras continuam, só perdem a ligação.`)) return
    try {
      await api.delete(`/projects/${project.id}/experiments/${exp.id}`)
      setOpenId(null)
      load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const sorted = [...(list ?? [])].sort((a, b) => (a.temperature_c ?? 9999) - (b.temperature_c ?? 9999) || a.code.localeCompare(b.code))
  const byTemp = new Map<string, Experiment[]>()
  sorted.forEach((e) => {
    const k = fmtTemp(e.temperature_c)
    byTemp.set(k, [...(byTemp.get(k) ?? []), e])
  })
  const current = sorted.find((e) => e.id === openId) ?? (mobile ? undefined : sorted[0])
  const hasSheet = (e: Experiment) => Object.keys(e.conditions.condicoes ?? {}).length > 0

  const listView = (
    <nav className="space-y-3" aria-label="Corridas">
      {Array.from(byTemp.entries()).map(([temp, exps]) => (
        <div key={temp}>
          <div className="mb-1 px-1 text-xs font-semibold" style={muted}>
            {temp}
          </div>
          <div className="space-y-1">
            {exps.map((e) => {
              const active = current?.id === e.id
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenId(e.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm"
                  style={{
                    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    background: active ? 'var(--color-surface)' : 'var(--color-bg-elevated)',
                  }}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{e.code}</span>
                    <span className="block truncate text-xs" style={muted}>
                      {[e.atmosphere, e.replicate_letter && `réplica ${e.replicate_letter}`].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={hasSheet(e) ? { background: '#e3f4e8', color: '#1b6b34' } : { background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
                    title={hasSheet(e) ? 'Planilha de cálculo de gás importada' : 'Planilha de cálculo de gás ainda não importada'}
                  >
                    {hasSheet(e) ? 'planilha' : 'sem planilha'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="space-y-3">
      <p className="text-sm" style={muted}>
        As condições de cada corrida vêm da planilha de cálculo de gás, na importação (Importar resultados → Balanço de gás).
      </p>
      <ErrorBox message={error} />
      {list === null ? (
        <p style={muted}>Carregando…</p>
      ) : list.length === 0 ? (
        <Empty>Nenhuma corrida ainda. Importe a planilha de cálculo de gás.</Empty>
      ) : mobile ? (
        current ? (
          <div className="space-y-3">
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              ← Todas as corridas
            </Button>
            <RunSheet
              exp={current}
              samples={samples ?? []}
              canEdit={canEdit}
              canDelete={canEdit}
              onEdit={() => setEditing(current)}
              onDelete={() => remove(current)}
            />
          </div>
        ) : (
          listView
        )
      ) : (
        <div className="grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-4">
          <div className="sticky top-2 max-h-[80vh] overflow-y-auto pr-1">{listView}</div>
          <div className="rounded-lg border p-4" style={card}>
            {current && (
              <RunSheet
                exp={current}
                samples={samples ?? []}
                canEdit={canEdit}
                canDelete={canEdit}
                onEdit={() => setEditing(current)}
                onDelete={() => remove(current)}
              />
            )}
          </div>
        </div>
      )}
      {editing && (
        <ExperimentForm
          projectId={project.id}
          initial={editing}
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
