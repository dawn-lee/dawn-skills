/**
 * workbuddy adapter —— WorkBuddy（Electron 应用）会话。
 *
 * 两个数据源（本机 Windows 实测）：
 *   1. `$WORKBUDDY_HOME/projects/<cwd编码>/<sessionId>.jsonl` —— **会话正文**。
 *      每行一条记录：`{type:'message', role:'user'|'assistant', content:[{type:'input_text'|'output_text', text}]}`，
 *      另有 `ai-title`（好标题）、`file-history-snapshot`（带 cwd）、`reasoning`/`function_call*`（噪音）。
 *      与 claude/qoder 的 Anthropic 风格同构，所以用同一套抽取逻辑。本机 85 个文件。
 *   2. `$WORKBUDDY_HOME/workbuddy.db` 的 `sessions` 表 —— 元数据（title/custom_title/model/时间戳，无消息列）。
 *      用来补标题与时间、并兜住"有元数据但没 jsonl"的会话。
 * 早先版本只读 (2)，注释还断言"消息在云端"——在本机不成立：正文就在 (1)。
 *
 * ⚠ 读 (2) 走 spawnSync + Python 标准库 sqlite3（不引 npm 依赖）。Windows 上必须把路径转成
 *   `/` 并用 JSON.stringify 嵌进 Python 源码：直接拼 `file:C:\Users\…` 会让 Python 把 `\U`
 *   当 unicode 转义 → SyntaxError → 查询静默失败（表现为"0 个会话"，踩过）。
 *
 * 过滤：`deleted_at IS NULL AND is_playground = 0`（跳过软删除与沙盒会话）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { makeSession, textOf, toMs, inWindow, isNoisePrompt, cleanTitle, cwdExcluded } from './contract.mjs';

export const id = 'workbuddy';
export const label = 'WorkBuddy';
export const home = () => process.env.WORKBUDDY_HOME || join(homedir(), '.workbuddy');
/** 元数据库（旧版唯一的"sessionRoot"，保留此名以兼容既有调用）。 */
export const sessionRoot = () => join(home(), 'workbuddy.db');
/** 会话正文目录（projects/<cwd编码>/<sid>.jsonl）。 */
export const transcriptRoot = () => join(home(), 'projects');

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
  const py = findPython();
  if (!py) return null;
  const [bin, ...pyArgs] = py.split(' ');
  // Windows 路径先归一成 `/`，再用 JSON.stringify 交给 Python（见文件头警告）
  const posix = db.replace(/\\/g, '/');
  const uri = posix.startsWith('/') ? `file://${posix}?mode=ro` : `file:///${posix}?mode=ro`;
  // 只读 URI + 无 header/无脚注，纯 JSON 数组
  const code = [
    'import sqlite3,sys,json',
    `con=sqlite3.connect(${JSON.stringify(uri)},uri=True)`,
    'con.row_factory=sqlite3.Row',
    `rows=con.execute(${JSON.stringify(sql)}).fetchall()`,
    'print(json.dumps([dict(r) for r in rows],default=str,ensure_ascii=False))',
  ].join(';');
  const r = spawnSync(bin, [...pyArgs, '-c', code], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || (r.status ?? 1) !== 0) return null;
  try { return JSON.parse(String(r.stdout).trim()); } catch { return null; }
}

/** 会话元数据（无消息）：id → {title, model, cwd, createdAt, lastPromptAt}。 */
function listSessionMeta() {
  const rows = query(
    'SELECT id, cwd, title, custom_title, model, created_at, updated_at, last_activity_at '
    + 'FROM sessions WHERE deleted_at IS NULL AND is_playground = 0 '
    + 'ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC LIMIT 2000',
  );
  if (!Array.isArray(rows)) return new Map();
  const out = new Map();
  for (const r of rows) {
    const sid = String(r.id || '');
    if (!sid) continue;
    out.set(sid, {
      title: String(r.custom_title || r.title || ''),
      model: String(r.model || ''),
      cwd: String(r.cwd || ''),
      createdAt: toMs(r.created_at),
      lastPromptAt: toMs(r.last_activity_at || r.updated_at || r.created_at),
    });
  }
  return out;
}

/**
 * WorkBuddy 的 user 消息 = `<system-reminder>…</system-reminder>`（身份/记忆/时间等注入）
 * + 真正的提问。真正的提问优先取 `<user_query>…</user_query>`（可能在正文末尾），
 * 没有就剥掉 reminder / 历史摘要后取剩余文本。
 */
function realUserText(text) {
  const t = String(text ?? '');
  const q = [...t.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)];
  if (q.length) return q[q.length - 1][1].trim();
  return t
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<conversation_history_summary[\s\S]*?<\/conversation_history_summary>/g, '')
    .trim();
}

/** 解析一份 projects/*.jsonl transcript（claude/qoder 同构）。 */
function parseTranscript(path, sid) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  const turns = [];
  let title = '', cwd = '', createdAt = 0, lastPromptAt = 0, model = '';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (!cwd && d.cwd) cwd = String(d.cwd);
    if (d.type === 'ai-title' && !title) title = String(d.aiTitle ?? '');
    if (d.type === 'runtime-config' && !model) model = String(d.model ?? '');
    const isUser = d.type === 'user' || d.role === 'user';
    const isAssistant = d.type === 'assistant' || d.role === 'assistant';
    if (!isUser && !isAssistant) continue;
    const ts = toMs(d.timestamp);
    if (ts) { if (!createdAt) createdAt = ts; lastPromptAt = Math.max(lastPromptAt, ts); }
    const rawText = textOf(d.message?.content ?? d.content ?? d.message);
    const txt = isUser ? realUserText(rawText) : rawText;
    if (!txt || isNoisePrompt(txt)) continue;
    if (isUser) {
      turns.push({ turn: turns.length + 1, prompt: txt, response: '' });
      if (!title) title = cleanTitle(txt);
    } else if (turns.length) {
      const prev = turns[turns.length - 1];
      prev.response = prev.response ? `${prev.response}\n${txt}` : txt;
    }
  }
  if (!turns.length) return null;
  return { id: sid, cwd, createdAt, lastPromptAt, title, model, turns, turnCount: turns.length };
}

/** 枚举 projects/<cwd编码>/<sid>.jsonl；win.from > 0 时按 mtime 跳过旧文件（省去全量解析）。 */
function listTranscripts(win, only) {
  const root = transcriptRoot();
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  const out = [];
  for (const dir of dirs) {
    let files = [];
    try { files = readdirSync(join(root, dir.name)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const sid = f.replace(/\.jsonl$/, '');
      if (only && !only.has(sid)) continue;
      const p = join(root, dir.name, f);
      if (!only && win.from > 0) {
        let mtime = 0;
        try { mtime = statSync(p).mtimeMs; } catch { /* 忽略 */ }
        if (mtime && mtime < win.from) continue;   // 文件最后写入早于窗口起点，不可能有新轮次
      }
      const s = parseTranscript(p, sid);
      if (s) out.push(s);
    }
  }
  return out;
}

export function listSessions(cfg, win, args = {}) {
  const only = typeof args.session === 'string'
    ? new Set(String(args.session).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const exclude = cfg.excludeCwdPrefixes || [];
  const meta = listSessionMeta();

  // ① 以本地 transcript 为主体（有正文），用元数据补标题/模型/时间
  const sessions = [];
  const seen = new Set();
  for (const t of listTranscripts(win, only)) {
    const m = meta.get(t.id);
    seen.add(t.id);
    sessions.push(makeSession({
      ...t,
      title: t.title || m?.title || '',
      model: t.model || m?.model || '',
      cwd: t.cwd || m?.cwd || '',
      createdAt: t.createdAt || m?.createdAt || 0,
      lastPromptAt: Math.max(t.lastPromptAt, m?.lastPromptAt || 0),
    }));
  }
  // ② 只有元数据、没有 transcript 的会话（turns 为空 → 归档端判 trivial，不报错）
  for (const [sid, m] of meta) {
    if (seen.has(sid)) continue;
    if (only && !only.has(sid)) continue;
    sessions.push(makeSession({
      id: sid, cwd: m.cwd, createdAt: m.createdAt, lastPromptAt: m.lastPromptAt,
      title: m.title, model: m.model, turns: [], turnCount: 0,
    }));
  }

  const out = sessions.filter((s) => {
    if (cwdExcluded(s, exclude)) return false;
    if (!only && !inWindow(s, win)) return false;
    return true;
  });
  out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
  return out;
}

/** 正文来自本地 jsonl（projects/），不再是"只有云端元数据"。 */
export function hasTranscript() { return true; }

/**
 * 原始 transcript reader —— 供 `note.mjs recover` 回补被截断的代码块。
 * 正文是明文 jsonl：`projects/<cwd编码>/<uuid>.jsonl`，按会话 id 直接定位文件名。
 */
export const transcriptReader = {
  agent: id,
  findTranscriptPath(sid) {
    const s = String(sid ?? '').trim();
    if (!s) return null;
    if (s.endsWith('.jsonl') && existsSync(s)) return s;
    const want = `${s.replace(/\.jsonl$/, '')}.jsonl`;
    let dirs = [];
    try { dirs = readdirSync(transcriptRoot(), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return null; }
    for (const d of dirs) {
      const p = join(transcriptRoot(), d.name, want);
      if (existsSync(p)) return p;
    }
    return null;
  },
  readAssistantTexts(path) {
    const sid = String(path).split(/[\\/]/).pop().replace(/\.jsonl$/, '');
    const s = parseTranscript(path, sid);
    return (s?.turns ?? []).map((t) => t.response).filter(Boolean);
  },
  /**
   * 工具调用参数 / 输出原文（`recover --from-tools` 用）——workbuddy 的脚本、配置改动大多在
   * `function_call.arguments`（JSON 串）与 `function_call_result.output.text` 里，助手正文很少有围栏块。
   */
  readToolTexts(path) {
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.type === 'function_call') {
        if (typeof d.arguments === 'string' && d.arguments.trim()) out.push(d.arguments);
      } else if (d.type === 'function_call_result') {
        const t = typeof d.output?.text === 'string' ? d.output.text : textOf(d.output);
        if (t && t.trim()) out.push(t);
      }
    }
    return out;
  },
};
