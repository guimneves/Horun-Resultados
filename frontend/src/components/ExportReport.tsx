import { useMemo, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Mode, Project } from '../api/types'
import { useApp } from '../context/AppContext'
import { useSamples } from '../lib/useSamples'
import { MODE_OPTIONS } from '../routes/SamplesTab'
import { Button, ErrorBox, Field, inputClass, inputStyle, Modal, muted, Segmented } from './ui'

// Botão "Exportar" (ao lado de "Importar resultados"): relatório em Excel com
// a aba "Resumo geral" primeiro e uma aba por técnica com todas as réplicas
// (backend: app/services/report.py). A pessoa escolhe técnicas, amostras e
// quais resultados entram (válidas/pendentes/todas).

export function ExportReportModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { catalog, fractionLabel } = useApp()
  const [mode, setMode] = useState<Mode>('padrao')
  const { samples, error: loadError } = useSamples(project.id, mode)
  const [techs, setTechs] = useState<Set<string> | null>(null) // null = todas as do projeto
  const [pickSamples, setPickSamples] = useState(false)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // técnicas que o projeto tem, na ordem do catálogo, com quantas amostras cada
  const available = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of samples ?? []) for (const t of s.techniques ?? []) count.set(t, (count.get(t) ?? 0) + 1)
    return catalog.filter((t) => count.has(t.key)).map((t) => ({ key: t.key, label: t.label, n: count.get(t.key) ?? 0 }))
  }, [samples, catalog])
  const selectedTechs = techs ?? new Set(available.map((t) => t.key))

  const candidates = useMemo(
    () => (samples ?? []).filter((s) => (s.techniques ?? []).some((t) => selectedTechs.has(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples, techs, available],
  )
  const visible = candidates.filter((s) => !search.trim() || s.code.toLowerCase().includes(search.trim().toLowerCase()))
  const nSamples = pickSamples ? candidates.filter((s) => chosen.has(s.id)).length : candidates.length

  function toggleTech(key: string) {
    const next = new Set(selectedTechs)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setTechs(next)
  }

  function toggleSample(id: number) {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function download() {
    setBusy(true)
    setError(null)
    try {
      await api.download(`/projects/${project.id}/export/report`, 'relatorio.xlsx', {
        techniques: [...selectedTechs],
        sample_ids: pickSamples ? candidates.filter((s) => chosen.has(s.id)).map((s) => s.id) : [],
        mode,
      })
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Exportar relatório (Excel)" onClose={onClose} wide>
      <p className="mb-4 text-sm" style={muted}>
        A primeira aba, <strong>Resumo geral</strong>, traz o projeto, um quadro por técnica e a média ± desvio dos parâmetros
        principais de cada amostra. Depois vem uma aba por técnica, com as médias de todos os parâmetros e{' '}
        <strong>todas as réplicas</strong> (arquivo, data e validade de cada medição).
      </p>

      <Field label="Resultados que entram">
        <Segmented value={mode} options={MODE_OPTIONS} onChange={setMode} label="Validade" />
      </Field>

      <Field label="Técnicas">
        {samples === null ? (
          <p className="text-sm" style={muted}>
            Carregando…
          </p>
        ) : available.length === 0 ? (
          <p className="text-sm" style={muted}>
            Nenhum resultado importado ainda.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {available.map((t) => (
              <label key={t.key} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedTechs.has(t.key)} onChange={() => toggleTech(t.key)} />
                {t.label}
                <span className="text-xs" style={muted}>
                  {t.n} amostra{t.n === 1 ? '' : 's'}
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>

      <Field label="Amostras">
        <div className="mb-2 flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-9 items-center gap-2">
            <input type="radio" checked={!pickSamples} onChange={() => setPickSamples(false)} />
            Todas com essas técnicas ({candidates.length})
          </label>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="radio"
              checked={pickSamples}
              onChange={() => {
                setPickSamples(true)
                if (chosen.size === 0) setChosen(new Set(candidates.map((s) => s.id)))
              }}
            />
            Escolher
          </label>
        </div>
        {pickSamples && (
          <div className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                className={`${inputClass} max-w-xs`}
                style={inputStyle}
                placeholder="Buscar amostra…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button onClick={() => setChosen(new Set([...chosen, ...visible.map((s) => s.id)]))}>Marcar visíveis</Button>
              <Button onClick={() => setChosen(new Set([...chosen].filter((id) => !visible.some((s) => s.id === id))))}>
                Desmarcar visíveis
              </Button>
            </div>
            <div className="grid max-h-60 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
              {visible.map((s) => (
                <label key={s.id} className="flex min-h-8 items-center gap-2 text-sm">
                  <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggleSample(s.id)} />
                  <span className="truncate">{s.code}</span>
                  <span className="truncate text-xs" style={muted}>
                    {fractionLabel(s.fraction)}
                    {s.temperature_c != null ? ` · ${s.temperature_c} °C` : ''}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Field>

      <ErrorBox message={error ?? loadError} />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm" style={muted}>
          {selectedTechs.size} técnica{selectedTechs.size === 1 ? '' : 's'} · {nSamples} amostra{nSamples === 1 ? '' : 's'}
        </span>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={busy || selectedTechs.size === 0 || nSamples === 0} onClick={download}>
          {busy ? 'Gerando…' : 'Baixar Excel'}
        </Button>
      </div>
    </Modal>
  )
}
