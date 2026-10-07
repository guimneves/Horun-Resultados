import { useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { HistoryEvent, StoredFileOut } from '../api/types'
import { card, Empty, ErrorBox, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmtDateTime } from '../lib/format'
import { useProject } from './ProjectLayout'

/** Histórico do projeto (quem fez o quê, quando) e arquivos originais importados. */
export function HistoryTab() {
  const { project } = useProject()
  const { techniqueLabel } = useApp()
  const [events, setEvents] = useState<HistoryEvent[] | null>(null)
  const [files, setFiles] = useState<StoredFileOut[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<HistoryEvent[]>(`/projects/${project.id}/history`).then(setEvents).catch((err) => setError(errorText(err)))
    api.get<StoredFileOut[]>(`/projects/${project.id}/files`).then(setFiles).catch(() => setFiles([]))
  }, [project.id])

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="min-w-0 rounded-lg border p-3 md:p-4" style={card}>
        <h2 className="mb-2 font-semibold">Histórico</h2>
        <ErrorBox message={error} />
        {events === null ? (
          <p style={muted}>Carregando…</p>
        ) : events.length === 0 ? (
          <Empty>Nada registrado ainda.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
                <div>{e.summary}</div>
                <div className="text-xs" style={muted}>
                  {e.username} · {fmtDateTime(e.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="min-w-0 rounded-lg border p-3 md:p-4" style={card}>
        <h2 className="mb-2 font-semibold">Arquivos importados</h2>
        {files.length === 0 ? (
          <Empty>Nenhum arquivo importado.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {files.map((f) => (
              <li key={f.id} className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  type="button"
                  className="break-all text-left underline"
                  style={{ color: 'var(--color-primary)' }}
                  onClick={() => api.download(`/projects/${project.id}/files/${f.id}/download`, f.filename)}
                >
                  {f.filename}
                </button>
                <div className="text-xs" style={muted}>
                  {f.technique ? techniqueLabel(f.technique) : ''} · {f.imported_by} · {fmtDateTime(f.imported_at)}
                  {f.path_hint ? ` · ${f.path_hint}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
