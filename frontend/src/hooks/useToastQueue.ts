import { useEffect, useState } from 'react'
import type { ToastItem } from '@/types'

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    if (toasts.length === 0) return
    const timer = window.setTimeout(() => {
      setToasts((current) => current.slice(1))
    }, 3200)
    return () => window.clearTimeout(timer)
  }, [toasts])

  function push(toast: Omit<ToastItem, 'id'>) {
    setToasts((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...toast },
    ])
  }

  function dismiss(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

  return { toasts, push, dismiss }
}
