import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

marked.setOptions({ breaks: true, gfm: true })

function renderMessageHtml(text: string): string {
  if (!text.trim()) return ''
  const raw = marked.parse(text) as string
  return DOMPurify.sanitize(raw)
}

export function MarkdownMessage(props: {
  text: string
}) {
  return <div className="markdown-message" dangerouslySetInnerHTML={{ __html: renderMessageHtml(props.text) }} />
}
