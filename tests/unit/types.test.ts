// 类型定义单元测试 — Phase 1a
import { describe, test, expect } from 'vitest'
import type { AgentState, TaskType, TaskStatus, Task, Session } from '../../src/types'

describe('AgentState', () => {
  test('允许有效的状态值', () => {
    const states: AgentState[] = ['idle', 'running', 'waiting', 'error']
    expect(states).toHaveLength(4)
  })

  test('所有状态值都是字符串', () => {
    const state: AgentState = 'idle'
    expect(typeof state).toBe('string')
  })
})

describe('TaskType', () => {
  test('允许有效的任务类型', () => {
    const types: TaskType[] = ['search', 'delivery']
    expect(types).toHaveLength(2)
  })
})

describe('TaskStatus', () => {
  test('允许有效的任务状态', () => {
    const statuses: TaskStatus[] = ['pending', 'running', 'completed', 'failed']
    expect(statuses).toHaveLength(4)
  })
})

describe('Task', () => {
  test('创建有效的 Task 对象', () => {
    const task: Task = {
      id: '1',
      type: 'search',
      status: 'pending',
      input: 'search jobs',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    expect(task.id).toBe('1')
    expect(task.type).toBe('search')
  })

  test('payload 可以包含任意结构', () => {
    const task: Task = {
      id: '2',
      type: 'delivery',
      status: 'running',
      input: 'deliver to x',
      payload: { url: 'https://example.com', retryCount: 3 },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    expect(task.payload).toHaveProperty('url')
    expect((task.payload as any).retryCount).toBe(3)
  })
})

describe('Session', () => {
  test('创建空的 Session', () => {
    const session: Session = {
      currentTask: null,
      context: {},
      messages: [],
      todos: [],
    }

    expect(session.currentTask).toBeNull()
    expect(session.context).toEqual({})
    expect(session.messages).toHaveLength(0)
    expect(session.todos).toHaveLength(0)
  })

  test('创建包含任务的 Session', () => {
    const session: Session = {
      currentTask: {
        id: '1',
        type: 'search',
        status: 'pending',
        input: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      context: {},
      messages: [{ role: 'user', content: 'hi' }],
      todos: ['task 1'],
    }
    expect(session.currentTask?.id).toBe('1')
    expect(session.messages).toHaveLength(1)
    expect(session.todos).toContain('task 1')
  })

  test('Session 与现有 session.json 结构兼容', () => {
    // 模拟从文件读取的 JSON
    const sessionData = {
      currentTask: null,
      context: { lastCronAt: null },
      messages: [],
      todos: [],
    }

    // 验证可以赋值给 Session 类型
    const session: Session = sessionData

    expect(session.currentTask).toBeNull()
    expect(session.context).toEqual({ lastCronAt: null })
    expect(Array.isArray(session.messages)).toBe(true)
    expect(Array.isArray(session.todos)).toBe(true)
  })
})
