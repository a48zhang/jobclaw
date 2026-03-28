/**
 * 简历工具功能
 */

const resumeTaskState = {
  pollTimer: null,
  pollTick: 0,
  baselineMtime: null,
}
const RESUME_BUTTON_DEFAULT_TEXT = '生成简历 PDF'
const resumeFlowState = {
  uploadDone: false,
  reviewQueued: false,
}

function getResumeLayoutNodes() {
  const mainShell = document.querySelector('.resume-main-shell')
  const workbench = document.querySelector('.resume-workbench')
  const sideShell = document.querySelector('.resume-side-shell')
  const primaryCard = document.querySelector('.resume-primary-card')
  const actionCards = [...document.querySelectorAll('.resume-workbench .resume-action-card')]
  const uploadCard = actionCards.find((card) => !card.classList.contains('resume-primary-card')) || null
  const sideCards = [...document.querySelectorAll('.resume-side-shell .resume-side-card')]
  const artifactCard = sideCards[0] || null
  const noteCard = sideCards[1] || null
  const flowAnchor = document.getElementById('resume-flow-anchor')

  return {
    mainShell,
    workbench,
    sideShell,
    primaryCard,
    uploadCard,
    artifactCard,
    noteCard,
    flowAnchor,
  }
}

function getResumeSupportPanel() {
  return document.getElementById('resume-support-panel')
}

function updateResumeSupportToggleLabel() {
  const panel = getResumeSupportPanel()
  const indicator = document.getElementById('resume-support-toggle-indicator')
  if (!panel || !indicator) return
  indicator.textContent = panel.open ? '收起' : '展开'
}

function openResumeSupportPanel() {
  const panel = getResumeSupportPanel()
  if (!panel) return
  panel.open = true
  updateResumeSupportToggleLabel()
}

function ensureResumeFocusLayout() {
  const {
    mainShell,
    workbench,
    sideShell,
    primaryCard,
    uploadCard,
    artifactCard,
    noteCard,
    flowAnchor,
  } = getResumeLayoutNodes()
  if (!mainShell || !workbench || !primaryCard || !uploadCard || !artifactCard || !noteCard || !flowAnchor) {
    return null
  }

  let focusStack = document.getElementById('resume-focus-stack')
  if (!focusStack) {
    focusStack = document.createElement('div')
    focusStack.id = 'resume-focus-stack'
    focusStack.className = 'mt-4 flex flex-col gap-4'
    workbench.insertAdjacentElement('beforebegin', focusStack)
  }

  let priorityGrid = document.getElementById('resume-priority-grid')
  if (!priorityGrid) {
    priorityGrid = document.createElement('div')
    priorityGrid.id = 'resume-priority-grid'
    priorityGrid.className = 'grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]'
    focusStack.appendChild(priorityGrid)
  }

  let supportPanel = document.getElementById('resume-support-panel')
  if (!supportPanel) {
    supportPanel = document.createElement('details')
    supportPanel.id = 'resume-support-panel'
    supportPanel.className = 'rounded-xl border border-slate-700 bg-slate-900/60'
    supportPanel.innerHTML = `
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">辅助流程</p>
          <p id="resume-support-summary" class="mt-1 text-sm text-slate-300">上传已有 PDF 或发起评价任务，作为主操作前的补充参考。</p>
        </div>
        <span id="resume-support-toggle-indicator" class="rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-300">展开</span>
      </summary>
      <div id="resume-support-body" class="border-t border-slate-700/80 px-4 pb-4 pt-3"></div>
    `
    supportPanel.addEventListener('toggle', updateResumeSupportToggleLabel)
    focusStack.appendChild(supportPanel)
  }

  noteCard.classList.remove('subtle')
  noteCard.className = 'resume-side-card'
  noteCard.innerHTML = `
    <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">当前状态</p>
        <h3 id="resume-overview-title" class="mt-2 text-lg font-semibold text-slate-100">先生成最新简历 PDF</h3>
        <p id="resume-side-note" class="mt-2 text-sm leading-6 text-slate-300">主操作是生成并获取最新 PDF；上传与评价只是辅助参考。</p>
        <p id="resume-next-step" class="mt-2 text-xs leading-5 text-sky-200">下一步：点击“生成简历 PDF”，结果会直接回到当前页。</p>
      </div>
      <div class="flex flex-col items-start gap-2 md:items-end">
        <span id="resume-overview-badge" class="rounded-full bg-sky-300 px-3 py-1 text-xs font-semibold text-slate-950">主操作</span>
        <div id="resume-overview-actions" class="flex flex-wrap gap-2 md:justify-end"></div>
      </div>
    </div>
  `

  focusStack.prepend(noteCard)
  priorityGrid.appendChild(primaryCard)
  priorityGrid.appendChild(artifactCard)

  primaryCard.classList.add('border', 'border-sky-500/30', 'bg-slate-900/70', 'shadow-lg')
  artifactCard.classList.remove('subtle')
  artifactCard.classList.add('border', 'border-slate-700', 'bg-slate-900/70')

  const supportBody = document.getElementById('resume-support-body')
  if (supportBody) {
    supportBody.appendChild(uploadCard)
    supportBody.appendChild(flowAnchor)
  }

  sideShell.classList.add('hidden')
  workbench.classList.add('hidden')

  const generateBtn = document.getElementById('gen-resume')
  if (generateBtn) {
    generateBtn.classList.add('w-full')
    generateBtn.style.minHeight = '60px'
    generateBtn.style.fontSize = '1rem'
  }

  updateResumeSupportToggleLabel()
  return { focusStack, priorityGrid, supportPanel }
}

function setResumeOverviewState({ title, summary, nextStep, badgeLabel, badgeClass, actions = [] }) {
  ensureResumeFocusLayout()

  const titleEl = document.getElementById('resume-overview-title')
  const summaryEl = document.getElementById('resume-side-note')
  const nextStepEl = document.getElementById('resume-next-step')
  const badgeEl = document.getElementById('resume-overview-badge')
  const actionsEl = document.getElementById('resume-overview-actions')
  if (!titleEl || !summaryEl || !nextStepEl || !badgeEl || !actionsEl) return

  titleEl.textContent = title
  summaryEl.textContent = summary
  nextStepEl.textContent = nextStep
  badgeEl.textContent = badgeLabel
  badgeEl.className = `rounded-full px-3 py-1 text-xs font-semibold text-slate-950 ${badgeClass}`

  actionsEl.innerHTML = ''
  const actionList = [...actions]
  actionList.push({
    label: getResumeSupportPanel()?.open ? '收起辅助流程' : '查看辅助流程',
    tone: 'neutral',
    onClick: () => {
      const panel = getResumeSupportPanel()
      if (!panel) return
      panel.open = !panel.open
      updateResumeSupportToggleLabel()
      refreshResumeOverview()
    },
  })

  for (const action of actionList) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    button.className = action.tone === 'primary'
      ? 'rounded-md bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400'
      : action.tone === 'success'
      ? 'rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400'
      : action.tone === 'warn'
      ? 'rounded-md bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-300'
      : 'rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700'
    button.addEventListener('click', action.onClick)
    actionsEl.appendChild(button)
  }
}

function refreshResumeSupportSummary() {
  const summary = document.getElementById('resume-support-summary')
  if (!summary) return

  if (resumeFlowState.reviewQueued) {
    summary.textContent = '评价任务已提交。你可以收起这里，直接留在首屏等待或继续执行主操作。'
    return
  }
  if (resumeFlowState.uploadDone) {
    summary.textContent = '参考 PDF 已上传。现在可继续评价，也可以跳过评价直接回到主操作。'
    return
  }
  summary.textContent = '上传旧简历和发起评价都属于辅助流程，不是生成最新简历 PDF 的前置必做项。'
}

function refreshResumeOverview() {
  const preview = document.getElementById('resume-preview')
  const hasArtifact = Boolean(preview && !preview.classList.contains('hidden'))
  const link = document.getElementById('resume-link')
  const missingFields = window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'

  refreshResumeSupportSummary()

  if (!window.appState.appReady) {
    setResumeOverviewState({
      title: '先完成基础设置',
      summary: `当前还不能生成简历，缺少必要配置：${missingFields}。`,
      nextStep: '下一步：前往工作区配置补全后，再回到这里执行“生成简历 PDF”。',
      badgeLabel: '需配置',
      badgeClass: 'bg-amber-300',
      actions: [{ label: '去工作区配置', tone: 'warn', onClick: redirectToConfigTab }],
    })
    return
  }

  if (resumeTaskState.pollTimer) {
    setResumeOverviewState({
      title: '正在生成最新简历 PDF',
      summary: '主操作已经提交。当前页会自动检查新产物，成功后首屏会直接显示下载入口。',
      nextStep: '下一步：留在当前页等待结果，或去聊天区查看执行进度。',
      badgeLabel: '生成中',
      badgeClass: 'bg-sky-300',
      actions: [
        { label: '刷新产物状态', tone: 'primary', onClick: () => loadResumeStatus() },
        { label: '查看聊天进度', tone: 'neutral', onClick: goToChatTab },
      ],
    })
    return
  }

  if (hasArtifact) {
    setResumeOverviewState({
      title: '最新简历 PDF 已可用',
      summary: '当前产物已经就绪。你可以直接检查下载，也可以基于最新资料再次生成。',
      nextStep: '下一步：先检查 PDF 内容；如需更新，直接再次点击“生成简历 PDF”。',
      badgeLabel: '产物可用',
      badgeClass: 'bg-emerald-300',
      actions: link
        ? [{ label: '打开最新 PDF', tone: 'success', onClick: () => window.open(link.href, '_blank', 'noopener,noreferrer') }]
        : [],
    })
    return
  }

  if (resumeFlowState.reviewQueued) {
    setResumeOverviewState({
      title: '评价任务已提交，可继续生成',
      summary: '辅助评价已经在执行或排队中，不需要停留在辅助区等待才能开始生成最新 PDF。',
      nextStep: '下一步：直接点击“生成简历 PDF”，结果会优先回到当前首屏。',
      badgeLabel: '可生成',
      badgeClass: 'bg-sky-300',
      actions: [{ label: '查看聊天进度', tone: 'neutral', onClick: goToChatTab }],
    })
    return
  }

  if (resumeFlowState.uploadDone) {
    setResumeOverviewState({
      title: '参考简历已上传，可直接生成',
      summary: '上传仅作为辅助参考。你现在可以直接生成最新 PDF，也可以先发起评价获取建议。',
      nextStep: '下一步：优先执行“生成简历 PDF”；如需参考旧简历建议，再展开辅助流程。',
      badgeLabel: '主操作优先',
      badgeClass: 'bg-sky-300',
    })
    return
  }

  setResumeOverviewState({
    title: '先生成最新简历 PDF',
    summary: '主操作直接基于当前工作区资料生成最新产物。上传旧简历和评价都只是辅助，不是前置条件。',
    nextStep: '下一步：点击“生成简历 PDF”。如需参考旧简历，再展开辅助流程。',
    badgeLabel: '主操作',
    badgeClass: 'bg-sky-300',
  })
}

function notifyResume(type, message) {
  appendAgentLog({ type, message, agentName: 'System' })
  if (typeof window.showToast === 'function') {
    window.showToast({ type, message })
  }
}

function redirectToConfigTab() {
  const btn = document.querySelector('[data-target="tab-config"]')
  if (btn) btn.click()
}

function goToChatTab() {
  const btn = document.querySelector('[data-target="tab-chat"]')
  if (btn) btn.click()
}

function setGenerateButtonState(btn, running) {
  if (!btn) return
  if (!btn.dataset.defaultLabel) {
    btn.dataset.defaultLabel = RESUME_BUTTON_DEFAULT_TEXT
  }

  if (running) {
    btn.innerHTML = '<span class="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent align-[-2px] mr-2 animate-spin" aria-hidden="true"></span><span>正在提交编译任务...</span>'
  } else {
    btn.textContent = btn.dataset.defaultLabel
  }
}

function setInlineStatus(statusEl, type, text) {
  if (!statusEl) return
  statusEl.textContent = text
  const classByType = {
    info: 'text-sky-300',
    success: 'text-green-400',
    warn: 'text-amber-300',
    error: 'text-red-400',
  }
  statusEl.className = `mt-3 text-xs ${classByType[type] || classByType.info}`
}

function setResumeEmptyMessage(text) {
  const emptyMessage = document.querySelector('#resume-preview-empty p')
  if (!emptyMessage || !text) return
  emptyMessage.textContent = text
}

function ensureResumeStepFlow() {
  ensureResumeFocusLayout()
  const anchor = document.getElementById('resume-flow-anchor')
  if (!anchor) return null

  let flow = document.getElementById('resume-step-flow')
  if (flow) return flow

  flow = document.createElement('div')
  flow.id = 'resume-step-flow'
  flow.className = 'rounded-lg border border-slate-700 bg-slate-900/80 p-4'
  flow.innerHTML = `
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">流程状态</p>
    <ol class="mt-3 flex flex-col gap-2 text-sm">
      <li class="flex items-start justify-between gap-3 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2">
        <div class="min-w-0">
          <p class="font-semibold text-slate-100">主操作：生成最新 PDF</p>
          <p id="resume-step-generate-message" class="text-xs text-slate-300 mt-0.5">基于当前工作区资料生成最新产物</p>
        </div>
        <span id="resume-step-generate-state" class="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-sky-300 text-slate-900">主操作</span>
      </li>
      <li class="flex items-start justify-between gap-3 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2">
        <div class="min-w-0">
          <p class="font-semibold text-slate-200">辅助 1：上传已有 PDF</p>
          <p id="resume-step-upload-message" class="text-xs text-slate-400 mt-0.5">可选：用于后续评价与改写</p>
        </div>
        <span id="resume-step-upload-state" class="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-300 text-slate-900">可选</span>
      </li>
      <li class="flex items-start justify-between gap-3 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2">
        <div class="min-w-0">
          <p class="font-semibold text-slate-200">辅助 2：评价上传简历</p>
          <p id="resume-step-review-message" class="text-xs text-slate-400 mt-0.5">任务会在对话区输出建议</p>
        </div>
        <span id="resume-step-review-state" class="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-300 text-slate-900">等待上传</span>
      </li>
    </ol>
  `
  anchor.appendChild(flow)
  return flow
}

function ensureGenerateHint() {
  const generateBtn = document.getElementById('gen-resume')
  if (!generateBtn?.parentElement) return null

  let hint = document.getElementById('resume-generate-hint')
  if (hint) return hint

  hint = document.createElement('p')
  hint.id = 'resume-generate-hint'
  hint.className = 'mt-2 text-sm leading-6 text-sky-200'
  hint.textContent = '主操作：点击“生成简历 PDF”后，首屏会直接显示最新产物状态。'
  generateBtn.insertAdjacentElement('afterend', hint)
  generateBtn.setAttribute('aria-describedby', 'resume-generate-hint')
  return hint
}

function setGenerateHint(text, type = 'info') {
  const hint = ensureGenerateHint()
  if (!hint) return
  const classByType = {
    info: 'mt-2 text-sm leading-6 text-sky-200',
    success: 'mt-2 text-sm leading-6 text-emerald-300',
    warn: 'mt-2 text-sm leading-6 text-amber-300',
    error: 'mt-2 text-sm leading-6 text-rose-300',
  }
  hint.className = classByType[type] || classByType.info
  hint.textContent = text
}

function setResumeStepState(step, tone, message) {
  const badge = document.getElementById(`resume-step-${step}-state`)
  const detail = document.getElementById(`resume-step-${step}-message`)
  if (!badge) return

  const toneClass = {
    idle: 'bg-slate-300 text-slate-900',
    ready: 'bg-sky-300 text-slate-900',
    running: 'bg-amber-300 text-slate-900',
    done: 'bg-emerald-300 text-slate-900',
    error: 'bg-rose-300 text-slate-900',
    primary: 'bg-sky-300 text-slate-900',
  }
  const toneLabel = {
    idle: '待执行',
    ready: '可执行',
    running: '进行中',
    done: '已完成',
    error: '异常',
    primary: '主操作',
  }

  badge.className = `rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass[tone] || toneClass.idle}`
  badge.textContent = toneLabel[tone] || toneLabel.idle
  if (detail && message) detail.textContent = message
}

function refreshResumeFlowGuide() {
  ensureResumeStepFlow()
  ensureGenerateHint()

  setResumeStepState(
    'upload',
    resumeFlowState.uploadDone ? 'done' : 'idle',
    resumeFlowState.uploadDone ? '上传完成，可继续评价或直接回到主操作' : '可选：用于后续评价与改写'
  )
  setResumeStepState(
    'review',
    resumeFlowState.reviewQueued ? 'done' : (resumeFlowState.uploadDone ? 'ready' : 'idle'),
    resumeFlowState.reviewQueued ? '评价任务已提交，可在对话区查看结果' : (resumeFlowState.uploadDone ? '可提交评价任务' : '上传后可发起评价')
  )
  setResumeStepState(
    'generate',
    resumeTaskState.pollTimer ? 'running' : 'primary',
    resumeTaskState.pollTimer ? '任务执行中，产物生成后会自动刷新下载入口' : '基于当前工作区资料生成最新产物'
  )
  refreshResumeOverview()
}

function tuneResumeCtaHierarchy() {
  const uploadBtn = document.getElementById('upload-resume')
  const reviewBtn = document.getElementById('review-uploaded-resume')
  const generateBtn = document.getElementById('gen-resume')
  if (!uploadBtn || !reviewBtn || !generateBtn) return

  uploadBtn.style.background = 'linear-gradient(170deg, rgba(46,182,125,0.36), rgba(25,74,64,0.78))'
  uploadBtn.style.border = '1px solid rgba(110, 231, 183, 0.3)'
  uploadBtn.style.boxShadow = 'none'
  reviewBtn.style.background = 'linear-gradient(170deg, rgba(222,122,46,0.48), rgba(92,56,23,0.82))'
  reviewBtn.style.border = '1px solid rgba(253, 186, 116, 0.3)'
  reviewBtn.style.boxShadow = 'none'
  generateBtn.style.boxShadow = '0 0 0 2px rgba(45, 190, 230, 0.26), 0 12px 26px rgba(4, 14, 24, 0.38)'
}

function showSetupRequired(statusEl) {
  setInlineStatus(
    statusEl,
    'warn',
    `请先完成基础设置：${window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}`
  )
  setTaskCard({
    state: 'error',
    title: '基础设置未完成',
    detail: `请先补齐：${window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}`,
    actions: [{ label: '去工作区配置', onClick: redirectToConfigTab }],
  })
}

function ensureTaskCard() {
  ensureResumeFocusLayout()
  let card = document.getElementById('resume-task-card')
  if (card) return card

  const anchor = document.getElementById('resume-task-anchor')
  if (!anchor) return null

  card = document.createElement('div')
  card.id = 'resume-task-card'
  card.className = 'mt-4 rounded-lg border border-slate-700 bg-slate-900 p-4 hidden'
  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <p id="resume-task-title" class="text-sm font-semibold text-slate-200">任务状态</p>
        <p id="resume-task-detail" class="mt-1 text-xs text-slate-400"></p>
      </div>
      <span id="resume-task-badge" class="rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-900 bg-slate-300">待命</span>
    </div>
    <div id="resume-task-actions" class="mt-3 flex flex-wrap gap-2"></div>
  `
  anchor.appendChild(card)
  return card
}

function setTaskCard(options) {
  const card = ensureTaskCard()
  if (!card) return

  const titleEl = document.getElementById('resume-task-title')
  const detailEl = document.getElementById('resume-task-detail')
  const badgeEl = document.getElementById('resume-task-badge')
  const actionsEl = document.getElementById('resume-task-actions')
  if (!titleEl || !detailEl || !badgeEl || !actionsEl) return

  card.classList.remove('hidden')
  titleEl.textContent = options.title || '任务状态'
  detailEl.textContent = options.detail || ''

  const state = options.state || 'idle'
  const badgeMap = {
    idle: { label: '待命', klass: 'bg-slate-300 text-slate-900' },
    queued: { label: '已提交', klass: 'bg-amber-300 text-slate-900' },
    running: { label: '执行中', klass: 'bg-sky-300 text-slate-900' },
    success: { label: '完成', klass: 'bg-emerald-300 text-slate-900' },
    error: { label: '失败', klass: 'bg-rose-300 text-slate-900' },
  }
  const badge = badgeMap[state] || badgeMap.idle
  badgeEl.className = `rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.klass}`
  badgeEl.textContent = badge.label

  actionsEl.innerHTML = ''
  for (const action of options.actions || []) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = action.label
    btn.className = 'rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700'
    btn.addEventListener('click', action.onClick)
    actionsEl.appendChild(btn)
  }

  refreshResumeOverview()
}

function stopBuildPolling() {
  if (resumeTaskState.pollTimer) {
    clearInterval(resumeTaskState.pollTimer)
    resumeTaskState.pollTimer = null
  }
  resumeTaskState.pollTick = 0
}

async function fetchResumeStatusData() {
  const res = await fetch('/api/resume/status')
  const json = await res.json()
  return {
    ok: Boolean(json?.ok),
    exists: Boolean(json?.exists),
    path: json?.path || '/workspace/output/resume.pdf',
    mtime: typeof json?.mtime === 'string' ? json.mtime : null,
    error: json?.error || null,
  }
}

async function loadResumeStatus() {
  try {
    const status = await fetchResumeStatusData()
    if (!status.ok) {
      showResumeEmpty()
      return status
    }
    if (status.exists) {
      showResumeReady(status.path)
    } else {
      showResumeEmpty()
    }
    return status
  } catch {
    showResumeEmpty()
    return { ok: false, exists: false, path: '/workspace/output/resume.pdf', mtime: null, error: 'network_error' }
  }
}

function startBuildPolling() {
  stopBuildPolling()
  const maxTicks = 45
  setResumeStepState('generate', 'running', '任务执行中，正在检查最新 PDF 产物')
  setGenerateHint('生成任务已提交，正在后台编译。首屏会在产物可用后直接更新。', 'info')
  setResumeEmptyMessage('正在生成简历，请稍候。生成成功后会在这里显示下载入口。')

  setTaskCard({
    state: 'running',
    title: '简历生成任务正在执行',
    detail: '已提交 Agent 编译任务，正在检查最新 PDF 产物...',
    actions: [{ label: '查看聊天进度', onClick: goToChatTab }],
  })

  resumeTaskState.pollTimer = setInterval(async () => {
    resumeTaskState.pollTick += 1
    const status = await loadResumeStatus()
    if (!status.ok) return

    const hasNewOutput = status.exists && (
      !resumeTaskState.baselineMtime ||
      (status.mtime && status.mtime !== resumeTaskState.baselineMtime)
    )

    if (hasNewOutput) {
      stopBuildPolling()
      setResumeStepState('generate', 'done', '已生成最新 PDF，可直接查看或下载')
      setGenerateHint('已生成最新简历 PDF，可直接查看或下载。', 'success')
      setTaskCard({
        state: 'success',
        title: '简历生成完成',
        detail: '已检测到新的 PDF 产物，可直接查看或下载。',
        actions: [
          { label: '打开 PDF', onClick: () => window.open(status.path, '_blank', 'noopener,noreferrer') },
          { label: '继续对话', onClick: goToChatTab },
        ],
      })
      notifyResume('success', '简历 PDF 已生成。')
      return
    }

    if (resumeTaskState.pollTick >= maxTicks) {
      stopBuildPolling()
      setResumeStepState('generate', 'running', '任务仍在执行，可稍后刷新状态')
      setGenerateHint('任务仍在执行，可稍后点击“生成简历 PDF”再次确认状态。', 'warn')
      setTaskCard({
        state: 'queued',
        title: '任务仍在执行',
        detail: '暂未检测到新产物，可能仍在排队或执行。可稍后重试刷新状态。',
        actions: [
          { label: '刷新产物状态', onClick: () => loadResumeStatus() },
          { label: '查看聊天进度', onClick: goToChatTab },
        ],
      })
      notifyResume('warn', '简历任务仍在执行中，请稍后查看。')
    }
  }, 4000)

  refreshResumeOverview()
}

document.getElementById('upload-resume')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('resume-upload-file')
  const statusEl = document.getElementById('resume-upload-status')
  const btn = document.getElementById('upload-resume')
  const file = fileInput?.files?.[0]

  if (!file) {
    openResumeSupportPanel()
    setInlineStatus(statusEl, 'error', '请先选择一个 PDF 文件')
    setResumeStepState('upload', 'error', '未选择文件，请先选择 PDF 再上传')
    setResumeStepState('review', 'idle', '请先完成上传')
    setGenerateHint('未选择文件。若不需要参考旧简历，可直接回到上方执行主操作。', 'warn')
    setTaskCard({
      state: 'error',
      title: '上传失败',
      detail: '请先选择一个 PDF 文件后再上传。',
    })
    return
  }

  const form = new FormData()
  form.set('file', file)

  btn.disabled = true
  btn.classList.add('opacity-70', 'cursor-not-allowed')
  openResumeSupportPanel()
  setInlineStatus(statusEl, 'info', '正在上传 PDF...')
  setResumeStepState('upload', 'running', '正在上传 PDF...')

  try {
    const res = await fetch('/api/resume/upload', { method: 'POST', body: form })
    const json = await res.json()
    if (json.ok) {
      resumeFlowState.uploadDone = true
      setInlineStatus(statusEl, 'success', '上传成功。可继续评价，也可直接回到主操作生成最新 PDF。')
      setResumeStepState('upload', 'done', `上传完成：${json.name || 'resume.pdf'}`)
      setResumeStepState('review', 'ready', '可提交评价任务')
      setGenerateHint('参考简历已上传。你现在可以直接生成，也可以先在辅助区发起评价。', 'info')
      setTaskCard({
        state: 'idle',
        title: '上传成功',
        detail: `已接收文件：${json.name || 'resume.pdf'}。`,
      })
      notifyResume('success', `已上传 PDF 简历：${json.name} (${json.path})`)
    } else {
      setInlineStatus(statusEl, 'error', `上传失败: ${json.error || '未知错误'}`)
      setResumeStepState('upload', 'error', json.error || '上传失败，请重试')
      setTaskCard({
        state: 'error',
        title: '上传失败',
        detail: json.error || '服务端未返回详细错误',
      })
    }
  } catch (error) {
    setInlineStatus(statusEl, 'error', `上传异常: ${error.message || '未知错误'}`)
    setResumeStepState('upload', 'error', error.message || '网络异常')
    setTaskCard({
      state: 'error',
      title: '上传异常',
      detail: error.message || '网络异常',
    })
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70', 'cursor-not-allowed')
    refreshResumeFlowGuide()
  }
})

document.getElementById('review-uploaded-resume')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('resume-upload-status')
  const btn = document.getElementById('review-uploaded-resume')

  if (!window.appState.appReady) {
    openResumeSupportPanel()
    showSetupRequired(statusEl)
    return
  }

  btn.disabled = true
  btn.classList.add('opacity-70', 'cursor-not-allowed')
  openResumeSupportPanel()
  setInlineStatus(statusEl, 'info', '正在提交简历评价任务...')
  setResumeStepState('review', 'running', '评价任务提交中...')
  setGenerateHint('评价任务已进入辅助流程。你无需停留在这里，可随时回到主操作生成简历。', 'info')
  setTaskCard({
    state: 'queued',
    title: '简历评价任务已提交',
    detail: '任务已进入执行队列，完成后结果会出现在对话区。',
    actions: [{ label: '查看聊天进度', onClick: goToChatTab }],
  })

  try {
    const res = await fetch('/api/resume/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const json = await res.json()
    if (json.ok) {
      resumeFlowState.reviewQueued = true
      setInlineStatus(statusEl, 'success', '评价任务已提交。你可以留在当前页面继续生成，或去对话区查看进度。')
      setResumeStepState('review', 'done', '评价任务已提交，可在对话区查看')
      setGenerateHint('评价任务已提交。现在优先回到上方执行“生成简历 PDF”。', 'success')
      notifyResume('info', `已提交上传 PDF 简历评价任务：${json.path || 'data/uploads/resume-upload.pdf'}`)
    } else if (res.status === 409) {
      window.appState.appReady = false
      window.appState.missingFields = json.missingFields || []
      if (typeof window.applyFeatureAvailability === 'function') window.applyFeatureAvailability()
      showSetupRequired(statusEl)
      setResumeStepState('review', 'error', '基础配置不完整，请先补全')
      setGenerateHint('基础配置缺失，请先到工作区配置页补全。', 'error')
      setTaskCard({
        state: 'error',
        title: '任务提交失败',
        detail: `基础配置缺失：${(json.missingFields || []).join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}`,
      })
    } else {
      const reason = json.error || '未知错误'
      setInlineStatus(statusEl, 'error', `简历评价发起失败: ${reason}`)
      setResumeStepState('review', 'error', reason)
      setTaskCard({ state: 'error', title: '任务提交失败', detail: reason })
      notifyResume('error', `简历评价发起失败：${reason}`)
    }
  } catch (error) {
    const reason = error.message || '网络异常'
    setInlineStatus(statusEl, 'error', `简历评价发起异常: ${reason}`)
    setResumeStepState('review', 'error', reason)
    setTaskCard({ state: 'error', title: '任务提交异常', detail: reason })
    notifyResume('error', `简历评价发起异常：${reason}`)
  } finally {
    btn.disabled = !window.appState.appReady
    btn.classList.toggle('opacity-70', !window.appState.appReady)
    btn.classList.toggle('cursor-not-allowed', !window.appState.appReady)
    refreshResumeFlowGuide()
  }
})

document.getElementById('gen-resume')?.addEventListener('click', async () => {
  const btn = document.getElementById('gen-resume')
  const statusEl = document.getElementById('resume-upload-status')

  if (!window.appState.appReady) {
    showSetupRequired(statusEl)
    return
  }

  btn.disabled = true
  btn.classList.add('opacity-70', 'cursor-not-allowed')
  setGenerateButtonState(btn, true)
  setInlineStatus(statusEl, 'info', '正在提交简历生成任务...')
  setResumeStepState('generate', 'running', '正在提交生成任务...')
  setGenerateHint('主操作执行中：任务提交后会自动轮询，并在首屏更新产物状态。', 'info')
  setResumeEmptyMessage('正在提交生成任务，成功后会在这里显示下载入口。')

  try {
    const baseline = await loadResumeStatus()
    resumeTaskState.baselineMtime = baseline?.mtime || null

    const res = await fetch('/api/resume/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const json = await res.json()

    if (json.ok) {
      setInlineStatus(statusEl, 'success', '简历生成任务已提交，正在后台执行。')
      notifyResume('info', '已提交简历生成任务。')
      startBuildPolling()
    } else if (res.status === 409) {
      window.appState.appReady = false
      window.appState.missingFields = json.missingFields || []
      if (typeof window.applyFeatureAvailability === 'function') window.applyFeatureAvailability()
      showSetupRequired(statusEl)
      setResumeStepState('generate', 'error', '基础配置不完整，请先补全')
      setGenerateHint('基础配置缺失，请先到工作区配置页补全。', 'error')
      setTaskCard({
        state: 'error',
        title: '任务提交失败',
        detail: `基础配置缺失：${(json.missingFields || []).join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}`,
      })
    } else {
      const reason = json.error || '未知错误'
      setInlineStatus(statusEl, 'error', `任务提交失败: ${reason}`)
      setResumeStepState('generate', 'error', reason)
      setGenerateHint(`主操作提交失败：${reason}`, 'error')
      setTaskCard({ state: 'error', title: '任务提交失败', detail: reason })
      notifyResume('error', `简历生成任务提交失败：${reason}`)
    }
  } catch (error) {
    const reason = error.message || '网络异常'
    setInlineStatus(statusEl, 'error', `网络错误: ${reason}`)
    setResumeStepState('generate', 'error', reason)
    setGenerateHint(`主操作网络异常：${reason}`, 'error')
    setTaskCard({ state: 'error', title: '任务提交异常', detail: reason })
    notifyResume('error', `简历生成任务提交异常：${reason}`)
  } finally {
    btn.disabled = !window.appState.appReady
    btn.classList.toggle('opacity-70', !window.appState.appReady)
    btn.classList.toggle('cursor-not-allowed', !window.appState.appReady)
    setGenerateButtonState(btn, false)
    refreshResumeFlowGuide()
  }
})

function showResumeReady(path) {
  ensureResumeFocusLayout()
  const preview = document.getElementById('resume-preview')
  const previewEmpty = document.getElementById('resume-preview-empty')
  const link = document.getElementById('resume-link')
  if (link && path) link.href = path
  if (preview) preview.classList.remove('hidden')
  if (previewEmpty) previewEmpty.classList.add('hidden')
  setResumeStepState('generate', 'done', '已生成最新 PDF，可直接下载')
  setGenerateHint('主操作已完成：最新简历 PDF 已可用。', 'success')
  setTaskCard({
    state: 'success',
    title: '简历产物可用',
    detail: '已检测到可下载的 PDF 简历。',
    actions: [
      { label: '打开 PDF', onClick: () => window.open(path || '/workspace/output/resume.pdf', '_blank', 'noopener,noreferrer') },
      { label: '查看聊天进度', onClick: goToChatTab },
    ],
  })
  const sideNote = document.getElementById('resume-side-note')
  if (sideNote) {
    sideNote.textContent = '最新 PDF 已就绪。你可以直接下载，也可以回聊天区继续追问或发起下一轮优化。'
  }
  refreshResumeOverview()
}

function showResumeEmpty() {
  ensureResumeFocusLayout()
  const preview = document.getElementById('resume-preview')
  const previewEmpty = document.getElementById('resume-preview-empty')
  if (preview) preview.classList.add('hidden')
  if (previewEmpty) previewEmpty.classList.remove('hidden')
  if (resumeTaskState.pollTimer) {
    setResumeStepState('generate', 'running', '任务执行中，等待新产物')
    setResumeEmptyMessage('正在生成简历，请稍候。生成成功后会在这里显示下载入口。')
    refreshResumeOverview()
    return
  }
  setResumeStepState('generate', 'primary', '主操作：生成最新 PDF')
  setGenerateHint('主操作：点击“生成简历 PDF”可基于当前资料生成最新产物。', 'info')
  setResumeEmptyMessage('暂无最新 PDF。优先点击上方生成；如需参考旧简历，再展开辅助流程。')
  const sideNote = document.getElementById('resume-side-note')
  if (sideNote) {
    sideNote.textContent = window.appState.appReady
      ? '如果你已经补齐 targets.md 和 userinfo.md，可以直接执行主操作生成最新 PDF。'
      : '当前基础配置还未完成，先到工作区配置页补齐连接信息，再回来继续。'
  }
  refreshResumeOverview()
}

window.showResumeReady = showResumeReady
window.showResumeEmpty = showResumeEmpty
window.loadResumeStatus = loadResumeStatus

const resumeGenButton = document.getElementById('gen-resume')
if (resumeGenButton) {
  resumeGenButton.dataset.defaultLabel = RESUME_BUTTON_DEFAULT_TEXT
  setGenerateButtonState(resumeGenButton, false)
}

function initializeResumeUi() {
  ensureResumeFocusLayout()
  ensureResumeStepFlow()
  ensureGenerateHint()
  tuneResumeCtaHierarchy()
  refreshResumeFlowGuide()
  setTaskCard({
    state: 'idle',
    title: '等待主操作',
    detail: '首屏优先显示当前产物状态。准备好后直接生成新的简历 PDF。',
  })

  const statusEl = document.getElementById('resume-upload-status')
  if (statusEl && !statusEl.textContent.trim()) {
    statusEl.textContent = '辅助流程：如需参考旧简历，可在这里上传并发起评价。'
    statusEl.className = 'mt-3 text-xs text-slate-400'
  }
  setResumeEmptyMessage('暂无最新 PDF。优先点击上方生成；如需参考旧简历，再展开辅助流程。')
  refreshResumeOverview()
}

initializeResumeUi()
