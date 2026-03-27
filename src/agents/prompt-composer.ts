import type { AgentProfile } from './profiles.js'

export interface PromptComposerOptions {
  skillSections?: string[]
  additionalSections?: string[]
  memorySummary?: string
}

export function composeSystemPrompt(profile: AgentProfile, options: PromptComposerOptions = {}): string {
  const sections: string[] = []

  if (profile.systemPromptSections.length > 0) {
    sections.push(...profile.systemPromptSections)
  }

  if (options.skillSections && options.skillSections.length > 0) {
    sections.push(...options.skillSections)
  }

  if (options.additionalSections && options.additionalSections.length > 0) {
    sections.push(...options.additionalSections)
  }

  if (options.memorySummary) {
    sections.push('## Memory Summary', options.memorySummary)
  }

  sections.push(
    '### Ability Boundaries',
    `- Allowed tools: ${profile.allowedTools.join(', ')}`,
    `- Readable roots: ${profile.readableRoots.join(', ')}`,
    `- Writable roots: ${profile.writableRoots.join(', ')}`,
    `- Browser allowed: ${profile.allowBrowser}`,
    `- Notifications allowed: ${profile.allowNotifications}`,
    `- Admin tools allowed: ${profile.allowAdminTools}`
  )

  return sections.join('\n\n')
}
