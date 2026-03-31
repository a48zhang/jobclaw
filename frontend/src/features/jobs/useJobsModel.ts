import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { deleteJobs, getJobsQuery, updateJobStatuses } from '@/lib/api'
import type { JobItem, ToastItem } from '@/types'

export function useJobsModel(options: {
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  confirm: (request: {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
  }) => Promise<boolean>
}) {
  const [items, setItems] = useState<JobItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('updatedAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query)
  const refreshRequestRef = useRef(0)

  async function refresh() {
    const requestId = refreshRequestRef.current + 1
    refreshRequestRef.current = requestId
    setLoading(true)
    try {
      const payload = await getJobsQuery({
        status,
        q: deferredQuery.trim() || undefined,
        sortBy,
        order,
        limit: 200,
      })
      if (requestId !== refreshRequestRef.current) return
      setItems(payload.items ?? [])
      setTotal(payload.total ?? payload.items.length)
      setSelectedUrls((current) => current.filter((url) => payload.items.some((item) => item.url === url)))
      setActiveUrl((current) => (current && payload.items.some((item) => item.url === current) ? current : payload.items[0]?.url ?? null))
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void refresh()
  }, [status, deferredQuery, sortBy, order])
  const activeJob = items.find((item) => item.url === activeUrl) ?? null

  function toggleSelection(url: string) {
    setSelectedUrls((current) =>
      current.includes(url) ? current.filter((item) => item !== url) : [...current, url],
    )
  }

  function toggleAll() {
    setSelectedUrls((current) => (current.length === items.length ? [] : items.map((item) => item.url)))
  }

  async function runBulkStatus(nextStatus: 'applied' | 'favorite' | 'failed') {
    if (selectedUrls.length === 0) return
    try {
      await updateJobStatuses(selectedUrls.map((url) => ({ url, status: nextStatus })))
      options.addToast({
        tone: 'success',
        title: '职位状态已更新',
        detail: `已处理 ${selectedUrls.length} 条职位。`,
      })
      void refresh()
    } catch (error) {
      options.addToast({
        tone: 'error',
        title: '批量更新失败',
        detail: error instanceof Error ? error.message : '请稍后重试',
      })
    }
  }

  async function runBulkDelete() {
    if (selectedUrls.length === 0) return
    const accepted = await options.confirm({
      title: '确认删除职位',
      message: `这会删除已选择的 ${selectedUrls.length} 条职位记录，删除后不会自动恢复。`,
      confirmLabel: '确认删除',
      cancelLabel: '先不删除',
      tone: 'danger',
    })
    if (!accepted) return
    try {
      await deleteJobs(selectedUrls)
      options.addToast({
        tone: 'success',
        title: '职位已删除',
        detail: `已移除 ${selectedUrls.length} 条职位。`,
      })
      setSelectedUrls([])
      void refresh()
    } catch (error) {
      options.addToast({
        tone: 'error',
        title: '删除失败',
        detail: error instanceof Error ? error.message : '请稍后重试',
      })
    }
  }

  function onWsEvent(event: string) {
    if (event === 'job:updated') {
      void refresh()
    }
  }

  return {
    loading,
    items,
    total,
    status,
    setStatus,
    query,
    setQuery,
    sortBy,
    setSortBy,
    order,
    setOrder,
    selectedUrls,
    selectedCount: selectedUrls.length,
    toggleSelection,
    toggleAll,
    activeJob,
    setActiveUrl,
    refresh,
    runBulkStatus,
    runBulkDelete,
    resetFilters: () => {
      setStatus('all')
      setQuery('')
      setSortBy('updatedAt')
      setOrder('desc')
    },
    onWsEvent,
  }
}
