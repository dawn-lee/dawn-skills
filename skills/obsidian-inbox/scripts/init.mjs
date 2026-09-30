#!/usr/bin/env node
/**
 * init.mjs —— 为**本机**生成 obsidian-inbox 配置（config.json）。
 *
 * 技能本身不携带任何机器相关路径：换电脑后先跑一次本脚本，探测知识库与项目目录，
 * 生成一份全部用 `${HOME}` 占位的配置，再把调度器装上（见 scripts/install.mjs）。
 *
 * 用法：
 *   node scripts/init.mjs                          # 探测知识库 + simple 预设（默认）
 *   node scripts/init.mjs --vault <知识库路径>      # <...> 是占位符，换成你的真实路径（三平台都行）
 *   node scripts/init.mjs --preset projects        # 镜像 ~/Documents/projects/<容器>/<项目>
 *   node scripts/init.mjs --preset projects --projects-root <项目根路径> --containers work,personal
 *   node scripts/init.mjs --preset projects --soft personal   # personal 允许 --mkdir 新主题目录
 *   node scripts/init.mjs --print                  # 只打印 JSON，不落盘
 *   node scripts/init.mjs --out /tmp/c.json --force
 *
 * 退出码：0 成功 / 2 用法错误 / 3 配置已存在（需 --force） / 4 探测不到知识库
 */
import { existsSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_CONFIG_PATH, SKILL_DIR, atomicWrite, expandHome, expandVars, parseArgs } from './lib.mjs';

const USAGE = `用法：
  init.mjs [--vault PATH] [--preset simple|projects] [--projects-root PATH]
           [--containers a,b,c] [--default-dir D] [--soft a,b]
           [--from-config PATH] [--out PATH] [--force] [--print] [--no-mkdir] [--json]

  --from-config 迁移旧机器的配置：把写死的家目录改写成 \${HOME} 占位，其余字段原样保留`;

const args = parseArgs(process.argv.slice(2));
const json = args.json === true;
const HOME = homedir();

function fail(code, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...extra }, null, 2)}\n`);
  process.exit(code);
}

/** 绝对路径 → 配置里的可分发写法（家目录内用 `${HOME}`，统一 `/` 分隔）。 */
function homeRelative(p) {
  const abs = resolve(expandHome(String(p))).replace(/\\/g, '/');
  const home = HOME.replace(/\\/g, '/').replace(/\/+$/, '');
  if (abs === home) return '${HOME}';
  if (abs.startsWith(`${home}/`)) return `\${HOME}/${abs.slice(home.length + 1)}`;
  return abs;
}

/**
 * 路由正则里的项目根前缀：家目录内写 `${HOME}/...`（由 expandRoutePattern 负责转义），
 * 家目录外写转义后的绝对路径（正则元字符会被转义）。
 */
function projectPrefixPattern(p) {
  const rel = homeRelative(p).replace(/\/+$/, '');
  if (rel.startsWith('${HOME}')) return rel;
  return rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitList(v) {
  if (v === undefined || v === true) return [];
  return String(v).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

function detectVault() {
  const docs = join(HOME, 'Documents');
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
  const bases = [
    HOME,
    docs,
    join(HOME, 'OneDrive', 'Documents'),
    oneDrive ? join(oneDrive, 'Documents') : null,
  ].filter(Boolean);
  const names = [
    'Obsidian Vault', 'Obsidian', 'ObsidianVault', 'vault', 'Vault',
    '知识库', 'notes', 'Notes', 'notes-vault', 'My Vault', 'obsidian',
  ];
  const all = [];
  if (process.env.OBSIDIAN_VAULT) all.push(expandHome(process.env.OBSIDIAN_VAULT));
  for (const b of bases) for (const n of names) all.push(join(b, n));
  // 再扫一层：任何直接含 .obsidian 的子目录，命中率最高
  for (const b of [docs, HOME]) {
    try {
      for (const e of readdirSync(b, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        all.push(join(b, e.name));
      }
    } catch { /* 目录不存在 */ }
  }
  const uniq = [...new Set(all)];
  const hit = uniq.find((p) => existsSync(join(p, '.obsidian')))
    ?? uniq.find((p) => existsSync(p));
  return { hit: hit ?? null, candidates: uniq.slice(0, 12) };
}

/** 项目根下按目录名当作"容器"（每个容器对应知识库里一个同名顶层目录）。 */
function detectContainers(projectsRoot) {
  try {
    return readdirSync(projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function buildConfig({ preset, vaultRel, projectsRoot, containers, soft, defaultDir }) {
  const base = {
    vault: vaultRel,
    archiveDir: 'sessions',
    minAssistantChars: 300,
    digestBudgetChars: 24000,
    searchExclude: ['.obsidian', '.trash', '.smart-env', '.git', 'copilot/copilot-conversations'],
    // 这两个目录是技能自身的状态/源码位置，归档时排除，避免自我归档
    excludeCwdPrefixes: ['${HOME}/.local/state/obsidian-inbox', '${HOME}/.agents/skills/obsidian-inbox'],
    llm: { command: null, patch: null, timeoutMs: 600000, extraArgs: [] },
  };

  if (preset === 'projects' && containers.length) {
    const prefix = projectPrefixPattern(projectsRoot);
    const projLabel = homeRelative(projectsRoot).replace(/\/+$/, '');
    const softSet = new Set(soft);
    const domainNotes = {};
    const catalogSources = {};
    for (const c of containers) {
      domainNotes[c] = `项目容器（镜像 ${projLabel}/${c}/ 下的项目）`;
      catalogSources[c] = `${prefix}/${c}`;
    }
    const routes = [];
    for (const c of containers) {
      routes.push({ pattern: `^${prefix}/${c}/([^/]+)(/|$)`, dir: `${c}/{1}` });
    }
    routes.push({ pattern: `^${prefix}/([^/]+)(/|$)`, dir: '{1}' });
    routes.push({ pattern: `^${prefix}(/|$)`, dir: defaultDir });
    routes.push({ pattern: '.*', dir: defaultDir });
    return {
      ...base,
      domainRoots: containers,
      domainNotes,
      catalogSources,
      // 严格容器：第二级必须对应真实项目目录；--soft 的容器改用 --mkdir 建主题目录
      strictCatalog: containers.filter((c) => !softSet.has(c)),
      routes,
      defaultDir,
    };
  }

  return {
    ...base,
    domainRoots: [],
    domainNotes: { notes: '默认落位目录；按主题自由建子目录（新建用 --mkdir）' },
    catalogSources: {},
    strictCatalog: [],
    routes: [{ pattern: '.*', dir: defaultDir }],
    defaultDir,
  };
}

/**
 * 家目录字符串 → `${HOME}` 占位，用于**正则文本**（路由 pattern）。
 * 这里绝不能走 resolve()：pattern 是正则不是路径，`^...` 会被当成相对路径拼上 cwd。
 * 同时兼容三种写法：`/` 分隔、Windows 原样、Windows 正则里双写的反斜杠。
 */
function toHomeToken(s) {
  const homePosix = HOME.replace(/\\/g, '/').replace(/\/+$/, '');
  const variants = [...new Set([
    homePosix,
    HOME.replace(/\/+$/, ''),
    HOME.replace(/\\/g, '\\\\').replace(/\/+$/, ''),
  ].filter(Boolean))];
  let out = String(s);
  for (const v of variants) out = out.split(v).join('${HOME}');
  return out;
}

/**
 * 迁移已有配置：把写死的家目录改写成 `${HOME}` 占位，其余字段原样保留。
 * 换到自己的第二台机器时最省事：把旧 config.json 带过去，跑
 * `init.mjs --from-config <旧配置文件路径> --force` 即可继续用同一套目录体系。
 * 只改写确实含路径的字段（vault / catalogSources / routes / excludeCwdPrefixes），
 * domainNotes 是说明文字，不动。
 */
function migrateConfig(raw) {
  const out = { ...raw };
  if (typeof out.vault === 'string') out.vault = homeRelative(out.vault);
  if (Array.isArray(out.excludeCwdPrefixes)) {
    out.excludeCwdPrefixes = out.excludeCwdPrefixes.map((p) => homeRelative(p));
  }
  if (out.catalogSources && typeof out.catalogSources === 'object') {
    out.catalogSources = Object.fromEntries(
      Object.entries(out.catalogSources).map(([k, v]) => [k, typeof v === 'string' ? homeRelative(v) : v]),
    );
  }
  if (Array.isArray(out.routes)) {
    out.routes = out.routes.map((r) => (
      r && typeof r.pattern === 'string' ? { ...r, pattern: toHomeToken(r.pattern) } : r
    ));
  }
  return out;
}

// ------------------------------------------------------------------ 主流程

const preset = typeof args.preset === 'string' ? args.preset : 'simple';
if (!['simple', 'projects'].includes(preset)) fail(2, `未知 --preset：${preset}（支持 simple / projects）`);

const outPath = resolve(expandHome(typeof args.out === 'string' ? args.out : DEFAULT_CONFIG_PATH));
if (existsSync(outPath) && args.force !== true && args.print !== true) {
  fail(3, `配置已存在：${outPath}（要覆盖加 --force；想先看内容用 --print）`, { path: outPath });
}

let cfg;
let migratedFrom = null;
if (typeof args['from-config'] === 'string') {
  const src = resolve(expandHome(args['from-config']));
  if (!existsSync(src)) fail(4, `--from-config 指向的配置不存在：${src}`);
  let raw;
  try { raw = JSON.parse(readFileSync(src, 'utf8')); } catch (err) { fail(2, `配置不是合法 JSON：${err.message}`); }
  cfg = migrateConfig(raw);
  migratedFrom = src;
} else {
  let vaultAbs;
  if (typeof args.vault === 'string') {
    vaultAbs = resolve(expandHome(args.vault));
    if (!existsSync(vaultAbs)) {
      fail(4, `--vault 指向的目录不存在：${vaultAbs}`, { hint: '请确认知识库路径，或用 Obsidian 新建一个库' });
    }
  } else {
    const { hit, candidates } = detectVault();
    if (!hit) {
      fail(4, '探测不到知识库：请用 --vault 指定（Obsidian 库 = 含 .obsidian/ 的目录）', { candidates });
    }
    vaultAbs = resolve(hit);
  }

  const projectsRoot = resolve(expandHome(
    typeof args['projects-root'] === 'string'
      ? args['projects-root']
      : join(HOME, 'Documents', 'projects'),
  ));
  let containers = splitList(args.containers);
  if (preset === 'projects' && !containers.length) containers = detectContainers(projectsRoot);
  if (preset === 'projects' && !containers.length) {
    fail(2, `在 ${projectsRoot} 下没找到项目容器目录；用 --containers a,b,c 指定，或 --projects-root 换个位置`);
  }
  const soft = splitList(args.soft);
  const defaultDir = typeof args['default-dir'] === 'string'
    ? args['default-dir']
    : (preset === 'projects' ? containers[0] : 'notes');

  cfg = buildConfig({
    preset,
    vaultRel: homeRelative(vaultAbs),
    projectsRoot,
    containers,
    soft,
    defaultDir,
  });
}
const text = `${JSON.stringify(cfg, null, 2)}\n`;

if (args.print === true) {
  process.stdout.write(text);
  process.exit(0);
}

// 建目录：默认落位目录 + 各容器（知识库里必须先有目录，否则写入会被拦）
// 注意用 expandVars：配置里的 vault 可能是 `${HOME}/...` 占位
const vaultAbs = resolve(expandVars(cfg.vault));
if (!existsSync(vaultAbs)) {
  fail(4, `配置里的知识库不存在：${vaultAbs}`, { configPath: outPath, hint: '检查 vault 路径，或换用 --vault 重新生成' });
}
const created = [];
if (args['no-mkdir'] !== true) {
  for (const rel of [...new Set([cfg.defaultDir, ...cfg.domainRoots].filter(Boolean))]) {
    const abs = join(vaultAbs, rel);
    if (existsSync(abs)) continue;
    mkdirSync(abs, { recursive: true });
    created.push(rel);
  }
}
// config.json 与 vault 分处两地，先确保配置目录存在
mkdirSync(dirname(outPath), { recursive: true });
atomicWrite(outPath, text);

const out = {
  ok: true,
  configPath: outPath,
  vault: vaultAbs,
  preset: migratedFrom ? 'from-config' : preset,
  migratedFrom: migratedFrom || undefined,
  domainRoots: cfg.domainRoots,
  strictCatalog: cfg.strictCatalog,
  defaultDir: cfg.defaultDir,
  createdDirs: created,
  next: [
    `node ${join(SKILL_DIR, 'scripts', 'install.mjs')}        # 接入技能目录并注册每日归档`,
    '首次使用前确认 patch/headless-notes-only.yml 里的模型与密钥环境变量与你的 DSH 一致',
  ],
};
process.stdout.write(json ? `${JSON.stringify(out, null, 2)}\n` : formatOut(out));

function formatOut(o) {
  const lines = [
    `配置已写入：${o.configPath}`,
    `知识库：${o.vault}`,
    `预设：${o.preset}${o.domainRoots.length ? `（容器：${o.domainRoots.join('、')}）` : ''}`,
    `默认落位：${o.defaultDir}${o.createdDirs.length ? `；新建目录：${o.createdDirs.join('、')}` : ''}`,
  ];
  if (o.strictCatalog.length) {
    lines.push(`严格容器（第二级须对应真实目录）：${o.strictCatalog.join('、')}`);
  }
  lines.push('', '下一步：');
  for (const n of o.next) lines.push(`  ${n}`);
  return `${lines.join('\n')}\n`;
}
