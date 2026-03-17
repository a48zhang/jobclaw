import { describe, expect, test } from 'vitest'
import OpenAI from 'openai'
import { MainAgent } from '../../../src/agents/main/index'

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
})
