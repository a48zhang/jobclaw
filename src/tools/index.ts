// 工具层 - Phase 1 统一入口
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

// 导入各工具实现
import { executeReadFile } from './readFile'
import { executeWriteFile } from './writeFile'
import { executeAppendFile } from './appendFile'
import { executeListDirectory } from './listDirectory'
import { executeLockFile, executeUnlockFile } from './lockFile'

// 导出共享工具（供测试和其他模块使用）
export { getLockFilePath, normalizeAndValidatePath } from './utils'

/**
 * 工具名称常量
 */
export const TOOL_NAMES = {
  READ_FILE: 'read_file',
  WRITE_FILE: 'write_file',
  APPEND_FILE: 'append_file',
  LIST_DIRECTORY: 'list_directory',
  LOCK_FILE: 'lock_file',
  UNLOCK_FILE: 'unlock_file',
} as const

/**
 * 工具上下文
 */
export interface ToolContext {
  /** 工作区根目录 */
  workspaceRoot: string
  /** Agent 名称 */
  agentName: string
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean
  /** 执行结果内容 */
  content: string
  /** 错误信息（失败时） */
  error?: string
}

// ============================================================================
// 工具 Schema 定义
// ============================================================================

/**
 * read_file 工具定义
 */
const readFileTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_NAMES.READ_FILE,
    description: '读取指定路径的文件内容。大文件超过限制时会报错并提示使用 offset 参数分页读取。offset 参数为字符偏移量。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于 workspace 的文件路径',
        },
        offset: {
          type: 'number',
          description: '分页起始字符位置，用于读取大文件的后续内容',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
}

/**
 * write_file 工具定义
 */
const writeFileTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_NAMES.WRITE_FILE,
    description:
      '替换文件中的文本内容。old_string 必须在文件中恰好出现一次才会执行替换，否则返回错误。用于精确修改文件的特定部分。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于 workspace 的文件路径',
        },
        old_string: {
          type: 'string',
          description: '要替换的原始文本（必须在文件中唯一匹配）',
        },
        new_string: {
          type: 'string',
          description: '替换后的新文本',
        },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
}

/**
 * append_file 工具定义
 */
const appendFileTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_NAMES.APPEND_FILE,
    description: '向文件末尾追加内容。如果文件不存在会自动创建新文件。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于 workspace 的文件路径',
        },
        content: {
          type: 'string',
          description: '要追加的内容',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
}

/**
 * list_directory 工具定义
 */
const listDirectoryTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_NAMES.LIST_DIRECTORY,
    description: '列出指定目录下的所有文件和子目录。返回结果会标注每个条目是文件还是目录。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于 workspace 的目录路径',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
}

/**
 * lock_file 工具定义
 */
const lockFileTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_NAMES.LOCK_FILE,
    description:
      '获取文件锁以独占访问共享文件。锁超时时间为 30 秒，超时后自动释放。如果文件已被其他 Agent 锁定且未超时，则返回失败。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '要锁定的目标文件路径',
        },
        holder: {
          type: 'string',
          description: '持有者 Agent 名称',
        },
      },
      required: ['path', 'holder'],
      additionalProperties: false,
    },
  },
}

/**
 * unlock_file 工具定义
 */
const unlockFileTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: TOOL_NAMES.UNLOCK_FILE,
    description: '释放文件锁。只有锁的持有者才能释放锁，会验证 holder 身份。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '要解锁的目标文件路径',
        },
        holder: {
          type: 'string',
          description: '持有者 Agent 名称',
        },
      },
      required: ['path', 'holder'],
      additionalProperties: false,
    },
  },
}

/**
 * 所有工具的数组，可直接用于 OpenAI API 调用
 */
export const TOOLS: ChatCompletionTool[] = [
  readFileTool,
  writeFileTool,
  appendFileTool,
  listDirectoryTool,
  lockFileTool,
  unlockFileTool,
]

// ============================================================================
// 工具执行器
// ============================================================================

/**
 * 工具执行器主函数
 * @param name 工具名称
 * @param args 工具参数
 * @param context 工具上下文
 * @returns 工具执行结果
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case TOOL_NAMES.READ_FILE:
      return executeReadFile(args, context)
    case TOOL_NAMES.WRITE_FILE:
      return executeWriteFile(args, context)
    case TOOL_NAMES.APPEND_FILE:
      return executeAppendFile(args, context)
    case TOOL_NAMES.LIST_DIRECTORY:
      return executeListDirectory(args, context)
    case TOOL_NAMES.LOCK_FILE:
      return executeLockFile(args, context)
    case TOOL_NAMES.UNLOCK_FILE:
      return executeUnlockFile(args, context)
    default:
      return { success: false, content: '', error: `未知工具：${name}` }
  }
}