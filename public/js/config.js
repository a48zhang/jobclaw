/**
 * 配置编辑器与基础设置
 */

const configEditorRuntime = {
  suppressInput: false,
  clearStatusTimer: null,
}

function setSaveStatus(message, tone = 'neutral', autoClearMs = 0) {
  const status = document.getElementById('save-status')
  if (!status) return

  if (configEditorRuntime.clearStatusTimer) {
    clearTimeout(configEditorRuntime.clearStatusTimer)
    configEditorRuntime.clearStatusTimer = null
  }

  const classByTone = {
    neutral: 'text-sm text-slate-400',
    dirty: 'text-sm text-amber-300',
    saving: 'text-sm text-yellow-400',
    success: 'text-sm text-green-400',
    error: 'text-sm text-red-400',
    warn: 'text-sm text-amber-300',
  }

  status.textContent = message
  status.className = classByTone[tone] || classByTone.neutral

  if (autoClearMs > 0) {
    configEditorRuntime.clearStatusTimer = setTimeout(() => {
      status.textContent = ''
      status.className = classByTone.neutral
    }, autoClearMs)
  }
}

function setConfigTabVisualState(fileName) {
  document.querySelectorAll('.config-tab-btn').forEach((btn) => {
    const active = btn.dataset.file === fileName
    btn.className = active
      ? 'config-tab-btn text-sm px-4 py-2 rounded-t-lg bg-slate-900 text-blue-400 border-t border-l border-r border-slate-700 font-bold'
      : 'config-tab-btn text-sm px-4 py-2 rounded-t-lg bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200 border-t border-l border-r border-transparent transition-colors'
  })
}

function getMarkdownEditor() {
  return document.getElementById('md-editor')
}

function syncEditorDirtyState({ showStatus = true } = {}) {
  const editor = getMarkdownEditor()
  if (!editor) return false

  const baseline = String(window.appState.configEditor?.baselineContent || '')
  const isDirty = editor.value !== baseline

  window.appState.configEditor = { dirty: isDirty }

  if (!showStatus) return isDirty
  if (window.appState.configEditor?.saving) return isDirty

  if (isDirty) {
    setSaveStatus('● 未保存更改', 'dirty')
  } else {
    setSaveStatus('', 'neutral')
  }
  return isDirty
}

function setEditorLoadedState(fileName, content) {
  const editor = getMarkdownEditor()
  if (!editor) return

  configEditorRuntime.suppressInput = true
  editor.value = content
  configEditorRuntime.suppressInput = false

  window.appState.configEditor = {
    file: fileName,
    baselineContent: content,
    dirty: false,
    saving: false,
  }
  setSaveStatus('', 'neutral')
}

async function confirmDiscardUnsavedChanges(nextFileName) {
  const dirty = Boolean(window.appState.configEditor?.dirty)
  const saving = Boolean(window.appState.configEditor?.saving)
  if (!dirty) return true
  if (saving) {
    setSaveStatus('正在保存中，请稍候...', 'warn', 2500)
    return false
  }

  if (typeof window.showConfirm === 'function') {
    const confirmed = await window.showConfirm({
      title: '未保存更改',
      message: `切换到 ${nextFileName}.md 会丢失当前未保存内容，是否继续？`,
      confirmText: '仍然切换',
      cancelText: '留在当前页',
      danger: true,
    })
    if (!confirmed) {
      setSaveStatus('已取消切换，当前内容尚未保存。', 'warn', 2600)
    }
    return confirmed
  }

  const confirmed = window.confirm('当前内容尚未保存，切换会丢失修改，是否继续？')
  if (!confirmed) {
    setSaveStatus('已取消切换，当前内容尚未保存。', 'warn', 2600)
  }
  return confirmed
}

function renderSetupSummary() {
  const summary = document.getElementById('settings-summary')
  const missing = document.getElementById('settings-missing')
  if (!summary || !missing) return

  if (window.appState.appReady) {
    summary.textContent = '基础配置已完成，Agent 功能已可用。'
    summary.className = 'text-sm text-emerald-300'
    missing.textContent = '当前模型配置已生效。若修改端口，需要重启服务。'
    missing.className = 'text-xs text-slate-400 mt-2'
    return
  }

  summary.textContent = '基础配置未完成，当前处于设置向导模式。'
  summary.className = 'text-sm text-amber-300'
  missing.textContent = `缺少：${window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}`
  missing.className = 'text-xs text-amber-200 mt-2'
}

function applyFeatureAvailability() {
  const disabled = !window.appState.appReady
  const controls = [
    document.getElementById('chat-input'),
    document.getElementById('chat-send'),
    document.getElementById('gen-resume'),
    document.getElementById('review-uploaded-resume'),
  ]

  controls.forEach((control) => {
    if (!control) return
    control.disabled = disabled
    control.classList.toggle('opacity-50', disabled)
    control.classList.toggle('cursor-not-allowed', disabled)
  })

  const chatInput = document.getElementById('chat-input')
  if (chatInput) {
    chatInput.placeholder = disabled
      ? '请先到“工作区配置”页完成 API_KEY、MODEL_ID、BASE_URL 设置'
      : '输入指令，例如：去 BOSS 直聘搜一下前端开发岗位... (Enter 发送，Shift+Enter 换行)'
  }

  if (disabled) {
    Object.keys(window.appState.agentStates).forEach((key) => delete window.appState.agentStates[key])
  }
  if (typeof window.renderAgentCards === "function") window.renderAgentCards()

  renderSetupSummary()
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings')
    const json = await res.json()
    if (!json.ok) {
      throw new Error(json.error || '加载设置失败')
    }

    window.appState.settings = json.settings || {}
    window.appState.appReady = Boolean(json.status?.ready)
    window.appState.missingFields = json.status?.missingFields || []

    const fields = ['API_KEY', 'MODEL_ID', 'LIGHT_MODEL_ID', 'BASE_URL', 'SERVER_PORT']
    fields.forEach((field) => {
      const input = document.getElementById(`setting-${field.toLowerCase()}`)
      if (input) {
        input.value = json.settings?.[field] ?? ''
      }
    })

    applyFeatureAvailability()
  } catch (err) {
    const summary = document.getElementById('settings-summary')
    if (summary) {
      summary.textContent = `设置加载失败：${err.message || '未知错误'}`
      summary.className = 'text-sm text-red-300'
    }
  }
}

async function loadFile(name) {
  const nextFile = typeof name === 'string' && name ? name : 'targets'
  const shouldConfirmDiscard = Boolean(window.appState.configEditor?.dirty)
  if (shouldConfirmDiscard) {
    const canSwitch = await confirmDiscardUnsavedChanges(nextFile)
    if (!canSwitch) {
      setConfigTabVisualState(window.appState.currentFile)
      return false
    }
  }

  window.appState.currentFile = nextFile
  setConfigTabVisualState(nextFile)

  try {
    const res = await fetch(`/api/config/${nextFile}`)
    const json = await res.json()
    setEditorLoadedState(nextFile, json.content ?? '')
    return true
  } catch {
    setEditorLoadedState(nextFile, '')
    setSaveStatus('✗ 加载失败', 'error')
    appendAgentLog({ type: 'error', message: '配置加载失败，请检查服务是否正常。', agentName: 'System' })
    return false
  }
}

document.querySelectorAll('.config-tab-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await loadFile(btn.dataset.file)
  })
})

document.getElementById('md-editor')?.addEventListener('input', () => {
  if (configEditorRuntime.suppressInput) return
  syncEditorDirtyState({ showStatus: true })
})

document.getElementById('save-md').addEventListener('click', async () => {
  const btn = document.getElementById('save-md')
  const editor = getMarkdownEditor()
  if (!editor) return

  setSaveStatus('保存中...', 'saving')
  btn.disabled = true
  btn.classList.add('opacity-70')
  window.appState.configEditor = { saving: true }

  try {
    const content = editor.value
    const res = await fetch(`/api/config/${window.appState.currentFile}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const json = await res.json()
    if (!json.ok) {
      throw new Error(json.error || '保存失败')
    }

    window.appState.configEditor = {
      file: window.appState.currentFile,
      baselineContent: content,
      dirty: false,
      saving: false,
    }
    setSaveStatus('✓ 保存成功', 'success', 3000)
  } catch (error) {
    window.appState.configEditor = { saving: false }
    syncEditorDirtyState({ showStatus: false })
    const message = error?.message || '网络错误'
    setSaveStatus(`✗ ${message}`, 'error')
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70')
  }
})

document.getElementById('save-settings').addEventListener('click', async () => {
  const status = document.getElementById('save-settings-status')
  const btn = document.getElementById('save-settings')
  const payload = {
    API_KEY: document.getElementById('setting-api_key').value,
    MODEL_ID: document.getElementById('setting-model_id').value,
    LIGHT_MODEL_ID: document.getElementById('setting-light_model_id').value,
    BASE_URL: document.getElementById('setting-base_url').value,
    SERVER_PORT: Number.parseInt(document.getElementById('setting-server_port').value || '3000', 10),
  }

  btn.disabled = true
  btn.classList.add('opacity-70')
  status.textContent = '保存并应用中...'
  status.className = 'text-sm text-yellow-400'

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!json.ok) {
      throw new Error(json.error || '保存失败')
    }

    window.appState.settings = json.settings || {}
    window.appState.appReady = Boolean(json.status?.ready)
    window.appState.missingFields = json.status?.missingFields || []
    applyFeatureAvailability()
    status.textContent = window.appState.appReady ? '✓ 设置已保存并生效' : '✓ 设置已保存，请继续补全缺失项'
    status.className = window.appState.appReady ? 'text-sm text-green-400' : 'text-sm text-amber-300'

    if (window.appState.appReady) {
      appendAgentLog({ type: 'info', message: '基础设置已完成，Agent 功能已启用。', agentName: 'System' })
      if (typeof window.loadSessionHistory === 'function') window.loadSessionHistory()
    }
  } catch (err) {
    status.textContent = `✗ ${err.message || '保存失败'}`
    status.className = 'text-sm text-red-400'
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70')
  }
})

window.addEventListener('beforeunload', (event) => {
  if (!window.appState.configEditor?.dirty) return
  event.preventDefault()
  event.returnValue = ''
})

window.hasUnsavedConfigEditorChanges = () => Boolean(window.appState.configEditor?.dirty)
window.loadFile = loadFile
window.loadSettings = loadSettings
window.applyFeatureAvailability = applyFeatureAvailability
