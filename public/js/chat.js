/**
 * 聊天功能
 */

const chatHistory = document.getElementById('chat-history')
const chatInput = document.getElementById('chat-input')
const chatSend = document.getElementById('chat-send')

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
  
  const isCommand = text.startsWith('/')
  
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    })
    const data = await res.json()
    
    if (!data.ok) {
      appendAgentLog({ type: 'error', message: '发送失败: ' + (data.error || '未知错误') })
    } else if (data.isCommand) {
      // 命令执行成功，清空聊天历史并显示结果
      chatHistory.innerHTML = ''
      appendAgentLog({ type: 'info', message: data.message })
    } else {
      // 非命令，显示用户消息
      appendUserMessage(text)
    }
  } catch (err) {
    appendAgentLog({ type: 'error', message: '网络错误: ' + err.message })
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
