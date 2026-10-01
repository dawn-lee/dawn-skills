#!/usr/bin/env node
/**
 * football-betting 启动前置检查（随 skill 安装）。
 * 用法：node scripts/preflight.mjs
 */
import { access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const analysisSkill = join(skillRoot, '..', 'football-analysis', 'SKILL.md');

// FDP_ROOT 兜底同样不写死绝对路径：环境变量 → 与本仓库同级的 football-data-platform
const repoRoot = dirname(dirname(skillRoot));
const siblingFdp = join(dirname(repoRoot), 'football-data-platform');
const devFallback = existsSync(join(siblingFdp, 'scripts', 'betting', '_generate-two-tickets.mjs')) ? siblingFdp : '';

let failed = false;
const fail = (msg) => { failed = true; console.error(`[FAIL] ${msg}`); };

try {
  await access(analysisSkill);
  console.log('[OK] 检测到依赖 football-analysis');
} catch {
  fail('未检测到 football-analysis。请先安装 football-analysis，再使用 football-betting。');
}

const fdpRoot = process.env.FDP_ROOT || process.env.FDP_ROOT_DEV_DEFAULT || devFallback;
try {
  await access(fdpRoot || join(skillRoot, '__no_fdp_root__'));
  console.log(`[OK] FDP_ROOT 可用：${fdpRoot}`);
} catch {
  console.warn(`[WARN] FDP_ROOT 不存在：${fdpRoot || '(未设置)'}`);
  console.warn('       请设置环境变量 FDP_ROOT 或在使用时明确指定路径，否则不要开始分析/投注。');
}

if (failed) process.exit(1);
console.log('\npreflight 通过。');
