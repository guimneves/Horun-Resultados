import { useMemo, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Mode, SampleRow } from '../api/types'
import { BulkCreate } from '../components/BulkCreate'
import { Button, card, Empty, ErrorBox, Field, inputClass, inputStyle, Modal, muted, ValidityBadge } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmtMeanSd, fmtTemp } from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'
import { SampleDetailModal } from './SampleDetail'

export const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'padrao', label: 'Válidas e pendentes (sem as inválidas)' },
  { value: 'validas', label: 'Só as validadas' },
  { value: 'todas', label: 'Todas (inclui inválidas)' },
]

function NewSample({ projectId, onClose, onDone }: { projectId: number; onClose: () => void; onDone: () => void }) {
  const { fractions } = useApp()
  const [code, setCode] = useState('')
  const [fraction, setFraction] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Nova amostra" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Código" hint="Ex.: HP320H, HP355NBE, RO-1. Fração e temperatura são sugeridas pelo código se você deixar em branco.">
          <input className={inputClass} style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </Field>
        <Field label="Fração">
          <select className={inputClass} style={inputStyle} value={fraction} onChange={(e) => setFraction(e.target.value)}>
            <option value="">(sugerir pelo código)</option>
            {fractions.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label} ({f.code})
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!code.trim()}
            onClick={async () => {
              try {
                await api.post(`/projects/${projectId}/samples`, { code, fraction: fraction || null })
                onDone()
              } catch (err) {
                setError(errorText(err))
              }
            }}
          >
            Criar amostra
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function SamplesTab() {
  const { project, readOnly } = useProject()
  const { catalog, fractions, fractionLabel, paramLabel, techniqueLabel } = useApp()
  const mobile = useIsMobile()
  const [mode, setMode] = useState<Mode>('padrao')
  const { samples, error, reload } = useSamples(project.id, mode)
  const [search, setSearch] = useState('')
  const [fraction, setFraction] = useState('')
  const [technique, setTechnique] = useState('')
  const [validity, setValidity] = useState('')
  const [showOthers, setShowOthers] = useState(false)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const otherFractions = useMemo(() => new Set(fractions.filter((f) => !f.in_series).map((f) => f.code)), [fractions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (samples ?? []).filter((s) => {
      if (q && !`${s.code} ${s.experiment_code ?? ''}`.toLowerCase().includes(q)) return false
      if (fraction && s.fraction !== fraction) return false
      if (technique && !s.techniques?.includes(technique)) return false
      if (validity && String(s.valid) !== validity) return false
      if (!showOthers && !fraction && otherFractions.has(s.fraction)) return false
      return true
    })
  }, [samples, search, fraction, technique, validity, showOthers, otherFractions])

  // colunas: as principais de cada técnica que aparece nos dados
  const available = useMemo(() => {
    const present = new Set(filtered.flatMap((s) => Object.keys(s.values)))
    return catalog.flatMap((t) => t.params.map((p) => ({ col: `${t.key}.${p.key}`, main: p.main, tech: t.key }))).filter((c) => present.has(c.col))
  }, [catalog, filtered])
  const columns = chosen ?? available.filter((c) => c.main).map((c) => c.col)

  async function exportAs(format: 'csv' | 'xlsx') {
    setExportError(null)
    try {
      await api.download(`/projects/${project.id}/export`, `resultados.${format}`, {
        format,
        mode,
        sample_ids: filtered.map((s) => s.id),
        columns,
      })
    } catch (err) {
      setExportError(errorText(err))
    }
  }

  const header = (col: string) => `${techniqueLabel(col.split('.')[0])} ${paramLabel(col)}`

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className={inputClass} style={inputStyle} placeholder="Buscar código ou experimento" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        <select className={inputClass} style={inputStyle} value={fraction} onChange={(e) => setFraction(e.target.value)} aria-label="Fração">
          <option value="">Todas as frações</option>
          {fractions.map((f) => (
            <option key={f.code} value={f.code}>
              {f.label}
            </option>
          ))}
        </select>
        <select className={inputClass} style={inputStyle} value={technique} onChange={(e) => setTechnique(e.target.value)} aria-label="Técnica">
          <option value="">Todas as técnicas</option>
          {catalog.map((t) => (
            <option key={t.key} value={t.key}>
              Com {t.label}
            </option>
          ))}
        </select>
        <select className={inputClass} style={inputStyle} value={validity} onChange={(e) => setValidity(e.target.value)} aria-label="Validade">
          <option value="">Válidas, pendentes e inválidas</option>
          <option value="true">Só válidas</option>
          <option value="null">Só pendentes</option>
          <option value="false">Só inválidas</option>
        </select>
        <select className={inputClass} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Medições nas médias">
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              Médias: {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2" style={muted}>
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            Mostrar padrões e outras
          </label>
          <details className="relative">
            <summary className="cursor-pointer rounded-md border px-3 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
              Colunas ({columns.length})
            </summary>
            <div className="fixed inset-x-4 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border p-2 shadow-lg md:absolute md:inset-x-auto md:left-0 md:w-72" style={card}>
              {available.length === 0 && <p style={muted}>Sem valores ainda.</p>}
              {available.map((c) => (
                <label key={c.col} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={columns.includes(c.col)}
                    onChange={(e) => setChosen(e.target.checked ? [...columns, c.col] : columns.filter((x) => x !== c.col))}
                  />
                  {header(c.col)}
                </label>
              ))}
            </div>
          </details>
          <span style={muted}>{filtered.length} amostra(s)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportAs('csv')} disabled={!filtered.length}>
            Exportar CSV
          </Button>
          <Button onClick={() => exportAs('xlsx')} disabled={!filtered.length}>
            Exportar XLSX
          </Button>
          {!readOnly && <Button onClick={() => setBulk(true)}>Criar várias</Button>}
          {!readOnly && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Nova amostra
            </Button>
          )}
        </div>
      </div>
      <ErrorBox message={error ?? exportError} />

      {samples === null ? (
        <p style={muted}>Carregando…</p>
      ) : filtered.length === 0 ? (
        <Empty>{samples.length ? 'Nenhuma amostra com esses filtros.' : 'Nenhuma amostra ainda. Comece pela aba Importar.'}</Empty>
      ) : mobile ? (
        <div className="space-y-2" data-testid="samples-cards">
          {filtered.map((s) => (
            <SampleCard key={s.id} s={s} columns={columns} header={header} fractionLabel={fractionLabel} onOpen={() => setOpenId(s.id)} />
          ))}
        </div>
      ) : (
        <div className="table-wrap rounded-lg border" style={card} data-testid="samples-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={muted}>
                <th className="px-3 py-2 font-medium">Amostra</th>
                <th className="px-3 py-2 font-medium">Fração</th>
                <th className="px-3 py-2 font-medium">Temp.</th>
                <th className="px-3 py-2 font-medium">Experimento</th>
                <th className="px-3 py-2 font-medium">Validade</th>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {header(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="cursor-pointer border-t hover:bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)' }} onClick={() => setOpenId(s.id)}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{s.code}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fractionLabel(s.fraction)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTemp(s.temperature_c)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{s.experiment_code ?? '—'}</td>
                  <td className="px-3 py-2">
                    <ValidityBadge valid={s.valid} />
                  </td>
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {fmtMeanSd(s.values[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId !== null && <SampleDetailModal projectId={project.id} sampleId={openId} readOnly={readOnly} onClose={() => setOpenId(null)} onChanged={reload} />}
      {bulk && (
        <BulkCreate
          title="Criar várias amostras"
          path={`/projects/${project.id}/samples/bulk`}
          hint="Cole os códigos, um por linha (ex.: HP300H, HP300E, HP355NBE). Fração, temperatura e experimento são lidos do código; HP320E.1 e HP320E.2 viram a mesma amostra HP320E."
          onClose={() => setBulk(false)}
          onDone={() => {
            setBulk(false)
            reload()
          }}
        />
      )}
      {creating && (
        <NewSample
          projectId={project.id}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            reload()
          }}
        />
      )}
    </div>
  )
}

function SampleCard({
  s,
  columns,
  header,
  fractionLabel,
  onOpen,
}: {
  s: SampleRow
  columns: string[]
  header: (c: string) => string
  fractionLabel: (c: string) => string
  onOpen: () => void
}) {
  const shown = columns.filter((c) => s.values[c])
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-lg border p-3 text-left" style={card}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{s.code}</span>
        <ValidityBadge valid={s.valid} />
      </div>
      <div className="text-xs" style={muted}>
        {fractionLabel(s.fraction)} · {fmtTemp(s.temperature_c)}
        {s.experiment_code ? ` · ${s.experiment_code}` : ''}
      </div>
      {shown.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {shown.map((c) => (
            <div key={c} className="min-w-0">
              <dt className="truncate" style={muted}>
                {header(c)}
              </dt>
              <dd className="tabular-nums">{fmtMeanSd(s.values[c])}</dd>
            </div>
          ))}
        </dl>
      )}
    </button>
  )
}
