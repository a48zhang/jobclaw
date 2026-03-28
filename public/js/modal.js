/**
 * 干预模态框功能
 */

let interventionRestoreFocus = null
let releaseInterventionFocusTrap = null
let confirmResolve = null
let confirmRestoreFocus = null
let releaseConfirmFocusTrap = null

function getFocusableElements(container) {
  if (!container) return []
  return [...container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')
}

function activateFocusTrap(container, onEscape) {
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (typeof onEscape === 'function') {
        event.preventDefault()
        event.stopPropagation()
        onEscape()
      }
      return
    }
    if (event.key !== 'Tab') return
    const focusables = getFocusableElements(container)
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}

function ensureInterventionModalSemantics() {
  const overlay = document.getElementById('modal-overlay')
  const title = overlay?.querySelector('h3')
  const prompt = document.getElementById('modal-prompt')
  const label = document.getElementById('modal-label')
  const input = document.getElementById('modal-input')

  if (!overlay || !title || !prompt || !label || !input) return

  if (!title.id) title.id = 'modal-title'
  if (!prompt.id) prompt.id = 'modal-description'
  if (!label.id) label.id = 'modal-input-label'

  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', title.id)
  overlay.setAttribute('aria-describedby', prompt.id)
  overlay.setAttribute('aria-hidden', 'true')
  input.setAttribute('aria-labelledby', label.id)
}

function getToastContainer() {
  let container = document.getElementById('ui-toast-container')
  if (container) return container
  container = document.createElement('div')
  container.id = 'ui-toast-container'
  container.className = 'fixed right-4 top-4 z-[70] flex max-w-sm flex-col gap-2'
  container.setAttribute('aria-live', 'polite')
  container.setAttribute('aria-atomic', 'true')
  document.body.appendChild(container)
  return container
}

function showToast(input) {
  const options = typeof input === 'string' ? { message: input } : (input || {})
  const message = String(options.message || '').trim()
  if (!message) return

  const type = options.type || 'info'
  const durationMs = typeof options.durationMs === 'number' ? options.durationMs : 3200
  const toneClass =
    type === 'error'
      ? 'border-rose-500/70 bg-rose-950/85 text-rose-100'
      : type === 'warn'
      ? 'border-amber-500/70 bg-amber-950/85 text-amber-100'
      : type === 'success'
      ? 'border-emerald-500/70 bg-emerald-950/85 text-emerald-100'
      : 'border-sky-500/60 bg-slate-900/92 text-slate-100'

  const toast = document.createElement('div')
  toast.className = `rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${toneClass}`
  toast.textContent = message
  toast.style.opacity = '0'
  toast.style.transform = 'translateY(-6px)'
  toast.style.transition = 'opacity 160ms ease, transform 160ms ease'

  const container = getToastContainer()
  container.appendChild(toast)

  requestAnimationFrame(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
  })

  window.setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-6px)'
    window.setTimeout(() => toast.remove(), 200)
  }, durationMs)
}

function ensureConfirmDialog() {
  let overlay = document.getElementById('ui-confirm-overlay')
  if (overlay) return overlay

  overlay = document.createElement('div')
  overlay.id = 'ui-confirm-overlay'
  overlay.className = 'fixed inset-0 z-[80] hidden items-center justify-center bg-black/75 p-4'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.innerHTML = `
    <div id="ui-confirm-dialog" class="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
      <h3 id="ui-confirm-title" class="text-lg font-semibold text-slate-100">请确认操作</h3>
      <p id="ui-confirm-message" class="mt-2 text-sm leading-6 text-slate-300"></p>
      <div class="mt-5 flex justify-end gap-2">
        <button id="ui-confirm-cancel" type="button" class="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700">取消</button>
        <button id="ui-confirm-submit" type="button" class="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">确认</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  overlay.querySelector('#ui-confirm-cancel')?.addEventListener('click', () => closeConfirm(false))
  overlay.querySelector('#ui-confirm-submit')?.addEventListener('click', () => closeConfirm(true))

  return overlay
}

function isConfirmDialogOpen() {
  const overlay = document.getElementById('ui-confirm-overlay')
  return Boolean(overlay && !overlay.classList.contains('hidden'))
}

function closeConfirm(confirmed) {
  const overlay = document.getElementById('ui-confirm-overlay')
  if (!overlay) return

  overlay.classList.add('hidden')
  overlay.setAttribute('aria-hidden', 'true')
  releaseConfirmFocusTrap?.()
  releaseConfirmFocusTrap = null

  const resolve = confirmResolve
  confirmResolve = null
  if (resolve) resolve(Boolean(confirmed))

  confirmRestoreFocus?.focus()
  confirmRestoreFocus = null
}

function showConfirm(options = {}) {
  const overlay = ensureConfirmDialog()
  const dialog = overlay.querySelector('#ui-confirm-dialog')
  const titleEl = overlay.querySelector('#ui-confirm-title')
  const messageEl = overlay.querySelector('#ui-confirm-message')
  const submitBtn = overlay.querySelector('#ui-confirm-submit')
  const cancelBtn = overlay.querySelector('#ui-confirm-cancel')

  if (!dialog || !titleEl || !messageEl || !submitBtn || !cancelBtn) {
    return Promise.resolve(false)
  }

  if (confirmResolve) {
    confirmResolve(false)
    confirmResolve = null
  }

  titleEl.textContent = options.title || '请确认操作'
  messageEl.textContent = options.message || '是否继续执行？'
  submitBtn.textContent = options.confirmText || '确认'
  cancelBtn.textContent = options.cancelText || '取消'
  submitBtn.className = options.danger
    ? 'rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500'
    : 'rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500'

  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'ui-confirm-title')
  overlay.setAttribute('aria-describedby', 'ui-confirm-message')
  overlay.setAttribute('aria-hidden', 'false')
  overlay.classList.remove('hidden')

  confirmRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  releaseConfirmFocusTrap?.()
  releaseConfirmFocusTrap = activateFocusTrap(overlay, () => closeConfirm(false))
  submitBtn.focus()

  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

function showModal({ agentName, prompt, kind, options, requestId, ownerId }) {
  ensureInterventionModalSemantics()
  window.appState.interventionAgentName = agentName ?? 'main'
  window.appState.interventionRequestId = requestId ?? null
  window.appState.interventionOwnerId = ownerId ?? agentName ?? 'main'
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
  interventionRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  overlay.classList.add('active')
  overlay.setAttribute('aria-hidden', 'false')

  releaseInterventionFocusTrap?.()
  releaseInterventionFocusTrap = activateFocusTrap(overlay, () => {
    document.getElementById('modal-cancel')?.click()
  })

  const focusTargets = getFocusableElements(overlay)
  const preferredTarget = optionsContainer.querySelector('button') || input
  const fallbackTarget = focusTargets[0] || input
  const target = preferredTarget || fallbackTarget
  window.setTimeout(() => target.focus(), 20)
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay')
  overlay.classList.remove('active')
  overlay.setAttribute('aria-hidden', 'true')
  document.getElementById('modal-input').value = ''
  const optionsContainer = document.getElementById('modal-options')
  optionsContainer.innerHTML = ''
  optionsContainer.classList.add('hidden')
  window.appState.interventionRequestId = null
  window.appState.interventionOwnerId = null
  window.appState.interventionKind = 'text'
  window.appState.interventionOptions = []

  releaseInterventionFocusTrap?.()
  releaseInterventionFocusTrap = null
  interventionRestoreFocus?.focus()
  interventionRestoreFocus = null
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
  // 先保存需要发送的数据，再清除 UI 状态
  const payload = {
    input,
    agentName: window.appState.interventionAgentName,
    ownerId: window.appState.interventionOwnerId,
    requestId: window.appState.interventionRequestId
  }
  hideModal()
  try {
    await fetch('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch { /* ignore */ }
}

// 事件绑定
document.getElementById('modal-submit').addEventListener('click', submitIntervention)
document.getElementById('modal-cancel').addEventListener('click', () => {
  const payload = {
    input: '',
    agentName: window.appState.interventionAgentName,
    ownerId: window.appState.interventionOwnerId,
    requestId: window.appState.interventionRequestId
  }
  hideModal()
  fetch('/api/intervention', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
})
document.getElementById('modal-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitIntervention()
})

// ESC 键关闭模态框
ensureInterventionModalSemantics()
ensureConfirmDialog()

// 导出到全局
window.showModal = showModal
window.hideModal = hideModal
window.submitIntervention = submitIntervention
window.showToast = showToast
window.showConfirm = showConfirm
window.isUiConfirmOpen = isConfirmDialogOpen
