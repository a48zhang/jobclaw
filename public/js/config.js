/**
 * 配置编辑器与基础设置
 */

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
  window.appState.currentFile = name
  document.querySelectorAll('.config-tab-btn').forEach((btn) => {
    const active = btn.dataset.file === name
    btn.className = active
      ? 'config-tab-btn text-sm px-4 py-2 rounded-t-lg bg-slate-900 text-blue-400 border-t border-l border-r border-slate-700 font-bold'
      : 'config-tab-btn text-sm px-4 py-2 rounded-t-lg bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200 border-t border-l border-r border-transparent transition-colors'
  })
  try {
    const res = await fetch(`/api/config/${name}`)
    const json = await res.json()
    document.getElementById('md-editor').value = json.content ?? ''
    document.getElementById('save-status').textContent = ''
  } catch {
    document.getElementById('md-editor').value = ''
    document.getElementById('save-status').textContent = '✗ 加载失败'
    document.getElementById('save-status').className = 'text-sm text-red-400'
    appendAgentLog({ type: 'error', message: '配置加载失败，请检查服务是否正常。', agentName: 'System' })
  }
}

document.querySelectorAll('.config-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => loadFile(btn.dataset.file))
})

document.getElementById('save-md').addEventListener('click', async () => {
  const status = document.getElementById('save-status')
  const btn = document.getElementById('save-md')

  status.textContent = '保存中...'
  status.className = 'text-sm text-yellow-400'
  btn.disabled = true
  btn.classList.add('opacity-70')

  try {
    const content = document.getElementById('md-editor').value
    const res = await fetch(`/api/config/${window.appState.currentFile}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const json = await res.json()
    if (json.ok) {
      status.textContent = '✓ 保存成功'
      status.className = 'text-sm text-green-400'
    } else {
      status.textContent = `✗ ${json.error}`
      status.className = 'text-sm text-red-400'
    }
  } catch {
    status.textContent = '✗ 网络错误'
    status.className = 'text-sm text-red-400'
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70')
    setTimeout(() => {
      if (status.textContent === '✓ 保存成功') status.textContent = ''
    }, 3000)
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

window.loadFile = loadFile
window.loadSettings = loadSettings
window.applyFeatureAvailability = applyFeatureAvailability
