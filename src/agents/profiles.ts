import type { AgentProfile, AgentProfileName } from '../runtime/capability-types.js'

export type ProfileName = AgentProfileName
export type { AgentProfile }

const ALL_TOOLS = [
  'read_file',
  'write_file',
  'append_file',
  'list_directory',
  'lock_file',
  'unlock_file',
  'upsert_job',
  'typst_compile',
  'install_typst',
  'run_shell_command',
  'read_pdf',
  'grep',
  'get_time',
  'run_agent',
]

const POLICY_SECTION_COMMON = [
  '始终遵守能力边界，不要自行扩展权限。',
  '在缺乏明确信息时，优先使用 `request` 工具向主 Agent 或用户获取补充。',
]

export const MAIN_AGENT_PROFILE: AgentProfile = {
  name: 'main',
  systemPromptSections: [
    ...POLICY_SECTION_COMMON,
    '你是 JobClaw 的主 Agent，负责与用户的自由对话、整体调度与监督子 Agent 的执行。',
    '你拥有全局能力：可以调用所有本地工具、创建子 Agent、读取/写入工作空间，并对外部事件进行响应。',
  ],
  allowedTools: [...ALL_TOOLS, 'request'],
  readableRoots: ['workspace'],
  writableRoots: ['workspace'],
  allowBrowser: true,
  allowNotifications: true,
  allowAdminTools: true,
  allowDelegationTo: ['search', 'delivery', 'resume', 'review'],
}

export const SEARCH_AGENT_PROFILE: AgentProfile = {
  name: 'search',
  systemPromptSections: [
    ...POLICY_SECTION_COMMON,
    '专注于从目标公司/职位列表中搜集新岗位信息。阅读 Job Description，判断匹配度，并将合格岗位写入 jobs.md。',
    '只使用允许的读写路径，不要尝试访问未知目录。',
  ],
  allowedTools: [
    'read_file',
    'list_directory',
    'upsert_job',
    'grep',
    'get_time',
    'request',
  ],
  readableRoots: ['data', 'state'],
  writableRoots: ['data/jobs.md', 'state'],
  allowBrowser: true,
  allowNotifications: false,
  allowAdminTools: false,
  allowDelegationTo: [],
}

export const DELIVERY_AGENT_PROFILE: AgentProfile = {
  name: 'delivery',
  systemPromptSections: [
    ...POLICY_SECTION_COMMON,
    '只执行简历投递或相关自动化步骤，上传/更新 deliveries 状态，并确保所有写入走 lock/unlock 流程。',
    '记录每次投递结果并总结在事件日志中，避免重复投递。',
  ],
  allowedTools: [
    'read_file',
    'write_file',
    'append_file',
    'list_directory',
    'lock_file',
    'unlock_file',
    'upsert_job',
    'typst_compile',
    'install_typst',
    'read_pdf',
    'grep',
    'get_time',
    'request',
  ],
  readableRoots: ['data', 'state'],
  writableRoots: ['data', 'state'],
  allowBrowser: false,
  allowNotifications: false,
  allowAdminTools: false,
  allowDelegationTo: [],
}

export const RESUME_AGENT_PROFILE: AgentProfile = {
  name: 'resume',
  systemPromptSections: [
    ...POLICY_SECTION_COMMON,
    '负责简历（resume）相关任务：生成、改写、解析或审核 userinfo + targets + jobs 中的内容。',
    '只使用 Typst、文件读写与 PDF 工具，不要尝试发起新的子 Agent 或安装其他软件。',
  ],
  allowedTools: [
    'read_file',
    'write_file',
    'append_file',
    'list_directory',
    'typst_compile',
    'install_typst',
    'read_pdf',
    'grep',
    'get_time',
    'request',
  ],
  readableRoots: ['data', 'state'],
  writableRoots: ['data', 'data/resume.typ'],
  allowBrowser: false,
  allowNotifications: false,
  allowAdminTools: false,
  allowDelegationTo: [],
}

export const REVIEW_AGENT_PROFILE: AgentProfile = {
  name: 'review',
  systemPromptSections: [
    ...POLICY_SECTION_COMMON,
    '专注于 resume review 和 mock interview 反馈，不主动执行写操作，除非有明确 user 指令。',
    '需要总结每次审查的要点，并用可复用的 bullet 出给主 Agent。',
  ],
  allowedTools: [
    'read_file',
    'read_pdf',
    'list_directory',
    'grep',
    'get_time',
    'request',
  ],
  readableRoots: ['data', 'uploads'],
  writableRoots: ['state'],
  allowBrowser: false,
  allowNotifications: false,
  allowAdminTools: false,
  allowDelegationTo: [],
}

export const PROFILES: Record<ProfileName, AgentProfile> = {
  main: MAIN_AGENT_PROFILE,
  search: SEARCH_AGENT_PROFILE,
  delivery: DELIVERY_AGENT_PROFILE,
  resume: RESUME_AGENT_PROFILE,
  review: REVIEW_AGENT_PROFILE,
}

const SKILL_TO_PROFILE_MAP: Record<string, ProfileName> = {
  delivery: 'delivery',
  resume: 'resume',
  review: 'review',
  search: 'search',
}

export function inferProfileFromSkill(skill?: string): Exclude<ProfileName, 'main'> {
  if (!skill) return 'search'
  const normalized = skill.toLowerCase().trim()
  const inferred = SKILL_TO_PROFILE_MAP[normalized]
  return inferred && inferred !== 'main' ? inferred : 'search'
}

export function getProfileByName(name: ProfileName): AgentProfile {
  return PROFILES[name]
}
