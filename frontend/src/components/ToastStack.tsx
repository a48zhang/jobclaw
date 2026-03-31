import type { ToastItem } from '@/types'

export function ToastStack(props: {
  toasts: ToastItem[]
  dismiss: (id: string) => void
}) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {props.toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast-card is-${toast.tone}`}
          onClick={() => props.dismiss(toast.id)}
        >
          <strong>{toast.title}</strong>
          {toast.detail ? <span>{toast.detail}</span> : null}
        </button>
      ))}
    </div>
  )
}
