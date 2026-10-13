// Builds the pool and route list used for Uniswap quotes on the page.
//
//   node src/uni-pools.mjs site/data/uni-pools.json           keeps the file if it is newer than FRESH_HOURS
//   node src/uni-pools.mjs site/data/uni-pools.json --force   always rebuilds
//
// The pool list changes rarely, so it is rebuilt only occasionally, not on every refresh.
// On-chain reads are batched through Multicall3 into a few requests.
//
// 1. Fetch Uniswap (v2, v3, v4) pools containing WBMB or MOVN from GeckoTerminal.
// 2. Find on chain the pools linking their other tokens (e.g. ETH) and base tokens (WBNB, USDC) to USDT
//    (factories for v3/v2, common fee/tick-spacing pool ids for v4). Reserves come from GeckoTerminal pool info.
// 3. Verify every pool on chain: for v4, the PositionManager pool key must hash to the pool id (keccak);
//    for v3/v2, the pool's token0/token1 (and fee for v3) must match. Unverified pools are dropped.
// 4. Build WBMB -> USDT, WBMB -> MOVN and MOVN -> USDT routes (up to 3 pools) from pools with reserves >= MIN_RESERVE_USD.
//    Pairs between intermediate tokens use only their top 2 pools by reserves (Uniswap's router also limits base-token pairs).
// On failure, no file is written and the exit code is 1 (the previous file stays). Without the file, the page shows a pool-list error in Uniswap quotes.
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { keccak256, toHex, fromHex, selector } from './keccak.mjs';

export const MIN_RESERVE_USD = 100;
const TOP_PER_PAIR = 2;
const MAX_HOPS = 3;
const FRESH_HOURS = 6;
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
const RPC = 'https://bsc-dataseed.binance.org';
const GECKO = 'https://api.geckoterminal.com/api/v2/networks/bsc/';

export const T = {
  WBMB: '0x9e4c611b834672c3643d9818249366bf65ae4c86',
  MOVN: '0x200b63aa750c901892d4dcf82439860f9c270274',
  USDT: '0x55d398326f99059ff775485246999027b3197955',
  WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  // Some v4 pools use native BNB (address 0) instead of WBNB; the Uniswap app routes through them (e.g. USDT -> BNB -> ETH -> WBMB).
  BNB: '0x0000000000000000000000000000000000000000',
};
const BASES = [T.USDT, T.WBNB, T.USDC, T.BNB];
const V3_FACTORY = '0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7';
const V2_FACTORY = '0x8909dc15e40173ff4699343b6eb8132c65e18ec6';
const V4_POSM = '0x7a4a5c919ae2541aed11041a1aeee68f1287f95b';
const V3_FEES = [100, 500, 3000, 10000];
const V4_KEYS = [[100, 1], [500, 10], [3000, 60], [10000, 200]];
const DEX = { 'uniswap-v4-bsc': 'v4', 'uniswap-bsc': 'v3', 'uniswap-v2-bsc': 'v2' };
const ZERO = '0x0000000000000000000000000000000000000000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (hex) => hex.toLowerCase().replace('0x', '').padStart(64, '0');
const addrOf = (w) => '0x' + w.slice(-40);
const int24 = (v) => (v < 0 ? BigInt(v) + (1n << 256n) : BigInt(v)).toString(16).padStart(64, '0');
export const v4Id = (c0, c1, fee, ts, hooks = ZERO) =>
  toHex(keccak256(fromHex(word(c0) + word(c1) + word(fee.toString(16)) + int24(ts) + word(hooks))));

async function rpcCall(to, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      const j = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) }).then((r) => r.json());
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}
// Batches calls through Multicall3 aggregate3, 100 per eth_call. Returns each call's result hex ('0x...') or null (reverted).
export async function multicall(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 100) {
    const chunk = calls.slice(i, i + 100);
    const elems = chunk.map(([to, data]) => {
      const d = data.replace('0x', ''), len = d.length / 2;
      return word(to) + word('1') + word('60') + word(len.toString(16)) + d.padEnd(Math.ceil(len / 32) * 64, '0');
    });
    let off = chunk.length * 32, heads = '';
    for (const e of elems) { heads += word(off.toString(16)); off += e.length / 2; }
    const hex = (await rpcCall(MULTICALL3, '0x82ad56cb' + word('20') + word(chunk.length.toString(16)) + heads + elems.join(''))).slice(2);
    const w = (byte) => Number(BigInt('0x' + hex.slice(byte * 2, byte * 2 + 64)));
    const arr = w(0), n = w(arr), base = arr + 32;
    for (let k = 0; k < n; k++) {
      const e = base + w(base + 32 * k), ok = w(e) === 1, bo = e + w(e + 32), len = w(bo);
      out.push(ok && len > 0 ? '0x' + hex.slice((bo + 32) * 2, (bo + 32 + len) * 2) : null);
    }
  }
  return out;
}
export async function gecko(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(attempt ? 20000 : 2500);
    const res = await fetch(GECKO + path, { signal: AbortSignal.timeout(20000) });
    if (res.status === 429) continue;
    if (!res.ok) throw new Error(`GeckoTerminal ${path} ${res.status}`);
    return res.json();
  }
  throw new Error(`GeckoTerminal ${path} 요청 제한(429)`);
}
const tokenOf = (rel) => rel.data.id.replace(/^bsc_/, '').toLowerCase();

// One GeckoTerminal pool -> { proto, id, a, b, reserveUsd }
export function fromGecko(p) {
  const proto = DEX[p.relationships.dex.data.id];
  if (!proto) return null;
  return { proto, id: p.attributes.address.toLowerCase(), a: tokenOf(p.relationships.base_token), b: tokenOf(p.relationships.quote_token),
    reserveUsd: Number(p.attributes.reserve_in_usd) || 0, name: p.attributes.name };
}

// On-chain verification: fills token0, token1 and fee (plus tick spacing and hooks) per pool, or null on mismatch. All calls go in one batch.
export async function verifyAll(pools) {
  const calls = [], plan = pools.map((pool) => {
    const at = calls.length;
    if (pool.proto === 'v4') calls.push([V4_POSM, selector('poolKeys(bytes25)') + pool.id.slice(2, 52).padEnd(64, '0')]);
    else {
      calls.push([pool.id, selector('token0()')], [pool.id, selector('token1()')], [pool.id, selector('factory()')]);
      if (pool.proto === 'v3') calls.push([pool.id, selector('fee()')]);
    }
    return at;
  });
  const res = await multicall(calls);
  return pools.map((pool, i) => {
    const r = (k) => res[plan[i] + k];
    const [lo, hi] = pool.a < pool.b ? [pool.a, pool.b] : [pool.b, pool.a];
    if (pool.proto === 'v4') {
      const x = r(0);
      if (!x || x.length < 2 + 64 * 5) return null;
      const w = (k) => x.slice(2 + 64 * k, 66 + 64 * k);
      const key = { c0: addrOf(w(0)), c1: addrOf(w(1)), fee: parseInt(w(2), 16), ts: Number(BigInt.asIntN(24, BigInt('0x' + w(3)))), hooks: addrOf(w(4)) };
      if (key.c0 !== lo || key.c1 !== hi || v4Id(key.c0, key.c1, key.fee, key.ts, key.hooks) !== pool.id) return null;
      return { ...pool, t0: lo, t1: hi, fee: key.fee, ts: key.ts, hooks: key.hooks };
    }
    if (!r(0) || !r(1) || addrOf(r(0)) !== lo || addrOf(r(1)) !== hi || !r(2)) return null;
    if (pool.proto === 'v2') return addrOf(r(2)) === V2_FACTORY ? { ...pool, t0: lo, t1: hi, fee: 3000 } : null;
    return addrOf(r(2)) === V3_FACTORY && r(3) ? { ...pool, t0: lo, t1: hi, fee: parseInt(r(3).slice(2), 16) } : null;
  });
}

// Finds pools linking each token pair on chain (reserves come later from GeckoTerminal). All v3/v2 factory lookups go in one batch.
async function findAllOnChain(pairs) {
  const calls = [], asks = [], found = [];
  for (const [x, y] of pairs) {
    const [lo, hi] = x < y ? [x, y] : [y, x];
    if (lo === T.BNB && hi === T.WBNB) continue;  // wrapping only, not a pool
    // Native BNB exists only in v4.
    if (lo !== T.BNB) {
      for (const fee of V3_FEES) {
        asks.push({ proto: 'v3', a: lo, b: hi });
        calls.push([V3_FACTORY, selector('getPool(address,address,uint24)') + word(lo) + word(hi) + word(fee.toString(16))]);
      }
      asks.push({ proto: 'v2', a: lo, b: hi });
      calls.push([V2_FACTORY, selector('getPair(address,address)') + word(lo) + word(hi)]);
    }
    for (const [fee, ts] of V4_KEYS) found.push({ proto: 'v4', id: v4Id(lo, hi, fee, ts), a: lo, b: hi });
  }
  const res = await multicall(calls);
  res.forEach((r, i) => { if (r && BigInt(r) !== 0n) found.push({ ...asks[i], id: addrOf(r) }); });
  return found;
}

async function reserves(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 30) {
    const j = await gecko('pools/multi/' + ids.slice(i, i + 30).join(','));
    for (const p of j.data || []) out[p.attributes.address.toLowerCase()] = { reserveUsd: Number(p.attributes.reserve_in_usd) || 0, name: p.attributes.name };
  }
  return out;
}

// Routes from token `from` to `to` through up to MAX_HOPS pools, never visiting a token twice.
export function buildRoutes(pools, from, to) {
  const routes = [];
  (function visit(token, path, seen) {
    if (token === to && path.length) { routes.push({ pools: path.map((p) => p.id), tokens: pathTokens(path, from) }); return; }
    if (path.length >= MAX_HOPS) return;
    for (const p of pools) {
      if (p.t0 !== token && p.t1 !== token) continue;
      const next = p.t0 === token ? p.t1 : p.t0;
      if (seen.has(next)) continue;
      visit(next, [...path, p], new Set([...seen, next]));
    }
  })(from, [], new Set([from]));
  return routes;
}
function pathTokens(path, from) {
  const tokens = [from];
  for (const p of path) tokens.push(p.t0 === tokens[tokens.length - 1] ? p.t1 : p.t0);
  return tokens;
}

async function main(outFile, force) {
  if (outFile && !force) {
    try {
      const old = JSON.parse(readFileSync(outFile, 'utf8'));
      const hours = (Date.now() - new Date(old.generatedAt).getTime()) / 3600000;
      if (hours < FRESH_HOURS) {
        console.error(`유니스왑 풀 목록: ${hours.toFixed(1)}시간 전 파일이라 그대로 둠(${FRESH_HOURS}시간마다 새로 만듦, --force면 바로)`);
        return;
      }
    } catch (e) { /* missing or unreadable: rebuild */ }
  }
  // 1. WBMB and MOVN pools
  const direct = new Map();
  for (const token of [T.WBMB, T.MOVN]) {
    const j = await gecko(`tokens/${token}/pools?page=1`);
    for (const p of j.data || []) { const g = fromGecko(p); if (g && g.reserveUsd >= MIN_RESERVE_USD) direct.set(g.id, g); }
  }
  // 2. Pools linking other tokens to base tokens
  const mids = new Set();
  for (const p of direct.values()) for (const t of [p.a, p.b]) if (t !== T.WBMB && t !== T.MOVN && t !== T.USDT) mids.add(t);
  const connectPairs = [];
  for (const m of mids) for (const b of BASES) if (m !== b) connectPairs.push([m, b]);
  for (let i = 0; i < BASES.length; i++) for (let k = i + 1; k < BASES.length; k++) connectPairs.push([BASES[i], BASES[k]]);
  const connectCands = await findAllOnChain(connectPairs);
  const res = await reserves(connectCands.map((c) => c.id));
  const byPair = {};
  for (const c of connectCands) {
    const r = res[c.id];
    if (!r || r.reserveUsd < MIN_RESERVE_USD) continue;
    (byPair[c.a + c.b] ||= []).push({ ...c, ...r });
  }
  if (process.env.DEBUG) for (const list of Object.values(byPair)) console.error(list.sort((p, q) => q.reserveUsd - p.reserveUsd).map((p) => `${p.name} ${p.proto} $${Math.round(p.reserveUsd)} ${p.id.slice(0, 6)}`).join(" / "));
  const connect = Object.values(byPair).flatMap((list) => list.sort((p, q) => q.reserveUsd - p.reserveUsd).slice(0, TOP_PER_PAIR));
  // 3. On-chain verification
  const cands = [...direct.values(), ...connect], checked = await verifyAll(cands);
  const pools = checked.filter(Boolean), dropped = cands.filter((p, i) => !checked[i]).map((p) => `${p.name || p.id} (${p.proto})`);
  if (!pools.length) throw new Error('확인된 풀이 없습니다');
  // 4. Routes
  const routes = {
    'WBMB>USDT': buildRoutes(pools, T.WBMB, T.USDT),
    'WBMB>MOVN': buildRoutes(pools, T.WBMB, T.MOVN),
    'MOVN>USDT': buildRoutes(pools, T.MOVN, T.USDT),
  };
  for (const [k, list] of Object.entries(routes)) if (!list.length) throw new Error(`${k} 경로가 없습니다`);
  const data = {
    generatedAt: new Date().toISOString(),
    minReserveUsd: MIN_RESERVE_USD,
    pools: pools.sort((p, q) => q.reserveUsd - p.reserveUsd).map((p) => ({
      id: p.id, proto: p.proto, t0: p.t0, t1: p.t1, fee: p.fee, ...(p.proto === 'v4' ? { ts: p.ts, hooks: p.hooks } : {}),
      reserveUsd: Math.round(p.reserveUsd), name: p.name })),
    routes,
  };
  const text = JSON.stringify(data, null, 1) + '\n';
  if (outFile) writeFileSync(outFile, text); else process.stdout.write(text);
  console.error(`풀 ${pools.length}개(확인 안 돼 뺀 것 ${dropped.length}개${dropped.length ? ': ' + dropped.join(', ') : ''}) · 경로 ` +
    Object.entries(routes).map(([k, v]) => `${k} ${v.length}`).join(', '));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.argv.includes('--force')).catch((e) => { console.error('유니스왑 풀 목록 실패:', e.message); process.exit(1); });
}
