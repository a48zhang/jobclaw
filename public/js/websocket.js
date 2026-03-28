/**
 * WebSocket 连接管理
 */

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  window.appState.ws = new WebSocket(`${proto}://${location.host}/ws`)

  window.appState.ws.addEventListener('open', () => {
    setWsStatus(true)
    if (window.appState.reconnectTimer) {
      clearInterval(window.appState.reconnectTimer)
      window.appState.reconnectTimer = null
    }
    clearQueueStatus()
    window.appState.reconnectCountdown = 0
    // 仅在页面首次加载时补历史，避免重连后覆盖当前可见上下文。
    if (!hasVisibleChatHistory()) {
      loadSessionHistory()
    }
  })

  window.appState.ws.addEventListener('message', (ev) => {
    try {
      const { event, data } = JSON.parse(ev.data)
      handleWsEvent(event, data)
    } catch { /* ignore malformed */ }
  })

  window.appState.ws.addEventListener('close', () => {
    setWsStatus(false)
    clearQueueStatus()
    scheduleReconnect()
  })

  window.appState.ws.addEventListener('error', () => {
    window.appState.ws.close()
  })
}

function setWsStatus(connected) {
  const dot = document.getElementById('ws-dot')
  const label = document.getElementById('ws-status')
  dot.className = 'ws-dot ' + (connected ? 'ws-connected' : 'ws-disconnected')
  label.textContent = connected ? '已连接' : '连接断开'
}

function scheduleReconnect() {
  const label = document.getElementById('ws-status')
  if (window.appState.reconnectTimer) {
    clearInterval(window.appState.reconnectTimer)
  }
  window.appState.reconnectCountdown = 3
  if (label) label.textContent = `连接断开，${window.appState.reconnectCountdown}s 后重试`

  const timer = setInterval(() => {
    window.appState.reconnectCountdown -= 1
    if (window.appState.reconnectCountdown <= 0) {
      clearInterval(timer)
      window.appState.reconnectTimer = null
      connectWS()
      return
    }
    if (label) label.textContent = `连接断开，${window.appState.reconnectCountdown}s 后重试`
  }, 1000)

  window.appState.reconnectTimer = timer
}

function clearQueueStatus() {
  if (typeof window.setQueueStatus === 'function') {
    window.setQueueStatus(null)
  }
}

function hasVisibleChatHistory() {
  const chatHistory = document.getElementById('chat-history')
  return Boolean(chatHistory?.querySelector('.msg'))
}

function normalizeAgentState(state) {
  if (state === 'waiting_input') return 'waiting'
  return state
}

function getAgentStateLabel(state) {
  const labels = {
    idle: '空闲',
    running: '执行中',
    waiting: '等待输入',
    error: '异常',
  }
  return labels[state] || String(state || 'unknown')
}

function handleWsEvent(event, data) {
  switch (event) {
    case 'snapshot':
      if (Array.isArray(data)) data.forEach(d => updateAgentState(d))
      break
    case 'agent:stream':
      setQueueStatus(null)
      appendStreamingChunk(data)
      break
    case 'agent:tool':
      appendAgentLog({ type: 'info', message: `[${data.toolType}] ${data.message}`, agentName: data.agentName })
      if (typeof window.addToolLogEntry === 'function') {
        window.addToolLogEntry({
          type: data.toolType === 'tool_output' ? 'info' : 'warn',
          message: `[${data.toolType}] ${data.message}`,
          agentName: data.agentName,
          timestamp: data.timestamp,
        })
      }
      break
    case 'agent:state':
      updateAgentState(data)
      break
    case 'agent:log':
      appendAgentLog(data)
      break
    case 'job:updated':
      if (data?.status === 'resume_ready') {
        showResumeReady('/workspace/output/resume.pdf')
      }
      fetchJobs()
      break
    case 'context:usage':
      updateTokenUsage(data)
      break
    case 'intervention:required':
      showModal(data)
      break
    case 'intervention:resolved':
      hideModal()
      break
  }
}

function updateAgentState({ agentName, state }) {
  window.appState.agentStates[agentName] = normalizeAgentState(state)
  renderAgentCards()
}

function renderAgentCards() {
  const container = document.getElementById('agent-states')
  if (!container) return
  const stateColors = {
    idle:    'bg-slate-700 text-slate-300 border-slate-600',
    running: 'bg-blue-900/50 text-blue-300 border-blue-700',
    waiting: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    error:   'bg-red-900/50 text-red-300 border-red-700',
  }
  const cards = Object.entries(window.appState.agentStates).map(([name, state]) => `
    <div class="flex items-center gap-2 px-2.5 py-1 rounded border ${stateColors[state] ?? 'bg-slate-700 text-slate-300 border-slate-600'}">
      <span class="font-bold text-xs">${escHtml(name)}</span>
      <span class="text-[10px] uppercase tracking-wider opacity-80">${escHtml(getAgentStateLabel(state))}</span>
    </div>
  `).join('')
  container.innerHTML = cards
  container.classList.toggle('hidden', cards.length === 0)
}

function updateTokenUsage({ tokenCount }) {
  const container = document.getElementById('agent-states')
  if (!container) return
  const badge = document.getElementById('token-usage')
  if (badge) {
    badge.textContent = `${tokenCount.toLocaleString()} tokens`
    return
  }
  const span = document.createElement('span')
  span.id = 'token-usage'
  span.className = 'text-slate-500 text-xs'
  span.textContent = `${tokenCount.toLocaleString()} tokens`
  container.appendChild(span)
}

// 加载历史 session 消息
async function loadSessionHistory() {
  try {
    const res = await fetch('/api/session/main')
    const json = await res.json()
    if (json.ok && Array.isArray(json.messages)) {
      const chatHistory = document.getElementById('chat-history')
      if (!chatHistory || hasVisibleChatHistory()) {
        return
      }
      // 清空现有历史
      chatHistory.innerHTML = '<div class="text-center text-slate-500 text-xs my-4">--- 历史消息已加载 ---</div>'
      
      // 显示历史消息
      for (const msg of json.messages) {
        if (msg.role === 'user') {
          appendUserMessage(msg.content || '')
        } else if (msg.role === 'assistant') {
          // 处理 assistant 消息
          if (msg.content) {
            appendAgentLog({ type: 'info', message: msg.content, agentName: 'Agent' })
          }
          // 处理工具调用（兼容旧数据）
          if (Array.isArray(msg.toolCalls)) {
            for (const tc of msg.toolCalls) {
              if (tc.name === 'respond' && tc.args) {
                try {
                  const args = JSON.parse(tc.args)
                  if (args.message) {
                    appendAgentLog({ type: 'info', message: args.message, agentName: 'Agent' })
                  }
                } catch { /* ignore */ }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('加载历史消息失败:', err)
  }
}

// 导出到全局
window.connectWS = connectWS
window.setWsStatus = setWsStatus
window.handleWsEvent = handleWsEvent
window.updateAgentState = updateAgentState
window.renderAgentCards = renderAgentCards
window.loadSessionHistory = loadSessionHistory
window.updateTokenUsage = updateTokenUsage
