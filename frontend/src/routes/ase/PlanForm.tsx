import { useMemo, useState } from 'react'
import { api, errorText } from '../../api/client'
import type { DoeFactor, DoeFactorKind, DoePlan } from '../../api/types'
import { Button, ErrorBox, Field, inputClass, inputStyle, Modal, muted } from '../../components/ui'
import { useSamples } from '../../lib/useSamples'
import { KIND_LABELS, METHOD_LABELS } from './aseLib'

// Novo planejamento fatorial completo: 2, 3 ou 4 fatores (nome, unidade,
// tipo, níveis −1/+1), execuções por condição, pontos centrais (só quando
// possíveis), ordem aleatorizada, rocha pré-extração e condições fixas do método.

type FactorDraft = Omit<DoeFactor, 'letter' | 'low' | 'high'> & { low: string; high: string }

const LETTERS = 'ABCD'
// exemplo da planilha de referência (fatorial 2³ do ASE)
const EXAMPLE: FactorDraft[] = [
  { name: 'Número de ciclos', unit: 'ciclos', kind: 'discreto', low: '3', high: '6', low_label: '3 × 10 min', high_label: '6 × 10 min' },
  { name: 'Solvente', unit: '', kind: 'categorico', low: 'DCM', high: 'DCM/MeOH 93:7 (v/v)', low_label: '', high_label: '' },
  { name: 'Temperatura', unit: '°C', kind: 'continuo', low: '100', high: '120', low_label: '', high_label: '' },
]
const EMPTY: FactorDraft = { name: '', unit: '', kind: 'continuo', low: '', high: '', low_label: '', high_label: '' }

/** O ponto central existe? (mesma regra do servidor — app/services/doe.py) */
export function centerProblem(factors: { name: string; kind: DoeFactorKind; low: string | number; high: string | number }[]): string | null {
  const why: string[] = []
  factors.forEach((f, i) => {
    if (f.kind === 'categorico') why.push(`${LETTERS[i]} — ${f.name || 'fator'} é categórico (não há nível intermediário)`)
    else if (f.kind === 'discreto') {
      const mid = (Number(String(f.low).replace(',', '.')) + Number(String(f.high).replace(',', '.'))) / 2
      if (Number.isFinite(mid) && !Number.isInteger(mid)) why.push(`${LETTERS[i]} — ${f.name || 'fator'}: o ponto médio seria ${String(mid).replace('.', ',')}, que não é possível`)
    }
  })
  return why.length ? `Ponto central não é possível: ${why.join('; ')}.` : null
}

export function PlanForm({ projectId, onClose, onCreated }: { projectId: number; onClose: () => void; onCreated: (p: DoePlan) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [factors, setFactors] = useState<FactorDraft[]>([{ ...EMPTY }, { ...EMPTY }])
  const [replicates, setReplicates] = useState(2)
  const [centers, setCenters] = useState(0)
  const [randomized, setRandomized] = useState(false)
  const [preSample, setPreSample] = useState<number | ''>('')
  const [method, setMethod] = useState<Record<string, string>>({ equipment: 'ASE 350' })
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { samples } = useSamples(projectId, 'todas')
  const rocks = useMemo(() => (samples ?? []).filter((s) => s.kind === 'sample').sort((a, b) => a.code.localeCompare(b.code)), [samples])

  const problem = centerProblem(factors)
  const k = factors.length
  const total = 2 ** k * replicates + (problem ? 0 : centers)
  const patchFactor = (i: number, p: Partial<FactorDraft>) => setFactors(factors.map((f, j) => (j === i ? { ...f, ...p } : f)))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const p = await api.post<DoePlan>(`/projects/${projectId}/doe`, {
        name,
        description,
        factors: factors.map((f) => ({ ...f, low: f.kind === 'categorico' ? f.low : f.low.replace(',', '.'), high: f.kind === 'categorico' ? f.high : f.high.replace(',', '.') })),
        replicates,
        center_points: problem ? 0 : centers,
        randomized,
        pre_sample_id: preSample || null,
        method,
        code_template: template,
      })
      onCreated(p)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Novo planejamento fatorial" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Nome do planejamento">
            <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Otimização ASE — HP320" autoFocus />
          </Field>
          <Field label="Descrição (opcional)">
            <input className={inputClass} style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              Fatores ({k}) — fatorial 2{['', '', '²', '³', '⁴'][k]}: {2 ** k} condições
            </h3>
            <span className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setFactors(EXAMPLE.map((f) => ({ ...f })))}>
                Usar o exemplo do ASE (2³)
              </Button>
              {k < 4 && <Button onClick={() => setFactors([...factors, { ...EMPTY }])}>+ fator</Button>}
            </span>
          </div>
          <div className="space-y-2">
            {factors.map((f, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 md:grid-cols-12" style={{ borderColor: 'var(--color-border)' }}>
                <div className="col-span-2 flex items-center gap-2 md:col-span-3">
                  <span className="font-bold">{LETTERS[i]}</span>
                  <input className={inputClass} style={inputStyle} value={f.name} onChange={(e) => patchFactor(i, { name: e.target.value })} placeholder="Nome do fator" aria-label={`Nome do fator ${LETTERS[i]}`} />
                </div>
                <select className={`${inputClass} md:col-span-3`} style={inputStyle} value={f.kind} onChange={(e) => patchFactor(i, { kind: e.target.value as DoeFactorKind })} aria-label={`Tipo do fator ${LETTERS[i]}`}>
                  {Object.entries(KIND_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input className={`${inputClass} md:col-span-1`} style={inputStyle} value={f.unit} onChange={(e) => patchFactor(i, { unit: e.target.value })} placeholder="unid." aria-label={`Unidade do fator ${LETTERS[i]}`} disabled={f.kind === 'categorico'} />
                <div className="md:col-span-2">
                  <input className={inputClass} style={inputStyle} value={f.low} onChange={(e) => patchFactor(i, { low: e.target.value })} placeholder="Nível baixo (−1)" aria-label={`Nível baixo do fator ${LETTERS[i]}`} />
                  {f.kind !== 'categorico' && (
                    <input className={`${inputClass} mt-1`} style={inputStyle} value={f.low_label} onChange={(e) => patchFactor(i, { low_label: e.target.value })} placeholder="rótulo (opcional)" aria-label={`Rótulo do nível baixo ${LETTERS[i]}`} />
                  )}
                </div>
                <div className="md:col-span-2">
                  <input className={inputClass} style={inputStyle} value={f.high} onChange={(e) => patchFactor(i, { high: e.target.value })} placeholder="Nível alto (+1)" aria-label={`Nível alto do fator ${LETTERS[i]}`} />
                  {f.kind !== 'categorico' && (
                    <input className={`${inputClass} mt-1`} style={inputStyle} value={f.high_label} onChange={(e) => patchFactor(i, { high_label: e.target.value })} placeholder="rótulo (opcional)" aria-label={`Rótulo do nível alto ${LETTERS[i]}`} />
                  )}
                </div>
                <div className="flex items-start justify-end md:col-span-1">
                  {k > 2 && (
                    <Button variant="ghost" onClick={() => setFactors(factors.filter((_, j) => j !== i))} aria-label={`Tirar o fator ${LETTERS[i]}`}>
                      ✕
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Execuções independentes por condição" hint="1 = sem réplica; 2 = duplicata; 3 = triplicata…">
            <input type="number" min={1} max={10} className={inputClass} style={inputStyle} value={replicates} onChange={(e) => setReplicates(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Pontos centrais">
            <input
              type="number"
              min={0}
              max={10}
              className={inputClass}
              style={inputStyle}
              value={problem ? 0 : centers}
              disabled={!!problem}
              onChange={(e) => setCenters(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            />
          </Field>
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" checked={randomized} onChange={(e) => setRandomized(e.target.checked)} />
            Ordem planejada aleatorizada
          </label>
        </section>
        {problem && (
          <p className="rounded-md border p-2 text-xs" style={{ borderColor: 'var(--color-border)', ...muted }} role="note">
            {problem} Por isso este planejamento não terá pontos centrais.
          </p>
        )}
        <p className="font-medium">
          Total previsto: {total} extração(ões) ({2 ** k} condições × {replicates}
          {!problem && centers ? ` + ${centers} no centro` : ''}).
        </p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Rocha antes da extração (Rock-Eval pré)" hint="Amostra já cadastrada; serve para reduções de S1, S2, COT e ΔTmax.">
            <select className={inputClass} style={inputStyle} value={preSample} onChange={(e) => setPreSample(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— nenhuma por enquanto —</option>
              {rocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Código das extrações (opcional)" hint='Modelo com {cond} e {rep}, ex.: HP320_{cond}_R{rep}. Cada código casa com a amostra da rocha pós-ASE de mesmo nome.'>
            <input className={inputClass} style={inputStyle} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="HP320_{cond}_R{rep}" />
          </Field>
        </section>

        <details>
          <summary className="cursor-pointer font-semibold">Condições fixas do método (contexto, não são fatores)</summary>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {Object.entries(METHOD_LABELS).map(([key, label]) => (
              <Field key={key} label={label}>
                <input className={inputClass} style={inputStyle} value={method[key] ?? ''} onChange={(e) => setMethod({ ...method, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
        </details>

        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>
            Criar planejamento
          </Button>
        </div>
      </div>
    </Modal>
  )
}
