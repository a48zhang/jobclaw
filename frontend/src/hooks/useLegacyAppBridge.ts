import { useEffect } from 'react'
import type { InterventionPayload, TabId } from '@/types'

export function useLegacyAppBridge(options: {
  handleRealtimeEvent: (event: string, data: unknown) => void
  openIntervention: (payload: InterventionPayload) => void
  closeIntervention: () => void
  setActiveTab: (tabId: TabId) => void
}) {
  useEffect(() => {
    window.handleWsEvent = options.handleRealtimeEvent
    window.showModal = options.openIntervention
    window.hideModal = options.closeIntervention
    window.showTab = options.setActiveTab

    return () => {
      window.handleWsEvent = undefined
      window.showModal = undefined
      window.hideModal = undefined
      window.showTab = undefined
    }
  }, [options])
}
