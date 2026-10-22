import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, errorText } from '../../api/client'
import type { DoeAnalysis, DoePlan } from '../../api/types'
import { axisProps, ChartCard, gridProps, SimpleTable, tooltipStyle } from '../../charts/ChartCard'
import { card, ErrorBox, inputClass, inputStyle, muted, Segmented } from '../../components/ui'
import { PALETTE } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { useProject } from '../ProjectLayout'
import { byGroup, withUnit } from './aseLib'

// Análise do planejamento (22/10/2026): efeitos principais e interações,
// valores-p quando há erro estimável, Pareto (efeitos padronizados + linha
// crítica no nível de confiança escolhido), ANOVA, qualidade do ajuste e
// gráficos de efeitos, interações e resíduos. Sem graus de liberdade para o
// erro, mostra os efeitos SEM significância — e diz por quê.

const POS = PALETTE[0]
const NEG = PALETTE[1]
const RESP_KEY = (planId: number) => `resultados.ase.resposta.${planId}`

function fp(p: number | null | undefined): string {
  if (p == null) return '—'
  return p < 0.0001 ? '< 0,0001' : fmt(p)
}

export function AnalysisTab({ plan }: { plan: DoePlan }) {
  const { project } = useProject()
  const withData = plan.fields.filter((f) => f.n > 0)
  const [response, setResponseState] = useState<string>(() => {
    try {
      return localStorage.getItem(RESP_KEY(plan.id)) || ''
    } catch {
      return ''
    }
  })
  const setResponse = (k: string) => {
    setResponseState(k)
    try {
      localStorage.setItem(RESP_KEY(plan.id), k)
    } catch {
      /* só não lembra */
    }
  }
  const resp = withData.find((f) => f.key === response) ?? withData.find((f) => f.key === 'y_m1') ?? withData[0]
  const [conf, setConf] = useState<string>('0.95')
  const [custom, setCustom] = useState('97,5')
  const confidence = conf === 'custom' ? Number(custom.replace(',', '.')) / 100 : Number(conf)
  const confOk = Number.isFinite(confidence) && confidence > 0.5 && confidence < 1
  const [data, setData] = useState<DoeAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!resp || !confOk) return
    setData(null)
    setError(null)
    api
      .get<DoeAnalysis>(`/projects/${project.id}/doe/${plan.id}/analysis?response=${resp.key}&confidence=${confidence}`)
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [project.id, plan, resp, confidence, confOk])

  if (!withData.length)
    return (
      <p className="rounded-lg border p-4 text-sm" style={{ ...card, ...muted }}>
        Ainda não há resultados para analisar. Lance os resultados das execuções (ou importe a planilha) e volte aqui.
      </p>
    )

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-3 md:p-4" style={card}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1 text-sm">
            <span className="mb-1 block font-medium">Variável-resposta (Y)</span>
            <select className={inputClass} style={inputStyle} value={resp?.key ?? ''} onChange={(e) => setResponse(e.target.value)}>
              {byGroup(plan.fields).map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.fields.map((f) => (
                    <option key={f.key} value={f.key} disabled={f.n === 0}>
                      {withUnit(f)} — {f.n ? `${f.n} execução(ões)` : 'sem dados'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium">Nível de confiança</span>
            <div className="flex items-center gap-2">
              <Segmented
                label="Nível de confiança"
                value={conf}
                onChange={setConf}
                options={[
                  { value: '0.9', label: '90 %' },
                  { value: '0.95', label: '95 %' },
                  { value: '0.99', label: '99 %' },
                  { value: 'custom', label: 'Outro' },
                ]}
              />
              {conf === 'custom' && (
                <span className="flex items-center gap-1">
                  <input className={`${inputClass} w-20`} style={inputStyle} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Confiança personalizada (%)" />%
                </span>
              )}
            </div>
          </div>
        </div>
        {!confOk && <p className="mt-2 text-sm" style={{ color: '#a12020' }}>Confiança entre 50 % e 99,99 %.</p>}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold">Todas as variáveis disponíveis (ASE e Rock-Eval)</summary>
          <div className="table-wrap mt-1">
            <SimpleTable
              head={['Grupo', 'Variável', 'Unidade', 'Execuções com resultado']}
              rows={plan.fields.map((f) => [f.group_label, f.label, f.unit, f.n])}
            />
          </div>
        </details>
      </section>

      <ErrorBox message={error} />
      {!data && !error && <p style={muted}>Calculando…</p>}
      {data && !data.ok && (
        <p className="rounded-lg border p-4 text-sm" style={card}>
          {data.message}
        </p>
      )}
      {data && data.ok && <Results data={data} plan={plan} />}
    </div>
  )
}

function Results({ data, plan }: { data: DoeAnalysis; plan: DoePlan }) {
  const effects = data.effects ?? []
  const hasP = data.df_resid != null && data.df_resid > 0 && data.t_crit != null
  const unit = data.response.unit
  const pct = `${fmt(data.confidence * 100)} %`
  const pareto = useMemo(
    () =>
      [...effects]
        .map((e) => ({ ...e, size: hasP ? Math.abs(e.t ?? 0) : Math.abs(e.effect) }))
        .sort((a, b) => b.size - a.size),
    [effects, hasP],
  )
  const title = data.response.short
  return (
    <div className="space-y-4">
      {data.significance_note && (
        <p className="rounded-lg border p-3 text-sm" style={{ ...card, borderColor: '#d6a400' }} role="note">
          {data.significance_note}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard
          title={`Pareto dos efeitos — ${title}`}
          subtitle={
            hasP
              ? `Efeitos padronizados (|t|) · linha crítica t = ${fmt(data.t_crit)} (${pct}, ${data.df_resid} gl do erro) · cor = sinal do efeito`
              : `|efeito| em ${unit} — sem erro estimável, sem linha de significância`
          }
          filename={`pareto_${data.response.key}`}
          table={
            <SimpleTable
              head={['Termo', 'Fatores', `Efeito (${unit})`, ...(hasP ? ['|t|', 'p', `Significativo (${pct})`] : [])]}
              rows={pareto.map((e) => [e.term, e.label, fmt(e.effect), ...(hasP ? [fmt(Math.abs(e.t ?? 0)), fp(e.p), e.significant ? 'sim' : 'não'] : [])])}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pareto} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} tickFormatter={(v: number) => fmt(v)} />
              <YAxis type="category" dataKey="term" {...axisProps} width={44} interval={0} />
              <Tooltip
                {...tooltipStyle}
                formatter={(_v, _n, item) => {
                  const e = item?.payload as (typeof pareto)[number]
                  return [
                    `efeito ${fmt(e.effect)} ${unit}${hasP ? ` · |t| = ${fmt(Math.abs(e.t ?? 0))} · p = ${fp(e.p)}` : ''}`,
                    e.label,
                  ]
                }}
              />
              {hasP && <ReferenceLine x={data.t_crit ?? 0} stroke="var(--color-text)" strokeDasharray="4 3" label={{ value: `t crítico (${pct})`, position: 'top', fill: 'var(--color-text-muted)', fontSize: 11 }} />}
              <Bar dataKey="size" name={hasP ? '|t| (efeito padronizado)' : '|efeito|'} isAnimationActive={false} radius={[0, 4, 4, 0]}>
                {pareto.map((e) => (
                  <Cell key={e.term} fill={e.effect >= 0 ? POS : NEG} fillOpacity={!hasP || e.significant ? 1 : 0.4} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <section className="rounded-lg border p-3 text-sm" style={card}>
          <h3 className="mb-2 font-semibold">Efeitos e interações — {title}</h3>
          <p className="mb-2 text-xs" style={muted}>
            Efeito = média no nível alto (+1) − média no nível baixo (−1). Azul = efeito positivo, laranja = negativo
            {hasP ? '; barras claras = não significativas no nível escolhido' : ''}. {data.n_runs} execução(ões) independentes
            {data.n_center ? `, ${data.n_center} no centro` : ''}.
          </p>
          <div className="table-wrap text-xs">
            <SimpleTable
              head={['Termo', 'Fatores', `Efeito (${unit})`, 'Coeficiente', ...(hasP ? ['EP do efeito', 't', 'p', 'Signif.'] : [])]}
              rows={effects.map((e) => [
                e.term,
                e.label,
                fmt(e.effect),
                fmt(e.coef),
                ...(hasP ? [fmt(e.se_effect), fmt(e.t), fp(e.p), e.significant ? 'sim' : 'não'] : []),
              ])}
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt style={muted}>Média geral (intercepto)</dt>
              <dd>{fmt(data.intercept)}</dd>
            </div>
            <div>
              <dt style={muted}>Graus de liberdade do erro</dt>
              <dd>{data.df_resid}</dd>
            </div>
            {hasP && (
              <>
                <div>
                  <dt style={muted}>S (desvio do erro)</dt>
                  <dd>{fmt(data.s)}</dd>
                </div>
                <div>
                  <dt style={muted}>R²</dt>
                  <dd>{data.r2 == null ? '—' : `${fmt(data.r2 * 100)} %`}</dd>
                </div>
                <div>
                  <dt style={muted}>R² ajustado</dt>
                  <dd>{data.r2_adj == null ? '—' : `${fmt(data.r2_adj * 100)} %`}</dd>
                </div>
                <div>
                  <dt style={muted}>R² de previsão</dt>
                  <dd title="Precisa de ao menos 2 execuções em cada condição">{data.r2_pred == null ? '—' : `${fmt(data.r2_pred * 100)} %`}</dd>
                </div>
              </>
            )}
          </dl>
          {data.curvature && (
            <p className="mt-2 text-xs">
              <strong>Curvatura (pontos centrais):</strong> média no centro {fmt(data.curvature.mean_center)} × média dos vértices{' '}
              {fmt(data.curvature.mean_factorial)}
              {data.curvature.p != null ? ` — p = ${fp(data.curvature.p)} (${data.curvature.significant ? 'há curvatura' : 'sem evidência de curvatura'} a ${pct})` : ''}.
              O centro indica se a resposta é não linear, mas não diz em qual fator.
            </p>
          )}
        </section>
      </div>

      {data.anova && (
        <section className="rounded-lg border p-3 text-sm" style={card}>
          <h3 className="mb-2 font-semibold">ANOVA (regressão com os termos codificados)</h3>
          <div className="table-wrap text-xs">
            <SimpleTable
              head={['Fonte', 'gl', 'SQ', 'QM', 'F', 'p']}
              rows={data.anova.map((r) => [r.source === r.label ? r.label : `${r.source} — ${r.label}`, r.df, fmt(r.ss), fmt(r.ms), fmt(r.f), fp(r.p)])}
            />
          </div>
          <p className="mt-1 text-xs" style={muted}>
            O erro vem só das execuções independentes (réplicas de extração e pontos centrais). A média de cada condição é um resumo, não uma réplica.
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <MainEffects data={data} />
        {(data.interactions ?? []).map((it) => (
          <InteractionChart key={`${it.a}${it.b}`} data={data} it={it} />
        ))}
        {data.half_normal && <HalfNormal data={data} />}
        {hasP && <Residuals data={data} />}
      </div>
      <p className="text-xs" style={muted}>
        Fatores: {plan.factors.map((f) => `${f.letter} = ${f.name}`).join(' · ')}.
      </p>
    </div>
  )
}

function MainEffects({ data }: { data: DoeAnalysis }) {
  const unit = data.response.unit
  const rows = (data.main_effects ?? []).flatMap((m) => [
    { key: `${m.letter}-`, factor: `${m.letter}: ${m.low}`, letter: m.letter, mean: m.mean_low },
    { key: `${m.letter}+`, factor: `${m.letter}: ${m.high}`, letter: m.letter, mean: m.mean_high },
  ])
  return (
    <ChartCard
      title={`Efeitos principais — ${data.response.short}`}
      subtitle={`Média de ${data.response.short} (${unit}) em cada nível de cada fator`}
      filename={`efeitos_principais_${data.response.key}`}
      table={<SimpleTable head={['Fator', 'Nível baixo', 'Média', 'Nível alto', 'Média']} rows={(data.main_effects ?? []).map((m) => [m.name, m.low, fmt(m.mean_low), m.high, fmt(m.mean_high)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="factor" type="category" allowDuplicatedCategory={false} {...axisProps} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v))} ${unit}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {(data.main_effects ?? []).map((m, i) => (
            <Line
              key={m.letter}
              name={`${m.letter} — ${m.name}`}
              data={rows.filter((r) => r.letter === m.letter)}
              dataKey="mean"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function InteractionChart({ data, it }: { data: DoeAnalysis; it: NonNullable<DoeAnalysis['interactions']>[number] }) {
  const unit = data.response.unit
  const rows = [
    { x: it.a_low, low: it.means['-1-1'], high: it.means['-11'] },
    { x: it.a_high, low: it.means['1-1'], high: it.means['11'] },
  ]
  return (
    <ChartCard
      title={`Interação ${it.a}${it.b} — ${it.a_name} × ${it.b_name}`}
      subtitle={`Média de ${data.response.short} (${unit}); linhas não paralelas indicam interação`}
      filename={`interacao_${it.a}${it.b}_${data.response.key}`}
      table={<SimpleTable head={[it.a_name, `${it.b_name}: ${it.b_low}`, `${it.b_name}: ${it.b_high}`]} rows={rows.map((r) => [r.x, fmt(r.low), fmt(r.high)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" {...axisProps} label={{ value: it.a_name, position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }} height={40} />
          <YAxis {...axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v))} ${unit}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line name={`${it.b_name}: ${it.b_low}`} dataKey="low" stroke={PALETTE[2]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          <Line name={`${it.b_name}: ${it.b_high}`} dataKey="high" stroke={PALETTE[6]} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function HalfNormal({ data }: { data: DoeAnalysis }) {
  const pts = data.half_normal ?? []
  return (
    <ChartCard
      title="Gráfico meio-normal dos efeitos"
      subtitle="Apoio visual sem réplicas: efeitos que se afastam da reta pela origem merecem atenção (não é teste de significância)"
      filename={`meio_normal_${data.response.key}`}
      table={<SimpleTable head={['Termo', '|efeito|', 'Quantil meio-normal']} rows={pts.map((p) => [p.term, fmt(p.abs_effect), fmt(p.quantile)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis type="number" dataKey="abs_effect" name="|efeito|" {...axisProps} tickFormatter={(v: number) => fmt(v)} label={{ value: `|efeito| (${data.response.unit})`, position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }} height={40} />
          <YAxis type="number" dataKey="quantile" name="quantil" {...axisProps} width={48} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} labelFormatter={() => ''} />
          <Scatter data={pts} fill={POS} isAnimationActive={false} name="efeitos" label={{ dataKey: 'term', position: 'right', fontSize: 11, fill: 'var(--color-text)' }} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function Residuals({ data }: { data: DoeAnalysis }) {
  const pts = data.residuals ?? []
  const unit = data.response.unit
  const [kind, setKind] = useState<'ajustado' | 'normal'>('ajustado')
  return (
    <ChartCard
      title={kind === 'ajustado' ? 'Resíduos × valores ajustados' : 'Probabilidade normal dos resíduos'}
      subtitle={kind === 'ajustado' ? 'Sem padrão = variância constante' : 'Pontos perto de uma reta = resíduos aproximadamente normais'}
      filename={`residuos_${data.response.key}`}
      controls={
        <Segmented
          label="Gráfico de resíduos"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'ajustado', label: '× ajustados' },
            { value: 'normal', label: 'Normal' },
          ]}
        />
      }
      table={<SimpleTable head={['Execução', `Observado (${unit})`, 'Ajustado', 'Resíduo', 'Padronizado']} rows={pts.map((p) => [p.run, fmt(p.y), fmt(p.fitted), fmt(p.residual), fmt(p.standardized)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey={kind === 'ajustado' ? 'fitted' : 'residual'}
            {...axisProps}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => fmt(v)}
            label={{ value: kind === 'ajustado' ? `Ajustado (${unit})` : `Resíduo (${unit})`, position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 12 }}
            height={40}
          />
          <YAxis type="number" dataKey={kind === 'ajustado' ? 'residual' : 'normal_score'} {...axisProps} width={56} tickFormatter={(v: number) => fmt(v)} />
          {kind === 'ajustado' && <ReferenceLine y={0} stroke="var(--color-text-muted)" />}
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} labelFormatter={() => ''} />
          <Scatter data={pts} fill={POS} isAnimationActive={false} name="execuções" />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
