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
  get settings() { return settings },

  set currentAgentName(v) { currentAgentName = v },
  set currentFile(v) { currentFile = v },
  set jobs(v) { jobs = v },
  set sortCol(v) { sortCol = v },
  set sortAsc(v) { sortAsc = v },
  set donutChart(v) { donutChart = v },
  set interventionAgentName(v) { interventionAgentName = v },
  set interventionRequestId(v) { interventionRequestId = v },
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
  set settings(v) { settings = { ...settings, ...v } },
}
