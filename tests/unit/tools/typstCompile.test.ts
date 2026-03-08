// typstCompile 工具单元测试
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { executeTool, TOOL_NAMES, type ToolContext } from '../../../src/tools/index'
import { FONT_PATHS, findTypstBinary, buildTypstArgs } from '../../../src/tools/typstCompile'

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')
const TEMP_DIR = path.resolve(TEST_WORKSPACE, '.test_typst_temp')

const createContext = (): ToolContext => ({
  workspaceRoot: TEST_WORKSPACE,
  agentName: 'main',
})

describe('FONT_PATHS 常量', () => {
  test('是一个非空数组', () => {
    expect(Array.isArray(FONT_PATHS)).toBe(true)
    expect(FONT_PATHS.length).toBeGreaterThan(0)
  })

  test('每个路径都是字符串', () => {
    for (const p of FONT_PATHS) {
      expect(typeof p).toBe('string')
    }
  })

  test('包含 /usr/share/fonts', () => {
    expect(FONT_PATHS).toContain('/usr/share/fonts')
  })
})

describe('buildTypstArgs', () => {
  test('第一个参数是 compile', () => {
    const args = buildTypstArgs('/tmp/input.typ', '/tmp/output.pdf')
    expect(args[0]).toBe('compile')
  })

  test('最后两个参数是输入和输出路径', () => {
    const args = buildTypstArgs('/tmp/input.typ', '/tmp/output.pdf')
    expect(args[args.length - 2]).toBe('/tmp/input.typ')
    expect(args[args.length - 1]).toBe('/tmp/output.pdf')
  })

  test('存在的字体路径被包含', () => {
    const args = buildTypstArgs('/tmp/input.typ', '/tmp/output.pdf')
    const fontPathArgs: string[] = []
    for (let i = 0; i < args.length - 2; i++) {
      if (args[i] === '--font-path') {
        fontPathArgs.push(args[i + 1])
      }
    }
    // 所有添加的字体路径都应该存在
    for (const fp of fontPathArgs) {
      expect(fs.existsSync(fp)).toBe(true)
    }
  })
})

describe('findTypstBinary', () => {
  test('返回字符串或 null', async () => {
    const result = await findTypstBinary()
    expect(result === null || typeof result === 'string').toBe(true)
  })
})

describe('typst_compile 工具（路径安全校验）', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true })
    }
    // 清理输出目录中的测试文件
    const outputDir = path.resolve(TEST_WORKSPACE, 'output')
    const outputPdf = path.resolve(outputDir, 'resume.pdf')
    if (fs.existsSync(outputPdf)) {
      // 只在测试环境中删除，不影响用户真实文件
      try {
        fs.unlinkSync(outputPdf)
      } catch {
        // 忽略清理失败
      }
    }
  })

  test('拒绝 ../ 路径穿越', async () => {
    const result = await executeTool(
      TOOL_NAMES.TYPST_COMPILE,
      { input_path: '../outside.typ' },
      createContext()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不安全')
  })

  test('拒绝深层路径穿越', async () => {
    const result = await executeTool(
      TOOL_NAMES.TYPST_COMPILE,
      { input_path: 'subdir/../../outside.typ' },
      createContext()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不安全')
  })

  test('不存在的文件返回错误', async () => {
    const result = await executeTool(
      TOOL_NAMES.TYPST_COMPILE,
      { input_path: 'nonexistent_file_xyz.typ' },
      createContext()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
  })

  test('input_path 参数类型错误时返回错误', async () => {
    const result = await executeTool(
      TOOL_NAMES.TYPST_COMPILE,
      { input_path: 123 },
      createContext()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('input_path 参数必须是字符串')
  })

  test('输出目录不可写时返回详细权限错误', async () => {
    // 仅在 Linux / macOS（非 root）环境下执行此测试
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      expect(true).toBe(true) // root 或 Windows 下跳过
      return
    }

    // 创建一个只读的输出目录（权限 0o444）
    const readonlyWorkspace = path.resolve(TEMP_DIR, 'readonly_ws')
    const readonlyOutput = path.resolve(readonlyWorkspace, 'output')
    fs.mkdirSync(readonlyOutput, { recursive: true })

    // 在 output 目录里创建一个合法 .typ 文件
    const typPath = path.resolve(readonlyWorkspace, 'test.typ')
    fs.writeFileSync(typPath, '#set page(paper: "a4")\nHello')

    // 将输出目录设置为只读
    fs.chmodSync(readonlyOutput, 0o444)

    try {
      const result = await executeTool(
        TOOL_NAMES.TYPST_COMPILE,
        { input_path: 'test.typ' },
        { workspaceRoot: readonlyWorkspace, agentName: 'test' }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('输出目录')
      expect(result.error).toContain('不可写')
    } finally {
      // 恢复权限，允许清理
      try { fs.chmodSync(readonlyOutput, 0o755) } catch { /* ignore */ }
    }
  })

  test('typst 不可用时返回友好错误', async () => {
    // 创建一个真实的 .typ 文件用于测试
    const typPath = path.resolve(TEMP_DIR, 'test.typ')
    fs.writeFileSync(typPath, '#set page(paper: "a4")\nHello, World!')
    const relPath = path.relative(TEST_WORKSPACE, typPath)

    const typstBin = await findTypstBinary()
    if (typstBin === null) {
      // typst 不可用时应返回友好错误
      const result = await executeTool(
        TOOL_NAMES.TYPST_COMPILE,
        { input_path: relPath },
        createContext()
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('typst')
    } else {
      // typst 可用，跳过此测试
      expect(true).toBe(true)
    }
  })
})

describe('TOOL_NAMES.TYPST_COMPILE', () => {
  test('常量值正确', () => {
    expect(TOOL_NAMES.TYPST_COMPILE).toBe('typst_compile')
  })
})

describe('typst_compile 工具 schema', () => {
  test('工具定义存在于 TOOLS 数组', async () => {
    const { TOOLS } = await import('../../../src/tools/index')
    const tool = TOOLS.find((t) => t.function.name === 'typst_compile')
    expect(tool).toBeDefined()
  })

  test('input_path 参数是必填项', async () => {
    const { TOOLS } = await import('../../../src/tools/index')
    const tool = TOOLS.find((t) => t.function.name === 'typst_compile')!
    expect(tool.function.parameters.required).toContain('input_path')
  })

  test('additionalProperties 为 false', async () => {
    const { TOOLS } = await import('../../../src/tools/index')
    const tool = TOOLS.find((t) => t.function.name === 'typst_compile')!
    expect(tool.function.parameters.additionalProperties).toBe(false)
  })
})
