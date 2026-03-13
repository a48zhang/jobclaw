// get_time 工具实现 - 获取当前时间
import type { ToolContext, ToolResult } from './index.js'

/**
 * get_time 工具实现
 * 返回格式化的当前时间信息
 */
export async function executeGetTime(
  _args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const now = new Date()

  // 中文格式时间
  const zhTime = now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
  })

  // ISO 格式时间
  const isoTime = now.toISOString()

  // Unix 时间戳（秒）
  const unixTimestamp = Math.floor(now.getTime() / 1000)

  // Unix 时间戳（毫秒）
  const unixTimestampMs = now.getTime()

  const content = `当前时间: ${zhTime}
ISO 格式: ${isoTime}
Unix 时间戳: ${unixTimestamp} (秒)
Unix 时间戳: ${unixTimestampMs} (毫秒)`

  return { success: true, content }
}

export const GET_TIME_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_time',
    description: '获取当前系统时间。返回中文格式、ISO 格式和 Unix 时间戳。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
}
