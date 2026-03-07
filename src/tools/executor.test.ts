// Phase 1b 工具执行器全面测试
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { executeTool, TOOL_NAMES, type ToolContext, type ToolResult, getLockFilePath } from './index'
import * as fs from 'node:fs'
import * as path from 'node:path'

// 测试用临时目录
const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../workspace')
const TEMP_DIR = path.resolve(TEST_WORKSPACE, '.test_temp')

// 测试上下文
const createContext = (agentName: string): ToolContext => ({
  workspaceRoot: TEST_WORKSPACE,
  agentName,
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
    expect(result.error).toContain('path 参数必须是字符串')
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
    // 使用多样化内容以避免 tokenizer 合并
    const lines = []
    for (let i = 0; i < 2000; i++) {
      lines.push(`Line ${i}: This is a test line with some varied content to increase token count.`)
    }
    const largeContent = lines.join('\n')
    fs.writeFileSync(testFile, largeContent, 'utf-8')

    const result = await runTool(TOOL_NAMES.READ_FILE, { path: '.test_temp/read_test.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件内容过大')
    expect(result.error).toContain('offset')
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
    expect(result.content).toBe('This is modified')

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

    // 文件内容不变
    const content = fs.readFileSync(testFile, 'utf-8')
    expect(content).toContain('This is a test')
  })

  test('old_string 多处匹配时返回错误', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp/write_test.txt',
      old_string: 'World',
      new_string: 'Universe',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('找到多个匹配')

    // 文件内容不变
    const content = fs.readFileSync(testFile, 'utf-8')
    expect(content).not.toContain('Universe')
  })

  test('写入不存在的文件返回错误', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp/not_exist.txt',
      old_string: 'test',
      new_string: 'replacement',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件不存在')
  })

  test('old_string 为空字符串返回错误', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp/write_test.txt',
      old_string: '',
      new_string: 'replacement',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('old_string 不能为空字符串')
  })

  test('参数类型验证', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: 123,
      old_string: 'test',
      new_string: 'replacement',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path 参数必须是字符串')
  })

  test('写入目录（非文件）返回错误', async () => {
    const result = await runTool(TOOL_NAMES.WRITE_FILE, {
      path: '.test_temp',
      old_string: 'test',
      new_string: 'replacement',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不是文件')
  })
})

// ============================================================================
// T2.4 append_file 测试
// ============================================================================

describe('append_file 工具', () => {
  const testFile = path.join(TEMP_DIR, 'append_test.txt')

  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  test('追加到存在的文件', async () => {
    fs.writeFileSync(testFile, 'Initial content\n', 'utf-8')

    const result = await runTool(TOOL_NAMES.APPEND_FILE, {
      path: '.test_temp/append_test.txt',
      content: 'Appended content',
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('追加完成')

    const fileContent = fs.readFileSync(testFile, 'utf-8')
    expect(fileContent).toBe('Initial content\nAppended content')
  })

  test('追加到不存在的文件（自动创建）', async () => {
    const result = await runTool(TOOL_NAMES.APPEND_FILE, {
      path: '.test_temp/append_test.txt',
      content: 'New file content',
    })
    expect(result.success).toBe(true)

    const fileContent = fs.readFileSync(testFile, 'utf-8')
    expect(fileContent).toBe('New file content')
  })

  test('追加空字符串', async () => {
    fs.writeFileSync(testFile, 'Initial', 'utf-8')

    const result = await runTool(TOOL_NAMES.APPEND_FILE, {
      path: '.test_temp/append_test.txt',
      content: '',
    })
    expect(result.success).toBe(true)

    const fileContent = fs.readFileSync(testFile, 'utf-8')
    expect(fileContent).toBe('Initial')
  })

  test('参数类型验证', async () => {
    const result = await runTool(TOOL_NAMES.APPEND_FILE, {
      path: 123,
      content: 'test',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path 参数必须是字符串')
  })
})

// ============================================================================
// T2.5 list_directory 测试
// ============================================================================

describe('list_directory 工具', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
    // 创建测试结构
    fs.writeFileSync(path.join(TEMP_DIR, 'file1.txt'), '', 'utf-8')
    fs.writeFileSync(path.join(TEMP_DIR, 'file2.md'), '', 'utf-8')
    fs.mkdirSync(path.join(TEMP_DIR, 'subdir'), { recursive: true })
  })

  afterEach(() => {
    // 清理测试结构
    const subdir = path.join(TEMP_DIR, 'subdir')
    if (fs.existsSync(subdir)) {
      fs.rmdirSync(subdir)
    }
    const file1 = path.join(TEMP_DIR, 'file1.txt')
    const file2 = path.join(TEMP_DIR, 'file2.md')
    if (fs.existsSync(file1)) fs.unlinkSync(file1)
    if (fs.existsSync(file2)) fs.unlinkSync(file2)
  })

  test('列出存在的目录', async () => {
    const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, { path: '.test_temp' })
    expect(result.success).toBe(true)
    expect(result.content).toContain('[FILE] file1.txt')
    expect(result.content).toContain('[FILE] file2.md')
    expect(result.content).toContain('[DIR] subdir/')
  })

  test('列出空目录', async () => {
    const emptyDir = path.join(TEMP_DIR, 'empty')
    fs.mkdirSync(emptyDir, { recursive: true })

    const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, { path: '.test_temp/empty' })
    expect(result.success).toBe(true)
    expect(result.content).toBe('')

    fs.rmdirSync(emptyDir)
  })

  test('列出不存在的目录', async () => {
    const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, { path: '.test_temp/not_exist' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('目录不存在')
  })

  test('列出文件（非目录）', async () => {
    const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, { path: '.test_temp/file1.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('路径不是目录')
  })

  test('参数类型验证', async () => {
    const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, { path: 123 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path 参数必须是字符串')
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
  })

  afterEach(() => {
    // 清理所有测试锁文件
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
      holder: 'main',
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('获取锁成功')

    // 验证锁文件存在（使用完整路径作为锁文件名）
    const lockFile = path.join(locksDir, 'data__jobs.md.lock')
    expect(fs.existsSync(lockFile)).toBe(true)

    const lockContent = JSON.parse(fs.readFileSync(lockFile, 'utf-8'))
    expect(lockContent.holder).toBe('main')
    expect(lockContent.timestamp).toBeDefined()
  })

  test('同一 holder 再次获取（重入）成功', async () => {
    // 第一次获取
    await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })

    // 第二次获取（重入）
    const result = await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('锁已续期')
  })

  test('不同 holder 尝试获取已锁文件失败', async () => {
    // main 获取锁
    await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })

    // search 尝试获取
    const result = await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'search',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件已被 main 锁定')
    expect(result.error).toContain('剩余')
  })

  test('参数类型验证', async () => {
    const result = await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 123,
      holder: 'main',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path 参数必须是字符串')
  })
})

// ============================================================================
// 锁文件路径唯一性测试（修复 A）
// ============================================================================

describe('锁文件路径唯一性', () => {
  test('不同目录下的同名文件生成不同的锁文件路径', () => {
    const workspaceRoot = TEST_WORKSPACE

    // 获取两个同名文件的锁文件路径
    const lockPath1 = getLockFilePath('data/jobs.md', workspaceRoot)
    const lockPath2 = getLockFilePath('agents/main/jobs.md', workspaceRoot)

    // 它们应该是不同的
    expect(lockPath1).not.toBe(lockPath2)

    // 验证锁文件名包含完整路径信息
    expect(path.basename(lockPath1)).toBe('data__jobs.md.lock')
    expect(path.basename(lockPath2)).toBe('agents__main__jobs.md.lock')
  })

  test('相同路径生成相同的锁文件路径', () => {
    const workspaceRoot = TEST_WORKSPACE

    const lockPath1 = getLockFilePath('data/jobs.md', workspaceRoot)
    const lockPath2 = getLockFilePath('data/jobs.md', workspaceRoot)

    expect(lockPath1).toBe(lockPath2)
  })

  test('Windows 风格路径也能正确处理', () => {
    const workspaceRoot = TEST_WORKSPACE

    const lockPath = getLockFilePath('data\\jobs.md', workspaceRoot)

    // Windows 路径分隔符应该被转换为 __
    expect(path.basename(lockPath)).toBe('data__jobs.md.lock')
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
    // 清理所有测试锁文件
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
    // 先获取锁
    await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })

    // 释放锁
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('释放锁成功')

    // 验证锁文件已删除
    const lockFile = path.join(locksDir, 'data__jobs.md.lock')
    expect(fs.existsSync(lockFile)).toBe(false)
  })

  test('错误 holder 尝试释放锁失败', async () => {
    // main 获取锁
    await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })

    // search 尝试释放
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'search',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('锁由 main 持有')

    // 锁文件仍存在
    const lockFile = path.join(locksDir, 'data__jobs.md.lock')
    expect(fs.existsSync(lockFile)).toBe(true)
  })

  test('释放不存在的锁（幂等）', async () => {
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, {
      path: 'data/jobs.md',
      holder: 'main',
    })
    expect(result.success).toBe(true)
    expect(result.content).toBe('文件未锁定')
  })

  test('参数类型验证', async () => {
    const result = await runTool(TOOL_NAMES.UNLOCK_FILE, {
      path: 123,
      holder: 'main',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path 参数必须是字符串')
  })
})

// ============================================================================
// T2.8 访问边界测试
// ============================================================================

describe('访问边界', () => {
  const mainPrivateFile = path.join(TEST_WORKSPACE, 'agents/main/test.txt')
  const searchPrivateFile = path.join(TEST_WORKSPACE, 'agents/search/test.txt')
  const sharedFile = path.join(TEST_WORKSPACE, 'data/test_access.txt')
  const locksDir = path.join(TEST_WORKSPACE, '.locks')

  beforeEach(() => {
    // 创建私有目录测试文件
    if (!fs.existsSync(path.dirname(mainPrivateFile))) {
      fs.mkdirSync(path.dirname(mainPrivateFile), { recursive: true })
    }
    if (!fs.existsSync(path.dirname(searchPrivateFile))) {
      fs.mkdirSync(path.dirname(searchPrivateFile), { recursive: true })
    }
    fs.writeFileSync(mainPrivateFile, 'main private', 'utf-8')
    fs.writeFileSync(searchPrivateFile, 'search private', 'utf-8')

    // 创建共享目录测试文件
    if (!fs.existsSync(path.dirname(sharedFile))) {
      fs.mkdirSync(path.dirname(sharedFile), { recursive: true })
    }
    fs.writeFileSync(sharedFile, 'shared data', 'utf-8')

    // 确保锁目录存在
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true })
    }
  })

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(mainPrivateFile)) fs.unlinkSync(mainPrivateFile)
    if (fs.existsSync(searchPrivateFile)) fs.unlinkSync(searchPrivateFile)
    if (fs.existsSync(sharedFile)) fs.unlinkSync(sharedFile)

    // 清理锁文件
    if (fs.existsSync(locksDir)) {
      const files = fs.readdirSync(locksDir)
      for (const file of files) {
        if (file.endsWith('.lock')) {
          fs.unlinkSync(path.join(locksDir, file))
        }
      }
    }
  })

  describe('私有路径访问', () => {
    test('main Agent 可读自己的私有路径', async () => {
      const result = await runTool(TOOL_NAMES.READ_FILE, {
        path: 'agents/main/test.txt',
      }, 'main')
      expect(result.success).toBe(true)
      expect(result.content).toBe('main private')
    })

    test('main Agent 可写自己的私有路径', async () => {
      const result = await runTool(TOOL_NAMES.WRITE_FILE, {
        path: 'agents/main/test.txt',
        old_string: 'main private',
        new_string: 'modified by main',
      }, 'main')
      expect(result.success).toBe(true)
    })

    test('search Agent 不能读 main 的私有路径', async () => {
      const result = await runTool(TOOL_NAMES.READ_FILE, {
        path: 'agents/main/test.txt',
      }, 'search')
      expect(result.success).toBe(false)
      expect(result.error).toContain('私有路径禁止访问')
    })

    test('search Agent 不能写 main 的私有路径', async () => {
      const result = await runTool(TOOL_NAMES.WRITE_FILE, {
        path: 'agents/main/test.txt',
        old_string: 'main private',
        new_string: 'hacked',
      }, 'search')
      expect(result.success).toBe(false)
      expect(result.error).toContain('私有路径禁止访问')
    })
  })

  describe('共享路径访问', () => {
    test('所有 Agent 可读共享路径', async () => {
      const mainResult = await runTool(TOOL_NAMES.READ_FILE, {
        path: 'data/test_access.txt',
      }, 'main')
      const searchResult = await runTool(TOOL_NAMES.READ_FILE, {
        path: 'data/test_access.txt',
      }, 'search')

      expect(mainResult.success).toBe(true)
      expect(searchResult.success).toBe(true)
    })

    test('写入共享路径需要文件锁', async () => {
      const result = await runTool(TOOL_NAMES.WRITE_FILE, {
        path: 'data/test_access.txt',
        old_string: 'shared data',
        new_string: 'modified',
      }, 'main')
      expect(result.success).toBe(false)
      expect(result.error).toContain('共享路径写入需要文件锁')
    })

    test('持有锁后可写入共享路径', async () => {
      // 获取锁
      const lockResult = await runTool(TOOL_NAMES.LOCK_FILE, {
        path: 'data/test_access.txt',
        holder: 'main',
      }, 'main')
      expect(lockResult.success).toBe(true)

      // 写入
      const writeResult = await runTool(TOOL_NAMES.WRITE_FILE, {
        path: 'data/test_access.txt',
        old_string: 'shared data',
        new_string: 'modified by main with lock',
      }, 'main')
      expect(writeResult.success).toBe(true)

      // 释放锁
      await runTool(TOOL_NAMES.UNLOCK_FILE, {
        path: 'data/test_access.txt',
        holder: 'main',
      }, 'main')
    })

    test('其他 Agent 持有锁时不能写入', async () => {
      // search 获取锁
      await runTool(TOOL_NAMES.LOCK_FILE, {
        path: 'data/test_access.txt',
        holder: 'search',
      }, 'search')

      // main 尝试写入（应失败）
      const result = await runTool(TOOL_NAMES.WRITE_FILE, {
        path: 'data/test_access.txt',
        old_string: 'shared data',
        new_string: 'hacked',
      }, 'main')
      expect(result.success).toBe(false)
      expect(result.error).toContain('共享路径写入需要文件锁')

      // 清理
      await runTool(TOOL_NAMES.UNLOCK_FILE, {
        path: 'data/test_access.txt',
        holder: 'search',
      }, 'search')
    })
  })

  describe('系统路径访问', () => {
    test('禁止直接访问 .locks 目录', async () => {
      const result = await runTool(TOOL_NAMES.LIST_DIRECTORY, {
        path: '.locks',
      }, 'main')
      expect(result.success).toBe(false)
      expect(result.error).toContain('系统路径禁止直接访问')
    })

    test('禁止读取 .locks 下的文件', async () => {
      // 先创建一个锁
      await runTool(TOOL_NAMES.LOCK_FILE, {
        path: 'data/jobs.md',
        holder: 'main',
      }, 'main')

      const result = await runTool(TOOL_NAMES.READ_FILE, {
        path: '.locks/jobs.md.lock',
      }, 'main')
      expect(result.success).toBe(false)
      expect(result.error).toContain('系统路径禁止直接访问')
    })
  })
})

// ============================================================================
// T2.9 并发锁测试（模拟）
// ============================================================================

describe('锁超时机制', () => {
  const locksDir = path.join(TEST_WORKSPACE, '.locks')
  // 锁文件路径使用完整路径格式
  const lockFile = path.join(locksDir, 'data__timeout_test.md.lock')

  beforeEach(() => {
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile)
    }
  })

  test('锁超时后可被其他 Agent 获取', async () => {
    // 创建一个已超时的锁（手动设置 31 秒前的时间戳）
    const oldTimestamp = Date.now() - 31000
    fs.writeFileSync(lockFile, JSON.stringify({
      holder: 'main',
      timestamp: oldTimestamp,
    }), 'utf-8')

    // search 应该可以获取锁
    const result = await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/timeout_test.md',
      holder: 'search',
    }, 'search')
    expect(result.success).toBe(true)
    expect(result.content).toBe('获取锁成功')

    // 验证锁已被 search 持有
    const lockContent = JSON.parse(fs.readFileSync(lockFile, 'utf-8'))
    expect(lockContent.holder).toBe('search')
  })

  test('锁未超时时其他 Agent 无法获取', async () => {
    // main 获取锁
    await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/timeout_test.md',
      holder: 'main',
    }, 'main')

    // search 尝试获取
    const result = await runTool(TOOL_NAMES.LOCK_FILE, {
      path: 'data/timeout_test.md',
      holder: 'search',
    }, 'search')
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件已被 main 锁定')
  })
})

// ============================================================================
// 未知工具测试
// ============================================================================

describe('未知工具', () => {
  test('调用未知工具返回错误', async () => {
    const result = await runTool('unknown_tool', { path: 'test' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('未知工具')
  })
})
