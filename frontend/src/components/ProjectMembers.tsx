import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { DirectoryPerson, Project, ProjectMember } from '../api/types'
import { LEVEL_LABELS } from '../lib/devIdentity'
import { fmtDateTime } from '../lib/format'
import { Button, Empty, ErrorBox, inputClass, inputStyle, Modal, muted } from './ui'

function personLabel(p: { display_name: string; username: string }): string {
  return p.display_name || p.username
}

function levelLabel(level: number | null): string {
  return level ? (LEVEL_LABELS[level] ?? '') : ''
}

/** Escolha de uma pessoa do Horun com busca (nome, usuário ou cargo). */
function PersonPicker({ projectId, onAdded, onCancel }: { projectId: number; onAdded: () => void; onCancel: () => void }) {
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<DirectoryPerson[]>(`/projects/${projectId}/members/candidates`)
      .then(setPeople)
      .catch((err) => {
        setPeople([])
        setError(errorText(err))
      })
  }, [projectId])

  const q = query.trim().toLowerCase()
  const shown = (people ?? []).filter((p) => !q || [p.display_name, p.username, levelLabel(p.level)].some((t) => t.toLowerCase().includes(q)))

  async function add(person: DirectoryPerson) {
    setBusy(person.user_id)
    setError(null)
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: person.user_id })
      onAdded()
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }}>
      <input
        className={inputClass}
        style={inputStyle}
        value={query}
        autoFocus
        placeholder="Buscar por nome, usuário ou cargo"
        aria-label="Buscar pessoa"
        onChange={(e) => setQuery(e.target.value)}
      />
      <ErrorBox message={error} />
      {people === null ? (
        <p className="text-sm" style={muted}>
          Carregando…
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm" style={muted}>
          {people.length === 0
            ? 'Ninguém disponível para adicionar. A pessoa precisa ter aberto o Resultados pelo Horun ao menos uma vez para aparecer aqui.'
            : 'Ninguém encontrado com essa busca.'}
        </p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
          {shown.map((p) => (
            <li key={p.user_id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{personLabel(p)}</div>
                <div className="truncate text-xs" style={muted}>
                  {levelLabel(p.level)}
                  {p.display_name && p.display_name !== p.username ? ` · ${p.username}` : ''}
                </div>
              </div>
              <Button variant="primary" disabled={busy !== null} onClick={() => add(p)}>
                {busy === p.user_id ? 'Adicionando…' : 'Adicionar'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button onClick={onCancel}>Fechar busca</Button>
      </div>
    </div>
  )
}

/** "Pessoas do projeto": quem (além de coordenadores) tem acesso ao projeto. */
export function ProjectMembersModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const canManage = project.can_manage_members

  const load = useCallback(() => {
    api
      .get<ProjectMember[]>(`/projects/${project.id}/members`)
      .then(setMembers)
      .catch((err) => setError(errorText(err)))
  }, [project.id])
  useEffect(load, [load])

  async function remove(m: ProjectMember) {
    if (!window.confirm(`Remover ${personLabel(m)} do projeto? A pessoa deixa de ver o projeto na hora.`)) return
    setError(null)
    try {
      await api.delete(`/projects/${project.id}/members/${m.id}`)
      load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title="Pessoas do projeto" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p style={muted}>
          Coordenadores e o administrador máximo veem todos os projetos. Pesquisadores, técnicos e ICs só veem os projetos em que estão nesta lista.
        </p>
        <ErrorBox message={error} />
        {canManage &&
          (picking ? (
            <PersonPicker
              projectId={project.id}
              onCancel={() => setPicking(false)}
              onAdded={() => {
                setPicking(false)
                load()
              }}
            />
          ) : (
            <Button variant="primary" onClick={() => setPicking(true)}>
              + Adicionar pessoa
            </Button>
          ))}
        {members === null ? (
          <p style={muted}>Carregando…</p>
        ) : members.length === 0 ? (
          <Empty>Ninguém adicionado ainda.</Empty>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{personLabel(m)}</div>
                  <div className="text-xs" style={muted}>
                    {levelLabel(m.level)} · adicionado(a) por {m.added_by} em {fmtDateTime(m.added_at)}
                  </div>
                </div>
                {canManage && m.can_remove && (
                  <Button variant="ghost" aria-label={`Remover ${personLabel(m)}`} onClick={() => remove(m)}>
                    Remover
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <p className="text-xs" style={muted}>
            Coordenadores adicionam pesquisadores, técnicos e ICs; pesquisadores adicionam e removem técnicos e ICs.
          </p>
        )}
      </div>
    </Modal>
  )
}
