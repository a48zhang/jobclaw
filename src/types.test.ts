// 类型定义单元测试 - Phase 1a
import { describe, test, expect } from 'bun:test'
import type { AgentState, Task, Session, TaskType, TaskStatus } from './types'

describe('AgentState', () => {
  test('允许有效的状态值', () => {
    const idle: AgentState = 'idle'
    const running: AgentState = 'running'
    const waiting: AgentState = 'waiting'
    const error: AgentState = 'error'

    expect(idle).toBe('idle')
    expect(running).toBe('running')
    expect(waiting).toBe('waiting')
    expect(error).toBe('error')
  })

  test('所有状态值都是字符串', () => {
    const states: AgentState[] = ['idle', 'running', 'waiting', 'error']
    states.forEach((state) => {
      expect(typeof state).toBe('string')
    })
  })
})

describe('TaskType', () => {
  test('允许有效的任务类型', () => {
    const search: TaskType = 'search'
    const deliver: TaskType = 'deliver'

    expect(search).toBe('search')
    expect(deliver).toBe('deliver')
  })
})

describe('TaskStatus', () => {
  test('允许有效的任务状态', () => {
    const pending: TaskStatus = 'pending'
    const inProgress: TaskStatus = 'in_progress'
    const completed: TaskStatus = 'completed'
    const failed: TaskStatus = 'failed'

    expect(pending).toBe('pending')
    expect(inProgress).toBe('in_progress')
    expect(completed).toBe('completed')
    expect(failed).toBe('failed')
  })
})

describe('Task', () => {
  test('创建有效的 Task 对象', () => {
    const task: Task = {
      id: 'task-001',
      type: 'search',
      payload: { query: 'test query' },
      status: 'pending',
    }

    expect(task.id).toBe('task-001')
    expect(task.type).toBe('search')
    expect(task.payload).toEqual({ query: 'test query' })
    expect(task.status).toBe('pending')
  })

  test('payload 可以包含任意结构', () => {
    const task: Task = {
      id: 'task-002',
      type: 'deliver',
      payload: {
        nested: {
          deep: {
            value: 123,
          },
        },
        array: [1, 2, 3],
        string: 'hello',
      },
      status: 'in_progress',
    }

    expect(task.payload.nested).toBeDefined()
    expect((task.payload as any).nested.deep.value).toBe(123)
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
    const task: Task = {
      id: 'task-003',
      type: 'search',
      payload: {},
      status: 'in_progress',
    }

    const session: Session = {
      currentTask: task,
      context: { userId: 'user-001' },
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
      todos: ['todo 1', 'todo 2'],
    }

    expect(session.currentTask).not.toBeNull()
    expect(session.currentTask?.id).toBe('task-003')
    expect(session.context.userId).toBe('user-001')
    expect(session.messages).toHaveLength(2)
    expect(session.todos).toHaveLength(2)
  })

  test('Session 与现有 session.json 结构兼容', async () => {
    // 读取现有的 session.json 并验证类型兼容
    const sessionFile = Bun.file('workspace/agents/main/session.json')
    const sessionData = await sessionFile.json()

    // 验证可以赋值给 Session 类型
    const session: Session = sessionData

    expect(session.currentTask).toBeNull()
    expect(session.context).toEqual({})
    expect(Array.isArray(session.messages)).toBe(true)
    expect(Array.isArray(session.todos)).toBe(true)
  })
})
