import { getDevLevel } from '../lib/devIdentity'

// Plugado no Core, tudo roda na mesma origem sob /m/resultados/ — a
// identidade chega ao backend pelo gateway, nunca pelo frontend (Prompt,
// seção 6). Em desenvolvimento, o frontend fala direto com o backend
// (VITE_API_URL, padrão http://localhost:8000). Toda rota da API fica sob /api.
export const API_BASE =
  (import.meta.env.DEV
    ? (import.meta.env.VITE_API_URL ?? 'http://localhost:8000')
    : import.meta.env.BASE_URL.replace(/\/$/, '')) + '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function devHeaders(): Record<string, string> {
  if (!import.meta.env.DEV) return {}
  const level = getDevLevel()
  if (!level) return {}
  return {
    'X-Horun-User-Id': `dev-nivel-${level}`,
    'X-Horun-User': `dev-nivel-${level}`,
    'X-Horun-Role': level <= 2 ? 'admin' : 'user',
    'X-Horun-Level': String(level),
  }
}

async function raw(path: string, init?: RequestInit): Promise<Response> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...devHeaders(),
      ...init?.headers,
    },
  })
  if (!resp.ok) {
    let detail = ''
    try {
      const body = await resp.json()
      detail = typeof body.detail === 'string' ? body.detail : ''
    } catch {
      // corpo não era JSON
    }
    if (!detail) detail = resp.status === 413 ? 'Arquivo grande demais.' : `Erro ${resp.status} ${resp.statusText}`
    throw new ApiError(resp.status, detail)
  }
  return resp
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await raw(path, init)
  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body !== undefined ? JSON.stringify(body) : undefined,
})

function filenameFrom(disposition: string, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) return decodeURIComponent(star[1])
  const plain = /filename="([^"]+)"/i.exec(disposition)
  return plain ? plain[1] : fallback
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, json('POST', body)),
  patch: <T>(path: string, body?: unknown) => request<T>(path, json('PATCH', body)),
  delete: <T>(path: string, body?: unknown) => request<T>(path, json('DELETE', body)),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  /** Baixa um arquivo (exportação, original) e entrega ao navegador. */
  download: async (path: string, fallbackName: string, body?: unknown) => {
    const resp = await raw(path, body !== undefined ? json('POST', body) : undefined)
    const name = filenameFrom(resp.headers.get('Content-Disposition') ?? '', fallbackName)
    const url = URL.createObjectURL(await resp.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
