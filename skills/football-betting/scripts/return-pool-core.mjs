export function combinations(items, size, start = 0, prefix = [], out = []) {
  if (prefix.length === size) {
    out.push([...prefix]);
    return out;
  }
  for (let index = start; index <= items.length - (size - prefix.length); index += 1) {
    prefix.push(items[index]);
    combinations(items, size, index + 1, prefix, out);
    prefix.pop();
  }
  return out;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function probabilityFor(leg, basis, index) {
  const value = basis === 'conservative_prob'
    ? (leg.conservative_prob ?? leg.probability)
    : basis === 'model_prob'
      ? leg.model_prob
      : basis === 'probability' || basis.endsWith('_stress')
        ? leg.probability
        : undefined;
  assert(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `invalid ${basis} at selections[${index}]`,
  );
  return value;
}

export function validateSelections(
  selections,
  passSizes,
  stake,
  probabilityBasis = 'conservative_prob',
  expectedValueProbabilityBasis = 'model_prob',
) {
  assert(Array.isArray(selections) && selections.length >= 2 && selections.length <= 20, 'selections must contain 2-20 legs');
  assert(stake > 0 && stake % 2 === 0, 'stakePerCombination must be a positive multiple of 2 yuan');
  assert(
    passSizes.length > 0 && passSizes.every((size) => Number.isInteger(size) && size >= 1 && size <= selections.length),
    'passSizes must contain valid integers between 1 and selections.length',
  );

  const seenMatches = new Set();
  for (const [index, leg] of selections.entries()) {
    assert(leg.match_id, `selections[${index}].match_id is required`);
    assert(!seenMatches.has(leg.match_id), `duplicate match_id: ${leg.match_id}`);
    seenMatches.add(leg.match_id);
    assert(Number.isFinite(leg.odds) && leg.odds > 1, `invalid odds at selections[${index}]`);
    probabilityFor(leg, probabilityBasis, index);
    probabilityFor(leg, expectedValueProbabilityBasis, index);
    assert(leg.pool_status === 'Selling', `selection is not Selling at selections[${index}]`);
    assert(leg.allup_allowed === true, `selection does not allow all-up betting at selections[${index}]`);
    assert(
      Number.isInteger(leg.max_pass_size) && leg.max_pass_size >= 1,
      `invalid max_pass_size at selections[${index}]`,
    );
    assert(leg.odds_snapshot_at, `odds_snapshot_at is required at selections[${index}]`);
  }
}

export function evaluateReturnPool({
  selections,
  passSizes = [2, 3],
  stake = 2,
  probabilityBasis = 'conservative_prob',
  expectedValueProbabilityBasis = 'model_prob',
}) {
  const normalizedPassSizes = [...new Set(passSizes)].sort((left, right) => left - right);
  validateSelections(
    selections,
    normalizedPassSizes,
    stake,
    probabilityBasis,
    expectedValueProbabilityBasis,
  );

  const strictestMaxPassSize = Math.min(...selections.map((leg) => leg.max_pass_size));
  assert(
    normalizedPassSizes.every((size) => size <= strictestMaxPassSize),
    `pass size exceeds strictest official maximum of ${strictestMaxPassSize}`,
  );

  const indices = selections.map((_, index) => index);
  const tickets = normalizedPassSizes.flatMap((size) => combinations(indices, size));
  const cost = stake * tickets.length;
  const ticketCap = (size) => {
    const baseCap = size <= 3 ? 200000 : size <= 5 ? 500000 : 1000000;
    return baseCap * (stake / 2);
  };
  const ticketPayout = (ticket) => {
    const rawPayout = stake * ticket.reduce((product, index) => product * selections[index].odds, 1);
    return Math.round(Math.min(rawPayout, ticketCap(ticket.length)) * 100) / 100;
  };

  let expectedPayout = 0;
  let estimatedProfitProb = 0;
  let breakEvenProb = 0;
  const hitCountProb = Array(selections.length + 1).fill(0);

  for (let mask = 0; mask < 2 ** selections.length; mask += 1) {
    const hits = new Set();
    let coverageStateProb = 1;
    let expectedValueStateProb = 1;
    for (let index = 0; index < selections.length; index += 1) {
      const hit = (mask & (1 << index)) !== 0;
      if (hit) hits.add(index);
      const coverageProbability = probabilityFor(selections[index], probabilityBasis, index);
      const expectedValueProbability = probabilityFor(
        selections[index],
        expectedValueProbabilityBasis,
        index,
      );
      coverageStateProb *= hit ? coverageProbability : 1 - coverageProbability;
      expectedValueStateProb *= hit ? expectedValueProbability : 1 - expectedValueProbability;
    }

    let payout = 0;
    for (const ticket of tickets) {
      if (ticket.every((index) => hits.has(index))) payout += ticketPayout(ticket);
    }

    hitCountProb[hits.size] += coverageStateProb;
    expectedPayout += expectedValueStateProb * payout;
    if (payout > cost) estimatedProfitProb += coverageStateProb;
    if (payout >= cost) breakEvenProb += coverageStateProb;
  }

  const exactPairs = combinations(indices, 2).map((pair) => {
    const payout = tickets
      .filter((ticket) => ticket.every((index) => pair.includes(index)))
      .reduce((sum, ticket) => sum + ticketPayout(ticket), 0);
    return {
      legs: pair.map((index) => selections[index].id ?? selections[index].match_id),
      odds_product: pair.reduce((product, index) => product * selections[index].odds, 1),
      payout,
      net: payout - cost,
    };
  });

  const sumFrom = (minimum) => hitCountProb.slice(minimum).reduce((sum, value) => sum + value, 0);
  return {
    probability_basis: probabilityBasis,
    expected_value_probability_basis: expectedValueProbabilityBasis,
    independence_assumed: true,
    official_rule_checks: {
      all_selling: true,
      all_allup_allowed: true,
      distinct_matches: true,
      pass_size_within_cap: true,
      strictest_max_pass_size: strictestMaxPassSize,
      fixed_odds_snapshot_locked: true,
      ticket_caps_applied: true,
    },
    pass_sizes: normalizedPassSizes,
    combination_count: tickets.length,
    stake_per_combination: stake,
    cost,
    p0: hitCountProb[0] ?? 0,
    p1: hitCountProb[1] ?? 0,
    p_at_least_2: sumFrom(2),
    p_at_least_3: sumFrom(3),
    estimated_profit_prob: estimatedProfitProb,
    break_even_or_better_prob: breakEvenProb,
    expected_payout: expectedPayout,
    expected_net: expectedPayout - cost,
    all_exact_pairs_profitable: exactPairs.every((pair) => pair.net > 0),
    pair_floor_net: Math.min(...exactPairs.map((pair) => pair.net)),
    profit_if_exact_pair: exactPairs,
  };
}
