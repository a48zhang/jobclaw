/** respond 工具 - 向用户输出内容 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ToolContext, ToolResult } from './index.js'

export const RESPOND_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'respond',
    description: `向用户输出内容。用于需要用户看到的回复、结果、询问等。
- 内容会直接显示在对话界面
- 你输出的文本是内部思考，不会显示给用户
- 只有通过此工具才能将内容输出给用户`,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '要输出给用户的消息内容',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
}

export async function executeRespond(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { message } = args as { message: string }

  // respond 工具通过 logger 输出给用户
  context.logger(message)

  return {
    success: true,
    content: JSON.stringify({
      status: 'message_sent',
      length: message.length,
    }),
  }
}
