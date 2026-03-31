export function sanitizeMessageText(input: string): string {
  const withoutThink = input.replace(/<think>[\s\S]*?<\/think>/gi, ' ').trim()
  const normalized = (withoutThink || input)
    .replace(/^"+|"+$/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return normalized
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  API_KEY: 'API 密钥',
  MODEL_ID: '主模型',
  LIGHT_MODEL_ID: '备用模型',
  BASE_URL: '接口地址',
  SERVER_PORT: '服务端口',
}

export function formatMissingFields(fields: string[]): string {
  const labels = Array.from(
    new Set(
      fields
        .map((field) => MISSING_FIELD_LABELS[field] || field)
        .filter(Boolean),
    ),
  )

  return labels.join('、') || 'API 密钥、主模型、接口地址'
}

export function formatMaskedSecret(maskedValue?: string, configured?: boolean): string {
  if (!configured) return 'sk-...'
  const normalized = String(maskedValue || '').trim()
  if (!normalized) return '已配置（留空保持不变）'
  if (normalized.length <= 18) return `${normalized}（留空保持不变）`
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}（留空保持不变）`
}
