import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Config, ConfigStatus } from '../config.js'
import { getConfigPath } from '../config.js'
import { getDataPath } from '../infra/workspace/paths.js'
import type { MCPClientStatus } from '../mcp.js'
import type {
  SetupCapabilityStatus,
  SetupCapabilitySummary,
  SetupConfigSummary,
  SetupDocumentStatus,
  SetupIssue,
  SetupSummaryBuildOptions,
} from './setup-summary-types.js'

const execFileAsync = promisify(execFile)

const DEFAULT_SERVER_PORT = 3000
const USERINFO_REQUIRED_FIELDS = ['姓名', '邮箱', '手机', '方向', '城市', '学历/年限', '关键词']
const SEARCH_FEATURES = ['job_search', 'auto_delivery']
const RESUME_FEATURES = ['resume_build']
const REVIEW_FEATURES = ['resume_review', 'mock_interview']
const LLM_FEATURES = ['chat', 'job_search', 'auto_delivery', 'resume_build', 'resume_review', 'mock_interview']

export class SetupCapabilitySummaryService {
  constructor(private readonly workspaceRoot: string) {}

  async collect(options: Omit<SetupSummaryBuildOptions, 'workspaceRoot'> = {}): Promise<SetupCapabilitySummary> {
    const generatedAt = options.generatedAt ?? new Date().toISOString()
    const configStatus = options.configStatus ?? readConfigStatusSnapshot(this.workspaceRoot)
    const runtimeStatus = options.runtimeStatus

    const [targets, userinfo, typst] = await Promise.all([
      inspectTargetsDocument(this.workspaceRoot),
      inspectUserinfoDocument(this.workspaceRoot),
      inspectTypstCapability(),
    ])

    const config = buildConfigSummary(configStatus)
    const mcp = buildMcpCapability(runtimeStatus?.mcp)
    const browser = buildBrowserCapability(mcp)
    const issues = buildIssues({ config, targets, userinfo, mcp, browser, typst })
    const overall = buildOverallSummary({ config, targets, userinfo, mcp, browser, typst, issues })

    return {
      generatedAt,
      overall,
      config,
      workspace: { targets, userinfo },
      capabilities: { mcp, browser, typst },
      runtimeStatus,
      issues,
      recoverySuggestions: uniq(issues.flatMap((issue) => issue.recoverySuggestions)),
      alternativePaths: uniq(issues.flatMap((issue) => issue.alternativePaths)),
    }
  }
}

export async function buildSetupCapabilitySummary(
  options: SetupSummaryBuildOptions
): Promise<SetupCapabilitySummary> {
  const service = new SetupCapabilitySummaryService(options.workspaceRoot)
  return service.collect({
    configStatus: options.configStatus,
    runtimeStatus: options.runtimeStatus,
    generatedAt: options.generatedAt,
  })
}

function buildConfigSummary(configStatus: ConfigStatus): SetupConfigSummary {
  if (configStatus.ready) {
    return {
      ready: true,
      message: '基础模型配置已完整，可启动聊天 Agent；targets.md 和 userinfo.md 可继续在聊天中起草，并在配置页人工覆写校对。',
      missingFields: [],
      config: {
        MODEL_ID: configStatus.config.MODEL_ID,
        LIGHT_MODEL_ID: configStatus.config.LIGHT_MODEL_ID,
        BASE_URL: configStatus.config.BASE_URL,
        SERVER_PORT: configStatus.config.SERVER_PORT,
      },
      apiKeyConfigured: Boolean(configStatus.config.API_KEY),
      recoverySuggestions: [],
      alternativePaths: [],
    }
  }

  return {
    ready: false,
    message: `基础模型配置未完成，缺少 ${configStatus.missingFields.join('、')}。`,
    missingFields: configStatus.missingFields,
    config: {
      MODEL_ID: configStatus.config.MODEL_ID,
      LIGHT_MODEL_ID: configStatus.config.LIGHT_MODEL_ID,
      BASE_URL: configStatus.config.BASE_URL,
      SERVER_PORT: configStatus.config.SERVER_PORT,
    },
    apiKeyConfigured: Boolean(configStatus.config.API_KEY),
    recoverySuggestions: [
      '在配置页补全 API_KEY、MODEL_ID、BASE_URL，完成后重新加载 runtime；这是聊天入口的前置条件。',
      '若使用自定义网关，确认 BASE_URL 指向兼容 OpenAI Chat Completions 的端点。',
    ],
    alternativePaths: [
      '在基础模型配置完成前，可先整理 jobs.md 或现有简历文件；targets.md 和 userinfo.md 也可待聊天开启后由 Agent 逐步起草。',
    ],
  }
}

async function inspectTargetsDocument(workspaceRoot: string): Promise<SetupDocumentStatus> {
  const filePath = getDataPath(workspaceRoot, 'targets.md')
  const { exists, content } = await readOptionalTextFile(filePath)
  const lines = splitLines(content)
  const bulletLines = lines.filter((line) => line.trim().startsWith('- '))
  const candidateLines = bulletLines.filter((line) => !line.includes('示例公司') && !line.includes('example.com'))

  let validEntryCount = 0
  const invalidEntries: string[] = []

  for (const line of candidateLines) {
    const raw = line.trim().slice(2)
    const parts = raw.split('|').map((part) => part.trim())
    const [company, url] = parts
    if (company && looksLikeUrl(url)) {
      validEntryCount += 1
      continue
    }
    invalidEntries.push(raw)
  }

  const ready = validEntryCount > 0
  const totalEntries = candidateLines.length
  const completion = totalEntries === 0 ? 0 : clamp(validEntryCount / totalEntries)

  return {
    area: 'targets',
    path: 'data/targets.md',
    exists,
    ready,
    completion,
    message: ready
      ? `已发现 ${validEntryCount} 条有效监测目标，可启动职位搜索。`
      : 'targets.md 尚未提供有效监测目标，但可在聊天中由 Agent 逐步起草。',
    requiredMissing: ready ? [] : ['至少 1 条“公司 | URL”目标'],
    recoverySuggestions: ready
      ? []
      : [
          '可先在聊天中让 Agent 生成 targets.md 草稿，再到配置页按“公司名 | 网址 | 备注”人工覆写或校对至少一条有效目标。',
          '优先确认可直接访问的招聘页或公司 careers 页面，减少搜索链路中的额外猜测。',
        ],
    alternativePaths: ready
      ? []
      : ['若暂时没有监测目标，可先继续聊天澄清求职方向，或手动维护 jobs.md，再推进状态跟踪与后续流程。'],
    details: {
      totalBulletLines: bulletLines.length,
      candidateLines: totalEntries,
      validEntryCount,
      invalidEntries,
    },
  }
}

async function inspectUserinfoDocument(workspaceRoot: string): Promise<SetupDocumentStatus> {
  const filePath = getDataPath(workspaceRoot, 'userinfo.md')
  const { exists, content } = await readOptionalTextFile(filePath)
  const fieldValues = extractMarkdownFields(content)
  const totalFieldCount = fieldValues.size
  const filledFieldCount = Array.from(fieldValues.values()).filter((value) => hasFilledValue(value)).length
  const requiredMissing = USERINFO_REQUIRED_FIELDS.filter((field) => !hasFilledValue(fieldValues.get(field)))
  const completion = totalFieldCount === 0 ? 0 : clamp(filledFieldCount / totalFieldCount)
  const ready = requiredMissing.length === 0

  return {
    area: 'userinfo',
    path: 'data/userinfo.md',
    exists,
    ready,
    completion,
    message: ready
      ? `userinfo.md 关键字段已就绪，已填写 ${filledFieldCount}/${totalFieldCount} 个字段。`
      : `userinfo.md 缺少关键字段：${requiredMissing.join('、')}；这些内容可在聊天中逐步起草。`,
    requiredMissing,
    recoverySuggestions: ready
      ? []
      : [
          '可先在聊天中让 Agent 起草姓名、邮箱、手机、方向、城市、学历/年限、关键词等字段，再到配置页人工覆写和校对。',
          '若已有标准化简历内容，可先整理到 userinfo.md，作为 Agent 后续生成与改写的人工确认底稿。',
        ],
    alternativePaths: ready
      ? []
      : ['若当前只需要做简历体检，可先上传现有 PDF 简历；userinfo.md 可稍后在聊天中逐步完善。'],
    details: {
      totalFieldCount,
      filledFieldCount,
      requiredFields: USERINFO_REQUIRED_FIELDS,
    },
  }
}

function buildMcpCapability(status?: MCPClientStatus | null): SetupCapabilityStatus {
  if (!status) {
    return {
      area: 'mcp',
      state: 'unknown',
      available: false,
      message: '尚未接入 runtime 的 MCP 实际状态，当前只能确认配置层信息，无法确认连通性。',
      reasonCode: 'mcp_unverified',
      reasons: ['调用方未提供 runtime MCP 状态。'],
      recoverySuggestions: ['后续 API 接入时优先注入 runtime.getRuntimeStatus()，避免重复探测外部进程。'],
      alternativePaths: ['在 MCP 状态未验证前，避免把自动搜索和自动投递展示为“可立即执行”。'],
      affectedFeatures: SEARCH_FEATURES,
      details: {
        enabled: process.env.MCP_DISABLED !== '1',
        connected: null,
      },
    }
  }

  if (!status.enabled) {
    return {
      area: 'mcp',
      state: 'unavailable',
      available: false,
      message: status.message || 'MCP 已禁用，浏览器能力不可用。',
      reasonCode: 'mcp_disabled',
      reasons: [status.message || 'MCP 已通过环境变量禁用。'],
      recoverySuggestions: ['移除 MCP_DISABLED=1 并重启 runtime，使 Playwright MCP 有机会重新连接。'],
      alternativePaths: ['继续使用 jobs.md 的手动维护路径，以及不依赖浏览器的简历与审查能力。'],
      affectedFeatures: SEARCH_FEATURES,
      details: {
        enabled: status.enabled,
        connected: status.connected,
      },
    }
  }

  if (!status.connected) {
    return {
      area: 'mcp',
      state: 'degraded',
      available: false,
      message: status.message || 'MCP 连接失败，浏览器链路当前不可用。',
      reasonCode: 'mcp_disconnected',
      reasons: [status.message || 'Playwright MCP 连接失败。'],
      recoverySuggestions: [
        '检查 Node 运行环境和 Playwright MCP 依赖是否可执行，然后重新加载 runtime。',
        '若问题来自浏览器环境缺失，可先修复依赖安装，再恢复自动搜索/投递。',
      ],
      alternativePaths: ['继续通过手动维护 jobs.md 或已有职位数据推进后续流程。'],
      affectedFeatures: SEARCH_FEATURES,
      details: {
        enabled: status.enabled,
        connected: status.connected,
      },
    }
  }

  return {
    area: 'mcp',
    state: 'ready',
    available: true,
    message: status.message || 'MCP 已连接。',
    reasonCode: 'mcp_ready',
    reasons: [],
    recoverySuggestions: [],
    alternativePaths: [],
    affectedFeatures: SEARCH_FEATURES,
    details: {
      enabled: status.enabled,
      connected: status.connected,
    },
  }
}

function buildBrowserCapability(mcp: SetupCapabilityStatus): SetupCapabilityStatus {
  if (mcp.state === 'ready') {
    return {
      area: 'browser',
      state: 'ready',
      available: true,
      message: '浏览器自动化链路已就绪，可执行搜索和投递中的页面操作。',
      reasonCode: 'browser_ready',
      reasons: [],
      recoverySuggestions: [],
      alternativePaths: [],
      affectedFeatures: SEARCH_FEATURES,
      details: {
        source: 'mcp',
      },
    }
  }

  if (mcp.state === 'unknown') {
    return {
      area: 'browser',
      state: 'unknown',
      available: false,
      message: '浏览器能力依赖 MCP 状态，当前尚未完成验证。',
      reasonCode: 'browser_unverified',
      reasons: [...mcp.reasons],
      recoverySuggestions: [...mcp.recoverySuggestions],
      alternativePaths: [...mcp.alternativePaths],
      affectedFeatures: SEARCH_FEATURES,
      details: {
        source: 'mcp',
      },
    }
  }

  return {
    area: 'browser',
    state: mcp.state === 'degraded' ? 'degraded' : 'unavailable',
    available: false,
    message: '浏览器自动化当前不可用，依赖浏览器的搜索与投递流程将进入降级模式。',
    reasonCode: mcp.reasonCode === 'mcp_disabled' ? 'browser_disabled' : 'browser_unavailable',
    reasons: [
      '浏览器能力依赖 Playwright MCP。',
      ...mcp.reasons,
    ],
    recoverySuggestions: [...mcp.recoverySuggestions],
    alternativePaths: [
      '可先手动整理目标岗位到 jobs.md，继续使用职位状态跟踪、简历生成、简历评价等非浏览器能力。',
      ...mcp.alternativePaths,
    ],
    affectedFeatures: SEARCH_FEATURES,
    details: {
      source: 'mcp',
    },
  }
}

async function inspectTypstCapability(): Promise<SetupCapabilityStatus> {
  const detectedBinary = await findTypstBinaryPath()
  if (detectedBinary) {
    return {
      area: 'typst',
      state: 'ready',
      available: true,
      message: 'Typst 已可用，可执行 PDF 简历编译。',
      reasonCode: 'typst_ready',
      reasons: [],
      recoverySuggestions: [],
      alternativePaths: [],
      affectedFeatures: RESUME_FEATURES,
      details: {
        binary: detectedBinary,
      },
    }
  }

  return {
    area: 'typst',
    state: 'unavailable',
    available: false,
    message: 'Typst 当前不可用，PDF 简历编译能力处于降级状态。',
    reasonCode: 'typst_missing',
    reasons: ['系统 PATH 和 ~/.cargo/bin 中均未检测到 typst 可执行文件。'],
    recoverySuggestions: [
      '在用户明确同意后调用 install_typst，或手动安装 typst 后重新加载 runtime。',
      '若使用 cargo 安装，确认 ~/.cargo/bin 已加入 PATH。',
    ],
    alternativePaths: [
      '可先继续整理 userinfo.md 和 resume.typ 内容，待 Typst 恢复后再编译 PDF。',
      '若已有现成 PDF，可直接上传并使用简历评价流程。',
    ],
    affectedFeatures: RESUME_FEATURES,
    details: {
      binary: null,
    },
  }
}

function buildIssues(input: {
  config: SetupConfigSummary
  targets: SetupDocumentStatus
  userinfo: SetupDocumentStatus
  mcp: SetupCapabilityStatus
  browser: SetupCapabilityStatus
  typst: SetupCapabilityStatus
}): SetupIssue[] {
  const issues: SetupIssue[] = []

  if (!input.config.ready) {
    issues.push({
      code: 'config_missing_base_fields',
      area: 'config',
      severity: 'blocking',
      message: input.config.message,
      affectedFeatures: LLM_FEATURES,
      recoverySuggestions: input.config.recoverySuggestions,
      alternativePaths: input.config.alternativePaths,
    })
  }

  if (!input.targets.ready) {
    issues.push({
      code: 'targets_missing_valid_entries',
      area: 'targets',
      severity: 'degraded',
      message: input.targets.message,
      affectedFeatures: ['job_search'],
      recoverySuggestions: input.targets.recoverySuggestions,
      alternativePaths: input.targets.alternativePaths,
    })
  }

  if (!input.userinfo.ready) {
    issues.push({
      code: 'userinfo_missing_required_fields',
      area: 'userinfo',
      severity: 'degraded',
      message: input.userinfo.message,
      affectedFeatures: [...RESUME_FEATURES, ...REVIEW_FEATURES, 'auto_delivery'],
      recoverySuggestions: input.userinfo.recoverySuggestions,
      alternativePaths: input.userinfo.alternativePaths,
    })
  }

  for (const capability of [input.mcp, input.browser, input.typst]) {
    if (capability.state === 'ready') continue
    issues.push({
      code: `${capability.area}_${capability.reasonCode ?? 'degraded'}`,
      area: capability.area,
      severity: capability.state === 'unknown' ? 'info' : 'degraded',
      message: capability.message,
      affectedFeatures: capability.affectedFeatures,
      recoverySuggestions: capability.recoverySuggestions,
      alternativePaths: capability.alternativePaths,
    })
  }

  return issues
}

function buildOverallSummary(input: {
  config: SetupConfigSummary
  targets: SetupDocumentStatus
  userinfo: SetupDocumentStatus
  mcp: SetupCapabilityStatus
  browser: SetupCapabilityStatus
  typst: SetupCapabilityStatus
  issues: SetupIssue[]
}): SetupCapabilitySummary['overall'] {
  const blockers = input.issues
    .filter((issue) => issue.severity === 'blocking')
    .map((issue) => issue.area)
  const degraded = input.issues
    .filter((issue) => issue.severity === 'degraded')
    .map((issue) => issue.area)
  const setupReady = input.config.ready && input.targets.ready && input.userinfo.ready
  const ready = setupReady && degraded.length === 0

  if (!setupReady) {
    const message = !input.config.ready
      ? '基础模型配置尚未完成，聊天入口仍处于 setup 阶段；targets.md 和 userinfo.md 可待聊天开启后逐步起草。'
      : '基础模型配置已就绪，工作区资料仍可在聊天中逐步起草，配置页用于人工覆写和校对。'
    return {
      mode: 'setup_required',
      ready: false,
      setupReady: false,
      blockers: uniq(blockers),
      degraded: uniq(degraded),
      message,
    }
  }

  if (degraded.length > 0) {
    return {
      mode: 'degraded',
      ready: false,
      setupReady: true,
      blockers: uniq(blockers),
      degraded: uniq(degraded),
      message: '核心输入已就绪，但部分能力处于降级状态。',
    }
  }

  return {
    mode: 'ready',
    ready: true,
    setupReady: true,
    blockers: [],
    degraded: [],
    message: '基础配置、工作区输入和关键能力均已就绪。',
  }
}

async function readOptionalTextFile(filePath: string): Promise<{ exists: boolean; content: string }> {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath, 'utf-8'),
    }
  } catch {
    return {
      exists: false,
      content: '',
    }
  }
}

function readConfigStatusSnapshot(workspaceRoot: string): ConfigStatus {
  const filePath = getConfigPath(workspaceRoot)
  let parsed: Partial<Config> = {}

  try {
    parsed = JSON.parse(fsSync.readFileSync(filePath, 'utf-8')) as Partial<Config>
  } catch {
    parsed = {}
  }

  const resolvedModel = parsed.MODEL_ID || process.env['MODEL_ID'] || process.env['MODEL'] || ''
  const resolvedLightModel = parsed.LIGHT_MODEL_ID || process.env['LIGHT_MODEL_ID'] || process.env['LIGHT_MODEL'] || ''
  const config: Config = {
    API_KEY: parsed.API_KEY || process.env['API_KEY'] || process.env['OPENAI_API_KEY'] || '',
    MODEL_ID: resolvedModel,
    LIGHT_MODEL_ID: resolvedLightModel || resolvedModel,
    BASE_URL: parsed.BASE_URL || process.env['BASE_URL'] || process.env['OPENAI_BASE_URL'] || '',
    SERVER_PORT: normalizePortSnapshot(process.env['SERVER_PORT'] || parsed.SERVER_PORT),
  }
  const missingFields: ConfigStatus['missingFields'] = []

  if (!config.API_KEY) missingFields.push('API_KEY')
  if (!config.MODEL_ID) missingFields.push('MODEL_ID')
  if (!config.BASE_URL) missingFields.push('BASE_URL')

  return {
    config,
    missingFields,
    ready: missingFields.length === 0,
  }
}

function splitLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
}

function normalizePortSnapshot(value: unknown): number {
  const port = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_SERVER_PORT
}

function extractMarkdownFields(content: string): Map<string, string> {
  const fieldValues = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([^：:]+)\s*[：:]\s*(.*)$/)
    if (!match) continue
    const label = match[1]?.trim()
    const value = match[2]?.trim() ?? ''
    if (!label) continue
    fieldValues.set(label, value)
  }
  return fieldValues
}

function hasFilledValue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim()
  return normalized.length > 0 && normalized !== '待补充' && normalized !== 'TODO'
}

function looksLikeUrl(value: string | undefined): boolean {
  if (!value) return false
  return /^https?:\/\//i.test(value.trim())
}

async function findTypstBinaryPath(): Promise<string | null> {
  try {
    await execFileAsync('typst', ['--version'])
    return 'typst'
  } catch {
    const home = process.env.HOME || ''
    const cargoBinary = path.join(home, '.cargo', 'bin', 'typst')
    try {
      await fs.access(cargoBinary)
      return cargoBinary
    } catch {
      return null
    }
  }
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return Number.parseFloat(value.toFixed(3))
}
