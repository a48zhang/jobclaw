import * as fs from 'node:fs'
import { extractText, getDocumentProxy, getMeta } from 'unpdf'
import type { ToolContext, ToolResult } from './index'
import { checkPathPermission, normalizeAndValidatePath } from './utils'

const DEFAULT_MAX_CHARS = 12000

function isValidPages(pages: unknown): pages is number[] {
  return Array.isArray(pages) && pages.every((page) => Number.isInteger(page))
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeSelectedPages(pages: number[] | undefined, totalPages: number): number[] {
  if (!pages || pages.length === 0) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const uniquePages = [...new Set(pages)].sort((a, b) => a - b)
  return uniquePages.filter((page) => page >= 1 && page <= totalPages)
}

export async function executeReadPdf(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { path: inputPath, pages, max_chars: maxChars = DEFAULT_MAX_CHARS, include_meta: includeMeta = false } =
    args as {
      path: unknown
      pages?: unknown
      max_chars?: unknown
      include_meta?: unknown
    }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }
  if (pages !== undefined && !isValidPages(pages)) {
    return { success: false, content: '', error: 'pages 参数必须是整数数组' }
  }
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) {
    return { success: false, content: '', error: 'max_chars 参数必须是正数' }
  }
  if (typeof includeMeta !== 'boolean') {
    return { success: false, content: '', error: 'include_meta 参数必须是布尔值' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  const permission = checkPathPermission(normalizedPath, context.agentName, 'read', context.workspaceRoot)
  if (!permission.allowed) {
    return { success: false, content: '', error: permission.reason }
  }

  if (!fs.existsSync(normalizedPath)) {
    return { success: false, content: '', error: `文件不存在：${inputPath}` }
  }

  const stat = fs.statSync(normalizedPath)
  if (!stat.isFile()) {
    return { success: false, content: '', error: `路径不是文件：${inputPath}` }
  }
  if (!normalizedPath.toLowerCase().endsWith('.pdf')) {
    return { success: false, content: '', error: '仅支持读取 .pdf 文件' }
  }

  try {
    const buffer = fs.readFileSync(normalizedPath)
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { totalPages, text: pageTexts } = await extractText(pdf)
    const selectedPages = normalizeSelectedPages(pages, totalPages)

    if (selectedPages.length === 0) {
      return { success: false, content: '', error: 'pages 参数未命中任何有效页码' }
    }

    const mergedText = selectedPages
      .map((page) => {
        const pageText = pageTexts[page - 1] ?? ''
        const cleaned = cleanExtractedText(pageText)
        return `=== Page ${page} ===\n${cleaned}`
      })
      .join('\n\n')

    const truncated = mergedText.length > maxChars
    const text = truncated ? `${mergedText.slice(0, maxChars)}...` : mergedText
    const payload: Record<string, unknown> = {
      path: inputPath,
      total_pages: totalPages,
      selected_pages: selectedPages,
      text,
      text_length: mergedText.length,
      truncated,
    }

    if (includeMeta) {
      const meta = await getMeta(pdf)
      payload['meta'] = meta
    }

    return {
      success: true,
      content: JSON.stringify(payload, null, 2),
    }
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `PDF 读取失败：${(error as Error).message}`,
    }
  }
}
