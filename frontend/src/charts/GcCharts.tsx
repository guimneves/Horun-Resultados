import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { AnalysisData, GcData, GcPeak, Mode, SampleRow } from '../api/types'
import { Button, inputClass, inputStyle, muted, Segmented } from '../components/ui'
import { curveLooks } from '../lib/colors'
import { fmt } from '../lib/format'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from './ChartCard'

// GC-FID (.gcd) e GC-MS (.qgd) da Shimadzu nos projetos de tabaco (21/10/2026):
// cromatogramas sobrepostos (um detector de cada vez — nada de eixo duplo) e a
// tabela de picos/compostos de cada medição. No FID, o nome vem do pico do
// GC-MS da mesma amostra com o tempo de retenção mais próximo (até 0,05 min),
// quando houver — os dois detectores rodam juntos, com o fluxo dividido.

export type GcTech = 'gcfid_tab' | 'gcms_tab'
const LABEL: Record<GcTech, string> = { gcfid_tab: 'GC-FID', gcms_tab: 'GC-MS (TIC)' }
const MATCH_MIN = 0.05

export function hasGc(s: SampleRow, tech?: GcTech): boolean {
  const t = s.techniques ?? []
  return tech ? t.includes(tech) : t.includes('gcfid_tab') || t.includes('gcms_tab')
}

export function GcChromatogramChart({ curves, tech, normalize }: { curves: AnalysisData<GcData>[]; tech: GcTech; normalize: boolean }) {
  const lines = curves
    .filter((c) => c.data?.curve?.t?.length)
    .map((c) => {
      const ys = c.data.curve.y
      const top = normalize ? Math.max(...ys) || 1 : 1
      return {
        id: c.analysis_id,
        name: c.replicate != null ? `${c.sample_code} · réplica ${c.replicate}` : c.sample_code,
        points: c.data.curve.t.map((x, i) => ({ x, y: normalize ? (100 * ys[i]) / top : ys[i] })),
        peaks: c.data.peaks?.length ?? 0,
      }
    })
  const looks = curveLooks(curves.filter((c) => lines.some((l) => l.id === c.analysis_id)))
  return (
    <ChartCard
      title={`${LABEL[tech]} — cromatogramas`}
      sources={[tech]}
      subtitle={normalize ? 'Sinal em % do maior pico de cada corrida' : tech === 'gcms_tab' ? 'Corrente iônica total (TIC)' : 'Sinal do detector'}
      empty={lines.length ? null : 'Sem cromatogramas.'}
      filename={tech === 'gcms_tab' ? 'gcms_tic' : 'gcfid_cromatogramas'}
      table={<SimpleTable head={['Medição', 'Pontos no gráfico', 'Picos']} rows={lines.map((l) => [l.name, l.points.length, l.peaks])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            allowDuplicatedCategory={false}
            {...axisProps}
            height={36}
            tickFormatter={(v: number) => fmt(v)}
            label={{ value: 'Tempo de retenção (min)', position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }}
          />
          <YAxis {...axisProps} width={64} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} labelFormatter={(v) => `${fmt(Number(v))} min`} formatter={(v) => fmt(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l) => (
            <Line
              key={l.id}
              name={l.name}
              data={l.points}
              dataKey="y"
              stroke={looks.get(l.id)?.color}
              strokeDasharray={looks.get(l.id)?.dash}
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function nearest(ms: GcPeak[], rt: number): GcPeak | undefined {
  let best: GcPeak | undefined
  for (const p of ms) if (p.identified && Math.abs(p.rt_min - rt) <= MATCH_MIN && (!best || Math.abs(p.rt_min - rt) < Math.abs(best.rt_min - rt))) best = p
  return best
}

/** Tabela de picos de UMA medição (GC-MS: compostos; GC-FID: picos integrados). */
export function GcPeaksTable({ curve, tech, msPeaks = [] }: { curve: AnalysisData<GcData>; tech: GcTech; msPeaks?: GcPeak[] }) {
  const [onlyIdentified, setOnlyIdentified] = useState(tech === 'gcms_tab')
  const [order, setOrder] = useState<'area' | 'rt'>('area')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(50)
  const peaks = useMemo(() => {
    let ps = (curve.data.peaks ?? []).map((p) => ({ ...p, ms: tech === 'gcfid_tab' ? nearest(msPeaks, p.rt_min) : undefined }))
    if (tech === 'gcms_tab' && onlyIdentified) ps = ps.filter((p) => p.identified)
    const term = q.trim().toLowerCase()
    if (term) ps = ps.filter((p) => (p.name ?? p.ms?.name ?? '').toLowerCase().includes(term))
    return [...ps].sort((a, b) => (order === 'area' ? b.area - a.area : a.rt_min - b.rt_min))
  }, [curve, tech, msPeaks, onlyIdentified, order, q])
  const total = curve.data.peaks?.length ?? 0
  return (
    <div className="rounded-md border p-3 text-xs" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {LABEL[tech]} · {curve.source_name || curve.sample_code} — {total} pico(s)
          {tech === 'gcms_tab' && ` · ${(curve.data.peaks ?? []).filter((p) => p.identified).length} identificado(s) (similaridade ≥ ${curve.data.min_similarity ?? 80})`}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <input className={`${inputClass} w-40`} style={inputStyle} placeholder="buscar composto…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar composto" />
          {tech === 'gcms_tab' && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={onlyIdentified} onChange={(e) => setOnlyIdentified(e.target.checked)} />
              só identificados
            </label>
          )}
          <Segmented
            label="Ordem"
            value={order}
            onChange={setOrder}
            options={[
              { value: 'area', label: 'maior área' },
              { value: 'rt', label: 'tempo' },
            ]}
          />
        </span>
      </div>
      <div className="table-wrap max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead style={muted}>
            <tr>
              <th className="px-2 py-1 text-right font-medium">TR (min)</th>
              <th className="px-2 py-1 text-left font-medium">{tech === 'gcms_tab' ? 'Composto (biblioteca)' : 'Composto (pelo GC-MS, mesmo TR)'}</th>
              {tech === 'gcms_tab' && <th className="px-2 py-1 text-right font-medium">Similaridade</th>}
              <th className="px-2 py-1 text-right font-medium">Área</th>
              <th className="px-2 py-1 text-right font-medium">% área</th>
            </tr>
          </thead>
          <tbody>
            {peaks.slice(0, limit).map((p, i) => (
              <tr key={`${p.rt_min}-${i}`} className="border-t" style={{ borderColor: 'var(--color-border)', opacity: tech === 'gcms_tab' && !p.identified ? 0.55 : 1 }}>
                <td className="px-2 py-1 text-right tabular-nums">{p.rt_min.toFixed(3)}</td>
                <td className="px-2 py-1">
                  {tech === 'gcms_tab' ? p.name || '—' : p.ms ? <span title={`GC-MS a ${p.ms.rt_min.toFixed(3)} min, similaridade ${p.ms.similarity}`}>{p.ms.name}</span> : <span style={muted}>—</span>}
                  {p.target && <span className="ml-1 rounded px-1 text-[10px] font-semibold" style={{ background: 'var(--color-surface)' }}>alvo</span>}
                </td>
                {tech === 'gcms_tab' && <td className="px-2 py-1 text-right tabular-nums">{p.similarity ?? '—'}</td>}
                <td className="px-2 py-1 text-right tabular-nums">{fmt(p.area)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{p.area_pct != null ? p.area_pct.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {peaks.length > limit && (
        <div className="mt-1">
          <Button variant="ghost" onClick={() => setLimit(limit + 100)}>
            mostrar mais ({peaks.length - limit} restantes)
          </Button>
        </div>
      )}
    </div>
  )
}

/** Cromatogramas + tabelas de picos das amostras escolhidas (detalhe, Comparar, Séries). */
export function GcSection({ projectId, mode, ids, showTables = true }: { projectId: number; mode: Mode; ids: number[]; showTables?: boolean }) {
  const [fid, setFid] = useState<AnalysisData<GcData>[]>([])
  const [ms, setMs] = useState<AnalysisData<GcData>[]>([])
  const [tech, setTech] = useState<GcTech>('gcms_tab')
  const [normalize, setNormalize] = useState(false)
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    const get = (t: GcTech) => api.get<AnalysisData<GcData>[]>(`/projects/${projectId}/analysis-data?technique=${t}&mode=${mode}&sample_ids=${key}`).catch(() => [])
    Promise.all([get('gcfid_tab'), get('gcms_tab')]).then(([f, m]) => {
      setFid(f)
      setMs(m)
      if (!m.length && f.length) setTech('gcfid_tab')
    })
  }, [projectId, mode, key])
  if (!fid.length && !ms.length) return null
  const curves = tech === 'gcms_tab' ? ms : fid
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Detector"
          value={tech}
          onChange={setTech}
          options={[
            ...(ms.length ? [{ value: 'gcms_tab' as GcTech, label: 'GC-MS (TIC)' }] : []),
            ...(fid.length ? [{ value: 'gcfid_tab' as GcTech, label: 'GC-FID' }] : []),
          ]}
        />
        {curves.length > 1 && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
            normalizar pelo maior pico
          </label>
        )}
      </div>
      <GcChromatogramChart curves={curves} tech={tech} normalize={normalize} />
      {showTables &&
        curves.map((c) => (
          <GcPeaksTable
            key={c.analysis_id}
            curve={c}
            tech={tech}
            msPeaks={tech === 'gcfid_tab' ? ms.filter((m) => m.sample_id === c.sample_id).flatMap((m) => m.data.peaks ?? []) : []}
          />
        ))}
    </div>
  )
}
