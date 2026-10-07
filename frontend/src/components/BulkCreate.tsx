import { useState } from 'react'
import { api, errorText } from '../api/client'
import { Button, ErrorBox, Field, inputClass, inputStyle, Modal, muted } from './ui'

/** "Criar várias": cola uma lista de códigos (um por linha, ou separados por
 * vírgula/ponto e vírgula); fração, temperatura e experimento vêm do código. */
export function BulkCreate({ title, path, hint, onClose, onDone }: { title: string; path: string; hint: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ created: string[]; existing: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={title} onClose={onClose}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p>
            <strong>{result.created.length}</strong> criado(s){result.created.length ? `: ${result.created.join(', ')}` : '.'}
          </p>
          {result.existing.length > 0 && (
            <p style={muted}>
              Já existiam (não mexi): {result.existing.join(', ')}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={onDone}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Códigos" hint={hint}>
            <textarea className={inputClass} style={inputStyle} rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </Field>
          <ErrorBox message={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!text.trim()}
              onClick={async () => {
                try {
                  setResult(await api.post(path, { codes: [text] }))
                } catch (err) {
                  setError(errorText(err))
                }
              }}
            >
              Criar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
