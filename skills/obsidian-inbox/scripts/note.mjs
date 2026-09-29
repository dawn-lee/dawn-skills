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
 *   node scripts/note.mjs distill --path "dsh-sessions/x.md" --into "[[主题笔记]]" [--note 说明] [--json]
 *   node scripts/note.mjs recover --session <会话id> --into "[[主题笔记]]" [--min-len 300] [--limit 20] [--dry-run] [--json]
 *
 * 退出码：0 成功 / 2 用法错误 / 3 目标已存在（需 --append 或 --force） / 4 未找到
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  loadConfig, routeDir, slugify, buildFrontmatter, atomicWrite, readNote,
  searchNotes, findExistingByTitle, appendSection, vaultAbs, fmtTime, parseArgs,
  readBodyArg, normalizeRel, assertNoteDir, listSubdirs, catalogEntries, assertDirReady,
  markDistilled, listNoteIndex, parseFrontmatter, acquireLock, transcriptCodeBlocks,
} from './lib.mjs';

// 下游提前关管道（如 `| head -1`）时安静退出，不要抛 EPIPE 栈
process.stdout.on('error', (err) => { if (err?.code === 'EPIPE') process.exit(0); });

const USAGE = `用法：
  note.mjs new --title T [--dir D] [--mkdir] [--type TYPE] [--tags a,b] [--cwd P] [--session ID] [--date-prefix] [--append|--force] [--dry-run] [--body-file -] [--json]
  note.mjs append --path P [--section S] [--dry-run] [--body-file -] [--json]
  note.mjs search --query Q [--limit N] [--json]
  note.mjs show --path P [--json]
  note.mjs route --cwd P [--json]
  note.mjs distill --path "dsh-sessions/归档.md" --into "[[主题笔记]]" [--note 说明] [--json]
  note.mjs recover --session <会话id> --into "[[主题笔记]]" [--min-len 300] [--limit 20] [--dry-run] [--json]`;

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
  const handlers = {
    new: cmdNew, append: cmdAppend, search: cmdSearch, show: cmdShow, route: cmdRoute,
    distill: cmdDistill, recover: cmdRecover,
  };
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
  const dirSource = typeof args.dir === 'string' ? `--dir ${args.dir}` : '按 cwd 路由';
  const dirRel = assertNoteDir(
    cfg,
    routeDir(cfg, typeof args.cwd === 'string' ? args.cwd : process.cwd(), args.dir),
    dirSource,
  );
  assertDirReady(cfg, dirRel, { create: args.mkdir === true, source: dirSource });
  // 归档区由 sediment 自动维护，不接受手工新建（避免污染原始素材区）
  const archiveRoot = cfg.archiveDir ? normalizeRel(cfg.archiveDir) : '';
  if (archiveRoot && (dirRel === archiveRoot || dirRel.startsWith(`${archiveRoot}/`))) {
    fail(2, `归档区 ${archiveRoot}/ 由 sediment 自动维护，不放手工笔记（补归档用 ./run-sediment.sh --session <id>）；请写入 各领域目录`);
  }
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
  const dryRun = args['dry-run'] === true;

  if (exists && !(args.force === true)) {
    if (args.append === true) {
      if (!dryRun) appendSection(absPath, typeof args.section === 'string' ? args.section : null, body);
      const out = {
        ok: true, dryRun: dryRun || undefined, status: dryRun ? 'planned' : 'appended', path: relPath, absPath,
      };
      process.stdout.write(json
        ? `${JSON.stringify(out, null, 2)}\n`
        : `${dryRun ? '[dry-run] 将追加到 ' : ''}${relPath}${dryRun ? '' : '（已追加）'}\n`);
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
  if (!dryRun) atomicWrite(absPath, content);
  const out = {
    ok: true,
    dryRun: dryRun || undefined,
    status: dryRun ? 'planned' : (exists ? 'overwritten' : 'created'),
    path: relPath, absPath, title, tags, similar,
  };
  process.stdout.write(json
    ? `${JSON.stringify(out, null, 2)}\n`
    : `${dryRun ? '[dry-run] 将写入 ' : ''}${relPath}\n`);
}

function cmdAppend() {
  if (typeof args.path !== 'string') fail(2, 'append 需要 --path');
  const absPath = vaultAbs(cfg, args.path);
  if (!existsSync(absPath)) fail(4, `笔记不存在：${args.path}`);
  const body = readBodyArg(args).trim();
  if (!body) fail(2, 'append 需要正文（--body-file - 或 --body）');
  const dryRun = args['dry-run'] === true;
  if (!dryRun) appendSection(absPath, typeof args.section === 'string' ? args.section : null, body);
  const rel = relative(cfg.vault, absPath).split(sep).join('/');
  const out = { ok: true, dryRun: dryRun || undefined, status: dryRun ? 'planned' : 'appended', path: rel, absPath };
  process.stdout.write(json
    ? `${JSON.stringify(out, null, 2)}\n`
    : `${dryRun ? '[dry-run] 将追加到 ' : ''}${rel}${dryRun ? '' : '（已追加）'}\n`);
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
    process.stdout.write(`${JSON.stringify({ ok: true, path: args.path, fields: note.fields, body: note.body, bytes: statSync(absPath).size }, null, 2)}\n`);
    return;
  }
  process.stdout.write(note.raw);
}

function cmdDistill() {
  if (typeof args.path !== 'string') fail(2, 'distill 需要 --path（归档笔记）');
  const absPath = vaultAbs(cfg, args.path);
  if (!existsSync(absPath)) fail(4, `笔记不存在：${args.path}`);
  if (typeof args.into !== 'string' || !args.into.trim()) {
    fail(2, 'distill 需要 --into（提炼到的主题笔记，如 "[[输入法问题]]"）');
  }
  // 与归档进程互斥：sediment 可能正在读改写同一篇归档（不排队，拿不到立即失败）
  const release = acquireLock({ waitMs: 0 });
  if (!release) fail(2, '归档进程正在运行（锁被占用），稍后重试 distill');
  process.on('exit', () => release());
  let calibrated = null;
  let res;
  try {
    // domain 校准：归档 domain 应等于提炼目标所在目录（cwd 路由出的 domain 可能与知识落点不同）
    const intoName = args.into.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    const hit = listNoteIndex(cfg, 100000).find((p) => basename(p, '.md') === intoName);
    if (hit && !normalizeRel(hit).startsWith(`${cfg.archiveDir}/`)) {
      const targetDir = dirname(hit);
      const raw = readFileSync(absPath, 'utf8');
      const { fields } = parseFrontmatter(raw);
      if (fields.domain && fields.domain !== targetDir) {
        atomicWrite(absPath, raw.replace(/^domain:.*$/m, `domain: ${targetDir}`));
        calibrated = { from: fields.domain, to: targetDir };
      }
    }
    res = markDistilled(cfg, args.path, {
      into: args.into.trim(),
      note: typeof args.note === 'string' ? args.note : '',
    });
  } finally {
    release();
  }
  process.stdout.write(json
    ? `${JSON.stringify({ ok: true, ...res, ...(calibrated ? { calibrated } : {}) }, null, 2)}\n`
    : `${res.path} → 已标记提炼到 ${res.into}`
      + `${calibrated ? `\n  domain 校准：${calibrated.from} → ${calibrated.to}` : ''}\n`);
}

/**
 * recover —— 归档时被截断/丢失的代码块，从原始 transcript 回补到目标主题笔记。
 * 与 recover 前的老做法（一次性脚本）等价，但成为可复用命令。
 */
function cmdRecover() {
  if (typeof args.session !== 'string' || !args.session.trim()) fail(2, 'recover 需要 --session（DSH 会话 id）');
  if (typeof args.into !== 'string' || !args.into.trim()) {
    fail(2, 'recover 需要 --into（目标主题笔记，如 "[[内部工具开发笔记]]"）');
  }
  const sid = args.session.trim();
  const intoName = args.into.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
  const hit = listNoteIndex(cfg, 100000).find((p) => basename(p, '.md') === intoName);
  if (!hit) fail(4, `目标笔记不存在：${intoName}（recover 只往已存在的笔记里补）`);
  if (normalizeRel(hit).startsWith(`${cfg.archiveDir}/`)) {
    fail(2, `recover 的目标应是主题笔记，不是归档区笔记：${hit}`);
  }
  const absPath = vaultAbs(cfg, hit);
  const dryRun = args['dry-run'] === true;
  const minLen = Number(args['min-len']) > 0 ? Number(args['min-len']) : 300;
  const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;

  const blocks = transcriptCodeBlocks(sid, { minLen });
  if (blocks === null) fail(4, `找不到会话 ${sid} 的原始记录（transcript），无法回补`);
  const existing = readFileSync(absPath, 'utf8');
  const missing = blocks
    .filter((b) => !existing.includes(b.slice(0, Math.min(200, b.length))))
    .slice(0, limit);

  if (!missing.length) {
    const out = { ok: true, session: sid, target: hit, candidates: blocks.length, recovered: 0, dryRun: dryRun || undefined };
    process.stdout.write(json
      ? `${JSON.stringify(out, null, 2)}\n`
      : `无缺失代码块（原文 ${blocks.length} 块 ≥${minLen} 字，${hit} 已覆盖）\n`);
    return;
  }

  const release = acquireLock({ waitMs: 0 });
  if (!release) fail(2, '归档进程正在运行（锁被占用），稍后重试 recover');
  process.on('exit', () => release());
  try {
    if (!dryRun) {
      const body = [
        `> 由 \`recover\` 从原始会话 \`${sid}\` 回补：这些代码块在归档时被截断/丢失。`,
        '',
        ...missing.flatMap((b, i) => [`### ${i + 1}. 代码块（${b.length} 字）`, '', '```', b, '```', '']),
      ].join('\n');
      appendSection(absPath, '代码块回补', body);
    }
  } finally {
    release();
  }
  const bytes = missing.reduce((n, b) => n + b.length, 0);
  const out = {
    ok: true, session: sid, target: hit, candidates: blocks.length,
    recovered: missing.length, bytes, dryRun: dryRun || undefined,
  };
  process.stdout.write(json
    ? `${JSON.stringify(out, null, 2)}\n`
    : `${dryRun ? '[dry-run] ' : ''}${hit}：回补 ${missing.length}/${blocks.length} 个代码块（${bytes} 字）\n`);
}

function cmdRoute() {
  const dir = routeDir(cfg, typeof args.cwd === 'string' ? args.cwd : process.cwd(), args.dir);
  const isContainer = cfg.domainRoots.includes(dir);
  const exists = !dir || existsSync(join(cfg.vault, dir));
  const subdirs = listSubdirs(cfg, dir);
  const entries = catalogEntries(cfg, dir);
  const suggestions = entries.length ? entries.map((d) => `${dir}/${d}`) : subdirs;
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: true, dir, exists, isContainer, meaning: cfg.domainNotes[dir], subdirs,
      catalogEntries: entries.length ? entries : undefined, vault: cfg.vault,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${dir}\n`);
  if (cfg.domainNotes[dir]) process.stdout.write(`  ${cfg.domainNotes[dir]}\n`);
  if (isContainer) {
    process.stdout.write(`⚠ ${dir} 是容器，笔记必须落到下一级${suggestions.length ? `：${suggestions.join('、')}` : ''}\n`);
  } else if (!exists) {
    process.stdout.write('⚠ 该目录在知识库里还不存在：写入等于新建分类，需 --mkdir，先确认是否合适\n');
  }
}
