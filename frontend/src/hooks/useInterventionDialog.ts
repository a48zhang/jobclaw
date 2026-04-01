import { useState } from 'react'
import { resolveIntervention } from '@/lib/api'
import type { InterventionPayload, ToastItem } from '@/types'

export function useInterventionDialog(addToast: (toast: Omit<ToastItem, 'id'>) => void) {
  const [payload, setPayload] = useState<InterventionPayload | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function open(next: InterventionPayload) {
    setPayload(next)
    setValue('')
    setError('')
    setSubmitting(false)
  }

  function close(kind?: string) {
    if (submitting) return
    // For confirm-type dialogs, close = cancel (notify server via __cancel__ marker)
    if (kind === 'confirm') {
      void submit('__cancel__')
      return
    }
    setPayload(null)
    setValue('')
    setError('')
  }

  function forceClose() {
    setPayload(null)
    setValue('')
    setError('')
  }

  async function submit(forcedValue?: string, kind?: string) {
    if (!payload) return

    // Handle explicit confirm/cancel action markers (Issue 9b fix)
    const isConfirmAction = forcedValue === '__confirm__'
    const isCancelAction = forcedValue === '__cancel__'

    // Skip empty validation for explicit action markers
    const input = (forcedValue ?? value).trim()
    if (!input && !payload.allowEmpty && !isConfirmAction && !isCancelAction) {
      setError('请先提供输入。')
      return
    }

    // For confirm-type dialogs, map __confirm__ marker to backend-recognized value
    const resolvedInput = isConfirmAction ? '__confirm__' : isCancelAction ? '__cancel__' : input

    setSubmitting(true)
    setError('')
    try {
      await resolveIntervention({
        input: resolvedInput,
        agentName: payload.agentName,
        ownerId: payload.ownerId,
        requestId: payload.requestId,
      })
      forceClose()
      addToast({
        tone: 'success',
        title: '已提交输入',
        detail: '任务会继续执行。',
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return {
    payload,
    value,
    error,
    submitting,
    setValue,
    open,
    close,
    submit,
  }
}
