/**
 * obsidian-inbox 共享库：vault 路由、frontmatter、原子写入、检索、追加。
 *
 * 约定：
 * - 所有写入都走 atomicWrite（同目录 tmp + rename），避免半截文件被 Obsidian 索引。
 * - 只写 .md，且从不触碰 .obsidian / .trash / .smart-env。
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync,
  renameSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, relative, basename, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 技能目录下的默认配置位置（本机私有，不随仓库分发，见 .gitignore）。 */
export const DEFAULT_CONFIG_PATH = join(SKILL_DIR, 'config.json');
/**
 * 运行期状态（归档账本、日志、headless 工作目录）**不放在技能源码里**，
 * 避免技能以软链方式接入 ~/.agents/skills 时把状态写进 git 工作区。
 * 默认按平台约定取（可用 OBSIDIAN_INBOX_STATE 覆盖）：
 *   - Windows：%LOCALAPPDATA%\obsidian-inbox
 *   - 其他：$XDG_STATE_HOME/obsidian-inbox（缺省 ~/.local/state/obsidian-inbox）
 */
function defaultStateBase() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  }
  return process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
}

export const STATE_DIR = process.env.OBSIDIAN_INBOX_STATE
  ? resolve(process.env.OBSIDIAN_INBOX_STATE)
  : join(defaultStateBase(), 'obsidian-inbox');

/**
 * 共享配置的默认位置（跨机同步/只读安装时用；OBSIDIAN_INBOX_CONFIG 优先）：
 *   - Windows：%APPDATA%\obsidian-inbox\config.json
 *   - 其他：$XDG_CONFIG_HOME/obsidian-inbox/config.json（缺省 ~/.config/...）
 */
function defaultConfigPath() {
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
  return join(base, 'obsidian-inbox', 'config.json');
}

/**
 * 配置查找顺序（第一个存在的生效）：
 *   1. `$OBSIDIAN_INBOX_CONFIG` —— 显式指定；设了就**只认它**（找不到直接报错，不静默回退）
 *   2. `<技能目录>/config.json` —— 默认，本机私有
 *   3. 平台共享配置位置（见上）
 * 三者都不存在时，报错会提示运行 `scripts/init.mjs` 生成。
 */
export function configCandidates() {
  const explicit = process.env.OBSIDIAN_INBOX_CONFIG;
  return explicit
    ? [resolve(expandHome(explicit))]
    : [DEFAULT_CONFIG_PATH, defaultConfigPath()];
}

export function resolveConfigPath() {
  const list = configCandidates();
  for (const p of list) if (existsSync(p)) return p;
  return list[0];
}

/** 当前进程实际使用的配置路径（导入时解析一次）。 */
export const CONFIG_PATH = resolveConfigPath();

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * 展开配置里的 `${HOME}` / `$HOME`（再兼容 `~`）。
 * 配置文件里**不要写死家目录**，否则换机器/换用户名必然失效。
 */
export function expandVars(p) {
  if (typeof p !== 'string') return p;
  return expandHome(p.replace(/\$\{HOME\}|\$HOME/g, homedir().replace(/\\/g, '/')));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 展开路由正则里的 `${HOME}`：只替换占位符本身、并把带入的家目录**转义**，
 * 其余部分仍是用户书写的正则（`([^/]+)` 这类捕获组必须保持原样，不能整体转义）。
 * 路径统一成 `/` 分隔，兼容 Windows。
 */
export function expandRoutePattern(pattern) {
  return String(pattern ?? '').replace(
    /\$\{HOME\}|\$HOME/g,
    escapeRegExp(homedir().replace(/\\/g, '/')),
  );
}

function missingConfigError() {
  const list = configCandidates().map((p) => `  - ${p}`).join('\n');
  return new Error(
    '找不到配置文件。请先运行一次初始化生成本机配置：\n'
    + `  node ${join(SKILL_DIR, 'scripts', 'init.mjs')}\n`
    + '或设置 OBSIDIAN_INBOX_CONFIG 指向已有配置。已查找：\n'
    + list,
  );
}

export function loadConfig() {
  const path = resolveConfigPath();
  if (!existsSync(path)) throw missingConfigError();
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`配置文件不是合法 JSON：${path}（${err?.message ?? err}）`);
  }
  const cfg = { ...raw, configPath: path };
  if (typeof cfg.vault !== 'string' || !cfg.vault.trim()) {
    throw new Error(`配置缺少 vault（知识库根目录）：${path}`);
  }
  cfg.vault = resolve(expandVars(cfg.vault));
  cfg.defaultDir = normalizeRel(cfg.defaultDir ?? '');
  cfg.archiveDir = cfg.archiveDir ?? 'dsh-sessions';
  cfg.routes = (Array.isArray(raw.routes) ? raw.routes : [])
    .filter((r) => r && typeof r.pattern === 'string')
    .map((r) => ({
      ...r,
      pattern: expandRoutePattern(r.pattern),
      dir: expandVars(String(r.dir ?? '')),
    }));
  cfg.searchExclude = cfg.searchExclude || ['.obsidian', '.trash', '.smart-env', '.git'];
  // 统一成 `/` 分隔的绝对路径，跨平台与 cwd 前缀比较时不受分隔符影响
  cfg.excludeCwdPrefixes = (cfg.excludeCwdPrefixes || [])
    .map((p) => resolve(expandVars(String(p))).replace(/\\/g, '/'));
  cfg.domainRoots = (cfg.domainRoots || []).map((r) => normalizeRel(r)).filter(Boolean);
  // 严格容器清单完全由配置决定；缺省为空（"第二级必须对应真实目录"是可选约束）
  cfg.strictCatalog = Array.isArray(cfg.strictCatalog) ? cfg.strictCatalog.map(normalizeRel) : [];
  cfg.domainNotes = cfg.domainNotes || {};
  cfg.catalogSources = Object.fromEntries(
    Object.entries(cfg.catalogSources || {}).map(([k, v]) => [
      normalizeRel(k),
      resolve(expandVars(String(v))),
    ]),
  );
  if (!existsSync(cfg.vault)) throw new Error(`vault 不存在：${cfg.vault}（配置：${path}）`);
  return cfg;
}

export function normalizeRel(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
}

export function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function vaultRoot(cfg) {
  // 必须归一成 / 再比较：Windows 上 resolve() 产出反斜杠，而被比较的路径一律是
  // 正斜杠形式（toVaultRel/sanitizeBodyLinks 都做过 replace(/\\/g,'/')），
  // 不归一的话"库内绝对路径"会被误判成库外（实际踩过：P1-2 自检用例）
  return String(cfg.vault).replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 把路径解析成 vault 相对路径。
 *
 * 关键防护：以 vault 根开头的绝对路径会被**转成相对路径**。这是本技能最容易踩的坑——
 * Obsidian 把 Markdown 链接里以 `/` 开头的目标当成**库内相对路径**，一旦把
 * `~/Documents/Obsidian Vault/dawn/pop/x.md` 原样写进去，点击会在库里
 * 建出 `<库根>~/...` 的嵌套空文件。写入侧同样不能把绝对路径当相对路径拼。
 *
 * @param allowOutside 库外绝对路径时返回 null 而不是抛错。
 */
export function toVaultRel(cfg, p, { allowOutside = false } = {}) {
  const raw = String(p ?? '').trim();
  if (!raw) return '';
  const decoded = safeDecode(raw).replace(/^file:\/\//, '');
  if (decoded.startsWith('/') || /^[A-Za-z]:[\\/]/.test(decoded)) {
    const normalized = decoded.replace(/\\/g, '/');
    const root = vaultRoot(cfg);
    if (normalized === root) return '';
    if (normalized.startsWith(`${root}/`)) return normalizeRel(normalized.slice(root.length + 1));
    if (allowOutside) return null;
    throw new Error(`路径不在知识库内：${raw}（知识库为 ${root}）`);
  }
  return normalizeRel(decoded);
}

/** 显式 --dir > cwd 正则路由 > defaultDir；返回 vault 相对目录（可能是 ''）。
 *  路由的 dir 支持 `{1}`、`{2}` 占位，取正则捕获组（用于 `work/<域>` 这类动态落位）。 */
export function routeDir(cfg, cwd, explicitDir) {
  if (explicitDir && explicitDir !== true) return toVaultRel(cfg, explicitDir);
  // 统一 `/` 分隔再匹配：Windows 的 cwd 可能是 `C:\x`，配置里的 `${HOME}` 已归一为 `/`
  const c = cwd ? resolve(expandVars(String(cwd))).replace(/\\/g, '/') : '';
  for (const r of cfg.routes) {
    let re;
    try { re = new RegExp(r.pattern); } catch { continue; }
    const m = c ? re.exec(c) : null;
    if (!m) continue;
    return normalizeRel(String(r.dir ?? '').replace(/\{(\d+)\}/g, (_, i) => m[Number(i)] ?? ''));
  }
  return normalizeRel(cfg.defaultDir);
}

/**
 * 某容器的既定分类清单：直接读 catalogSources 里配置的目录，不写死，新增项自动生效。
 * 例：`work` → projects/work 下的业务域；`opensource` → projects/opensource 下的仓库名。
 */
export function catalogEntries(cfg, domain) {
  const src = (cfg.catalogSources ?? {})[domain];
  if (!src) return [];
  try {
    return readdirSync(expandHome(src), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** 判断 rel 是否是"既定分类"：每一级都命中上一级 catalogSources 里的真实子目录。 */
function isKnownNested(cfg, rel) {
  const parts = normalizeRel(rel).split('/').filter(Boolean);
  if (parts.length < 2) return false;
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    const entries = catalogEntries(cfg, parent);
    if (!entries.length) return false;
    if (!entries.includes(parts[i])) return false;
  }
  return true;
}

/** domainNotes 登记的主题目录（直接子级）：dawn/pop、dawn/知识库 这类不镜像 projects/ 的目录。 */
function themeDirs(cfg, parent) {
  return Object.keys(cfg.domainNotes ?? {})
    .filter((k) => k.startsWith(`${parent}/`) && !k.slice(parent.length + 1).includes('/'))
    .map((k) => k.slice(parent.length + 1));
}

function assertKnownCatalogEntry(cfg, rel, source) {
  const parts = normalizeRel(rel).split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    const child = parts[i];
    const entries = catalogEntries(cfg, parent);
    if (!entries.length) continue; // 父级无清单（如 dawn 下的自由子目录），不校验
    if (entries.includes(child)) continue;
    // 主题目录与项目清单并存（dawn/pop、dawn/知识库 不在 projects/dawn 下），domainNotes 已登记则放行
    if ((cfg.domainNotes ?? {})[`${parent}/${child}`]) continue;
    const label = `${parent} 的直接子项`;
    const sanctioned = [...new Set([...entries, ...themeDirs(cfg, parent)])].sort();
    throw new Error(
      `${parent}/${child} 不是已知的${label}（来源：${source}）；`
      + `现有：${sanctioned.map((e) => `${parent}/${e}`).join('、')}`,
    );
  }
}

/** 列出某目录下已有的子目录（报错提示与路由展示用）。 */
export function listSubdirs(cfg, relDir) {
  const abs = join(cfg.vault, normalizeRel(relDir));
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => `${normalizeRel(relDir)}/${e.name}`)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 容器根（dawn / work / opensource）只作容器，笔记必须落到下一级：
 * - `dawn` 下按主题建子目录；
 * - `work` 下第二级必须是真实存在的业务域；
 * - `opensource` 下第二级必须是真实存在的开源仓库名。
 * 直接往容器根写，领域目录会被零散笔记淹没，也没法按主题检索。
 */
export function assertNoteDir(cfg, relDir, source) {
  const rel = normalizeRel(relDir);
  if (!cfg.domainRoots.includes(rel)) {
    const head = rel.split('/')[0];
    // 只有 strictCatalog 里登记的容器才做"第二级必须对应真实目录"的硬校验（清单来自配置）。
    // 没登记的容器是软校验：已知主题/项目目录直接放行，新主题目录交给 assertDirReady
    // 用 --mkdir 放行（否则"按主题新建目录"这条路会被硬校验堵死）。
    const strict = cfg.strictCatalog ?? [];
    if ((cfg.catalogSources ?? {})[head] && strict.includes(head)) {
      assertKnownCatalogEntry(cfg, rel, source);
    }
    return rel;
  }
  const entries = [...new Set([...catalogEntries(cfg, rel), ...themeDirs(cfg, rel)])].sort();
  const hint = entries.length
    ? `应为：${entries.map((d) => `${rel}/${d}`).join('、')}`
    : (listSubdirs(cfg, rel).length
      ? `现有子目录：${listSubdirs(cfg, rel).join('、')}`
      : `该容器还没有子目录，请先按主题在该容器下建一个（新建分类需 --mkdir 并向用户确认）`);
  throw new Error(`${rel} 是容器，不能直接把笔记放在根下（来源：${source}）；请指定下一级。${hint}`);
}

/**
 * 落位目录必须是**已存在**的，或者调用方显式声明要新建（`--mkdir`）。
 * 例外：容器的**既定分类**（`work/<业务域>`、`opensource/<仓库>`，清单来自 catalogSources）直接放行。
 *
 * 目的：新建分类是不可逆的目录污染，不许"随手建一个看起来合理的"；
 * 拿不准就先问用户，得到明确同意后再带 --mkdir 写入。
 */
export function assertDirReady(cfg, relDir, { create = false, source = '' } = {}) {
  const rel = normalizeRel(relDir);
  if (!rel || existsSync(join(cfg.vault, rel))) return rel;
  if (isKnownNested(cfg, rel)) return rel;
  if (create) return rel;
  const parent = rel.split('/').slice(0, -1).join('/');
  const siblings = listSubdirs(cfg, parent);
  throw new Error(
    `目录 ${rel} 在知识库里不存在，写入等于新建一个分类（来源：${source}）。`
    + '确认这个分类合适后再加 --mkdir；拿不准就先问用户。'
    + (siblings.length ? `同级已有：${siblings.join('、')}` : ''),
  );
}

const ILLEGAL_FS = /[\\/:*?"<>|#^[\]]/g;

export function slugify(title, maxLen = 80) {
  let s = String(title ?? '').replace(/[\u0000-\u001f]/g, '');
  s = s.replace(ILLEGAL_FS, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s || '未命名笔记';
}

/** 归一化用于查重比较：去标点、去空白、转小写。 */
export function normalizeForCompare(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s\-_.,;:!?，。；：！？、"'“”‘’()（）[\]【】]/g, '');
}

const RISKY_YAML = [':', '#', '{', '}', '[', ']', '&', '*', '!', '|', '>', "'", '"', '%', '@', '`', ',', '\n', '\t', '\\'];

function yamlScalar(v) {
  const s = String(v);
  const risky = s.trim() !== s || s === '' || RISKY_YAML.some((c) => s.includes(c))
    || /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
  return risky ? JSON.stringify(s) : s;
}

/** 生成 YAML frontmatter 块（不含尾部空行）。空值自动省略。 */
export function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') { lines.push(`${k}: ${v}`); continue; }
    if (Array.isArray(v)) {
      const items = v.filter((x) => x !== undefined && x !== null && String(x) !== '');
      if (!items.length) continue;
      lines.push(`${k}:`);
      for (const item of items) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function atomicWrite(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, absPath);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
  return absPath;
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fields: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const bodyStart = raw.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : raw.slice(bodyStart + 1);
  const fields = {};
  let listKey = null;
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_\u4e00-\u9fff-]+):\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (v === '') { fields[k] = []; listKey = k; } else { fields[k] = v.replace(/^["']|["']$/g, ''); listKey = null; }
      continue;
    }
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) fields[listKey].push(li[1].replace(/^["']|["']$/g, ''));
  }
  return { fields, body };
}

export function readNote(absPath) {
  const raw = readFileSync(absPath, 'utf8');
  const { fields, body } = parseFrontmatter(raw);
  return { raw, fields, body, title: basename(absPath, '.md') };
}

export function* walkNotes(cfg, dir = cfg.vault) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(cfg.vault, abs).split(sep).join('/');
    if (cfg.searchExclude.some((x) => rel === x || rel.startsWith(`${x}/`))) continue;
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue;
      yield* walkNotes(cfg, abs);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      yield abs;
    }
  }
}

function snippetAround(raw, term, width = 90) {
  const idx = raw.toLowerCase().indexOf(String(term).toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - Math.floor(width / 3));
  const text = raw.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${start + width < raw.length ? '…' : ''}`;
}

/** 关键词检索（子串匹配，对中文友好）；标题/路径/正文加权。 */
export function searchNotes(cfg, query, limit = 10, opts = {}) {
  const terms = String(query ?? '').split(/[\s,，]+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const abs of walkNotes(cfg)) {
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.size > 512 * 1024) continue;
    let raw;
    try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
    const lower = raw.toLowerCase();
    const rel = relative(cfg.vault, abs).split(sep).join('/');
    const title = basename(abs, '.md');
    const lowerTitle = title.toLowerCase();
    const lowerRel = rel.toLowerCase();
    let score = 0;
    const matched = [];
    for (const t of terms) {
      const lt = t.toLowerCase();
      let termScore = 0;
      if (lowerTitle.includes(lt)) termScore += 10;
      if (lowerRel.includes(lt)) termScore += 4;
      let idx = -1;
      let count = 0;
      while (count < 5 && (idx = lower.indexOf(lt, idx + 1)) !== -1) count++;
      if (count) termScore += count * 2;
      if (termScore) { score += termScore; matched.push(t); }
    }
    if (!score) continue;
    results.push({ path: rel, absPath: abs, title, score, matched, snippet: snippetAround(raw, terms[0]) });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, Math.max(1, limit));
}

/** 按文件名（归一化）在 vault 内查重，返回相对路径数组。 */
export function findExistingByTitle(cfg, title) {
  const target = normalizeForCompare(title);
  const hits = [];
  for (const abs of walkNotes(cfg)) {
    if (normalizeForCompare(basename(abs, '.md')) === target) {
      hits.push(relative(cfg.vault, abs).split(sep).join('/'));
    }
  }
  return hits.sort();
}

/** 追加内容：给了 section 就写进该二级标题段末尾，否则追加到文件末尾。 */
export function appendSection(absPath, section, content) {
  const raw = readFileSync(absPath, 'utf8');
  const cleaned = String(content ?? '').trim();
  if (!cleaned) return absPath;
  if (!section) {
    return atomicWrite(absPath, `${raw.replace(/\s+$/, '')}\n\n${cleaned}\n`);
  }
  const esc = String(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{1,6}\\s*${esc}\\s*$`);
  const lines = raw.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (headingRe.test(lines[i])) start = i;
  if (start === -1) {
    return atomicWrite(absPath, `${raw.replace(/\s+$/, '')}\n\n## ${section}\n\n${cleaned}\n`);
  }
  const level = (lines[start].match(/^#+/) || ['##'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  const out = [...lines.slice(0, end), '', cleaned, '', ...lines.slice(end)];
  return atomicWrite(absPath, out.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, '') + '\n');
}

/** vault 内的绝对路径；库外绝对路径直接报错，避免写到知识库之外。 */
export function vaultAbs(cfg, relPath) {
  return join(cfg.vault, toVaultRel(cfg, relPath));
}

/** vault 内所有笔记的相对路径（排序后），供「引用清单」使用。 */
export function listNoteIndex(cfg, limit = 400) {
  const all = [];
  for (const abs of walkNotes(cfg)) all.push(relative(cfg.vault, abs).split(sep).join('/'));
  all.sort();
  return all.slice(0, Math.max(1, limit));
}

/**
 * 把正文里会被 Obsidian 误解的 Markdown 链接降级，避免“点一下就凭空建出嵌套空文件”：
 * - 指向库内已有笔记的链接 → `[[笔记名]]`（链接文字与笔记名不同则写 `[[名|文字]]`）；
 * - 其余路径型链接（库外绝对路径、库内不存在的路径）→ 行内代码，不可点击；
 * - `http(s)` / `mailto` / `tel` / 锚点链接与既有 `[[wikilink]]` 原样保留。
 */
export function sanitizeBodyLinks(cfg, body) {
  const root = vaultRoot(cfg);
  const wikilinkFor = (candidate, text) => {
    const rel = normalizeRel(candidate);
    if (!rel || !existsSync(join(cfg.vault, rel))) return null;
    const name = basename(rel, '.md');
    const label = String(text ?? '').trim().replace(/\.md$/i, '');
    return label && label !== name ? `[[${name}|${label}]]` : `[[${name}]]`;
  };
  return String(body ?? '').replace(
    /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (whole, text, target) => {
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) return whole;
      const decoded = safeDecode(target.replace(/^file:\/\//, '')).replace(/\\/g, '/');
      if (decoded.startsWith('/')) {
        if (decoded === root || decoded.startsWith(`${root}/`)) {
          return wikilinkFor(decoded.slice(root.length), text) ?? `\`${decoded}\``;
        }
        return `\`${decoded}\``;
      }
      return wikilinkFor(decoded, text) ?? `\`${decoded}\``;
    },
  );
}

/**
 * 标记归档笔记"已提炼"：写上 `distilled / distilled_into / distilled_at`，
 * 让「归档 → 主题笔记」这一环可追踪，索引页据此统计积压。
 * 只动 frontmatter，不改正文；重复调用是幂等的。
 */
// ---------------------------------------------------------------- 模板渲染与调度环境

/** 模板变量替换：`{{NAME}}` → 值（未提供的变量替换为空串）。 */
export function renderTemplate(tpl, vars) {
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}

/** XML 文本转义（Windows 计划任务 XML、launchd plist 都是 XML，路径里的 & 等不能裸写）。 */
export function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 写进调度器（systemd unit / launchd plist）的 PATH：非登录环境没有用户的登录 shell PATH，
 * 至少带上 node 所在目录与各平台的常用工具目录。
 */
export function schedulerEnvPath(nodeBin = process.execPath) {
  if (process.platform === 'win32') {
    const sysroot = process.env.SystemRoot || 'C:\\Windows';
    return [dirname(nodeBin), join(sysroot, 'system32'), join(sysroot, 'System32', 'WindowsPowerShell', 'v1.0')]
      .join(delimiter);
  }
  return [dirname(nodeBin), '/usr/local/bin', '/usr/bin', '/bin'].join(delimiter);
}

// ---------------------------------------------------------------- 可执行文件定位

function statSyncSafe(p) {
  try { return statSync(p); } catch { return null; }
}

/** 在 PATH 里找一个可执行文件（跨平台：用 path.delimiter 切分，Windows 兼容 .cmd/.exe 后缀探测）。 */
export function whichSync(cmd) {
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : [''];
  for (const d of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(d, `${cmd}${ext}`);
      const st = statSyncSafe(p);
      if (!st || !st.isFile()) continue;
      if (process.platform === 'win32' || (st.mode & 0o111)) return p;
    }
  }
  return null;
}

/**
 * dsh 可执行文件：`$DSH_BIN`（或配置 llm.command）→ PATH → npx 缓存里最新的那个。
 * npx 缓存在所有平台都在 `~/.npm/_npx`，是"没全局装 dsh"时最稳的兜底。
 */
export function resolveDshBin(cfg = {}) {
  const explicit = process.env.DSH_BIN || cfg.llm?.command;
  if (typeof explicit === 'string' && explicit && existsSync(explicit)) return explicit;
  const onPath = whichSync('dsh');
  if (onPath) return onPath;
  const root = join(homedir(), '.npm', '_npx');
  let best = null;
  try {
    for (const d of readdirSync(root)) {
      const p = join(root, d, 'node_modules', '.bin', 'dsh');
      if (!existsSync(p)) continue;
      const m = statSyncSafe(p);
      if (!best || (m?.mtimeMs ?? 0) > best.m) best = { p, m: m?.mtimeMs ?? 0 };
    }
  } catch { /* 无 npx 缓存 */ }
  return best?.p ?? null;
}

/**
 * zstd 可执行文件探测（结果缓存）。老会话 transcript 回退与 recover 回补都要它；
 * Windows 默认不自带 zstd，缺了会给明确提示而不是静默降级。
 */
let _zstdChecked = false;
let _zstdPath = null;
export function zstdAvailable() {
  if (!_zstdChecked) {
    _zstdChecked = true;
    _zstdPath = whichSync('zstd');
  }
  return Boolean(_zstdPath);
}

export const ZSTD_HINT = '找不到 zstd 可执行文件：无法读取原始会话记录（老会话摘要回退、recover 代码块回补会受影响）。'
  + ' Linux/macOS 安装 zstd 包；Windows 执行 `winget install Zstandard`（或 `scoop install zstd`）后重开终端。';

// ---------------------------------------------------------------- 原始 transcript

/**
 * DSH 的数据根目录（会话记录、投影缓存）。默认 `~/.dsh`，可用 `$DSH_HOME` 覆盖
 * （DSH 装在非默认位置、或做隔离测试时用）。
 */
export function dshHome() {
  return resolve(expandHome(process.env.DSH_HOME || join(homedir(), '.dsh')));
}

export function dshSessionsRoot() {
  return join(dshHome(), 'sessions');
}

export function dshProjcacheRoot() {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions');
}

export const DSH_SESSIONS_ROOT = dshSessionsRoot();

/**
 * 定位某会话的原始 transcript。文件名可能是 session.jsonl.zstd，也可能是带版本号的
 * session.v3.jsonl.zstd（同一会话可有多个），取最新写入的那个。
 */
export function findTranscript(sid) {
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

/**
 * 抽原始 transcript 里助手**正文**（跳过 reasoning）的代码围栏块，按内容去重、长的在前。
 * 找不到 transcript 返回 null（与"有记录但没代码块"的 [] 区分开）。
 */
export function transcriptCodeBlocks(sid, { minLen = 200 } = {}) {
  const tr = findTranscript(sid);
  if (!tr) return null;
  if (!zstdAvailable()) throw new Error(ZSTD_HINT);
  const res = spawnSync('zstd', ['-dc', tr], { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
  if (res.status !== 0) return [];
  const out = [], seen = new Set();
  for (const line of String(res.stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant/message') continue;
    for (const p of e.data?.message?.content ?? []) {
      if (!p || typeof p !== 'object' || p.type !== 'text') continue;
      for (const m of String(p.text ?? '').matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g)) {
        const b = m[1].trim();
        if (b.length < minLen) continue;
        if (seen.has(b)) continue;
        seen.add(b);
        out.push(b);
      }
    }
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/**
 * 归档互斥锁：账本 archived.json、归档笔记都是"读-改-写"，定时器 / 手动 / 平行会话
 * 并行跑会互相覆盖。锁文件在 STATE_DIR/sediment.lock；持有超过 30 分钟视为已死
 * （单轮归档含 LLM ≈ 10 分钟），自动接管。
 * 返回 release 函数（幂等）；拿不到锁返回 null。waitMs=0 表示不等待立即失败。
 */
export function acquireLock({ waitMs = 60000, onWait = null } = {}) {
  const lockPath = join(STATE_DIR, 'sediment.lock');
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const start = Date.now();
  let announced = false;
  mkdirSync(STATE_DIR, { recursive: true });
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now(), token }), { flag: 'wx' });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const cur = JSON.parse(readFileSync(lockPath, 'utf8'));
          if (cur.token === token) rmSync(lockPath, { force: true });
        } catch { /* 锁已不在 */ }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      let owner = null;
      try { owner = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* 损坏按过期处理 */ }
      if (!owner?.at || Date.now() - owner.at > LOCK_STALE_MS) {
        rmSync(lockPath, { force: true }); // 持有者已死（如被 SIGKILL），接管
        continue;
      }
      if (Date.now() - start >= waitMs) return null;
      if (!announced) {
        announced = true;
        try { onWait?.(owner); } catch { /* 提示失败不影响等锁 */ }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
}

const LOCK_STALE_MS = 30 * 60 * 1000;

export function markDistilled(cfg, relPath, { into, note = '' } = {}) {
  const absPath = vaultAbs(cfg, relPath);
  const raw = readFileSync(absPath, 'utf8');
  const { fields, body } = parseFrontmatter(raw);
  const merged = {
    ...fields,
    distilled: true,
    // 未提供新值时保留旧值：空参数的重标记不应抹掉已有的提炼说明/目标
    distilled_into: into || fields.distilled_into || undefined,
    distilled_note: note || fields.distilled_note || undefined,
    distilled_at: fmtTime(Date.now()),
  };
  const content = `${buildFrontmatter(merged)}\n\n${body.replace(/^\n+/, '')}`;
  atomicWrite(absPath, content.endsWith('\n') ? content : `${content}\n`);
  return { path: normalizeRel(relPath), into, note };
}

export function fmtTime(ms, withTime = true) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next.length > 2)) out[key] = true;
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function readBodyArg(args) {
  if (typeof args.body === 'string') return args.body;
  const bf = args['body-file'];
  if (typeof bf === 'string') return bf === '-' ? readStdin() : readFileSync(expandHome(bf), 'utf8');
  if (bf === true) return readStdin();
  if (!process.stdin.isTTY) {
    const data = readStdin();
    if (data.trim()) return data;
  }
  return '';
}
