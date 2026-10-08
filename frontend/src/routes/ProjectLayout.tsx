import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, errorText } from '../api/client'
import type { Project } from '../api/types'
import { PROJECT_TABS } from '../components/Shell'
import { Button, Dropdown, ErrorBox, Field, inputClass, inputStyle, MenuItem, Modal, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { ProjectForm } from './ProjectListPage'

export interface ProjectCtx {
  project: Project
  /** Projeto arquivado (só leitura para todos). */
  readOnly: boolean
  /** Pode importar e alterar: projeto aberto e cargo de pesquisador(a) para cima. */
  canEdit: boolean
}

export function useProject(): ProjectCtx {
  return useOutletContext<ProjectCtx>()
}

function DeleteProject({ project, onClose }: { project: Project; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { reloadProjects } = useApp()
  const navigate = useNavigate()
  return (
    <Modal title="Excluir projeto" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>
          Isto apaga <strong>para sempre</strong> o projeto, todas as amostras, experimentos, medições e os arquivos importados nele. Não dá para desfazer. Se a
          ideia é só tirar da lista, use <strong>Arquivar</strong>.
        </p>
        <Field label={`Para confirmar, digite o nome do projeto: ${project.name}`}>
          <input className={inputClass} style={inputStyle} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        <ErrorBox message={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            disabled={typed.trim() !== project.name}
            onClick={async () => {
              try {
                await api.delete(`/projects/${project.id}`, { confirm_name: typed.trim() })
                await reloadProjects()
                navigate('/')
              } catch (err) {
                setError(errorText(err))
              }
            }}
          >
            Excluir para sempre
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function ProjectLayout() {
  const { projectId } = useParams()
  const { projects, me, reloadProjects } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = projects?.find((p) => p.id === Number(projectId))

  if (projects === null)
    return (
      <p className="p-6" style={muted}>
        Carregando…
      </p>
    )
  if (!project) return <p className="p-6">Projeto não encontrado.</p>
  const readOnly = project.archived_at !== null
  const canEdit = !readOnly && !!me?.can_edit

  async function toggleArchive() {
    if (!project) return
    setError(null)
    try {
      await api.post(`/projects/${project.id}/${project.archived_at ? 'unarchive' : 'archive'}`)
      await reloadProjects()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <div className="p-3 md:p-6">
      {/* Cabeçalho enxuto: nome à esquerda; à direita só Importar e o menu do projeto. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: project.color }} />
            <span className="truncate">{project.name}</span>
            {readOnly && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: '#fff3e0', color: '#a15c00' }}>
                arquivado · só leitura
              </span>
            )}
          </h1>
          {project.description && (
            <p className="truncate text-sm" style={muted} title={project.description}>
              {project.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Link
              to={`/projects/${project.id}/importar`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', borderColor: 'var(--color-primary)' }}
            >
              Importar resultados
            </Link>
          )}
          {(me?.is_coordenador || me?.can_see_history) && (
            <Dropdown label="Projeto" ariaLabel="Ações do projeto">
              {me?.can_see_history && <MenuItem onClick={() => navigate(`/projects/${project.id}/historico`)}>Histórico</MenuItem>}
              {me?.is_coordenador && <MenuItem onClick={() => setEditing(true)}>Editar projeto</MenuItem>}
              {me?.is_coordenador && <MenuItem onClick={toggleArchive}>{project.archived_at ? 'Desarquivar' : 'Arquivar'}</MenuItem>}
              {me?.can_delete_projects && (
                <MenuItem danger onClick={() => setDeleting(true)}>
                  Excluir projeto
                </MenuItem>
              )}
            </Dropdown>
          )}
        </div>
      </div>
      <ErrorBox message={error} />

      <nav className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b" style={{ borderColor: 'var(--color-border)' }} aria-label="Abas do projeto">
        {PROJECT_TABS.map((tab) => {
          const to = `/projects/${project.id}/${tab.to}`
          const active = location.pathname.startsWith(to)
          return (
            <Link
              key={tab.to}
              to={to}
              className="whitespace-nowrap border-b-2 px-3 py-2 text-sm"
              style={{
                borderColor: active ? 'var(--color-primary)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                fontWeight: active ? 600 : 400,
              }}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          )
        })}
        {['importar', 'historico'].map((extra) =>
          location.pathname.startsWith(`/projects/${project.id}/${extra}`) ? (
            <span key={extra} className="whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--color-primary)' }}>
              {extra === 'importar' ? 'Importar' : 'Histórico'}
            </span>
          ) : null,
        )}
      </nav>

      <Outlet context={{ project, readOnly, canEdit } satisfies ProjectCtx} />

      {editing && (
        <Modal title="Editar projeto" onClose={() => setEditing(false)}>
          <ProjectForm
            initial={project}
            onCancel={() => setEditing(false)}
            onDone={async () => {
              setEditing(false)
              await reloadProjects()
            }}
          />
        </Modal>
      )}
      {deleting && <DeleteProject project={project} onClose={() => setDeleting(false)} />}
    </div>
  )
}
