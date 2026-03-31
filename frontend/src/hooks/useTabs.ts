import { useEffect, useState } from 'react'
import type { TabId } from '@/types'

function readInitialTab(defaultTab: TabId) {
  const fromHash = window.location.hash.replace('#', '')
  if (fromHash === 'tab-chat' || fromHash === 'tab-jobs' || fromHash === 'tab-config' || fromHash === 'tab-resume') {
    return fromHash
  }
  return defaultTab
}

export function useTabs(defaultTab: TabId) {
  const [activeTab, setActiveTab] = useState<TabId>(() => readInitialTab(defaultTab))

  useEffect(() => {
    window.history.replaceState(null, '', `#${activeTab}`)
  }, [activeTab])

  return { activeTab, setActiveTab }
}
