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

// Agent 状态
const agentStates = {}

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
  get agentStates() { return agentStates },

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
}
