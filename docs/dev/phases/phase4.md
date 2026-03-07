# Phase 4：Channel 通知

**目标**：实现 `src/channel/` 通知模块。

### 任务清单

#### 4.1 Channel 抽象接口（`src/channel/base.ts`）

定义 `Channel` 接口，包含 `send(title, content, options?)` 方法。

#### 4.2 EmailChannel（`src/channel/email.ts`）

- 实现 `Channel` 接口
- 使用 `nodemailer` 发送邮件
- 从环境变量读取 SMTP 配置（`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`NOTIFY_EMAIL`）
- 构造函数检查必要环境变量是否存在
- `send()` 方法构造邮件主题和正文，调用 nodemailer transporter

#### 4.3 集成到 Agent

- `src/index.ts` 中：若环境变量包含 SMTP 配置则实例化 `EmailChannel`，传入 SearchAgent 和 DeliveryAgent

### 验收标准

投递成功/失败时收到邮件通知。
