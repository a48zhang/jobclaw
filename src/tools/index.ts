import { executeReadFile } from './readFile.js'
import { executeWriteFile } from './writeFile.js'
import { executeAppendFile } from './appendFile.js'
import { executeListDirectory } from './listDirectory.js'
import { executeLockFile, executeUnlockFile } from './lockFile.js'
import { executeUpsertJob } from './upsertJobWrapper.js'
import { executeTypstCompile, executeInstallTypst } from './typstCompile.js'
import { executeShellCommand, detectShell, detectOS } from './shell.js'
import { executeReadPdf } from './readPdf.js'
import { executeGrep } from './grep.js'
import { executeGetTime, GET_TIME_TOOL } from './getTime.js'
import { executeRunAgent, RUN_AGENT_TOOL } from './runAgent.js'
import { getLockFilePath } from './utils.js'
import { TOOL_NAME_LIST, TOOL_NAMES } from './names.js'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ToolContext, ToolResult } from './types.js'

export { getLockFilePath }
export { TOOL_NAMES }
export type { ToolContext, ToolResult }

export const LOCAL_TOOL_NAMES = TOOL_NAME_LIST

// 动态检测系统与 Shell 环境
const CURRENT_OS = detectOS()
const CURRENT_SHELL = detectShell()

export const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.READ_FILE,
      description: '读取文件内容。如果文件太大，将返回部分内容并提示分页。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的路径' },
          offset: { type: 'number', description: '读取起始位置（字节）' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.WRITE_FILE,
      description: '写入或替换文件内容。必须提供原始字符串以便精确替换。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的路径' },
          old_string: { type: 'string', description: '要被替换的原始字符串' },
          new_string: { type: 'string', description: '新的内容' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.APPEND_FILE,
      description: '在文件末尾追加内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的路径' },
          content: { type: 'string', description: '追加的内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.LIST_DIRECTORY,
      description: '列出目录下的文件和文件夹。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.LOCK_FILE,
      description: '获取文件锁，保障并发安全。写入前必须获取锁。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.UNLOCK_FILE,
      description: '释放文件锁。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.UPSERT_JOB,
      description: '原子化更新或插入职位信息到 jobs.md。自带锁管理与查重。',
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          status: { type: 'string', enum: ['discovered', 'applied', 'failed', 'login_required', 'favorite'] },
        },
        required: ['company', 'title', 'url', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.TYPST_COMPILE,
      description: '将 Typst 简历源文件编译为 PDF。',
      parameters: {
        type: 'object',
        properties: {
          input_path: { type: 'string', description: 'Typst 源文件路径（相对于 workspace）' },
        },
        required: ['input_path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.INSTALL_TYPST,
      description: '自动安装 typst 编译环境（含 Rust/Cargo）。仅在用户明确同意后调用。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.READ_PDF,
      description: '读取 PDF 文件并提取文本内容。适用于用户上传的 PDF 简历或 PDF JD。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于 workspace 的 PDF 文件路径' },
          pages: {
            type: 'array',
            items: { type: 'number' },
            description: '可选，指定要读取的页码列表（从 1 开始）。如果不提供则读取全部页。',
          },
          max_chars: { type: 'number', description: '返回文本的最大字符数，默认 12000' },
          include_meta: { type: 'boolean', description: '是否返回 PDF 元数据' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.RUN_SHELL_COMMAND,
      description: `在系统终端中运行 shell 命令。当前环境: 操作系统=${CURRENT_OS}, Shell=${CURRENT_SHELL}。`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要运行的 shell 命令' },
          timeout: { type: 'number', description: '超时时间（毫秒），默认为 30000。执行耗时长的安装命令时请调大此值。' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.GREP,
      description: '在文件中搜索正则表达式模式。支持递归目录搜索和文件过滤。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式模式' },
          path: { type: 'string', description: '搜索路径（相对于 workspace），默认为整个 workspace' },
          include: { type: 'string', description: '文件名 glob 过滤模式（如 "*.ts", "*.{js,ts}"）' },
          case_sensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
          context: { type: 'number', description: '显示匹配行前后多少行上下文，默认 0' },
          max_results: { type: 'number', description: '最大返回结果数，默认 100' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  GET_TIME_TOOL,
  RUN_AGENT_TOOL,
]

export async function executeTool(
  name: string,
  args: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  if (context.signal?.aborted) {
    return normalizeToolResult({ success: false, content: '', error: '工具调用已取消' })
  }
  if (context.profile && context.capabilityPolicy) {
    const capabilityDecision = context.capabilityPolicy.canUseTool(context.profile, name)
    if (!capabilityDecision.allowed) {
      return normalizeToolResult({
        success: false,
        content: '',
        error: capabilityDecision.reason ?? `未授权调用工具: ${name}`,
      })
    }
  }

  let result: ToolResult
  switch (name) {
    case TOOL_NAMES.READ_FILE:
      result = await executeReadFile(args, context)
      break
    case TOOL_NAMES.WRITE_FILE:
      result = await executeWriteFile(args, context)
      break
    case TOOL_NAMES.APPEND_FILE:
      result = await executeAppendFile(args, context)
      break
    case TOOL_NAMES.LIST_DIRECTORY:
      result = await executeListDirectory(args, context)
      break
    case TOOL_NAMES.LOCK_FILE:
      result = await executeLockFile(args, context)
      break
    case TOOL_NAMES.UNLOCK_FILE:
      result = await executeUnlockFile(args, context)
      break
    case TOOL_NAMES.UPSERT_JOB:
      result = await executeUpsertJob(args, context)
      break
    case TOOL_NAMES.TYPST_COMPILE:
      result = await executeTypstCompile(args, context)
      break
    case TOOL_NAMES.INSTALL_TYPST:
      result = await executeInstallTypst(args, context)
      break
    case TOOL_NAMES.RUN_SHELL_COMMAND:
      result = await executeShellCommand(args, context)
      break
    case TOOL_NAMES.READ_PDF:
      result = await executeReadPdf(args, context)
      break
    case TOOL_NAMES.GREP:
      result = await executeGrep(args, context)
      break
    case TOOL_NAMES.GET_TIME:
      result = await executeGetTime(args, context)
      break
    case TOOL_NAMES.RUN_AGENT:
      result = await executeRunAgent(args, context)
      break
    default:
      result = { success: false, content: '', error: `未知工具: ${name}` }
  }

  return normalizeToolResult(result)
}

function normalizeToolResult(result: ToolResult): ToolResult {
  const success = result.success ?? result.ok ?? false
  const content = result.content ?? result.summary ?? ''
  const error = result.error ?? result.errorMessage

  return {
    ...result,
    success,
    content,
    error,
    ok: result.ok ?? success,
    summary: result.summary ?? content,
    errorMessage: result.errorMessage ?? error,
  }
}
