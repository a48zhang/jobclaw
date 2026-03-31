import type { ConfirmationRequest } from '@/types'

export function ConfirmDialog(props: {
  request: ConfirmationRequest | null
  onAccept: () => void
  onReject: () => void
}) {
  const open = Boolean(props.request)
  return (
    <div
      id="ui-confirm-overlay"
      className={`dialog-overlay${open ? ' is-open' : ''}`}
      aria-hidden={open ? 'false' : 'true'}
    >
      <div className="dialog-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="ui-confirm-title">
        <h2 id="ui-confirm-title">{props.request?.title || '请确认'}</h2>
        <p id="ui-confirm-message">{props.request?.message || ''}</p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={props.onReject}>
            {props.request?.cancelLabel || '取消'}
          </button>
          <button
            type="button"
            className={props.request?.tone === 'danger' ? 'danger-button' : 'primary-button'}
            onClick={props.onAccept}
          >
            {props.request?.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}
