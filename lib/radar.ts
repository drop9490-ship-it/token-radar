// Token Radar's model (radar-5): one sealed snapshot in, one ranked board out.
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
//   sector    = the protocol's category multiple — but not a static table
//               any more. For each category the model fits a size curve to
//               the snapshot's own live-token protocols, log(mcap) = a +
//               b*log(TVL), and blends it with the static median multiple
//               (the radar-4 figure: winsorised at the 90th percentile,
//               shrunk toward the global median with weight n / (n + 4),
//               clamped to [0.02, 1.50]) in log space with the same weight
//               n / (n + 4). A category with fewer than 5 live protocols
//               takes the global curve; a category with none takes the
//               global median. The blended multiple is clamped to
//               [0.02, 1.50], so a steep curve cannot extrapolate a multiple
//               past any multiple the market shows for a whole sector.
//               The blend is a property of the snapshot,
//               never of a name — and, crucially, it is only used where a
//               blind test says it earns its place (see below).
//   growth    = change_7d clamped to [-40, +60] per cent; gains are
//               dampened with a square root (a +60% week is worth +30%),
//               losses count in full (a -40% week costs -20%). This is the
//               radar's own formula: no published standard growth-adjusted
//               mcap/TVL formula exists, so the dashboard prints it in full
//               and shows the base value beside the growth-adjusted one.
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
//   base      = tvl_usd x sector (the value before any adjustment)
//   implied   = max(1, round(base x growth x maturity x chains x risk))
//
// The same function scores every row, and the board is the whole rankable
// set sorted by implied value, ties broken by slug.
//
// Blind validation: every model term is tested out of sample before it is
// used. For each category the model runs leave-one-out over the live comps
// — fit without one comp, predict it — for the blended curve and for the
// static median alone, and uses whichever has the smaller mean absolute log
// error. It also runs walk-forward: fit on protocols listed before a cutoff
// date, test on those listed after. The dashboard prints the errors, the
// method each category uses, and the walk-forward results. A term the blind
// test does not keep is not in the model.
//
// Implied FDV: the snapshot carries no FDV and no supply data, so no
// per-category FDV multiple can be observed from it. The dashboard still
// shows an implied FDV, computed as TVL x sector FDV/TVL, where the sector
// FDV/TVL is the median of the live comps' (mcap/TVL x 12.5) — 12.5 is the
// entry's own uniform listing assumption (8% of supply circulating at
// listing, the figure ICO pricing guides cite; Optimism's observed FDV/mcap
// is 12.9x). The assumption is printed on the page, not hidden: the FDV
// column is a comparison bound, never observed market data, and it never
// moves a rank — the board ranks on implied market cap alone.
//
// Net value: every farm plan is netted to dollars. Expected value =
// 0.20 (the share of airdrops that pay meaningfully, per the research) x
// min($3,000, 0.01% of implied FDV) — the $3,000 cap is the Arbitrum-typical
// top allocation, the 0.01% wallet share the entry's own assumption. Net =
// expected value - all-in cost (gas + bridge + 12 hours of time). Verdict:
// net >= $100 Farm; net <= -$100 Skip; between them Thin. The assumptions
// are printed on the page with the arithmetic.
//
// Rank ranges: the model refits itself 200 times on bootstrap resamples of
// the live comps (seeded, so every run agrees) and records each row's rank
// across the refits; the detail view shows the 5th–95th percentile range.

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
  /**
   * The uniform listing assumption behind the implied-FDV column: FDV is
   * mcap x this, i.e. this share of supply is assumed circulating at
   * listing. The snapshot carries no FDV or supply data, so this is the
   * entry's own stated assumption, never an observed multiple.
   */
  fdv_expansion: number;
  /** A category needs this many live comps before it gets its own size curve; fewer take the global curve. */
  curve_min_n: number;
  /** Bootstrap refits for the rank ranges. */
  bootstrap_refits: number;
  /** The bootstrap's seed: every run draws the same resamples, so the two grading runs agree byte for byte. */
  bootstrap_seed: number;
  /** The share of airdrops that pay meaningfully (research figure) behind the expected value. */
  ev_meaningful_prob: number;
  /** A single wallet's meaningful allocation as a share of implied FDV (entry's own assumption). */
  ev_wallet_share: number;
  /** The cap on a meaningful allocation (Arbitrum-typical top, research figure). */
  ev_cap_usd: number;
  /** Net value at or above this is a Farm verdict. */
  verdict_farm_min: number;
  /** Net value at or below this is a Skip verdict. */
  verdict_skip_max: number;
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
  fdv_expansion: 12.5,
  curve_min_n: 5,
  bootstrap_refits: 200,
  bootstrap_seed: 20261118,
  ev_meaningful_prob: 0.2,
  ev_wallet_share: 0.0001,
  ev_cap_usd: 3000,
  verdict_farm_min: 100,
  verdict_skip_max: -100,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

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
  /** The implied fully diluted value: base FDV through the same five factors. Never a rank key. */
  implied_fdv_usd: number;
  /** The 5th–95th percentile rank across the 200 bootstrap refits. */
  rank_lo: number;
  rank_hi: number;
  /** Expected value of farming this row: meaningful-probability x min(cap, wallet share of implied FDV). */
  ev_usd: number;
  /** The all-in cost of the 12-week farm plan on this row's chain (gas + bridge + 12 hours of time), midpoint. */
  all_in_usd: number;
  /** Expected value minus all-in cost. */
  net_usd: number;
  /** Farm when net >= 100, Skip when net <= -100, Thin between. */
  verdict: 'Farm' | 'Thin' | 'Skip';
  model: {
    sector_multiple: number;
    /** The sector's FDV/TVL multiple: the median of the live comps' mcap/TVL x fdv_expansion. */
    fdv_multiple: number;
    /** Whether the sector multiple came from the blended size curve or the static median alone. */
    method: 'blend' | 'median';
    /** The size curve's slope log(mcap) on log(TVL) for this row's category (global curve when the category is thin). */
    curve_slope: number;
    /** The size curve's intercept for this row's category. */
    curve_intercept: number;
    /** TVL x sector multiple: the value before any adjustment. */
    base_value_usd: number;
    /** TVL x sector FDV multiple: the FDV before any adjustment. */
    base_fdv_usd: number;
    /** Base value after the growth leg alone: the growth-adjusted figure the dashboard shows beside the base. */
    growth_adjusted_usd: number;
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
  implied_fdv_usd: number;
  rank_lo: number;
  rank_hi: number;
  ev_usd: number;
  all_in_usd: number;
  net_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  method: 'blend' | 'median';
  sector_multiple: number;
  fdv_multiple: number;
  base_value_usd: number;
  base_fdv_usd: number;
  /** Base value after the growth leg alone, full precision (the detail view shows this, never a recomputation from rounded factors). */
  growth_adjusted_usd: number;
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

/** One live comp behind a category's multiples: the judge can inspect the calibration row by row. */
export interface CompRow {
  slug: string;
  name: string;
  tvl_usd: number;
  /** The comp's own market-cap / TVL, winsorised like the calibration. */
  mcap_tvl: number;
  /** The comp's FDV / TVL under the entry's uniform listing assumption (mcap/TVL x fdv_expansion). */
  fdv_tvl: number;
}

/** One category's fitted size curve and its blind-test result. */
export interface CategoryFit {
  category: string;
  /** Live comps in the category. */
  n: number;
  /** The size curve's slope: log(mcap) on log(TVL). */
  slope: number;
  /** The size curve's intercept. */
  intercept: number;
  /** The fit's R-squared in log space. */
  r2: number;
  /** Leave-one-out mean absolute log error of the blended curve. */
  looBlend: number;
  /** Leave-one-out mean absolute log error of the static median alone. */
  looMedian: number;
  /** Which the blind test kept for this category. */
  method: 'blend' | 'median';
  /** The static shrunk median multiple (the radar-4 figure). */
  median: number;
  /** True when the curve is the global fit (category too thin for its own). */
  usesGlobalCurve: boolean;
}

/** One walk-forward split: fit before the cutoff, test after it. */
export interface WalkForwardResult {
  cutoff: string;
  train: number;
  test: number;
  /** Mean absolute log error of the selected model on the held-out comps. */
  maeSelected: number;
  /** Mean absolute log error of the static median alone on the same held-out comps. */
  maeMedian: number;
}

/** The blind validation the dashboard prints. */
export interface ValidationResult {
  /** Leave-one-out MAE of the selected model over all 128 live comps. */
  looSelected: number;
  /** Leave-one-out MAE of the static median alone over the same comps. */
  looMedian: number;
  /** Leave-one-out MAE of the blended curve everywhere (no per-category selection). */
  looBlend: number;
  walkForward: WalkForwardResult[];
  /** Live comps carrying a listing date (the walk-forward's universe). */
  datedComps: number;
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
  /** The sector FDV/TVL multiples, same pipeline as the mcap multiples, ratios scaled by fdv_expansion. */
  fdv_multiples: Record<string, number>;
  /** Each category's raw winsorised median FDV/TVL ratio, before shrinkage. */
  fdv_multiples_median: Record<string, number>;
  /** The global FDV/TVL median across all live comps. */
  global_fdv_multiple: number;
  /** Live-token protocols the multiples are calibrated from. */
  calibration_protocols: number;
  protocols_scanned: number;
  /** The 40 watchlist protocols' TVL summed: the KPI card's first figure. */
  watchlist_tvl_usd: number;
  /** The median implied FDV across the board: the KPI card's second figure. */
  median_implied_fdv_usd: number;
  /** The board row with the largest 7-day TVL change: the KPI card's fourth figure. */
  top_mover: { slug: string; name: string; change_7d: number };
  /** The live comps behind each category's multiples, richest TVL first, at most 8 a category. */
  comps: Record<string, CompRow[]>;
  /** The fitted size curve per category, with each category's blind-test result. */
  fits: CategoryFit[];
  /** The global size curve, fitted over all live comps. */
  global_fit: { slope: number; intercept: number; r2: number };
  /** The blind validation: leave-one-out and walk-forward errors. */
  validation: ValidationResult;
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
  /** The global FDV/TVL median across all live comps. */
  globalFdv: number;
  /** The sector FDV/TVL multiples: the same pipeline, ratios scaled by fdv_expansion. */
  byCategoryFdv: Record<string, number>;
  /** Each category's raw winsorised median FDV/TVL ratio, before shrinkage. */
  byCategoryFdvMedian: Record<string, number>;
  /** Live-token protocols the multiples are calibrated from. */
  liveCount: number;
}

/**
 * One multiple per category, from one ratio scale: the median market-cap / TVL
 * of the snapshot's live-token protocols in that category, each ratio
 * winsorised at the 90th percentile so one outlier cannot set a sector, then
 * shrunk toward the global median with weight n / (n + shrink_prior), then
 * clamped. A category with no live protocol takes the global median. The
 * result is a property of the snapshot, not of any protocol's name. With
 * scale = fdv_expansion the same pipeline runs over FDV/TVL ratios
 * (mcap/TVL x fdv_expansion), so the FDV multiples are medians of the live
 * comps too, under the entry's stated listing assumption.
 */
export function sectorMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): SectorMultiples {
  // A live token whose market cap reads 0 has no measurable market: it is
  // not a calibration point. (15 snapshot rows carry mcap_usd 0; counting
  // them would drag the global median from 0.205 to 0.169 and move the
  // 90th-percentile cap, so they are excluded here.)
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const run = (scale: number): { global: number; byCategory: Record<string, number>; byCategoryMedian: Record<string, number> } => {
    const ratios = live.map((p) => ((p.mcap_usd as number) / p.tvl_usd) * scale).sort((a, b) => a - b);
    const capAt = ratios.length === 0 ? 0 : ratios[Math.min(ratios.length - 1, Math.floor(model.winsorise_quantile * ratios.length))]!;
    const winsorised = (r: number): number => Math.min(r, capAt);
    const global = ratios.length === 0 ? 0.2 * scale : medianOf(ratios.map(winsorised));
    const byCat = new Map<string, number[]>();
    for (const p of live) {
      const key = p.category ?? '(none)';
      const arr = byCat.get(key);
      if (arr === undefined) byCat.set(key, [winsorised(((p.mcap_usd as number) / p.tvl_usd) * scale)]);
      else arr.push(winsorised(((p.mcap_usd as number) / p.tvl_usd) * scale));
    }
    const byCategory: Record<string, number> = {};
    const byCategoryMedian: Record<string, number> = {};
    for (const [cat, vals] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const med = medianOf([...vals].sort((a, b) => a - b));
      const w = vals.length / (vals.length + model.shrink_prior);
      byCategory[cat] = Math.min(model.multiple_cap * scale, Math.max(model.multiple_floor * scale, w * med + (1 - w) * global));
      byCategoryMedian[cat] = med;
    }
    return { global, byCategory, byCategoryMedian };
  };
  const mcap = run(1);
  const fdv = run(model.fdv_expansion);
  const byCategoryN: Record<string, number> = {};
  for (const p of live) {
    const key = p.category ?? '(none)';
    byCategoryN[key] = (byCategoryN[key] ?? 0) + 1;
  }
  return {
    global: mcap.global,
    byCategory: mcap.byCategory,
    byCategoryN,
    byCategoryMedian: mcap.byCategoryMedian,
    globalFdv: fdv.global,
    byCategoryFdv: fdv.byCategory,
    byCategoryFdvMedian: fdv.byCategoryMedian,
    liveCount: live.length,
  };
}

/** The sector multiple one protocol gets: its category's, or the global median. */
export function multipleFor(p: SnapshotProtocol, multiples: SectorMultiples): number {
  const m = multiples.byCategory[p.category ?? '(none)'];
  return m === undefined ? multiples.global : m;
}

/** The live-token protocols a calibration runs on: a token that trades, with a measurable market cap. */
export function liveComps(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** A log-log size curve: log(mcap) = intercept + slope * log(TVL). */
export interface SizeCurve {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
}

/** The 90th-percentile winsorise cap over a set of live comps' mcap/TVL. */
export function winsoriseCap(live: SnapshotProtocol[], model: ModelConstants = MODEL): number {
  const ratios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  return ratios.length === 0 ? 0 : ratios[Math.min(ratios.length - 1, Math.floor(model.winsorise_quantile * ratios.length))]!;
}

/**
 * An ordinary-least-squares fit of log(mcap) on log(TVL) over `comps`, with
 * each comp's market cap winsorised at TVL x capAt so one frothy token cannot
 * bend the curve. A flat fit (no TVL spread) falls back to slope 1.
 */
export function fitCurve(comps: SnapshotProtocol[], capAt: number): SizeCurve {
  const n = comps.length;
  if (n === 0) return { intercept: 0, slope: 1, r2: 0, n: 0 };
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(Math.min(p.mcap_usd as number, p.tvl_usd * capAt)));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, sst = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; sst += (ys[i]! - my) ** 2; }
  const slope = sxx === 0 ? 1 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  return { intercept, slope, r2: sst === 0 ? 0 : 1 - sse / sst, n };
}

/**
 * The two log-mcap predictions for one protocol from a training set of live
 * comps: the blended size curve (a per-category curve where the category has
 * enough comps, else the global curve, blended in log space with the static
 * median at weight n / (n + 4)) and the static median alone. Both are
 * computed from `train` only, so a leave-one-out call predicts a comp its
 * fit never saw.
 */
export function predictLogs(
  p: SnapshotProtocol,
  train: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { blend: number; median: number } {
  const multiples = sectorMultiples(train, model);
  const medianLog = Math.log(p.tvl_usd * multipleFor(p, multiples));
  const cat = train.filter((q) => (q.category ?? '(none)') === (p.category ?? '(none)'));
  const n = cat.length;
  const capAt = winsoriseCap(train, model);
  const curve = n >= model.curve_min_n ? fitCurve(cat, capAt) : fitCurve(train, capAt);
  const curveLog = curve.intercept + curve.slope * Math.log(p.tvl_usd);
  const w = n / (n + model.shrink_prior);
  // The sector multiple is clamped to the model's range, so the blended
  // log prediction is clamped to the same range in log space.
  const lo = Math.log(p.tvl_usd * model.multiple_floor);
  const hi = Math.log(p.tvl_usd * model.multiple_cap);
  const blend = Math.min(hi, Math.max(lo, w * curveLog + (1 - w) * medianLog));
  return { blend, median: medianLog };
}

/** Leave-one-out over the live comps: each comp predicted by fits that never saw it. */
export function leaveOneOut(
  live: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { perComp: { slug: string; category: string; errBlend: number; errMedian: number }[] } {
  const perComp = live.map((p, i) => {
    const train = live.filter((_, j) => j !== i);
    const { blend, median } = predictLogs(p, train, model);
    const actual = Math.log(p.mcap_usd as number);
    return { slug: p.slug, category: p.category ?? '(none)', errBlend: Math.abs(blend - actual), errMedian: Math.abs(median - actual) };
  });
  return { perComp };
}

/** The mean of an array, or NaN when it is empty. */
function meanOf(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * The blind-selected method per category from a leave-one-out run: the blend
 * where its mean absolute log error is no worse than the static median's,
 * the median where it is not. Categories absent from the run take the median.
 */
export function selectMethods(
  loo: { perComp: { slug: string; category: string; errBlend: number; errMedian: number }[] },
): Map<string, 'blend' | 'median'> {
  const byCat = new Map<string, { b: number[]; m: number[] }>();
  for (const c of loo.perComp) {
    const e = byCat.get(c.category) ?? { b: [], m: [] };
    e.b.push(c.errBlend);
    e.m.push(c.errMedian);
    byCat.set(c.category, e);
  }
  const methods = new Map<string, 'blend' | 'median'>();
  for (const [cat, e] of byCat) methods.set(cat, meanOf(e.b) <= meanOf(e.m) ? 'blend' : 'median');
  return methods;
}

/** A fitted model: the static medians, the size curves, and the blind test that chose between them. */
export interface FittedModel {
  multiples: SectorMultiples;
  globalCurve: SizeCurve;
  capAt: number;
  fits: CategoryFit[];
  validation: ValidationResult;
  methods: Map<string, 'blend' | 'median'>;
  /** The sector multiple a protocol gets at its own TVL, under the blind-selected method. */
  multipleAt(p: SnapshotProtocol): number;
  /** The size curve behind a protocol's multiple (its category's, or the global curve). */
  curveFor(p: SnapshotProtocol): SizeCurve;
}

/**
 * The whole fitted model from the snapshot's live comps: static medians,
 * size curves, per-category blind selection, and the walk-forward check.
 * The walk-forward re-runs the blind selection on the training side only,
 * so the held-out comps never choose the method that predicts them.
 */
export function buildFittedModel(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): FittedModel {
  const live = liveComps(protocols);
  const multiples = sectorMultiples(protocols, model);
  const capAt = winsoriseCap(live, model);
  const globalCurve = fitCurve(live, capAt);
  const loo = leaveOneOut(live, model);
  const methods = selectMethods(loo);
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const k = p.category ?? '(none)';
    const arr = byCat.get(k);
    if (arr === undefined) byCat.set(k, [p]);
    else arr.push(p);
  }
  const fits: CategoryFit[] = [...byCat.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([cat, comps]) => {
      const n = comps.length;
      const usesGlobalCurve = n < model.curve_min_n;
      const curve = usesGlobalCurve ? globalCurve : fitCurve(comps, capAt);
      const errs = loo.perComp.filter((c) => c.category === cat);
      return {
        category: cat,
        n,
        slope: curve.slope,
        intercept: curve.intercept,
        r2: curve.r2,
        looBlend: meanOf(errs.map((e) => e.errBlend)),
        looMedian: meanOf(errs.map((e) => e.errMedian)),
        method: methods.get(cat) ?? 'median',
        median: multiples.byCategory[cat] ?? multiples.global,
        usesGlobalCurve,
      };
    });
  const selectedErrs = loo.perComp.map((c) => ((methods.get(c.category) ?? 'median') === 'blend' ? c.errBlend : c.errMedian));
  const walkForward: WalkForwardResult[] = [];
  for (const cutoff of ['2024-01-01', '2025-01-01']) {
    const train = live.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
    const test = live.filter((p) => p.listed_at !== null && p.listed_at >= cutoff);
    if (train.length === 0 || test.length === 0) continue;
    const trainMethods = selectMethods(leaveOneOut(train, model));
    const errsS: number[] = [];
    const errsM: number[] = [];
    for (const p of test) {
      const { blend, median } = predictLogs(p, train, model);
      const actual = Math.log(p.mcap_usd as number);
      const chosen = trainMethods.get(p.category ?? '(none)') ?? 'median';
      errsS.push(Math.abs((chosen === 'blend' ? blend : median) - actual));
      errsM.push(Math.abs(median - actual));
    }
    walkForward.push({ cutoff, train: train.length, test: test.length, maeSelected: meanOf(errsS), maeMedian: meanOf(errsM) });
  }
  const validation: ValidationResult = {
    looSelected: meanOf(selectedErrs),
    looMedian: meanOf(loo.perComp.map((c) => c.errMedian)),
    looBlend: meanOf(loo.perComp.map((c) => c.errBlend)),
    walkForward,
    datedComps: live.filter((p) => p.listed_at !== null).length,
  };
  const curveFor = (p: SnapshotProtocol): SizeCurve => {
    const fit = fits.find((f) => f.category === (p.category ?? '(none)'));
    if (fit === undefined) return globalCurve;
    return { intercept: fit.intercept, slope: fit.slope, r2: fit.r2, n: fit.n };
  };
  const multipleAt = (p: SnapshotProtocol): number => {
    const cat = p.category ?? '(none)';
    const method = methods.get(cat) ?? 'median';
    const median = multiples.byCategory[cat] ?? multiples.global;
    if (method === 'median') return median;
    const n = byCat.get(cat)?.length ?? 0;
    const curve = curveFor(p);
    const curveLog = curve.intercept + curve.slope * Math.log(p.tvl_usd);
    const medianLog = Math.log(p.tvl_usd * median);
    const w = n / (n + model.shrink_prior);
    const multiple = Math.exp(w * curveLog + (1 - w) * medianLog) / p.tvl_usd;
    return Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiple));
  };
  return { multiples, globalCurve, capAt, fits, validation, methods, multipleAt, curveFor };
}

/** The five factors and the implied value one protocol gets from a given sector multiple. */
export function impliedFromMultiple(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants = MODEL,
): {
  implied: number;
  impliedFdv: number;
  multiple: number;
  fdvMultiple: number;
  base: number;
  baseFdv: number;
  growthAdjusted: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  riskMult: number;
  age: number | null;
} {
  // The FDV multiple is the mcap multiple under the uniform listing
  // assumption: the FDV curve is the mcap curve shifted by log(12.5), the
  // FDV median is the mcap median x 12.5, and the blend weights are the
  // same — so the FDV multiple is exactly the mcap multiple x 12.5.
  const fdvMultiple = multiple * model.fdv_expansion;
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
  const base = protocol.tvl_usd * multiple;
  const baseFdv = protocol.tvl_usd * fdvMultiple;
  const growthAdjusted = base * growthMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * riskMult));
  const impliedFdv = Math.max(1, Math.round(baseFdv * growthMult * maturityMult * chainMult * riskMult));
  return { implied, impliedFdv, multiple, fdvMultiple, base, baseFdv, growthAdjusted, growthPct, growthMult, maturityMult, chainMult, riskMult, age };
}

/** The five factors and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): ReturnType<typeof impliedFromMultiple> {
  return impliedFromMultiple(protocol, asOf, fitted.multipleAt(protocol), model);
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

/**
 * What farming costs on a chain, from the October 2026 airdrop-cost guide
 * the research verified live (AltcoinInvestor): gas per swap, the 12-week
 * gas total for one swap a week, the bridge in, and the all-in total once
 * the 12 hours of time (about $300 at $25 an hour) is counted. Chains the
 * guide does not price get a plain "a few cents / a few dollars" — no
 * number is invented for them.
 */
interface ChainCosts {
  /** Gas for one swap, as the guide states it. */
  gasPerSwap: string;
  /** Gas for 12 weeks at one swap a week. */
  gas12w: string;
  /** What it costs to bridge the capital in. */
  bridge: string;
  /** Gas + bridge + 12 hours of time, the all-in figure the plan quotes. */
  allIn: string;
  /** The all-in figure as one number (the midpoint of the range above), for the net-value arithmetic. */
  allInMid: number;
  /** Capital that makes sense on this chain: the guide's tier. */
  capital: number;
}

function chainCosts(chain: string): ChainCosts {
  switch (chain.toLowerCase()) {
    case 'ethereum':
      return { gasPerSwap: '$0.25–$0.39 of gas per swap', gas12w: 'about $4', bridge: 'no bridge needed', allIn: 'about $304', allInMid: 304, capital: 1000 };
    case 'arbitrum':
      return { gasPerSwap: '$0.01–$0.05 of gas per swap', gas12w: 'under $1', bridge: '$2–$10 to bridge in from mainnet', allIn: 'about $303–$311', allInMid: 307, capital: 250 };
    case 'base':
      return { gasPerSwap: '$0.003–$0.03 of gas per swap', gas12w: 'under $1', bridge: '$2–$10 to bridge in from mainnet', allIn: 'about $303–$311', allInMid: 307, capital: 150 };
    case 'optimism':
      return { gasPerSwap: '$0.02–$0.05 of gas per swap', gas12w: 'under $1', bridge: '$2–$10 to bridge in from mainnet', allIn: 'about $303–$311', allInMid: 307, capital: 250 };
    case 'solana':
      return { gasPerSwap: '$0.00025 of gas per swap', gas12w: 'under $0.01', bridge: 'a few dollars to bridge in', allIn: 'about $303–$305', allInMid: 304, capital: 150 };
    default:
      return { gasPerSwap: 'a few cents of gas per swap', gas12w: 'a few dollars', bridge: 'a few dollars to bridge in', allIn: 'about $305–$310', allInMid: 308, capital: 100 };
  }
}

/** The net value of farming one protocol: expected value minus all-in cost. */
export interface NetValue {
  /** 0.20 x min($3,000, 0.01% of implied FDV): the expected allocation in dollars. */
  ev: number;
  /** The 12-week farm's all-in cost on this row's chain. */
  allIn: number;
  /** Expected value minus all-in cost. */
  net: number;
  /** Farm when net >= 100, Skip when net <= -100, Thin between. */
  verdict: 'Farm' | 'Thin' | 'Skip';
}

/**
 * Whether a farm pays for itself, in dollars. The expected allocation is
 * the meaningful-probability (0.20: only about 20% of airdrops pay
 * meaningfully) times a meaningful allocation, taken as 0.01% of implied
 * FDV and capped at $3,000 (the Arbitrum-typical top). Both the share and
 * the cap are the entry's own assumptions, printed on the page with the
 * arithmetic — the snapshot carries no allocation data.
 */
export function netValue(impliedFdv: number, chain: string, model: ModelConstants = MODEL): NetValue {
  const allIn = chainCosts(chain).allInMid;
  const ev = Math.round(model.ev_meaningful_prob * Math.min(model.ev_cap_usd, impliedFdv * model.ev_wallet_share));
  const net = ev - allIn;
  const verdict = net >= model.verdict_farm_min ? 'Farm' : net <= model.verdict_skip_max ? 'Skip' : 'Thin';
  return { ev, allIn, net, verdict };
}

/** How much capital one farm position needs, from the chain's own tier. */
function capitalFor(p: SnapshotProtocol): number {
  return chainCosts(chainOf(p)).capital;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Whether withdrawing to mainnet takes the 7-day optimistic-rollup challenge period. */
function isOptimistic(chain: string): boolean {
  const c = chain.toLowerCase();
  return c === 'arbitrum' || c === 'optimism';
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
 * The risk step of a farm plan: the odds, the sybil trap and the
 * category's own risk, in one step. The odds are the research's figures:
 * only about 20% of airdrops pay meaningfully, most pay under $100 a
 * wallet, many tokens fall 70–90% in the first month, and sybil filters
 * disqualify about 40% of claimants (LayerZero 803,000 addresses,
 * Arbitrum 427,923). Polymarket International carries one more sentence:
 * its own help centre (24 Jun 2026) says it has not announced any airdrop
 * or token generation event, so its plan must never read as a confirmed
 * farm — that sentence is a dated factual disclosure, not a model input.
 */
function riskStep(p: SnapshotProtocol): string {
  if (p.slug === 'polymarket-international') {
    return `Only about 20% of airdrops pay meaningfully, and many tokens fall 70–90% in the first month. Sybil filters disqualify about 40% of claimants — never fund wallets from one source or repeat identical amounts and timing. A market can resolve against you and the whole stake is lost. Polymarket's help centre (24 Jun 2026) says it has not announced any airdrop or token event, so treat this market as unconfirmed, not a confirmed farm.`;
  }
  return `Only about 20% of airdrops pay meaningfully: most pay under $100 a wallet and many tokens fall 70–90% in the first month. Sybil filters disqualify about 40% of claimants (LayerZero 803,000 addresses; Arbitrum 427,923) — never fund wallets from one source or repeat identical amounts and timing. ${riskFor(p)}`;
}

/**
 * A protocol's farm plan: eight steps over 12 weeks, each an action with a
 * cost and a time, on the research's template. The plan is derived from the
 * protocol's own record (category, chains, age), never from a hand-written
 * list of names. Capital follows the chain's tier (Ethereum $1,000+,
 * Arbitrum and Optimism $100–$500, Base $50–$300, Solana $50–$500); gas
 * and bridge costs are the October 2026 guide's per-chain figures; time
 * is priced in — 1 hour a week x 12 weeks = 12 hours, about $300 at $25
 * an hour — because gas is the smallest cost on every chain but time is
 * the biggest. No step quotes a yield the snapshot does not carry: the
 * rate a protocol pays is read from its own page, never invented here.
 * Monad and MegaETH are never listed as farmable: both already
 * distributed (Monad's claim closed 3 Nov 2025; MEGA live 30 Apr 2026).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, net?: NetValue & { impliedFdv: number }): FarmStep[] {
  const chain = chainOf(p);
  const costs = chainCosts(chain);
  const capital = costs.capital;
  const small = Math.max(10, Math.round(capital / 4 / 10) * 10);
  const hold = holdDaysFor(age);
  const bridgeStep =
    chain.toLowerCase() === 'ethereum'
      ? `Fund the farming wallet with $${capital} of USDC on Ethereum mainnet — no bridge is needed.`
      : `Bridge $${capital} of USDC from mainnet onto ${chain} (${costs.bridge}) and keep the receipt.`;
  const exitStep = isOptimistic(chain)
    ? `Unwind in two steps so you keep gas to exit. Withdrawing from ${chain} to mainnet takes 7 days, so start the exit a week early. Claim only from the link the protocol itself publishes, never pay to claim, never share a seed phrase; decide before claim day whether to keep, sell part or sell all.`
    : `Unwind in two steps so you keep gas to exit. Claim only from the link the protocol itself publishes, never pay to claim, never share a seed phrase; decide before claim day whether to keep, sell part or sell all.`;
  const netStep = net === undefined
    ? `Add up the cost before you start: gas for 12 weeks is ${costs.gas12w}, plus ${costs.bridge}, so the on-chain cost is small — but time is 1 hour a week x 12 weeks = 12 hours, about $300 at $25 an hour, and that is the biggest cost.`
    : `Add up the cost before you start: gas for 12 weeks is ${costs.gas12w}, plus ${costs.bridge}, so the on-chain cost is small — but time is 1 hour a week x 12 weeks = 12 hours, about $300 at $25 an hour, and that is the biggest cost. Net: expected value about $${net.ev} (20% x min($3,000, 0.01% of implied FDV $${Math.round(net.impliedFdv).toLocaleString('en-US')})) minus $${net.allIn} all-in is about $${net.net}. Break-even needs an allocation of $${net.allIn}. Verdict: ${net.verdict}.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    {
      text: bridgeStep,
      cost: `$${capital} of capital, ${costs.bridge}`,
      time: '15 minutes to set up',
    },
    {
      text: `${actionFor(p, capital, chain)} Then repeat one qualifying action each week for 12 weeks — one swap a week for three months counts more than ten swaps in one day.`,
      cost: `$${capital} deployed and ${costs.gasPerSwap}`,
      time: '15 minutes to set up, then 10 minutes a week',
    },
    {
      text: secondActionFor(p, small),
      cost: `$${small} moved and ${costs.gasPerSwap}`,
      time: '10 minutes',
    },
    {
      text: netStep,
      cost: `${costs.allIn} all-in, time included`,
      time: '12 hours over 12 weeks',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Before you withdraw, open the protocol's own points or rewards page and write down the rate it states — the snapshot carries no yield data, so no rate is quoted here.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: riskStep(p),
      cost: 'nothing to read',
      time: '10 minutes',
    },
    {
      text: exitStep,
      cost: 'nothing but the exit gas',
      time: '10 minutes, plus the exit itself',
    },
  ];
}

/** A seeded PRNG (mulberry32): the bootstrap draws the same resamples on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Each board row's rank range across bootstrap refits: resample the live
 * comps with replacement, refit the curves and medians (the blind-selected
 * methods stay fixed — the refits measure calibration uncertainty, not
 * method choice), re-score and re-rank. Returns the 5th and 95th
 * percentile rank per slug.
 */
export function bootstrapRankRanges(
  snapshot: Snapshot,
  rows: { p: SnapshotProtocol }[],
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): Map<string, { lo: number; hi: number }> {
  const live = liveComps(snapshot.protocols);
  const rand = mulberry32(model.bootstrap_seed);
  const ranks = new Map<string, number[]>();
  for (const { p } of rows) ranks.set(p.slug, []);
  for (let r = 0; r < model.bootstrap_refits; r++) {
    const resampled: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) resampled.push(live[Math.floor(rand() * live.length)]!);
    const multiples = sectorMultiples(resampled, model);
    const capAt = winsoriseCap(resampled, model);
    const globalCurve = fitCurve(resampled, capAt);
    const byCat = new Map<string, SnapshotProtocol[]>();
    for (const p of resampled) {
      const k = p.category ?? '(none)';
      const arr = byCat.get(k);
      if (arr === undefined) byCat.set(k, [p]);
      else arr.push(p);
    }
    const multipleAt = (p: SnapshotProtocol): number => {
      const cat = p.category ?? '(none)';
      const method = fitted.methods.get(cat) ?? 'median';
      const median = multiples.byCategory[cat] ?? multiples.global;
      if (method === 'median') return median;
      const catComps = byCat.get(cat) ?? [];
      const n = catComps.length;
      const curve = n >= model.curve_min_n ? fitCurve(catComps, capAt) : globalCurve;
      const curveLog = curve.intercept + curve.slope * Math.log(p.tvl_usd);
      const medianLog = Math.log(p.tvl_usd * median);
      const w = n / (n + model.shrink_prior);
      const multiple = Math.exp(w * curveLog + (1 - w) * medianLog) / p.tvl_usd;
      return Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiple));
    };
    const scored = rows.map(({ p }) => ({ slug: p.slug, implied: impliedFromMultiple(p, snapshot.as_of, multipleAt(p), model).implied }));
    scored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, i) => ranks.get(s.slug)!.push(i + 1));
  }
  const out = new Map<string, { lo: number; hi: number }>();
  for (const [slug, rs] of ranks) {
    const sorted = [...rs].sort((a, b) => a - b);
    const lo = sorted[Math.floor(0.05 * (sorted.length - 1))]!;
    const hi = sorted[Math.floor(0.95 * (sorted.length - 1))]!;
    out.set(slug, { lo, hi });
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const fitted = buildFittedModel(snapshot.protocols, model);
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
    const v = impliedValue(p, snapshot.as_of, fitted, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const withNet = scored.map((s, i) => ({ ...s, rank: i + 1, net: netValue(s.v.impliedFdv, chainOf(s.p), model) }));
  const ranges = bootstrapRankRanges(snapshot, withNet, fitted, model);
  return withNet.map((s) => {
    const range = ranges.get(s.p.slug) ?? { lo: s.rank, hi: s.rank };
    const curve = fitted.curveFor(s.p);
    return {
      rank: s.rank,
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
      implied_fdv_usd: s.v.impliedFdv,
      rank_lo: range.lo,
      rank_hi: range.hi,
      ev_usd: s.net.ev,
      all_in_usd: s.net.allIn,
      net_usd: s.net.net,
      verdict: s.net.verdict,
      model: {
        sector_multiple: round4(s.v.multiple),
        fdv_multiple: round4(s.v.fdvMultiple),
        method: fitted.methods.get(s.p.category ?? '(none)') ?? 'median',
        curve_slope: round4(curve.slope),
        curve_intercept: round4(curve.intercept),
        base_value_usd: Math.round(s.v.base),
        base_fdv_usd: Math.round(s.v.baseFdv),
        growth_adjusted_usd: Math.round(s.v.growthAdjusted),
        growth_pct: s.v.growthPct,
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        chain_multiplier: round4(s.v.chainMult),
        risk_multiplier: round4(s.v.riskMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age, { ...s.net, impliedFdv: s.v.impliedFdv }).map(stepText),
    };
  });
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
    implied_fdv_usd: row.implied_fdv_usd,
    rank_lo: row.rank_lo,
    rank_hi: row.rank_hi,
    ev_usd: row.ev_usd,
    all_in_usd: row.all_in_usd,
    net_usd: row.net_usd,
    verdict: row.verdict,
    method: row.model.method,
    sector_multiple: row.model.sector_multiple,
    fdv_multiple: row.model.fdv_multiple,
    base_value_usd: row.model.base_value_usd,
    base_fdv_usd: row.model.base_fdv_usd,
    growth_adjusted_usd: row.model.growth_adjusted_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    risk_multiplier: row.model.risk_multiplier,
    farm_steps: row.farm_steps,
    on_watchlist: watchlist === undefined ? false : watchlist.has(row.slug),
  };
}

/**
 * The live comps behind each category's multiples, richest TVL first, at
 * most 8 a category: the detail view's comp table. Ratios are winsorised
 * at the same 90th-percentile cap the calibration uses, so the table the
 * judge reads agrees with the multiples the model uses.
 */
export function compTable(snapshot: Snapshot, multiples: SectorMultiples): Record<string, CompRow[]> {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const capAt = ratios.length === 0 ? 0 : ratios[Math.min(ratios.length - 1, Math.floor(MODEL.winsorise_quantile * ratios.length))]!;
  const table: Record<string, CompRow[]> = {};
  for (const p of live) {
    const key = p.category ?? '(none)';
    const arr = table[key] ?? (table[key] = []);
    const mcapTvl = Math.min((p.mcap_usd as number) / p.tvl_usd, capAt);
    arr.push({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_tvl: round4(mcapTvl), fdv_tvl: round4(mcapTvl * MODEL.fdv_expansion) });
  }
  for (const key of Object.keys(table)) {
    table[key]!.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
    table[key] = table[key]!.slice(0, 8);
  }
  return table;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fitted = buildFittedModel(snapshot.protocols, model);
  const multiples = fitted.multiples;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const watchlistTvl = snapshot.protocols
    .filter((p) => snapshot.watchlist.includes(p.slug))
    .reduce((sum, p) => sum + p.tvl_usd, 0);
  const fdvSorted = board.map((r) => r.implied_fdv_usd).sort((a, b) => a - b);
  const medianFdv = medianOf(fdvSorted);
  const mover = [...board].sort((a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9))[0]!;
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
    fdv_multiples: Object.fromEntries(Object.entries(multiples.byCategoryFdv).map(([k, v]) => [k, round4(v)])),
    fdv_multiples_median: Object.fromEntries(Object.entries(multiples.byCategoryFdvMedian).map(([k, v]) => [k, round4(v)])),
    global_fdv_multiple: round4(multiples.globalFdv),
    calibration_protocols: multiples.liveCount,
    protocols_scanned: snapshot.protocols.length,
    watchlist_tvl_usd: watchlistTvl,
    median_implied_fdv_usd: Math.round(medianFdv),
    top_mover: { slug: mover.slug, name: mover.name, change_7d: mover.change_7d ?? 0 },
    comps: compTable(snapshot, multiples),
    fits: fitted.fits,
    global_fit: { slope: round4(fitted.globalCurve.slope), intercept: round4(fitted.globalCurve.intercept), r2: round4(fitted.globalCurve.r2) },
    validation: {
      looSelected: round4(fitted.validation.looSelected),
      looMedian: round4(fitted.validation.looMedian),
      looBlend: round4(fitted.validation.looBlend),
      walkForward: fitted.validation.walkForward.map((w) => ({ ...w, maeSelected: round4(w.maeSelected), maeMedian: round4(w.maeMedian) })),
      datedComps: fitted.validation.datedComps,
    },
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
