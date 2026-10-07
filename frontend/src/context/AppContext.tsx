import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errorText } from '../api/client'
import type { Fraction, Me, Project, TechniqueDef } from '../api/types'

interface AppState {
  me: Me | null
  catalog: TechniqueDef[]
  fractions: Fraction[]
  projects: Project[] | null
  error: string | null
  reloadProjects: () => Promise<void>
  reloadFractions: () => Promise<void>
  techniqueLabel: (key: string) => string
  paramLabel: (column: string, withUnit?: boolean) => string
  fractionLabel: (code: string) => string
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [catalog, setCatalog] = useState<TechniqueDef[]>([])
  const [fractions, setFractions] = useState<Fraction[]>([])
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reloadProjects = useCallback(async () => {
    try {
      setProjects(await api.get<Project[]>('/projects?include_archived=true'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])
  const reloadFractions = useCallback(async () => {
    setFractions(await api.get<Fraction[]>('/fractions'))
  }, [])

  useEffect(() => {
    Promise.all([api.get<Me>('/me'), api.get<TechniqueDef[]>('/catalog'), api.get<Fraction[]>('/fractions')])
      .then(([m, c, f]) => {
        setMe(m)
        setCatalog(c)
        setFractions(f)
      })
      .catch((err) => setError(errorText(err)))
    reloadProjects()
  }, [reloadProjects])

  const value = useMemo<AppState>(() => {
    const techniqueLabel = (key: string) => catalog.find((t) => t.key === key)?.label ?? key
    const paramLabel = (column: string, withUnit = true) => {
      const [tech, key] = column.split('.')
      const t = catalog.find((x) => x.key === tech)
      const p = t?.params.find((x) => x.key === key)
      if (!t || !p) return column
      return `${p.label}${withUnit && p.unit ? ` (${p.unit})` : ''}`
    }
    const fractionLabel = (code: string) => fractions.find((f) => f.code === code)?.label ?? code
    return { me, catalog, fractions, projects, error, reloadProjects, reloadFractions, techniqueLabel, paramLabel, fractionLabel }
  }, [me, catalog, fractions, projects, error, reloadProjects, reloadFractions])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp fora do AppProvider')
  return ctx
}
