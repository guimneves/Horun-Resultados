import { useEffect, useState } from 'react'
import { HorunFooter, ThemeProvider, ThemeToggle } from '@horun/design-system'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { AppSidebar, BackToHorunLink, DevLevelSwitcher, RoleBadge } from './components/Shell'
import { ProjectListPage } from './routes/ProjectListPage'
import { ProjectLayout } from './routes/ProjectLayout'
import { SamplesTab } from './routes/SamplesTab'
import { ExperimentsTab } from './routes/ExperimentsTab'
import { SeriesTab } from './routes/SeriesTab'
import { CompareTab } from './routes/CompareTab'
import { ImportTab } from './routes/ImportTab'
import { HistoryTab } from './routes/HistoryTab'
import { ManualPage } from './routes/ManualPage'

function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4 md:py-3 print:hidden"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }}
    >
      <div className="flex min-w-0 items-center gap-2 md:gap-4">
        <button type="button" onClick={onOpenMenu} className="flex h-10 w-10 items-center justify-center rounded-md text-xl md:hidden" style={{ color: 'var(--color-text)' }} aria-label="Abrir menu">
          ☰
        </button>
        <Link to="/" className="truncate text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
          Horun · Resultados
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BackToHorunLink className="hidden md:inline" />
        {import.meta.env.DEV && <DevLevelSwitcher />}
        <RoleBadge />
        <ThemeToggle />
      </div>
    </header>
  )
}

function Shell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="flex min-h-screen flex-col" style={{ background: 'var(--color-bg)' }}>
      <Header onOpenMenu={() => setMenuOpen(true)} />
      <div className="flex min-w-0 flex-1">
        <AppSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="min-w-0 flex-1">
          <Routes>
            <Route path="/" element={<ProjectListPage />} />
            <Route path="/projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<Navigate to="amostras" replace />} />
              <Route path="amostras" element={<SamplesTab />} />
              <Route path="experimentos" element={<ExperimentsTab />} />
              <Route path="series" element={<SeriesTab />} />
              <Route path="comparar" element={<CompareTab />} />
              <Route path="importar" element={<ImportTab />} />
              <Route path="historico" element={<HistoryTab />} />
            </Route>
            <Route path="/manual" element={<ManualPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <div className="print:hidden">
        <HorunFooter moduleName="Horun · Resultados" />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ThemeProvider>
  )
}
