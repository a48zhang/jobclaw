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
  'update_workspace_context',
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
  '优先利用已有聊天上下文、历史记录与工作区文档起草并推进任务；仅当信息不足以安全继续，或会显著影响结果真实性时，才使用 `request` 追问。',
]

export const MAIN_AGENT_PROFILE: AgentProfile = {
  name: 'main',
  systemPromptSections: [
    ...POLICY_SECTION_COMMON,
    '你是 JobClaw 的主 Agent，负责与用户的自由对话、整体调度与监督子 Agent 的执行。',
    '你拥有全局能力：可以调用所有本地工具、创建子 Agent、读取/写入工作空间，并对外部事件进行响应。',
    '你是工作区上下文（`data/targets.md` 与 `data/userinfo.md`）的唯一写入 Owner；子 Agent 只能给出更新建议，由你统一落盘。',
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
    '不得直接修改 `data/targets.md` 或 `data/userinfo.md`；若需要补充上下文，先形成建议并交回主 Agent 统一更新。',
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
  writableRoots: ['data/jobs.md'],
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
    '不得直接修改 `data/targets.md` 或 `data/userinfo.md`；若发现信息缺口，向主 Agent 报告缺口与建议补充项。',
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
    'read_pdf',
    'grep',
    'get_time',
    'request',
  ],
  readableRoots: ['data', 'state'],
  writableRoots: ['data/jobs.md', 'state/artifacts/'],
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
    '你可以读取 `data/userinfo.md` 与 `data/targets.md`，但不得直接修改这两个上下文文件；如需更新，提交给主 Agent 统一处理。',
  ],
  allowedTools: [
    'read_file',
    'write_file',
    'append_file',
    'list_directory',
    'lock_file',
    'unlock_file',
    'typst_compile',
    'read_pdf',
    'grep',
    'get_time',
    'request',
  ],
  readableRoots: ['data', 'state'],
  writableRoots: ['data/resume.typ', 'state/artifacts/'],
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
    '不得直接修改 `data/targets.md` 或 `data/userinfo.md`；如需补充上下文，仅输出建议给主 Agent。',
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
  writableRoots: [],
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
