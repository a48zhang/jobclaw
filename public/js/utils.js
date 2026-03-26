/**
 * 工具函数
 */

/**
 * XSS 防护：转义 HTML 特殊字符
 */
function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 获取状态样式
 */
function statusStyle(s) {
  if (s === 'applied')    return 'text-green-400 border-green-900'
  if (s === 'failed')     return 'text-red-400 border-red-900'
  if (s === 'discovered') return 'text-blue-400 border-blue-900'
  if (s === 'favorite')   return 'text-amber-400 border-amber-900'
  return 'text-slate-400 border-slate-700'
}

// 导出到全局
window.escHtml = escHtml
window.statusStyle = statusStyle
