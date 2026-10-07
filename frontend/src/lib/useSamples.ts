import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Mode, SampleRow } from '../api/types'

/** Tabela de amostras do projeto (médias ± desvio por técnica.parâmetro). */
export function useSamples(projectId: number, mode: Mode = 'padrao') {
  const [samples, setSamples] = useState<SampleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const data = await api.get<{ samples: SampleRow[] }>(`/projects/${projectId}/samples?mode=${mode}`)
      setSamples(data.samples)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [projectId, mode])
  useEffect(() => {
    reload()
  }, [reload])
  return { samples, error, reload }
}
