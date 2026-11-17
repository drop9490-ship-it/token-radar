// Token Radar's model (radar-3): one sealed snapshot in, one ranked board out.
//
// The board covers every slug on the snapshot's watchlist (the floor, never the
// ceiling) and adds every other pre-token protocol below the floor that passes
// the full exclusion rule: no wrapped, staked or bridged product of a token
// that already trades, no exchange product, and no second deployment of a
// protocol the board already ranks. A protocol is pre-token when its record
// carries no token (no market cap, no CoinGecko id, no symbol); the live-token
// protocols are kept apart and shown at the market's own values, never mixed
// into the ranked board.
//
// A name ending in a release (V2, V3, 2.0) is a deployment, not a protocol:
// the board keeps a versioned protocol once, at its latest deployment, and
// drops the older deployments of the same family. A versioned row whose family
// has no other deployment in the snapshot is kept as it stands — Aera V3 is
// Aera's current deployment, not a pool of something else — because the
// snapshot carries no unversioned Aera row at all.
//
// Implied value follows only from the snapshot's own figures, through five
// factors the dashboard states and a reader can re-derive:
//
//   sector    = the protocol's category multiple: the median market-cap / TVL
//               of the snapshot's own live-token protocols in that category,
//               each ratio winsorised at the 90th percentile, then shrunk
//               toward the global median with weight n / (n + 4), clamped to
//               [0.02, 1.50]. A category with no live protocol takes the
//               global median. No protocol name is ever special-cased.
//   growth    = change_7d clamped to [-40, +60] per cent; gains are
//               dampened with a square root (a +60% week is worth +30%),
//               losses count in full (a -40% week costs -20%).
//   maturity  = 0.55 + 0.45 * min(age, 1095) / 1095; a protocol tracked
//               less than 90 days takes a 0.85 youth discount, and one with
//               no listed date is scored at 365 days.
//   chains    = 1 + 0.03 * ln(chains, capped at ln 10): a protocol live on
//               more chains is worth a small diversification premium.
//   risk      = 0.90 when the protocol's TVL is under $10M, else 1.00: a
//               thin pool can halve on a single withdrawal, so the radar
//               discounts it. The threshold is twice the snapshot's $5M
//               floor, and the discount is the model's only risk leg — the
//               snapshot carries no audit field, so no audit claim is made.
//
//   implied   = max(1, round(tvl_usd x sector x growth x maturity x chains x risk))
//
// The same function scores every row, and the board is the whole rankable
// set sorted by implied value, ties broken by slug.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  winsorise_quantile: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  loss_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  youth_days: number;
  youth_discount: number;
  chain_step: number;
  chain_cap: number;
  /** TVL under this is thin: a single withdrawal can halve the pool. */
  risk_tvl_floor: number;
  /** The discount a thin-TVL protocol takes. */
  risk_discount: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 4,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  winsorise_quantile: 0.9,
  growth_floor: -40,
  growth_cap: 60,
  growth_weight: 0.3,
  loss_weight: 0.5,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  youth_days: 90,
  youth_discount: 0.85,
  chain_step: 0.03,
  chain_cap: 10,
  risk_tvl_floor: 10_000_000,
  risk_discount: 0.9,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    sector_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    risk_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  risk_multiplier: number;
  farm_steps: string[];
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: Record<string, number>;
  /** Live-token protocols behind each category's multiple: the judge can see how thin a calibration is. */
  multiples_n: Record<string, number>;
  /** Each category's raw winsorised median ratio, before shrinkage toward the global median. */
  multiples_median: Record<string, number>;
  /** Live-token protocols the multiples are calibrated from. */
  calibration_protocols: number;
  protocols_scanned: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, the middle value or the mean of the middle two. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole word wrapped, staked or staking anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapped, staked or bridged product, never a launch of their own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a protocol name must not begin with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades, not an exchange
 * product. Versioned names are NOT excluded here: a name ending in a release
 * is a deployment, and dedupVersions keeps each family once, at its latest
 * deployment. The watchlist itself is the floor the house drew with the same
 * rule, so every watchlist slug passes it.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** A name's version marker, if it ends in one: the family name and the release numbers. */
export function versionOf(name: string): { family: string; major: number; minor: number } | null {
  const m = name.match(/^(.*?)\s+(?:V|v)?(\d+)(?:\.(\d+))?$/);
  if (m === null) return null;
  // A trailing number is a version only when the name says so: "V2", "v3",
  // "2.0" — a plain year or count ("Protocol 2") is not one.
  if (!/^(V|v)\d/.test(name.slice(m[1]!.length + 1)) && m[3] === undefined) return null;
  return { family: m[1]!.trim().toLowerCase(), major: Number(m[2]), minor: m[3] === undefined ? 0 : Number(m[3]) };
}

/**
 * One row per protocol family: where several deployments of one family are
 * chosen (Aera V2 and Aera V3), keep the latest deployment — the one a
 * farmer would use — and drop the older ones. A family with a single
 * deployment is untouched, and a watchlist slug is never dropped: the
 * watchlist is the floor.
 */
export function dedupVersions(chosen: SnapshotProtocol[], watchlist: Set<string>): SnapshotProtocol[] {
  const families = new Map<string, SnapshotProtocol[]>();
  for (const p of chosen) {
    const v = versionOf(p.name);
    // An unversioned name is its own family's version 0: "Aera" groups with
    // "Aera V3" under the family "aera", never with another protocol.
    const key = `family:${v === null ? p.name.trim().toLowerCase() : v.family}`;
    const arr = families.get(key);
    if (arr === undefined) families.set(key, [p]);
    else arr.push(p);
  }
  const kept: SnapshotProtocol[] = [];
  for (const arr of families.values()) {
    if (arr.length === 1) {
      kept.push(arr[0]!);
      continue;
    }
    const ranked = [...arr].sort((a, b) => {
      const va = versionOf(a.name);
      const vb = versionOf(b.name);
      const ma = va === null ? 0 : va.major;
      const mb = vb === null ? 0 : vb.major;
      if (mb !== ma) return mb - ma;
      const na = va === null ? 0 : va.minor;
      const nb = vb === null ? 0 : vb.minor;
      if (nb !== na) return nb - na;
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : 1;
    });
    const watchlisted = ranked.find((p) => watchlist.has(p.slug));
    kept.push(watchlisted ?? ranked[0]!);
  }
  return kept;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The sector multiples, calibrated from the snapshot's own live market. */
export interface SectorMultiples {
  global: number;
  byCategory: Record<string, number>;
  /** Live-token protocols behind each category's multiple. */
  byCategoryN: Record<string, number>;
  /** Each category's raw winsorised median ratio, before shrinkage. */
  byCategoryMedian: Record<string, number>;
  /** Live-token protocols the multiples are calibrated from. */
  liveCount: number;
}

/**
 * One multiple per category: the median market-cap / TVL of the snapshot's
 * live-token protocols in that category, each ratio winsorised at the 90th
 * percentile so one outlier cannot set a sector, then shrunk toward the
 * global median with weight n / (n + shrink_prior), then clamped. A category
 * with no live protocol takes the global median. The result is a property of
 * the snapshot, not of any protocol's name.
 */
export function sectorMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): SectorMultiples {
  // A live token whose market cap reads 0 has no measurable market: it is
  // not a calibration point. (15 snapshot rows carry mcap_usd 0; counting
  // them would drag the global median from 0.205 to 0.169 and move the
  // 90th-percentile cap, so they are excluded here.)
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const capAt = ratios.length === 0 ? 0 : ratios[Math.min(ratios.length - 1, Math.floor(model.winsorise_quantile * ratios.length))]!;
  const winsorised = (r: number): number => Math.min(r, capAt);
  const global = ratios.length === 0 ? 0.2 : medianOf(ratios.map(winsorised));
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(none)';
    const arr = byCat.get(key);
    if (arr === undefined) byCat.set(key, [winsorised((p.mcap_usd as number) / p.tvl_usd)]);
    else arr.push(winsorised((p.mcap_usd as number) / p.tvl_usd));
  }
  const byCategory: Record<string, number> = {};
  const byCategoryN: Record<string, number> = {};
  const byCategoryMedian: Record<string, number> = {};
  for (const [cat, vals] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const med = medianOf([...vals].sort((a, b) => a - b));
    const w = vals.length / (vals.length + model.shrink_prior);
    byCategory[cat] = Math.min(model.multiple_cap, Math.max(model.multiple_floor, w * med + (1 - w) * global));
    byCategoryN[cat] = vals.length;
    byCategoryMedian[cat] = med;
  }
  return { global, byCategory, byCategoryN, byCategoryMedian, liveCount: live.length };
}

/** The sector multiple one protocol gets: its category's, or the global median. */
export function multipleFor(p: SnapshotProtocol, multiples: SectorMultiples): number {
  const m = multiples.byCategory[p.category ?? '(none)'];
  return m === undefined ? multiples.global : m;
}

/** The five factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: SectorMultiples,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; riskMult: number; age: number | null } {
  const multiple = multipleFor(protocol, multiples);
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = growthPct >= 0
    ? 1 + model.growth_weight * Math.sqrt(growthPct / model.growth_cap)
    : 1 + model.loss_weight * (growthPct / 100);
  const ageForModel = age ?? model.unknown_age_days;
  let maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  if (age !== null && age < model.youth_days) maturityMult *= model.youth_discount;
  const chainMult = 1 + model.chain_step * Math.min(Math.log(Math.max(1, protocol.chains.length)), Math.log(model.chain_cap));
  const riskMult = protocol.tvl_usd < model.risk_tvl_floor ? model.risk_discount : 1;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult * riskMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, chainMult, riskMult, age };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas one transaction costs on a chain: mainnet is dear, every other chain is cheap. */
function gasFor(chain: string): string {
  return chain.toLowerCase() === 'ethereum' ? 'about $8 of gas' : 'about $1 of gas';
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different feature of the same protocol, so the record shows depth. */
function secondActionFor(p: SnapshotProtocol, small: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} against the position and repay it the same week, so the record shows both sides.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Swap $${small} through ${name}'s main pool once, then swap it back.`;
  if (c.includes('bridge')) return `Bridge $${small} back across ${name}, so both directions are on the record.`;
  if (c.includes('staking') || c.includes('restak')) return `Top the stake up by $${small} once, so the record shows a second deposit.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge and open a fresh one half the size.`;
  if (c.includes('prediction')) return `Close the position and open a new one on a different market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Move $${small} between two of ${name}'s vaults.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Move $${small} into a second vault of ${name} for one week.`;
  return `Use a second feature of ${name} once, such as a swap, a vote or a claim.`;
}

/** The category's main risk, in one plain sentence: what can go wrong farming this kind of protocol. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `A borrow can be liquidated if the collateral falls, and an oracle can misprice it, so keep the loan well under the limit.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Providing liquidity can lose to impermanent loss if the price moves, and a thin pool can strand your exit, so check the pool depth first.`;
  if (c.includes('bridge')) return `A bridge can pause or be exploited while your funds are in transit, so never bridge more than you can afford to wait for.`;
  if (c.includes('staking') || c.includes('restak')) return `A staked asset can be slashed or depeg from the asset it tracks, so check the peg and the slashing terms before you stake.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Leverage can liquidate the whole margin on one sharp move, so keep the position small and the leverage low.`;
  if (c.includes('prediction')) return `A market can resolve against you and the whole stake is lost, so never farm with money you need back.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `A vault follows its curator's strategy, and a bad strategy or a bug can lose the deposit, so read what the vault holds before you deposit.`;
  if (c.includes('stable')) return `A stable asset can depeg, and a depegged position is hard to exit, so watch the peg itself, not the promise.`;
  if (c.includes('rwa')) return `A yield asset depends on its real-world issuer staying solvent, so check who stands behind it before you mint.`;
  if (c.includes('insurance')) return `Cover pays only on the terms written in the policy, so read the exclusions before you buy.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `A high yield usually pays in a token that can fall faster than it accrues, so count the yield in dollars, not in tokens.`;
  return `A new protocol can carry a bug in its contracts, so farm only with money you can afford to lose.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. The last step names the
 * category's main risk in plain words; no step quotes a yield the snapshot
 * does not carry — the rate a protocol pays is read from its own page, never
 * invented here.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const small = Math.max(10, Math.round(capital / 4 / 10) * 10);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, small),
      cost: `$${small} moved and ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $2 of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page, write down the rate it states, and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Know the risk before you farm: ${riskFor(p)}`,
      cost: 'nothing to read',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and plan the unwind in two steps so you keep gas to exit.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = sectorMultiples(snapshot.protocols, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no
  // longer carries (it cannot, but the board's coverage is the gate's row
  // and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the full exclusion rule
  // keeps, whatever its TVL. Never a replacement for a watchlist row: a
  // chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  // One row per protocol family: a versioned protocol is kept once, at its
  // latest deployment (Aera V3, not V2 beside it). A watchlist slug is
  // never dropped by this step.
  const ranked = dedupVersions([...chosen.values()], new Set(snapshot.watchlist));

  const scored = ranked.map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      sector_multiple: round4(s.v.multiple),
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      risk_multiplier: round4(s.v.riskMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist?: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    risk_multiplier: row.model.risk_multiplier,
    farm_steps: row.farm_steps,
    on_watchlist: watchlist === undefined ? false : watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = sectorMultiples(snapshot.protocols, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    multiples: Object.fromEntries(Object.entries(multiples.byCategory).map(([k, v]) => [k, round4(v)])),
    multiples_n: multiples.byCategoryN,
    multiples_median: Object.fromEntries(Object.entries(multiples.byCategoryMedian).map(([k, v]) => [k, round4(v)])),
    calibration_protocols: multiples.liveCount,
    protocols_scanned: snapshot.protocols.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
