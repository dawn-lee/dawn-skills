#!/usr/bin/env node
/**
 * install.mjs —— 一键安装 obsidian-inbox：接入技能目录 + 生成/校验本机配置 + 注册每日归档调度。
 *
 * 三平台调度：
 *   linux  → systemd user timer（写 ~/.config/systemd/user/dsh-sediment.{service,timer}）
 *   darwin → launchd LaunchAgent（写 ~/Library/LaunchAgents/com.dsh.obsidian-inbox.plist）
 *   win32  → 任务计划程序（schtasks /Create /XML）
 * 无 systemd 的 Linux（WSL1、部分发行版）会打印 cron 行让你自行添加，不擅自改 crontab。
 *
 * 用法：
 *   node scripts/install.mjs                     # 软链 + 配置 + 调度（每天 23:00）
 *   node scripts/install.mjs --skill-only        # 只接入技能目录，不装调度
 *   node scripts/install.mjs --no-scheduler      # 同上
 *   node scripts/install.mjs --time 22:30 --since-hours 26
 *   node scripts/install.mjs --copy              # 复制而非软链（Windows/无软链权限时）
 *   node scripts/install.mjs --status
 *   node scripts/install.mjs --uninstall [--remove-skill]
 *   node scripts/install.mjs --dry-run
 *
 * 退出码：0 成功 / 1 有步骤失败 / 2 用法错误 / 3 目标已存在且未加 --force
 */
import {
  existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, cpSync, realpathSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  SKILL_DIR, STATE_DIR, parseArgs, expandHome, resolveDshBin, configCandidates, loadConfig,
  renderTemplate, xmlEscape, schedulerEnvPath,
} from './lib.mjs';

const USAGE = `用法：
  install.mjs [--agents-dir DIR] [--copy] [--force] [--skill-only|--no-scheduler]
              [--time HH:MM] [--since-hours N] [--dry-run] [--status] [--uninstall]
              [--remove-skill] [--json]`;

const args = parseArgs(process.argv.slice(2));
const json = args.json === true;
const dryRun = args['dry-run'] === true;
const platform = process.platform;
const NODE = process.execPath;
const LABEL = 'com.dsh.obsidian-inbox';
const SYSTEMD_UNIT = 'dsh-sediment';
const WIN_TASK = 'obsidian-inbox-sediment';

const actions = [];
function note(kind, message, ok = true) { actions.push({ kind, message, ok }); }
function out(extra = {}) {
  const failed = actions.filter((a) => !a.ok);
  const payload = { ok: failed.length === 0, platform, dryRun: dryRun || undefined, ...extra, steps: actions };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    for (const a of actions) process.stdout.write(`${a.ok ? '✓' : '✗'} ${a.kind}：${a.message}\n`);
    process.stdout.write(`\n${failed.length ? `完成，但有 ${failed.length} 步失败` : '完成'}\n`);
  }
  process.exit(failed.length ? 1 : 0);
}
function fail(code, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...extra }, null, 2)}\n`);
  process.exit(code);
}

function run(cmd, cmdArgs) {
  if (dryRun) { note('exec', `${cmd} ${cmdArgs.join(' ')}（dry-run 未执行）`); return { ok: true, dry: true }; }
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) {
    return { ok: false, error: `退出码 ${res.status}：${String(res.stderr ?? '').trim().slice(0, 300)}` };
  }
  return { ok: true, stdout: String(res.stdout ?? '').trim() };
}

// ---------------------------------------------------------------- 参数与路径

const agentsDir = resolve(expandHome(
  typeof args['agents-dir'] === 'string'
    ? args['agents-dir']
    : (process.env.DSH_SKILLS_DIR || join(homedir(), '.agents', 'skills')),
));
// 软链模式下技能就住在源码目录；复制模式下住在安装目录。
// 若安装位置已存在真实目录（npx 安装的副本），planLink 会把 skillDir 改指过去。
const linkPath = join(agentsDir, 'obsidian-inbox');
let skillDir = args.copy === true ? linkPath : SKILL_DIR;

function parseTime() {
  const raw = typeof args.time === 'string' ? args.time : '23:00';
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) fail(2, `--time 格式应为 HH:MM，收到：${raw}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) fail(2, `--time 超出范围：${raw}`);
  return { hour, minute, text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function sedimentArgs() {
  const hours = Number(args['since-hours']) > 0 ? Number(args['since-hours']) : 26;
  return { hours, argv: [`${skillDir}/scripts/sediment.mjs`, '--since-hours', String(hours)] };
}

function readTemplate(rel) {
  return readFileSync(join(SKILL_DIR, 'templates', rel), 'utf8');
}

const render = renderTemplate;

function envPath() {
  return schedulerEnvPath(NODE);
}

// ---------------------------------------------------------------- 技能接入

function planLink() {
  const st = lstatSyncSafe(linkPath);
  if (st?.isSymbolicLink()) {
    const cur = realpathSafe(linkPath);
    if (cur === SKILL_DIR) return { status: 'ok', message: `软链已存在：${linkPath} → ${SKILL_DIR}` };
    if (args.force !== true) {
      return { status: 'conflict', message: `软链指向别处：${linkPath} → ${cur}（加 --force 重新指向本仓库）` };
    }
    if (!dryRun) { rmSync(linkPath, { force: true }); symlinkSync(SKILL_DIR, linkPath, 'dir'); }
    return { status: 'relinked', message: `已重指：${linkPath} → ${SKILL_DIR}` };
  }
  if (st) {
    // 已经是个真实目录（例如 npx skills add 复制安装的副本）：技能就是从这里被发现并加载的，
    // 调度与配置都要跟着它走，否则"改了源码却不生效"会变成长期的困惑源
    skillDir = linkPath;
    return {
      status: 'exists',
      message: `${linkPath} 已存在且不是软链（可能是已安装的副本）；沿用该副本，调度指向它。`
        + '想改为指向本仓库源码，先删掉它或用 --copy',
    };
  }
  if (args.copy === true) {
    if (!dryRun) {
      mkdirSync(agentsDir, { recursive: true });
      cpSync(SKILL_DIR, linkPath, {
        recursive: true,
        filter: (src) => !/(^|[/\\])(\.git|node_modules|\.trash)([/\\]|$)/.test(src) && !src.endsWith('.tmp'),
      });
    }
    return { status: 'copied', message: `已复制到 ${linkPath}` };
  }
  try {
    if (!dryRun) {
      mkdirSync(agentsDir, { recursive: true });
      symlinkSync(SKILL_DIR, linkPath, 'dir');
    }
    return { status: 'linked', message: `已软链：${linkPath} → ${SKILL_DIR}` };
  } catch (err) {
    // Windows 无开发者模式时 symlink 会 EPERM：退回复制
    if (platform === 'win32') {
      if (!dryRun) {
        mkdirSync(agentsDir, { recursive: true });
        cpSync(SKILL_DIR, linkPath, { recursive: true });
      }
      return { status: 'copied', message: `软链失败（${err.code}），已改为复制到 ${linkPath}` };
    }
    return { status: 'failed', ok: false, message: `软链失败：${err.message}` };
  }
}

function lstatSyncSafe(p) {
  try { return lstatSync(p); } catch { return null; }
}
function realpathSafe(p) {
  try { return realpathSync(p); } catch { return null; }
}

// ---------------------------------------------------------------- 配置

function ensureConfig() {
  // 复制安装时配置应落在安装目录里；软链安装则与源码共用一份
  const forced = process.env.OBSIDIAN_INBOX_CONFIG
    ? resolve(expandHome(process.env.OBSIDIAN_INBOX_CONFIG))
    : (args.copy === true ? join(skillDir, 'config.json') : null);
  const existing = forced
    ? (existsSync(forced) ? forced : null)
    : configCandidates().find((p) => existsSync(p));
  if (existing) return { ok: true, message: `配置已存在：${existing}` };
  const initScript = join(skillDir, 'scripts', 'init.mjs');
  // 把 init 的相关参数透传，便于一条命令完成"projects 预设 + 指定项目根"的安装
  const passthrough = [];
  for (const key of ['preset', 'vault', 'projects-root', 'containers', 'soft', 'default-dir', 'from-config']) {
    if (typeof args[key] === 'string') passthrough.push(`--${key}`, args[key]);
  }
  const initArgs = [initScript, ...passthrough, ...(forced ? ['--out', forced] : [])];
  if (dryRun) return { ok: true, message: `配置缺失，将运行 ${initArgs.join(' ')}（dry-run 未执行）` };
  const res = spawnSync(NODE, initArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    return {
      ok: false,
      message: `自动初始化失败（可能探测不到知识库）：请手动运行\n`
        + `  node ${initScript} --vault "~/你的知识库"\n`
        + `${String(res.stdout ?? res.stderr ?? '').trim().slice(-400)}`,
    };
  }
  return { ok: true, message: `已生成配置：${String(res.stdout ?? '').trim().split('\n')[0]}` };
}

// ---------------------------------------------------------------- 调度：linux

function systemdPaths() {
  const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
  return { dir, service: join(dir, `${SYSTEMD_UNIT}.service`), timer: join(dir, `${SYSTEMD_UNIT}.timer`) };
}

function hasSystemd() {
  return platform === 'linux' && Boolean(existsSync('/run/systemd/system'));
}

function installSystemd(time) {
  const { dir, service, timer } = systemdPaths();
  const { hours } = sedimentArgs();
  const dsh = resolveDshBin({});
  const envLines = [`Environment="PATH=${envPath()}"`];
  if (dsh) envLines.push(`Environment="DSH_BIN=${dsh}"`);
  const svc = render(readTemplate('systemd/dsh-sediment.service.tmpl'), {
    SKILL_DIR: skillDir,
    NODE,
    ARGS: `--since-hours ${hours}`,
    ENV_LINES: envLines.join('\n'),
  });
  const tmr = render(readTemplate('systemd/dsh-sediment.timer.tmpl'), {
    SKILL_DIR: skillDir,
    TIME: time.text,
  });
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(service, svc, 'utf8');
    writeFileSync(timer, tmr, 'utf8');
  }
  note('scheduler', `已写入 ${service} 与 ${timer}`);
  const reload = run('systemctl', ['--user', 'daemon-reload']);
  note('exec', reload.ok ? 'systemctl --user daemon-reload' : `daemon-reload 失败：${reload.error}`, reload.ok);
  const enable = run('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT}.timer`]);
  note('scheduler', enable.ok
    ? `已启用 ${SYSTEMD_UNIT}.timer（每天 ${time.text}）`
    : `启用失败：${enable.error}（若为容器/WSL，请自行加 cron）`, enable.ok);
  if (!enable.ok) note('hint', `cron 兜底：${time.minute} ${time.hour} * * * ${NODE} ${argv.join(' ')}`);
}

function uninstallSystemd() {
  const { service, timer } = systemdPaths();
  run('systemctl', ['--user', 'disable', '--now', `${SYSTEMD_UNIT}.timer`]);
  for (const p of [service, timer]) {
    if (existsSync(p) && !dryRun) rmSync(p, { force: true });
    note('scheduler', `已删除 ${p}`);
  }
  run('systemctl', ['--user', 'daemon-reload']);
}

function statusSystemd() {
  const { service, timer } = systemdPaths();
  note('scheduler', `${service} ${existsSync(service) ? '存在' : '不存在'}`);
  note('scheduler', `${timer} ${existsSync(timer) ? '存在' : '不存在'}`);
  const en = run('systemctl', ['--user', 'is-enabled', `${SYSTEMD_UNIT}.timer`]);
  note('scheduler', `is-enabled：${en.ok ? en.stdout : (en.error ?? '未安装')}`, en.ok);
  const ac = run('systemctl', ['--user', 'is-active', `${SYSTEMD_UNIT}.timer`]);
  note('scheduler', `is-active：${ac.ok ? ac.stdout : (ac.error ?? '未激活')}`, ac.ok);
}

// ---------------------------------------------------------------- 调度：darwin

function launchdPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function installLaunchd(time) {
  const plistPath = launchdPath();
  const dsh = resolveDshBin({});
  const plist = render(readTemplate('launchd/com.dsh.obsidian-inbox.plist.tmpl'), {
    NODE: xmlEscape(NODE),
    SKILL_DIR: xmlEscape(skillDir),
    HOUR: time.hour,
    MINUTE: time.minute,
    STATE_DIR: xmlEscape(STATE_DIR),
    PATH: xmlEscape(envPath()),
    DSH_BIN_ENTRY: dsh
      ? `    <key>DSH_BIN</key>\n    <string>${xmlEscape(dsh)}</string>`
      : '',
  });
  if (!dryRun) {
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, plist, 'utf8');
  }
  note('scheduler', `已写入 ${plistPath}`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]); // 未加载时会失败，忽略
  const boot = run('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
  if (!boot.ok) {
    const fallback = run('launchctl', ['load', '-w', plistPath]);
    note('scheduler', fallback.ok ? `已加载（load -w，每天 ${time.text}）` : `加载失败：${boot.error}`, fallback.ok);
  } else {
    note('scheduler', `已加载（每天 ${time.text}）`);
  }
}

function uninstallLaunchd() {
  const plistPath = launchdPath();
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  if (existsSync(plistPath) && !dryRun) rmSync(plistPath, { force: true });
  note('scheduler', `已删除 ${plistPath}`);
}

function statusLaunchd() {
  const plistPath = launchdPath();
  note('scheduler', `${plistPath} ${existsSync(plistPath) ? '存在' : '不存在'}`);
  const res = run('launchctl', ['list', LABEL]);
  note('scheduler', res.ok ? `已加载：${res.stdout.split('\n').slice(0, 2).join(' / ')}` : '未加载', res.ok);
}

// ---------------------------------------------------------------- 调度：win32

function installWindows(time) {
  const xmlPath = join(STATE_DIR, 'task.xml');
  const { argv } = sedimentArgs();
  const xml = render(readTemplate('windows/task.xml.tmpl'), {
    START: xmlEscape(`2026-01-01T${time.text}:00`),
    NODE: xmlEscape(NODE),
    ARGS: xmlEscape(`"${argv[0]}" ${argv.slice(1).join(' ')}`),
    SKILL_DIR: xmlEscape(skillDir),
  });
  if (!dryRun) {
    mkdirSync(STATE_DIR, { recursive: true });
    // schtasks /XML 要求 UTF-16（带 BOM）
    writeFileSync(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
  }
  note('scheduler', `已写入任务定义 ${xmlPath}`);
  const res = run('schtasks', ['/Create', '/TN', WIN_TASK, '/XML', xmlPath, '/F']);
  note('scheduler', res.ok ? `已注册计划任务「${WIN_TASK}」（每天 ${time.text}）` : `注册失败：${res.error}`, res.ok);
}

function uninstallWindows() {
  const res = run('schtasks', ['/Delete', '/TN', WIN_TASK, '/F']);
  note('scheduler', res.ok ? `已删除计划任务「${WIN_TASK}」` : `删除失败/不存在：${res.error}`, res.ok);
}

function statusWindows() {
  const res = run('schtasks', ['/Query', '/TN', WIN_TASK]);
  note('scheduler', res.ok ? '计划任务已注册' : '计划任务未注册', res.ok);
}

// ---------------------------------------------------------------- 主流程

if (typeof args.help === 'boolean' || args._[0] === 'help') {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

if (args.status === true) {
  const st = lstatSyncSafe(linkPath);
  note('skill', `${linkPath} ${st ? (st.isSymbolicLink() ? `→ ${realpathSafe(linkPath)}` : '存在（非软链）') : '不存在'}`);
  const cfg = configCandidates().find((p) => existsSync(p));
  note('config', cfg ? `配置：${cfg}` : '配置缺失（先运行 scripts/init.mjs）', Boolean(cfg));
  try {
    const c = loadConfig();
    note('config', `知识库：${c.vault}；容器：${c.domainRoots.join('、') || '（无）'}；默认落位：${c.defaultDir || '（根）'}`);
  } catch (err) {
    note('config', `配置不可用：${err.message.split('\n')[0]}`, false);
  }
  if (platform === 'linux' && hasSystemd()) statusSystemd();
  else if (platform === 'darwin') statusLaunchd();
  else if (platform === 'win32') statusWindows();
  else note('scheduler', `平台 ${platform} 无内置调度支持；建议 cron：${NODE} ${skillDir}/scripts/sediment.mjs --since-hours 26`);
  out({ mode: 'status' });
}

if (args.uninstall === true) {
  if (platform === 'linux' && hasSystemd()) uninstallSystemd();
  else if (platform === 'darwin') uninstallLaunchd();
  else if (platform === 'win32') uninstallWindows();
  else note('scheduler', `平台 ${platform} 无需卸载内置调度`);
  if (args['remove-skill'] === true) {
    const st = lstatSyncSafe(linkPath);
    if (st) {
      if (!dryRun) {
        // 软链只删链接本身（绝不能沿用 recursive 跟着删掉源码仓库）
        if (st.isSymbolicLink()) rmSync(linkPath, { force: true });
        else rmSync(linkPath, { recursive: true, force: true });
      }
      note('skill', `已删除 ${linkPath}${st.isSymbolicLink() ? '（软链，源码保留）' : ''}`);
    } else {
      note('skill', `${linkPath} 不存在，跳过`);
    }
  }
  out({ mode: 'uninstall' });
}

const time = parseTime();
const { hours, argv } = sedimentArgs();
note('plan', `平台 ${platform}；node ${NODE}；技能目录 ${skillDir}`);

const linked = planLink();
note('skill', linked.message, linked.ok !== false);

const cfg = ensureConfig();
note('config', cfg.message, cfg.ok);

if (args['skill-only'] === true || args['no-scheduler'] === true) {
  note('scheduler', '按要求跳过调度安装（--skill-only/--no-scheduler）');
  out({ mode: 'skill-only', linkPath, configChecked: cfg.ok });
}

if (platform === 'linux' && hasSystemd()) {
  installSystemd(time);
} else if (platform === 'darwin') {
  installLaunchd(time);
} else if (platform === 'win32') {
  installWindows(time);
} else {
  note('scheduler', '未检测到 systemd/launchd/任务计划程序，未注册定时任务；请手动加 cron：');
  note('hint', `${time.minute} ${time.hour} * * * ${NODE} ${argv.join(' ')}`);
}

note('done', `每日 ${time.text} 归档；日志：${join(STATE_DIR, 'sediment.log')}；状态自检：node ${join(skillDir, 'scripts', 'install.mjs')} --status`);
out({ mode: 'install', linkPath, sinceHours: hours });
