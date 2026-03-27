import { describe, expect, test } from 'vitest'
import OpenAI from 'openai'
import { MainAgent } from '../../../src/agents/main/index'
import { ProfileAgent } from '../../../src/agents/profile-agent'

const TEST_WORKSPACE = '/tmp/jobclaw-main-test'

function createMockOpenAI(): OpenAI {
    return {
        chat: {
            completions: {
                create: async () => ({ choices: [{ message: { content: 'ok' } }] }),
            },
        },
    } as unknown as OpenAI
}

describe('MainAgent', () => {
    test('systemPrompt 包含 run_agent 且不包含 run_delivery_agent', () => {
        const agent = new MainAgent({
            openai: createMockOpenAI(),
            agentName: 'main-test',
            model: 'test-model',
            workspaceRoot: TEST_WORKSPACE,
            persistent: false,
        })

        const prompt = (agent as any).systemPrompt as string
        expect(prompt).toContain('run_agent')
        expect(prompt).not.toContain('run_delivery_agent')
    })

    test('构造函数允许注入 factory', () => {
        const factory = { createAgent: () => ({ run: async () => 'ok' }) }
        const agent = new MainAgent({
            openai: createMockOpenAI(),
            agentName: 'main-test',
            model: 'test-model',
            workspaceRoot: TEST_WORKSPACE,
            persistent: false,
            factory: factory as any,
        })

        expect(agent).toBeDefined()
    })

    test('主 Agent 在 allowBrowser=true 时允许 MCP 浏览器工具', () => {
        const agent = new MainAgent({
            openai: createMockOpenAI(),
            agentName: 'main-test',
            model: 'test-model',
            workspaceRoot: TEST_WORKSPACE,
            persistent: false,
        })

        expect((agent as any).isToolAllowed('browser_navigate')).toBe(true)
    })

    test('非浏览器 profile 不允许未白名单的 MCP 工具', () => {
        const agent = new ProfileAgent({
            openai: createMockOpenAI(),
            agentName: 'review-test',
            model: 'test-model',
            workspaceRoot: TEST_WORKSPACE,
            persistent: false,
            profileName: 'review',
        })

        expect((agent as any).isToolAllowed('browser_navigate')).toBe(false)
    })
})
