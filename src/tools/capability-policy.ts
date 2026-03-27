import { ADMIN_TOOL_NAMES, isBrowserToolName } from './names.js'
import type {
  AgentProfile,
  AgentProfileName,
  CapabilityDecision,
  CapabilityPolicy,
} from '../runtime/capability-types.js'

const WORKSPACE_ROOT = 'workspace'

export class DefaultCapabilityPolicy implements CapabilityPolicy {
  canUseTool(profile: AgentProfile, toolName: string): CapabilityDecision {
    if (isBrowserToolName(toolName)) {
      return profile.allowBrowser
        ? { allowed: true }
        : { allowed: false, reason: `Profile ${profile.name} 不允许使用浏览器工具 ${toolName}` }
    }
    if (
      ADMIN_TOOL_NAMES.includes(toolName as (typeof ADMIN_TOOL_NAMES)[number]) &&
      !profile.allowAdminTools
    ) {
      return { allowed: false, reason: `工具 ${toolName} 需要管理员权限` }
    }
    if (!profile.allowedTools.includes(toolName)) {
      return { allowed: false, reason: `Profile ${profile.name} 不允许使用工具 ${toolName}` }
    }
    return { allowed: true }
  }

  canReadPath(profile: AgentProfile, relativePath: string): CapabilityDecision {
    return this.checkPath(profile.readableRoots, relativePath, 'read')
  }

  canWritePath(profile: AgentProfile, relativePath: string): CapabilityDecision {
    if (profile.writableRoots.length === 0) {
      return { allowed: false, reason: `Profile ${profile.name} 无写权限` }
    }
    return this.checkPath(profile.writableRoots, relativePath, 'write')
  }

  canDelegate(profile: AgentProfile, targetProfile: AgentProfileName): CapabilityDecision {
    if (profile.allowDelegationTo.includes(targetProfile)) {
      return { allowed: true }
    }
    return { allowed: false, reason: `Profile ${profile.name} 不能委派到 ${targetProfile}` }
  }

  private checkPath(roots: string[], relativePath: string, op: 'read' | 'write'): CapabilityDecision {
    const normalized = this.normalizeRelative(relativePath)
    if (roots.includes(WORKSPACE_ROOT)) {
      return { allowed: true }
    }
    for (const root of roots) {
      if (this.matchesRoot(normalized, root)) {
        return { allowed: true }
      }
    }
    return { allowed: false, reason: `Profile 不允许${op} ${relativePath}` }
  }

  private normalizeRelative(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\/?/, '')
  }

  private matchesRoot(path: string, root: string): boolean {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/$/, '')
    const effectiveRoot = normalizedRoot === '' ? '.' : normalizedRoot
    if (effectiveRoot === '.') return true
    if (path === effectiveRoot) return true
    return path.startsWith(`${effectiveRoot}/`)
  }
}

export const defaultCapabilityPolicy = new DefaultCapabilityPolicy()
