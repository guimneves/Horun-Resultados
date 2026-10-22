import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../../api/client'
import type { AseField, DoePlan, DoePlanListItem } from '../../api/types'
import { Button, card, ErrorBox, muted, Segmented } from '../../components/ui'
import { useProject } from '../ProjectLayout'
import { AnalysisTab } from './AnalysisTab'
import { AseChartsTab } from './AseChartsTab'
import { MeansTab } from './MeansTab'
import { PlanForm } from './PlanForm'
import { PlanTab } from './PlanTab'
import { designLabel } from './aseLib'
import { RunsTab } from './RunsTab'

// Extrações no ASE 350 e planejamentos fatoriais (pedido do mantenedor,
// 22/10/2026): escolher/criar o planejamento → matriz e execuções → resultados
// finais de cada extração → médias por condição → análise DOE (Pareto) →
// gráficos. O Rock-Eval vem das amostras já importadas (rocha pós-ASE de cada
// execução e rocha pré-extração do planejamento) — nada é redigitado.

type View = 'plano' | 'resultados' | 'medias' | 'analise' | 'graficos'
const VIEWS: { value: View; label: string }[] = [
  { value: 'plano', label: 'Planejamento' },
  { value: 'resultados', label: 'Resultados por execução' },
  { value: 'medias', label: 'Médias' },
  { value: 'analise', label: 'Análise DOE' },
  { value: 'graficos', label: 'Gráficos' },
]
const PLAN_KEY = (projectId: number) => `resultados.ase.plano.${projectId}`

export function AseTab() {
  const { project, canEdit } = useProject()
  const [plans, setPlans] = useState<DoePlanListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [planId, setPlanIdState] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(PLAN_KEY(project.id)))
      return v || null
    } catch {
      return null
    }
  })
  const setPlanId = (id: number | null) => {
    setPlanIdState(id)
    try {
      if (id) localStorage.setItem(PLAN_KEY(project.id), String(id))
      else localStorage.removeItem(PLAN_KEY(project.id))
    } catch {
      /* sem armazenamento: só não lembra */
    }
  }
  const [plan, setPlan] = useState<DoePlan | null>(null)
  const [view, setView] = useState<View>('plano')

  const reloadList = useCallback(async () => {
    try {
      const d = await api.get<{ plans: DoePlanListItem[]; fields: AseField[] }>(`/projects/${project.id}/doe`)
      setPlans(d.plans)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [project.id])

  const reloadPlan = useCallback(async () => {
    if (!planId) {
      setPlan(null)
      return
    }
    try {
      setPlan(await api.get<DoePlan>(`/projects/${project.id}/doe/${planId}`))
    } catch (err) {
      setError(errorText(err))
      setPlanId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, planId])

  useEffect(() => {
    void reloadList()
  }, [reloadList])
  useEffect(() => {
    void reloadPlan()
  }, [reloadPlan])

  const onPlan = (p: DoePlan) => {
    setPlan(p)
    void reloadList()
  }

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <section className="rounded-lg border p-3" style={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Planejamento</span>
            {plans === null ? (
              <span className="text-sm" style={muted}>
                Carregando…
              </span>
            ) : plans.length === 0 ? (
              <span className="text-sm" style={muted}>
                Nenhum planejamento ainda.
              </span>
            ) : (
              <select
                className="rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                value={planId ?? ''}
                onChange={(e) => setPlanId(e.target.value ? Number(e.target.value) : null)}
                aria-label="Planejamento"
              >
                <option value="">— escolha —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {designLabel(p.design)} · {p.n_done}/{p.n_runs} com resultado
                  </option>
                ))}
              </select>
            )}
          </div>
          {canEdit && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Novo planejamento
            </Button>
          )}
        </div>
        {!planId && plans && plans.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {plans.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full rounded-md border p-3 text-left text-sm"
                  style={{ borderColor: 'var(--color-border)' }}
                  onClick={() => setPlanId(p.id)}
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="block text-xs" style={muted}>
                    {designLabel(p.design)} · {p.factors.join(', ')} · {p.replicates} execução(ões) por condição
                    {p.center_points ? ` + ${p.center_points} ponto(s) central(is)` : ''} · {p.n_done} de {p.n_runs} com resultado
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <PlanForm
          projectId={project.id}
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false)
            setPlanId(p.id)
            onPlan(p)
            setView('plano')
          }}
        />
      )}

      {plan && (
        <>
          <Segmented label="Vista do planejamento" value={view} onChange={setView} options={VIEWS} />
          {view === 'plano' && (
            <PlanTab
              plan={plan}
              onChange={onPlan}
              onDeleted={() => {
                setPlanId(null)
                setPlan(null)
                void reloadList()
              }}
            />
          )}
          {view === 'resultados' && <RunsTab plan={plan} onChange={onPlan} />}
          {view === 'medias' && <MeansTab plan={plan} />}
          {view === 'analise' && <AnalysisTab plan={plan} />}
          {view === 'graficos' && <AseChartsTab plan={plan} />}
        </>
      )}
    </div>
  )
}
