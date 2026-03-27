import { describe, expect, test } from 'vitest'
import OpenAI from 'openai'
import { ProfileAgent } from '../../../src/agents/profile-agent.js'

const makeAgent = (profileName: string) =>
  new ProfileAgent({
    openai: { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } } } as unknown as OpenAI,
    agentName: `${profileName}-test`,
    model: 'test-model',
    workspaceRoot: '/tmp',
    persistent: false,
    profileName: profileName as any,
  })

describe('ProfileAgent permissions', () => {
  test('search profile allows browser tools', () => {
    const agent = makeAgent('search')
    expect((agent as any).isToolAllowed('browser_navigate')).toBe(true)
  })

  test('delivery profile denies browser tools and admin tools', () => {
    const agent = makeAgent('delivery')
    expect((agent as any).isToolAllowed('browser_navigate')).toBe(false)
    expect((agent as any).isToolAllowed('run_shell_command')).toBe(false)
  })
})
