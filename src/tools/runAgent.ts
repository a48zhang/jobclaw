import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ToolContext, ToolResult } from './index.js'

export const RUN_AGENT_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'run_agent',
    description: `创建临时 Agent 执行任务，静默执行后返回结果。

可用于执行独立的子任务，如：
- 简历生成、职位搜索等独立任务
- 使用特定 skill 执行任务（如 delivery skill 执行投递）

子 Agent 不会影响当前会话历史。`,
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '传递给子 Agent 的任务指令',
        },
        skill: {
          type: 'string',
          description: '可选，指定要加载的 skill（如 delivery）',
        },
        timeout_ms: {
          type: 'number',
          description: '超时时间（毫秒），默认 300000 (5分钟)',
        },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
}

export async function executeRunAgent(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { instruction, skill, timeout_ms, profile, delegated_run_id } = args as {
    instruction: string
    skill?: string
    timeout_ms?: number
    profile?: 'search' | 'delivery' | 'resume' | 'review'
    delegated_run_id?: string
  }

  const factory = context.factory
  if (!factory) {
    return {
      success: false,
      content: '',
      error: 'AgentFactory 未注入，无法创建子 Agent',
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    // 构建带 skill 的指令
    const fullInstruction = skill
      ? `使用 ${skill} skill 执行以下任务：\n${instruction}`
      : instruction

    // 子 Agent 静默执行（无 channel）
    // Pass parent session ID and delegated run ID for intervention identity chain
    const subAgent = factory.createAgent({
      profileName: profile,
      skillName: skill,
      sessionId: delegated_run_id,
      parentSessionId: context.sessionId,
      delegatedRunId: delegated_run_id,
    })

    const timeout = timeout_ms ?? 300_000
    let timedOut = false
    const runPromise = subAgent.run(fullInstruction).then((value: string) => {
      if (timedOut) {
        throw new Error('Agent finished after timeout and result was discarded')
      }
      return value
    })

    const result = await Promise.race([
      new Promise<never>((_, reject) =>
        timeoutId = setTimeout(() => {
          timedOut = true
          subAgent.abort('Agent timeout')
          reject(new Error('Agent timeout'))
        }, timeout)
      ),
      runPromise,
    ])
    return {
      success: true,
      content: result,
    }
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `子任务执行失败: ${(error as Error).message}`,
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
