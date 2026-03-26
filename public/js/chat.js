/**
 * 聊天功能
 */

const chatHistory = document.getElementById('chat-history')
const chatInput = document.getElementById('chat-input')
const chatSend = document.getElementById('chat-send')

function setQueueStatus(info) {
  const el = document.getElementById('queue-status')
  if (!el) return
  if (!info) {
    el.classList.add('hidden')
    el.textContent = ''
    window.appState.queueInfo = null
    return
  }
  window.appState.queueInfo = info
  el.classList.remove('hidden')
  el.textContent = info.message
}

function createMessageMeta(ts, agent) {
  if (!ts && !agent) return ''
  return `<div class="msg-meta">${[ts, agent].filter(Boolean).join(' ')}</div>`
}

function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    marked.setOptions({
      breaks: true,
      gfm: true
    })
    const raw = marked.parse(String(text || ''))
    return DOMPurify.sanitize(raw)
  }
  return escHtml(text)
}

function appendUserMessage(text) {
  const div = document.createElement('div')
  div.className = 'msg msg-user'
  div.innerHTML = `<div class="msg-body">${renderMarkdown(text)}</div>`
  chatHistory.appendChild(div)
  scrollToBottom()
}

function appendAgentLog({ type, level, message, timestamp, agentName }) {
  const logType = type ?? level ?? 'info'
  const ts = timestamp ? new Date(timestamp).toLocaleTimeString() : ''
  const agent = agentName ? `[${agentName}]` : ''
  const div = document.createElement('div')
  div.className = `msg msg-agent ${logType}`
  div.innerHTML = `${createMessageMeta(ts, agent)}<div class="msg-body">${renderMarkdown(message)}</div>`
  chatHistory.appendChild(div)
  scrollToBottom()
}

function appendStreamingChunk({ agentName, chunk, isFirst, isFinal }) {
  if (!chunk && !isFinal && !isFirst) return

  const state = window.appState.streamingState
  const ts = new Date().toLocaleTimeString()
  const agent = agentName ? `[${agentName}]` : ''

  if (isFirst || !state.active || !state.messageId) {
    const div = document.createElement('div')
    div.className = 'msg msg-agent info'
    const body = document.createElement('div')
    body.className = 'msg-body'
    body.dataset.raw = chunk || ''
    body.innerHTML = renderMarkdown(chunk || '')
    const meta = document.createElement('div')
    meta.className = 'msg-meta'
    meta.textContent = `${ts} ${agent}`
    const indicator = document.createElement('div')
    indicator.className = 'streaming-indicator'
    indicator.textContent = '生成中'
    div.appendChild(meta)
    div.appendChild(body)
    div.appendChild(indicator)
    chatHistory.appendChild(div)
    const messageId = Date.now().toString()
    window.appState.streamingState = { active: true, messageId }
    div.dataset.streamId = messageId
  } else {
    const target = [...chatHistory.querySelectorAll('.msg')].reverse().find(el => el.dataset.streamId === state.messageId)
    if (target) {
      const body = target.querySelector('.msg-body')
      if (body) {
        const raw = (body.dataset.raw || '') + (chunk || '')
        body.dataset.raw = raw
        body.innerHTML = renderMarkdown(raw)
      }
    }
  }

  if (isFinal) {
    const target = [...chatHistory.querySelectorAll('.msg')].reverse().find(el => el.dataset.streamId === window.appState.streamingState.messageId)
    if (target) {
      const indicator = target.querySelector('.streaming-indicator')
      if (indicator) indicator.remove()
    }
    window.appState.streamingState = { active: false, messageId: null }
  }
  scrollToBottom()
}

function scrollToBottom() {
  chatHistory.scrollTop = chatHistory.scrollHeight
}

async function sendChatMessage() {
  const text = chatInput.value.trim()
  if (!text) return
  
  chatInput.value = ''
  chatInput.focus()
  chatSend.disabled = true
  chatSend.classList.add('opacity-50', 'cursor-not-allowed')
  
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    })
    const data = await res.json()
    
  if (!data.ok) {
      appendAgentLog({ type: 'error', message: '发送失败: ' + (data.error || '未知错误') })
    } else if (data.queued) {
      // 普通消息已入队，显示用户消息
      appendUserMessage(text)
      const waiting = Math.max(0, (data.queueLength ?? 1) - 1)
      setQueueStatus({ message: waiting > 0 ? `消息已入队，前面还有 ${waiting} 条等待处理` : '消息已入队，等待处理' })
    } else {
      // 命令执行完成，清空历史并显示结果
      chatHistory.innerHTML = ''
      appendAgentLog({ type: 'info', message: data.message })
    }
  } catch (err) {
    const msg = err && err.message ? err.message : '未知错误'
    appendAgentLog({ type: 'error', message: `网络错误：${msg}。请检查服务是否在运行。` })
  } finally {
    chatSend.disabled = false
    chatSend.classList.remove('opacity-50', 'cursor-not-allowed')
  }
}

// 事件绑定
chatSend.addEventListener('click', sendChatMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage()
  }
})

// 导出到全局
window.appendUserMessage = appendUserMessage
window.appendAgentLog = appendAgentLog
window.scrollToBottom = scrollToBottom
window.appendStreamingChunk = appendStreamingChunk
window.setQueueStatus = setQueueStatus

function addToolLogEntry({ type, message, agentName, timestamp }) {
  const list = document.getElementById('tool-log-list')
  if (!list) return
  const item = document.createElement('div')
  const logType = type ?? 'info'
  item.className = `log-item ${logType}`
  const ts = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()
  const agent = agentName ? `[${agentName}]` : ''
  item.textContent = `${ts} ${agent} ${message}`
  list.prepend(item)
}

function initToolLogPanel() {
  const panel = document.getElementById('tool-log-panel')
  if (!panel) return
  const toggle = document.getElementById('log-toggle')
  const clear = document.getElementById('log-clear')
  if (toggle) {
    toggle.addEventListener('click', () => {
      panel.classList.toggle('log-collapsed')
      toggle.textContent = panel.classList.contains('log-collapsed') ? '展开' : '收起'
    })
  }
  if (clear) {
    clear.addEventListener('click', () => {
      const list = document.getElementById('tool-log-list')
      if (list) list.innerHTML = ''
    })
  }
}

initToolLogPanel()
window.addToolLogEntry = addToolLogEntry
