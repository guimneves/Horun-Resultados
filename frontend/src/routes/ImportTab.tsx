import { useMemo, useState } from 'react'
import { api, errorText } from '../api/client'
import type { ImportResult, Preview, PreviewRow, RowAction, SampleRow } from '../api/types'
import { SampleCombo } from '../components/SampleCombo'
import { Button, card, Empty, ErrorBox, inputClass, inputStyle, muted } from '../components/ui'
import { useApp } from '../context/AppContext'
import { fmt } from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import { useSamples } from '../lib/useSamples'
import { useProject } from './ProjectLayout'

const ANALYSIS_TYPES: { key: string; label: string; files: string }[] = [
  { key: 'chnso', label: 'CHNSO', files: 'PDF "Results Summary for Element %" (ou os "Single Sample Result")' },
  { key: 'leco', label: 'LECO', files: 'CSV exportado do Cornerstone' },
  { key: 'leco_ri', label: 'LECO - Resíduo Insolúvel', files: 'planilha de massas das amostras (cadinho, amostra e massa após o tratamento, réplicas 1–3)' },
  { key: 'rockeval', label: 'Rock-Eval', files: 'relatório .htm (Job report do GeoWorks)' },
  { key: 'gc_fid', label: 'GC-FID (gás)', files: 'planilha "Dados FID" de cada experimento' },
  { key: 'gc_tcd', label: 'GC-TCD (gás)', files: 'planilha "Dados TCD" de cada experimento' },
  { key: 'gas_balanco', label: 'Balanço de gás', files: '"Planilha cálculo gás" de cada experimento' },
  { key: 'pygcms', label: 'Py-GC-MS', files: 'planilha com uma aba por amostra' },
  { key: '', label: 'Vários / não sei (detectar)', files: 'qualquer um dos acima, ou um .zip com pastas' },
]

const STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: 'lido', color: '#1b6b34' },
  ignorado: { label: 'ignorado', color: '#8a6d00' },
  erro: { label: 'erro', color: '#a12020' },
  duplicado: { label: 'já importado', color: '#4b5573' },
}

interface Decision {
  action: RowAction
  sample_id: number | null
  code: string
  fraction: string
  temperature_c: string
  experiment_code: string
}

const fromRow = (r: PreviewRow): Decision => ({
  action: r.action,
  sample_id: r.sample_id,
  code: r.suggested.code,
  fraction: r.suggested.fraction,
  temperature_c: r.suggested.temperature_c?.toString() ?? '',
  experiment_code: r.suggested.experiment_code ?? '',
})

const SOURCE_LABEL: Record<string, string> = {
  lembrado: 'nome lembrado',
  'mesmo código': 'mesmo código',
  código: 'código lido do nome',
  nova: 'criar nova',
  padrão: 'padrão',
  branco: 'branco',
}

function RowEditor({ row, d, samples, onChange }: { row: PreviewRow; d: Decision; samples: SampleRow[]; onChange: (patch: Partial<Decision>) => void }) {
  const { fractions } = useApp()
  return (
    <div className="space-y-2">
      <select
        className={inputClass}
        style={inputStyle}
        value={d.action}
        onChange={(e) => onChange({ action: e.target.value as RowAction })}
        aria-label={`O que fazer com ${row.name}`}
      >
        <option value="link">Atribuir a amostra existente</option>
        <option value="create">Criar nova amostra</option>
        <option value="skip">Ignorar</option>
      </select>
      {d.action === 'link' && <SampleCombo samples={samples} value={d.sample_id} onChange={(id) => onChange({ sample_id: id })} />}
      {d.action === 'create' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            style={inputStyle}
            value={d.code}
            onChange={(e) => onChange({ code: e.target.value })}
            aria-label="Código da nova amostra"
          />
          <select className={inputClass} style={inputStyle} value={d.fraction} onChange={(e) => onChange({ fraction: e.target.value })} aria-label="Fração">
            {fractions.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            style={inputStyle}
            inputMode="decimal"
            placeholder="Temperatura (°C)"
            value={d.temperature_c}
            onChange={(e) => onChange({ temperature_c: e.target.value })}
            aria-label="Temperatura"
          />
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="Experimento (ex.: HP300NA)"
            value={d.experiment_code}
            onChange={(e) => onChange({ experiment_code: e.target.value })}
            aria-label="Experimento"
          />
        </div>
      )}
    </div>
  )
}

export function ImportTab() {
  const { project, readOnly, canEdit } = useProject()
  const { techniqueLabel, paramLabel, reloadProjects } = useApp()
  const mobile = useIsMobile()
  const { samples: existing, reload } = useSamples(project.id)
  const [technique, setTechnique] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [bulkSample, setBulkSample] = useState<number | null>(null)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const samples = useMemo(() => [...(existing ?? [])].sort((a, b) => a.code.localeCompare(b.code)), [existing])

  if (readOnly) return <Empty>Projeto arquivado — não recebe importações.</Empty>
  if (!canEdit) return <Empty>Seu cargo permite ver os resultados, mas não importar. Peça a um(a) pesquisador(a) ou coordenador(a).</Empty>

  async function send() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      files.forEach((f) => form.append('files', f, f.name))
      form.append('technique', technique ?? '')
      const pv = await api.postForm<Preview>(`/projects/${project.id}/imports/preview`, form)
      setPreview(pv)
      setDecisions(Object.fromEntries(pv.rows.map((r) => [r.row, fromRow(r)])))
      setSelected([])
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const body = {
        decisions: Object.entries(decisions).map(([row, d]) => ({
          row,
          action: d.action,
          sample_id: d.action === 'link' ? d.sample_id : null,
          code: d.code,
          fraction: d.fraction,
          temperature_c: d.temperature_c === '' ? null : Number(d.temperature_c.replace(',', '.')),
          experiment_code: d.experiment_code || null,
        })),
      }
      setResult(await api.post<ImportResult>(`/projects/${project.id}/imports/${preview.batch_id}/confirm`, body))
      setPreview(null)
      setFiles([])
      reload()
      reloadProjects()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const set = (row: string, patch: Partial<Decision>) => setDecisions((all) => ({ ...all, [row]: { ...all[row], ...patch } }))
  const setMany = (rows: string[], patch: Partial<Decision>) =>
    setDecisions((all) => ({ ...all, ...Object.fromEntries(rows.map((r) => [r, { ...all[r], ...patch }])) }))

  const rows = preview?.rows ?? []
  const main = rows.filter((r) => r.kind === 'sample')
  const others = rows.filter((r) => r.kind !== 'sample')
  const isUnassigned = (r: PreviewRow) => {
    const d = decisions[r.row]
    return !d || d.action === 'create' || (d.action === 'link' && !d.sample_id)
  }
  const shownMain = onlyUnassigned ? main.filter(isUnassigned) : main
  const counts = {
    assigned: rows.filter((r) => decisions[r.row]?.action === 'link' && decisions[r.row]?.sample_id).length,
    missing: rows.filter((r) => decisions[r.row]?.action === 'link' && !decisions[r.row]?.sample_id).length,
    create: rows.filter((r) => decisions[r.row]?.action === 'create').length,
    skip: rows.filter((r) => decisions[r.row]?.action === 'skip').length,
  }
  const toggle = (row: string) => setSelected((s) => (s.includes(row) ? s.filter((x) => x !== row) : [...s, row]))
  const valuesText = (r: PreviewRow) =>
    Object.entries(r.values)
      .map(([k, v]) => `${paramLabel(k, false)} ${fmt(v)}`)
      .join(' · ')

  const rowInfo = (r: PreviewRow) => (
    <>
      <div className="font-semibold">{r.name}</div>
      <div className="text-xs" style={muted}>
        {r.techniques.map(techniqueLabel).join(', ')} · {r.n_measurements} medição(ões)
        {r.replicates.length > 1 && ` · réplicas ${r.replicates.join(', ')}`}
        {r.aliquots.length > 0 && ` · alíquota ${r.aliquots.join(', ')}`}
      </div>
      {r.updates_existing && (
        <div className="text-xs" style={{ color: '#8a6d00' }}>
          atualiza medições já importadas
        </div>
      )}
      <div className="text-xs" style={muted}>
        sugestão: {SOURCE_LABEL[r.suggestion_source] ?? r.suggestion_source}
        {r.sample_code ? ` (${r.sample_code})` : ''}
      </div>
    </>
  )

  const rowList = (list: PreviewRow[], withCheck: boolean) =>
    mobile ? (
      <div className="space-y-2">
        {list.map((r) => (
          <div key={r.row} className="rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-start gap-2">
              {withCheck && (
                <input type="checkbox" className="mt-1" checked={selected.includes(r.row)} onChange={() => toggle(r.row)} aria-label={`Selecionar ${r.name}`} />
              )}
              <div className="min-w-0 flex-1">
                {rowInfo(r)}
                <div className="text-xs tabular-nums">{valuesText(r)}</div>
              </div>
            </div>
            <div className="mt-2">
              <RowEditor row={r} d={decisions[r.row]} samples={samples} onChange={(p) => set(r.row, p)} />
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="table-wrap">
        <table className="w-full text-sm" data-testid="import-rows">
          <thead>
            <tr className="text-left" style={muted}>
              {withCheck && (
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas"
                    checked={list.length > 0 && list.every((r) => selected.includes(r.row))}
                    onChange={(e) => setSelected(e.target.checked ? list.map((r) => r.row) : [])}
                  />
                </th>
              )}
              <th className="px-2 py-2 font-medium">Nome no arquivo</th>
              <th className="px-2 py-2 font-medium">Valores (média)</th>
              <th className="w-[22rem] px-2 py-2 font-medium">Atribuir a</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.row} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                {withCheck && (
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={selected.includes(r.row)} onChange={() => toggle(r.row)} aria-label={`Selecionar ${r.name}`} />
                  </td>
                )}
                <td className="px-2 py-2">{rowInfo(r)}</td>
                <td className="px-2 py-2 text-xs tabular-nums">{valuesText(r) || '—'}</td>
                <td className="px-2 py-2">
                  <RowEditor row={r} d={decisions[r.row]} samples={samples} onChange={(p) => set(r.row, p)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-3 md:p-4" style={card}>
        <h2 className="mb-2 font-semibold">1. Qual análise você vai importar?</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {ANALYSIS_TYPES.map((t) => (
            <button
              key={t.key || 'auto'}
              type="button"
              onClick={() => setTechnique(t.key)}
              className="rounded-md border px-3 py-2 text-left text-sm"
              style={{
                borderColor: technique === t.key ? 'var(--color-primary)' : 'var(--color-border)',
                background: technique === t.key ? 'var(--color-primary)' : 'transparent',
                color: technique === t.key ? 'var(--color-primary-contrast)' : 'var(--color-text)',
              }}
              aria-pressed={technique === t.key}
            >
              {t.label}
            </button>
          ))}
        </div>
        {technique !== null && (
          <>
            <h2 className="mb-1 mt-4 font-semibold">2. Escolha o(s) arquivo(s)</h2>
            <p className="mb-2 text-sm" style={muted}>
              Esperado: {ANALYSIS_TYPES.find((t) => t.key === technique)?.files}. Pode enviar vários de uma vez ou um .zip.
            </p>
            <input
              type="file"
              multiple
              accept=".pdf,.csv,.htm,.html,.xlsx,.zip"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm"
              aria-label="Arquivos para importar"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={!files.length || busy} onClick={send}>
                {busy && !preview ? 'Lendo…' : 'Ler arquivos'}
              </Button>
              {files.length > 0 && (
                <span className="text-sm" style={muted}>
                  {files.length} arquivo(s)
                </span>
              )}
            </div>
          </>
        )}
      </section>

      <ErrorBox message={error} />

      {result && (
        <section className="rounded-lg border p-3 md:p-4" style={{ ...card, borderColor: '#9fd3ae' }} data-testid="import-result">
          <h2 className="mb-1 font-semibold">Importação concluída</h2>
          <p className="text-sm">
            {result.files_imported} arquivo(s) · {result.analyses_created} medição(ões) nova(s) · {result.analyses_updated} atualizada(s) ·{' '}
            {result.samples_created} amostra(s) criada(s) · {result.skipped} ignorada(s)
            {result.aliases_saved ? ` · ${result.aliases_saved} nome(s) lembrado(s) para a próxima vez` : ''}.
          </p>
          {Object.keys(result.linked).length > 0 && (
            <ul className="mt-2 text-xs">
              {Object.entries(result.linked).map(([code, names]) => (
                <li key={code}>
                  <strong>{code}</strong> ← {names.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {preview && (
        <>
          <section className="rounded-lg border p-3 md:p-4" style={card}>
            <h2 className="mb-1 font-semibold">3. Arquivos lidos</h2>
            <p className="mb-2 text-sm" style={muted}>
              {preview.counts.ok} lido(s) · {preview.counts.ignored} ignorado(s) · {preview.counts.errors} com erro · {preview.counts.duplicates} já
              importado(s)
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {preview.files
                .filter((f) => f.status !== 'ok' || f.warnings.length)
                .map((f, i) => (
                  <li key={`${f.filename}-${i}`} className="border-t py-1" style={{ borderColor: 'var(--color-border)' }}>
                    <span
                      className="mr-2 rounded px-1.5 py-0.5 text-xs font-medium"
                      style={{ color: STATUS[f.status].color, background: 'var(--color-surface)' }}
                    >
                      {STATUS[f.status].label}
                    </span>
                    <span className="break-all">{f.filename}</span>
                    {f.message && (
                      <div className="text-xs" style={muted}>
                        {f.message}
                      </div>
                    )}
                    {f.already_in_samples.length > 0 && (
                      <div className="text-xs" style={muted}>
                        Já está nas amostras: {f.already_in_samples.join(', ')}
                      </div>
                    )}
                    {f.warnings.map((w, j) => (
                      <div key={j} className="text-xs" style={{ color: '#8a6d00' }}>
                        ⚠ {w}
                      </div>
                    ))}
                  </li>
                ))}
              {preview.files.every((f) => f.status === 'ok' && !f.warnings.length) && <li style={muted}>Todos os arquivos lidos sem avisos.</li>}
            </ul>
          </section>

          <section className="rounded-lg border p-3 md:p-4" style={card}>
            <h2 className="mb-1 font-semibold">4. Atribua os resultados às amostras</h2>
            <p className="mb-2 text-sm" style={muted}>
              Uma linha por nome escrito no arquivo (as réplicas -1, -2... já vêm juntas). Atribua cada linha a uma amostra do projeto, crie uma nova ou ignore.
              O que você atribuir fica lembrado para a próxima importação.
            </p>
            <p className="mb-2 text-sm" data-testid="import-counts">
              <strong>{counts.assigned}</strong> atribuída(s) · <strong>{counts.create}</strong> a criar · <strong>{counts.skip}</strong> ignorada(s)
              {counts.missing > 0 && (
                <span style={{ color: '#a12020' }}>
                  {' '}
                  · <strong>{counts.missing}</strong> sem amostra escolhida
                </span>
              )}
            </p>

            {main.length > 0 && (
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md p-2" style={{ background: 'var(--color-surface)' }}>
                <span className="text-sm font-medium">{selected.length} selecionada(s):</span>
                <div className="w-full sm:w-56">
                  <SampleCombo samples={samples} value={bulkSample} onChange={setBulkSample} label="Amostra para as selecionadas" />
                </div>
                <Button disabled={!selected.length || !bulkSample} onClick={() => setMany(selected, { action: 'link', sample_id: bulkSample })}>
                  Atribuir selecionadas
                </Button>
                <Button disabled={!selected.length} onClick={() => setMany(selected, { action: 'skip' })}>
                  Ignorar selecionadas
                </Button>
                <Button onClick={() => setDecisions(Object.fromEntries(rows.map((r) => [r.row, fromRow(r)])))}>Aplicar sugestões a todos</Button>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
                  Só linhas sem atribuição
                </label>
              </div>
            )}

            {rows.length === 0 ? (
              <Empty>Nenhuma medição nova nestes arquivos.</Empty>
            ) : shownMain.length === 0 && main.length > 0 ? (
              <Empty>Todas as linhas já estão atribuídas.</Empty>
            ) : (
              rowList(shownMain, true)
            )}

            {others.length > 0 && (
              <details className="mt-3 rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
                <summary className="cursor-pointer text-sm font-medium">Padrões e brancos ({others.length}) — ignorados, a não ser que você mude</summary>
                <div className="mt-2">{rowList(others, false)}</div>
              </details>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || preview.counts.ok === 0 || counts.missing > 0} onClick={confirm}>
                {busy ? 'Gravando…' : 'Confirmar importação'}
              </Button>
              <Button onClick={() => setPreview(null)}>Cancelar</Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
