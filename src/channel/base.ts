/** 通知消息类型 */
export type ChannelMessageType =
  | 'new_job'           // MainAgent 搜索发现新职位（通知用户查看）
  | 'delivery_start'    // DeliveryAgent 开始处理某职位
  | 'delivery_success'  // DeliveryAgent 成功投递
  | 'delivery_failed'   // DeliveryAgent 投递失败
  | 'delivery_blocked'  // DeliveryAgent 遇到需要登录/人工介入的情况
  | 'cron_complete'     // CronJob 执行完毕的汇总通知

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
