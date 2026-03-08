/** 通知消息类型 */
export type ChannelMessageType =
  | 'new_job'           // MainAgent 搜索发现新职位（通知用户查看）
  | 'delivery_start'    // DeliveryAgent 开始处理某职位
  | 'delivery_success'  // DeliveryAgent 成功投递
  | 'delivery_failed'   // DeliveryAgent 投递失败
  | 'delivery_blocked'  // DeliveryAgent 遇到需要登录/人工介入的情况
  | 'cron_complete'     // CronJob 执行完毕的汇总通知
  | 'tool_warn'         // 工具执行过程中的非致命警告
  | 'tool_error'        // 工具执行过程中的业务错误
  | 'tool_call'         // 工具调用开始
  | 'agent_response'    // Agent 的直接回复
  | 'user_input'        // 用户输入

/** 通知消息结构 */
export interface ChannelMessage {
  type: ChannelMessageType
  /** 业务数据，各类型含义见文档说明 */
  payload: Record<string, unknown>
  timestamp: Date
}

/**
 * Channel 抽象接口
 * 实现类负责将消息通过具体通道（邮件、Webhook 等）送达用户
 */
export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
