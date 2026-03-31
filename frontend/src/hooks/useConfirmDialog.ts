import { useRef, useState } from 'react'
import type { ConfirmationRequest } from '@/types'

export function useConfirmDialog() {
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null)
  const [request, setRequest] = useState<ConfirmationRequest | null>(null)

  function confirm(next: ConfirmationRequest) {
    setRequest(next)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }

  function settle(accepted: boolean) {
    resolverRef.current?.(accepted)
    resolverRef.current = null
    setRequest(null)
  }

  return {
    request,
    confirm,
    accept: () => settle(true),
    reject: () => settle(false),
  }
}
