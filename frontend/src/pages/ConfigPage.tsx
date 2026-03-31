import type { ConfigDocName, SettingsFormValue } from '@/types'
import { formatMaskedSecret, formatMissingFields } from '@/lib/content'

export function ConfigPage(props: {
  active: boolean
  loading: boolean
  appReady: boolean
  missingFields: string[]
  form: SettingsFormValue
  setForm: (updater: (current: SettingsFormValue) => SettingsFormValue) => void
  apiKeyConfigured: boolean
  maskedApiKey: string
  activeFile: ConfigDocName
  switchFile: (file: ConfigDocName) => void
  docs: Record<ConfigDocName, { content: string; saved: string }>
  setDocs: (updater: (current: Record<ConfigDocName, { content: string; saved: string }>) => Record<ConfigDocName, { content: string; saved: string }>) => void
  settingsStatus: string
  docStatus: string
  persistSettings: () => void
  persistDoc: () => void
  targetsReady: boolean
  userinfoReady: boolean
}) {
  const doc = props.docs[props.activeFile]
  const missingSummary = formatMissingFields(props.missingFields)

  return (
    <section
      id="tab-config"
      className={`page-panel${props.active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="tab-config-title"
      hidden={!props.active}
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">配置与资料</p>
          <h2 id="tab-config-title">把连接和资料补齐，后面的搜索和简历才会稳定</h2>
          <p>{props.appReady ? '连接已经可用，现在补齐资料后就能更稳定地执行任务。' : `当前还缺：${missingSummary}`}</p>
        </div>
      </div>

      <div className="config-grid">
        <section className="card-section">
          <div className="section-row">
            <h3>连接设置</h3>
            <div className="status-group">
              <span id="save-settings-status" className="subtle-text">{props.settingsStatus}</span>
              <button id="save-settings" type="button" className="primary-button" onClick={props.persistSettings}>
                保存设置
              </button>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>API 密钥</span>
              <small className="field-hint">环境变量：API_KEY</small>
              <input
                id="setting-api_key"
                type="password"
                value={props.form.API_KEY}
                placeholder={formatMaskedSecret(props.maskedApiKey, props.apiKeyConfigured)}
                onChange={(event) => props.setForm((current) => ({ ...current, API_KEY: event.target.value }))}
              />
            </label>
            <label>
              <span>主模型</span>
              <small className="field-hint">环境变量：MODEL_ID</small>
              <input
                id="setting-model_id"
                type="text"
                value={props.form.MODEL_ID}
                onChange={(event) => props.setForm((current) => ({ ...current, MODEL_ID: event.target.value }))}
              />
            </label>
            <label>
              <span>备用模型</span>
              <small className="field-hint">环境变量：LIGHT_MODEL_ID</small>
              <input
                id="setting-light_model_id"
                type="text"
                value={props.form.LIGHT_MODEL_ID}
                onChange={(event) => props.setForm((current) => ({ ...current, LIGHT_MODEL_ID: event.target.value }))}
              />
            </label>
            <label>
              <span>接口地址</span>
              <small className="field-hint">环境变量：BASE_URL</small>
              <input
                id="setting-base_url"
                type="url"
                value={props.form.BASE_URL}
                onChange={(event) => props.setForm((current) => ({ ...current, BASE_URL: event.target.value }))}
              />
            </label>
            <label>
              <span>服务端口</span>
              <small className="field-hint">环境变量：SERVER_PORT</small>
              <input
                id="setting-server_port"
                type="number"
                value={props.form.SERVER_PORT}
                onChange={(event) => props.setForm((current) => ({ ...current, SERVER_PORT: event.target.value }))}
              />
            </label>
          </div>
          <p id="config-restart-note" className="subtle-text">只有修改服务端口时才需要重启服务。</p>
        </section>

        <section className="card-section">
          <div className="section-row">
            <h3>求职资料</h3>
            <div className="status-group">
              <span id="save-status" className="subtle-text">{props.docStatus}</span>
              <button id="save-md" type="button" className="primary-button" onClick={props.persistDoc}>
                保存内容
              </button>
            </div>
          </div>
          <div className="doc-badges">
            <span id="targets-doc-status" className={`status-badge${props.targetsReady ? ' is-ready' : ''}`}>
              目标偏好：{props.targetsReady ? '已完善' : '待补充'}
            </span>
            <span id="userinfo-doc-status" className={`status-badge${props.userinfoReady ? ' is-ready' : ''}`}>
              个人资料：{props.userinfoReady ? '已完善' : '待补充'}
            </span>
          </div>
          <div className="doc-tabs">
            <button
              type="button"
              className={`config-tab-btn${props.activeFile === 'targets' ? ' is-active' : ''}`}
              data-file="targets"
              onClick={() => props.switchFile('targets')}
            >
              targets.md
            </button>
            <button
              type="button"
              className={`config-tab-btn${props.activeFile === 'userinfo' ? ' is-active' : ''}`}
              data-file="userinfo"
              onClick={() => props.switchFile('userinfo')}
            >
              userinfo.md
            </button>
          </div>
          <label htmlFor="md-editor" className="sr-only">当前资料内容</label>
          <textarea
            id="md-editor"
            className="doc-editor"
            value={doc.content}
            onChange={(event) =>
              props.setDocs((current) => ({
                ...current,
                [props.activeFile]: {
                  ...current[props.activeFile],
                  content: event.target.value,
                },
              }))
            }
            placeholder={props.loading ? '加载中...' : ''}
          />
          <p className="subtle-text">
            {props.activeFile === 'targets'
              ? '把理想岗位、地区、公司和关键词写清楚，后续筛选会更稳定。'
              : '把经历、技能、亮点和求职偏好写清楚，生成简历会更可靠。'}
          </p>
        </section>
      </div>
    </section>
  )
}
