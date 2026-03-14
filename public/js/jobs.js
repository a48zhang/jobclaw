/**
 * 职位看板功能
 */

async function fetchJobs() {
  try {
    const res = await fetch('/api/jobs')
    window.appState.jobs = await res.json()
    renderJobs()
    if (document.getElementById('tab-jobs').classList.contains('active')) {
      renderDonut()
    }
  } catch { /* ignore */ }
}

function renderJobs() {
  const jobs = window.appState.jobs
  const sorted = [...jobs].sort((a, b) => {
    const av = a[window.appState.sortCol] ?? ''
    const bv = b[window.appState.sortCol] ?? ''
    return window.appState.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  const tbody = document.getElementById('job-tbody')
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-slate-500 text-center">暂无数据</td></tr>'
    return
  }
  tbody.innerHTML = sorted.map(r => `
    <tr class="hover:bg-slate-700/30 transition-colors group">
      <td class="py-3 px-4 font-semibold text-slate-300">${escHtml(r.company)}</td>
      <td class="py-3 px-4 text-slate-300">${escHtml(r.title)}</td>
      <td class="py-3 px-4">
        ${r.url ? `<a href="${escHtml(r.url)}" target="_blank" class="text-blue-400 hover:text-blue-300 underline opacity-80 group-hover:opacity-100">查看</a>` : '<span class="text-slate-600">—</span>'}
      </td>
      <td class="py-3 px-4">
        <span class="px-2 py-1 rounded text-xs font-medium bg-slate-800 border ${statusStyle(r.status)}">${escHtml(r.status)}</span>
      </td>
      <td class="py-3 px-4 text-slate-400 text-xs">${escHtml(r.time)}</td>
    </tr>
  `).join('')
}

// 排序事件绑定
document.querySelectorAll('.sortable-th').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col
    if (window.appState.sortCol === col) { 
      window.appState.sortAsc = !window.appState.sortAsc 
    } else { 
      window.appState.sortCol = col
      window.appState.sortAsc = true 
    }
    // 更新视觉指示器
    document.querySelectorAll('.sortable-th').forEach(t => t.textContent = t.textContent.replace(/[↑↓⇅]/, '⇅'))
    th.textContent = th.textContent.replace('⇅', window.appState.sortAsc ? '↑' : '↓')
    renderJobs()
  })
})

// 刷新按钮
document.getElementById('refresh-jobs').addEventListener('click', fetchJobs)

function renderDonut() {
  const jobs = window.appState.jobs
  const applied    = jobs.filter(j => j.status === 'applied').length
  const discovered = jobs.filter(j => j.status === 'discovered').length
  const failed     = jobs.filter(j => j.status === 'failed').length
  const other      = jobs.length - applied - discovered - failed

  const data = {
    labels: ['已投递', '待处理(发现)', '投递失败', '其他'],
    datasets: [{
      data: [applied, discovered, failed, other],
      backgroundColor: ['#22c55e', '#3b82f6', '#ef4444', '#64748b'],
      borderWidth: 0,
      hoverOffset: 4
    }]
  }

  const canvas = document.getElementById('donut-chart')
  // Chart.js 需要 canvas 可见才能正确渲染
  if (canvas.offsetParent === null) return

  if (window.appState.donutChart) {
    window.appState.donutChart.data = data
    window.appState.donutChart.update()
  } else {
    const ctx = canvas.getContext('2d')
    window.appState.donutChart = new Chart(ctx, {
      type: 'doughnut',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} 个` }
          }
        }
      }
    })
  }

  document.getElementById('stats-legend').innerHTML = `
    <div class="flex justify-between items-center"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-green-500"></div><span class="text-slate-300">已投递</span></div><span class="font-bold text-green-400">${applied}</span></div>
    <div class="flex justify-between items-center"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-blue-500"></div><span class="text-slate-300">待处理</span></div><span class="font-bold text-blue-400">${discovered}</span></div>
    <div class="flex justify-between items-center"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-red-500"></div><span class="text-slate-300">投递失败</span></div><span class="font-bold text-red-400">${failed}</span></div>
    <div class="flex justify-between items-center pt-2 border-t border-slate-700"><span class="text-slate-400">总计岗位</span><span class="font-bold text-white">${jobs.length}</span></div>
  `
}

// 导出到全局
window.fetchJobs = fetchJobs
window.renderJobs = renderJobs
window.renderDonut = renderDonut
