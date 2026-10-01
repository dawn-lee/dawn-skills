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
import { makeSession, textOf, toMs, inWindow, isNoisePrompt, cleanTitle, cwdExcluded } from './contract.mjs';

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

/** 标题是否是内部引用/无意义值（人读不了，该被 thread_name 覆盖）。 */
function isBadTitle(t) {
  if (!t) return true;
  const s = String(t).trim();
  if (/^(codex|vscode|chat):\/\//i.test(s)) return true;                       // codex://threads/…
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;  // 纯 uuid
  if (s.length < 3) return true;
  return false;
}

/** 递归收集目录下所有 rollout .jsonl（不限深度，覆盖 sessions/YYYY/MM/DD 任意层级）。 */
function collectRollouts(dir, depth = 0) {
  if (depth > 16) return [];   // 防环/异常深
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectRollouts(p, depth + 1));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
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

  // 1) archived_sessions + sessions/YYYY/MM/DD（真实层级可深达 4 层，必须真递归）
  for (const root of [sessionRoot(), liveRoot()]) {
    const files = collectRollouts(root);
    for (const p of files) {
      const fname = p.split('/').pop();
      const sid = fname.replace(/\.jsonl$/, '');
      if (only && !only.has(sid)) continue;
      const s = parseFile(p, sid);
      if (!s) continue;
      // 文件名时间戳兜底（timestamp 缺失时）
      if (!s.lastPromptAt) s.lastPromptAt = timeFromName(fname) || (statSync(p).mtimeMs || 0);
      if (!s.createdAt) s.createdAt = s.lastPromptAt;
      if (cwdExcluded(s, exclude)) continue;
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
        const tn = meta?.thread_name;
        // title 若是 codex://threads/… 这类内部引用（人读不了），视为无效，用 thread_name 覆盖
        if (tn && (isBadTitle(s.title) || !s.title)) s.title = cleanTitle(tn);
      }
    }
  } catch { /* 索引缺失不影响 */ }
  out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
  return out;
}

/**
 * 原始 transcript reader —— 供 `note.mjs recover` 回补被截断的代码块。
 * codex 的 rollout 是**明文 jsonl**（不像 DSH 那样 zstd 压缩），
 * 且归档 frontmatter 的 `session` 存的就是完整路径，所以先按路径直取、再按 id/文件名在
 * archived_sessions 与 sessions/YYYY/MM/DD 下递归找。
 */
export const transcriptReader = {
  agent: id,
  findTranscriptPath(sid) {
    const s = String(sid ?? '').trim();
    if (!s) return null;
    if (s.endsWith('.jsonl') && existsSync(s)) return s;
    const base = s.split(/[\\/]/).pop().replace(/\.jsonl$/, '');
    if (!base) return null;
    for (const root of [sessionRoot(), liveRoot()]) {
      for (const p of collectRollouts(root)) {
        const f = p.split(/[\\/]/).pop();
        if (f === `${base}.jsonl`) return p;
      }
    }
    return null;
  },
  readAssistantTexts(path) {
    const sid = String(path).split(/[\\/]/).pop().replace(/\.jsonl$/, '');
    const s = parseFile(path, sid);
    return (s?.turns ?? []).map((t) => t.response).filter(Boolean);
  },
  /**
   * 工具调用参数 / 输出原文（`recover --from-tools` 用）——codex 的实质内容大多在这里：
   * `function_call.arguments`、`custom_tool_call.input`、`*_output.output`（字符串或 input_text 块数组）。
   */
  readToolTexts(path) {
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { return []; }
    const out = [];
    const push = (v) => {
      const t = typeof v === 'string' ? v : textOf(v);
      if (t && t.trim()) out.push(t);
    };
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.type !== 'response_item') continue;
      const p = d.payload ?? {};
      if (p.type === 'function_call') push(p.arguments);
      else if (p.type === 'custom_tool_call') push(p.input);
      else if (p.type === 'function_call_output') push(p.output);
      else if (p.type === 'custom_tool_call_output') push(p.output);
    }
    return out;
  },
};
