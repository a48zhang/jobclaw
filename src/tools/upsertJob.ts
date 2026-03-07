import fs from 'fs/promises';
import path from 'path';
import { lockFile, unlockFile } from './lockFile';

export interface UpsertJobArgs {
  company: string;
  title: string;
  url: string;
  status: 'discovered' | 'applied' | 'failed' | 'login_required';
  time?: string;
}

/**
 * upsertJob 工具：结构化地更新或插入职位信息到 jobs.md
 */
export async function upsertJob(args: UpsertJobArgs, workspaceRoot: string): Promise<{ success: boolean; action: 'added' | 'updated' | 'skipped'; message: string }> {
  const jobsPath = path.join(workspaceRoot, 'data/jobs.md');
  const relativeJobsPath = 'data/jobs.md'; // 用于 lockFile 的相对路径标识
  const holder = 'system';

  try {
    // 调用重构后的底层 lockFile
    await lockFile(relativeJobsPath, holder, workspaceRoot);

    let content = '';
    try {
      content = await fs.readFile(jobsPath, 'utf-8');
    } catch (e) {
      content = '| 公司 | 职位 | 链接 | 状态 | 时间 |\n| --- | --- | --- | --- | --- |\n';
    }

    const lines = content.split('\n');
    const headerSeparatorIndex = lines.findIndex(l => l.includes('| --- |'));
    if (headerSeparatorIndex === -1) {
       throw new Error('Invalid jobs.md format: Missing header separator.');
    }

    const headerLines = lines.slice(0, headerSeparatorIndex + 1);
    const dataLines = lines.slice(headerSeparatorIndex + 1).filter(l => l.trim().startsWith('|'));
    
    const timeStr = args.time || new Date().toISOString().split('T')[0];
    
    // 精准查重逻辑 (Index 3: URL)
    let existingIndex = -1;
    for (let i = 0; i < dataLines.length; i++) {
      const columns = dataLines[i].split('|').map(c => c.trim());
      if (columns[3] === args.url) {
        existingIndex = i;
        break;
      }
    }

    let action: 'added' | 'updated' | 'skipped' = 'added';
    const newRow = `| ${args.company} | ${args.title} | ${args.url} | ${args.status} | ${timeStr} |`;

    if (existingIndex !== -1) {
      const columns = dataLines[existingIndex].split('|').map(c => c.trim());
      const currentStatus = columns[4];

      if (currentStatus === 'applied' && args.status === 'discovered') {
        action = 'skipped';
      } else {
        dataLines[existingIndex] = newRow;
        action = 'updated';
      }
    } else {
      dataLines.push(newRow);
      action = 'added';
    }

    if (action !== 'skipped') {
      const newContent = [...headerLines, ...dataLines.filter(l => l.trim() !== '')].join('\n') + '\n';
      await fs.writeFile(jobsPath, newContent, 'utf-8');
    }

    return { success: true, action, message: `Job ${action}` };

  } catch (error: any) {
    return { success: false, action: 'skipped', message: error.message };
  } finally {
    // 确保释放锁
    try {
      await unlockFile(relativeJobsPath, holder, workspaceRoot);
    } catch {
      // 忽略解锁错误
    }
  }
}
