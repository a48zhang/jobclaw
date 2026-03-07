// TUI utility tests — Phase 4 Team A
import { describe, test, expect } from 'bun:test'
import { parseJobsMd } from '../web/tui'

describe('parseJobsMd', () => {
  test('TC-A-10: 空文件返回空数组', () => {
    expect(parseJobsMd('')).toEqual([])
  })

  test('TC-A-11: 无数据行时返回空数组', () => {
    const content = '# 已投递岗位\n\n| 公司 | 职位 | 链接 | 状态 | 时间 |\n| --- | --- | --- | --- | --- |\n'
    expect(parseJobsMd(content)).toEqual([])
  })

  test('TC-A-12: 正常解析一行数据', () => {
    const content = [
      '| 公司 | 职位 | 链接 | 状态 | 时间 |',
      '| --- | --- | --- | --- | --- |',
      '| Acme | SWE | https://acme.com | applied | 2024-01-01 |',
    ].join('\n')

    const rows = parseJobsMd(content)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      company: 'Acme',
      title: 'SWE',
      url: 'https://acme.com',
      status: 'applied',
      time: '2024-01-01',
    })
  })

  test('TC-A-13: 多行数据全部解析', () => {
    const content = [
      '| 公司 | 职位 | 链接 | 状态 | 时间 |',
      '| --- | --- | --- | --- | --- |',
      '| Acme | SWE | https://acme.com | applied | 2024-01-01 |',
      '| Foo | PM | https://foo.com | discovered | 2024-01-02 |',
    ].join('\n')

    const rows = parseJobsMd(content)
    expect(rows).toHaveLength(2)
    expect(rows[1].company).toBe('Foo')
  })

  test('TC-A-14: 跳过列数不足的损坏行，不崩溃', () => {
    const content = [
      '| 公司 | 职位 | 链接 | 状态 | 时间 |',
      '| --- | --- | --- | --- | --- |',
      '| Acme | SWE | https://acme.com | applied | 2024-01-01 |',
      '| 损坏行 |',  // too few columns
    ].join('\n')

    const rows = parseJobsMd(content)
    expect(rows).toHaveLength(1)
  })
})
