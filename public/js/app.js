/**
 * 应用初始化入口
 */

const ACTIVE_TAB_STORAGE_KEY = 'jobclaw.active-tab'
const ONBOARDING_TOTAL_STEPS = 3

function renderOnboardingFeatureList(features) {
  const container = document.getElementById('onboarding-feature-list')
  if (!container) return
  container.innerHTML = features
    .map((feature) => {
      const stateClass = feature.ready ? 'text-emerald-300' : 'text-amber-300'
      const stateLabel = feature.ready ? '已解锁' : feature.detail || '待补全'
      return `
        <li class="flex items-center justify-between gap-4">
          <span>${feature.label}</span>
          <span class="text-xs font-semibold ${stateClass}">${stateLabel}</span>
        </li>
      `
    })
    .join('')
}

function renderOnboardingNextSteps(steps) {
  const container = document.getElementById('onboarding-next-steps')
  if (!container) return
  if (!steps.length) {
    container.innerHTML = '<li>系统已准备就绪，可以继续探索主路径。</li>'
    return
  }
  container.innerHTML = steps.map((text) => `<li>${text}</li>`).join('')
}

function updateOnboardingProgress(completed) {
  const progressBar = document.getElementById('onboarding-progress-bar')
  const progressLabel = document.getElementById('onboarding-progress-label')
  if (progressBar) {
    const percent = Math.min(100, Math.round((completed / ONBOARDING_TOTAL_STEPS) * 100))
    progressBar.style.width = `${percent}%`
  }
  if (progressLabel) {
    progressLabel.textContent = `基础配置完成度 ${completed}/${ONBOARDING_TOTAL_STEPS}`
  }
}

function updateChatDisabledHint() {
  const hint = document.getElementById('chat-disabled-hint')
  if (!hint) return
  if (window.appState.appReady) {
    hint.classList.add('hidden')
    hint.textContent = ''
    return
  }
  const missing = window.appState.missingFields.length
    ? window.appState.missingFields.join(', ')
    : 'API_KEY, MODEL_ID, BASE_URL'
  hint.textContent = `当前缺少基础配置：${missing}。请先到“工作区配置”页完成设置，再返回继续。`
  hint.classList.remove('hidden')
}

function updateConfigMissingHint() {
  const hint = document.getElementById('config-missing-hint')
  if (!hint) return
  if (window.appState.appReady) {
    hint.textContent = '基础配置已完成，聊天、简历与职位入口已恢复。'
  } else {
    const missing = window.appState.missingFields.length
      ? window.appState.missingFields.join(', ')
      : 'API_KEY, MODEL_ID, BASE_URL'
    hint.textContent = `缺少基础配置：${missing}。填好后即可启用全路径。`
  }
}

function updateDocStatusMarker(name, ready) {
  const label = document.getElementById(`${name}-doc-status`)
  if (!label) return
  label.textContent = ready ? '已完成' : '待补全'
  label.classList.toggle('text-emerald-300', ready)
  label.classList.toggle('text-amber-300', !ready)
}

function applyOnboardingState({ baseReady, targetsComplete, userinfoComplete }) {
  const banner = document.getElementById('first-run-banner')
  if (!banner) return

  const normalizedBase = Boolean(baseReady)
  const normalizedTargets = Boolean(targetsComplete)
  const normalizedUserinfo = Boolean(userinfoComplete)
  window.appState.targetsReady = normalizedTargets
  window.appState.userinfoReady = normalizedUserinfo

  const missingFieldsText = window.appState.missingFields.length
    ? window.appState.missingFields.join(', ')
    : 'API_KEY, MODEL_ID, BASE_URL'

  const baseBadge = document.getElementById('onboarding-base-status')
  if (baseBadge) {
    baseBadge.textContent = normalizedBase ? '基础就绪' : '待配置'
  }

  const settingsDetail = document.getElementById('onboarding-settings-detail')
  if (settingsDetail) {
    settingsDetail.textContent = normalizedBase
      ? '已完成：聊天、简历与职位入口可用'
      : `缺少：${missingFieldsText}`
  }

  const targetsDetail = document.getElementById('onboarding-targets-detail')
  if (targetsDetail) {
    targetsDetail.textContent = normalizedTargets ? '已完善' : '待补全'
  }

  const userinfoDetail = document.getElementById('onboarding-userinfo-detail')
  if (userinfoDetail) {
    userinfoDetail.textContent = normalizedUserinfo ? '已完善' : '待补全'
  }

  updateOnboardingProgress([normalizedBase, normalizedTargets, normalizedUserinfo].filter(Boolean).length)

  renderOnboardingFeatureList([
    { label: '主 Agent 聊天路径', ready: normalizedBase, detail: '需完成基础配置' },
    {
      label: '简历生成与评价',
      ready: normalizedBase && normalizedTargets && normalizedUserinfo,
      detail: '需完善 targets.md / userinfo.md',
    },
    {
      label: '职位搜索与更新',
      ready: normalizedBase && normalizedTargets,
      detail: '需完善 targets.md',
    },
  ])

  const steps = []
  if (!normalizedBase) steps.push('1. 在“工作区配置”页填入 API_KEY、MODEL_ID 与 BASE_URL。')
  if (!normalizedTargets) steps.push('2. 补全 targets.md，确定目标公司列表。')
  if (!normalizedUserinfo) steps.push('3. 补全 userinfo.md，确保个人信息完善。')
  if (normalizedBase && normalizedTargets && normalizedUserinfo) {
    steps.push('4. 输入“run search”或点击“刷新”获取职位数据。')
  }
  renderOnboardingNextSteps(steps)

  updateDocStatusMarker('targets', normalizedTargets)
  updateDocStatusMarker('userinfo', normalizedUserinfo)

  const completedSteps = [normalizedBase, normalizedTargets, normalizedUserinfo].filter(Boolean).length
  if (completedSteps < ONBOARDING_TOTAL_STEPS) {
    banner.classList.remove('hidden')
  } else {
    banner.classList.add('hidden')
  }

  updateChatDisabledHint()
  updateConfigMissingHint()
}

function getNavButtonForTab(targetId) {
  return document.querySelector(`.nav-btn[data-target="${targetId}"]`)
}

function getDefaultTabId() {
  const activeBtn = document.querySelector('.nav-btn.active')
  return activeBtn?.dataset?.target || 'tab-chat'
}

function readStoredTabId() {
  try {
    return localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistTabId(tabId) {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId)
  } catch {
    // ignore localStorage errors
  }
}

function normalizeTabId(targetId) {
  if (typeof targetId !== 'string') return getDefaultTabId()
  return getNavButtonForTab(targetId) ? targetId : getDefaultTabId()
}

function resolveInitialTabId() {
  return normalizeTabId(readStoredTabId() || getDefaultTabId())
}

function showTab(targetId, options = {}) {
  const tabId = normalizeTabId(targetId)
  const { persist = true, userInitiated = false } = options

  document.querySelectorAll('.nav-btn').forEach((b) => {
    const active = b.dataset.target === tabId
    b.classList.toggle('active', active)
    b.classList.toggle('bg-blue-600', active)
    b.classList.toggle('text-white', active)
    b.classList.toggle('text-slate-400', !active)
    b.setAttribute('aria-selected', active ? 'true' : 'false')
  })

  document.querySelectorAll('.tab-content').forEach((tc) => {
    const active = tc.id === tabId
    tc.classList.toggle('active', active)
    tc.toggleAttribute('hidden', !active)
  })

  if (persist) persistTabId(tabId)
  window.appState.activeTabId = tabId
  if (userInitiated) window.appState.userHasNavigated = true

  if (tabId === 'tab-jobs') {
    renderDonut()
  }
}

function initTabNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.target, { persist: true, userInitiated: true })
    })
  })
}

async function refreshFirstRunBanner() {
  const banner = document.getElementById('first-run-banner')
  if (!banner) return

  try {
    const [targetsRes, userinfoRes] = await Promise.all([
      fetch('/api/config/targets'),
      fetch('/api/config/userinfo'),
    ])
    const targetsJson = await targetsRes.json()
    const userinfoJson = await userinfoRes.json()
    const targetsContent = targetsJson?.content || ''
    const userinfoContent = userinfoJson?.content || ''
    const targetsComplete = Boolean(targetsContent.trim()) && !targetsContent.includes('示例公司') && !targetsContent.includes('每行一条目标')
    const userinfoComplete = Boolean(userinfoContent.trim()) && !userinfoContent.includes('姓名：') && !userinfoContent.includes('求职意向')
    const baseReady = Boolean(window.appState.appReady)
    applyOnboardingState({
      baseReady,
      targetsComplete,
      userinfoComplete,
    })
  } catch {
    // ignore
  } finally {
    updateChatDisabledHint()
    updateConfigMissingHint()
  }
}

initTabNavigation()
showTab(resolveInitialTabId(), { persist: false, userInitiated: false })

connectWS()
fetchJobs()
loadFile('targets')
if (typeof window.loadResumeStatus === 'function') {
  window.loadResumeStatus()
}
loadSettings().then(() => {
  refreshFirstRunBanner()
})

window.showTab = showTab
window.refreshFirstRunBanner = refreshFirstRunBanner
window.applyOnboardingState = applyOnboardingState
