import { useEffect, useRef, useState } from 'react'
import {
  buildResume,
  getResumeStatus,
  getResumeWorkflow,
  reviewUploadedResume,
  uploadResume,
} from '@/lib/api'
import type { ResumeStatusPayload, ResumeWorkflowPayload, ToastItem } from '@/types'

const POLL_LIMIT = 18

export function useResumeModel(options: {
  addToast: (toast: Omit<ToastItem, 'id'>) => void
}) {
  const [workflow, setWorkflow] = useState<ResumeWorkflowPayload['overview'] | null>(null)
  const [status, setStatus] = useState<ResumeStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState('')
  const [primaryStatus, setPrimaryStatus] = useState('生成后会在这里显示 PDF 下载入口。')
  const [pollTick, setPollTick] = useState(0)
  const refreshRequestRef = useRef(0)

  async function refresh() {
    const requestId = refreshRequestRef.current + 1
    refreshRequestRef.current = requestId
    setLoading(true)
    try {
      const [nextWorkflow, nextStatus] = await Promise.all([
        getResumeWorkflow(),
        getResumeStatus(),
      ])
      if (requestId !== refreshRequestRef.current) return
      if (nextWorkflow.ok) setWorkflow(nextWorkflow.overview)
      if (nextStatus.ok) setStatus(nextStatus)
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (pollTick <= 0) return
    const timer = window.setTimeout(async () => {
      await refresh()
      setPollTick((current) => (current >= POLL_LIMIT ? 0 : current + 1))
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [pollTick])

  async function triggerBuild() {
    try {
      await buildResume()
      setPrimaryStatus('简历生成任务已提交，正在后台处理。')
      setPollTick(1)
      options.addToast({
        tone: 'info',
        title: '已开始生成简历',
      })
    } catch (error) {
      setPrimaryStatus(error instanceof Error ? error.message : '生成失败')
    }
  }

  async function triggerReview() {
    try {
      await reviewUploadedResume()
      setPrimaryStatus('简历分析任务已提交。你可以留在本页，结果会出现在对话页。')
      options.addToast({
        tone: 'info',
        title: '已提交简历分析',
      })
    } catch (error) {
      setPrimaryStatus(error instanceof Error ? error.message : '分析失败')
    }
  }

  async function submitUpload() {
    const file = selectedFile
    if (!file) {
      setUploadStatus('请先选择一个 PDF 文件。')
      return
    }
    try {
      const result = await uploadResume(file)
      setUploadStatus(result.ok ? `已上传：${result.name || file.name}` : result.error || '上传失败')
      if (result.ok) setSelectedFile(null)
      await refresh()
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : '上传失败')
    }
  }

  function onWsEvent(event: string, data: any) {
    if (event === 'job:updated' || (event === 'agent:log' && data?.agentName === 'resume')) {
      void refresh()
    }
  }

  return {
    workflow,
    status,
    loading,
    uploadStatus,
    primaryStatus,
    selectedFile,
    setSelectedFile,
    refresh,
    triggerBuild,
    triggerReview,
    submitUpload,
    onWsEvent,
  }
}
