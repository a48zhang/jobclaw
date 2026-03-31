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
    test('systemPrompt 包含 run_agent / update_workspace_context 且不包含 run_delivery_agent', () => {
        const agent = new MainAgent({
            openai: createMockOpenAI(),
            agentName: 'main-test',
            model: 'test-model',
            workspaceRoot: TEST_WORKSPACE,
            persistent: false,
        })

        const prompt = (agent as any).systemPrompt as string
        expect(prompt).toContain('run_agent')
        expect(prompt).toContain('update_workspace_context')
        expect(prompt).not.toContain('run_delivery_agent')
    })

    test('systemPrompt 使用先起草后追问策略且不再声明 userinfo 只读', () => {
        const agent = new MainAgent({
            openai: createMockOpenAI(),
            agentName: 'main-test',
            model: 'test-model',
            workspaceRoot: TEST_WORKSPACE,
            persistent: false,
        })

        const prompt = (agent as any).systemPrompt as string
        expect(prompt).toContain('先形成可执行草稿并持续维护工作区上下文')
        expect(prompt).toContain('才使用 `request` 追问用户')
        expect(prompt).not.toContain('没有用户信息或者不全则直接询问用户')
        expect(prompt).not.toContain('用户简历信息（只读）')
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
