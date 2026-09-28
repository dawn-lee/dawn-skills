#!/usr/bin/env node
/**
 * note.mjs —— obsidian-inbox 的写入/检索通道。
 *
 *   node scripts/note.mjs new    --title T [--dir dawn/pop] [--type howto] [--tags a,b]
 *                                [--cwd P] [--session ID] [--project P] [--date-prefix]
 *                                [--body-file -] [--append] [--force] [--dry-run] [--json]
 *   node scripts/note.mjs append --path "dawn/x.md" [--section 更新] [--body-file -] [--json]
 *   node scripts/note.mjs search --query "关键词" [--limit 10] [--json]
 *   node scripts/note.mjs show   --path "dawn/x.md" [--json]
 *   node scripts/note.mjs route  --cwd /abs/path [--json]
 *
 * 退出码：0 成功 / 2 用法错误 / 3 目标已存在（需 --append 或 --force） / 4 未找到
 */
import { existsSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import {
  loadConfig, routeDir, slugify, buildFrontmatter, atomicWrite, readNote,
  searchNotes, findExistingByTitle, appendSection, vaultAbs, fmtTime, parseArgs,
  readBodyArg, normalizeRel, assertNoteDir, listSubdirs,
} from './lib.mjs';

// 下游提前关管道（如 `| head -1`）时安静退出，不要抛 EPIPE 栈
process.stdout.on('error', (err) => { if (err?.code === 'EPIPE') process.exit(0); });

const USAGE = `用法：
  note.mjs new --title T [--dir D] [--type TYPE] [--tags a,b] [--cwd P] [--session ID] [--date-prefix] [--append|--force] [--body-file -] [--json]
  note.mjs append --path P [--section S] [--body-file -] [--json]
  note.mjs search --query Q [--limit N] [--json]
  note.mjs show --path P [--json]
  note.mjs route --cwd P [--json]`;

function fail(code, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...extra }, null, 2)}\n`);
  process.exit(code);
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitList(v) {
  if (v === undefined || v === true) return [];
  return String(v).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const json = args.json === true;
const cfg = loadConfig();

try {
  if (!cmd) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  const handlers = { new: cmdNew, append: cmdAppend, search: cmdSearch, show: cmdShow, route: cmdRoute };
  const handler = handlers[cmd];
  if (!handler) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(2);
  }
  handler();
} catch (err) {
  fail(2, `执行失败：${err?.message ?? err}`);
}

function cmdNew() {
  if (typeof args.title !== 'string' || !args.title.trim()) fail(2, 'new 需要 --title');
  const title = args.title.trim();
  const slug = slugify(title);
  const dirRel = assertNoteDir(
    cfg,
    routeDir(cfg, typeof args.cwd === 'string' ? args.cwd : process.cwd(), args.dir),
    typeof args.dir === 'string' ? `--dir ${args.dir}` : '按 cwd 路由',
  );
  const prefix = args['date-prefix'] === true ? `${todayStr()} ` : '';
  const relPath = normalizeRel([dirRel, `${prefix}${slug}.md`].filter(Boolean).join('/'));
  const absPath = vaultAbs(cfg, relPath);

  const body = readBodyArg(args).trim();
  const tags = splitList(args.tags);
  const type = typeof args.type === 'string' ? args.type : 'note';
  const session = typeof args.session === 'string' ? args.session : '';
  const cwd = typeof args.cwd === 'string' ? args.cwd : process.cwd();
  const project = typeof args.project === 'string' ? args.project : (cwd ? basename(cwd) : '');

  const similar = findExistingByTitle(cfg, slug).filter((p) => p !== relPath);
  const exists = existsSync(absPath);

  if (exists && !(args.force === true)) {
    if (args.append === true) {
      appendSection(absPath, typeof args.section === 'string' ? args.section : null, body);
      const out = { ok: true, status: 'appended', path: relPath, absPath };
      process.stdout.write(json ? `${JSON.stringify(out, null, 2)}\n` : `${relPath}（已追加）\n`);
      return;
    }
    fail(3, '目标笔记已存在，改用 append 或加 --force', { path: relPath, absPath, similar });
  }

  const fm = buildFrontmatter({
    type,
    source: args.source ?? 'dsh',
    session: session || undefined,
    project: project || undefined,
    cwd: cwd || undefined,
    date: todayStr(),
    updated: fmtTime(Date.now()),
    tags: tags.length ? tags : undefined,
  });
  const content = `${fm}\n\n# ${title}\n\n${body}\n`;
  atomicWrite(absPath, content);
  const out = { ok: true, status: exists ? 'overwritten' : 'created', path: relPath, absPath, title, tags, similar };
  process.stdout.write(json ? `${JSON.stringify(out, null, 2)}\n` : `${relPath}\n`);
}

function cmdAppend() {
  if (typeof args.path !== 'string') fail(2, 'append 需要 --path');
  const absPath = vaultAbs(cfg, args.path);
  if (!existsSync(absPath)) fail(4, `笔记不存在：${args.path}`);
  const body = readBodyArg(args).trim();
  if (!body) fail(2, 'append 需要正文（--body-file - 或 --body）');
  appendSection(absPath, typeof args.section === 'string' ? args.section : null, body);
  const rel = relative(cfg.vault, absPath).split(sep).join('/');
  process.stdout.write(json ? `${JSON.stringify({ ok: true, status: 'appended', path: rel, absPath }, null, 2)}\n` : `${rel}（已追加）\n`);
}

function cmdSearch() {
  const q = typeof args.query === 'string' ? args.query : args._.slice(1).join(' ');
  if (!q.trim()) fail(2, 'search 需要 --query');
  const limit = Number(args.limit) > 0 ? Number(args.limit) : 10;
  const hits = searchNotes(cfg, q, limit);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, query: q, count: hits.length, results: hits }, null, 2)}\n`);
    return;
  }
  if (!hits.length) { process.stdout.write('（无匹配）\n'); return; }
  for (const h of hits) {
    process.stdout.write(`- [${h.score}] ${h.path}\n    ${h.snippet}\n`);
  }
}

function cmdShow() {
  if (typeof args.path !== 'string') fail(2, 'show 需要 --path');
  const absPath = vaultAbs(cfg, args.path);
  if (!existsSync(absPath)) fail(4, `笔记不存在：${args.path}`);
  const note = readNote(absPath);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, path: args.path, fields: note.fields, bytes: statSync(absPath).size }, null, 2)}\n`);
    return;
  }
  process.stdout.write(note.raw);
}

function cmdRoute() {
  const dir = routeDir(cfg, typeof args.cwd === 'string' ? args.cwd : process.cwd(), args.dir);
  const isContainer = cfg.domainRoots.includes(dir);
  const subdirs = listSubdirs(cfg, dir);
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: true, dir, isContainer, meaning: cfg.domainNotes[dir], subdirs, vault: cfg.vault,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${dir}\n`);
  if (isContainer) {
    process.stdout.write(`⚠ ${dir} 是领域容器，笔记必须放下一级子目录${subdirs.length ? `：${subdirs.join('、')}` : ''}\n`);
  }
}
