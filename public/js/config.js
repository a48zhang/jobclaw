/**
 * 配置编辑器与基础设置
 */

const configEditorRuntime = {
  suppressInput: false,
  clearStatusTimer: null,
  settingsBaseline: null,
  settingsInputsBound: false,
  workflowMounted: false,
}

const CONFIG_DOC_PATTERNS = {
  targets: ['示例公司', '每行一条目标'],
  userinfo: ['姓名：', '求职意向'],
}

const CONFIG_FIELDS = ['API_KEY', 'MODEL_ID', 'LIGHT_MODEL_ID', 'BASE_URL', 'SERVER_PORT']
const CONFIG_REQUIRED_FIELDS = ['API_KEY', 'MODEL_ID', 'BASE_URL']
const CONFIG_DOC_META = {
  targets: {
    label: 'targets.md',
    summary: '目标公司、岗位关键词、搜索范围',
    nextStep: '补齐目标公司和搜索方向，让职位搜索与主任务有明确目标。',
  },
  userinfo: {
    label: 'userinfo.md',
    summary: '个人信息、求职意向、简历上下文',
    nextStep: '补齐个人信息与求职意向，让简历与 Agent 回复更准确。',
  },
}

function normalizeSettingValue(field, value) {
  if (field === 'SERVER_PORT') {
    const parsed = Number.parseInt(String(value || '').trim() || '3000', 10)
    return Number.isFinite(parsed) ? String(parsed) : '3000'
  }
  return String(value || '').trim()
}

function cloneSettingsBaseline(source) {
  const baseline = {}
  CONFIG_FIELDS.forEach((field) => {
    baseline[field] = normalizeSettingValue(field, source?.[field] ?? '')
  })
  return baseline
}

function readSettingsFormState() {
  const values = {}
  CONFIG_FIELDS.forEach((field) => {
    const input = document.getElementById(`setting-${field.toLowerCase()}`)
    values[field] = normalizeSettingValue(field, input?.value ?? '')
  })

  return {
    values,
    missingRequired: CONFIG_REQUIRED_FIELDS.filter((field) => !values[field]),
  }
}

function hasSettingsDraft() {
  const { values } = readSettingsFormState()
  const baseline = configEditorRuntime.settingsBaseline || cloneSettingsBaseline(window.appState.settings)
  return CONFIG_FIELDS.some((field) => values[field] !== baseline[field])
}

function isRestartImpactPending() {
  const { values } = readSettingsFormState()
  const baseline = configEditorRuntime.settingsBaseline || cloneSettingsBaseline(window.appState.settings)
  return values.SERVER_PORT !== baseline.SERVER_PORT
}

function getConfigWorkflowState() {
  const { missingRequired } = readSettingsFormState()
  const settingsDirty = hasSettingsDraft()
  const restartPending = isRestartImpactPending()
  const baseReady = Boolean(window.appState.appReady)
  const targetsReady = Boolean(window.appState.targetsReady)
  const userinfoReady = Boolean(window.appState.userinfoReady)
  const completed = [baseReady, targetsReady, userinfoReady].filter(Boolean).length

  let nextStep = '当前配置已完成，可以返回聊天、职位或简历主路径。'
  if (missingRequired.length > 0) {
    nextStep = `先填写并保存：${missingRequired.join('、')}。`
  } else if (!baseReady || settingsDirty) {
    nextStep = '保存基础设置，先让聊天与简历入口恢复可用。'
  } else if (!targetsReady) {
    nextStep = '切换到 targets.md，补齐目标公司与搜索范围。'
  } else if (!userinfoReady) {
    nextStep = '切换到 userinfo.md，补齐个人信息与求职意向。'
  }

  let impact = '保存后即时生效；只有修改 SERVER_PORT 时才需要重启服务。'
  if (settingsDirty && restartPending) {
    impact = '当前改动包含 SERVER_PORT。保存后仍需重启服务，页面连接端口才会切换。'
  } else if (!settingsDirty) {
    impact = '当前没有未保存设置。只有修改 SERVER_PORT 时需要重启服务。'
  }

  return {
    baseReady,
    targetsReady,
    userinfoReady,
    completed,
    missingRequired,
    settingsDirty,
    restartPending,
    nextStep,
    impact,
  }
}

function isDocReady(name, content) {
  const text = String(content || '').trim()
  if (!text) return false
  const patterns = CONFIG_DOC_PATTERNS[name]
  if (!Array.isArray(patterns)) return false
  return !patterns.some((part) => text.includes(part))
}

function ensureConfigWorkflowChrome() {
  if (configEditorRuntime.workflowMounted) return
  const shell = document.querySelector('#tab-config > div')
  if (!shell) return

  const guide = document.createElement('section')
  guide.id = 'config-workflow-guide'
  guide.className = 'rounded-xl border border-slate-700 bg-slate-950/60 p-4 shadow-sm'
  guide.innerHTML = `
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">设置工作流</span>
          <span id="config-workflow-pill" class="rounded-full bg-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-900">检查中</span>
        </div>
        <h2 class="text-lg font-semibold text-slate-100">先恢复基础可用性，再补齐两份工作区文档</h2>
        <p id="config-workflow-summary" class="text-sm leading-6 text-slate-300">正在检查当前设置与文档状态。</p>
      </div>
      <div class="grid gap-2 text-sm text-slate-300 sm:grid-cols-3 lg:min-w-[520px]">
        <div id="config-step-base" class="rounded-lg border p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium text-slate-100">基础设置</span>
            <span id="config-step-base-badge" class="rounded-full bg-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-900">检查中</span>
          </div>
          <p id="config-step-base-detail" class="mt-2 text-xs leading-5 text-slate-400"></p>
        </div>
        <div id="config-step-targets" class="rounded-lg border p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium text-slate-100">targets.md</span>
            <span id="config-step-targets-badge" class="rounded-full bg-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-900">检查中</span>
          </div>
          <p id="config-step-targets-detail" class="mt-2 text-xs leading-5 text-slate-400"></p>
        </div>
        <div id="config-step-userinfo" class="rounded-lg border p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium text-slate-100">userinfo.md</span>
            <span id="config-step-userinfo-badge" class="rounded-full bg-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-900">检查中</span>
          </div>
          <p id="config-step-userinfo-detail" class="mt-2 text-xs leading-5 text-slate-400"></p>
        </div>
      </div>
    </div>
    <div class="mt-4 grid gap-3 md:grid-cols-2">
      <div class="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">下一步</p>
        <p id="config-next-step" class="mt-2 text-sm leading-6 text-slate-200"></p>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">生效说明</p>
        <p id="config-restart-impact" class="mt-2 text-sm leading-6 text-slate-200"></p>
      </div>
    </div>
  `
  shell.prepend(guide)

  const settingsStatus = document.getElementById('save-settings-status')
  const settingsStatusContainer = settingsStatus?.parentElement
  if (settingsStatusContainer && !document.getElementById('config-settings-draft-status')) {
    const draft = document.createElement('span')
    draft.id = 'config-settings-draft-status'
    draft.className = 'rounded-full bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200'
    draft.textContent = '未检测到改动'
    settingsStatusContainer.insertBefore(draft, settingsStatus)
  }

  const editorStatus = document.getElementById('save-status')
  const editorStatusContainer = editorStatus?.parentElement
  if (editorStatusContainer && !document.getElementById('config-editor-draft-status')) {
    const draft = document.createElement('span')
    draft.id = 'config-editor-draft-status'
    draft.className = 'rounded-full bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200'
    draft.textContent = '未检测到改动'
    editorStatusContainer.insertBefore(draft, editorStatus)
  }

  const tabStatuses = document.querySelector('.config-tab-statuses') || document.getElementById('md-editor')
  if (tabStatuses && !document.getElementById('config-doc-purpose')) {
    const purpose = document.createElement('p')
    purpose.id = 'config-doc-purpose'
    purpose.className = 'mb-3 text-xs leading-5 text-slate-400'
    if (tabStatuses.id === 'md-editor') {
      tabStatuses.insertAdjacentElement('beforebegin', purpose)
    } else {
      tabStatuses.insertAdjacentElement('afterend', purpose)
    }
  }

  document.getElementById('config-missing-hint')?.classList.add('hidden')
  document.getElementById('settings-missing')?.classList.add('hidden')

  const restartNote = document.getElementById('config-restart-note')
  if (restartNote) {
    restartNote.textContent = '只有修改 SERVER_PORT 时才需要重启服务；其他基础设置保存后即可直接使用。'
  }

  configEditorRuntime.workflowMounted = true
  renderDocPurpose()
}

function getStepCardTone({ ready, blocked, current }) {
  if (ready) {
    return {
      container: 'border-emerald-500/30 bg-emerald-950/20',
      badge: 'bg-emerald-300 text-slate-900',
      label: '已完成',
    }
  }
  if (current) {
    return {
      container: 'border-sky-500/30 bg-sky-950/20',
      badge: 'bg-sky-300 text-slate-900',
      label: '当前步骤',
    }
  }
  if (blocked) {
    return {
      container: 'border-slate-700 bg-slate-950/50',
      badge: 'bg-slate-300 text-slate-900',
      label: '等待前置',
    }
  }
  return {
    container: 'border-amber-500/30 bg-amber-950/20',
    badge: 'bg-amber-300 text-slate-900',
    label: '待补全',
  }
}

function setStepCardState(step, options) {
  const container = document.getElementById(`config-step-${step}`)
  const badge = document.getElementById(`config-step-${step}-badge`)
  const detail = document.getElementById(`config-step-${step}-detail`)
  if (!container || !badge || !detail) return

  const tone = getStepCardTone(options)
  container.className = `rounded-lg border p-3 ${tone.container}`
  badge.className = `rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.badge}`
  badge.textContent = tone.label
  detail.textContent = options.detail
}

function renderDocPurpose() {
  const purpose = document.getElementById('config-doc-purpose')
  const fileName = window.appState.currentFile || 'targets'
  if (!purpose) return
  const meta = CONFIG_DOC_META[fileName] || CONFIG_DOC_META.targets
  const dirtyText = window.appState.configEditor?.dirty ? '当前内容尚未保存。' : '当前内容已与最近一次保存同步。'
  purpose.textContent = `${meta.label}：${meta.summary}。${dirtyText}`
}

function renderEditorDraftIndicator() {
  const indicator = document.getElementById('config-editor-draft-status')
  if (!indicator) return

  const dirty = Boolean(window.appState.configEditor?.dirty)
  const saving = Boolean(window.appState.configEditor?.saving)
  if (saving) {
    indicator.className = 'rounded-full bg-yellow-300 px-2.5 py-1 text-xs font-semibold text-slate-900'
    indicator.textContent = '保存中'
  } else if (dirty) {
    indicator.className = 'rounded-full bg-amber-300 px-2.5 py-1 text-xs font-semibold text-slate-900'
    indicator.textContent = '未保存'
  } else {
    indicator.className = 'rounded-full bg-emerald-300 px-2.5 py-1 text-xs font-semibold text-slate-900'
    indicator.textContent = '已保存'
  }
  renderDocPurpose()
}

function renderSettingsDraftIndicator() {
  const indicator = document.getElementById('config-settings-draft-status')
  const status = document.getElementById('save-settings-status')
  if (!indicator || !status) return

  const dirty = hasSettingsDraft()
  const restartPending = isRestartImpactPending()

  if (status.dataset.mode === 'saving') return

  if (dirty && restartPending) {
    indicator.className = 'rounded-full bg-amber-300 px-2.5 py-1 text-xs font-semibold text-slate-900'
    indicator.textContent = '未保存，且需重启'
    status.textContent = '已修改设置。保存后需按提示重启服务。'
    status.className = 'text-sm text-amber-300'
    status.dataset.mode = 'draft'
    return
  }

  if (dirty) {
    indicator.className = 'rounded-full bg-amber-300 px-2.5 py-1 text-xs font-semibold text-slate-900'
    indicator.textContent = '未保存'
    status.textContent = '已修改设置，等待保存。'
    status.className = 'text-sm text-amber-300'
    status.dataset.mode = 'draft'
    return
  }

  indicator.className = 'rounded-full bg-emerald-300 px-2.5 py-1 text-xs font-semibold text-slate-900'
  indicator.textContent = restartPending ? '已保存，需重启' : '已保存'
  if (!status.textContent.trim() || status.dataset.mode === 'draft') {
    status.textContent = restartPending ? '设置已保存，记得重启服务以切换端口。' : '当前设置已保存。'
    status.className = restartPending ? 'text-sm text-amber-300' : 'text-sm text-slate-400'
    status.dataset.mode = 'neutral'
  }
}

function renderConfigWorkflow() {
  ensureConfigWorkflowChrome()
  const state = getConfigWorkflowState()
  const pill = document.getElementById('config-workflow-pill')
  const summary = document.getElementById('config-workflow-summary')
  const nextStep = document.getElementById('config-next-step')
  const impact = document.getElementById('config-restart-impact')

  if (pill) {
    if (state.completed === 3 && !state.settingsDirty) {
      pill.className = 'rounded-full bg-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-slate-900'
      pill.textContent = '可开始使用'
    } else if (state.settingsDirty) {
      pill.className = 'rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-semibold text-slate-900'
      pill.textContent = '有待保存改动'
    } else {
      pill.className = 'rounded-full bg-sky-300 px-2.5 py-1 text-[11px] font-semibold text-slate-900'
      pill.textContent = '继续补全'
    }
  }

  if (summary) {
    const availability = state.baseReady
      ? '聊天、简历与职位入口已可用。'
      : `聊天与简历入口仍受限，缺少：${state.missingRequired.join('、') || '基础设置'}。`
    summary.textContent = `完成度 ${state.completed}/3。${availability}`
  }
  if (nextStep) nextStep.textContent = state.nextStep
  if (impact) impact.textContent = state.impact

  setStepCardState('base', {
    ready: state.baseReady && !state.settingsDirty,
    current: !state.baseReady || state.settingsDirty,
    detail: state.baseReady && !state.settingsDirty
      ? '基础设置已保存，主功能可用。'
      : state.missingRequired.length > 0
      ? `缺少：${state.missingRequired.join('、')}`
      : '字段已填写但尚未保存，请先保存设置。',
  })
  setStepCardState('targets', {
    ready: state.targetsReady,
    blocked: !state.baseReady && !state.settingsDirty,
    current: state.baseReady && !state.targetsReady,
    detail: state.targetsReady
      ? '已补齐，可驱动职位搜索与目标范围。'
      : CONFIG_DOC_META.targets.nextStep,
  })
  setStepCardState('userinfo', {
    ready: state.userinfoReady,
    blocked: !state.baseReady && !state.settingsDirty,
    current: state.baseReady && state.targetsReady && !state.userinfoReady,
    detail: state.userinfoReady
      ? '已补齐，可支持简历与对话上下文。'
      : CONFIG_DOC_META.userinfo.nextStep,
  })

  renderSettingsDraftIndicator()
  renderEditorDraftIndicator()
}

function setDocStatusLabel(name, ready) {
  const label = document.getElementById(`${name}-doc-status`)
  if (!label) return
  label.textContent = ready ? '已完成' : '待补全'
  label.classList.toggle('text-emerald-300', ready)
  label.classList.toggle('text-amber-300', !ready)
}

function syncDocStatus(name, content) {
  const ready = isDocReady(name, content)
  setDocStatusLabel(name, ready)
  if (name === 'targets') window.appState.targetsReady = ready
  if (name === 'userinfo') window.appState.userinfoReady = ready
  renderConfigWorkflow()
}

function reapplyOnboardingState() {
  if (typeof window.applyOnboardingState !== 'function') return
  window.applyOnboardingState({
    baseReady: Boolean(window.appState.appReady),
    targetsComplete: window.appState.targetsReady,
    userinfoComplete: window.appState.userinfoReady,
  })
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
  status.dataset.mode = tone

  if (autoClearMs > 0) {
    configEditorRuntime.clearStatusTimer = setTimeout(() => {
      status.textContent = ''
      status.className = classByTone.neutral
      status.dataset.mode = 'neutral'
      renderEditorDraftIndicator()
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
  renderDocPurpose()
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

  if (showStatus && !window.appState.configEditor?.saving) {
    if (isDirty) {
      setSaveStatus('● 未保存更改', 'dirty')
    } else {
      setSaveStatus('', 'neutral')
    }
  }

  renderConfigWorkflow()
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
  syncDocStatus(fileName, content)
  reapplyOnboardingState()
  renderConfigWorkflow()
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

  const state = getConfigWorkflowState()
  if (window.appState.appReady && !state.settingsDirty) {
    summary.textContent = '基础设置已保存，当前可以直接返回聊天、职位和简历主路径。'
    summary.className = 'text-sm text-emerald-300'
  } else if (state.missingRequired.length > 0) {
    summary.textContent = `还缺基础字段：${state.missingRequired.join('、')}。`
    summary.className = 'text-sm text-amber-300'
  } else {
    summary.textContent = '基础字段已填写，但还没有保存。'
    summary.className = 'text-sm text-sky-300'
  }

  missing.textContent = state.impact
  missing.className = 'text-xs text-slate-400 mt-2 hidden'
  reapplyOnboardingState()
  renderConfigWorkflow()
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
  if (typeof window.renderAgentCards === 'function') window.renderAgentCards()

  renderSetupSummary()
}

function bindSettingsFormInputs() {
  if (configEditorRuntime.settingsInputsBound) return
  CONFIG_FIELDS.forEach((field) => {
    const input = document.getElementById(`setting-${field.toLowerCase()}`)
    input?.addEventListener('input', () => {
      const status = document.getElementById('save-settings-status')
      if (status && status.dataset.mode !== 'saving') {
        status.dataset.mode = 'draft'
      }
      renderSetupSummary()
    })
  })
  configEditorRuntime.settingsInputsBound = true
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings')
    const json = await res.json()
    if (!json.ok) {
      throw new Error(json.error || '加载设置失败')
    }

    window.appState.settings = json.settings || {}
    configEditorRuntime.settingsBaseline = cloneSettingsBaseline(json.settings || {})
    window.appState.appReady = Boolean(json.status?.ready)
    window.appState.missingFields = json.status?.missingFields || []

    CONFIG_FIELDS.forEach((field) => {
      const input = document.getElementById(`setting-${field.toLowerCase()}`)
      if (input) {
        input.value = json.settings?.[field] ?? ''
      }
    })

    ensureConfigWorkflowChrome()
    bindSettingsFormInputs()
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
  if (window.appState.configEditor?.dirty) {
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
    renderDocPurpose()
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

document.getElementById('save-md')?.addEventListener('click', async () => {
  const btn = document.getElementById('save-md')
  const editor = getMarkdownEditor()
  if (!btn || !editor) return

  setSaveStatus('保存中...', 'saving')
  btn.disabled = true
  btn.classList.add('opacity-70')
  window.appState.configEditor = { saving: true }
  renderEditorDraftIndicator()

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
    syncDocStatus(window.appState.currentFile, content)
    setSaveStatus('✓ 保存成功', 'success', 3000)
    reapplyOnboardingState()
    renderConfigWorkflow()
  } catch (error) {
    window.appState.configEditor = { saving: false }
    syncEditorDirtyState({ showStatus: false })
    setSaveStatus(`✗ ${error?.message || '网络错误'}`, 'error')
    renderEditorDraftIndicator()
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70')
  }
})

document.getElementById('save-settings')?.addEventListener('click', async () => {
  const status = document.getElementById('save-settings-status')
  const btn = document.getElementById('save-settings')
  if (!status || !btn) return

  const payload = {
    API_KEY: document.getElementById('setting-api_key')?.value || '',
    MODEL_ID: document.getElementById('setting-model_id')?.value || '',
    LIGHT_MODEL_ID: document.getElementById('setting-light_model_id')?.value || '',
    BASE_URL: document.getElementById('setting-base_url')?.value || '',
    SERVER_PORT: Number.parseInt(document.getElementById('setting-server_port')?.value || '3000', 10),
  }

  btn.disabled = true
  btn.classList.add('opacity-70')
  status.textContent = '保存并应用中...'
  status.className = 'text-sm text-yellow-400'
  status.dataset.mode = 'saving'

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
    configEditorRuntime.settingsBaseline = cloneSettingsBaseline(json.settings || {})
    window.appState.appReady = Boolean(json.status?.ready)
    window.appState.missingFields = json.status?.missingFields || []
    applyFeatureAvailability()
    reapplyOnboardingState()
    status.textContent = window.appState.appReady ? '✓ 设置已保存并生效' : '✓ 设置已保存，请继续补全缺失项'
    status.className = window.appState.appReady ? 'text-sm text-green-400' : 'text-sm text-amber-300'
    status.dataset.mode = 'result'
    renderConfigWorkflow()

    if (window.appState.appReady) {
      appendAgentLog({ type: 'info', message: '基础设置已完成，Agent 功能已启用。', agentName: 'System' })
      if (typeof window.loadSessionHistory === 'function') window.loadSessionHistory()
    }
  } catch (err) {
    status.textContent = `✗ ${err.message || '保存失败'}`
    status.className = 'text-sm text-red-400'
    status.dataset.mode = 'result'
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70')
    renderSettingsDraftIndicator()
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

ensureConfigWorkflowChrome()
bindSettingsFormInputs()
renderConfigWorkflow()
