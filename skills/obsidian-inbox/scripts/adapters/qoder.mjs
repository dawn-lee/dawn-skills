/**
 * qoder adapter —— Qoder-CN（VSCode 插件系）会话。
 *
 * 数据源：`$QODER_HOME/projects/<cwd编码>/<sessionId>.jsonl`
 *   默认 QODER_HOME = ~/.qoder-cn（Windows：同 %USERPROFILE%\.qoder-cn）
 *
 * jsonl 行类型（实测）：
 *   - workspace-directories / runtime-config / ai-title  → 元数据
 *   - type:user     + message{content} + cwd + timestamp + sessionId
 *   - type:assistant+ message{content[]} (text/thinking/tool_use blocks) + cwd + timestamp
 *
 * 抽法与 Claude Code 同构（Anthropic 风格 blocks）：只取 text block。
 * title 取 ai-title 行的 aiTitle，否则用首条 user 消息前 40 字。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { makeSession, textOf, toMs, inWindow, isNoisePrompt, cleanTitle } from './contract.mjs';

export const id = 'qoder';
export const label = 'Qoder';
export const sessionRoot = () => join(
  process.env.QODER_HOME || join(homedir(), '.qoder-cn'),
  'projects',
);

/** 目录名是 cwd 的"编码"：`/a/b c` → `-a-b-c`（非字母数字/连字符 → 连字符）。 */
export function decodeCwdDir(name) {
  if (!name) return '';
  let s = name;
  if (s.startsWith('-')) s = s.slice(1);
  // 常见误判：`-home-dawn-...` 的连字符还原
  return s;
}

function parseFile(path, sid) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  const turns = [];
  let title = '';
  let cwd = '';
  let createdAt = 0;
  let lastPromptAt = 0;
  let model = '';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd;
    if (d.type === 'runtime-config' && !model) model = d.model ?? '';
    if (d.type === 'ai-title' && !title) title = d.aiTitle ?? '';
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    const ts = toMs(d.timestamp);
    if (ts) { if (!createdAt) createdAt = ts; lastPromptAt = Math.max(lastPromptAt, ts); }
    const txt = textOf(d.message?.content ?? d.message);
    if (!txt || isNoisePrompt(txt)) continue;
    if (d.type === 'user') {
      turns.push({ turn: turns.length + 1, prompt: txt, response: '' });
      if (!title) title = cleanTitle(txt);
    } else if (turns.length) {
      // 归并到上一轮的 response（与 DSH turnOutline 的 {prompt,response} 形状对齐）
      const prev = turns[turns.length - 1];
      prev.response = prev.response ? `${prev.response}\n${txt}` : txt;
    }
  }
  if (!turns.length) return null;
  return makeSession({
    id: sid || path.replace(/\.jsonl$/, '').split('/').pop(),
    cwd, createdAt, lastPromptAt, title, model,
    turns,
    turnCount: turns.length,
  });
}

export function listSessions(cfg, win, args = {}) {
  const root = sessionRoot();
  if (!existsSync(root)) return [];
  const only = typeof args.session === 'string'
    ? new Set(String(args.session).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const exclude = cfg.excludeCwdPrefixes || [];
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  for (const dir of dirs) {
    let files = [];
    try {
      files = readdirSync(join(root, dir.name)).filter((f) => f.endsWith('.jsonl'));
    } catch { continue; }
    for (const f of files) {
      const sid = f.replace(/\.jsonl$/, '');
      if (only && !only.has(sid)) continue;
      const s = parseFile(join(root, dir.name, f), sid);
      if (!s) continue;
      if (exclude.some((p) => s.cwd.startsWith(p))) continue;
      if (!only && !inWindow(s, win)) continue;
      out.push(s);
    }
  }
  out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
  return out;
}
