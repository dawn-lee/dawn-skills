/**
 * codex adapter —— OpenAI Codex CLI / desktop 会话。
 *
 * 数据源（实测本机）：
 *   - 归档：`$CODEX_HOME/archived_sessions/rollout-<ISO>-<uuid>.jsonl`
 *   - 索引：`$CODEX_HOME/session_index.jsonl`（id/thread_name/updated_at）
 *   - 活动：`$CODEX_HOME/sessions/YYYY/MM/…`（同 rollout 格式，默认 CODEX_HOME=~/.codex）
 *
 * rollout jsonl 行结构：
 *   - type=session_meta  payload{cwd, model…} + timestamp
 *   - type=event_msg     task_started 等
 *   - type=response_item payload{type:'message', role, content:[{type:'input_text'|'output_text', text}]}
 *
 * 抽法：**跳过 role=developer**（Codex 的系统上下文/插件清单，不是用户知识），
 * 只取 user / assistant 的 input_text、output_text；timestamp 用 rollout 文件名的 ISO。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { makeSession, textOf, toMs, inWindow, isNoisePrompt, cleanTitle } from './contract.mjs';

export const id = 'codex';
export const label = 'Codex';
export const sessionRoot = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'archived_sessions');
export const liveRoot = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');

/** rollout 文件名：rollout-2026-09-10T10-39-41-966Z-<uuid>.jsonl → ISO 时间戳 */
function timeFromName(fname) {
  const m = fname.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const [, Y, Mo, D, H, Mi, S] = m;
  return Date.parse(`${Y}-${Mo}-${D}T${H}:${Mi}:${S}Z`);
}

function parseFile(path, sid) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  const turns = [];
  let cwd = '', title = '', model = '', createdAt = 0, lastPromptAt = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (d.type === 'session_meta') {
      const p = d.payload ?? {};
      if (p.cwd && !cwd) cwd = p.cwd;
      if (p.model && !model) model = p.model;
      const ts = toMs(d.timestamp);
      if (ts) { createdAt = ts; lastPromptAt = ts; }
      continue;
    }
    // 模型名不在 session_meta（那里只有 model_provider），而在 turn_context.model
    if (d.type === 'turn_context') {
      const p = d.payload ?? {};
      if (p.model && !model) model = p.model;
      continue;
    }
    if (d.type !== 'response_item') continue;
    const p = d.payload ?? {};
    if (p.type !== 'message') continue;
    const role = p.role;
    if (role === 'developer') continue;          // 系统上下文，不是用户知识
    const txt = textOf(p.content);
    if (!txt || isNoisePrompt(txt)) continue;
    const ts = toMs(d.timestamp);
    if (ts) { if (!createdAt) createdAt = ts; lastPromptAt = Math.max(lastPromptAt, ts); }
    if (role === 'user') {
      // 跳过 Codex 注入的 <recommended_plugins> / <app-context> 等系统注入
      if (/^<(recommended_plugins|app-context|multi_agent_mode|environment_context)>/.test(txt)) continue;
      turns.push({ turn: turns.length + 1, prompt: txt, response: '' });
      if (!title) title = cleanTitle(txt.replace(/^[^@\n]*\\@[^\n:]*:[^\n]*?[#\$]\s*/, ''));
    } else if (role === 'assistant' && turns.length) {
      const prev = turns[turns.length - 1];
      prev.response = prev.response ? `${prev.response}\n${txt}` : txt;
    }
  }
  if (!turns.length) return null;
  return makeSession({ id: sid, cwd, createdAt, lastPromptAt, title, model, turns, turnCount: turns.length });
}

export function listSessions(cfg, win, args = {}) {
  const only = typeof args.session === 'string'
    ? new Set(String(args.session).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const exclude = cfg.excludeCwdPrefixes || [];
  const out = [];

  // 1) archived_sessions
  for (const root of [sessionRoot(), liveRoot()]) {
    let files = [];
    try {
      const ents = readdirSync(root, { withFileTypes: true });
      if (ents.some((e) => e.isDirectory())) {
        // sessions/2026/09/ 结构：递归一层
        for (const e of ents) {
          if (!e.isDirectory()) continue;
          try {
            for (const e2 of readdirSync(join(root, e.name), { withFileTypes: true })) {
              if (e2.isDirectory()) continue;
              if (e2.name.endsWith('.jsonl')) files.push(join(root, e.name, e2.name));
            }
          } catch { /* 忽略 */ }
        }
      } else {
        files = ents.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(root, e.name));
      }
    } catch { continue; }
    for (const p of files) {
      const fname = p.split('/').pop();
      const sid = fname.replace(/\.jsonl$/, '');
      if (only && !only.has(sid)) continue;
      const s = parseFile(p, sid);
      if (!s) continue;
      // 文件名时间戳兜底（timestamp 缺失时）
      if (!s.lastPromptAt) s.lastPromptAt = timeFromName(fname) || (statSync(p).mtimeMs || 0);
      if (!s.createdAt) s.createdAt = s.lastPromptAt;
      if (exclude.some((p2) => s.cwd.startsWith(p2))) continue;
      if (!only && !inWindow(s, win)) continue;
      out.push(s);
    }
  }
  // 2) session_index.jsonl：thread_name 补标题（找不到 title 的用它）
  try {
    const idx = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'session_index.jsonl');
    if (existsSync(idx)) {
      const byId = new Map();
      for (const line of readFileSync(idx, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { const d = JSON.parse(t); if (d.id) byId.set(d.id, d); } catch { /* 跳过 */ }
      }
      for (const s of out) {
        const meta = byId.get(s.id);
        if (meta?.thread_name && !s.title) s.title = meta.thread_name;
      }
    }
  } catch { /* 索引缺失不影响 */ }
  out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
  return out;
}
