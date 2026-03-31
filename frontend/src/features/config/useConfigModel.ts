import { useEffect, useRef, useState } from 'react'
import { getConfigDoc, getSettings, saveConfigDoc, saveSettings } from '@/lib/api'
import type { ConfigDocName, SettingsFormValue, ToastItem } from '@/types'

const DOC_PATTERNS: Record<ConfigDocName, string[]> = {
  targets: ['示例公司', '每行一条目标'],
  userinfo: ['姓名：', '求职意向'],
}

function buildInitialForm() {
  return {
    API_KEY: '',
    MODEL_ID: '',
    LIGHT_MODEL_ID: '',
    BASE_URL: '',
    SERVER_PORT: '3000',
  } satisfies SettingsFormValue
}

function isDocReady(name: ConfigDocName, content: string) {
  const trimmed = content.trim()
  if (!trimmed) return false
  return !DOC_PATTERNS[name].some((pattern) => trimmed.includes(pattern))
}

export function useConfigModel(options: {
  confirm: (request: {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
  }) => Promise<boolean>
  addToast: (toast: Omit<ToastItem, 'id'>) => void
}) {
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<SettingsFormValue>(buildInitialForm())
  const [baseline, setBaseline] = useState<SettingsFormValue>(buildInitialForm())
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [maskedApiKey, setMaskedApiKey] = useState('')
  const [appReady, setAppReady] = useState(false)
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<ConfigDocName>('targets')
  const [docs, setDocs] = useState<Record<ConfigDocName, { content: string; saved: string }>>({
    targets: { content: '', saved: '' },
    userinfo: { content: '', saved: '' },
  })
  const [settingsStatus, setSettingsStatus] = useState('')
  const [docStatus, setDocStatus] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingDoc, setSavingDoc] = useState(false)
  const refreshRequestRef = useRef(0)

  async function refresh() {
    const requestId = refreshRequestRef.current + 1
    refreshRequestRef.current = requestId
    setLoading(true)
    try {
      const [settingsPayload, targetsPayload, userinfoPayload] = await Promise.all([
        getSettings(),
        getConfigDoc('targets'),
        getConfigDoc('userinfo'),
      ])
      if (requestId !== refreshRequestRef.current) return
      const nextForm = {
        API_KEY: '',
        MODEL_ID: settingsPayload.settings.MODEL_ID ?? '',
        LIGHT_MODEL_ID: settingsPayload.settings.LIGHT_MODEL_ID ?? '',
        BASE_URL: settingsPayload.settings.BASE_URL ?? '',
        SERVER_PORT: String(settingsPayload.settings.SERVER_PORT ?? 3000),
      }
      setForm(nextForm)
      setBaseline(nextForm)
      setApiKeyConfigured(settingsPayload.secrets.API_KEY.configured)
      setMaskedApiKey(settingsPayload.secrets.API_KEY.maskedValue)
      setAppReady(settingsPayload.status.ready)
      setMissingFields(settingsPayload.status.missingFields ?? [])
      setDocs({
        targets: { content: targetsPayload.content ?? '', saved: targetsPayload.content ?? '' },
        userinfo: { content: userinfoPayload.content ?? '', saved: userinfoPayload.content ?? '' },
      })
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const settingsDirty =
    form.API_KEY.trim().length > 0 ||
    form.MODEL_ID !== baseline.MODEL_ID ||
    form.LIGHT_MODEL_ID !== baseline.LIGHT_MODEL_ID ||
    form.BASE_URL !== baseline.BASE_URL ||
    form.SERVER_PORT !== baseline.SERVER_PORT

  const editorDirty = docs[activeFile].content !== docs[activeFile].saved
  const targetsReady = isDocReady('targets', docs.targets.saved)
  const userinfoReady = isDocReady('userinfo', docs.userinfo.saved)

  async function switchFile(nextFile: ConfigDocName) {
    if (nextFile === activeFile) return
    if (editorDirty) {
      const accepted = await options.confirm({
        title: '有未保存更改',
        message: '当前内容还没有保存，切换文件会丢失这些修改。',
        confirmLabel: '继续切换',
        cancelLabel: '留在当前页',
      })
      if (!accepted) return
    }
    setDocStatus('')
    setActiveFile(nextFile)
  }

  async function persistSettings() {
    setSavingSettings(true)
    setSettingsStatus('正在保存...')
    try {
      const payload = await saveSettings(form, {
        preserveExistingApiKey: apiKeyConfigured && form.API_KEY.trim().length === 0,
      })
      const nextForm = {
        API_KEY: '',
        MODEL_ID: payload.settings.MODEL_ID ?? '',
        LIGHT_MODEL_ID: payload.settings.LIGHT_MODEL_ID ?? '',
        BASE_URL: payload.settings.BASE_URL ?? '',
        SERVER_PORT: String(payload.settings.SERVER_PORT ?? 3000),
      }
      setForm(nextForm)
      setBaseline(nextForm)
      setApiKeyConfigured(payload.secrets.API_KEY.configured)
      setMaskedApiKey(payload.secrets.API_KEY.maskedValue)
      setAppReady(payload.status.ready)
      setMissingFields(payload.status.missingFields ?? [])
      setSettingsStatus('设置已保存')
      options.addToast({
        tone: 'success',
        title: '连接设置已更新',
      })
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingSettings(false)
    }
  }

  async function persistDoc() {
    setSavingDoc(true)
    setDocStatus('正在保存...')
    try {
      await saveConfigDoc(activeFile, docs[activeFile].content)
      setDocs((current) => ({
        ...current,
        [activeFile]: {
          content: current[activeFile].content,
          saved: current[activeFile].content,
        },
      }))
      setDocStatus('内容已保存')
      options.addToast({
        tone: 'success',
        title: `${activeFile}.md 已保存`,
      })
    } catch (error) {
      setDocStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingDoc(false)
    }
  }

  return {
    loading,
    form,
    setForm,
    appReady,
    missingFields,
    maskedApiKey,
    apiKeyConfigured,
    activeFile,
    switchFile,
    docs,
    setDocs,
    settingsDirty,
    editorDirty,
    settingsStatus,
    docStatus,
    savingSettings,
    savingDoc,
    persistSettings,
    persistDoc,
    targetsReady,
    userinfoReady,
    refresh,
  }
}
