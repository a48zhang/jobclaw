/** 通知消息类型 */
export type ChannelMessageType =
  | 'new_job'           // MainAgent 搜索发现新职位
  | 'delivery_start'    // DeliveryAgent 开始处理某职位
  | 'delivery_success'  // DeliveryAgent 成功投递
  | 'delivery_failed'   // DeliveryAgent 投递失败
  | 'delivery_blocked'  // DeliveryAgent 遇到需要登录/人工介入
  | 'cron_complete'     // CronJob 执行完毕汇总
  | 'tool_warn'         // 工具执行过程中的业务警告
  | 'tool_error'        // 工具执行过程中的致命错误
  | 'tool_call'         // 工具调用开始标记
  | 'tool_output'       // 工具执行过程中的流式输出 (无 Header)
  | 'agent_response'    // Agent 的直接回复
  | 'user_input'        // 用户输入

/** 通知消息结构 */
export interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
}

export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
