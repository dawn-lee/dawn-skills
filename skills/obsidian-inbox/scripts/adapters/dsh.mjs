/**
 * dsh adapter —— 默认 adapter，抽取自 sediment.mjs 原有的 collectSessions/normalizeSession，
 * 行为与重构前**完全一致**（这是回归基准）。
 *
 * 数据源：
 *   - 投影缓存：$DSH_HOME/storages/session_projcache/sessions/session-*.json（含 turnOutline）
 *   - 原始 transcript：$DSH_HOME/sessions/<slug>/<sid>/*.jsonl.zstd（投影缺失时回退）
 *
 * @param {object} cfg
 * @param {{from:number,to:number}} win 时间窗（含 --session 时忽略窗口，与原逻辑一致）
 * @param {{session?:string, force?:boolean}} args
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dshProjcacheRoot, dshSessionsRoot } from '../lib.mjs';
import { makeSession, toMs, inWindow } from './contract.mjs';

export const id = 'dsh';
export const label = 'DSH';
export const sessionRoot = () => dshProjcacheRoot();

function normalize(file, j) {
  const rec = j?.record ?? {};
  const rows = rec.rows ?? {};
  const v = (k) => rows[k]?.val;
  const identity = rec.identity ?? {};
  const md = v('sessionListMetadata') ?? {};
  const stats = v('sessionStats') ?? {};
  const outline = v('turnOutline') ?? {};
  const turns = Array.isArray(outline.turns) ? outline.turns : [];
  return makeSession({
    // id 必须与状态账本/归档 frontmatter 的会话标识一致，即**保留 `session-` 前缀**
    // （原 normalizeSession 用 basename(file,'.json')）。曾误剥前缀，导致 84 个已归档
    // 会话的 id 与 archived.json 的键全部对不上 → 会被当新会话重复归档。
    id: file.replace(/\.json$/, ''),
    cwd: identity.cwd ?? '',
    createdAt: toMs(identity.createdAt),
    lastPromptAt: toMs(md.lastPromptAt || identity.createdAt),
    blank: md.blank === true,
    title: typeof v('title') === 'string' ? v('title') : '',
    model: v('modelSelection')?.lastUsed?.model ?? '',
    turns: turns.map((t) => ({
      turn: t.turn,
      prompt: t.prompt ?? '',
      response: t.response ?? '',
    })),
    turnCount: Number(stats.lastTurn) || turns.length,
  });
}

/**
 * 列出时间窗内的会话（含 --session 指定的）。返回统一 session 数组。
 * 原始逻辑：投影缓存里读 turnOutline；缺投影的老会话由归档端回退 transcript。
 */
export function listSessions(cfg, win, args = {}) {
  const dir = sessionRoot();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith('session-') && f.endsWith('.json'));
  } catch {
    return [];
  }
  const only = typeof args.session === 'string'
    ? new Set(String(args.session).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const exclude = cfg.excludeCwdPrefixes || [];
  const out = [];
  for (const f of files) {
    let j;
    try { j = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    const s = normalize(f, j);
    if (only && !only.has(s.id)) continue;
    if (exclude.some((p) => s.cwd.startsWith(p))) continue;
    if (!only && !inWindow(s, win)) continue;
    out.push(s);
  }
  out.sort((a, b) => a.lastPromptAt - b.lastPromptAt);
  return out;
}

/**
 * 供归档端回退：定位某会话的原始 transcript（zstd）。
 * 文件名可能是 session.jsonl.zstd 或带版本的 session.v3/v4.jsonl.zstd，取最新。
 */
export function findTranscriptPath(sid) {
  const root = dshSessionsRoot();
  try {
    for (const slug of readdirSync(root)) {
      const dir = join(root, slug, sid);
      let cands = [];
      try { cands = readdirSync(dir).filter((f) => f.endsWith('.jsonl.zstd')); } catch { continue; }
      if (!cands.length) continue;
      let best = null, bestM = -1;
      for (const f of cands) {
        let m = -1;
        try { m = statSync(join(dir, f)).mtimeMs; } catch { /* 读不到就跳过 */ }
        if (m > bestM) { best = f; bestM = m; }
      }
      if (best) return join(dir, best);
    }
  } catch { /* 没有 sessions 目录 */ }
  return null;
}

export function hasTranscript() {
  return existsSync(dshSessionsRoot());
}
