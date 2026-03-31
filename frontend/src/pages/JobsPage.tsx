import type { JobItem } from '@/types'

const STATUS_LABEL: Record<string, string> = {
  all: '全部',
  discovered: '待处理',
  favorite: '关注',
  applied: '已投递',
  failed: '失败',
  login_required: '需登录',
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知'
  return date.toLocaleString()
}

function JobDetail({ job }: { job: JobItem | null }) {
  if (!job) {
    return (
      <div id="job-detail-panel" className="detail-panel">
        <h3>职位详情</h3>
        <p>从左侧选一条职位，这里会显示你做决定需要的信息。</p>
      </div>
    )
  }

  return (
    <div id="job-detail-panel" className="detail-panel">
      <p className="section-kicker">当前查看</p>
      <h3>{job.title}</h3>
      <p className="subtle-text">{job.company}</p>
      <p className="detail-status">状态：{STATUS_LABEL[job.status] || job.status}</p>
      {job.fitSummary ? <p>{job.fitSummary}</p> : null}
      {job.notes ? <p>{job.notes}</p> : null}
      <dl className="detail-list">
        <div>
          <dt>首次发现</dt>
          <dd>{formatDate(job.discoveredAt)}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{formatDate(job.updatedAt)}</dd>
        </div>
      </dl>
      {job.url ? (
        <a className="inline-link" href={job.url} target="_blank" rel="noreferrer noopener">
          打开职位原文
        </a>
      ) : null}
    </div>
  )
}

export function JobsPage(props: {
  active: boolean
  loading: boolean
  total: number
  items: JobItem[]
  selectedCount: number
  status: string
  query: string
  activeJob: JobItem | null
  setStatus: (value: string) => void
  setQuery: (value: string) => void
  refresh: () => void
  resetFilters: () => void
  toggleSelection: (url: string) => void
  toggleAll: () => void
  setActiveUrl: (url: string) => void
  runBulkStatus: (status: 'applied' | 'favorite' | 'failed') => void
  runBulkDelete: () => void
  selectedUrls: string[]
}) {
  const allSelected = props.items.length > 0 && props.selectedUrls.length === props.items.length
  const showingFiltered = props.query || props.status !== 'all'

  return (
    <section
      id="tab-jobs"
      className={`page-panel${props.active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="tab-jobs-title"
      hidden={!props.active}
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">职位列表</p>
          <h2 id="tab-jobs-title">先找出现在值得处理的职位</h2>
          <p>搜索、筛选、查看原因，再决定是否批量处理。</p>
        </div>
      </div>

      <div id="jobs-filter-controls" className="toolbar">
        <select id="jobs-status" aria-label="职位状态筛选" value={props.status} onChange={(event) => props.setStatus(event.target.value)}>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          id="jobs-search"
          type="search"
          aria-label="搜索职位"
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="搜索公司、职位或备注"
        />
        <button id="jobs-filter-reset" type="button" className="secondary-button" onClick={props.resetFilters}>
          重置
        </button>
        <button id="refresh-jobs" type="button" className="primary-button" onClick={props.refresh}>
          {props.loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <p className="subtle-text jobs-meta">
        {showingFiltered
          ? `当前显示 ${props.items.length} 条，全部职位共 ${props.total} 条。`
          : `当前共有 ${props.total} 条职位${props.selectedCount ? `，已选 ${props.selectedCount} 条。` : '。'}`}
      </p>

      <div id="jobs-batch-toolbar" className={`batch-toolbar${props.selectedCount ? '' : ' is-hidden'}`} aria-hidden={props.selectedCount ? 'false' : 'true'}>
        <button id="batch-apply" type="button" className="secondary-button" onClick={() => props.runBulkStatus('applied')}>
          标记已投递
        </button>
        <button id="batch-favorite" type="button" className="secondary-button" onClick={() => props.runBulkStatus('favorite')}>
          标记关注
        </button>
        <button id="batch-fail" type="button" className="secondary-button" onClick={() => props.runBulkStatus('failed')}>
          标记失败
        </button>
        <button id="batch-delete" type="button" className="danger-button" onClick={props.runBulkDelete}>
          删除
        </button>
      </div>

      <div className="jobs-layout">
        <div className="table-card">
          <table>
            <caption className="sr-only">职位列表</caption>
            <thead>
              <tr>
                <th scope="col">
                  <input
                    id="select-all"
                    type="checkbox"
                    aria-label="全选当前列表职位"
                    checked={allSelected}
                    onChange={props.toggleAll}
                  />
                </th>
                <th scope="col">公司</th>
                <th scope="col">职位</th>
                <th scope="col">状态</th>
                <th scope="col">更新时间</th>
              </tr>
            </thead>
            <tbody id="job-tbody">
              {props.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    {props.query || props.status !== 'all'
                      ? '当前筛选条件下没有结果。你可以重置筛选后再看。'
                  : '还没有职位数据。你可以先刷新，或先去对话页开始搜索。'}
                  </td>
                </tr>
              ) : (
                props.items.map((item) => (
                  <tr
                    key={item.url || item.id}
                    className={props.activeJob?.url === item.url ? 'is-active' : ''}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.company} ${item.title}`}
                        checked={props.selectedUrls.includes(item.url)}
                        onChange={(event) => {
                          event.stopPropagation()
                          props.toggleSelection(item.url)
                        }}
                      />
                    </td>
                    <td>{item.company}</td>
                    <td>
                      <button
                        type="button"
                        className={`table-link-button${props.activeJob?.url === item.url ? ' is-active' : ''}`}
                        onClick={() => props.setActiveUrl(item.url)}
                      >
                        {item.title}
                      </button>
                    </td>
                    <td>{STATUS_LABEL[item.status] || item.status}</td>
                    <td>{formatDate(item.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <aside id="job-detail-anchor" aria-label="职位详情">
          <JobDetail job={props.activeJob} />
        </aside>
      </div>
    </section>
  )
}
