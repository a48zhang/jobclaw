import { useEffectEvent } from 'react'
import { useRealtimeConnection } from '@/hooks/useRealtimeConnection'

export function useAppRealtime(options: {
  chat: {
    onWsEvent: (event: string, data: unknown) => void
    loadHistory: () => void | Promise<void>
  }
  jobs: {
    onWsEvent: (event: string) => void
  }
  resume: {
    onWsEvent: (event: string, data: unknown) => void
  }
  interventionDialog: {
    open: (payload: any) => void
    close: () => void
  }
}) {
  const handleRealtimeEvent = useEffectEvent((event: string, data: unknown) => {
    options.chat.onWsEvent(event, data)
    options.jobs.onWsEvent(event)
    options.resume.onWsEvent(event, data)

    if (event === 'intervention:required') {
      options.interventionDialog.open(data)
    }

    if (event === 'intervention:resolved') {
      options.interventionDialog.close()
    }
  })

  const connection = useRealtimeConnection({
    onEvent: handleRealtimeEvent,
    onOpen: options.chat.loadHistory,
  })

  return {
    connection,
    handleRealtimeEvent,
  }
}
