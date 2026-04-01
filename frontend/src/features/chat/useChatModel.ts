import { useEffect, useRef, useState } from 'react'
import { formatMissingFields, sanitizeMessageText } from '@/lib/content'
import { getSessionHistory, sendChat } from '@/lib/api'
import type { ChatMessage, ToastItem } from '@/types'

function nowLabel(timestamp = new Date()) {
  return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function createMessage(
  tone: ChatMessage['tone'],
  actor: string,
  text: string,
  options: { streaming?: boolean; id?: string; timestamp?: string } = {},
): ChatMessage {
  return {
    id: options.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tone,
    actor,
    text,
    timestamp: options.timestamp ?? nowLabel(),
    streaming: options.streaming,
  }
}

function isLowValueAssistantMessage(text: string) {
  return [
    /你的智能求职助手/i,
    /有什么我可以帮你的吗/i,
    /看起来你还没有决定想做什么/i,
    /请问你今天想做什么/i,
    /如果你是在测试系统功能/i,
  ].some((pattern) => pattern.test(text))
}

function isLowValueUserMessage(text: string) {
  return /^(hi|hello|你好|test|acceptance-check[-\w]*)$/i.test(text.trim())
}

function pruneRestoredHistory(messages: ChatMessage[]) {
  const pruned: ChatMessage[] = []

  for (const message of messages) {
    if (message.tone === 'assistant' && isLowValueAssistantMessage(message.text)) {
      const lastMessage = pruned[pruned.length - 1]
      if (lastMessage?.tone === 'user' && isLowValueUserMessage(lastMessage.text)) {
        pruned.pop()
      }
      continue
    }

    pruned.push(message)
  }

  return pruned.slice(-12)
}

export function useChatModel(options: {
  appReady: boolean
  missingFields: string[]
  addToast: (toast: Omit<ToastItem, 'id'>) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [statusLine, setStatusLine] = useState('可以开始安排下一件事。')
  const [queueStatus, setQueueStatus] = useState('')
  const historyLoadedRef = useRef(false)
  const streamingIdByAgent = useRef<Map<string, string>>(new Map())

  async function loadHistory() {
    if (historyLoadedRef.current) return
    historyLoadedRef.current = true
    try {
      const payload = await getSessionHistory()
      if (!payload.ok) return
      const restored = payload.messages
        .map((message) => {
          const text = sanitizeMessageText(message.content)
          if (!text) return null
          return createMessage(
            message.role === 'user' ? 'user' : 'assistant',
            message.role === 'user' ? '你' : '助手',
            text,
          )
        })
        .filter((message): message is ChatMessage => Boolean(message))
      const prunedHistory = pruneRestoredHistory(restored)
      if (prunedHistory.length > 0) {
        setMessages(prunedHistory)
      }
    } catch {
      historyLoadedRef.current = false
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  async function send() {
    const message = input.trim()
    if (!message) return

    if (!options.appReady) {
      const detail = `当前还缺连接设置：${formatMissingFields(options.missingFields)}`
      setMessages((current) => [...current, createMessage('warning', '系统', detail)])
      setStatusLine('请先完成连接设置。')
      setQueueStatus('')
      return
    }

    setMessages((current) => [...current, createMessage('user', '你', message)])
    setInput('')
    setSending(true)
    setStatusLine('请求发送中...')
    setQueueStatus('请求发送中...')

    try {
      const payload = await sendChat(message)
      if (!payload.ok) {
        setMessages((current) => [
          ...current,
          createMessage('error', '系统', payload.error || '发送失败'),
        ])
        setStatusLine(payload.error || '发送失败')
        setQueueStatus(payload.error || '发送失败')
        return
      }
      if (payload.queued) {
        const waiting = Math.max(0, (payload.queueLength ?? 1) - 1)
        const detail = waiting > 0 ? `已排队，前面还有 ${waiting} 条任务。` : '已排队，马上开始处理。'
        setStatusLine(detail)
        setQueueStatus(detail)
        return
      }
      if (payload.message?.trim()) {
        const text = sanitizeMessageText(payload.message)
        if (!text) return
        setMessages((current) => [...current, createMessage('assistant', '助手', text)])
        setStatusLine('回复已完成。')
        setQueueStatus('')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '网络异常'
      setMessages((current) => [...current, createMessage('error', '系统', detail)])
      setStatusLine(detail)
      setQueueStatus(detail)
    } finally {
      setSending(false)
    }
  }

  function onWsEvent(event: string, data: any) {
    if (event === 'agent:stream') {
      const agentName = data?.agentName || '助手'
      const chunk = sanitizeMessageText(String(data?.chunk || ''))
      const isFirst = Boolean(data?.isFirst)
      const isFinal = Boolean(data?.isFinal)

      setMessages((current) => {
        if (isFirst || !streamingIdByAgent.current.has(agentName)) {
          const streamId = `stream-${agentName}-${Date.now()}`
          streamingIdByAgent.current.set(agentName, streamId)
          return [
            ...current,
            createMessage('assistant', agentName, chunk, {
              id: streamId,
              streaming: !isFinal,
            }),
          ]
        }

        const streamId = streamingIdByAgent.current.get(agentName)!
        return current.map((message) =>
          message.id === streamId
            ? { ...message, text: sanitizeMessageText(message.text + chunk), streaming: !isFinal }
            : message,
        )
      })

      setStatusLine(isFinal ? '回复已完成。' : '正在整理回复...')
      setQueueStatus(isFinal ? '' : '正在整理回复...')
      if (isFinal) {
        streamingIdByAgent.current.delete(agentName)
        setSending(false)
      }
      return
    }

    if (event === 'agent:log') {
      const detail = sanitizeMessageText(String(data?.message || ''))
      const isError = data?.type === 'error' || data?.level === 'error'
      const isWarning = data?.type === 'warn' || data?.level === 'warn'
      if (!detail.trim()) return
      if (isError) {
        setMessages((current) => [
          ...current,
          createMessage('error', '系统', detail, {
            timestamp: data?.timestamp ? nowLabel(new Date(data.timestamp)) : nowLabel(),
          }),
        ])
        setStatusLine('执行失败，请检查提示后重试。')
        setQueueStatus('')
        setSending(false)
        return
      }
      if (isWarning) {
        setStatusLine(detail)
      }
      return
    }

    if (event === 'workspace:context_updated' && typeof data?.summary === 'string' && data.summary.trim()) {
      setStatusLine(data.summary)
      setQueueStatus('')
      return
    }

    if (event === 'agent:state') {
      if (data?.state === 'running') {
        setStatusLine('系统正在处理当前任务。')
        return
      }
      if (data?.state === 'waiting_input') {
        setStatusLine('需要你补充信息后再继续。')
        return
      }
      if (data?.state === 'error') {
        setStatusLine('任务执行失败，请检查输入或稍后重试。')
        setQueueStatus('')
        setSending(false)
      }
      return
    }

    if (event === 'intervention:resolved') {
      options.addToast({
        tone: 'info',
        title: '输入已提交',
        detail: '任务会继续往下执行。',
      })
    }
  }

  return {
    messages,
    input,
    setInput,
    sending,
    statusLine,
    queueStatus,
    placeholder: options.appReady
      ? '直接说出你的目标，例如：帮我筛选远程后端岗位，并保留更匹配的机会'
      : '请先到“配置”页补齐连接信息',
    send,
    onWsEvent,
    loadHistory,
  }
}
