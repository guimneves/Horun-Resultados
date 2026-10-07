import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, errorText } from '../api/client'
import type { Project } from '../api/types'
import { PROJECT_TABS } from '../components/Shell'
import { Button, ErrorBox, Field, inputClass, inputStyle, Modal, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { ProjectForm } from './ProjectListPage'

export interface ProjectCtx {
  project: Project
  readOnly: boolean
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
          Isto apaga <strong>para sempre</strong> o projeto, todas as amostras, experimentos, medições e os arquivos importados nele. Não
          dá para desfazer. Se a ideia é só tirar da lista, use <strong>Arquivar</strong>.
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
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = projects?.find((p) => p.id === Number(projectId))

  if (projects === null) return <p className="p-6" style={muted}>Carregando…</p>
  if (!project) return <p className="p-6">Projeto não encontrado.</p>
  const readOnly = project.archived_at !== null

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
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: project.color }} />
            <span className="truncate">{project.name}</span>
          </h1>
          {project.description && (
            <p className="text-sm" style={muted}>
              {project.description}
            </p>
          )}
          {readOnly && (
            <p className="mt-1 text-sm font-medium" style={{ color: '#a15c00' }}>
              Projeto arquivado — só leitura.
            </p>
          )}
        </div>
        {me?.is_coordenador && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Editar</Button>
            <Button onClick={toggleArchive}>{project.archived_at ? 'Desarquivar' : 'Arquivar'}</Button>
            {me.can_delete_projects && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Excluir
              </Button>
            )}
          </div>
        )}
      </div>
      <ErrorBox message={error} />

      <nav className="mb-4 flex flex-wrap gap-1 border-b pb-2" style={{ borderColor: 'var(--color-border)' }} aria-label="Abas do projeto">
        {PROJECT_TABS.map((tab) => {
          const to = `/projects/${project.id}/${tab.to}`
          const active = location.pathname.startsWith(to)
          return (
            <Link
              key={tab.to}
              to={to}
              className="rounded-md px-3 py-2 text-sm md:py-1.5"
              style={{
                background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                color: active ? 'var(--color-primary-contrast)' : 'var(--color-text)',
              }}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      <Outlet context={{ project, readOnly } satisfies ProjectCtx} />

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
