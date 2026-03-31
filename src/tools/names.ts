export const TOOL_NAMES = {
  READ_FILE: 'read_file',
  WRITE_FILE: 'write_file',
  APPEND_FILE: 'append_file',
  LIST_DIRECTORY: 'list_directory',
  LOCK_FILE: 'lock_file',
  UNLOCK_FILE: 'unlock_file',
  UPSERT_JOB: 'upsert_job',
  UPDATE_WORKSPACE_CONTEXT: 'update_workspace_context',
  TYPST_COMPILE: 'typst_compile',
  INSTALL_TYPST: 'install_typst',
  RUN_SHELL_COMMAND: 'run_shell_command',
  READ_PDF: 'read_pdf',
  GREP: 'grep',
  GET_TIME: 'get_time',
  RUN_AGENT: 'run_agent',
} as const

export const TOOL_NAME_LIST = Object.values(TOOL_NAMES) as readonly string[]
export type ToolName = (typeof TOOL_NAME_LIST)[number]

export const ADMIN_TOOL_NAMES = ['run_shell_command'] as const

export function isBrowserToolName(toolName: string): boolean {
  return toolName.startsWith('browser_') || toolName.startsWith('playwright_')
}
