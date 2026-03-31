import { useEffect, useEffectEvent, useState } from 'react'

export function useRealtimeConnection(options: {
  onEvent: (event: string, data: unknown) => void
  onOpen?: () => void
}) {
  const onEvent = useEffectEvent(options.onEvent)
  const onOpen = useEffectEvent(() => {
    options.onOpen?.()
  })
  const [connected, setConnected] = useState(false)
  const [reconnectCountdown, setReconnectCountdown] = useState(0)

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let retryDelayTimer: number | null = null
    let disposed = false
    let reconnectAttempt = 0

    function clearTimers() {
      if (reconnectTimer) window.clearInterval(reconnectTimer)
      if (retryDelayTimer) window.clearTimeout(retryDelayTimer)
      reconnectTimer = null
      retryDelayTimer = null
    }

    function scheduleReconnect() {
      if (disposed) return
      clearTimers()
      setConnected(false)
      reconnectAttempt += 1
      const delayMs = Math.min(15000, 3000 * Math.max(1, reconnectAttempt))
      const nextSeconds = Math.ceil(delayMs / 1000)
      setReconnectCountdown(nextSeconds)
      reconnectTimer = window.setInterval(() => {
        setReconnectCountdown((current) => (current <= 1 ? 0 : current - 1))
      }, 1000)
      retryDelayTimer = window.setTimeout(() => {
        clearTimers()
        connect()
      }, delayMs)
    }

    function connect() {
      if (disposed) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`)

      socket.addEventListener('open', () => {
        setConnected(true)
        setReconnectCountdown(0)
        reconnectAttempt = 0
        clearTimers()
        onOpen()
      })

      socket.addEventListener('message', (message) => {
        try {
          const parsed = JSON.parse(message.data as string) as { event: string; data: unknown }
          onEvent(parsed.event, parsed.data)
        } catch {
          // ignore malformed payloads
        }
      })

      socket.addEventListener('close', () => {
        if (disposed) return
        scheduleReconnect()
      })

      socket.addEventListener('error', () => {
        if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
      })
    }

    connect()
    return () => {
      disposed = true
      clearTimers()
      socket?.close()
    }
  }, [onEvent, onOpen])

  return {
    connected,
    reconnectCountdown,
  }
}
