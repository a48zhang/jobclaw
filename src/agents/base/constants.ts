/** BaseAgent 常量定义 */

/** 上下文窗口大小 */
export const CONTEXT_WINDOW = 262144

/** 压缩触发阈值（75%） */
export const COMPRESS_THRESHOLD = Math.floor(CONTEXT_WINDOW * 0.75)

/** 压缩后目标（30%） */
export const COMPRESS_TARGET = Math.floor(CONTEXT_WINDOW * 0.3)

/** 默认保留消息数 */
export const DEFAULT_KEEP_RECENT_MESSAGES = 20

/** 默认最大循环次数 */
export const DEFAULT_MAX_ITERATIONS = 50