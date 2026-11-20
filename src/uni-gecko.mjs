// Fetches GeckoTerminal data for the Uniswap BMB pools the page uses and saves it to a file.
// Visitors' browsers never call GeckoTerminal (30 requests/min per IP); only the Action asks, every 5 minutes.
//
//   node src/uni-gecko.mjs site/data/uni-gecko.json [previous file URL]
//
// 9 requests: 4 hourly candle series (WBMB/MOVN 0.1%·2.9%, MOVN/USDT 0.05%·0.3%), 3 large-trade lists ($500+ per pool),
// 1 pool info (24h volume), 1 MOVN token pool list (1h volume of every MOVN/USDT and WBMB/MOVN pool).
// Each part keeps its own fetch time, and a failed part keeps the previous file's value. The Action starts from an empty folder,
// so without a local file it fetches the previous file (the published copy).
// Failures other than rate limiting (429), such as a changed response format, exit with code 1 so this doubles as a check.
// 429 is not a fault: GitHub Action runners share IPs across repositories, so other users' requests can trigger it.
//
// File format (same units as uni-history.json):
//   { at,
//     hoursAt, hours: { wm10: [[hour start unix seconds, close, volume (quote asset)], ...], wm29, mu05, mu30 },
//     tradesAt, trades: [{ t, pool, buy, qty (base asset), usd, wallet, tx }, …],
//     volumeAt, volume: { mu05, mu29, wm10 (24h volume, USD) },
//     movnHourAt, movnHour: { pool id: 1h volume (USD) } for MOVN/USDT and WBMB/MOVN pools }
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { POOLS } from './uni-history.mjs';

const HOUR_POOLS = ['wm10', 'wm29', 'mu05', 'mu30'];
// GeckoTerminal lists the WBMB/MOVN 2.9% pool as MOVN/WBMB, so its candles are asked for the quote token (WBMB) to keep MOVN per WBMB.
const HOUR_TOKEN = { wm29: 'quote' };
// Large-trade lists only for the page's MARKET_POOLS (GeckoTerminal's buy/sell would be reversed for wm29).
const TRADE_POOLS = ['mu05', 'mu29', 'wm10'];
const HOURS = 7 * 24 + 2;
export const TRADE_MIN_USD = 500;

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/bsc/';
const MOVN = '0x200b63aa750c901892d4dcf82439860f9c270274', USDT = '0x55d398326f99059ff775485246999027b3197955';
const WBMB = '0x9e4c611b834672c3643d9818249366bf65ae4c86';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1 second between requests (6 requests leave plenty of room under the per-minute limit). On 429, retry once after 20 seconds.
async function gecko(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(attempt ? 20000 : 1000);
    const res = await fetch(GECKO + path, { signal: AbortSignal.timeout(20000) });
    if (res.status === 429) continue;
    if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
    return res.json();
  }
  throw new Error('요청 제한(429)');
}

const attrs = (j) => j && j.data && j.data.attributes;

// Hourly candle response -> [[hour start seconds, close, volume]]. With currency=token, values are in the pool's quote asset.
export function parseHours(j) {
  const list = attrs(j) && attrs(j).ohlcv_list;
  if (!Array.isArray(list) || !list.length || list[0].length < 6) throw new Error('1시간 봉 형식이 다릅니다');
  return list.map((c) => [Number(c[0]), Number(c[4]), Number(c[5])])
    .filter((c) => Number.isFinite(c[0]) && c[1] > 0)
    .sort((a, b) => a[0] - b[0]);
}

// Trade list response -> large trades. buy/sell refers to the first token in the pool name (base asset); qty is that asset's amount.
// Values end up in links and text, so only well-formed addresses and hashes are kept.
export function parseTrades(j, key) {
  if (!j || !Array.isArray(j.data)) throw new Error('거래 목록 형식이 다릅니다');
  return j.data.map((x) => {
    const a = x.attributes || {}, buy = a.kind === 'buy';
    return { t: Math.floor(Date.parse(a.block_timestamp) / 1000), pool: key, buy,
      qty: Number(buy ? a.to_token_amount : a.from_token_amount), usd: Number(a.volume_in_usd),
      wallet: String(a.tx_from_address || '').toLowerCase(), tx: String(a.tx_hash || '').toLowerCase() };
  }).filter((r) => /^0x[0-9a-f]{40}$/.test(r.wallet) && /^0x[0-9a-f]{64}$/.test(r.tx) && Number.isFinite(r.t)
    && Number.isFinite(r.qty) && Number.isFinite(r.usd));
}

// Multi-pool info response -> { poolKey: 24h volume (USD) }
export function parseVolumes(j) {
  if (!j || !Array.isArray(j.data)) throw new Error('풀 정보 형식이 다릅니다');
  const byId = Object.fromEntries(Object.entries(POOLS).map(([k, p]) => [p.id, k]));
  const out = {};
  for (const p of j.data) {
    const a = p.attributes || {}, key = byId[String(a.address || '').toLowerCase()];
    if (key && a.volume_usd && a.volume_usd.h24 != null && Number.isFinite(Number(a.volume_usd.h24))) out[key] = Number(a.volume_usd.h24);
  }
  if (!Object.keys(out).length) throw new Error('풀 정보에 volume_usd.h24가 없습니다');
  return out;
}

// MOVN token pool list response -> { pool id: 1h volume (USD) } for MOVN/USDT and WBMB/MOVN pools.
// The page shows the price of the pool with the most volume in the last hour, which is what the Uniswap app was seen to show.
export function parseMovnHour(j) {
  if (!j || !Array.isArray(j.data)) throw new Error('MOVN 풀 목록 형식이 다릅니다');
  const tok = (p, side) => String((((p.relationships || {})[side] || {}).data || {}).id || '').replace(/^bsc_/, '').toLowerCase();
  const out = {};
  for (const p of j.data) {
    const a = p.attributes || {}, pair = [tok(p, 'base_token'), tok(p, 'quote_token')].sort().join();
    const v = Number(a.volume_usd && a.volume_usd.h1), id = String(a.address || '').toLowerCase();
    if ((pair === [MOVN, USDT].sort().join() || pair === [MOVN, WBMB].sort().join()) && /^0x[0-9a-f]+$/.test(id) && Number.isFinite(v)) out[id] = v;
  }
  if (!Object.keys(out).length) throw new Error('MOVN/USDT·WBMB/MOVN 풀의 volume_usd.h1이 없습니다');
  return out;
}

async function readPrevious(out, previousUrl) {
  try { return JSON.parse(await readFile(out, 'utf8')); } catch {}
  if (!previousUrl) return null;
  try {
    const res = await fetch(previousUrl, { signal: AbortSignal.timeout(15000) });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

// Fetches one part. On failure, records the problem (429 separately) and returns null.
async function part(name, fn, problems, limited) {
  try { return await fn(); } catch (err) {
    (/429/.test(err.message) ? limited : problems).push(`${name}: ${err.message}`);
    return null;
  }
}

// trades: false skips the large-trade lists and drops them from the file (the public page does not use them).
export async function collect(prev, get = gecko, { trades: withTrades = true } = {}) {
  const state = prev && typeof prev === 'object' ? prev : {};
  const problems = [], limited = [], now = new Date().toISOString();

  const hours = {};
  for (const key of HOUR_POOLS) {
    hours[key] = await part(`${key} 1시간 봉`, async () =>
      parseHours(await get(`pools/${POOLS[key].id}/ohlcv/hour?aggregate=1&limit=${HOURS}&currency=token` +
        (HOUR_TOKEN[key] ? `&token=${HOUR_TOKEN[key]}` : ''))), problems, limited);
  }
  if (HOUR_POOLS.every((k) => hours[k])) { state.hours = hours; state.hoursAt = now; }

  const trades = [];
  let tradesOk = withTrades;
  for (const key of withTrades ? TRADE_POOLS : []) {
    const list = await part(`${key} 큰 거래`, async () =>
      parseTrades(await get(`pools/${POOLS[key].id}/trades?trade_volume_in_usd_greater_than=${TRADE_MIN_USD}`), key), problems, limited);
    if (list) trades.push(...list); else tradesOk = false;
  }
  if (tradesOk) { state.trades = trades.sort((a, b) => b.t - a.t); state.tradesAt = now; }
  if (!withTrades) { delete state.trades; delete state.tradesAt; }

  const volume = await part('24시간 거래량', async () =>
    parseVolumes(await get('pools/multi/' + Object.values(POOLS).map((p) => p.id).join(','))), problems, limited);
  if (volume) { state.volume = volume; state.volumeAt = now; }

  const movnHour = await part('MOVN 풀 1시간 거래량', async () => parseMovnHour(await get(`tokens/${MOVN}/pools?page=1`)), problems, limited);
  if (movnHour) { state.movnHour = movnHour; state.movnHourAt = now; }

  state.at = now;
  return { state, problems, limited };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), noTrades = args.includes('--no-trades');
  const [out, previousUrl] = args.filter((a) => !a.startsWith('--'));
  if (!out) {
    console.error('쓸 파일 경로를 적어 주십시오');
    process.exit(2);
  }
  const { state, problems, limited } = await collect(await readPrevious(out, previousUrl), gecko, { trades: !noTrades });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(state) + '\n');
  console.log(`GeckoTerminal 값 · 봉 ${state.hoursAt || '없음'} · 큰 거래 ${state.trades ? state.trades.length : 0}건 ${state.tradesAt || '없음'} · 거래량 ${state.volumeAt || '없음'} · MOVN 1시간 거래량 ${state.movnHourAt || '없음'}`);
  if (limited.length) console.log('요청 제한(429)으로 받지 못해 이전 값을 둠(고장 아님): ' + limited.join(', '));
  if (problems.length) {
    console.error('GeckoTerminal 값을 받지 못함:\n- ' + problems.join('\n- ') + '\n고치는 절차는 Docs/GECKO_CHECK.md');
    process.exit(1);
  }
}
