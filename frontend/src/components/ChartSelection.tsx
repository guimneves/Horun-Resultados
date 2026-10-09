import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { downloadChartsPng, type ChartImageSource } from '../lib/chartExport'
import { Button, muted } from './ui'

// Escolher vários gráficos e baixar de uma vez (PNG; dois ou mais → .zip).
// Cada ChartCard se registra aqui; com a seleção ligada, ele mostra uma caixa
// de marcar no canto. A ordem dos arquivos = a ordem na tela.

interface Entry {
  get: () => ChartImageSource | null
}

interface Ctx {
  selecting: boolean
  selected: Set<string>
  start: () => void
  toggle: (id: string) => void
  register: (id: string, entry: Entry) => () => void
}

const ChartSelectionContext = createContext<Ctx | null>(null)

export function useChartSelection(): Ctx | null {
  return useContext(ChartSelectionContext)
}

/** Botão que liga a seleção ("Baixar vários PNG"). */
export function SelectChartsButton() {
  const ctx = useChartSelection()
  if (!ctx || ctx.selecting) return null
  return <Button onClick={ctx.start}>Baixar vários PNG</Button>
}

export function ChartSelectionProvider({ children, zipName }: { children: ReactNode; zipName: string }) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const entries = useRef(new Map<string, Entry>())

  const start = useCallback(() => {
    setError(null)
    setSelecting(true)
  }, [])
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const register = useCallback((id: string, entry: Entry) => {
    entries.current.set(id, entry)
    return () => {
      entries.current.delete(id)
      setSelected((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  // ordem da tela: posição do gráfico no documento
  const ordered = () =>
    [...entries.current.entries()]
      .map(([id, e]) => ({ id, src: e.get() }))
      .filter((x): x is { id: string; src: ChartImageSource } => !!x.src)
      .sort((a, b) => (a.src.chart.compareDocumentPosition(b.src.chart) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))

  const stop = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  async function download() {
    setBusy(true)
    setError(null)
    try {
      await downloadChartsPng(
        ordered()
          .filter((x) => selected.has(x.id))
          .map((x) => x.src),
        zipName,
      )
      stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const value = useMemo(() => ({ selecting, selected, start, toggle, register }), [selecting, selected, start, toggle, register])

  return (
    <ChartSelectionContext.Provider value={value}>
      {children}
      {selecting && (
        <div
          className="sticky bottom-3 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-lg print:hidden"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }}
          role="region"
          aria-label="Baixar gráficos selecionados"
        >
          <span className="mr-auto px-1 text-sm">
            {selected.size} gráfico{selected.size === 1 ? '' : 's'} selecionado{selected.size === 1 ? '' : 's'}
            <span className="ml-2 text-xs" style={muted}>
              marque no canto de cada gráfico
            </span>
          </span>
          {error && (
            <span className="text-xs" style={{ color: '#a12020' }}>
              {error}
            </span>
          )}
          <Button onClick={() => setSelected(new Set(ordered().map((x) => x.id)))}>Todos da tela</Button>
          <Button onClick={stop}>Cancelar</Button>
          <Button variant="primary" disabled={busy || selected.size === 0} onClick={download}>
            {busy ? 'Gerando…' : selected.size > 1 ? `Baixar ${selected.size} PNG (.zip)` : 'Baixar PNG'}
          </Button>
        </div>
      )}
    </ChartSelectionContext.Provider>
  )
}
