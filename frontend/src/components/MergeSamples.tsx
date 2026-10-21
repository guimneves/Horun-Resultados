import { useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import { useApp } from '../context/AppContext'
import { fmtTemp } from '../lib/format'
import { Button, ErrorBox, Modal, muted } from './ui'

// Unir amostras iguais (pedido do usuário, 21/10/2026): a mesma amostra com
// nomes diferentes. Todas as medições e nomes lembrados vão para a que fica;
// as outras saem e o nome delas passa a ser lembrado (a próxima importação já
// cai na amostra que ficou). POST /projects/{id}/samples/merge.

export interface MergeCandidate {
  id: number
  code: string
  fraction: string
  temperature_c: number | null
  n_analyses: number
}

interface MergeResult {
  analyses: number
  sources: { id: number; code: string }[]
  target: { id: number; code: string }
}

export function MergeSamplesModal({
  projectId,
  candidates,
  onClose,
  onDone,
}: {
  projectId: number
  candidates: MergeCandidate[]
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const { fractionLabel } = useApp()
  // por padrão fica a que tem mais medições
  const [target, setTarget] = useState(() => [...candidates].sort((a, b) => b.n_analyses - a.n_analyses)[0]?.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sources = candidates.filter((c) => c.id !== target)
  const moving = sources.reduce((n, c) => n + c.n_analyses, 0)

  async function merge() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<MergeResult>(`/projects/${projectId}/samples/merge`, { target_id: target, source_ids: sources.map((s) => s.id) })
      onDone(`${r.sources.map((s) => s.code).join(', ')} unida(s) em ${r.target.code} (${r.analyses} medição(ões) movida(s)).`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Unir amostras" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={muted}>
          Escolha a amostra que <strong>fica</strong>. As outras saem: as medições delas passam para a que fica (as médias juntam
          tudo) e o nome delas fica lembrado — a próxima importação com esse nome já cai na amostra certa.
        </p>
        <div className="space-y-1" role="radiogroup" aria-label="Amostra que fica">
          {candidates.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2" style={{ borderColor: c.id === target ? 'var(--color-primary)' : 'var(--color-border)' }}>
              <input type="radio" name="merge-target" checked={c.id === target} onChange={() => setTarget(c.id)} />
              <span className="font-medium">{c.code}</span>
              <span className="text-xs" style={muted}>
                {fractionLabel(c.fraction)}
                {c.temperature_c !== null ? ` · ${fmtTemp(c.temperature_c)}` : ''} · {c.n_analyses} medição(ões)
              </span>
              {c.id === target && (
                <span className="ml-auto text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
                  fica
                </span>
              )}
            </label>
          ))}
        </div>
        <p>
          {sources.length} amostra(s) saem; {moving} medição(ões) passam para <strong>{candidates.find((c) => c.id === target)?.code}</strong>.
          Fração, temperatura e validade da que fica não mudam.
        </p>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy || !sources.length} onClick={merge}>
            {busy ? 'Unindo…' : 'Unir'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

interface DupGroup {
  key: string
  samples: MergeCandidate[]
}

/** Lista as amostras que parecem a mesma (mesmo código sem acento, espaço,
 * pontuação, "de/da", réplica ou alíquota) — cada grupo com "Unir…". */
export function DuplicatesModal({ projectId, canEdit, onClose, onChanged }: { projectId: number; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { fractionLabel } = useApp()
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<MergeCandidate[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () =>
    api
      .get<{ groups: DupGroup[] }>(`/projects/${projectId}/samples/duplicates`)
      .then((r) => setGroups(r.groups))
      .catch((err) => setError(errorText(err)))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (merging)
    return (
      <MergeSamplesModal
        projectId={projectId}
        candidates={merging}
        onClose={() => setMerging(null)}
        onDone={(m) => {
          setMerging(null)
          setMsg(m)
          onChanged()
          load()
        }}
      />
    )
  return (
    <Modal title="Possíveis amostras repetidas" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={muted}>
          Amostras cujo código é o mesmo sem acentos, espaços, pontuação, &quot;de/da&quot;, réplica ou alíquota. É só uma sugestão: confira
          antes de unir. Para unir outras, use <strong>Selecionar várias</strong> na lista e <strong>Unir selecionadas</strong>.
        </p>
        <ErrorBox message={error} />
        {msg && <p style={{ color: 'var(--color-primary)' }}>{msg}</p>}
        {groups === null ? (
          <p style={muted}>Procurando…</p>
        ) : groups.length === 0 ? (
          <p style={muted}>Nenhuma amostra parece repetida.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {groups.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <span className="min-w-0">
                  {g.samples.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && <span style={muted}> · </span>}
                      <strong>{s.code}</strong>
                      <span className="text-xs" style={muted}>
                        {' '}
                        ({fractionLabel(s.fraction)}, {s.n_analyses})
                      </span>
                    </span>
                  ))}
                </span>
                {canEdit && <Button onClick={() => setMerging(g.samples)}>Unir…</Button>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  )
}
