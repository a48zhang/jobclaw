/**
 * 全局状态管理
 */

let currentAgentName = 'main'
let currentFile = 'targets'
let jobs = []
let sortCol = 'time'
let sortAsc = false
let donutChart = null
let interventionAgentName = 'main'
let interventionRequestId = null
let interventionOwnerId = null
let interventionKind = 'text'
let interventionOptions = []
let ws = null
let reconnectTimer = null
let reconnectCountdown = 0
const agentStates = {}
let queueInfo = null
let streamingState = { active: false, messageId: null }
let selectedJobs = null
let appReady = false
let missingFields = []
let activeTabId = 'tab-chat'
let userHasNavigated = false
let chatTask = {
  state: 'idle',
  message: '',
  updatedAt: null,
}
let configEditor = {
  dirty: false,
  saving: false,
  file: 'targets',
  baselineContent: '',
}
let settings = {
  API_KEY: '',
  MODEL_ID: '',
  LIGHT_MODEL_ID: '',
  BASE_URL: '',
  SERVER_PORT: 3000,
}

window.appState = {
  get currentAgentName() { return currentAgentName },
  get currentFile() { return currentFile },
  get jobs() { return jobs },
  get sortCol() { return sortCol },
  get sortAsc() { return sortAsc },
  get donutChart() { return donutChart },
  get interventionAgentName() { return interventionAgentName },
  get interventionRequestId() { return interventionRequestId },
  get interventionOwnerId() { return interventionOwnerId },
  get interventionKind() { return interventionKind },
  get interventionOptions() { return interventionOptions },
  get ws() { return ws },
  get reconnectTimer() { return reconnectTimer },
  get reconnectCountdown() { return reconnectCountdown },
  get agentStates() { return agentStates },
  get queueInfo() { return queueInfo },
  get streamingState() { return streamingState },
  get selectedJobs() { return selectedJobs },
  get appReady() { return appReady },
  get missingFields() { return missingFields },
  get activeTabId() { return activeTabId },
  get userHasNavigated() { return userHasNavigated },
  get chatTask() { return chatTask },
  get configEditor() { return configEditor },
  get settings() { return settings },

  set currentAgentName(v) { currentAgentName = v },
  set currentFile(v) { currentFile = v },
  set jobs(v) { jobs = v },
  set sortCol(v) { sortCol = v },
  set sortAsc(v) { sortAsc = v },
  set donutChart(v) { donutChart = v },
  set interventionAgentName(v) { interventionAgentName = v },
  set interventionRequestId(v) { interventionRequestId = v },
  set interventionOwnerId(v) { interventionOwnerId = v },
  set interventionKind(v) { interventionKind = v },
  set interventionOptions(v) { interventionOptions = v },
  set ws(v) { ws = v },
  set reconnectTimer(v) { reconnectTimer = v },
  set reconnectCountdown(v) { reconnectCountdown = v },
  set queueInfo(v) { queueInfo = v },
  set streamingState(v) { streamingState = v },
  set selectedJobs(v) { selectedJobs = v },
  set appReady(v) { appReady = v },
  set missingFields(v) { missingFields = Array.isArray(v) ? v : [] },
  set activeTabId(v) { activeTabId = v || 'tab-chat' },
  set userHasNavigated(v) { userHasNavigated = Boolean(v) },
  set chatTask(v) {
    const next = v && typeof v === 'object' ? v : {}
    chatTask = {
      state: typeof next.state === 'string' ? next.state : chatTask.state,
      message: typeof next.message === 'string' ? next.message : chatTask.message,
      updatedAt: typeof next.updatedAt === 'string' ? next.updatedAt : new Date().toISOString(),
    }
  },
  set configEditor(v) {
    const next = v && typeof v === 'object' ? v : {}
    configEditor = {
      ...configEditor,
      ...next,
      dirty: Boolean(next.dirty ?? configEditor.dirty),
      saving: Boolean(next.saving ?? configEditor.saving),
      file: typeof (next.file ?? configEditor.file) === 'string' ? (next.file ?? configEditor.file) : configEditor.file,
      baselineContent: typeof (next.baselineContent ?? configEditor.baselineContent) === 'string'
        ? (next.baselineContent ?? configEditor.baselineContent)
        : configEditor.baselineContent,
    }
  },
  set settings(v) { settings = { ...settings, ...v } },
}
