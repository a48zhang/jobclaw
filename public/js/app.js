/**
 * 应用初始化入口
 */

function showTab(targetId) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    const active = b.dataset.target === targetId
    b.classList.toggle('active', active)
    b.classList.toggle('bg-blue-600', active)
    b.classList.toggle('text-white', active)
    b.classList.toggle('text-slate-400', !active)
  })

  document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'))
  document.getElementById(targetId).classList.add('active')

  if (targetId === 'tab-jobs') {
    renderDonut()
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.target))
})

document.querySelector('.nav-btn.active').classList.add('bg-blue-600', 'text-white')
document.querySelector('.nav-btn.active').classList.remove('text-slate-400')

async function checkFirstRun() {
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
      bannerText.textContent = `请先在“工作区配置”页填写 API_KEY、MODEL_ID、BASE_URL。当前缺少：${window.appState.missingFields.join(', ') || 'API_KEY, MODEL_ID, BASE_URL'}。保存后即可启用聊天和简历功能。`
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

connectWS()
fetchJobs()
loadFile('targets')
loadSettings().then(() => {
  checkFirstRun()
  if (!window.appState.appReady) {
    showTab('tab-config')
  }
})
