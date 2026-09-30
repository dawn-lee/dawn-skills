#!/usr/bin/env node
/**
 * 薄壳（pass-through）—— 这里不是实现，只是转发到唯一权威入口。
 *
 * 为什么是薄壳：同名脚本曾在「本 skill 自带副本」与「FDP_ROOT 仓库实现」两份之间各自演化，
 * 2026-09-30 出票亏损的复盘确认根因就是这种漂移（副本落后/超前、照哪份跑就会得到不同票型，
 * 而票2 那次差的正是 负收益 vs 正收益那种量级）。为彻底消除双份实现，本文件改为
 * 只做参数转发：实现永远只有一份，位于 FDP_ROOT 仓库内。
 *
 * 权威入口（唯一实现）：
 *   <FDP_ROOT>/scripts/betting/_generate-two-tickets.mjs
 *
 * FDP_ROOT 解析顺序（与 SKILL.md 一致）：
 *   1) 环境变量 FDP_ROOT
 *   2) 从当前工作目录逐级向上查找 <dir>/scripts/betting/_generate-two-tickets.mjs
 *   3) 开发机默认路径（与 SKILL.md 记录一致）
 * 找不到时明确报错并给出设置方法，绝不臆测路径、也绝不退回本地旧实现。
 *
 * 用法（与权威入口完全一致，参数原样透传）：
 *   node scripts/_generate-two-tickets.mjs --analysis=<json> --output=<json> [--batch-id=] ...
 *   node scripts/_generate-two-tickets.mjs --print-authoritative-entry   # 只打印解析到的权威路径
 *
 * 注意：cwd 原样保留 —— 权威入口按调用方 cwd 解析 --analysis/--output 等相对路径。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/** 权威入口相对 FDP_ROOT 的路径（源码仓库侧脚本 check-rules-baseline-sync.mjs 依赖此常量做防漂移校验） */
export const AUTHORITATIVE_ENTRY = 'scripts/betting/_generate-two-tickets.mjs';
/** 开发机默认 FDP_ROOT（与 SKILL.md 的解析顺序注记一致；仅作最后兜底，不做硬编码优先） */
const DEV_DEFAULT_FDP_ROOT = '<FDP_ROOT>';

function walkUpForEntry(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, AUTHORITATIVE_ENTRY);
    if (existsSync(candidate)) return { root: dir, target: candidate };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveAuthoritativeEntry() {
  const tried = [];
  const envRoot = String(process.env.FDP_ROOT ?? '').trim();
  if (envRoot) {
    const target = path.join(envRoot, AUTHORITATIVE_ENTRY);
    if (existsSync(target)) return { root: envRoot, target, via: 'FDP_ROOT' };
    tried.push(`FDP_ROOT=${envRoot}`);
  } else {
    tried.push('FDP_ROOT=(未设置)');
  }

  const fromCwd = walkUpForEntry(process.cwd());
  if (fromCwd) return { ...fromCwd, via: 'cwd 向上查找' };

  const target = path.join(DEV_DEFAULT_FDP_ROOT, AUTHORITATIVE_ENTRY);
  if (existsSync(target)) return { root: DEV_DEFAULT_FDP_ROOT, target, via: '开发机默认路径' };

  return { target: null, tried };
}

const args = process.argv.slice(2);
const resolved = resolveAuthoritativeEntry();

if (args.includes('--print-authoritative-entry')) {
  if (!resolved.target) {
    console.error(`[FAIL] 未找到权威入口 ${AUTHORITATIVE_ENTRY}；已尝试：${resolved.tried.join(' | ')}`);
    process.exit(2);
  }
  console.log(resolved.target);
  process.exit(0);
}

if (!resolved.target) {
  console.error(
    [
      '未找到出票生成器的权威实现，拒绝退回 skill 自带旧实现（会造成票型漂移）。',
      `期望路径：<FDP_ROOT>/${AUTHORITATIVE_ENTRY}`,
      `已尝试：${resolved.tried.join(' | ')}`,
      '请设置环境变量 FDP_ROOT 指向足球数据平台仓库后重试，例如：',
      '  PowerShell:  $env:FDP_ROOT="<FDP_ROOT>"',
      '  bash:        export FDP_ROOT=/path/to/football-data-platform',
    ].join('\n'),
  );
  process.exit(2);
}

// 转发循环保险：万一权威入口又指回本薄壳
if (path.resolve(resolved.target) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  console.error('[FAIL] 权威入口解析结果指向薄壳自身，疑似转发循环。');
  process.exit(2);
}
if (process.env.FDP_TWO_TICKET_FORWARDED === '1') {
  console.error('[FAIL] 检测到重复转发（FDP_TWO_TICKET_FORWARDED=1），疑似转发循环。');
  process.exit(2);
}

const child = spawnSync(process.execPath, [resolved.target, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: { ...process.env, FDP_TWO_TICKET_FORWARDED: '1' },
});
process.exit(child.status ?? 1);
