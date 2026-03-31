import { describe, expect, test } from 'vitest'
import { defaultCapabilityPolicy } from '../../../src/tools/capability-policy.js'
import { getProfileByName } from '../../../src/agents/profiles.js'

describe('DefaultCapabilityPolicy', () => {
  test('denies read outside readable roots', () => {
    const profile = getProfileByName('review')
    const result = defaultCapabilityPolicy.canReadPath(profile as any, 'agents/other/session.json')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Profile')
  })

  test('denies write outside writable roots', () => {
    const profile = getProfileByName('review')
    const result = defaultCapabilityPolicy.canWritePath(profile as any, 'workspace/data/jobs.md')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Profile')
  })

  test('admin tool denied when allowAdminTools is false', () => {
    const profile = getProfileByName('delivery')
    const result = defaultCapabilityPolicy.canUseTool(profile as any, 'run_shell_command')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('管理员权限')
  })

  test('canDelegate reflects allowDelegationTo', () => {
    const profile = getProfileByName('main')
    expect(defaultCapabilityPolicy.canDelegate(profile as any, 'search').allowed).toBe(true)
    expect(defaultCapabilityPolicy.canDelegate(profile as any, 'delivery').allowed).toBe(true)
    expect(defaultCapabilityPolicy.canDelegate(profile as any, 'main').allowed).toBe(false)
  })

  test('delivery profile cannot write workspace context files', () => {
    const profile = getProfileByName('delivery')
    expect(defaultCapabilityPolicy.canWritePath(profile as any, 'data/targets.md').allowed).toBe(false)
    expect(defaultCapabilityPolicy.canWritePath(profile as any, 'data/userinfo.md').allowed).toBe(false)
  })

  test('resume profile cannot write workspace context files', () => {
    const profile = getProfileByName('resume')
    expect(defaultCapabilityPolicy.canWritePath(profile as any, 'data/targets.md').allowed).toBe(false)
    expect(defaultCapabilityPolicy.canWritePath(profile as any, 'data/userinfo.md').allowed).toBe(false)
  })
})
