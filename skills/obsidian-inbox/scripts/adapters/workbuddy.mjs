/**
 * workbuddy adapter —— WorkBuddy（Electron 应用）会话。
 *
 * 数据源（本机实测）：`$WORKBUDDY_HOME/workbuddy.db`（默认 ~/.workbuddy/workbuddy.db），
 * SQLite 表 `sessions`（Drizzle ORM，30 列）。**权威存储只有这张表**（已全盘核实：
 * `~/.config/WorkBuddy/codebuddy-sessions.vscdb` 不存在、`expert-history.json` 空、
 * 无独立消息表——消息按 session_id 关联存云端/尚未迁移，本机 sessions 行数为 0）。
 *
 * 读取方式：不引入 npm 依赖（保持零依赖），用 spawnSync 调 Python 标准库 sqlite3
 * 只读打开 —— 与 db-sync.sh 内联 Python 同一模式；Python 的 sqlite3 是标准库，
 * Windows/Linux/macOS 自带（`python`/`python3`/`py -3` 顺序探测，与 db-sync 一致）。
 *
 * 过滤：`deleted_at IS NULL AND is_playground = 0`（跳过软删除与沙盒会话）。
 * 消息：表里无消息列 → 若将来出现 `messages` 表/`turns` 列（尚未实现的迁移），
 *       从它取；否则 turns 为空 → 归档端 substanceOf=0 → 判 trivial 跳过（不报错）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { makeSession, toMs, inWindow, isNoisePrompt, cleanTitle } from './contract.mjs';

export const id = 'workbuddy';
export const label = 'WorkBuddy';
export const sessionRoot = () => join(process.env.WORKBUDDY_HOME || join(homedir(), '.workbuddy'), 'workbuddy.db');

/** 探测 Python 解释器（与 db-sync 同序：python3 → python → py -3）。 */
function findPython() {
  for (const c of ['python3', 'python']) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (!r.error && (r.status ?? 1) === 0) return c;
  }
  const r = spawnSync('py', ['-3', '--version'], { encoding: 'utf8' });
  if (!r.error && (r.status ?? 1) === 0) return 'py -3';
  return null;
}

/**
 * 用 Python 只读查询 workbuddy.db，返回 JSON。
 * @param {string} sql  查询（只允许 SELECT，由本文件硬编码，不接受外部输入）
 * @returns {Array|null} 行对象数组；失败返回 null
 */
function query(sql) {
  const db = sessionRoot();
  if (!existsSync(db)) return null;
  let size = 0;
  try { size = statSync(db).mtimeMs; } catch { return null; }  // 存在性已查
  const py = findPython();
  if (!py) return null;
  const [bin, ...pyArgs] = py.split(' ');
  // 只读 URI + 无 header/无脚注，纯 JSON 数组
  const code = [
    'import sqlite3,sys,json',
    `con=sqlite3.connect("file:${db}?mode=ro",uri=True)`,
    'con.row_factory=sqlite3.Row',
    `rows=con.execute(${JSON.stringify(sql)}).fetchall()`,
    'print(json.dumps([dict(r) for r in rows],default=str,ensure_ascii=False))',
  ].join(';');
  const r = spawnSync(bin, [...pyArgs, '-c', code], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || (r.status ?? 1) !== 0) return null;
  try { return JSON.parse(String(r.stdout).trim()); } catch { return null; }
}

/** 会话元数据（无消息）。若将来出现 messages 表，此处可加 JOIN 取轮次。 */
function listSessionMeta(win) {
  const rows = query(
    'SELECT id, cwd, title, custom_title, model, created_at, updated_at, last_activity_at '
    + 'FROM sessions WHERE deleted_at IS NULL AND is_playground = 0 '
    + 'ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC LIMIT 2000',
  );
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const createdAt = toMs(r.created_at);
    const lastPromptAt = toMs(r.last_activity_at || r.updated_at || r.created_at);
    const title = r.custom_title || r.title || '';
    const s = makeSession({
      id: String(r.id || ''),
      cwd: r.cwd || '',
      createdAt, lastPromptAt,
      title, model: r.model || '',
      turns: [],            // 消息在云端/未迁移，见头部说明
      turnCount: 0,
    });
    out.push(s);
  }
  return out;
}

export function listSessions(cfg, win, args = {}) {
  const db = sessionRoot();
  if (!existsSync(db)) return [];
  const only = typeof args.session === 'string'
    ? new Set(String(args.session).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const exclude = cfg.excludeCwdPrefixes || [];
  const out = [];
  for (const s of listSessionMeta(win)) {
    if (!s.id) continue;
    if (only && !only.has(s.id)) continue;
    if (exclude.some((p) => s.cwd.startsWith(p))) continue;
    if (!only && !inWindow(s, win)) continue;
    out.push(s);
  }
  out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
  return out;
}

/** workbuddy 无本地 transcript（消息在云端），不支持 transcript 兜底。 */
export function hasTranscript() { return false; }
