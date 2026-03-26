/**
 * 配置编辑器功能
 */

async function loadFile(name) {
  window.appState.currentFile = name
  document.querySelectorAll('.config-tab-btn').forEach(btn => {
    const active = btn.dataset.file === name
    if (active) {
      btn.className = 'config-tab-btn text-sm px-4 py-2 rounded-t-lg bg-slate-900 text-blue-400 border-t border-l border-r border-slate-700 font-bold'
    } else {
      btn.className = 'config-tab-btn text-sm px-4 py-2 rounded-t-lg bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200 border-t border-l border-r border-transparent transition-colors'
    }
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

// 标签页切换事件
document.querySelectorAll('.config-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => loadFile(btn.dataset.file))
})

// 保存按钮
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
      body: JSON.stringify({ content })
    })
    const json = await res.json()
    if (json.ok) {
      status.textContent = '✓ 保存成功'
      status.className = 'text-sm text-green-400'
    } else {
      status.textContent = `✗ ${json.error}`
      status.className = 'text-sm text-red-400'
    }
  } catch (e) {
    status.textContent = `✗ 网络错误`
    status.className = 'text-sm text-red-400'
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70')
    setTimeout(() => { 
      if(status.textContent === '✓ 保存成功') status.textContent = '' 
    }, 3000)
  }
})

// 导出到全局
window.loadFile = loadFile
