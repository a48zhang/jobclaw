import type { ChatMessage } from '@/types'
import { MarkdownMessage } from '@/components/MarkdownMessage'

function ChatBubble({ message }: { message: ChatMessage }) {
  const showActor = message.tone !== 'user'
  const showTimestamp = message.tone === 'warning' || message.tone === 'error' || message.tone === 'system'

  return (
    <article className={`chat-bubble is-${message.tone}`}>
      {showActor || showTimestamp ? (
        <div className="chat-meta">
          <strong>{showActor ? message.actor : ''}</strong>
          <span>{showTimestamp ? message.timestamp : ''}</span>
        </div>
      ) : null}
      <div className="chat-text">
        <MarkdownMessage text={message.text} />
        {message.streaming ? <span className="typing-indicator">正在生成</span> : null}
      </div>
    </article>
  )
}

export function ChatPage(props: {
  active: boolean
  messages: ChatMessage[]
  input: string
  placeholder: string
  sending: boolean
  statusLine: string
  queueStatus: string
  setInput: (value: string) => void
  send: () => void
}) {
  const runtimeLine = props.queueStatus || props.statusLine

  return (
    <section
      id="tab-chat"
      className={`page-panel chat-page${props.active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="tab-chat-title"
      hidden={!props.active}
    >
      <h2 id="tab-chat-title" className="sr-only">对话</h2>
      <div className="chat-history" id="chat-history">
        {props.messages.length === 0 ? (
          <div className="chat-empty">
            <h3>说清你现在要推进什么</h3>
            <p>例如：帮我筛选远程后端岗位，先保留更匹配的机会。</p>
          </div>
        ) : (
          props.messages.map((message) => <ChatBubble key={message.id} message={message} />)
        )}
      </div>
      <div className="chat-footer">
        <div className="composer-card">
          <p id="chat-runtime-status" className="status-line" aria-live="polite">{runtimeLine}</p>
          <div className="composer-row">
            <label htmlFor="chat-input" className="sr-only">输入当前任务</label>
            <textarea
              id="chat-input"
              rows={3}
              value={props.input}
              onChange={(event) => props.setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  props.send()
                }
              }}
              placeholder={props.placeholder}
            />
            <button id="chat-send" type="button" className="primary-button composer-send" disabled={props.sending} onClick={props.send}>
              {props.sending ? '发送中...' : '发送'}
            </button>
          </div>
          <p id="chat-hints" className="subtle-text">按 Enter 发送，Shift+Enter 换行</p>
        </div>
      </div>
    </section>
  )
}
