// typst_compile 工具实现
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolContext, ToolResult } from './index'
import { normalizeAndValidatePath } from './utils'

const execFileAsync = promisify(execFile)

/** 常见字体路径 */
export const FONT_PATHS: string[] = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  '/home/vscode/.fonts',
  '/root/.fonts',
]

export const TYPST_COMPILE_TIMEOUT_MS = 60_000

/**
 * 辅助函数：运行命令并实时通过 logger 输出
 */
async function runWithLog(
  command: string,
  args: string[],
  logger: (line: string) => void,
  options: Record<string, any> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: true })

    child.stdout.on('data', (data) => {
      data.toString().split('\n').forEach((line: string) => {
        if (line.trim()) logger(line.trim())
      })
    })

    child.stderr.on('data', (data) => {
      data.toString().split('\n').forEach((line: string) => {
        if (line.trim()) logger(line.trim())
      })
    })

    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`命令退出码: ${code}`))
    })

    child.on('error', (err) => reject(err))
  })
}

export async function findTypstBinary(): Promise<string | null> {
  try {
    await execFileAsync('typst', ['--version'])
    return 'typst'
  } catch {
    const home = process.env.HOME || ''
    const cargoBinDir = path.join(home, '.cargo', 'bin')
    const typstBin = path.join(cargoBinDir, 'typst')
    if (fs.existsSync(typstBin)) {
      if (!process.env.PATH?.includes(cargoBinDir)) {
        process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
      }
      return typstBin
    }
    return null
  }
}

export async function autoInstallCargo(logger: (line: string) => void): Promise<boolean> {
  const home = process.env.HOME || ''
  const cargoBinDir = path.join(home, '.cargo', 'bin')
  const cargoBin = path.join(cargoBinDir, 'cargo')

  if (fs.existsSync(cargoBin)) {
    if (!process.env.PATH?.includes(cargoBinDir)) {
      process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
    }
    return true
  }

  logger('检测到 cargo 未安装，开始通过 rustup 安装...')
  try {
    const installCmd = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    await runWithLog('curl', ['--proto', "'=https'", '--tlsv1.2', '-sSf', 'https://sh.rustup.rs', '|', 'sh', '-s', '--', '-y'], logger)
    process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
    logger('Rust 工具链安装成功！')
    return true
  } catch (err) {
    logger(`安装 cargo 失败: ${(err as Error).message}`)
    return false
  }
}

export async function autoInstallTypst(logger: (line: string) => void): Promise<boolean> {
  logger('正在准备 typst 环境...')
  try {
    const cargoReady = await autoInstallCargo(logger)
    if (!cargoReady) throw new Error('Cargo 环境未就绪')

    logger('正在通过 cargo 安装 typst-cli (可能需要几分钟)...')
    await runWithLog('cargo', ['install', 'typst-cli'], logger)
    logger('typst 安装成功！')
    return true
  } catch (err) {
    logger(`自动安装 typst 失败: ${(err as Error).message}`)
    return false
  }
}

/**
 * 构建 typst compile 命令参数
 */
export function buildTypstArgs(inputPath: string, outputPath: string): string[] {
  const args = ['compile']
  for (const p of FONT_PATHS) { if (fs.existsSync(p)) args.push('--font-path', p) }
  args.push(inputPath, outputPath)
  return args
}

export async function executeTypstCompile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { input_path } = args as { input_path: unknown }
  if (typeof input_path !== 'string') return { success: false, content: '', error: 'input_path 必须是字符串' }

  const normalizedInput = normalizeAndValidatePath(input_path, context.workspaceRoot)
  if (!normalizedInput) return { success: false, content: '', error: '路径不安全' }

  const outputDir = path.resolve(context.workspaceRoot, 'output')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.resolve(outputDir, 'resume.pdf')

  const typstBin = await findTypstBinary()
  if (!typstBin) {
    return {
      success: false,
      content: '',
      error: 'typst 未安装。如果用户要求安装，请调用 install_typst 工具。',
    }
  }

  try {
    const argsArr = ['compile']
    for (const p of FONT_PATHS) { if (fs.existsSync(p)) argsArr.push('--font-path', p) }
    argsArr.push(normalizedInput, outputPath)

    await execFileAsync(typstBin, argsArr, { timeout: TYPST_COMPILE_TIMEOUT_MS })
    return { success: true, content: `简历已生成：output/resume.pdf` }
  } catch (err: any) {
    return { success: false, content: '', error: `编译失败: ${err.stderr || err.message}` }
  }
}

export async function executeInstallTypst(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const installed = await autoInstallTypst(context.logger)
  if (installed) {
    return { success: true, content: 'typst 环境已安装成功。' }
  } else {
    return { success: false, content: '', error: '安装失败，请检查 TUI 日志了解详情。' }
  }
}
