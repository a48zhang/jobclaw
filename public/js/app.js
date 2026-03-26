/**
 * 应用初始化入口
 */

// ─── 导航标签页切换 ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 更新按钮样式
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active', 'bg-blue-600', 'text-white'))
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.add('text-slate-400'))
    btn.classList.add('active', 'bg-blue-600', 'text-white')
    btn.classList.remove('text-slate-400')
    
    // 更新内容区域
    const targetId = btn.dataset.target
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'))
    document.getElementById(targetId).classList.add('active')

    // 特殊处理
    if (targetId === 'tab-jobs') {
      renderDonut() // 修复隐藏时图表渲染问题
    }
  })
})

// 初始化导航样式
document.querySelector('.nav-btn.active').classList.add('bg-blue-600', 'text-white')
document.querySelector('.nav-btn.active').classList.remove('text-slate-400')

// ─── 初始化 ───────────────────────────────────────────────────────────────────
connectWS()
fetchJobs()
loadFile('targets')

async function checkFirstRun() {
  try {
    const [targetsRes, userinfoRes] = await Promise.all([
      fetch('/api/config/targets'),
      fetch('/api/config/userinfo')
    ])
    const targetsJson = await targetsRes.json()
    const userinfoJson = await userinfoRes.json()
    const banner = document.getElementById('first-run-banner')
    if (!banner) return
    const targetsContent = targetsJson?.content || ''
    const userinfoContent = userinfoJson?.content || ''
    const targetsEmpty = targetsContent.trim().length === 0
    const userinfoEmpty = userinfoContent.trim().length === 0
    const targetsDefault = targetsContent.includes('示例公司') || targetsContent.includes('每行一条目标')
    const userinfoDefault = userinfoContent.includes('姓名：') || userinfoContent.includes('求职意向')
    if (targetsEmpty || userinfoEmpty || targetsDefault || userinfoDefault) {
      banner.classList.remove('hidden')
    } else {
      banner.classList.add('hidden')
    }
  } catch {
    // ignore
  }
}

checkFirstRun()
