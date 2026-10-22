import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, errorText } from '../api/client'
import type { SampleVariable, VariablesResponse, VariableValue } from '../api/types'
import { Button, card, ErrorBox, Field, inputClass, inputStyle, Modal, muted, Segmented } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'

// Variáveis de amostra (pedido do usuário, 22/10/2026): o eixo das Séries.
// Rocha já tem "Temperatura de hidropirólise"; tabaco, "Tipo". Pesquisadores e
// coordenadores criam outras (número com unidade, ou categoria), editam e
// preenchem os valores — um a um ou em lote (ex.: todas as réplicas).

export function useVariables(projectId: number) {
  const [data, setData] = useState<VariablesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      setData(await api.get<VariablesResponse>(`/projects/${projectId}/variables`))
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [projectId])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, setData, error, reload }
}

export function variableTitle(v: Pick<SampleVariable, 'label' | 'unit'>): string {
  return v.unit ? `${v.label} (${v.unit})` : v.label
}

const KIND_LABEL = { numero: 'Número', categoria: 'Categoria' } as const

type OptionRow = { orig: string | null; value: string }

function VariableForm({ projectId, variable, onClose, onSaved }: { projectId: number; variable: SampleVariable | null; onClose: () => void; onSaved: (d: VariablesResponse) => void }) {
  const [label, setLabel] = useState(variable?.label ?? '')
  const [kind, setKind] = useState<SampleVariable['kind']>(variable?.kind ?? 'numero')
  const [unit, setUnit] = useState(variable?.unit ?? '')
  const [description, setDescription] = useState(variable?.description ?? '')
  const [options, setOptions] = useState<OptionRow[]>(() =>
    variable?.options.length ? variable.options.map((o) => ({ orig: o.value, value: o.value })) : [{ orig: null, value: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const builtinFraction = variable?.builtin === 'fraction'
  const editOptions = kind === 'categoria' && (!variable || variable.options_editable)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const opts = options.map((o) => o.value.trim()).filter(Boolean)
      let d: VariablesResponse
      if (variable) {
        const body: Record<string, unknown> = { label, description }
        if (variable.kind === 'numero') body.unit = unit
        if (editOptions) {
          body.options = opts
          body.renames = Object.fromEntries(options.filter((o) => o.orig && o.value.trim() && o.orig !== o.value.trim()).map((o) => [o.orig, o.value.trim()]))
        }
        d = await api.patch<VariablesResponse>(`/projects/${projectId}/variables/${variable.id}`, body)
      } else {
        d = await api.post<VariablesResponse>(`/projects/${projectId}/variables`, { label, kind, unit: kind === 'numero' ? unit : '', options: kind === 'categoria' ? opts : [], description })
      }
      onSaved(d)
      onClose()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={variable ? `Editar variável — ${variable.label}` : 'Nova variável de amostra'} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <Field label="Nome">
          <input className={inputClass} style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex.: Pressão de H₂, Lote, Granulometria" autoFocus />
        </Field>
        {!variable ? (
          <div>
            <span className="mb-1 block font-medium">Tipo</span>
            <Segmented
              label="Tipo da variável"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'numero', label: 'Número (linhas nas Séries)' },
                { value: 'categoria', label: 'Categoria (barras nas Séries)' },
              ]}
            />
          </div>
        ) : (
          <p style={muted}>
            Tipo: {KIND_LABEL[variable.kind]}
            {variable.builtin && ' · variável do tipo de amostra (não pode ser apagada)'}
          </p>
        )}
        {kind === 'numero' && (
          <Field label="Unidade (opcional)">
            <input className={`${inputClass} max-w-[10rem]`} style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ex.: bar, h, mesh" />
          </Field>
        )}
        {kind === 'categoria' && builtinFraction && (
          <p style={muted}>
            As categorias ({variable?.options.map((o) => o.label).join(', ')}) são os tipos de amostra do projeto e não mudam aqui. O tipo de cada amostra muda
            na tabela abaixo ou na página da amostra.
          </p>
        )}
        {editOptions && (
          <div>
            <span className="mb-1 block font-medium">Categorias (na ordem dos gráficos)</span>
            <div className="space-y-1">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={o.value}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    aria-label={`Categoria ${i + 1}`}
                  />
                  <Button variant="ghost" disabled={i === 0} onClick={() => setOptions([...options.slice(0, i - 1), o, options[i - 1], ...options.slice(i + 1)])} aria-label="Subir">
                    ↑
                  </Button>
                  <Button variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Tirar categoria">
                    ✕
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setOptions([...options, { orig: null, value: '' }])}>
              + categoria
            </Button>
            {variable && (
              <p className="mt-1 text-xs" style={muted}>
                Mudar o nome de uma categoria muda também nas amostras que já a usam. Categoria em uso não pode sair.
              </p>
            )}
          </div>
        )}
        <Field label="Descrição (opcional)">
          <textarea className={inputClass} style={inputStyle} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Como medir ou preencher" />
        </Field>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy || !label.trim()} onClick={save}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ValueInput({ variable, value, onChange }: { variable: SampleVariable; value: VariableValue; onChange: (v: VariableValue) => void }) {
  if (variable.kind === 'categoria')
    return (
      <select className={`${inputClass} min-w-[8rem] py-1`} style={inputStyle} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value || null)} aria-label={variable.label}>
        {variable.builtin !== 'fraction' && <option value="">—</option>}
        {variable.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  return (
    <input
      className={`${inputClass} w-24 py-1 text-right tabular-nums`}
      style={inputStyle}
      inputMode="decimal"
      value={value == null ? '' : String(value).replace('.', ',')}
      onChange={(e) => onChange(e.target.value.trim() === '' ? null : e.target.value)}
      aria-label={variable.label}
    />
  )
}

export function VariablesTab() {
  const { project, canEdit } = useProject()
  const { fractionLabel } = useApp()
  const { data, setData, error, reload } = useVariables(project.id)
  const { samples, reload: reloadSamples } = useSamples(project.id, 'todas')
  const [editing, setEditing] = useState<SampleVariable | 'new' | null>(null)
  const [draft, setDraft] = useState<Record<string, VariableValue>>({}) // `${sampleId}:${key}` → valor digitado
  const [q, setQ] = useState('')
  const [onlyEmpty, setOnlyEmpty] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkKey, setBulkKey] = useState('')
  const [bulkValue, setBulkValue] = useState<VariableValue>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const vars = useMemo(() => data?.variables ?? [], [data])
  const bulkVar = vars.find((v) => v.key === bulkKey) ?? vars[0]
  const current = (sid: number, key: string): VariableValue => {
    const k = `${sid}:${key}`
    return k in draft ? draft[k] : (data?.values[String(sid)]?.[key] ?? null)
  }
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (samples ?? [])
      .filter((s) => s.kind === 'sample')
      .filter((s) => !term || s.code.toLowerCase().includes(term) || fractionLabel(s.fraction).toLowerCase().includes(term))
      .filter((s) => !onlyEmpty || (data?.values[String(s.id)]?.[onlyEmpty] ?? null) == null)
      .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
  }, [samples, q, onlyEmpty, data, fractionLabel])
  const pending = Object.keys(draft).length

  async function remove(v: SampleVariable) {
    if (!window.confirm(`Apagar a variável "${v.label}" e os ${v.n_values} valor(es) preenchidos? Não dá para desfazer.`)) return
    try {
      await api.delete(`/projects/${project.id}/variables/${v.id}`)
      await reload()
    } catch (err) {
      setSaveError(errorText(err))
    }
  }

  async function saveDraft() {
    setBusy(true)
    setSaveError(null)
    setSaved(null)
    try {
      const values = Object.entries(draft).map(([k, value]) => {
        const [sid, ...rest] = k.split(':')
        return { sample_id: Number(sid), key: rest.join(':'), value }
      })
      const d = await api.put<VariablesResponse>(`/projects/${project.id}/variables/values`, { values })
      setData(d)
      setDraft({})
      setSaved(`${values.length} valor(es) salvos.`)
      reloadSamples()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  function applyBulk() {
    if (!bulkVar) return
    const next = { ...draft }
    for (const sid of selected) next[`${sid}:${bulkVar.key}`] = bulkValue
    setDraft(next)
  }

  const allShownSelected = rows.length > 0 && rows.every((s) => selected.has(s.id))

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <section className="rounded-lg border p-3 md:p-4" style={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Variáveis de amostra</h2>
          {canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              + Nova variável
            </Button>
          )}
        </div>
        <p className="mb-3 text-sm" style={muted}>
          São os eixos da aba Séries: escolha lá a variável e os resultados aparecem em função dela. Número → linhas; categoria → barras.
        </p>
        {data === null ? (
          <p style={muted}>Carregando…</p>
        ) : vars.length === 0 ? (
          <p style={muted}>Nenhuma variável ainda.{canEdit ? ' Crie a primeira em "+ Nova variável".' : ''}</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {vars.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{variableTitle(v)}</span>{' '}
                  <span className="text-xs" style={muted}>
                    · {KIND_LABEL[v.kind]}
                    {v.kind === 'categoria' && ` (${v.options.map((o) => o.label).join(', ')})`} · {v.n_values} amostra(s) com valor
                    {v.builtin && ' · do tipo de amostra'}
                  </span>
                  {v.description && (
                    <span className="block text-xs" style={muted}>
                      {v.description}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <span className="flex gap-1">
                    <Button variant="ghost" onClick={() => setEditing(v)}>
                      Editar
                    </Button>
                    {v.can_delete && (
                      <Button variant="ghost" onClick={() => remove(v)}>
                        Apagar
                      </Button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {vars.length > 0 && (
        <section className="rounded-lg border p-3 md:p-4" style={card}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Valores por amostra</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputClass} w-44`} style={inputStyle} placeholder="Filtrar amostras" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar amostras" />
              <select className={`${inputClass} w-auto`} style={inputStyle} value={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.value)} aria-label="Só sem valor">
                <option value="">Todas as amostras</option>
                {vars.map((v) => (
                  <option key={v.key} value={v.key}>
                    Sem valor em {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {canEdit && selected.size > 0 && bulkVar && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm" style={{ borderColor: 'var(--color-primary)' }}>
              <span>{selected.size} selecionada(s): preencher</span>
              <select className={`${inputClass} w-auto py-1`} style={inputStyle} value={bulkVar.key} onChange={(e) => { setBulkKey(e.target.value); setBulkValue(null) }} aria-label="Variável a preencher">
                {vars.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span>com</span>
              <ValueInput key={bulkVar.key} variable={bulkVar} value={bulkValue} onChange={setBulkValue} />
              <Button onClick={applyBulk}>Aplicar</Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            </div>
          )}

          {samples === null ? (
            <p style={muted}>Carregando…</p>
          ) : rows.length === 0 ? (
            <p style={muted}>Nenhuma amostra.</p>
          ) : (
            <div className="table-wrap max-h-[60vh] overflow-y-auto text-sm">
              <table className="w-full">
                <thead style={muted}>
                  <tr>
                    {canEdit && (
                      <th className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={allShownSelected}
                          onChange={() => setSelected(allShownSelected ? new Set() : new Set(rows.map((s) => s.id)))}
                          aria-label="Selecionar todas as mostradas"
                        />
                      </th>
                    )}
                    <th className="px-2 py-1 text-left font-medium">Amostra</th>
                    {vars.map((v) => (
                      <th key={v.key} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                        {variableTitle(v)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      {canEdit && (
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => {
                              const next = new Set(selected)
                              if (next.has(s.id)) next.delete(s.id)
                              else next.add(s.id)
                              setSelected(next)
                            }}
                            aria-label={`Selecionar ${s.code}`}
                          />
                        </td>
                      )}
                      <td className="px-2 py-1 font-medium whitespace-nowrap">
                        {s.code}
                        <span className="block text-xs font-normal" style={muted}>
                          {fractionLabel(s.fraction)}
                        </span>
                      </td>
                      {vars.map((v) => {
                        const k = `${s.id}:${v.key}`
                        const value = current(s.id, v.key)
                        return (
                          <td key={v.key} className="px-2 py-1" style={k in draft ? { background: 'var(--color-surface)' } : undefined}>
                            {canEdit ? (
                              <ValueInput variable={v} value={value} onChange={(val) => setDraft({ ...draft, [k]: val })} />
                            ) : value == null ? (
                              <span style={muted}>—</span>
                            ) : (
                              (v.options.find((o) => o.value === value)?.label ?? String(value).replace('.', ','))
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ErrorBox message={saveError} />
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {saved && !pending && (
                <span className="text-sm" style={muted} role="status">
                  {saved}
                </span>
              )}
              {pending > 0 && (
                <Button variant="ghost" onClick={() => setDraft({})}>
                  Descartar
                </Button>
              )}
              <Button variant="primary" disabled={busy || pending === 0} onClick={saveDraft}>
                Salvar alterações{pending ? ` (${pending})` : ''}
              </Button>
            </div>
          )}
        </section>
      )}

      {editing && (
        <VariableForm projectId={project.id} variable={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={setData} />
      )}
    </div>
  )
}
