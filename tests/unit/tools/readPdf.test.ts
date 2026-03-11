import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { executeTool, TOOL_NAMES, type ToolContext } from '../../../src/tools/index'

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')
const TEMP_DIR = path.resolve(TEST_WORKSPACE, '.test_pdf_temp')

function createContext(): ToolContext {
  return {
    workspaceRoot: TEST_WORKSPACE,
    agentName: 'main',
    logger: () => {},
  }
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function createSimplePdf(text: string): Uint8Array {
  const encoder = new TextEncoder()
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`
  const streamLength = encoder.encode(stream).length
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(encoder.encode(pdf).length)
    pdf += object
  }

  const xrefOffset = encoder.encode(pdf).length
  const xref =
    `xref\n0 ${offsets.length}\n` +
    '0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`)
      .join('')
  pdf += xref
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return encoder.encode(pdf)
}

describe('read_pdf 工具', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true })
    }
  })

  test('常量值正确', () => {
    expect(TOOL_NAMES.READ_PDF).toBe('read_pdf')
  })

  test('拒绝非 pdf 文件', async () => {
    const txtPath = path.resolve(TEMP_DIR, 'resume.txt')
    fs.writeFileSync(txtPath, 'hello', 'utf-8')

    const result = await executeTool(
      TOOL_NAMES.READ_PDF,
      { path: path.relative(TEST_WORKSPACE, txtPath) },
      createContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('.pdf')
  })

  test('能提取简单 pdf 的文本', async () => {
    const pdfPath = path.resolve(TEMP_DIR, 'resume.pdf')
    fs.writeFileSync(pdfPath, createSimplePdf('Hello PDF Resume'))

    const result = await executeTool(
      TOOL_NAMES.READ_PDF,
      { path: path.relative(TEST_WORKSPACE, pdfPath) },
      createContext()
    )

    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.content) as {
      total_pages: number
      selected_pages: number[]
      text: string
      truncated: boolean
    }
    expect(parsed.total_pages).toBe(1)
    expect(parsed.selected_pages).toEqual([1])
    expect(parsed.text).toContain('Hello PDF Resume')
    expect(parsed.truncated).toBe(false)
  })

  test('max_chars 生效并标记截断', async () => {
    const pdfPath = path.resolve(TEMP_DIR, 'resume.pdf')
    fs.writeFileSync(pdfPath, createSimplePdf('Hello PDF Resume'))

    const result = await executeTool(
      TOOL_NAMES.READ_PDF,
      { path: path.relative(TEST_WORKSPACE, pdfPath), max_chars: 10 },
      createContext()
    )

    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.content) as {
      text: string
      truncated: boolean
    }
    expect(parsed.truncated).toBe(true)
    expect(parsed.text.endsWith('...')).toBe(true)
  })
})
