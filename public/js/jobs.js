/**
 * 职位看板功能
 */

async function fetchJobs() {
  const btn = document.getElementById('refresh-jobs')
  try {
    if (btn) {
      btn.disabled = true
      btn.textContent = '刷新中...'
      btn.classList.add('opacity-70', 'cursor-not-allowed')
    }
    const res = await fetch('/api/jobs')
    window.appState.jobs = await res.json()
    renderJobs()
    if (document.getElementById('tab-jobs').classList.contains('active')) {
      renderDonut()
    }
  } catch {
    appendAgentLog({ type: 'error', message: '职位刷新失败，请检查网络或服务状态。', agentName: 'System' })
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = '刷新'
      btn.classList.remove('opacity-70', 'cursor-not-allowed')
    }
  }
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
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-slate-500 text-center">暂无数据</td></tr>'
    return
  }
  tbody.innerHTML = sorted.map((r, idx) => `
    <tr class="hover:bg-slate-700/30 transition-colors group">
      <td class="py-3 px-4">
        <input type="checkbox" class="job-select accent-blue-500" data-index="${idx}" />
      </td>
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
  bindSelectionHandlers(sorted)
}

function bindSelectionHandlers(sorted) {
  const selectAll = document.getElementById('select-all')
  const selectedCount = document.getElementById('selected-count')
  const selects = document.querySelectorAll('.job-select')

  const updateCount = () => {
    const checked = [...selects].filter(i => i.checked).length
    if (selectedCount) selectedCount.textContent = `已选 ${checked}`
    if (selectAll) selectAll.checked = checked > 0 && checked === selects.length
  }

  selects.forEach(input => {
    input.addEventListener('change', updateCount)
  })

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      selects.forEach(input => { input.checked = selectAll.checked })
      updateCount()
    })
  }

  updateCount()
  window.appState.selectedJobs = { rows: sorted, indices: () => [...selects].filter(i => i.checked).map(i => Number(i.dataset.index)) }
}

async function submitJobMutation(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) {
    throw new Error(json.error || '操作失败')
  }
  return json
}

async function batchUpdateStatus(status) {
  const selected = window.appState.selectedJobs
  if (!selected) return
  const indices = selected.indices()
  if (!indices.length) {
    appendAgentLog({ type: 'warn', message: '请先选择要操作的职位。', agentName: 'System' })
    return
  }
  const updates = indices.map((idx) => {
    const row = selected.rows[idx]
    return { url: row.url, status }
  }).filter((item) => item.url)

  if (!updates.length) {
    appendAgentLog({ type: 'warn', message: '选中的职位缺少可用链接，无法更新。', agentName: 'System' })
    return
  }

  try {
    const result = await submitJobMutation('/api/jobs/status', { updates })
    appendAgentLog({
      type: 'info',
      message: `已更新 ${result.changed} 条职位状态为 ${status}。`,
      agentName: 'System',
    })
    await fetchJobs()
  } catch (err) {
    appendAgentLog({ type: 'error', message: `批量状态更新失败：${err.message || '未知错误'}`, agentName: 'System' })
  }
}

async function batchDelete() {
  const selected = window.appState.selectedJobs
  if (!selected) return
  const indices = selected.indices()
  if (!indices.length) {
    appendAgentLog({ type: 'warn', message: '请先选择要删除的职位。', agentName: 'System' })
    return
  }
  const urls = indices.map((idx) => selected.rows[idx]?.url).filter(Boolean)
  if (!urls.length) {
    appendAgentLog({ type: 'warn', message: '选中的职位缺少可用链接，无法删除。', agentName: 'System' })
    return
  }
  if (!window.confirm(`确定删除选中的 ${urls.length} 条职位记录吗？`)) {
    return
  }

  try {
    const result = await submitJobMutation('/api/jobs/delete', { urls })
    appendAgentLog({
      type: 'info',
      message: `已删除 ${result.deleted} 条职位记录。`,
      agentName: 'System',
    })
    await fetchJobs()
  } catch (err) {
    appendAgentLog({ type: 'error', message: `批量删除失败：${err.message || '未知错误'}`, agentName: 'System' })
  }
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
document.getElementById('batch-apply').addEventListener('click', () => batchUpdateStatus('applied'))
document.getElementById('batch-fail').addEventListener('click', () => batchUpdateStatus('failed'))
document.getElementById('batch-favorite').addEventListener('click', () => batchUpdateStatus('favorite'))
document.getElementById('batch-delete').addEventListener('click', batchDelete)

function renderDonut() {
  const jobs = window.appState.jobs
  const applied    = jobs.filter(j => j.status === 'applied').length
  const discovered = jobs.filter(j => j.status === 'discovered').length
  const failed     = jobs.filter(j => j.status === 'failed').length
  const favorite   = jobs.filter(j => j.status === 'favorite').length
  const other      = jobs.length - applied - discovered - failed - favorite

  const data = {
    labels: ['已投递', '待处理(发现)', '投递失败', '关注', '其他'],
    datasets: [{
      data: [applied, discovered, failed, favorite, other],
      backgroundColor: ['#22c55e', '#3b82f6', '#ef4444', '#f59e0b', '#64748b'],
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
    <div class="flex justify-between items-center"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-amber-500"></div><span class="text-slate-300">关注</span></div><span class="font-bold text-amber-400">${favorite}</span></div>
    <div class="flex justify-between items-center pt-2 border-t border-slate-700"><span class="text-slate-400">总计岗位</span><span class="font-bold text-white">${jobs.length}</span></div>
  `
}

// 导出到全局
window.fetchJobs = fetchJobs
window.renderJobs = renderJobs
window.renderDonut = renderDonut
