// 工具 Schema 单元测试 - Phase 1a
import { describe, test, expect } from 'bun:test'
import { TOOLS, TOOL_NAMES } from './index'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

describe('TOOL_NAMES 常量', () => {
  test('包含所有工具名称', () => {
    expect(TOOL_NAMES.READ_FILE).toBe('read_file')
    expect(TOOL_NAMES.WRITE_FILE).toBe('write_file')
    expect(TOOL_NAMES.APPEND_FILE).toBe('append_file')
    expect(TOOL_NAMES.LIST_DIRECTORY).toBe('list_directory')
    expect(TOOL_NAMES.LOCK_FILE).toBe('lock_file')
    expect(TOOL_NAMES.UNLOCK_FILE).toBe('unlock_file')
  })
})

describe('TOOLS 数组', () => {
  test('包含 6 个工具', () => {
    expect(TOOLS).toHaveLength(6)
  })

  test('每个工具都有正确的类型', () => {
    TOOLS.forEach((tool) => {
      expect(tool.type).toBe('function')
    })
  })

  test('每个工具都有 function 定义', () => {
    TOOLS.forEach((tool) => {
      expect(tool.function).toBeDefined()
      expect(tool.function.name).toBeDefined()
      expect(tool.function.description).toBeDefined()
      expect(typeof tool.function.name).toBe('string')
      expect(typeof tool.function.description).toBe('string')
    })
  })

  test('每个工具都有 parameters 定义', () => {
    TOOLS.forEach((tool) => {
      expect(tool.function.parameters).toBeDefined()
      expect(tool.function.parameters.type).toBe('object')
      expect(tool.function.parameters.properties).toBeDefined()
      expect(tool.function.parameters.additionalProperties).toBe(false)
    })
  })

  test('所有工具名称唯一', () => {
    const names = TOOLS.map((t) => t.function.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })

  test('包含所有预期的工具名称', () => {
    const names = TOOLS.map((t) => t.function.name)
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('append_file')
    expect(names).toContain('list_directory')
    expect(names).toContain('lock_file')
    expect(names).toContain('unlock_file')
  })
})

describe('read_file 工具', () => {
  const tool = TOOLS.find((t) => t.function.name === 'read_file')!

  test('path 参数是必填的', () => {
    expect(tool.function.parameters.required).toContain('path')
  })

  test('offset 参数是可选的', () => {
    expect(tool.function.parameters.required).not.toContain('offset')
    expect(tool.function.parameters.properties.offset).toBeDefined()
  })

  test('path 参数类型是 string', () => {
    expect(tool.function.parameters.properties.path.type).toBe('string')
  })
})

describe('write_file 工具', () => {
  const tool = TOOLS.find((t) => t.function.name === 'write_file')!

  test('所有参数都是必填的', () => {
    expect(tool.function.parameters.required).toContain('path')
    expect(tool.function.parameters.required).toContain('old_string')
    expect(tool.function.parameters.required).toContain('new_string')
  })

  test('参数类型正确', () => {
    expect(tool.function.parameters.properties.path.type).toBe('string')
    expect(tool.function.parameters.properties.old_string.type).toBe('string')
    expect(tool.function.parameters.properties.new_string.type).toBe('string')
  })
})

describe('append_file 工具', () => {
  const tool = TOOLS.find((t) => t.function.name === 'append_file')!

  test('所有参数都是必填的', () => {
    expect(tool.function.parameters.required).toContain('path')
    expect(tool.function.parameters.required).toContain('content')
  })

  test('参数类型正确', () => {
    expect(tool.function.parameters.properties.path.type).toBe('string')
    expect(tool.function.parameters.properties.content.type).toBe('string')
  })
})

describe('list_directory 工具', () => {
  const tool = TOOLS.find((t) => t.function.name === 'list_directory')!

  test('path 参数是必填的', () => {
    expect(tool.function.parameters.required).toContain('path')
  })
})

describe('lock_file 工具', () => {
  const tool = TOOLS.find((t) => t.function.name === 'lock_file')!

  test('所有参数都是必填的', () => {
    expect(tool.function.parameters.required).toContain('path')
    expect(tool.function.parameters.required).toContain('holder')
  })

  test('holder 参数类型是 string', () => {
    expect(tool.function.parameters.properties.holder.type).toBe('string')
  })
})

describe('unlock_file 工具', () => {
  const tool = TOOLS.find((t) => t.function.name === 'unlock_file')!

  test('所有参数都是必填的', () => {
    expect(tool.function.parameters.required).toContain('path')
    expect(tool.function.parameters.required).toContain('holder')
  })
})

describe('JSON 序列化', () => {
  test('TOOLS 可以被序列化为 JSON', () => {
    const json = JSON.stringify(TOOLS)
    expect(json).toBeDefined()
    expect(typeof json).toBe('string')
  })

  test('JSON 反序列化后数据完整', () => {
    const json = JSON.stringify(TOOLS)
    const parsed = JSON.parse(json) as ChatCompletionTool[]

    expect(parsed).toHaveLength(6)
    parsed.forEach((tool, index) => {
      expect(tool.type).toBe('function')
      expect(tool.function.name).toBe(TOOLS[index].function.name)
      expect(tool.function.description).toBe(TOOLS[index].function.description)
    })
  })

  test('序列化后的 JSON 包含所有必需字段', () => {
    const json = JSON.stringify(TOOLS)
    const parsed = JSON.parse(json) as ChatCompletionTool[]

    parsed.forEach((tool) => {
      expect(tool).toHaveProperty('type')
      expect(tool).toHaveProperty('function')
      expect(tool.function).toHaveProperty('name')
      expect(tool.function).toHaveProperty('description')
      expect(tool.function).toHaveProperty('parameters')
      expect(tool.function.parameters).toHaveProperty('type')
      expect(tool.function.parameters).toHaveProperty('properties')
      expect(tool.function.parameters).toHaveProperty('required')
    })
  })
})
