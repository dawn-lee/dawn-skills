#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { evaluateCoverageProfit } from './coverage-profit-core.mjs'
import { evaluateReturnPool } from './return-pool-core.mjs'

const file = process.argv[2]
if (!file) {
  console.error('用法: node scripts/validate-bet-plan.mjs <bet-plan.json|->')
  process.exit(2)
}

const resolved = file === '-' ? '<stdin>' : path.resolve(file)
const raw = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(resolved, 'utf8'))
const plan = raw.bet_plan ?? raw
const errors = []
const CURRENT_CONTRACT = '2.4.5'
const atLeast = (version, minimum) => {
  const current = String(version ?? '').split('.').slice(0, 3).map(Number)
  const floor = minimum.split('.').map(Number)
  if (current.length !== 3 || current.some(Number.isNaN)) return false
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== floor[index]) return current[index] > floor[index]
  }
  return true
}
const currentContract = atLeast(plan.contract_version, CURRENT_CONTRACT)
if (atLeast(raw.lock?.betting_skill_version, CURRENT_CONTRACT) && !currentContract) {
  errors.push(`betting_skill_version>=${CURRENT_CONTRACT} 必须声明 bet_plan.contract_version>=${CURRENT_CONTRACT}`)
}

if (!['hit_rate_first', 'value_first', 'coverage_profit_first'].includes(plan.objective)) {
  errors.push(`objective 非法: ${String(plan.objective)}`)
}

function requireNear(label, actual, expected, tolerance = 1e-6) {
  const number = Number(actual)
  if (!Number.isFinite(number)) errors.push(`${label} 非法或缺失: ${String(actual)}`)
  else if (Math.abs(number - expected) > tolerance) errors.push(`${label} 与确定性重算不一致: ${number} vs ${expected}`)
}

function resolveTicketLegs(ticket, label) {
  if (!Array.isArray(ticket?.legs) || ticket.legs.length === 0) {
    errors.push(`${label}.legs 非法或缺失`)
    return []
  }
  const rankedLegs = Array.isArray(plan.legs) ? plan.legs : []
  return ticket.legs.flatMap((reference, index) => {
    const leg = Number.isInteger(reference) ? rankedLegs[reference] : reference
    if (!leg || typeof leg !== 'object') {
      errors.push(`${label}.legs[${index}] 无法解析到 BetPlan.legs`)
      return []
    }
    return [leg]
  })
}

function validateCurrentLeg(leg, label, requireStable) {
  const sourceId = String(leg?.probability_source_id ?? '')
  if (!/^[a-f0-9]{64}$/i.test(sourceId)) errors.push(`${label}.probability_source_id 非法或缺失`)
  if (leg?.analysis_integrity_status !== 'pass') {
    errors.push(`${label}.analysis_integrity_status 必须为 pass`)
  }
  if (typeof leg?.stable_eligible !== 'boolean') errors.push(`${label}.stable_eligible 非法或缺失`)
  if (requireStable && leg?.stable_eligible !== true) errors.push(`${label} 未通过分析层 stable_eligible 闸门`)
  for (const field of ['odds', 'model_prob', 'market_prob', 'conservative_prob']) {
    const value = Number(leg?.[field])
    if (!(value > 0) || (field !== 'odds' && value > 1)) errors.push(`${label}.${field} 非法或缺失`)
  }
  const expectedConservative = Math.min(Number(leg?.model_prob), Number(leg?.market_prob))
  if (Number.isFinite(expectedConservative)) {
    requireNear(`${label}.conservative_prob`, leg?.conservative_prob, expectedConservative)
  }
  const expectedEv = Number(leg?.model_prob) * Number(leg?.odds) - 1
  if (leg?.ev != null) requireNear(`${label}.ev`, leg.ev, expectedEv)
  if (requireStable) {
    if (leg?.eligible !== true) errors.push(`${label}.eligible 必须为 true`)
    if (leg?.pool_status !== 'Selling') errors.push(`${label}.pool_status 必须为 Selling`)
    if (typeof leg?.single_allowed !== 'boolean') errors.push(`${label}.single_allowed 非法或缺失`)
    if (typeof leg?.allup_allowed !== 'boolean') errors.push(`${label}.allup_allowed 非法或缺失`)
    if (!Number.isInteger(leg?.max_pass_size) || leg.max_pass_size < 1 || leg.max_pass_size > 8) {
      errors.push(`${label}.max_pass_size 非法或缺失`)
    }
    if (!Number.isFinite(Date.parse(String(leg?.odds_snapshot_at ?? '')))) {
      errors.push(`${label}.odds_snapshot_at 非法或缺失`)
    }
  }
}

function validateSimpleTicket(ticket, label, { formal = false } = {}) {
  const legs = resolveTicketLegs(ticket, label)
  if (legs.length === 0) return
  legs.forEach((leg, index) => validateCurrentLeg(leg, `${label}.legs[${index}]`, formal))
  const matchIds = legs.map(leg => String(leg.analysis_match_id ?? leg.match_id ?? ''))
  if (matchIds.some(id => !id)) errors.push(`${label} 每条腿必须有 analysis_match_id 或 match_id`)
  const sameMatchCoverage =
    legs.length === 2 &&
    new Set(matchIds).size === 1 &&
    /复式|coverage/i.test(String(ticket?.type ?? ''))
  if (new Set(matchIds).size !== matchIds.length && !sameMatchCoverage) {
    errors.push(`${label} 不得重复使用同一场比赛；同场两选必须显式标为复式`)
  }
  if (formal && !sameMatchCoverage && legs.length > 2) errors.push(`${label} 高命中正式票最多 2 场`)

  if (sameMatchCoverage) {
    if (new Set(legs.map(leg => String(leg.market ?? ''))).size !== 1) {
      errors.push(`${label} 同场复式必须属于同一玩法`)
    }
    if (new Set(legs.map(leg => String(leg.handicap ?? ''))).size !== 1) {
      errors.push(`${label} 同场复式必须属于同一盘口线`)
    }
    if (new Set(legs.map(leg => String(leg.selection ?? ''))).size !== legs.length) {
      errors.push(`${label} 同场复式选项不得重复`)
    }
    if (formal && legs.some(leg => leg.single_allowed !== true)) {
      errors.push(`${label} 同场复式的每个选项都必须允许单关`)
    }
  }

  const stakePerCombination = Number(ticket.stake_per_combination ?? 2)
  const conservativeHit = sameMatchCoverage
    ? legs.reduce((sum, leg) => sum + Number(leg.conservative_prob), 0)
    : legs.reduce((product, leg) => product * Number(leg.conservative_prob), 1)
  const modelHit = sameMatchCoverage
    ? legs.reduce((sum, leg) => sum + Number(leg.model_prob), 0)
    : legs.reduce((product, leg) => product * Number(leg.model_prob), 1)
  const totalOdds = sameMatchCoverage
    ? null
    : legs.reduce((product, leg) => product * Number(leg.odds), 1)
  const combinationCount = sameMatchCoverage ? legs.length : 1
  const cost = stakePerCombination * combinationCount
  const expectedNet = sameMatchCoverage
    ? legs.reduce(
        (sum, leg) => sum + Number(leg.model_prob) * stakePerCombination * Number(leg.odds),
        0,
      ) - cost
    : modelHit * stakePerCombination * totalOdds - cost
  requireNear(`${label}.estimated_hit_prob`, ticket.estimated_hit_prob, conservativeHit)
  if (!sameMatchCoverage) requireNear(`${label}.total_odds`, ticket.total_odds, totalOdds)
  requireNear(`${label}.combination_count`, ticket.combination_count, combinationCount, 0)
  requireNear(`${label}.cost_at_2`, ticket.cost_at_2, cost, 0.01)
  requireNear(
    `${label}.expected_net_cny`,
    ticket.expected_net_cny ?? ticket.approximate_expected_net_cny,
    expectedNet,
    0.01,
  )
  if (legs.length >= 3 && /稳|高命中/.test(String(ticket.label ?? ''))) {
    errors.push(`${label} 为 ${legs.length} 场长串，只能标为娱乐票，不得称稳或高命中`)
  }
}

if (currentContract) {
  const rankedLegs = Array.isArray(plan.legs) ? plan.legs : []
  rankedLegs.forEach((leg, index) => validateCurrentLeg(leg, `legs[${index}]`, false))
}

if (plan.objective === 'hit_rate_first') {
  const threshold = Number(plan.gate?.high_hit_threshold ?? 0.65)
  const best = Number(plan.gate?.best_conservative_prob ?? plan.best_available?.conservative_prob ?? -1)
  const overridden = plan.gate?.overridden === true
  const hasTicket = plan.primary_ticket != null
  const decision = plan.decision ?? (hasTicket ? 'BET' : 'SKIP')
  const protocolTickets = raw.protocol_tickets ?? raw.ledger?.protocol_tickets ?? plan.protocol_tickets ?? []
  const ticketProb = Number(plan.primary_ticket?.estimated_hit_prob ?? Number.NaN)

  if (!(threshold > 0 && threshold <= 1)) errors.push(`high_hit_threshold 非法: ${threshold}`)
  if (!(best >= 0 && best <= 1)) errors.push(`best_conservative_prob 非法或缺失: ${best}`)
  if (hasTicket && !(ticketProb >= 0 && ticketProb <= 1)) {
    errors.push(`primary_ticket.estimated_hit_prob 非法或缺失: ${ticketProb}`)
  }
  if (hasTicket) {
    const expectedNet = Number(plan.primary_ticket?.expected_net_cny ?? plan.primary_ticket?.approximate_expected_net_cny)
    if (!Number.isFinite(expectedNet)) {
      errors.push('正式 primary_ticket 必须提供 expected_net_cny 或 approximate_expected_net_cny')
    } else if (expectedNet <= 0) {
      errors.push(`primary_ticket 期望净收益 ${expectedNet}<=0；必须降级为 high_hit_negative_expectation/decision=SKIP，并移入娱乐票而非正式票`)
    }
  }
  if (hasTicket && ticketProb < threshold && !overridden) {
    errors.push(`主票保守命中率 ${ticketProb} 低于高命中线 ${threshold}，无 override 不得生成 primary_ticket`)
  }
  if (best < threshold && !overridden) {
    if (plan.status !== 'no_high_hit_option') errors.push('无高命中候选时 status 必须为 no_high_hit_option')
    if (hasTicket) errors.push(`最高保守概率 ${best} 低于高命中线 ${threshold}，无 override 不得生成 primary_ticket`)
    if (decision !== 'SKIP') errors.push('无高命中候选且未 override 时 decision 必须为 SKIP')
  }
  if (plan.status === 'no_high_hit_option' && !overridden) {
    if (hasTicket) errors.push('no_high_hit_option 且未 override 时 primary_ticket 必须为 null')
    if (decision !== 'SKIP') errors.push('no_high_hit_option 且未 override 时 decision 必须为 SKIP')
    if (Array.isArray(protocolTickets) && protocolTickets.length > 0) {
      errors.push('no_high_hit_option 且未 override 时 protocol_tickets 必须为空')
    }
  }
  if (overridden && !String(plan.gate?.override_reason ?? '').trim()) {
    errors.push('overridden=true 时必须记录 override_reason')
  }
  if (plan.status === 'high_hit_negative_expectation') {
    if (hasTicket) errors.push('high_hit_negative_expectation 时 primary_ticket 必须为 null')
    if (decision !== 'SKIP') errors.push('high_hit_negative_expectation 时 decision 必须为 SKIP')
    if (Array.isArray(protocolTickets) && protocolTickets.length > 0) {
      errors.push('high_hit_negative_expectation 时 protocol_tickets 必须为空')
    }
  }
  if (decision === 'BET' && !hasTicket) errors.push('decision=BET 时必须存在 primary_ticket')
  if (hasTicket && String(plan.primary_ticket?.label ?? '').includes('高命中')) {
    if (ticketProb < threshold) errors.push('低于高命中线的票不得标记为高命中')
  }
  if (hasTicket && currentContract) validateSimpleTicket(plan.primary_ticket, 'primary_ticket', { formal: true })

  const rankedLegs = Array.isArray(plan.legs) ? plan.legs : []
  for (let index = 0; index < rankedLegs.length; index += 1) {
    const probability = Number(rankedLegs[index]?.conservative_prob)
    if (!Number.isFinite(probability)) errors.push(`legs[${index}].conservative_prob 非法或缺失`)
    if (index > 0 && Number(rankedLegs[index - 1]?.conservative_prob) + 1e-12 < probability) {
      errors.push('hit_rate_first 的 legs 必须按 conservative_prob 降序排列')
    }
  }

  const entertainment = Array.isArray(plan.entertainment) ? plan.entertainment : []
  if (currentContract) {
    entertainment.forEach((ticket, index) =>
      validateSimpleTicket(ticket, `entertainment[${index}]`, { formal: false }),
    )
  }
  if (entertainment.length > 1) {
    const ranked = entertainment.map((ticket, index) => {
      const estimated = Number(ticket?.estimated_hit_prob)
      const rank = Number(ticket?.recommendation_rank)
      const hasAdjusted = ticket?.ranking_probability != null
      const rankingProbability = Number(hasAdjusted ? ticket.ranking_probability : estimated)
      if (!(estimated >= 0 && estimated <= 1)) errors.push(`entertainment[${index}].estimated_hit_prob 非法或缺失`)
      if (!Number.isInteger(rank) || rank < 1 || rank > entertainment.length) errors.push(`entertainment[${index}].recommendation_rank 非法或缺失`)
      if (!(rankingProbability >= 0 && rankingProbability <= estimated)) {
        errors.push(`entertainment[${index}].ranking_probability 必须在 0 与 estimated_hit_prob 之间`)
      }
      if (hasAdjusted && !String(ticket?.ranking_adjustment ?? '').trim()) {
        errors.push(`entertainment[${index}] 使用 ranking_probability 时必须记录 ranking_adjustment`)
      }
      return { rank, rankingProbability }
    })
    const ranks = ranked.map(item => item.rank)
    if (new Set(ranks).size !== entertainment.length) errors.push('entertainment.recommendation_rank 不得重复')
    const byRank = [...ranked].sort((left, right) => left.rank - right.rank)
    for (let index = 1; index < byRank.length; index += 1) {
      if (byRank[index - 1].rankingProbability + 1e-12 < byRank[index].rankingProbability) {
        errors.push('hit_rate_first 的多个娱乐/备选票必须按量化后的命中概率降序推荐')
        break
      }
    }
  }
}

if (plan.objective === 'value_first') {
  const minimumLegEv = Number(plan.gate?.minimum_leg_ev ?? 0.03)
  const hasTicket = plan.primary_ticket != null
  const decision = plan.decision ?? (hasTicket ? 'BET' : 'SKIP')
  const protocolTickets = raw.protocol_tickets ?? raw.ledger?.protocol_tickets ?? plan.protocol_tickets ?? []
  if (!(minimumLegEv >= 0 && minimumLegEv < 1)) errors.push(`minimum_leg_ev 非法: ${minimumLegEv}`)

  if (!hasTicket) {
    if (plan.status !== 'no_value_option') errors.push('无价值票时 status 必须为 no_value_option')
    if (decision !== 'SKIP') errors.push('无价值票时 decision 必须为 SKIP')
    if (Array.isArray(protocolTickets) && protocolTickets.length > 0) {
      errors.push('无价值票时 protocol_tickets 必须为空')
    }
  } else {
    const legs = resolveTicketLegs(plan.primary_ticket, 'primary_ticket')
    for (const [index, leg] of legs.entries()) {
      if (currentContract) validateCurrentLeg(leg, `primary_ticket.legs[${index}]`, true)
      const ev = Number(leg?.model_prob) * Number(leg?.odds) - 1
      if (!(ev >= minimumLegEv)) {
        errors.push(`primary_ticket.legs[${index}] EV ${ev} 低于 value_first 门槛 ${minimumLegEv}`)
      }
      if (leg?.ev == null) errors.push(`primary_ticket.legs[${index}].ev 缺失`)
      else requireNear(`primary_ticket.legs[${index}].ev`, leg.ev, ev)
    }
    if (plan.status !== 'ready') errors.push('价值票通过时 status 必须为 ready')
    if (decision !== 'BET') errors.push('价值票通过时 decision 必须为 BET')
    if (currentContract) validateSimpleTicket(plan.primary_ticket, 'primary_ticket', { formal: true })
    const expectedNet = Number(
      plan.primary_ticket?.expected_net_cny ?? plan.primary_ticket?.approximate_expected_net_cny,
    )
    if (!(expectedNet > 0)) errors.push('value_first 正式票 expected_net_cny 必须大于 0')
  }
}

if (plan.objective === 'coverage_profit_first') {
  const ticket = plan.coverage_ticket
  const decision = plan.decision ?? (ticket ? 'BET' : 'SKIP')
  const threshold = Number(plan.gate?.high_hit_threshold ?? 0.65)
  const protocolTickets = raw.protocol_tickets ?? raw.ledger?.protocol_tickets ?? plan.protocol_tickets ?? []

  if (!(threshold > 0 && threshold <= 1)) errors.push(`high_hit_threshold 非法: ${threshold}`)
  if (!ticket) {
    if (plan.status !== 'no_profitable_high_hit_coverage') {
      errors.push('无合格覆盖盈利票时 status 必须为 no_profitable_high_hit_coverage')
    }
    if (decision !== 'SKIP') errors.push('无合格覆盖盈利票时 decision 必须为 SKIP')
    if (Array.isArray(protocolTickets) && protocolTickets.length > 0) {
      errors.push('无合格覆盖盈利票时 protocol_tickets 必须为空')
    }
  } else {
    try {
      if (currentContract) {
        const options = (ticket.groups ?? []).flatMap(group => group.options ?? [])
        options.forEach((option, index) =>
          validateCurrentLeg(option, `coverage_ticket.options[${index}]`, true),
        )
      }
      if (ticket.probability_basis !== 'conservative_prob') {
        errors.push('coverage_ticket.probability_basis 必须为 conservative_prob')
      }
      if (ticket.expected_value_probability_basis !== 'model_prob') {
        errors.push('coverage_ticket.expected_value_probability_basis 必须为 model_prob')
      }
      const profitTarget = ticket.profit_target ?? {}
      const groups = (ticket.groups ?? []).map((group) => ({
        ...group,
        options: (group.options ?? []).map((option) => ({
          ...option,
          probability: option.probability ?? option.conservative_prob,
        })),
      }))
      const recomputed = evaluateCoverageProfit({
        groups,
        stake: ticket.stake_per_combination ?? 2,
        highHitThreshold: threshold,
        minimumProfitNet: profitTarget.minimum_net_cny ?? 0,
        minimumProfitRoi: profitTarget.minimum_roi ?? 0,
        probabilityBasis: ticket.probability_basis ?? 'conservative_prob',
        expectedValueProbabilityBasis: ticket.expected_value_probability_basis ?? 'model_prob',
      })

      if (ticket.type !== 'full_pass_coverage') errors.push('coverage_ticket.type 必须为 full_pass_coverage')
      requireNear('coverage_ticket.combination_count', ticket.combination_count, recomputed.combination_count, 0)
      requireNear('coverage_ticket.cost_cny', ticket.cost_cny, recomputed.cost, 0.01)
      requireNear('coverage_ticket.estimated_hit_prob', ticket.estimated_hit_prob, recomputed.coverage_hit_prob)
      requireNear('coverage_ticket.estimated_profit_prob', ticket.estimated_profit_prob, recomputed.estimated_profit_prob)
      requireNear('coverage_ticket.expected_net_cny', ticket.expected_net_cny, recomputed.expected_net, 0.01)
      requireNear('coverage_ticket.covered_branch_floor_net_cny', ticket.covered_branch_floor_net_cny, recomputed.covered_branch_floor_net, 0.01)
      requireNear('coverage_ticket.covered_branch_floor_roi', ticket.covered_branch_floor_roi, recomputed.covered_branch_floor_roi)
      if (ticket.all_covered_branches_profitable !== recomputed.all_covered_branches_profitable) {
        errors.push('coverage_ticket.all_covered_branches_profitable 与确定性重算不一致')
      }
      if (ticket.all_covered_branches_meet_target !== recomputed.all_covered_branches_meet_target) {
        errors.push('coverage_ticket.all_covered_branches_meet_target 与确定性重算不一致')
      }
      if (!recomputed.ready) errors.push(`coverage_ticket 未通过 ready 闸门: ${recomputed.status}`)
      if (plan.status !== 'ready') errors.push('合格覆盖盈利票的 status 必须为 ready')
      if (decision !== 'BET') errors.push('合格覆盖盈利票的 decision 必须为 BET')
    } catch (error) {
      errors.push(`coverage_ticket 重算失败: ${error.message}`)
    }
  }
}

const returnPool = plan.return_pool
if (returnPool && String(returnPool.contract_version ?? '') !== '2.4.3') {
  const legacyFormal = returnPool.status === 'ready' || returnPool.category === 'protocol_return_pool'
  if (legacyFormal) {
    errors.push('正式 return_pool 必须声明 contract_version=2.4.3 才能通过主选锚点与概率口径校验')
  }
}
if (returnPool && String(returnPool.contract_version ?? '') === '2.4.3') {
  const formal = returnPool.status === 'ready' || returnPool.category === 'protocol_return_pool'
  const policy = returnPool.selection_policy
  const minimumAnchors = Number(returnPool.minimum_primary_anchors ?? 2)
  const alignment = returnPool.selection_alignment ?? {}
  const primaryAnchors = Number(alignment.primary_anchor_count)
  const modelSource = returnPool.model_source

  if (!['model_aligned', 'unrestricted'].includes(policy)) {
    errors.push('return_pool.selection_policy 必须为 model_aligned 或 unrestricted')
  }
  if (!Number.isInteger(minimumAnchors) || minimumAnchors < 0 || minimumAnchors > 4) {
    errors.push('return_pool.minimum_primary_anchors 必须是 0-4 的整数')
  }
  if (!(Number.isInteger(primaryAnchors) && primaryAnchors >= 0 && primaryAnchors <= 4)) {
    errors.push('return_pool.selection_alignment.primary_anchor_count 非法或缺失')
  }
  if (!['formal_analysis', 'calibrated_challenger', 'experience_shadow'].includes(modelSource)) {
    errors.push('return_pool.model_source 必须为 formal_analysis、calibrated_challenger 或 experience_shadow')
  }
  if (typeof alignment.model_aligned !== 'boolean' || alignment.model_aligned !== (primaryAnchors >= minimumAnchors)) {
    errors.push('return_pool.selection_alignment.model_aligned 与主选锚点数量不一致')
  }
  if (formal && policy !== 'model_aligned') {
    errors.push('正式 return_pool 必须使用 selection_policy=model_aligned')
  }
  if (formal && primaryAnchors < minimumAnchors) {
    errors.push(`正式 return_pool 至少需要 ${minimumAnchors} 个市场主选锚点`)
  }
  if (formal && returnPool.model_source === 'experience_shadow') {
    errors.push('experience_shadow 只能用于明确授权的娱乐票，不得生成正式 return_pool')
  }
  if (formal && currentContract) {
    const selections = Array.isArray(returnPool.selections) ? returnPool.selections : []
    if (selections.length !== 4) errors.push('正式 return_pool 必须包含 4 个 selections')
    selections.forEach((selection, index) =>
      validateCurrentLeg(selection, `return_pool.selections[${index}]`, true),
    )
  }
  if (policy === 'unrestricted') {
    if (!String(returnPool.override_reason ?? '').trim()) {
      errors.push('unrestricted return_pool 必须记录 override_reason')
    }
    if (formal || returnPool.category !== 'user_requested_entertainment_override') {
      errors.push('unrestricted return_pool 只能作为 user_requested_entertainment_override')
    }
  }
  if (returnPool.probability_basis !== 'conservative_prob') {
    errors.push('return_pool.probability_basis 必须为 conservative_prob')
  }
  if (returnPool.expected_value_probability_basis !== 'model_prob') {
    errors.push('return_pool.expected_value_probability_basis 必须为 model_prob')
  }

  const selections = Array.isArray(returnPool.selections) ? returnPool.selections : []
  const shouldRecompute = formal || selections.length > 0
  if (shouldRecompute) {
    try {
      if (selections.length !== 4) throw new Error('return_pool 必须包含 4 个 selections')
      const normalizedSelections = selections.map((selection) => ({
        ...selection,
        match_id: selection.match_id ?? selection.analysis_match_id,
      }))
      if (currentContract) {
        normalizedSelections.forEach((selection, index) =>
          validateCurrentLeg(selection, `return_pool.selections[${index}]`, formal),
        )
      }
      const passes = returnPool.passes ?? returnPool.pass_sizes
      const stake = Number(returnPool.stake_per_combination ?? 2)
      const recomputed = evaluateReturnPool({
        selections: normalizedSelections,
        passSizes: passes,
        stake,
        probabilityBasis: returnPool.probability_basis,
        expectedValueProbabilityBasis: returnPool.expected_value_probability_basis,
      })
      const checks = returnPool.official_rule_checks ?? {}
      for (const [key, value] of Object.entries(recomputed.official_rule_checks)) {
        if (checks[key] !== value) errors.push(`return_pool.official_rule_checks.${key} 与确定性重算不一致`)
      }
      if (JSON.stringify(returnPool.passes ?? returnPool.pass_sizes) !== JSON.stringify(recomputed.pass_sizes)) {
        errors.push('return_pool.passes 与确定性重算不一致')
      }
      requireNear('return_pool.combination_count', returnPool.combination_count, recomputed.combination_count, 0)
      requireNear('return_pool.cost_at_2', returnPool.cost_at_2 ?? returnPool.cost, recomputed.cost, 0.01)
      for (const field of [
        'p0',
        'p1',
        'p_at_least_2',
        'p_at_least_3',
        'estimated_profit_prob',
        'expected_payout',
        'expected_net',
        'pair_floor_net',
      ]) {
        requireNear(`return_pool.${field}`, returnPool[field], recomputed[field], field.includes('net') || field === 'expected_payout' ? 0.01 : 1e-6)
      }
      if (returnPool.all_exact_pairs_profitable !== recomputed.all_exact_pairs_profitable) {
        errors.push('return_pool.all_exact_pairs_profitable 与确定性重算不一致')
      }
      const reportedPairs = Array.isArray(returnPool.profit_if_exact_pair)
        ? returnPool.profit_if_exact_pair
        : []
      if (reportedPairs.length !== recomputed.profit_if_exact_pair.length) {
        errors.push('return_pool.profit_if_exact_pair 必须完整包含 6 组恰中两场结果')
      } else {
        for (let index = 0; index < reportedPairs.length; index += 1) {
          const actual = reportedPairs[index]
          const expected = recomputed.profit_if_exact_pair[index]
          if (JSON.stringify(actual.legs) !== JSON.stringify(expected.legs)) {
            errors.push(`return_pool.profit_if_exact_pair[${index}].legs 与确定性重算不一致`)
          }
          for (const field of ['odds_product', 'payout', 'net']) {
            requireNear(
              `return_pool.profit_if_exact_pair[${index}].${field}`,
              actual[field],
              expected[field],
              0.01,
            )
          }
        }
      }
      if (formal && (!recomputed.all_exact_pairs_profitable || recomputed.expected_net <= 0)) {
        errors.push('正式 return_pool 必须同时满足全部恰中两场盈利且 expected_net>0')
      }
      if (returnPool.status === 'pair_coverage_negative_expectation' &&
          (!recomputed.all_exact_pairs_profitable || recomputed.expected_net > 0)) {
        errors.push('pair_coverage_negative_expectation 与确定性重算不一致')
      }
      if (returnPool.status === 'conditional_pair_coverage' && recomputed.all_exact_pairs_profitable) {
        errors.push('conditional_pair_coverage 与确定性重算不一致')
      }
    } catch (error) {
      errors.push(`return_pool 重算失败: ${error.message}`)
    }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, file: resolved, errors }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, file: resolved, status: plan.status, decision: plan.decision ?? null }, null, 2))
