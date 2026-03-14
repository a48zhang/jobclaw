/**
 * 干预模态框功能
 */

function showModal({ agentName, prompt, kind, options, requestId }) {
  window.appState.interventionAgentName = agentName ?? 'main'
  window.appState.interventionRequestId = requestId ?? null
  window.appState.interventionKind = kind ?? 'text'
  const normalizedOptions = Array.isArray(options) ? options.filter(v => typeof v === 'string') : []
  window.appState.interventionOptions = normalizedOptions

  const optionsText = normalizedOptions.length && window.appState.interventionKind !== 'confirm'
    ? `\n\n可选项:\n${normalizedOptions.map((value, index) => `${index + 1}. ${value}`).join('\n')}`
    : ''
  document.getElementById('modal-prompt').textContent = (prompt ?? '') + optionsText

  const label = document.getElementById('modal-label')
  if (window.appState.interventionKind === 'confirm') {
    label.textContent = '请选择确认结果（也可手动输入 yes / no）：'
  } else if (window.appState.interventionKind === 'single_select' && normalizedOptions.length) {
    label.textContent = '请选择一个选项（可输入文字或编号）：'
  } else {
    label.textContent = '请输入响应内容（按 Enter 提交）：'
  }

  const optionsContainer = document.getElementById('modal-options')
  optionsContainer.innerHTML = ''
  optionsContainer.classList.add('hidden')

  const createOptionButton = (labelText, value, styleClass) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = styleClass
    btn.textContent = labelText
    btn.addEventListener('click', () => {
      document.getElementById('modal-input').value = value
      submitIntervention()
    })
    optionsContainer.appendChild(btn)
  }

  if (window.appState.interventionKind === 'confirm') {
    optionsContainer.classList.remove('hidden')
    createOptionButton('是', 'yes', 'px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold')
    createOptionButton('否', 'no', 'px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold')
  } else if (window.appState.interventionKind === 'single_select' && normalizedOptions.length) {
    optionsContainer.classList.remove('hidden')
    normalizedOptions.forEach((value, index) => {
      createOptionButton(`${index + 1}. ${value}`, value, 'px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium')
    })
  }

  const input = document.getElementById('modal-input')
  input.placeholder =
    window.appState.interventionKind === 'confirm'
      ? '请输入 yes / no'
      : normalizedOptions.length
        ? '请输入选项文字或编号'
        : '请输入内容...'
  const overlay = document.getElementById('modal-overlay')
  overlay.classList.add('active')
  setTimeout(() => input.focus(), 100)
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active')
  document.getElementById('modal-input').value = ''
  const optionsContainer = document.getElementById('modal-options')
  optionsContainer.innerHTML = ''
  optionsContainer.classList.add('hidden')
  window.appState.interventionRequestId = null
  window.appState.interventionKind = 'text'
  window.appState.interventionOptions = []
}

async function submitIntervention() {
  let input = document.getElementById('modal-input').value.trim()
  if (window.appState.interventionKind === 'single_select' && window.appState.interventionOptions.length) {
    const numeric = Number.parseInt(input, 10)
    if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= window.appState.interventionOptions.length) {
      input = window.appState.interventionOptions[numeric - 1]
    }
  }
  if (window.appState.interventionKind === 'confirm') {
    const normalized = input.toLowerCase()
    if (['y', 'yes', '是', '确认', '同意'].includes(normalized)) input = 'yes'
    if (['n', 'no', '否', '取消', '不同意'].includes(normalized)) input = 'no'
  }
  hideModal()
  try {
    await fetch('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        input, 
        agentName: window.appState.interventionAgentName, 
        requestId: window.appState.interventionRequestId 
      })
    })
  } catch { /* ignore */ }
}

// 事件绑定
document.getElementById('modal-submit').addEventListener('click', submitIntervention)
document.getElementById('modal-cancel').addEventListener('click', () => {
  hideModal()
  fetch('/api/intervention', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      input: '', 
      agentName: window.appState.interventionAgentName, 
      requestId: window.appState.interventionRequestId 
    })
  }).catch(() => {})
})
document.getElementById('modal-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitIntervention()
})

// ESC 键关闭模态框
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('active')) {
    document.getElementById('modal-cancel').click()
  }
})

// 导出到全局
window.showModal = showModal
window.hideModal = hideModal
window.submitIntervention = submitIntervention
