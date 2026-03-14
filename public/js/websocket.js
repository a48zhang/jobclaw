/**
 * WebSocket 连接管理
 */

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  window.appState.ws = new WebSocket(`${proto}://${location.host}/ws`)

  window.appState.ws.addEventListener('open', () => {
    setWsStatus(true)
    clearTimeout(window.appState.reconnectTimer)
    // 加载历史消息
    loadSessionHistory()
  })

  window.appState.ws.addEventListener('message', (ev) => {
    try {
      const { event, data } = JSON.parse(ev.data)
      handleWsEvent(event, data)
    } catch { /* ignore malformed */ }
  })

  window.appState.ws.addEventListener('close', () => {
    setWsStatus(false)
    window.appState.reconnectTimer = setTimeout(connectWS, 3000)
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

function handleWsEvent(event, data) {
  switch (event) {
    case 'snapshot':
      if (Array.isArray(data)) data.forEach(d => updateAgentState(d))
      break
    case 'agent:state':
      updateAgentState(data)
      break
    case 'agent:log':
      appendAgentLog(data)
      break
    case 'job:updated':
      fetchJobs()
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
  window.appState.agentStates[agentName] = state
  renderAgentCards()
}

function renderAgentCards() {
  const container = document.getElementById('agent-states')
  const stateColors = {
    idle:    'bg-slate-700 text-slate-300 border-slate-600',
    running: 'bg-blue-900/50 text-blue-300 border-blue-700',
    waiting: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    error:   'bg-red-900/50 text-red-300 border-red-700',
  }
  container.innerHTML = Object.entries(window.appState.agentStates).map(([name, state]) => `
    <div class="flex items-center gap-2 px-2.5 py-1 rounded border ${stateColors[state] ?? 'bg-slate-700 text-slate-300 border-slate-600'}">
      <span class="font-bold text-xs">${escHtml(name)}</span>
      <span class="text-[10px] uppercase tracking-wider opacity-80">${escHtml(state)}</span>
    </div>
  `).join('') || '<span class="text-slate-500 text-xs">暂无 Agent</span>'
}

// 加载历史 session 消息
async function loadSessionHistory() {
  try {
    const res = await fetch('/api/session/main')
    const json = await res.json()
    if (json.ok && Array.isArray(json.messages)) {
      // 清空现有历史
      const chatHistory = document.getElementById('chat-history')
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
