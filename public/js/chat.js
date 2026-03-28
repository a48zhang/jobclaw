/**
 * 聊天功能
 */

const chatHistory = document.getElementById('chat-history')
const chatInput = document.getElementById('chat-input')
const chatSend = document.getElementById('chat-send')
const CHAT_TASK_STATE = {
  IDLE: 'idle',
  BLOCKED: 'blocked',
  SUBMITTING: 'submitting',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

const CHAT_HINTS = [
  { text: '/new 重新开始会话', tone: 'info' },
  { text: '/clear 清空会话历史', tone: 'info' },
  { text: 'run search 搜索目标职位', tone: 'info' },
]

const CHAT_STATE_METADATA = {
  idle: {
    label: '等待指令',
    detail: '主 Agent 准备接收你的指令。',
    pill: 'bg-slate-800 text-slate-300 border border-slate-700',
  },
  blocked: {
    label: '功能受限',
    detail: '请先完成基础设置，主任务才会继续。',
    pill: 'bg-amber-900 text-amber-200 border border-amber-700',
  },
  submitting: {
    label: '提交中',
    detail: '消息正在提交，等待 Agent 响应。',
    pill: 'bg-blue-900 text-blue-200 border border-blue-700',
  },
  queued: {
    label: '排队中',
    detail: '当前请求已入队，稍等片刻。',
    pill: 'bg-blue-800 text-blue-100 border border-blue-600',
  },
  running: {
    label: '执行中',
    detail: 'Agent 正在执行任务，生成回复中。',
    pill: 'bg-blue-900 text-blue-100 border border-blue-600',
  },
  completed: {
    label: '已完成',
    detail: 'Agent 已生成最新回复，可以继续提问。',
    pill: 'bg-emerald-900 text-emerald-200 border border-emerald-600',
  },
  failed: {
    label: '失败',
    detail: '请求异常，请检查网络或重新发送。',
    pill: 'bg-rose-900 text-rose-200 border border-rose-600',
  },
}

const CHAT_INPUT_PLACEHOLDER = '试试“run search”保留主任务路径（Enter 发送，Shift+Enter 换行）'

let chatStatusCard = null
let chatStatusPill = null
let chatStatusDetail = null
let chatQueueNote = null

function ensureChatStatusCard() {
  if (chatStatusCard) return chatStatusCard
  const container = document.querySelector('#tab-chat .bg-slate-800.rounded-xl')
  if (!container) return null

  const card = document.createElement('div')
  card.id = 'chat-status-card'
  card.className = 'mb-3 rounded-xl border border-slate-700 bg-slate-900/80 p-4 shadow-inner flex flex-col gap-3'

  const header = document.createElement('div')
  header.className = 'flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between'

  const labelBlock = document.createElement('div')
  const title = document.createElement('p')
  title.className = 'text-xs font-semibold uppercase tracking-wider text-slate-400'
  title.textContent = '主任务状态'

  chatStatusPill = document.createElement('span')
  chatStatusPill.id = 'chat-status-pill'
  chatStatusPill.className = `inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${CHAT_STATE_METADATA.idle.pill}`
  chatStatusPill.textContent = CHAT_STATE_METADATA.idle.label

  const statusRow = document.createElement('div')
  statusRow.className = 'mt-1 flex flex-wrap items-center gap-3'
  statusRow.appendChild(chatStatusPill)

  chatStatusDetail = document.createElement('p')
  chatStatusDetail.id = 'chat-status-detail'
  chatStatusDetail.className = 'text-xs text-slate-300'
  chatStatusDetail.textContent = CHAT_STATE_METADATA.idle.detail
  statusRow.appendChild(chatStatusDetail)

  labelBlock.appendChild(title)
  labelBlock.appendChild(statusRow)
  header.appendChild(labelBlock)

  chatQueueNote = document.createElement('p')
  chatQueueNote.id = 'chat-status-queue'
  chatQueueNote.className = 'text-xs text-slate-200 lg:text-right lg:ml-4 hidden'
  chatQueueNote.textContent = ''
  header.appendChild(chatQueueNote)

  card.appendChild(header)

  const welcome = document.createElement('p')
  welcome.id = 'chat-status-welcome'
  welcome.className = 'text-xs text-slate-500'
  welcome.textContent = '欢迎回来，主 Agent 正在守护你的求职主路径。'
  card.appendChild(welcome)

  const hintWrapper = document.createElement('div')
  hintWrapper.id = 'chat-status-hints'
  hintWrapper.className = 'flex flex-wrap gap-2 text-xs text-slate-400'
  for (const hint of CHAT_HINTS) {
    const chip = document.createElement('span')
    chip.className = 'hint-chip'
    chip.textContent = hint.text
    hintWrapper.appendChild(chip)
  }
  card.appendChild(hintWrapper)

  const firstBanner = document.getElementById('first-run-banner')
  if (firstBanner?.parentElement === container) {
    container.insertBefore(card, firstBanner)
  } else if (container.firstChild) {
    container.insertBefore(card, container.firstChild)
  } else {
    container.appendChild(card)
  }

  chatStatusCard = card
  setUnifiedPlaceholder()
  ensureApplyFeatureWrapper()
  return card
}

function setUnifiedPlaceholder() {
  if (!chatInput) return
  chatInput.placeholder = CHAT_INPUT_PLACEHOLDER
}

function ensureApplyFeatureWrapper() {
  if (!window.applyFeatureAvailability || window.applyFeatureAvailability.__chatWrapped) return
  const original = window.applyFeatureAvailability
  window.applyFeatureAvailability = function wrappedApplyFeatureAvailability(...args) {
    const result = original.apply(this, args)
    setUnifiedPlaceholder()
    return result
  }
  window.applyFeatureAvailability.__chatWrapped = true
}

function renderChatStatus(state = window.appState.chatTask.state, detailMessage = window.appState.chatTask.message) {
  const card = ensureChatStatusCard()
  if (!card || !chatStatusPill || !chatStatusDetail) return
  const key = state && CHAT_STATE_METADATA[state] ? state : 'idle'
  const meta = CHAT_STATE_METADATA[key]
  chatStatusPill.textContent = detailMessage ? meta.label : meta.label
  chatStatusPill.className = `inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${meta.pill}`
  chatStatusDetail.textContent = detailMessage || meta.detail
}

function bootstrapChatStatusCard() {
  ensureChatStatusCard()
  ensureApplyFeatureWrapper()
  renderChatStatus(CHAT_TASK_STATE.IDLE, CHAT_STATE_METADATA.idle.detail)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapChatStatusCard)
} else {
  bootstrapChatStatusCard()
}

function internalizeQueueNote(info) {
  if (!chatQueueNote) return
  if (!info) {
    chatQueueNote.classList.add('hidden')
    chatQueueNote.textContent = ''
    return
  }
  chatQueueNote.classList.remove('hidden')
  chatQueueNote.textContent = info.message
}

function setQueueStatus(info) {
  const el = document.getElementById('queue-status')
  if (!el) return
  ensureChatStatusCard()
  if (!info) {
    el.classList.add('hidden')
    el.textContent = ''
    window.appState.queueInfo = null
    internalizeQueueNote(null)
    return
  }
  window.appState.queueInfo = info
  el.classList.remove('hidden')
  el.textContent = info.message
  internalizeQueueNote(info)
  renderChatStatus(window.appState.chatTask.state, info.message || window.appState.chatTask.message)
}

function setChatTaskState(state, message = '') {
  window.appState.chatTask = {
    state,
    message,
    updatedAt: new Date().toISOString(),
  }
  renderChatStatus(state, message)
}

function createMessageMeta(ts, agent) {
  if (!ts && !agent) return ''
  return `<div class="msg-meta">${[ts, agent].filter(Boolean).join(' ')}</div>`
}

function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    marked.setOptions({ breaks: true, gfm: true })
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

function appendAssistantMessage(message, agentName = 'Agent') {
  appendAgentLog({
    type: 'info',
    message,
    agentName,
  })
}

function appendStreamingChunk({ agentName, chunk, isFirst, isFinal }) {
  if (!chunk && !isFinal && !isFirst) return

  const state = window.appState.streamingState
  const ts = new Date().toLocaleTimeString()
  const agent = agentName ? `[${agentName}]` : ''

  if (isFirst || !state.active || !state.messageId) {
    setChatTaskState(CHAT_TASK_STATE.RUNNING, 'Agent 正在生成回复...')
    setQueueStatus({ message: 'Agent 正在生成回复...' })

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
    const target = [...chatHistory.querySelectorAll('.msg')].reverse().find((el) => el.dataset.streamId === state.messageId)
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
    const target = [...chatHistory.querySelectorAll('.msg')].reverse().find((el) => el.dataset.streamId === window.appState.streamingState.messageId)
    if (target) {
      const indicator = target.querySelector('.streaming-indicator')
      if (indicator) indicator.remove()
    }
    window.appState.streamingState = { active: false, messageId: null }
    setQueueStatus(null)
    setChatTaskState(CHAT_TASK_STATE.COMPLETED, '回复已完成')
  }
  scrollToBottom()
}

function scrollToBottom() {
  chatHistory.scrollTop = chatHistory.scrollHeight
}

function redirectToSettings() {
  const configTabBtn = document.querySelector('[data-target="tab-config"]')
  if (configTabBtn) configTabBtn.click()
}

async function sendChatMessage() {
  if (!window.appState.appReady) {
    const message = `当前仍缺少基础配置：${window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}。请先到“工作区配置”页完成设置。`
    setChatTaskState(CHAT_TASK_STATE.BLOCKED, message)
    appendAgentLog({
      type: 'warn',
      message,
      agentName: 'System',
    })
    return
  }

  const text = chatInput.value.trim()
  if (!text) return

  appendUserMessage(text)
  setChatTaskState(CHAT_TASK_STATE.SUBMITTING, '消息提交中...')
  setQueueStatus({ message: '消息提交中...' })

  chatInput.value = ''
  chatInput.focus()
  chatSend.disabled = true
  chatSend.classList.add('opacity-50', 'cursor-not-allowed')

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    const data = await res.json()

    if (!data.ok) {
      const reason = '发送失败: ' + (data.error || '未知错误')
      setChatTaskState(CHAT_TASK_STATE.FAILED, reason)
      setQueueStatus({ message: reason })
      appendAgentLog({ type: 'error', message: reason, agentName: 'System' })
      if (res.status === 409) {
        window.appState.appReady = false
        window.appState.missingFields = data.missingFields || []
        if (typeof window.applyFeatureAvailability === 'function') window.applyFeatureAvailability()
        appendAgentLog({
          type: 'warn',
          message: '基础配置不完整，聊天与简历功能已暂时禁用。你可以稍后手动切换到“工作区配置”页继续。',
          agentName: 'System',
        })
        if (typeof window.refreshFirstRunBanner === 'function') window.refreshFirstRunBanner()
      }
    } else if (data.queued) {
      const waiting = Math.max(0, (data.queueLength ?? 1) - 1)
      const queuedMessage = waiting > 0 ? `消息已入队，前面还有 ${waiting} 条等待处理` : '消息已入队，等待处理'
      setChatTaskState(CHAT_TASK_STATE.QUEUED, queuedMessage)
      setQueueStatus({ message: queuedMessage })
    } else {
      setQueueStatus(null)
      setChatTaskState(CHAT_TASK_STATE.COMPLETED, '回复已完成')
      if (typeof data.message === 'string' && data.message.trim()) {
        appendAssistantMessage(data.message, 'Agent')
      } else {
        appendAgentLog({
          type: 'warn',
          message: '服务端已处理请求，但没有返回可展示的消息。',
          agentName: 'System',
        })
      }
    }
  } catch (err) {
    const msg = err && err.message ? err.message : '未知错误'
    const reason = `网络错误：${msg}。请检查服务是否在运行。`
    setChatTaskState(CHAT_TASK_STATE.FAILED, reason)
    setQueueStatus({ message: reason })
    appendAgentLog({ type: 'error', message: reason, agentName: 'System' })
  } finally {
    chatSend.disabled = !window.appState.appReady
    chatSend.classList.toggle('opacity-50', !window.appState.appReady)
    chatSend.classList.toggle('cursor-not-allowed', !window.appState.appReady)
  }
}

chatSend.addEventListener('click', sendChatMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage()
  }
})

window.appendUserMessage = appendUserMessage
window.appendAgentLog = appendAgentLog
window.scrollToBottom = scrollToBottom
window.appendStreamingChunk = appendStreamingChunk
window.setQueueStatus = setQueueStatus
window.setChatTaskState = setChatTaskState

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
