import type { InterventionPayload } from '@/types'

export function InterventionDialog(props: {
  payload: InterventionPayload | null
  value: string
  error: string
  submitting: boolean
  setValue: (value: string) => void
  onClose: () => void
  onSubmit: (value?: string) => void
}) {
  const open = Boolean(props.payload)
  return (
    <div
      id="modal-overlay"
      className={`dialog-overlay${open ? ' is-open' : ''}`}
      aria-hidden={open ? 'false' : 'true'}
    >
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-prompt">
        <h2 id="modal-title">需要确认</h2>
        <p id="modal-prompt">{props.payload?.prompt || ''}</p>
        <div id="modal-options" className={`option-list${props.payload?.options?.length ? '' : ' is-hidden'}`}>
          {props.payload?.options?.map((option) => (
            <button key={option} type="button" className="option-chip" onClick={() => props.onSubmit(option)}>
              {option}
            </button>
          ))}
        </div>
        {props.payload?.kind === 'confirm' ? null : (
          <input
            id="modal-input"
            type="text"
            value={props.value}
            onChange={(event) => props.setValue(event.target.value)}
            placeholder="输入内容..."
          />
        )}
        {props.error ? <p className="field-error">{props.error}</p> : null}
        <div className="dialog-actions">
          <button id="modal-cancel" type="button" className="secondary-button" onClick={props.onClose}>
            取消
          </button>
          <button
            id="modal-submit"
            type="button"
            className="primary-button"
            disabled={props.submitting}
            onClick={() => props.onSubmit()}
          >
            {props.submitting ? '提交中...' : '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}
