// typst_compile 工具实现
import { execFile, execSync } from 'node:child_process'
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
    // 检查常见安装路径是否在 PATH 中（针对刚刚安装的情况）
    const home = process.env.HOME || ''
    const cargoBinDir = path.join(home, '.cargo', 'bin')
    const typstBin = path.join(cargoBinDir, 'typst')
    if (fs.existsSync(typstBin)) {
      // 临时更新当前进程的 PATH 以便后续调用
      if (!process.env.PATH?.includes(cargoBinDir)) {
        process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
      }
      return typstBin
    }
    return null
  }
}

/**
 * 自动安装 cargo (Rust toolchain)
 * 通过 rustup 官方脚本安装
 */
export async function autoInstallCargo(): Promise<boolean> {
  const home = process.env.HOME || ''
  const cargoBinDir = path.join(home, '.cargo', 'bin')
  const cargoBin = path.join(cargoBinDir, 'cargo')

  if (fs.existsSync(cargoBin)) {
    // 已经存在但可能不在 PATH 中
    if (!process.env.PATH?.includes(cargoBinDir)) {
      process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
    }
    return true
  }

  console.log('[JobClaw] 检测到 cargo 未安装，正在通过 rustup 自动安装 Rust 工具链...')
  try {
    // 使用 curl 下载并运行 rustup 安装脚本 (非交互模式 -y)
    const installCmd = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    execSync(installCmd, { stdio: 'inherit' })
    
    // 更新当前进程的 PATH
    process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
    console.log('[JobClaw] Rust 工具链安装成功！')
    return true
  } catch (err) {
    console.error('[JobClaw] 自动安装 cargo 失败。错误详情:', (err as Error).message)
    return false
  }
}

/**
 * 自动安装 typst (由 install_typst 工具调用)
 */
export async function autoInstallTypst(): Promise<boolean> {
  console.log('[JobClaw] 正在尝试自动安装 typst...')
  try {
    // 1. 确保 cargo 可用
    const cargoReady = await autoInstallCargo()
    if (!cargoReady) {
      throw new Error('无法准备 cargo 环境')
    }

    // 2. 使用 cargo 安装 typst-cli
    console.log('[JobClaw] 正在通过 cargo 安装 typst-cli...')
    await execFileAsync('cargo', ['install', 'typst-cli'], { timeout: 300_000 })
    console.log('[JobClaw] typst 安装成功！')
    return true
  } catch (err) {
    console.error('[JobClaw] 自动安装 typst 失败。请尝试手动安装：https://typst.app/docs/installation/')
    console.error('错误详情:', (err as Error).message)
    return false
  }
}

/**
 * 构建 typst compile 命令参数
 */
export function buildTypstArgs(inputPath: string, outputPath: string): string[] {
  const args = ['compile']
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
 */
export async function executeTypstCompile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { input_path } = args as { input_path: unknown }

  if (typeof input_path !== 'string') {
    return { success: false, content: '', error: 'input_path 参数必须是字符串' }
  }

  const normalizedInput = normalizeAndValidatePath(input_path, context.workspaceRoot)
  if (!normalizedInput) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  if (!fs.existsSync(normalizedInput)) {
    return { success: false, content: '', error: `输入文件不存在：${input_path}` }
  }

  const outputDir = path.resolve(context.workspaceRoot, 'output')
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    fs.accessSync(outputDir, fs.constants.W_OK)
  } catch (err) {
    return { success: false, content: '', error: `输出目录不可写或无法创建：${outputDir}` }
  }

  const outputPath = path.resolve(outputDir, 'resume.pdf')

  // 检查 typst 是否可用（此时不自动安装）
  const typstBin = await findTypstBinary()
  if (!typstBin) {
    return {
      success: false,
      content: '',
      error:
        'typst 未安装，无法执行编译。请告知用户环境缺失，如果用户要求安装，请调用 install_typst 工具。',
    }
  }

  const typstArgs = buildTypstArgs(normalizedInput, outputPath)

  try {
    await execFileAsync(typstBin, typstArgs, { timeout: TYPST_COMPILE_TIMEOUT_MS })
    const relativeOutput = path.relative(context.workspaceRoot, outputPath)
    return { success: true, content: `简历编译成功，已输出到 ${relativeOutput}` }
  } catch (err) {
    const error = err as { stderr?: string; message?: string }
    const detail = error.stderr ?? error.message ?? String(err)
    return { success: false, content: '', error: `typst 编译失败：${detail}` }
  }
}

/**
 * install_typst 工具实现
 * 只有在用户明确授权后，Agent 才会调用此工具。
 */
export async function executeInstallTypst(
  _args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const installed = await autoInstallTypst()
  if (installed) {
    return { success: true, content: 'typst 环境安装成功。现在可以继续生成简历了。' }
  } else {
    return { success: false, content: '', error: '自动安装 typst 失败，请用户检查终端输出或手动安装。' }
  }
}
