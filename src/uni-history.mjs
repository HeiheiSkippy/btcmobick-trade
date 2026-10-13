// Reads swaps of the Uniswap v4 BMB pools directly from BSC and accumulates hourly candles, volume and large trades.
// The page falls back to this file when GeckoTerminal is down or rate-limited.
//
//   node src/uni-history.mjs site/data/uni-history.json [previous file URL]
//
// Reads PoolManager Swap events in 2,000-block steps from the block after the last run up to now.
// The public node (publicnode) only serves about the last 9,000 blocks (~70 min); older gaps are left empty.
// The Action starts from an empty folder each time, so without a local file it fetches the previous file (the published copy) and continues it.
//
// File format:
//   { at, block, pools: { poolKey: { hours: [[hour start unix seconds, close, volume], ...] } }, trades: [...], gaps: [[fromBlock, toBlock], ...] }
//   Close uses the page's direction (WBMB/MOVN: MOVN per WBMB; MOVN/USDT: USDT per MOVN); volume is in the quote asset.
//   trades: swaps of $500 or more { t, pool, buy, qty (base asset), usd, wallet (tx sender), tx }
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const RPC = 'https://bsc-rpc.publicnode.com';
const POOL_MANAGER = '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df';
// Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
// Same pools as the page's MARKET_POOLS. baseIs0: whether the base asset is token0.
export const POOLS = {
  mu05: { id: '0x5de52159724f0d421445f4a5eeccc047bb6cc7821a008b7a171d896256d3a217', dec0: 18, dec1: 18, baseIs0: true },
  mu29: { id: '0x68ed65f5029ed3b40fdb23baadb1ee3b2327eefdb5f08e5d31715a8d8e4ff7f6', dec0: 18, dec1: 18, baseIs0: true },
  wm10: { id: '0x56e0a9b160ade73e83d236e31ef9cb3527905a820c8cb61aba6c949e9472cab6', dec0: 18, dec1: 8, baseIs0: false },
};
const CHUNK = 2000;
const MAX_BACK = 9000;
const KEEP_HOURS = 7 * 24 + 2;
const KEEP_TRADES_SEC = 26 * 3600;
const TRADE_MIN_USD = 500;

function signed(word) {
  const v = BigInt('0x' + word);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}
const scaled = (v, dec) => Number(v) / 10 ** dec;

// Swap event data -> price (quote per base) and base/quote amounts (+ when the trader receives, - when it pays).
export function decodeSwap(dataHex, pool) {
  const d = dataHex.replace(/^0x/, '');
  if (d.length < 64 * 3) throw new Error('Swap 데이터가 짧습니다');
  const a0 = scaled(signed(d.slice(0, 64)), pool.dec0);
  const a1 = scaled(signed(d.slice(64, 128)), pool.dec1);
  const s = BigInt('0x' + d.slice(128, 192));
  // token1/token0 price = (sqrtPriceX96 / 2^96)^2 × 10^(dec0 − dec1)
  const p10 = Number((s * s * 10n ** 36n) >> 192n) / 1e36 * 10 ** (pool.dec0 - pool.dec1);
  const price = pool.baseIs0 ? p10 : 1 / p10;
  const base = pool.baseIs0 ? a0 : a1, quote = pool.baseIs0 ? a1 : a0;
  return { price, base, quote, buy: base > 0 };
}

// Adds swaps to hourly candles. Swaps must arrive in block/log order (the close is the hour's last swap).
export function addToHours(hours, swaps) {
  const map = new Map(hours.map((h) => [h[0], [h[0], h[1], h[2]]]));
  for (const s of swaps) {
    const hour = Math.floor(s.t / 3600) * 3600;
    const row = map.get(hour) || [hour, s.price, 0];
    row[1] = s.price;
    row[2] += Math.abs(s.quote);
    map.set(hour, row);
  }
  return [...map.values()].sort((a, b) => a[0] - b[0]);
}

export function trimHistory(state, nowSec) {
  const minHour = Math.floor(nowSec / 3600) * 3600 - KEEP_HOURS * 3600;
  for (const key of Object.keys(state.pools)) state.pools[key].hours = state.pools[key].hours.filter((h) => h[0] >= minHour);
  const seen = new Set();
  state.trades = state.trades
    .filter((t) => t.t >= nowSec - KEEP_TRADES_SEC && !seen.has(t.tx + t.pool) && seen.add(t.tx + t.pool))
    .sort((a, b) => b.t - a.t).slice(0, 300);
  state.gaps = (state.gaps || []).slice(-20);
  return state;
}

export function emptyState() {
  return { at: null, block: 0, pools: Object.fromEntries(Object.keys(POOLS).map((k) => [k, { hours: [] }])), trades: [], gaps: [] };
}

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((x) => x.json());
  if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
  return r.result;
}
const hex = (n) => '0x' + n.toString(16);

async function readPrevious(out, previousUrl) {
  try { return JSON.parse(await readFile(out, 'utf8')); } catch {}
  if (!previousUrl) return null;
  try {
    const res = await fetch(previousUrl, { signal: AbortSignal.timeout(15000) });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

// trades: false skips large trades (and their sender lookups) and keeps the list empty.
async function collect(prev, { trades: withTrades = true } = {}) {
  const state = prev && prev.pools ? prev : emptyState();
  for (const k of Object.keys(POOLS)) state.pools[k] = state.pools[k] || { hours: [] };
  state.trades = state.trades || [];
  state.gaps = state.gaps || [];
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  let from = state.block ? state.block + 1 : head - CHUNK + 1;
  if (head - from > MAX_BACK) {
    state.gaps.push([from, head - MAX_BACK - 1]);
    from = head - MAX_BACK;
  }
  const idToKey = Object.fromEntries(Object.entries(POOLS).map(([k, p]) => [p.id, k]));
  const logs = [];
  for (let a = from; a <= head; a += CHUNK) {
    const b = Math.min(head, a + CHUNK - 1);
    try {
      logs.push(...await rpc('eth_getLogs', [{ address: POOL_MANAGER, topics: [SWAP_TOPIC, Object.values(POOLS).map((p) => p.id)], fromBlock: hex(a), toBlock: hex(b) }]));
    } catch (err) {
      state.gaps.push([a, b]);
      console.error(`블록 ${a}~${b}를 읽지 못해 비워 둡니다:`, err.message);
    }
  }
  logs.sort((x, y) => parseInt(x.blockNumber, 16) - parseInt(y.blockNumber, 16) || parseInt(x.logIndex, 16) - parseInt(y.logIndex, 16));
  const byPool = Object.fromEntries(Object.keys(POOLS).map((k) => [k, []]));
  // MOVN/USDT price, used to value WBMB/MOVN trades in USD. Falls back to the previous candle's close.
  const lastMu = state.pools.mu05.hours.at(-1);
  let movnUsdt = lastMu ? lastMu[1] : null;
  const big = [];
  for (const log of logs) {
    const key = idToKey[log.topics[1]];
    if (!key) continue;
    const s = { ...decodeSwap(log.data, POOLS[key]), t: parseInt(log.blockTimestamp, 16) };
    if (!(s.price > 0) || !Number.isFinite(s.t)) continue;
    byPool[key].push(s);
    if (key === 'mu05') movnUsdt = s.price;
    const usd = key === 'wm10' ? (movnUsdt ? Math.abs(s.quote) * movnUsdt : null) : Math.abs(s.quote);
    if (withTrades && usd >= TRADE_MIN_USD) big.push({ t: s.t, pool: key, buy: s.buy, qty: Math.abs(s.base), usd, tx: log.transactionHash.toLowerCase() });
  }
  for (const k of Object.keys(POOLS)) state.pools[k].hours = addToHours(state.pools[k].hours, byPool[k]);
  // Only large trades look up the tx sender (tx.from); the event's sender is the router, not the trader.
  for (const t of big) {
    try { t.wallet = String((await rpc('eth_getTransactionByHash', [t.tx])).from || '').toLowerCase(); } catch { t.wallet = ''; }
    if (/^0x[0-9a-f]{40}$/.test(t.wallet)) state.trades.push(t);
  }
  if (!withTrades) state.trades = [];
  state.block = head;
  state.at = new Date().toISOString();
  return { state: trimHistory(state, Math.floor(Date.now() / 1000)), read: logs.length, big: big.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), noTrades = args.includes('--no-trades');
  const [out, previousUrl] = args.filter((a) => !a.startsWith('--'));
  if (!out) {
    console.error('쓸 파일 경로를 적어 주십시오');
    process.exit(2);
  }
  const prev = await readPrevious(out, previousUrl);
  if (prev && noTrades) prev.trades = [];
  let result;
  try {
    result = await collect(prev, { trades: !noTrades });
    console.log('유니스왑 체인 기록', result.read, '건 읽음 · 큰 거래', result.big, '건 · 블록', result.state.block);
  } catch (err) {
    console.error('유니스왑 체인 기록을 읽지 못했습니다:', err.message);
    if (!prev) process.exit(1);
    result = { state: prev };
    console.log('이전 값을 유지합니다', prev.at);
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(result.state) + '\n');
}
