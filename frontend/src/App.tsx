import { AppShell } from '@/components/AppShell'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { InterventionDialog } from '@/components/InterventionDialog'
import { ToastStack } from '@/components/ToastStack'
import { useChatModel } from '@/features/chat/useChatModel'
import { useConfigModel } from '@/features/config/useConfigModel'
import { useJobsModel } from '@/features/jobs/useJobsModel'
import { useResumeModel } from '@/features/resume/useResumeModel'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { useAppRealtime } from '@/hooks/useAppRealtime'
import { useInterventionDialog } from '@/hooks/useInterventionDialog'
import { useLegacyAppBridge } from '@/hooks/useLegacyAppBridge'
import { useTabs } from '@/hooks/useTabs'
import { useToastQueue } from '@/hooks/useToastQueue'
import { ChatPage } from '@/pages/ChatPage'
import { ConfigPage } from '@/pages/ConfigPage'
import { JobsPage } from '@/pages/JobsPage'
import { ResumePage } from '@/pages/ResumePage'

export function App() {
  const toasts = useToastQueue()
  const confirmDialog = useConfirmDialog()
  const interventionDialog = useInterventionDialog(toasts.push)
  const { activeTab, setActiveTab } = useTabs('tab-chat')
  const config = useConfigModel({ confirm: confirmDialog.confirm, addToast: toasts.push })
  const chat = useChatModel({
    appReady: config.appReady,
    missingFields: config.missingFields,
    addToast: toasts.push,
  })
  const jobs = useJobsModel({ addToast: toasts.push, confirm: confirmDialog.confirm })
  const resume = useResumeModel({ addToast: toasts.push })
  const { connection, handleRealtimeEvent } = useAppRealtime({
    chat,
    jobs,
    resume,
    interventionDialog,
  })

  useLegacyAppBridge({
    handleRealtimeEvent,
    openIntervention: interventionDialog.open,
    closeIntervention: interventionDialog.close,
    setActiveTab,
  })

  return (
    <>
      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connected={connection.connected}
        reconnectCountdown={connection.reconnectCountdown}
      >
        <ChatPage
          active={activeTab === 'tab-chat'}
          messages={chat.messages}
          input={chat.input}
          placeholder={chat.placeholder}
          sending={chat.sending}
          statusLine={chat.statusLine}
          queueStatus={chat.queueStatus}
          setInput={chat.setInput}
          send={chat.send}
        />
        <JobsPage
          active={activeTab === 'tab-jobs'}
          loading={jobs.loading}
          total={jobs.total}
          items={jobs.items}
          selectedCount={jobs.selectedCount}
          status={jobs.status}
          query={jobs.query}
          activeJob={jobs.activeJob}
          setStatus={jobs.setStatus}
          setQuery={jobs.setQuery}
          refresh={jobs.refresh}
          resetFilters={jobs.resetFilters}
          toggleSelection={jobs.toggleSelection}
          toggleAll={jobs.toggleAll}
          setActiveUrl={jobs.setActiveUrl}
          runBulkStatus={jobs.runBulkStatus}
          runBulkDelete={jobs.runBulkDelete}
          selectedUrls={jobs.selectedUrls}
        />
        <ConfigPage
          active={activeTab === 'tab-config'}
          loading={config.loading}
          appReady={config.appReady}
          missingFields={config.missingFields}
          form={config.form}
          setForm={(updater) => config.setForm((current) => updater(current))}
          apiKeyConfigured={config.apiKeyConfigured}
          maskedApiKey={config.maskedApiKey}
          activeFile={config.activeFile}
          switchFile={config.switchFile}
          docs={config.docs}
          setDocs={(updater) => config.setDocs((current) => updater(current))}
          settingsStatus={config.settingsStatus}
          docStatus={config.docStatus}
          persistSettings={config.persistSettings}
          persistDoc={config.persistDoc}
          targetsReady={config.targetsReady}
          userinfoReady={config.userinfoReady}
        />
        <ResumePage
          active={activeTab === 'tab-resume'}
          workflow={resume.workflow}
          status={resume.status}
          loading={resume.loading}
          selectedFile={resume.selectedFile}
          setSelectedFile={resume.setSelectedFile}
          uploadStatus={resume.uploadStatus}
          primaryStatus={resume.primaryStatus}
          submitUpload={resume.submitUpload}
          triggerReview={resume.triggerReview}
          triggerBuild={resume.triggerBuild}
        />
      </AppShell>

      <InterventionDialog
        payload={interventionDialog.payload}
        value={interventionDialog.value}
        error={interventionDialog.error}
        submitting={interventionDialog.submitting}
        setValue={interventionDialog.setValue}
        onClose={interventionDialog.close}
        onSubmit={interventionDialog.submit}
      />
      <ConfirmDialog
        request={confirmDialog.request}
        onAccept={confirmDialog.accept}
        onReject={confirmDialog.reject}
      />
      <ToastStack toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </>
  )
}
