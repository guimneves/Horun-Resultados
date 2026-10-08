import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'

export const card = { borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }
export const muted = { color: 'var(--color-text-muted)' }
export const inputClass = 'w-full rounded-md border px-3 py-2 text-sm'
export const inputStyle = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, CSSProperties> = {
    primary: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', borderColor: 'var(--color-primary)' },
    secondary: { background: 'var(--color-bg-elevated)', color: 'var(--color-text)', borderColor: 'var(--color-border)' },
    danger: { background: '#c62828', color: '#ffffff', borderColor: '#c62828' },
    ghost: { background: 'transparent', color: 'var(--color-text-muted)', borderColor: 'transparent' },
  }
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{ ...styles[variant], ...props.style }}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs" style={muted}>
          {hint}
        </span>
      )}
    </label>
  )
}

/** Janela: no celular ocupa a largura toda, com rolagem interna (Prompt, seção 13). */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean | 'xl' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 md:items-center md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`modal-panel w-full rounded-lg border p-4 shadow-xl ${wide === 'xl' ? 'md:max-w-6xl' : wide ? 'md:max-w-4xl' : 'md:max-w-lg'}`}
        style={card}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={muted}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ValidityBadge({ valid }: { valid: boolean | null }) {
  const style =
    valid === true
      ? { background: '#e3f4e8', color: '#1b6b34' }
      : valid === false
        ? { background: '#fde7e7', color: '#a12020' }
        : { background: 'var(--color-surface)', color: 'var(--color-text-muted)' }
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={style}>
      {valid === true ? 'válida' : valid === false ? 'inválida' : 'pendente'}
    </span>
  )
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: '#e5a4a4', background: '#fdf0f0', color: '#8a1c1c' }}>
      {message}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed p-4 text-center text-sm" style={{ ...muted, borderColor: 'var(--color-border)' }}>
      {children}
    </p>
  )
}

/** Menu suspenso simples ("Mais ▾", "Projeto ▾"): fecha ao escolher um item. */
export function Dropdown({ label, children, ariaLabel }: { label: ReactNode; children: ReactNode; ariaLabel?: string }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    // fecha ao tocar fora
    const onDoc = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.removeAttribute('open')
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])
  return (
    <details className="relative" ref={ref}>
      <summary
        className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border px-3 text-sm"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }}
        aria-label={ariaLabel}
      >
        {label} <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border p-1 shadow-lg" style={card} onClick={() => ref.current?.removeAttribute('open')}>
        {children}
      </div>
    </details>
  )
}

export function MenuItem({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-surface)] disabled:opacity-50"
      style={danger ? { color: '#c62828' } : undefined}
    >
      {children}
    </button>
  )
}

/** Botões de escolha única lado a lado (ex.: eixo X, sinal, visão). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border p-0.5" style={{ borderColor: 'var(--color-border)' }} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className="rounded px-2.5 py-1 text-xs"
          style={value === o.value ? { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)' } : muted}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
