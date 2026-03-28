/*!
 * DOMPurify-lite for JobClaw offline frontend.
 * Provides a narrow subset: window.DOMPurify.sanitize(html)
 */
(function initDomPurifyLite(global) {
  if (!global || global.DOMPurify?.sanitize) return

  const ALLOWED_TAGS = new Set([
    'A', 'P', 'BR', 'STRONG', 'EM', 'B', 'I',
    'UL', 'OL', 'LI',
    'BLOCKQUOTE', 'CODE', 'PRE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  ])

  const ALLOWED_ATTRS = {
    A: new Set(['href', 'title', 'target', 'rel']),
  }

  const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:|\/|#|\.\.?\/)/i

  function sanitizeUrl(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return ''
    return SAFE_URL_PATTERN.test(normalized) ? normalized : ''
  }

  function sanitizeElement(el) {
    const tag = el.tagName
    if (!ALLOWED_TAGS.has(tag)) {
      const text = document.createTextNode(el.textContent || '')
      el.replaceWith(text)
      return
    }

    const allowed = ALLOWED_ATTRS[tag] || null
    const attrs = [...el.attributes]
    for (const attr of attrs) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'style') {
        el.removeAttribute(attr.name)
        continue
      }
      if (!allowed || !allowed.has(attr.name)) {
        el.removeAttribute(attr.name)
        continue
      }

      if (tag === 'A' && attr.name === 'href') {
        const safeHref = sanitizeUrl(attr.value)
        if (!safeHref) {
          el.removeAttribute('href')
        } else {
          el.setAttribute('href', safeHref)
        }
      }
    }

    if (tag === 'A') {
      const target = el.getAttribute('target')
      if (target === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer')
      }
    }
  }

  function walk(node) {
    const children = [...node.childNodes]
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        sanitizeElement(child)
        if (child.parentNode) walk(child)
        continue
      }
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove()
      }
    }
  }

  function sanitize(input) {
    const template = document.createElement('template')
    template.innerHTML = String(input || '')
    walk(template.content)
    return template.innerHTML
  }

  global.DOMPurify = { sanitize }
})(window)
