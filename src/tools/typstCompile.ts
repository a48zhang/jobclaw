// typst_compile 工具实现
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolContext, ToolResult } from './index'
import { normalizeAndValidatePath } from './utils'

const execFileAsync = promisify(execFile)

/**
 * Linux / Codespace 常见字体路径常量
 * 用于 typst compile 的 --font-path 参数，确保中文字体可用
 */
export const FONT_PATHS: string[] = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  '/home/vscode/.fonts',
  '/root/.fonts',
]

/** typst 编译超时时间（毫秒） */
export const TYPST_COMPILE_TIMEOUT_MS = 60_000

/**
 * 检查 typst 是否可用
 * @returns typst 可执行文件路径，若不可用返回 null
 */
export async function findTypstBinary(): Promise<string | null> {
  try {
    await execFileAsync('typst', ['--version'])
    return 'typst'
  } catch {
    return null
  }
}

/**
 * 构建 typst compile 命令参数
 * @param inputPath 输入 .typ 文件的绝对路径
 * @param outputPath 输出 PDF 文件的绝对路径
 * @returns 命令参数数组
 */
export function buildTypstArgs(inputPath: string, outputPath: string): string[] {
  const args = ['compile']

  // 添加存在的字体路径
  for (const fontPath of FONT_PATHS) {
    if (fs.existsSync(fontPath)) {
      args.push('--font-path', fontPath)
    }
  }

  args.push(inputPath, outputPath)
  return args
}

/**
 * typst_compile 工具实现
 * 将指定的 .typ 文件编译为 PDF，输出到 workspace/output/resume.pdf
 */
export async function executeTypstCompile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { input_path } = args as { input_path: unknown }

  if (typeof input_path !== 'string') {
    return { success: false, content: '', error: 'input_path 参数必须是字符串' }
  }

  // 校验输入路径安全性
  const normalizedInput = normalizeAndValidatePath(input_path, context.workspaceRoot)
  if (!normalizedInput) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  // 检查输入文件是否存在
  if (!fs.existsSync(normalizedInput)) {
    return { success: false, content: '', error: `输入文件不存在：${input_path}` }
  }

  // 确保输出目录存在
  const outputDir = path.resolve(context.workspaceRoot, 'output')
  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true })
    } catch (mkdirErr) {
      return {
        success: false,
        content: '',
        error: `无法创建输出目录 "${outputDir}"：${(mkdirErr as Error).message}`,
      }
    }
  }

  // 预检输出目录写权限
  try {
    fs.accessSync(outputDir, fs.constants.W_OK)
  } catch {
    return {
      success: false,
      content: '',
      error: `输出目录 "${outputDir}" 不可写，请检查文件系统权限`,
    }
  }

  const outputPath = path.resolve(outputDir, 'resume.pdf')

  // 检查 typst 是否可用
  const typstBin = await findTypstBinary()
  if (!typstBin) {
    return {
      success: false,
      content: '',
      error:
        'typst 未安装或不可用。请先安装 typst：https://typst.app/docs/installation/ 或运行 `cargo install typst-cli`',
    }
  }

  // 构建并执行编译命令
  const typstArgs = buildTypstArgs(normalizedInput, outputPath)

  try {
    await execFileAsync(typstBin, typstArgs, { timeout: TYPST_COMPILE_TIMEOUT_MS })
    const relativeOutput = path.relative(context.workspaceRoot, outputPath)
    return {
      success: true,
      content: `简历编译成功，已输出到 ${relativeOutput}`,
    }
  } catch (err) {
    const error = err as { stderr?: string; message?: string }
    const detail = error.stderr ?? error.message ?? String(err)
    return {
      success: false,
      content: '',
      error: `typst 编译失败：${detail}`,
    }
  }
}
