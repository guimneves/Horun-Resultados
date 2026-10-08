import { LabelList } from 'recharts'
import type { SampleRow } from '../api/types'
import { fmt } from '../lib/format'

// Nos gráficos de dispersão (HI × Tmax, Van Krevelen, COT × C LECO…) cada
// ponto mostra a amostra a que pertence e, ao lado e em cinza, a réplica do
// experimento (A, B, C). Nas séries por temperatura isso não é usado.

export interface PointId {
  code: string
  rep: string
}

export function pointId(s: SampleRow): PointId {
  const rep = s.replicate_letter ?? ''
  const exp = s.experiment_code ?? ''
  // a letra da réplica já está no código (HP300NA, HP300NA-H): tira dali e
  // mostra só ao lado, em cinza → "HP300N A", "HP300N-H A"
  if (rep && exp.toUpperCase().endsWith(rep.toUpperCase()) && s.code.toUpperCase().startsWith(exp.toUpperCase())) {
    return { code: exp.slice(0, -rep.length) + s.code.slice(exp.length), rep }
  }
  return { code: s.code, rep }
}

/** Rótulo SVG "HP300H A" (réplica menor e em cinza) acima do ponto. */
function LabelSvg({ x, y, width, code, rep }: { x?: number | string; y?: number | string; width?: number | string; code?: string; rep?: string }) {
  if (x == null || y == null || !code) return null
  const cx = Number(x) + Number(width ?? 0) / 2
  return (
    <text x={cx} y={Number(y) - 4} textAnchor="middle" fontSize={10} style={{ pointerEvents: 'none' }}>
      <tspan fill="var(--color-text)">{code}</tspan>
      {rep && (
        <tspan dx={3} fill="var(--color-text-muted)">
          {rep}
        </tspan>
      )}
    </text>
  )
}

/** Coloque dentro de <Scatter data={pts}>: {pointLabels(pts)}. */
export function pointLabels(data: PointId[]) {
  return (
    <LabelList
      dataKey="code"
      content={(p: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => (
        <LabelSvg x={p.x} y={p.y} width={p.width} code={data[p.index ?? -1]?.code} rep={data[p.index ?? -1]?.rep} />
      )}
    />
  )
}

/** Tooltip dos gráficos de dispersão: amostra (réplica em cinza) e os dois eixos. */
export function PointTooltip({
  active,
  payload,
  xKey,
  yKey,
  xLabel,
  yLabel,
}: {
  active?: boolean
  payload?: { payload?: PointId & Record<string, unknown> }[]
  xKey: string
  yKey: string
  xLabel: string
  yLabel: string
}) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <div
      className="rounded-md border px-2 py-1.5 text-xs"
      style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
    >
      <p className="font-semibold">
        {p.code}
        {p.rep && (
          <span className="ml-1 font-normal" style={{ color: 'var(--color-text-muted)' }}>
            réplica {p.rep}
          </span>
        )}
      </p>
      <p className="tabular-nums">
        {xLabel}: {fmt(Number(p[xKey]))}
      </p>
      <p className="tabular-nums">
        {yLabel}: {fmt(Number(p[yKey]))}
      </p>
    </div>
  )
}

/** Texto para tabelas: "HP300H (réplica A)". */
export function pointText(p: PointId): string {
  return p.rep ? `${p.code} (réplica ${p.rep})` : p.code
}
