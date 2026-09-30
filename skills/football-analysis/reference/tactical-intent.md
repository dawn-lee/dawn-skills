# Tactical Intent Analysis Guide

> ⚠️ 执行时请使用中文版 `tactical-intent.zh.md`。本英文文件仅作原始备份。

> 中文执行摘要见 `../SKILL.md` 第 5 节。本文档为详细战术参考。
> 当前口径：H2H≤3 短克星不触发降档；战术红旗触发双向 λ 修正见 `../reference/red-flags.md`。

This reference supports Step 2 (战术意图) of the prediction workflow. It explains how
to infer tactical approach from fundamentals + squad, and how tactical intent
modifies season-average xG for single-match prediction.

## Why This Exists

On 2026-07-18, Bodø/Glimt (xG 2.91, league-best attack) hosted Fredrikstad
(11th, relegation battle). The model predicted 3-4 goals and a 让-2 win.
**Actual result: 1-0** (penalty only). Fredrikstad parked a 5-4-1 bus, their
keeper played out of his mind, and Bodø's season xG was irrelevant against a
packed defense.

The root cause: the model analyzed **who was playing** (squad, injuries) but
not **how they would play** (tactical intent). A relegation team away at the
champions is a textbook bus-parking scenario, and every signal pointed to it
— but none of the existing steps explicitly asked the tactical question.

This guide ensures that question is always asked.

---

## The 5 Bus-Parking Triggers

A team will likely park the bus (5-4-1 / 5-3-2 low block) when these
conditions are met. **If ≥3 are true, assume bus-parking until proven
otherwise.**

| # | Trigger | Why it matters |
|---|---------|---------------|
| 1 | Clear underdog (win odds > 3.0, or 2+ positions below) | They know they can't outplay the opponent |
| 2 | Playing away | Home crowd + away disadvantage → defensive setup |
| 3 | Relegation battle (bottom 4, or within 3 pts of drop zone) | 1 point is survival; 0-3 points difference = relegation |
| 4 | Opponent has dominant attack (top 3 league scoring or xG) | Attacking = suicide against a superior offense |
| 5 | No incentive to attack (not chasing a deficit, not at home needing to entertain) | Nothing to gain from opening up |

### Worked Example: Bodø/Glimt vs Fredrikstad (2026-07-18)

| Trigger | True? | Evidence |
|---------|:---:|---------|
| Underdog | ✓ | Fredrikstad 11th vs Bodø 3rd; win odds > 4.0 |
| Away | ✓ | Fredrikstad traveling to Bodø |
| Relegation battle | ✓ | 11th, only 2 pts above drop zone |
| Opponent dominant attack | ✓ | Bodø xG 2.91, league #1, home avg 3.2 goals |
| No incentive to attack | ✓ | Away, chasing 1 point not 3 |

**5/5 triggers → definitive bus-parking.** The model should have assumed
Fredrikstad would play 5-4-1 low block and modified Bodø's xG down by
50-60%. Instead, season xG 2.91 was used directly → predicted 3-4 goals →
actual 1-0.

---

## Tactical xG Modifiers

Season-average xG reflects performance across all opponents and tactical
situations. A single match against a specific tactical setup can deviate
massively. Apply these modifiers to the favorite's xG when estimating
single-match expected goals.

| Tactical scenario | Favorite xG modifier | Underdog xG modifier | Notes |
|---|---|---|---|
| Low block / parked bus | ×0.5-0.7 | ×0.6-0.8 | Favorite gets fewer but lower-quality chances; underdog gets counter chances |
| Open play, both attack | ×1.0 | ×1.0 | Season average applies |
| Underdog counter vs high line | ×0.9 | ×1.1-1.3 | Underdog fewer chances but higher quality (1-on-1s) |
| Must-win chase (losing 1st leg) | ×1.2-1.4 | ×0.8 | Favorite over-commits, inflates xG but exposes defense |
| Derby / rivalry (open) | ×1.0-1.2 | ×1.0-1.2 | Emotion → more attacking, more goals |
| Dead rubber (nothing at stake) | ×0.8-0.9 | ×0.8-0.9 | Lower intensity, fewer goals |

### How to Apply

1. Identify the tactical scenario from the 5 triggers above
2. Apply the modifier to BOTH teams' season xG
3. Use the **modified** xG for EV calculation and score prediction
4. If modified xG says "1-2 goals" but you predicted "3-4 goals" → you have
   a contradiction. The tactical modifier wins.

### Worked Example

Bodø/Glimt season xG: 2.91
Fredrikstad tactical scenario: Low block (5/5 triggers)
Modifier: ×0.55 (strong bus-parking signal)

**Effective Bodø xG this match: 2.91 × 0.55 ≈ 1.6**

This means Bodø is expected to create ~1.6 expected goals, not 2.9.
Translated to score prediction: most likely 1-0 or 2-0, NOT 3-0 or 4-0.
This would have correctly downgraded the 让-2胜 recommendation to 让-2平/负.

---

## Formation Inference

You usually can't get the confirmed formation before kickoff. Infer it from:

1. **Last 3 matches formation history** (fotmob.com match archive)
   - If all 3 used 5-4-1 → likely continues, especially vs strong opponent
   - If they switched to 4-3-3 recently → may be tactical adaptation
2. **Available personnel** (from squad analysis)
   - Only 1 fit striker → likely 4-5-1 or 5-4-1
   - 3 fit CBs and no fullbacks → 3-5-2 or 5-3-2
   - Key creative midfielders injured → more defensive shape
3. **Manager tendencies** (search `"<manager> tactical style formation"`)
   - Some managers always park the bus vs bigger teams (e.g., Sean Dyche)
   - Others always attack regardless of opponent
4. **Match context**
   - Must-not-lose → defensive
   - Must-win → attacking
   - Away at champion → defensive (unless chasing aggregate deficit)

---

## Game Script Templates

After Q1-Q4, write a 1-2 sentence narrative. This must be consistent with
the final prediction. Common templates:

### Template A: Bus-Parking (most common cause of upset)
"Team A dominates possession but faces a low block; Team B sits deep and
counters. Expect frustration, few clear chances, 1-0 or 0-0."
→ Score: 1:0, 0:0 | Goals: 0-2 | Handicap: favorite -1 平/负, -2 负

### Template B: Open Exchange
"Both teams attack, mid-table with nothing to lose. End-to-end, goals
likely."
→ Score: 2:1, 1:2, 2:2 | Goals: 3+ | Over 2.5

### Template C: Counter-Attack Trap
"Team A presses high and commits; Team B absorbs and counters into space.
A may score but B will get 1-on-1s."
→ Score: 2:1, 1:1 | Goals: 2-3 | Watch for B scoring against run of play

### Template D: Must-Win Chase
"Team A must win (trailing in standings/aggregate). Over-commits early,
exposes defense. High-scoring but risky."
→ Score: 2:1, 3:1, 1:2 | Goals: 3+ | Either team can score

### Template E: Dead Rubber
"Nothing at stake for either side. Low intensity, rotations, fewer goals."
→ Score: 1:0, 1:1, 0:0 | Goals: 0-2 | Under 2.5

---

## Contradiction Check (Mandatory)

Before finalizing the prediction, check for tactical contradictions:

| If tactical intent says... | But prediction says... | Verdict |
|---|---|---|
| Bus-parking, few goals | 3-4 goals, over 2.5 | ❌ Contradiction — fix prediction |
| Low block, favorite frustrated | 让-2胜, 3:0 | ❌ Contradiction — downgrade to 让-2平/负 |
| Open play, both attack | 0-0, under 2.5 | ❌ Contradiction — increase goals |
| Must-win chase, high scoring | 1:0, under 2.5 | ❌ Contradiction — increase goals |
| Dead rubber, low intensity | 3:0, over 2.5 | ❌ Contradiction — decrease goals |

**Rule: Tactical intent always wins over season-average xG.** A team's 2.91
season xG does not guarantee 3 goals against a parked bus. If the tactical
analysis says "bus, 1-0 likely" then the prediction must be 1-0, not 3-0.

---

## Quick Reference: When to Suspect Bus-Parking

Ask yourself these 3 questions for every match. If you answer "yes" to all
3, apply the tactical xG modifier (×0.5-0.7 to favorite) BEFORE doing EV
and score prediction.

1. Is the away team a relegation candidate or clear underdog?
2. Is the home team a top-3 attack in the league?
3. Is there no reason for the away team to attack (not chasing a deficit)?

**Yes-Yes-Yes = bus-parking. Modify xG. Predict low-scoring. Default
handicap to 平/负 on deep lines.**

This single check would have prevented the Bodø/Glimt 1-0 failure.
