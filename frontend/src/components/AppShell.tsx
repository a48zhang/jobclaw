import type { ReactNode } from 'react'
import type { TabId } from '@/types'

const NAV_ITEMS: Array<{ id: TabId; label: string }> = [
  { id: 'tab-chat', label: '对话' },
  { id: 'tab-jobs', label: '职位' },
  { id: 'tab-config', label: '配置' },
  { id: 'tab-resume', label: '简历' },
]

function findNextTab(current: TabId, offset: number): TabId {
  const currentIndex = NAV_ITEMS.findIndex((item) => item.id === current)
  const nextIndex = (currentIndex + offset + NAV_ITEMS.length) % NAV_ITEMS.length
  return NAV_ITEMS[nextIndex]?.id || current
}

export function AppShell(props: {
  activeTab: TabId
  onTabChange: (tabId: TabId) => void
  connected: boolean
  reconnectCountdown: number
  children: ReactNode
}) {
  return (
    <div className="app-shell">
      <a href="#app-main" className="skip-link">
        跳转到主内容
      </a>
      <header className="topbar" role="banner">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">J</div>
          <div>
            <h1>JobClaw</h1>
          </div>
        </div>
        <nav aria-label="主导航" className="tab-nav">
          <div role="tablist" aria-orientation="horizontal">
            {NAV_ITEMS.map((item) => {
              const selected = props.activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`tab-trigger${selected ? ' is-active' : ''}`}
                  data-target={item.id}
                  role="tab"
                  aria-controls={item.id}
                  aria-selected={selected ? 'true' : 'false'}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => props.onTabChange(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault()
                      props.onTabChange(findNextTab(props.activeTab, 1))
                    }
                    if (event.key === 'ArrowLeft') {
                      event.preventDefault()
                      props.onTabChange(findNextTab(props.activeTab, -1))
                    }
                    if (event.key === 'Home') {
                      event.preventDefault()
                      props.onTabChange(NAV_ITEMS[0].id)
                    }
                    if (event.key === 'End') {
                      event.preventDefault()
                      props.onTabChange(NAV_ITEMS[NAV_ITEMS.length - 1].id)
                    }
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </nav>
        <div className={`connection-chip${props.connected ? ' is-connected' : ''}`} aria-live="polite">
          <span className="connection-dot" aria-hidden="true" />
          <span id="ws-status">
            {props.connected
              ? '连接正常'
              : props.reconnectCountdown > 0
                ? `${props.reconnectCountdown}s 后重连`
                : '连接中断'}
          </span>
        </div>
      </header>
      <main id="app-main" className="app-main">
        {props.children}
      </main>
    </div>
  )
}
