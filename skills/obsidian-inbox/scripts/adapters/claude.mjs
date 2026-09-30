/**
 * claude adapter —— Claude Code 会话。
 *
 * 数据源：`$CLAUDE_HOME/projects/<cwd编码>/<sessionId>.jsonl`（默认 ~/.claude）
 *   + `~/.claude/history.jsonl`（prompt 索引，含 sessionId/project/timestamp/display）
 *
 * 与 Qoder 同构（Anthropic 风格 message blocks：text/thinking/tool_use），
 * 只取 text block；title 用 ai-title 或首条 user 消息。
 * 若 projects 下无 jsonl（本机实测如此），回退用 history.jsonl 的 prompt 重建
 * 轮次（response 为空 → 归档端 substanceOf 会判 0 字 → 走 transcript 兜底或跳过）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { makeSession, textOf, toMs, inWindow, isNoisePrompt, cleanTitle, cwdExcluded } from './contract.mjs';

export const id = 'claude';
export const label = 'Claude Code';
export const sessionRoot = () => join(
  process.env.CLAUDE_HOME || join(homedir(), '.claude'),
  'projects',
);
let notifiedHistory = false;
export const historyPath = () => join(
  process.env.CLAUDE_HOME || join(homedir(), '.claude'),
  'history.jsonl',
);

function parseSessionFile(path, sid) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  const turns = [];
  let title = '', cwd = '', createdAt = 0, lastPromptAt = 0, model = '';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd;
    if (d.type === 'ai-title' && !title) title = d.aiTitle ?? '';
    if (d.type === 'runtime-config' && !model) model = d.model ?? '';
    const isUser = d.type === 'user' || d.role === 'user';
    const isAssistant = d.type === 'assistant' || d.role === 'assistant';
    if (!isUser && !isAssistant) continue;
    const ts = toMs(d.timestamp);
    if (ts) { if (!createdAt) createdAt = ts; lastPromptAt = Math.max(lastPromptAt, ts); }
    const txt = textOf(d.message?.content ?? d.content ?? d.message);
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
  return makeSession({ id: sid, cwd, createdAt, lastPromptAt, title, model, turns, turnCount: turns.length });
}

/** projects 下找不到 jsonl 时的回退：用 history.jsonl 按 sessionId 聚合 prompt。 */
function fromHistory(win, only) {
  const hp = historyPath();
  if (!existsSync(hp)) return [];
  let raw;
  try { raw = readFileSync(hp, 'utf8'); } catch { return []; }
  const bySid = new Map();
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    const sid = d.sessionId || '(unknown)';
    if (only && !only.has(sid)) continue;
    const ts = toMs(d.timestamp);
    const prompt = String(d.display ?? '').trim();
    if (!prompt) continue;
    if (!bySid.has(sid)) {
      bySid.set(sid, {
        id: sid,
        cwd: String(d.project ?? ''),
        createdAt: ts,
        lastPromptAt: ts,
        title: '',
        model: '',
        turns: [],
      });
    }
    const s = bySid.get(sid);
    if (ts) {
      s.createdAt = Math.min(s.createdAt || ts, ts);
      s.lastPromptAt = Math.max(s.lastPromptAt, ts);
    }
    if (s.cwd === '' && d.project) s.cwd = String(d.project);
    s.turns.push({ turn: s.turns.length + 1, prompt, response: '' });
    if (!s.title) s.title = cleanTitle(prompt);
  }
  const out = [...bySid.values()].map((s) => makeSession(s));
  return out.filter((s) => inWindow(s, win));
}

export function listSessions(cfg, win, args = {}) {
  const root = sessionRoot();
  const only = typeof args.session === 'string'
    ? new Set(String(args.session).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const exclude = cfg.excludeCwdPrefixes || [];
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { dirs = []; }
  for (const dir of dirs) {
    let files = [];
    try { files = readdirSync(join(root, dir.name)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const sid = f.replace(/\.jsonl$/, '');
      if (only && !only.has(sid)) continue;
      const s = parseSessionFile(join(root, dir.name, f), sid);
      if (!s) continue;
      if (cwdExcluded(s, exclude)) continue;
      if (!only && !inWindow(s, win)) continue;
      out.push(s);
    }
  }
  if (out.length) {
    out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
    return out;
  }
  // 无 jsonl → 回退 history.jsonl（只有 prompt、没有 assistant 回复）
  const fb = fromHistory(win, only).filter((s) => !cwdExcluded(s, exclude));
  if (fb.length && !notifiedHistory) {
    notifiedHistory = true;
    writeSync(2, `[claude] projects/ 下无会话 jsonl，回退读 history.jsonl（${fb.length} 条只有 prompt、无回复，`
      + `归档时会因 response 为空被判 trivial 跳过；若要完整归档，需 Claude Code 的原始会话文件）\n`);
  }
  return fb;
}
