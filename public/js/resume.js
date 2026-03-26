/**
 * 简历工具功能
 */

// 上传简历
document.getElementById('upload-resume').addEventListener('click', async () => {
  const fileInput = document.getElementById('resume-upload-file')
  const status = document.getElementById('resume-upload-status')
  const btn = document.getElementById('upload-resume')
  const file = fileInput.files && fileInput.files[0]

  if (!file) {
    status.textContent = '请先选择一个 PDF 文件'
    status.className = 'text-xs text-red-400 mt-3'
    return
  }

  const form = new FormData()
  form.set('file', file)

  btn.disabled = true
  btn.classList.add('opacity-70', 'cursor-not-allowed')
  status.textContent = '正在上传 PDF...'
  status.className = 'text-xs text-yellow-400 mt-3'

  try {
    const res = await fetch('/api/resume/upload', {
      method: 'POST',
      body: form,
    })
    const json = await res.json()
    if (json.ok) {
      status.textContent = '上传成功。现在可以在聊天区输入"评价刚上传的简历"'
      status.className = 'text-xs text-green-400 mt-3'
      appendAgentLog({
        type: 'info',
        message: `已上传 PDF 简历：${json.name} (${json.path})`,
        agentName: 'System'
      })
    } else {
      status.textContent = `上传失败: ${json.error || '未知错误'}`
      status.className = 'text-xs text-red-400 mt-3'
    }
  } catch (e) {
    status.textContent = `上传异常: ${e.message}`
    status.className = 'text-xs text-red-400 mt-3'
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70', 'cursor-not-allowed')
  }
})

// 评价已上传的简历
document.getElementById('review-uploaded-resume').addEventListener('click', async () => {
  const status = document.getElementById('resume-upload-status')
  const btn = document.getElementById('review-uploaded-resume')

  btn.disabled = true
  btn.classList.add('opacity-70', 'cursor-not-allowed')
  status.textContent = '正在发起简历评价...'
  status.className = 'text-xs text-yellow-400 mt-3'

  try {
    const res = await fetch('/api/resume/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const json = await res.json()
    if (json.ok) {
      document.querySelector('[data-target="tab-chat"]').click()
      status.textContent = '已提交简历评价任务，请在对话区查看结果。'
      status.className = 'text-xs text-green-400 mt-3'
      appendAgentLog({
        type: 'info',
        message: `已提交上传 PDF 简历评价任务：${json.path || 'data/uploads/resume-upload.pdf'}`,
        agentName: 'System'
      })
    } else {
      status.textContent = `简历评价发起失败: ${json.error || '未知错误'}`
      status.className = 'text-xs text-red-400 mt-3'
    }
  } catch (e) {
    status.textContent = `简历评价发起异常: ${e.message}`
    status.className = 'text-xs text-red-400 mt-3'
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70', 'cursor-not-allowed')
  }
})

// 生成简历
document.getElementById('gen-resume').addEventListener('click', async () => {
  const btn = document.getElementById('gen-resume')
  const preview = document.getElementById('resume-preview')
  const previewEmpty = document.getElementById('resume-preview-empty')
  
  btn.disabled = true
  btn.classList.add('opacity-70', 'cursor-not-allowed')
  btn.innerHTML = '<span class="animate-spin inline-block">⚙️</span> 正在调用 Agent 编译...'

  try {
    const res = await fetch('/api/resume/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const json = await res.json()
    if (json.ok) {
      document.querySelector('[data-target="tab-chat"]').click()
      appendAgentLog({ type: 'info', message: '已提交简历生成任务，请关注后续日志。', agentName: 'System' })
      if (preview) preview.classList.add('hidden')
      if (previewEmpty) previewEmpty.classList.remove('hidden')
    } else {
      alert('任务提交失败: ' + json.error)
    }
  } catch (e) { 
    alert('网络错误: ' + e.message)
  } finally {
    btn.disabled = false
    btn.classList.remove('opacity-70', 'cursor-not-allowed')
    btn.innerHTML = '<span>⚙️</span> 生成简历 PDF'
  }
})

function showResumeReady(path) {
  const preview = document.getElementById('resume-preview')
  const previewEmpty = document.getElementById('resume-preview-empty')
  const link = document.getElementById('resume-link')
  if (link && path) link.href = path
  if (preview) preview.classList.remove('hidden')
  if (previewEmpty) previewEmpty.classList.add('hidden')
}

window.showResumeReady = showResumeReady
