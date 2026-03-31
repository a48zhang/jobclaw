import type { ResumeStatusPayload, ResumeWorkflowPayload } from '@/types'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function ResumePage(props: {
  active: boolean
  workflow: ResumeWorkflowPayload['overview'] | null
  status: ResumeStatusPayload | null
  loading: boolean
  selectedFile: File | null
  setSelectedFile: (file: File | null) => void
  uploadStatus: string
  primaryStatus: string
  submitUpload: () => void
  triggerReview: () => void
  triggerBuild: () => void
}) {
  const generatedPath = props.status?.path || '/workspace/output/resume.pdf'
  const generatedExists = props.status?.exists || props.workflow?.generatedResume.exists

  return (
    <section
      id="tab-resume"
      className={`page-panel${props.active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="tab-resume-title"
      hidden={!props.active}
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">简历中心</p>
          <h2 id="tab-resume-title">先生成最新版本，结果就留在本页</h2>
          <p>{props.primaryStatus}</p>
        </div>
      </div>

      <div className="resume-grid">
        <section className="card-section">
          <div className="primary-flow-block">
            <h3>主路径</h3>
            <p>生成后会直接在本页出现 PDF 入口。</p>
            <button id="gen-resume" type="button" className="primary-button hero-button" onClick={props.triggerBuild}>
              生成最新简历
            </button>
          </div>

          <div className="secondary-action-block">
            <h3>已有旧简历时再用</h3>
            <label htmlFor="resume-upload-file" className="subtle-text">选择参考 PDF</label>
            <div className="upload-group">
              <input
                id="resume-upload-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => props.setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <button id="upload-resume" type="button" className="secondary-button" onClick={props.submitUpload}>
                上传参考简历
              </button>
            </div>
            {props.selectedFile ? <p className="subtle-text">已选择：{props.selectedFile.name}</p> : null}
            <button id="review-uploaded-resume" type="button" className="secondary-button" onClick={props.triggerReview}>
              获取改进建议
            </button>
            <p id="resume-upload-status" className="subtle-text">{props.uploadStatus}</p>
          </div>
        </section>

        <section className="card-section">
          <h3>最新导出</h3>
          <div id="resume-preview" className={`resume-preview${generatedExists ? '' : ' is-hidden'}`}>
            <p>最新 PDF 已准备好，现在可以直接打开查看。</p>
            <a id="resume-link" href={generatedPath} target="_blank" rel="noreferrer noopener" className="primary-button">
              打开 PDF
            </a>
          </div>
          <div id="resume-preview-empty" className={`resume-empty${generatedExists ? ' is-hidden' : ''}`}>
            <p>生成完成后，这里会出现最新 PDF 入口。</p>
          </div>
          {props.status?.mtime ? <p className="subtle-text">最近更新：{formatDate(props.status.mtime)}</p> : null}
        </section>
      </div>
    </section>
  )
}
