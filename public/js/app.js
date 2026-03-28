/**
 * 应用初始化入口
 */

const ACTIVE_TAB_STORAGE_KEY = 'jobclaw.active-tab'

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
  try {
    const [targetsRes, userinfoRes] = await Promise.all([
      fetch('/api/config/targets'),
      fetch('/api/config/userinfo'),
    ])
    const targetsJson = await targetsRes.json()
    const userinfoJson = await userinfoRes.json()
    const banner = document.getElementById('first-run-banner')
    const bannerTitle = document.getElementById('first-run-title')
    const bannerText = document.getElementById('first-run-text')
    if (!banner || !bannerTitle || !bannerText) return

    const targetsContent = targetsJson?.content || ''
    const userinfoContent = userinfoJson?.content || ''
    const targetsDefault = !targetsContent.trim() || targetsContent.includes('示例公司') || targetsContent.includes('每行一条目标')
    const userinfoDefault = !userinfoContent.trim() || userinfoContent.includes('姓名：') || userinfoContent.includes('求职意向')

    if (!window.appState.appReady) {
      banner.classList.remove('hidden')
      bannerTitle.textContent = '先完成基础设置'
      bannerText.textContent = `请在“工作区配置”页填写 API_KEY、MODEL_ID、BASE_URL。当前缺少：${window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}。配置完成后聊天与简历功能会自动恢复。`
      return
    }

    if (targetsDefault || userinfoDefault) {
      banner.classList.remove('hidden')
      bannerTitle.textContent = '继续完善求职资料'
      bannerText.textContent = '基础设置已完成。下一步请完善 targets.md 和 userinfo.md，然后在聊天区输入“run search”开始搜索职位。'
      return
    }

    banner.classList.add('hidden')
  } catch {
    // ignore
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
