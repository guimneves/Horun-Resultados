import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { getDevLevel, LEVEL_LABELS, setDevLevel } from '../lib/devIdentity'
import { UNDER_CORE } from '../lib/underCore'

// Abas do projeto. Importar vira botão no cabeçalho e Histórico fica no menu
// "Projeto" (ProjectLayout) — menos coisas disputando a atenção.
export const PROJECT_TABS = [
  { to: 'amostras', label: 'Amostras' },
  { to: 'series', label: 'Séries' },
  { to: 'comparar', label: 'Comparar' },
  { to: 'experimentos', label: 'Condições experimentais' },
]

/** "← Voltar ao Horun": link comum (recarrega a página) para a raiz do Core.
 * Só aparece quando o módulo é servido sob /m/. */
export function BackToHorunLink({ className = '' }: { className?: string }) {
  if (!UNDER_CORE) return null
  return (
    <a href="/" className={`whitespace-nowrap text-sm ${className}`} style={{ color: 'var(--color-text-muted)' }}>
      ← Voltar ao Horun
    </a>
  )
}

/** Seletor "Ver como" (só `npm run dev`): troca o cargo no Horun, 1 a 5. */
export function DevLevelSwitcher() {
  const current = getDevLevel()
  return (
    <div className="flex items-center gap-1">
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
        style={{ background: '#7c3aed', color: 'white' }}
        title="Só existe em desenvolvimento"
      >
        dev
      </span>
      <select
        aria-label="Ver como"
        className="max-w-[10rem] rounded-md border px-2 py-1 text-xs md:max-w-none"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        value={current ?? 0}
        onChange={(e) => {
          const level = Number(e.target.value)
          setDevLevel(level || null)
          window.location.reload()
        }}
      >
        <option value={0}>Ver como: dev (nível 1, padrão)</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            Ver como: nível {n} — {LEVEL_LABELS[n]}
          </option>
        ))}
      </select>
    </div>
  )
}

export function RoleBadge() {
  const { me } = useApp()
  if (!me) return null
  return (
    <span
      className="max-w-[45vw] truncate rounded-full px-2.5 py-1 text-xs"
      style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
      title={`${me.username} — papel neste módulo, pelo seu cargo no Horun`}
    >
      <span className="hidden sm:inline">{me.username} · </span>
      {me.is_coordenador ? 'Coordenador(a)' : 'Colaborador(a)'}
    </span>
  )
}

/** Barra lateral; no celular vira gaveta (abre por cima, fundo escurecido,
 * fecha ao escolher um item, ao tocar fora ou com Esc — App.tsx). */
export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projects, error } = useApp()
  const location = useLocation()
  const match = location.pathname.match(/^\/projects\/(\d+)/)
  const currentId = match ? Number(match[1]) : null
  const visible = projects?.filter((p) => !p.archived_at || p.id === currentId) ?? null
  const manualActive = location.pathname.startsWith('/manual')

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden print:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r p-3 shadow-xl transition-transform md:static md:z-auto md:w-56 md:max-w-none md:translate-x-0 md:shadow-none print:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }}
        aria-label="Navegação"
      >
        <div className="mb-2 flex items-center justify-between md:hidden">
          <span className="px-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Horun · Resultados
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-md text-lg"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Fechar menu"
          >
            ✕
          </button>
        </div>
        <BackToHorunLink className="mb-3 block rounded-md px-2 py-2.5 md:hidden" />
        <Link to="/" className="mb-1 rounded-md px-2 py-2 text-xs font-semibold uppercase tracking-wide md:py-1" style={{ color: 'var(--color-text-muted)' }}>
          Projetos
        </Link>
        {error && <p className="px-2 text-xs text-red-600">{error}</p>}
        {visible === null && !error && (
          <p className="px-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Carregando…
          </p>
        )}
        {visible?.length === 0 && (
          <p className="px-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Nenhum projeto ainda.
          </p>
        )}
        <nav className="flex flex-col gap-0.5">
          {visible?.map((p) => {
            const isCurrent = p.id === currentId
            return (
              <div key={p.id}>
                <Link
                  to={`/projects/${p.id}/amostras`}
                  className="flex items-center gap-2 truncate rounded-md px-2 py-2.5 text-sm md:py-1.5"
                  style={{
                    background: isCurrent ? 'var(--color-surface)' : 'transparent',
                    color: isCurrent ? 'var(--color-text)' : 'var(--color-text-muted)',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                  title={p.name}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="truncate">{p.name}</span>
                  {p.archived_at && <span className="text-xs">(arquivado)</span>}
                </Link>
              </div>
            )
          })}
        </nav>
        {/* Manual: sempre o último item, para todos (Prompt, seção 12) */}
        <div className="mt-auto border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
          <Link
            to="/manual"
            className="block rounded-md px-2 py-2.5 text-sm md:py-1.5"
            style={{
              background: manualActive ? 'var(--color-primary)' : 'transparent',
              color: manualActive ? 'var(--color-primary-contrast)' : 'var(--color-text-muted)',
            }}
          >
            Manual
          </Link>
        </div>
      </aside>
    </>
  )
}
