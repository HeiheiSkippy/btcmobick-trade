// Fetches GeckoTerminal data for the Uniswap BMB pools the page uses and saves it to a file.
// Visitors' browsers never call GeckoTerminal (30 requests/min per IP); only the Action asks, every 5 minutes.
//
//   node src/uni-gecko.mjs site/data/uni-gecko.json [previous file URL]
//
// 6 requests: 2 hourly candle series (WBMB/MOVN 0.1%, MOVN/USDT 0.05%), 3 large-trade lists ($500+ per pool), 1 pool info (24h volume).
// Each part keeps its own fetch time, and a failed part keeps the previous file's value. The Action starts from an empty folder,
// so without a local file it fetches the previous file (the published copy).
// Failures other than rate limiting (429), such as a changed response format, exit with code 1 so this doubles as a check.
// 429 is not a fault: GitHub Action runners share IPs across repositories, so other users' requests can trigger it.
//
// File format (same units as uni-history.json):
//   { at,
//     hoursAt, hours: { wm10: [[hour start unix seconds, close, volume (quote asset)], ...], mu05: [...] },
//     tradesAt, trades: [{ t, pool, buy, qty (base asset), usd, wallet, tx }, …],
//     volumeAt, volume: { mu05, mu29, wm10 (24h volume, USD) } }
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { POOLS } from './uni-history.mjs';

const HOUR_POOLS = ['wm10', 'mu05'];
const HOURS = 7 * 24 + 2;
export const TRADE_MIN_USD = 500;

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/bsc/';
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
      parseHours(await get(`pools/${POOLS[key].id}/ohlcv/hour?aggregate=1&limit=${HOURS}&currency=token`)), problems, limited);
  }
  if (HOUR_POOLS.every((k) => hours[k])) { state.hours = hours; state.hoursAt = now; }

  const trades = [];
  let tradesOk = withTrades;
  for (const key of withTrades ? Object.keys(POOLS) : []) {
    const list = await part(`${key} 큰 거래`, async () =>
      parseTrades(await get(`pools/${POOLS[key].id}/trades?trade_volume_in_usd_greater_than=${TRADE_MIN_USD}`), key), problems, limited);
    if (list) trades.push(...list); else tradesOk = false;
  }
  if (tradesOk) { state.trades = trades.sort((a, b) => b.t - a.t); state.tradesAt = now; }
  if (!withTrades) { delete state.trades; delete state.tradesAt; }

  const volume = await part('24시간 거래량', async () =>
    parseVolumes(await get('pools/multi/' + Object.values(POOLS).map((p) => p.id).join(','))), problems, limited);
  if (volume) { state.volume = volume; state.volumeAt = now; }

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
  console.log(`GeckoTerminal 값 · 봉 ${state.hoursAt || '없음'} · 큰 거래 ${state.trades ? state.trades.length : 0}건 ${state.tradesAt || '없음'} · 거래량 ${state.volumeAt || '없음'}`);
  if (limited.length) console.log('요청 제한(429)으로 받지 못해 이전 값을 둠(고장 아님): ' + limited.join(', '));
  if (problems.length) {
    console.error('GeckoTerminal 값을 받지 못함:\n- ' + problems.join('\n- ') + '\n고치는 절차는 Docs/GECKO_CHECK.md');
    process.exit(1);
  }
}
