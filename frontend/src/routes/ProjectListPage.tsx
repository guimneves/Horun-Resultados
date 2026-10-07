import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api/client'
import type { Project } from '../api/types'
import { Button, card, Empty, ErrorBox, Field, inputClass, inputStyle, Modal, muted } from '../components/ui'
import { useApp } from '../context/AppContext'

export function ProjectForm({ initial, onDone, onCancel }: { initial?: Project; onDone: (p: Project) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [color, setColor] = useState(initial?.color ?? '#15216f')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = { name, description, color }
      const saved = initial ? await api.patch<Project>(`/projects/${initial.id}`, body) : await api.post<Project>('/projects', body)
      onDone(saved)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Nome do projeto">
        <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Descrição">
        <textarea className={inputClass} style={inputStyle} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Cor">
        <input type="color" className="h-10 w-20 rounded border" style={inputStyle} value={color} onChange={(e) => setColor(e.target.value)} />
      </Field>
      <ErrorBox message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>
          {initial ? 'Salvar' : 'Criar projeto'}
        </Button>
      </div>
    </div>
  )
}

export function ProjectListPage() {
  const { projects, me, reloadProjects } = useApp()
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const list = projects?.filter((p) => showArchived || !p.archived_at) ?? null

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">Projetos</h1>
          <p className="text-sm" style={muted}>
            Resultados de CHNSO, LECO, Rock-Eval e cromatografia, reunidos por projeto.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm" style={muted}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Mostrar arquivados
          </label>
          {me?.is_coordenador && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Novo projeto
            </Button>
          )}
        </div>
      </div>

      {list === null ? (
        <p style={muted}>Carregando…</p>
      ) : list.length === 0 ? (
        <Empty>{me?.is_coordenador ? 'Nenhum projeto ainda. Crie o primeiro em + Novo projeto.' : 'Nenhum projeto ainda. Peça a um coordenador para criar.'}</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}/amostras`} className="block rounded-lg border p-4 hover:shadow-sm" style={card}>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="truncate font-semibold">{p.name}</span>
                {p.archived_at && (
                  <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--color-surface)', ...muted }}>
                    arquivado
                  </span>
                )}
              </div>
              {p.description && (
                <p className="mt-1 line-clamp-2 text-sm" style={muted}>
                  {p.description}
                </p>
              )}
              <p className="mt-2 text-xs" style={muted}>
                {p.counts.samples} amostras · {p.counts.experiments} experimentos · {p.counts.analyses} medições
              </p>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="Novo projeto" onClose={() => setCreating(false)}>
          <ProjectForm
            onCancel={() => setCreating(false)}
            onDone={async () => {
              setCreating(false)
              await reloadProjects()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
