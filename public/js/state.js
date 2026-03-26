/**
 * 全局状态管理
 */

// 当前 agent 名称
let currentAgentName = 'main'

// 配置文件
let currentFile = 'targets'

// 职位数据
let jobs = []

// 排序状态
let sortCol = 'time'
let sortAsc = false

// 图表实例
let donutChart = null

// 干预相关
let interventionAgentName = 'main'
let interventionRequestId = null
let interventionKind = 'text'
let interventionOptions = []

// WebSocket
let ws = null
let reconnectTimer = null
let reconnectCountdown = 0

// Agent 状态
const agentStates = {}

let queueInfo = null
let streamingState = { active: false, messageId: null }
let selectedJobs = null

// 导出状态和设置函数
window.appState = {
  // getters
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

  // setters
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
}
