// Phase 1b 工具执行器全面测试
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { executeTool, TOOL_NAMES, type ToolContext, type ToolResult, getLockFilePath } from '../../../src/tools/index'
import { upsertJob } from '../../../src/tools/upsertJob'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 测试用临时目录
const TEST_WORKSPACE = path.resolve(__dirname, '../../../workspace')
const TEMP_DIR = path.resolve(TEST_WORKSPACE, '.test_temp')

// 测试上下文
const createContext = (agentName: string): ToolContext => ({
  workspaceRoot: TEST_WORKSPACE,
  agentName,
  logger: () => {},
})

// 辅助函数：执行工具
const runTool = async (name: string, args: Record<string, unknown>, agentName = 'main'): Promise<ToolResult> => {
  return executeTool(name, args, createContext(agentName))
}

// ============================================================================
// 测试环境设置/清理
// ============================================================================

describe('测试环境', () => {
  test('测试目录结构存在', () => {
    expect(fs.existsSync(TEST_WORKSPACE)).toBe(true)
  })
})

// ============================================================================
// T2.1 路径穿越防护测试
// ============================================================================

describe('路径穿越防护', () => {
  beforeEach(() => {
    const dataDir = path.join(TEST_WORKSPACE, 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    const jobsFile = path.join(dataDir, 'jobs.md')
    if (!fs.existsSync(jobsFile)) {
      fs.writeFileSync(jobsFile, '# Jobs', 'utf-8')
    }
    const agentsDir = path.join(TEST_WORKSPACE, 'agents/main')
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true })
    }
  })

  test('拒绝 ../ 路径穿越', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '../outside.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不安全')
  })

  test('拒绝深层 ../ 穿越', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: 'subdir/../../outside.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不安全')
  })

  test('拒绝 Windows 风格 ..\\ 穿越', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '..\\outside.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不安全')
  })

  test('拒绝混合路径穿越', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: 'data/../../outside.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不安全')
  })

  test('允许正常相对路径', async () => {
    // 使用存在的文件测试
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: 'data/jobs.md' })
    expect(result.success).toBe(true)
  })

  test('允许 ./ 前缀路径', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: './data/jobs.md' })
    expect(result.success).toBe(true)
  })

  test('允许子目录路径', async () => {
    const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, { path: 'agents/main' })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// T2.2 read_file 测试
// ============================================================================

describe('read_file 工具', () => {
  const testFile = path.join(TEMP_DIR, 'read_test.txt')
  const testContent = 'Hello, World! This is a test file.'

  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
    fs.writeFileSync(testFile, testContent, 'utf-8')
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  test('读取存在的文件', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '.test_temp/read_test.txt' })
    expect(result.success).toBe(true)
    expect(result.content).toBe(testContent)
  })

  test('读取不存在的文件', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '.test_temp/not_exist.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件不存在')
  })

  test('读取目录（非文件）', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '.test_temp' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不是文件')
  })

  test('使用 offset 分页读取', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, {
      path: '.test_temp/read_test.txt',
      offset: 7,
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('World! This is a test file.')
  })

  test('offset 超出文件长度', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, {
      path: '.test_temp/read_test.txt',
      offset: 1000,
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('')
  })

  test('path 参数必须是字符串', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, { path: 123 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('参数必须是字符串')
  })

  test('offset 参数必须是数字', async () => {
    const result = await runTool(TOOL_NAMES.READ_FILE, {
      path: '.test_temp/read_test.txt',
      offset: 'invalid',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('offset 参数必须是数字')
  })

  test('大文件超过限制返回错误并提示分页', async () => {
    // 创建大文件（超过 10000 tokens）
    const lines = []
    for (let i = 0; i < 2000; i++) {
      lines.push(`Line ${i}: Varied content to increase token count.`)
    }
    const largeContent = lines.join('\n')
    fs.writeFileSync(testFile, largeContent, 'utf-8')

    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '.test_temp/read_test.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件内容过大')
  })
})

// ============================================================================
// T2.3 write_file 测试
// ============================================================================

describe('write_file 工具', () => {
  const testFile = path.join(TEMP_DIR, 'write_test.txt')

  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
    fs.writeFileSync(testFile, 'Hello World\nThis is a test\nGoodbye World', 'utf-8')
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  test('old_string 唯一匹配时替换成功', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp/write_test.txt',
      old_string: 'This is a test',
      new_string: 'This is modified',
    })
    expect(result.success).toBe(true)
    const newContent = fs.readFileSync(testFile, 'utf-8')
    expect(newContent).toBe('Hello World\nThis is modified\nGoodbye World')
  })

  test('old_string 不存在时返回错误', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp/write_test.txt',
      old_string: 'not found',
      new_string: 'replacement',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('未找到匹配文本')
  })

  test('old_string 多处匹配时返回错误', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp/write_test.txt',
      old_string: 'World',
      new_string: 'Universe',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('找到多个匹配')
  })
})

// ============================================================================
// T2.6 lock_file 测试
// ============================================================================

describe('lock_file 工具', () => {
  const locksDir = path.join(TEST_WORKSPACE, '.locks')

  beforeEach(() => {
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true })
    }
    const dataDir = path.join(TEST_WORKSPACE, 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    const jobsFile = path.join(dataDir, 'jobs.md')
    if (!fs.existsSync(jobsFile)) {
      fs.writeFileSync(jobsFile, '# Jobs', 'utf-8')
    }
  })

  afterEach(() => {
    if (fs.existsSync(locksDir)) {
      const files = fs.readdirSync(locksDir)
      for (const file of files) {
        if (file.endsWith('.lock')) {
          fs.unlinkSync(path.join(locksDir, file))
        }
      }
    }
  })

  test('首次获取锁成功', async () => {
    const result = await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
    }, 'main')
    expect(result.success).toBe(true)
    expect(result.content).toBe('获取锁成功')

    const lockFile = path.join(locksDir, 'data__jobs.md.lock')
    expect(fs.existsSync(lockFile)).toBe(true)
  })

  test('同一 holder 再次获取（重入）成功', async () => {
    await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/jobs.md' }, 'main')
    const result = await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/jobs.md' }, 'main')
    expect(result.success).toBe(true)
  })

  test('不同 holder 尝试获取已锁文件失败', async () => {
    await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/jobs.md' }, 'main')
    const result = await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/jobs.md' }, 'search')
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件已被 main 锁定')
  })
})

// ============================================================================
// T2.7 unlock_file 测试
// ============================================================================

describe('unlock_file 工具', () => {
  const locksDir = path.join(TEST_WORKSPACE, '.locks')

  beforeEach(() => {
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(locksDir)) {
      const files = fs.readdirSync(locksDir)
      for (const file of files) {
        if (file.endsWith('.lock')) {
          fs.unlinkSync(path.join(locksDir, file))
        }
      }
    }
  })

  test('正确 holder 释放锁成功', async () => {
    await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/jobs.md' }, 'main')
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, { path: 'data/jobs.md' }, 'main')
    expect(result.success).toBe(true)
    expect(result.content).toBe('释放锁成功')
  })

  test('错误 holder 尝试释放锁失败', async () => {
    await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/jobs.md' }, 'main')
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, { path: 'data/jobs.md' }, 'search')
    expect(result.success).toBe(false)
    expect(result.error).toContain('锁由 main 持有')
  })

  test('释放不存在的锁（幂等）', async () => {
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, { path: 'data/jobs.md' }, 'main')
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// T2.8 访问边界测试
// ============================================================================

describe('访问边界', () => {
  const mainPrivateFile = path.join(TEST_WORKSPACE, 'agents/main/test.txt')
  const searchPrivateFile = path.join(TEST_WORKSPACE, 'agents/search/test.txt')
  const sharedFile = path.join(TEST_WORKSPACE, 'data/test_access.txt')

  beforeEach(() => {
    if (!fs.existsSync(path.dirname(mainPrivateFile))) fs.mkdirSync(path.dirname(mainPrivateFile), { recursive: true })
    if (!fs.existsSync(path.dirname(searchPrivateFile))) fs.mkdirSync(path.dirname(searchPrivateFile), { recursive: true })
    fs.writeFileSync(mainPrivateFile, 'main private', 'utf-8')
    fs.writeFileSync(searchPrivateFile, 'search private', 'utf-8')
    if (!fs.existsSync(path.dirname(sharedFile))) fs.mkdirSync(path.dirname(sharedFile), { recursive: true })
    fs.writeFileSync(sharedFile, 'shared data', 'utf-8')
  })

  afterEach(() => {
    if (fs.existsSync(mainPrivateFile)) fs.unlinkSync(mainPrivateFile)
    if (fs.existsSync(searchPrivateFile)) fs.unlinkSync(searchPrivateFile)
    if (fs.existsSync(sharedFile)) fs.unlinkSync(sharedFile)
  })

  test('持有锁后可写入共享路径', async () => {
    await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/test_access.txt' }, 'main')
    const writeResult = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: 'data/test_access.txt',
      old_string: 'shared data',
      new_string: 'modified by main',
    }, 'main')
    expect(writeResult.success).toBe(true)
    await runTool(TOOL_NAMES.UNLOCK_FILE, { path: 'data/test_access.txt' }, 'main')
  })
})

// ============================================================================
// 锁超时测试
// ============================================================================

describe('锁超时机制', () => {
  const locksDir = path.join(TEST_WORKSPACE, '.locks')
  const lockFile = path.join(locksDir, 'data__timeout_test.md.lock')

  beforeEach(() => {
    if (!fs.existsSync(locksDir)) fs.mkdirSync(locksDir, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile)
  })

  test('锁超时后可被其他 Agent 获取', async () => {
    const oldTimestamp = Date.now() - 31000
    const targetFile = path.join(TEST_WORKSPACE, 'data/timeout_test.md')
    if (!fs.existsSync(path.dirname(targetFile))) fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.writeFileSync(targetFile, '', 'utf-8')
    fs.writeFileSync(lockFile, JSON.stringify({ holder: 'main', timestamp: oldTimestamp }), 'utf-8')
    const result = await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/timeout_test.md' }, 'search')
    expect(result.success).toBe(true)
    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile)
  })

  test('锁未超时时其他 Agent 无法获取', async () => {
    const targetFile = path.join(TEST_WORKSPACE, 'data/timeout_test.md')
    if (!fs.existsSync(path.dirname(targetFile))) fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.writeFileSync(targetFile, '', 'utf-8')
    await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/timeout_test.md' }, 'main')
    const result = await runTool(TOOL_NAMES.LOCK_FILE, { path: 'data/timeout_test.md' }, 'search')
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件已被 main 锁定')
    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile)
  })
})

// ============================================================================
// 锁文件路径唯一性测试
// ============================================================================

describe('锁文件路径唯一性', () => {
  test('不同目录下的同名文件生成不同的锁文件路径', () => {
    const lockPath1 = getLockFilePath('data/jobs.md', TEST_WORKSPACE)
    const lockPath2 = getLockFilePath('agents/main/jobs.md', TEST_WORKSPACE)
    expect(lockPath1).not.toBe(lockPath2)
  })
})

// ============================================================================
// upsertJob 宽容行解析测试
// ============================================================================
describe('upsertJob 宽容行解析', () => {
  let tmpWorkspace: string

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-upsert-'))
    fs.mkdirSync(path.join(tmpWorkspace, 'data'), { recursive: true })
    fs.mkdirSync(path.join(tmpWorkspace, '.locks'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  })

  test('正常职位行可被正确解析和写入', async () => {
    const result = await upsertJob(
      { company: 'Acme', title: 'Engineer', url: 'https://acme.com/job1', status: 'discovered' },
      { workspaceRoot: tmpWorkspace, agentName: 'test', logger: () => {} }
    )
    expect(result.success).toBe(true)
  })
})
