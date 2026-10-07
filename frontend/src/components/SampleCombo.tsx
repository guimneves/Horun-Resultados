import { useEffect, useId, useState } from 'react'
import type { SampleRow } from '../api/types'
import { inputClass, inputStyle } from './ui'

/** Escolha de amostra existente com busca: digite parte do código e escolha
 * na lista (no celular, a lista nativa do navegador). */
export function SampleCombo({
  samples,
  value,
  onChange,
  label = 'Amostra existente',
}: {
  samples: SampleRow[]
  value: number | null
  onChange: (id: number | null) => void
  label?: string
}) {
  const listId = useId()
  const current = samples.find((s) => s.id === value)
  const [text, setText] = useState(current?.code ?? '')
  useEffect(() => {
    setText(current?.code ?? '')
  }, [current?.code])
  const matched = samples.find((s) => s.code.toLowerCase() === text.trim().toLowerCase())
  return (
    <div className="relative min-w-0">
      <input
        className={inputClass}
        style={{ ...inputStyle, borderColor: text && !matched ? '#d9a400' : inputStyle.borderColor }}
        list={listId}
        value={text}
        placeholder="Digite para buscar a amostra"
        aria-label={label}
        onChange={(e) => {
          setText(e.target.value)
          const m = samples.find((s) => s.code.toLowerCase() === e.target.value.trim().toLowerCase())
          onChange(m ? m.id : null)
        }}
      />
      <datalist id={listId}>
        {samples.map((s) => (
          <option key={s.id} value={s.code} />
        ))}
      </datalist>
    </div>
  )
}
