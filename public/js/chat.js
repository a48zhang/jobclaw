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

const CHAT_STATE_METADATA = {
  idle: {
    label: '等待指令',
    detail: '主 Agent 准备接收你的指令。',
    tone: 'text-slate-300',
  },
  blocked: {
    label: '功能受限',
    detail: '请先完成基础设置，主任务才会继续。',
    tone: 'text-amber-300',
  },
  submitting: {
    label: '提交中',
    detail: '消息正在提交，等待 Agent 响应。',
    tone: 'text-sky-300',
  },
  queued: {
    label: '排队中',
    detail: '当前请求已入队，稍等片刻。',
    tone: 'text-sky-300',
  },
  running: {
    label: '执行中',
    detail: 'Agent 正在执行任务，生成回复中。',
    tone: 'text-sky-300',
  },
  completed: {
    label: '已完成',
    detail: 'Agent 已生成最新回复，可以继续提问。',
    tone: 'text-emerald-300',
  },
  failed: {
    label: '失败',
    detail: '请求异常，请检查网络或重新发送。',
    tone: 'text-rose-300',
  },
}

const CHAT_INPUT_PLACEHOLDER = '试试“run search”保留主任务路径（Enter 发送，Shift+Enter 换行）'
const CHAT_INPUT_MIN_HEIGHT = 56
const CHAT_INPUT_MAX_HEIGHT = 164

let chatRuntimeStatus = null
let chatRuntimeBoard = null
let runtimeWorkboardTimer = null
let runtimeWorkboardPoller = null
let runtimeWorkboardInFlight = false
let runtimeWorkboardQueued = false

const RUNTIME_STATUS_TONES = {
  running: 'text-sky-300',
  waiting: 'text-amber-300',
  failed: 'text-rose-300',
  completed: 'text-emerald-300',
  queued: 'text-slate-300',
  idle: 'text-slate-300',
}

function ensureChatStatusCard() {
  if (chatRuntimeStatus) return chatRuntimeStatus
  const container = document.getElementById('chat-status-slot') || document.querySelector('#tab-chat .chat-container')
  if (!container) return null

  const legacyCard = document.getElementById('chat-status-card')
  if (legacyCard) legacyCard.remove()

  const wrapper = document.createElement('div')
  wrapper.className = 'runtime-status-stack'
  const statusLine = document.createElement('p')
  statusLine.id = 'chat-runtime-status'
  statusLine.className = 'text-xs text-slate-300'
  statusLine.textContent = `${CHAT_STATE_METADATA.idle.label}：${CHAT_STATE_METADATA.idle.detail}`
  wrapper.appendChild(statusLine)
  container.replaceChildren(wrapper)

  chatRuntimeStatus = statusLine
  setUnifiedPlaceholder()
  ensureApplyFeatureWrapper()
  ensureRuntimeWorkboard()
  return statusLine
}

function formatTimestampLabel(value) {
  if (!value) return '刚刚'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '刚刚'
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function renderRuntimeList(items, emptyMessage, formatter) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<li class="runtime-inline-empty">${escHtml(emptyMessage)}</li>`
  }
  return items.map(formatter).join('')
}

function renderRuntimeTaskList(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return `
      <div class="runtime-task-empty">
        <p class="text-sm text-slate-300">当前没有活动中的结构化任务。</p>
        <p class="text-xs text-slate-500">继续在聊天区下达任务后，这里会显示当前运行、等待输入和最近完成的任务。</p>
      </div>
    `
  }

  return tasks.slice(0, 4).map((task) => {
    const tone = RUNTIME_STATUS_TONES[task.state] || 'text-slate-300'
    const reason = task.nextAction?.reason || task.resultSummary || task.summary || '暂无更多说明'
    return `
      <article class="runtime-task-item">
        <div class="runtime-task-head">
          <div class="min-w-0">
            <p class="runtime-task-title">${escHtml(task.title || task.id)}</p>
            <p class="runtime-task-meta">${escHtml(task.profile || 'main')} · ${escHtml(task.statusLabel || task.state || 'unknown')}</p>
          </div>
          <span class="runtime-task-badge ${tone}">${escHtml(task.state || 'idle')}</span>
        </div>
        <p class="runtime-task-summary">${escHtml(reason)}</p>
      </article>
    `
  }).join('')
}

function ensureRuntimeWorkboard() {
  if (chatRuntimeBoard) return chatRuntimeBoard
  const statusLine = ensureChatStatusCard()
  if (!statusLine) return null
  const container = statusLine.parentElement
  if (!container) return null

  const board = document.createElement('section')
  board.id = 'runtime-workboard'
  board.className = 'runtime-workboard'
  board.setAttribute('aria-live', 'polite')
  board.innerHTML = `
    <div class="runtime-workboard-head">
      <div class="min-w-0">
        <p class="runtime-workboard-kicker">任务视图</p>
        <h4 class="runtime-workboard-title">当前自动化状态</h4>
      </div>
      <div class="runtime-workboard-actions">
        <span id="runtime-workboard-generated" class="runtime-generated-at">尚未加载</span>
        <button id="runtime-workboard-refresh" type="button" class="runtime-refresh-btn">刷新</button>
      </div>
    </div>
    <div class="runtime-workboard-grid">
      <section class="runtime-focus-card">
        <p class="runtime-card-kicker">当前焦点</p>
        <h5 id="runtime-focus-title" class="runtime-focus-title">正在读取任务状态…</h5>
        <p id="runtime-focus-summary" class="runtime-focus-summary">连接成功后这里会显示当前最需要关注的任务。</p>
      </section>
      <section class="runtime-mini-card">
        <p class="runtime-card-kicker">任务总览</p>
        <div id="runtime-count-strip" class="runtime-count-strip"></div>
      </section>
      <section class="runtime-mini-card">
        <p class="runtime-card-kicker">待授权</p>
        <ul id="runtime-pending-list" class="runtime-list"></ul>
      </section>
      <section class="runtime-mini-card">
        <p class="runtime-card-kicker">最近失败</p>
        <ul id="runtime-failure-list" class="runtime-list"></ul>
      </section>
    </div>
    <section class="runtime-next-step-card">
      <div class="runtime-next-step-head">
        <p class="runtime-card-kicker">建议下一步</p>
        <span id="runtime-next-step-count" class="runtime-next-step-count">0 项</span>
      </div>
      <ol id="runtime-next-step-list" class="runtime-next-step-list"></ol>
    </section>
    <section class="runtime-task-list-card">
      <div class="runtime-next-step-head">
        <p class="runtime-card-kicker">任务队列</p>
        <span id="runtime-task-count" class="runtime-next-step-count">0 项</span>
      </div>
      <div id="runtime-task-list" class="runtime-task-list"></div>
    </section>
  `
  container.appendChild(board)

  const refreshButton = board.querySelector('#runtime-workboard-refresh')
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      refreshRuntimeWorkboard({ force: true })
    })
  }

  chatRuntimeBoard = board
  return board
}

function setUnifiedPlaceholder() {
  if (!chatInput) return
  chatInput.placeholder = CHAT_INPUT_PLACEHOLDER
}

function resizeChatInput() {
  if (!chatInput) return
  chatInput.style.height = 'auto'
  const nextHeight = Math.max(CHAT_INPUT_MIN_HEIGHT, Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT))
  chatInput.style.height = `${nextHeight}px`
  chatInput.style.overflowY = chatInput.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
}

function applyShortcutToInput(command) {
  if (!chatInput || typeof command !== 'string' || !command.trim()) return
  chatInput.value = command
  resizeChatInput()
  chatInput.focus()
  chatInput.setSelectionRange(command.length, command.length)
}

function bindChatShortcuts() {
  document.querySelectorAll('[data-chat-shortcut]').forEach((button) => {
    if (button.dataset.bound === 'true') return
    button.addEventListener('click', () => {
      applyShortcutToInput(button.dataset.chatShortcut || '')
    })
    button.dataset.bound = 'true'
  })
}

function ensureApplyFeatureWrapper() {
  if (!window.applyFeatureAvailability || window.applyFeatureAvailability.__chatWrapped) return
  const original = window.applyFeatureAvailability
  window.applyFeatureAvailability = function wrappedApplyFeatureAvailability(...args) {
    const result = original.apply(this, args)
    setUnifiedPlaceholder()
    resizeChatInput()
    scheduleRuntimeWorkboardRefresh(120)
    return result
  }
  window.applyFeatureAvailability.__chatWrapped = true
}

function renderChatStatus(state = window.appState.chatTask.state, detailMessage = window.appState.chatTask.message) {
  const statusLine = ensureChatStatusCard()
  if (!statusLine) return
  const key = state && CHAT_STATE_METADATA[state] ? state : 'idle'
  const meta = CHAT_STATE_METADATA[key]
  statusLine.textContent = `${meta.label}：${detailMessage || meta.detail}`
  statusLine.className = `text-xs ${meta.tone}`
}

function renderRuntimeWorkboard({ insights, tasks }) {
  const board = ensureRuntimeWorkboard()
  if (!board) return

  const generatedAt = board.querySelector('#runtime-workboard-generated')
  const focusTitle = board.querySelector('#runtime-focus-title')
  const focusSummary = board.querySelector('#runtime-focus-summary')
  const countStrip = board.querySelector('#runtime-count-strip')
  const pendingList = board.querySelector('#runtime-pending-list')
  const failureList = board.querySelector('#runtime-failure-list')
  const nextStepList = board.querySelector('#runtime-next-step-list')
  const nextStepCount = board.querySelector('#runtime-next-step-count')
  const taskCount = board.querySelector('#runtime-task-count')
  const taskList = board.querySelector('#runtime-task-list')

  const safeTasks = Array.isArray(tasks) ? tasks : []
  const counts = {
    running: safeTasks.filter((task) => task.state === 'running').length,
    waiting: safeTasks.filter((task) => task.state === 'waiting').length,
    failed: safeTasks.filter((task) => task.state === 'failed').length,
    completed: safeTasks.filter((task) => task.state === 'completed').length,
  }

  if (generatedAt) generatedAt.textContent = `更新于 ${formatTimestampLabel(insights?.generatedAt)}`
  if (focusTitle) focusTitle.textContent = insights?.currentFocus?.title || '当前没有进行中的核心任务'
  if (focusSummary) {
    focusSummary.textContent =
      insights?.currentFocus?.summary || '发送新任务后，这里会显示当前最需要关注的自动化焦点。'
  }
  if (countStrip) {
    countStrip.innerHTML = `
      <div class="runtime-count-item"><span>执行中</span><strong>${counts.running}</strong></div>
      <div class="runtime-count-item"><span>待输入</span><strong>${counts.waiting}</strong></div>
      <div class="runtime-count-item"><span>失败</span><strong>${counts.failed}</strong></div>
      <div class="runtime-count-item"><span>完成</span><strong>${counts.completed}</strong></div>
    `
  }
  if (pendingList) {
    pendingList.innerHTML = renderRuntimeList(
      insights?.pendingAuthorizations || [],
      '当前没有阻塞任务继续执行的人工输入。',
      (item) => `<li><strong>${escHtml(item.title || item.taskId)}</strong><span>${escHtml(item.prompt || '等待输入')}</span></li>`
    )
  }
  if (failureList) {
    failureList.innerHTML = renderRuntimeList(
      insights?.attentionRequired || [],
      '最近没有新的失败记录。',
      (item) => `<li><strong>${escHtml(item.title || item.id)}</strong><span>${escHtml(item.reason || '无失败摘要')}</span></li>`
    )
  }
  if (nextStepList) {
    const steps = Array.isArray(insights?.nextSteps) ? insights.nextSteps : []
    nextStepList.innerHTML = steps.length
      ? steps.map((step) => `<li>${escHtml(step)}</li>`).join('')
      : '<li class="runtime-inline-empty">当前没有额外建议，继续沿主任务推进即可。</li>'
  }
  if (nextStepCount) nextStepCount.textContent = `${Array.isArray(insights?.nextSteps) ? insights.nextSteps.length : 0} 项`
  if (taskCount) taskCount.textContent = `${safeTasks.length} 项`
  if (taskList) taskList.innerHTML = renderRuntimeTaskList(safeTasks)
}

function renderRuntimeWorkboardError(message) {
  renderRuntimeWorkboard({
    insights: {
      generatedAt: new Date().toISOString(),
      currentFocus: {
        title: '任务视图暂不可用',
        summary: message,
      },
      pendingAuthorizations: [],
      attentionRequired: [],
      nextSteps: ['稍后重试，或检查后端 runtime 接口是否正常响应。'],
    },
    tasks: [],
  })
}

async function loadRuntimeWorkboardSnapshot() {
  const [insightsRes, tasksRes] = await Promise.all([
    fetch('/api/runtime/automation-insights?sessionId=main'),
    fetch('/api/runtime/tasks?sessionId=main'),
  ])
  const [insightsJson, tasksJson] = await Promise.all([insightsRes.json(), tasksRes.json()])
  if (!insightsRes.ok || insightsJson?.ok === false) {
    throw new Error(insightsJson?.error || 'automation insights unavailable')
  }
  if (!tasksRes.ok || tasksJson?.ok === false) {
    throw new Error(tasksJson?.error || 'runtime tasks unavailable')
  }
  return {
    insights: insightsJson,
    tasks: tasksJson.tasks || [],
  }
}

async function refreshRuntimeWorkboard(options = {}) {
  if (!ensureRuntimeWorkboard()) return
  if (runtimeWorkboardInFlight && !options.force) {
    runtimeWorkboardQueued = true
    return
  }
  runtimeWorkboardInFlight = true
  try {
    renderRuntimeWorkboard(await loadRuntimeWorkboardSnapshot())
  } catch (error) {
    renderRuntimeWorkboardError((error && error.message) || '读取 runtime 状态失败')
  } finally {
    runtimeWorkboardInFlight = false
    if (runtimeWorkboardQueued) {
      runtimeWorkboardQueued = false
      refreshRuntimeWorkboard()
    }
  }
}

function scheduleRuntimeWorkboardRefresh(delay = 250) {
  if (runtimeWorkboardTimer) clearTimeout(runtimeWorkboardTimer)
  runtimeWorkboardTimer = window.setTimeout(() => {
    runtimeWorkboardTimer = null
    refreshRuntimeWorkboard()
  }, delay)
}

function bootstrapChatStatusCard() {
  ensureChatStatusCard()
  ensureApplyFeatureWrapper()
  bindChatShortcuts()
  resizeChatInput()
  renderChatStatus(CHAT_TASK_STATE.IDLE, CHAT_STATE_METADATA.idle.detail)
  refreshRuntimeWorkboard({ force: true })
  if (!runtimeWorkboardPoller) {
    runtimeWorkboardPoller = window.setInterval(() => {
      if (document.hidden) return
      refreshRuntimeWorkboard()
    }, 10000)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapChatStatusCard)
} else {
  bootstrapChatStatusCard()
}

function setQueueStatus(info) {
  const el = document.getElementById('queue-status')
  ensureChatStatusCard()
  if (!info) {
    if (el) {
      el.classList.add('hidden')
      el.textContent = ''
    }
    window.appState.queueInfo = null
    renderChatStatus(window.appState.chatTask.state, window.appState.chatTask.message)
    return
  }
  window.appState.queueInfo = info
  if (el) {
    // Keep queue message for a11y only, avoid duplicated visible status blocks.
    el.textContent = info.message
    el.classList.add('hidden')
  }
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
    scheduleRuntimeWorkboardRefresh(100)
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
    scheduleRuntimeWorkboardRefresh(150)
  }
}

chatSend.addEventListener('click', sendChatMessage)
chatInput.addEventListener('input', resizeChatInput)
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
window.refreshRuntimeWorkboard = refreshRuntimeWorkboard
window.scheduleRuntimeWorkboardRefresh = scheduleRuntimeWorkboardRefresh

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
