/**
 * 职位看板功能
 */

const KNOWN_STATUSES = ['discovered', 'applied', 'failed', 'favorite']
const STATUS_LABELS = {
  all: '全部',
  discovered: '待处理',
  applied: '已投递',
  failed: '投递失败',
  favorite: '关注',
  other: '其他',
}

const jobBoardState = {
  filters: {
    status: 'all',
    keyword: '',
  },
  selectedKeys: new Set(),
  allRowsMap: new Map(),
  controlsMounted: false,
  sortMounted: false,
  donutSegments: [],
  donutGeometry: null,
  donutClickBound: false,
  detail: {
    panel: null,
    activeKey: null,
  },
}

function notify(type, message) {
  appendAgentLog({ type, message, agentName: 'System' })
  if (typeof window.showToast === 'function') {
    window.showToast({ type, message })
  }
}

function requestConfirm(options) {
  if (typeof window.showConfirm === 'function') {
    return window.showConfirm(options)
  }
  return Promise.resolve(false)
}

function inferJobKey(row, index) {
  if (typeof row.url === 'string' && row.url.trim()) return `url:${row.url}`
  return `row:${index}:${row.company || ''}:${row.title || ''}:${row.time || ''}`
}

function normalizeRows(rawRows) {
  return rawRows.map((row, index) => ({
    ...row,
    _key: inferJobKey(row, index),
    _text: `${row.company || ''} ${row.title || ''}`.toLowerCase(),
  }))
}

function sortRows(rows) {
  const col = window.appState.sortCol || 'time'
  const asc = Boolean(window.appState.sortAsc)

  const compareByText = (a, b) => {
    const av = String(a || '')
    const bv = String(b || '')
    return asc ? av.localeCompare(bv) : bv.localeCompare(av)
  }

  return [...rows].sort((a, b) => {
    if (col === 'time') {
      const at = Date.parse(String(a.time || ''))
      const bt = Date.parse(String(b.time || ''))
      const aTime = Number.isFinite(at) ? at : 0
      const bTime = Number.isFinite(bt) ? bt : 0
      return asc ? aTime - bTime : bTime - aTime
    }
    return compareByText(a[col], b[col])
  })
}

function applyFilters(rows) {
  const status = jobBoardState.filters.status
  const keyword = jobBoardState.filters.keyword.trim().toLowerCase()

  return rows.filter((row) => {
    const statusMatch =
      status === 'all'
        ? true
        : status === 'other'
        ? !KNOWN_STATUSES.includes(String(row.status || ''))
        : String(row.status || '') === status

    if (!statusMatch) return false
    if (!keyword) return true
    return row._text.includes(keyword)
  })
}

function pruneSelection() {
  for (const key of [...jobBoardState.selectedKeys]) {
    if (!jobBoardState.allRowsMap.has(key)) {
      jobBoardState.selectedKeys.delete(key)
    }
  }
}

function getSelectedRows() {
  pruneSelection()
  return [...jobBoardState.selectedKeys]
    .map((key) => jobBoardState.allRowsMap.get(key))
    .filter(Boolean)
}

function setBatchButtonsDisabled(disabled) {
  const buttonIds = ['batch-apply', 'batch-fail', 'batch-favorite', 'batch-delete']
  for (const id of buttonIds) {
    const button = document.getElementById(id)
    if (!button) continue
    button.disabled = disabled
    button.classList.toggle('opacity-50', disabled)
    button.classList.toggle('cursor-not-allowed', disabled)
  }
}

function updateBatchToolbarVisibility(selectedTotal) {
  const toolbar = document.getElementById('jobs-batch-toolbar')
  const selectedHint = document.getElementById('jobs-batch-hint')
  const hasSelection = selectedTotal > 0
  if (selectedHint) {
    selectedHint.textContent = hasSelection
      ? `已选择 ${selectedTotal} 条职位`
      : '未选择职位时仅保留“刷新”操作'
  }
  if (!toolbar) return
  toolbar.classList.toggle('hidden', !hasSelection)
  toolbar.setAttribute('aria-hidden', hasSelection ? 'false' : 'true')
}

function updateSelectionSummary(visibleKeys) {
  const selectedCount = document.getElementById('selected-count')
  const selectAll = document.getElementById('select-all')
  const visibleTotal = visibleKeys.length
  let selectedVisible = 0
  let selectedTotal = 0

  for (const key of jobBoardState.selectedKeys) {
    if (jobBoardState.allRowsMap.has(key)) selectedTotal += 1
  }
  for (const key of visibleKeys) {
    if (jobBoardState.selectedKeys.has(key)) selectedVisible += 1
  }

  if (selectedCount) {
    selectedCount.textContent = `已选 ${selectedTotal}`
  }
  if (selectAll) {
    selectAll.checked = visibleTotal > 0 && selectedVisible === visibleTotal
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleTotal
    selectAll.disabled = visibleTotal === 0
  }
  updateBatchToolbarVisibility(selectedTotal)
  setBatchButtonsDisabled(selectedTotal === 0)
  updateJobsOverview(normalizeRows(window.appState.jobs || []), applyFilters(sortRows(normalizeRows(window.appState.jobs || []))))
}

function setJobsRailCollapsed(collapsed) {
  const rail = document.querySelector('.jobs-side-rail')
  if (!rail) return
  rail.classList.toggle('is-collapsed', Boolean(collapsed))
}

function ensureJobDetailPanel() {
  if (jobBoardState.detail.panel) return jobBoardState.detail.panel
  const anchor = document.getElementById('job-detail-anchor')
  if (!anchor) return null
  const panel = document.createElement('div')
  panel.id = 'job-detail-panel'
  panel.className =
    'rounded-xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-200 shadow-inner min-h-[150px]'
  panel.innerHTML = `
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">当前选中职位</p>
    <div id="job-detail-body" class="flex flex-col gap-3 text-slate-300">
      <p>点击任意职位行查看公司、角色、状态、更新时间以及可点击的原始链接。</p>
      <div class="flex flex-wrap gap-2 text-xs text-slate-400">
        <span id="job-detail-status" class="rounded-full border border-slate-600 px-2 py-0.5">状态加载中</span>
        <span id="job-detail-time">-</span>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 mt-3" id="job-detail-actions"></div>
  `
  anchor.appendChild(panel)
  jobBoardState.detail.panel = panel
  return panel
}

function formatDetailValue(value) {
  if (value === undefined || value === null || value === '') return '未提供'
  return String(value)
}

function clearJobDetailPanel() {
  jobBoardState.detail.activeKey = null
  const panel = ensureJobDetailPanel()
  if (!panel) return
  const body = panel.querySelector('#job-detail-body')
  const statusBadge = panel.querySelector('#job-detail-status')
  const time = panel.querySelector('#job-detail-time')
  const actions = panel.querySelector('#job-detail-actions')
  if (body) {
    body.innerHTML = '<p class="text-slate-400">先在左侧筛选并点开一条职位，这里会展示详情和快捷操作。</p>'
  }
  if (statusBadge) statusBadge.textContent = '暂无状态'
  if (time) time.textContent = '更新时间：-'
  if (actions) actions.innerHTML = ''
  document
    .querySelectorAll('#job-tbody tr.job-row.selected')
    .forEach((row) => row.classList.remove('selected', 'bg-slate-700/30'))
}

function highlightJobRow(key) {
  document
    .querySelectorAll('#job-tbody tr.job-row.selected')
    .forEach((row) => row.classList.remove('selected', 'bg-slate-700/30'))
  if (!key) return
  const selectorValue =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(key)
      : String(key).replace(/["\\\\#.:\\[\\]]/g, '\\\\$&')
  const row = document.querySelector(`#job-tbody tr.job-row[data-job-key="${selectorValue}"]`)
  if (row) row.classList.add('selected', 'bg-slate-700/30')
}

function updateJobDetailPanel(row) {
  const panel = ensureJobDetailPanel()
  if (!panel) return
  const body = panel.querySelector('#job-detail-body')
  const statusBadge = panel.querySelector('#job-detail-status')
  const time = panel.querySelector('#job-detail-time')
  const actions = panel.querySelector('#job-detail-actions')
  if (!row) {
    clearJobDetailPanel()
    return
  }
  jobBoardState.detail.activeKey = row._key
  if (body) {
    body.innerHTML = ''

    const companyEl = document.createElement('h3')
    companyEl.className = 'text-base font-semibold text-slate-100'
    companyEl.textContent = formatDetailValue(row.company)
    body.appendChild(companyEl)

    const titleEl = document.createElement('p')
    titleEl.className = 'text-sm text-slate-300'
    titleEl.textContent = formatDetailValue(row.title)
    body.appendChild(titleEl)

    const linkEl = document.createElement('p')
    linkEl.className = 'text-xs text-slate-400 break-words'
    const linkLabel = document.createElement('span')
    linkLabel.textContent = '来源链接：'
    linkEl.appendChild(linkLabel)
    if (row.url) {
      const linkAnchor = document.createElement('a')
      linkAnchor.href = row.url
      linkAnchor.target = '_blank'
      linkAnchor.rel = 'noopener noreferrer'
      linkAnchor.textContent = row.url
      linkAnchor.className = 'text-blue-300 underline decoration-dashed'
      linkEl.appendChild(linkAnchor)
    } else {
      const placeholder = document.createElement('span')
      placeholder.textContent = '暂无'
      linkEl.appendChild(placeholder)
    }
    body.appendChild(linkEl)

    const extraNote = (row.description || row.notes || '').trim()
    if (extraNote) {
      const detailParagraph = document.createElement('p')
      detailParagraph.className = 'text-[13px] text-slate-400 break-words'
      detailParagraph.textContent = extraNote
      body.appendChild(detailParagraph)
    }
  }
  if (statusBadge) {
    statusBadge.textContent = STATUS_LABELS[row.status] || row.status || '未知'
  }
  if (time) {
    const parsed = Date.parse(row.time || '')
    time.textContent =
      Number.isFinite(parsed) ? `更新时间：${new Date(parsed).toLocaleString()}` : `更新时间：${row.time || '未知'}`
  }
  if (actions) {
    actions.innerHTML = ''
    const link = document.createElement('a')
    const baseClass =
      'text-xs rounded-md border border-slate-600 px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400'
    if (row.url) {
      link.href = row.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = '打开职位原文'
      link.className = `${baseClass} hover:border-blue-400 hover:text-blue-200`
    } else {
      link.href = 'javascript:void(0)'
      link.textContent = '暂无链接'
      link.className = `${baseClass} text-slate-500 border-slate-700 cursor-not-allowed`
      link.setAttribute('aria-disabled', 'true')
      link.tabIndex = -1
    }
    actions.appendChild(link)
  }
  highlightJobRow(row._key)
}

function ensureFilterControls() {
  if (jobBoardState.controlsMounted) return

  const anchor = document.getElementById('jobs-filter-anchor')
  if (!anchor) return

  const controls = document.createElement('div')
  controls.id = 'jobs-filter-controls'
  controls.className = 'grid grid-cols-1 gap-2 rounded-lg border border-slate-700 bg-slate-900/80 p-3 md:grid-cols-[160px_1fr_auto]'
  controls.innerHTML = `
    <label class="text-xs text-slate-300 flex flex-col gap-1">
      <span>状态筛选</span>
      <select id="jobs-status-filter" class="rounded-md border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100">
        <option value="all">全部</option>
        <option value="discovered">待处理</option>
        <option value="applied">已投递</option>
        <option value="failed">投递失败</option>
        <option value="favorite">关注</option>
        <option value="other">其他</option>
      </select>
    </label>
    <label class="text-xs text-slate-300 flex flex-col gap-1">
      <span>关键词</span>
      <input id="jobs-keyword-filter" type="search" class="rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="按公司或职位搜索" />
    </label>
    <div class="flex items-end gap-2">
      <button id="jobs-filter-reset" type="button" class="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">清空筛选</button>
      <span id="jobs-filter-summary" class="text-xs text-slate-400"></span>
    </div>
  `

  anchor.appendChild(controls)

  const statusInput = document.getElementById('jobs-status-filter')
  const keywordInput = document.getElementById('jobs-keyword-filter')
  const resetBtn = document.getElementById('jobs-filter-reset')

  if (statusInput) {
    statusInput.value = jobBoardState.filters.status
    statusInput.addEventListener('change', () => {
      jobBoardState.filters.status = statusInput.value || 'all'
      renderJobs()
      renderDonut()
    })
  }

  if (keywordInput) {
    keywordInput.value = jobBoardState.filters.keyword
    keywordInput.addEventListener('input', () => {
      jobBoardState.filters.keyword = keywordInput.value || ''
      renderJobs()
    })
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', resetFilters)
  }

  jobBoardState.controlsMounted = true
}

function openConfigTab() {
  const button = document.querySelector('[data-target="tab-config"]')
  if (button) button.click()
}

function updateJobsOverview(rows, visibleRows) {
  const total = document.getElementById('jobs-overview-total')
  const discovered = document.getElementById('jobs-overview-discovered')
  const visible = document.getElementById('jobs-overview-visible')
  const note = document.getElementById('jobs-overview-note')
  if (total) total.textContent = String(rows.length)
  if (discovered) {
    discovered.textContent = String(rows.filter((row) => row.status === 'discovered').length)
  }
  if (visible) visible.textContent = String(visibleRows.length)
  if (note) {
    if (!rows.length) {
      note.textContent = '当前还没有职位数据。先运行职位搜索或点击“刷新”，把候选职位拉进来再开始处理。'
    } else if (!visibleRows.length) {
      note.textContent = '当前筛选条件下没有结果。建议先清空筛选，再回到待处理职位继续推进。'
    } else if (jobBoardState.selectedKeys.size > 0) {
      note.textContent = `当前已选择 ${jobBoardState.selectedKeys.size} 条职位，可以直接执行批量推进。`
    } else if (jobBoardState.filters.status !== 'all' || jobBoardState.filters.keyword.trim()) {
      note.textContent = `当前筛出 ${visibleRows.length} 条职位。建议先看右侧详情，再决定是否批量推进。`
    } else {
      const discoveredCount = rows.filter((row) => row.status === 'discovered').length
      note.textContent = discoveredCount > 0
        ? `当前有 ${discoveredCount} 条待处理职位。优先处理它们，能最快形成闭环。`
        : '当前没有待处理职位。你可以按状态回看历史结果，或刷新获取新的职位列表。'
    }
  }
}

function updateFilterSummary(total, visible) {
  const summary = document.getElementById('jobs-filter-summary')
  if (!summary) return
  if (!total) {
    summary.textContent = '当前没有职位数据，请刷新或运行职位搜索任务后再回来查看'
    return
  }
  const statusLabel = STATUS_LABELS[jobBoardState.filters.status] || '全部'
  const keyword = (jobBoardState.filters.keyword || '').trim()
  const filterSuffix = keyword ? ` + 关键词 "${keyword}"` : ''
  if (visible === total) {
    summary.textContent = `共 ${total} 条（${statusLabel}${filterSuffix}）`
    return
  }
  summary.textContent = `筛出 ${visible}/${total} 条（${statusLabel}${filterSuffix}）`
}

function syncFilterInputs() {
  const statusInput = document.getElementById('jobs-status-filter')
  const keywordInput = document.getElementById('jobs-keyword-filter')
  if (statusInput) statusInput.value = jobBoardState.filters.status
  if (keywordInput) keywordInput.value = jobBoardState.filters.keyword
}

function resetFilters() {
  jobBoardState.filters.status = 'all'
  jobBoardState.filters.keyword = ''
  syncFilterInputs()
  renderJobs()
  renderDonut()
}

function applyStatusFilter(status) {
  const next = status || 'all'
  jobBoardState.filters.status = next
  syncFilterInputs()
  renderJobs()
  renderDonut()
}

async function fetchJobs() {
  ensureFilterControls()

  const btn = document.getElementById('refresh-jobs')
  try {
    if (btn) {
      btn.disabled = true
      btn.textContent = '刷新中...'
      btn.classList.add('opacity-70', 'cursor-not-allowed')
    }

    const res = await fetch('/api/jobs')
    const json = await res.json()
    window.appState.jobs = Array.isArray(json) ? json : []
    renderJobs()

    if (document.getElementById('tab-jobs')?.classList.contains('active')) {
      renderDonut()
    }
  } catch {
    notify('error', '职位刷新失败，请检查网络或服务状态。')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = '刷新'
      btn.classList.remove('opacity-70', 'cursor-not-allowed')
    }
  }
}

function renderJobs() {
  ensureFilterControls()

  const tbody = document.getElementById('job-tbody')
  if (!tbody) return

  const rows = normalizeRows(window.appState.jobs || [])
  const sortedRows = sortRows(rows)
  const filteredRows = applyFilters(sortedRows)
  updateJobsOverview(sortedRows, filteredRows)
  jobBoardState.allRowsMap = new Map(sortedRows.map((row) => [row._key, row]))
  pruneSelection()
  updateFilterSummary(sortedRows.length, filteredRows.length)

  if (!sortedRows.length) {
    setJobsRailCollapsed(true)
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-slate-400">
          <p class="text-sm">还没有职位数据。</p>
          <p class="mt-1 text-xs text-slate-500">点击“刷新”或先运行职位搜索任务后再回来查看。</p>
          <p class="text-xs text-slate-400">建议先完善 targets.md，然后运行职位搜索获取职位列表。</p>
          <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button id="jobs-empty-refresh" type="button" class="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
              立即刷新
            </button>
            <button id="jobs-empty-open-config" type="button" class="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
              去补 targets.md
            </button>
          </div>
        </td>
      </tr>
    `
    updateSelectionSummary([])
    window.appState.selectedJobs = { rows: [], selectedRows: () => [], keys: () => [] }
    clearJobDetailPanel()
    document.getElementById('jobs-empty-refresh')?.addEventListener('click', fetchJobs)
    document.getElementById('jobs-empty-open-config')?.addEventListener('click', openConfigTab)
    return
  }

  if (!filteredRows.length) {
    setJobsRailCollapsed(false)
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-slate-400">
          <p class="text-sm">当前筛选条件下无结果。</p>
          <button id="jobs-empty-reset" type="button" class="mt-2 rounded-md border border-slate-600 bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700">
            清空筛选
          </button>
        </td>
      </tr>
    `
    clearJobDetailPanel()
    document.getElementById('jobs-empty-reset')?.addEventListener('click', resetFilters)
    updateSelectionSummary([])
    window.appState.selectedJobs = { rows: sortedRows, selectedRows: () => getSelectedRows(), keys: () => [...jobBoardState.selectedKeys] }
    return
  }

  setJobsRailCollapsed(false)
  tbody.innerHTML = filteredRows.map((row) => `
    <tr class="job-row group transition-colors hover:bg-slate-700/30" data-job-key="${escHtml(row._key)}" tabindex="0">
      <td class="py-3 px-4">
        <input type="checkbox" class="job-select accent-blue-500" data-key="${escHtml(row._key)}" ${jobBoardState.selectedKeys.has(row._key) ? 'checked' : ''} />
      </td>
      <td class="py-3 px-4 font-semibold text-slate-300">${escHtml(row.company || '')}</td>
      <td class="py-3 px-4 text-slate-300">${escHtml(row.title || '')}</td>
      <td class="py-3 px-4">
        ${row.url
          ? `<a href="${escHtml(row.url)}" target="_blank" rel="noopener noreferrer" class="underline text-blue-400 opacity-80 hover:text-blue-300 group-hover:opacity-100">查看</a>`
          : '<span class="text-slate-600">—</span>'}
      </td>
      <td class="py-3 px-4">
        <span class="rounded border bg-slate-800 px-2 py-1 text-xs font-medium ${statusStyle(row.status)}">${escHtml(row.status || 'unknown')}</span>
      </td>
      <td class="py-3 px-4 text-xs text-slate-400">${escHtml(row.time || '')}</td>
    </tr>
  `).join('')

  bindSelectionHandlers(filteredRows)
  window.appState.selectedJobs = {
    rows: sortedRows,
    selectedRows: () => getSelectedRows(),
    keys: () => [...jobBoardState.selectedKeys],
  }
  attachJobRowHandlers(filteredRows)
}

function attachJobRowHandlers(filteredRows) {
  const tbody = document.getElementById('job-tbody')
  if (!tbody) return
  const rows = [...tbody.querySelectorAll('tr.job-row')]
  rows.forEach((rowElement) => {
    const activateRow = () => {
      const key = rowElement.dataset.jobKey
      if (!key) return
      const record = jobBoardState.allRowsMap.get(key)
      updateJobDetailPanel(record)
    }
    rowElement.tabIndex = 0
    rowElement.onclick = activateRow
    rowElement.onkeydown = (event) => {
      if (document.activeElement !== rowElement) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        activateRow()
      }
    }
  })

  const activeKey = jobBoardState.detail.activeKey
  if (activeKey) {
    const activeRow = jobBoardState.allRowsMap.get(activeKey)
    if (activeRow && filteredRows.some((entry) => entry._key === activeRow._key)) {
      updateJobDetailPanel(activeRow)
      return
    }
  }

  updateJobDetailPanel(filteredRows[0])
}

function bindSelectionHandlers(visibleRows) {
  const selectAll = document.getElementById('select-all')
  const selects = [...document.querySelectorAll('.job-select')]
  const visibleKeys = visibleRows.map((row) => row._key)

  for (const input of selects) {
    input.addEventListener('change', () => {
      const key = String(input.dataset.key || '')
      if (!key) return
      if (input.checked) {
        jobBoardState.selectedKeys.add(key)
      } else {
        jobBoardState.selectedKeys.delete(key)
      }
      updateSelectionSummary(visibleKeys)
    })
  }

  if (selectAll) {
    selectAll.onchange = () => {
      const checked = Boolean(selectAll.checked)
      for (const key of visibleKeys) {
        if (checked) {
          jobBoardState.selectedKeys.add(key)
        } else {
          jobBoardState.selectedKeys.delete(key)
        }
      }
      for (const input of selects) {
        input.checked = checked
      }
      updateSelectionSummary(visibleKeys)
    }
  }

  updateSelectionSummary(visibleKeys)
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
  const selectedRows = getSelectedRows()
  if (!selectedRows.length) {
    notify('warn', '请先选择要操作的职位。')
    return
  }

  const updates = selectedRows
    .map((row) => ({ url: row.url, status }))
    .filter((item) => typeof item.url === 'string' && item.url)

  if (!updates.length) {
    notify('warn', '选中的职位缺少可用链接，无法更新。')
    return
  }

  try {
    const result = await submitJobMutation('/api/jobs/status', { updates })
    notify('success', `已更新 ${result.changed} 条职位状态为 ${STATUS_LABELS[status] || status}。`)
    jobBoardState.selectedKeys.clear()
    await fetchJobs()
  } catch (error) {
    notify('error', `批量状态更新失败：${error.message || '未知错误'}`)
  }
}

async function batchDelete() {
  const selectedRows = getSelectedRows()
  if (!selectedRows.length) {
    notify('warn', '请先选择要删除的职位。')
    return
  }

  const urls = selectedRows.map((row) => row.url).filter((url) => typeof url === 'string' && url)
  if (!urls.length) {
    notify('warn', '选中的职位缺少可用链接，无法删除。')
    return
  }

  const confirmed = await requestConfirm({
    title: '删除职位记录',
    message: `确定删除选中的 ${urls.length} 条职位记录吗？该操作不可撤销。`,
    confirmText: '确认删除',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return

  try {
    const result = await submitJobMutation('/api/jobs/delete', { urls })
    notify('success', `已删除 ${result.deleted} 条职位记录。`)
    jobBoardState.selectedKeys.clear()
    await fetchJobs()
  } catch (error) {
    notify('error', `批量删除失败：${error.message || '未知错误'}`)
  }
}

function getSortableHeaderCells() {
  return [...document.querySelectorAll('thead th.sortable-th')]
    .filter((th) => Boolean(th.dataset.col))
}

function getSortTriggerButton(th) {
  return th.querySelector('button[data-sort-trigger]') || th.querySelector('button')
}

function updateSortIndicators() {
  const activeCol = window.appState.sortCol
  const asc = Boolean(window.appState.sortAsc)
  for (const th of getSortableHeaderCells()) {
    const trigger = getSortTriggerButton(th)
    const triggerText = trigger?.textContent || ''
    const fallbackText = th.textContent || ''
    const baseLabel = th.dataset.baseLabel || triggerText.replace(/[↑↓⇅]/g, '').trim() || fallbackText.replace(/[↑↓⇅]/g, '').trim()
    th.dataset.baseLabel = baseLabel

    const isActive = th.dataset.col === activeCol
    const icon = isActive ? (asc ? '↑' : '↓') : '⇅'
    th.setAttribute('aria-sort', isActive ? (asc ? 'ascending' : 'descending') : 'none')

    if (trigger) {
      trigger.dataset.baseLabel = baseLabel
      trigger.setAttribute('data-sort-trigger', 'true')
      trigger.textContent = `${baseLabel} ${icon}`
      trigger.setAttribute('aria-label', `${baseLabel} 排序`)
    } else {
      th.textContent = `${baseLabel} ${icon}`
    }
  }
}

function initSortableHeaders() {
  if (jobBoardState.sortMounted) return

  for (const th of getSortableHeaderCells()) {
    const trigger = getSortTriggerButton(th)
    const baseLabel = th.dataset.baseLabel || (trigger?.textContent || th.textContent || '').replace(/[↑↓⇅]/g, '').trim()
    th.dataset.baseLabel = baseLabel
    th.setAttribute('aria-sort', 'none')

    if (trigger) {
      trigger.dataset.baseLabel = baseLabel
      trigger.setAttribute('data-sort-trigger', 'true')
      trigger.setAttribute('type', 'button')
      trigger.setAttribute('aria-label', `${baseLabel} 排序`)
    }

    const toggleSort = () => {
      const col = th.dataset.col
      if (!col) return
      if (window.appState.sortCol === col) {
        window.appState.sortAsc = !window.appState.sortAsc
      } else {
        window.appState.sortCol = col
        window.appState.sortAsc = true
      }
      updateSortIndicators()
      renderJobs()
    }

    if (trigger) {
      trigger.addEventListener('click', toggleSort)
    } else {
      th.addEventListener('click', toggleSort)
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggleSort()
        }
      })
    }
  }

  updateSortIndicators()
  jobBoardState.sortMounted = true
}

function drawDonut(canvas, slices) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const cssSize = Math.max(180, Math.floor(canvas.clientWidth || 250))
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(cssSize * dpr)
  canvas.height = Math.floor(cssSize * dpr)
  canvas.style.width = `${cssSize}px`
  canvas.style.height = `${cssSize}px`

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)

  const center = cssSize / 2
  const outerRadius = cssSize * 0.43
  const innerRadius = cssSize * 0.27
  const total = slices.reduce((sum, item) => sum + item.value, 0)

  const startOffset = -Math.PI / 2
  let cursor = startOffset
  const segments = []

  if (total <= 0) {
    ctx.beginPath()
    ctx.arc(center, center, outerRadius, 0, Math.PI * 2)
    ctx.arc(center, center, innerRadius, Math.PI * 2, 0, true)
    ctx.closePath()
    ctx.fillStyle = '#334155'
    ctx.fill()
  } else {
    for (const item of slices) {
      if (item.value <= 0) continue
      const arc = (item.value / total) * Math.PI * 2
      const next = cursor + arc

      ctx.beginPath()
      ctx.arc(center, center, outerRadius, cursor, next)
      ctx.arc(center, center, innerRadius, next, cursor, true)
      ctx.closePath()
      ctx.fillStyle = item.color
      ctx.fill()

      segments.push({
        status: item.status,
        start: cursor,
        end: next,
      })
      cursor = next
    }
  }

  ctx.beginPath()
  ctx.arc(center, center, innerRadius - 1, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()

  ctx.fillStyle = '#e2e8f0'
  ctx.font = '600 13px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(total), center, center - 5)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '500 11px sans-serif'
  ctx.fillText('总职位', center, center + 12)

  jobBoardState.donutSegments = segments
  jobBoardState.donutGeometry = { center, innerRadius, outerRadius }
}

function normalizeAngleForDonut(value) {
  let angle = value
  while (angle < -Math.PI / 2) angle += Math.PI * 2
  while (angle >= Math.PI * 1.5) angle -= Math.PI * 2
  return angle
}

function ensureDonutClickHandler(canvas) {
  if (jobBoardState.donutClickBound) return
  canvas.addEventListener('click', (event) => {
    const geometry = jobBoardState.donutGeometry
    if (!geometry || !jobBoardState.donutSegments.length) return

    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const dx = x - geometry.center
    const dy = y - geometry.center
    const radius = Math.hypot(dx, dy)
    if (radius < geometry.innerRadius || radius > geometry.outerRadius) return

    const angle = normalizeAngleForDonut(Math.atan2(dy, dx))
    const segment = jobBoardState.donutSegments.find((item) => angle >= item.start && angle < item.end)
    if (!segment) return
    applyStatusFilter(segment.status || 'all')
  })
  jobBoardState.donutClickBound = true
}

function renderDonut() {
  const jobs = Array.isArray(window.appState.jobs) ? window.appState.jobs : []
  const applied = jobs.filter((job) => job.status === 'applied').length
  const discovered = jobs.filter((job) => job.status === 'discovered').length
  const failed = jobs.filter((job) => job.status === 'failed').length
  const favorite = jobs.filter((job) => job.status === 'favorite').length
  const other = jobs.length - applied - discovered - failed - favorite

  const canvas = document.getElementById('donut-chart')
  if (canvas && canvas.offsetParent !== null) {
    drawDonut(canvas, [
      { status: 'applied', value: applied, color: '#22c55e' },
      { status: 'discovered', value: discovered, color: '#3b82f6' },
      { status: 'failed', value: failed, color: '#ef4444' },
      { status: 'favorite', value: favorite, color: '#f59e0b' },
      { status: 'other', value: other, color: '#64748b' },
    ])
    ensureDonutClickHandler(canvas)
  }

  const legend = document.getElementById('stats-legend')
  if (!legend) return
  const statsCard = legend.closest('.jobs-stats-card')
  if (statsCard) {
    statsCard.classList.toggle('is-empty', jobs.length === 0)
  }

  const rows = [
    { label: '全部', value: jobs.length, status: 'all', dot: 'bg-slate-400', valueClass: 'text-slate-100' },
    { label: '已投递', value: applied, status: 'applied', dot: 'bg-green-500', valueClass: 'text-green-400' },
    { label: '待处理', value: discovered, status: 'discovered', dot: 'bg-blue-500', valueClass: 'text-blue-400' },
    { label: '投递失败', value: failed, status: 'failed', dot: 'bg-red-500', valueClass: 'text-red-400' },
    { label: '关注', value: favorite, status: 'favorite', dot: 'bg-amber-500', valueClass: 'text-amber-400' },
    { label: '其他', value: other, status: 'other', dot: 'bg-slate-500', valueClass: 'text-slate-300' },
  ]

  legend.innerHTML = rows.map((item) => {
    const active = jobBoardState.filters.status === item.status
    const activeClass = active ? 'border-blue-500/60 bg-slate-800' : 'border-transparent bg-transparent'
    return `
      <button type="button" data-status="${item.status}" class="w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-slate-800/70 ${activeClass}">
        <span class="flex items-center justify-between">
          <span class="flex items-center gap-2">
            <span class="h-3 w-3 rounded-full ${item.dot}"></span>
            <span class="text-slate-300">${item.label}</span>
          </span>
          <span class="font-bold ${item.valueClass}">${item.value}</span>
        </span>
      </button>
    `
  }).join('')

  for (const button of legend.querySelectorAll('button[data-status]')) {
    button.addEventListener('click', () => {
      applyStatusFilter(button.dataset.status || 'all')
    })
  }
}

initSortableHeaders()
ensureFilterControls()

document.getElementById('refresh-jobs')?.addEventListener('click', fetchJobs)
document.getElementById('batch-apply')?.addEventListener('click', () => batchUpdateStatus('applied'))
document.getElementById('batch-fail')?.addEventListener('click', () => batchUpdateStatus('failed'))
document.getElementById('batch-favorite')?.addEventListener('click', () => batchUpdateStatus('favorite'))
document.getElementById('batch-delete')?.addEventListener('click', batchDelete)

// 导出到全局
window.fetchJobs = fetchJobs
window.renderJobs = renderJobs
window.renderDonut = renderDonut
