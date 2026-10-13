// Checks that the Uniswap pool/route list for quotes (site/data/uni-pools.json) is still valid.
//
//   node src/check-uni-pools.mjs                 on-chain checks only (1-2 s)
//   node src/check-uni-pools.mjs --gecko         also asks GeckoTerminal for new pools
//
// GeckoTerminal is not queried by default: it shares a 30 requests/min per-IP limit with the other GeckoTerminal job, and
// rejections made runs much slower. New pools are picked up when the list is rebuilt every 6 hours.
//
// Problems (exit code 1):
// - the file is missing or over a day old (the 6-hourly rebuild keeps failing)
// - (--gecko) a WBMB or MOVN Uniswap pool on GeckoTerminal with reserves above the threshold is missing from the file
// - a pool in the file cannot be confirmed on chain (pool key or tokens don't match)
import { readFileSync } from 'node:fs';
import { MIN_RESERVE_USD, T, gecko, fromGecko, verifyAll } from './uni-pools.mjs';

const FILE = 'site/data/uni-pools.json';
const MAX_AGE_DAYS = 1;
const problems = [];

let data;
try { data = JSON.parse(readFileSync(FILE, 'utf8')); } catch (e) {
  console.error(`유니스왑 풀 목록 점검 실패: ${FILE}을 읽지 못했습니다(${e.message}). node src/uni-pools.mjs ${FILE}로 만드십시오.`);
  process.exit(1);
}

// 1. Staleness
const ageDays = (Date.now() - new Date(data.generatedAt).getTime()) / 86400000;
if (!(ageDays <= MAX_AGE_DAYS)) problems.push(`파일이 ${ageDays.toFixed(1)}일 전 것입니다(기준 ${MAX_AGE_DAYS}일). npm run refresh로 새로 만드십시오`);

// 2. Missing pools
const have = new Set(data.pools.map((p) => p.id));
if (process.argv.includes('--gecko')) for (const token of [T.WBMB, T.MOVN]) {
  try {
    const j = await gecko(`tokens/${token}/pools?page=1`);
    for (const p of j.data || []) {
      const g = fromGecko(p);
      if (g && g.reserveUsd >= MIN_RESERVE_USD && !have.has(g.id)) problems.push(`목록에 없는 풀: ${g.name} (${g.proto}, 잔고 $${Math.round(g.reserveUsd)}, ${g.id})`);
    }
  } catch (e) { problems.push(`GeckoTerminal 풀 목록 요청 실패: ${e.message}`); }
}

// 3. On-chain confirmation
let checked = null;
try { checked = await verifyAll(data.pools.map((p) => ({ proto: p.proto, id: p.id, a: p.t0, b: p.t1 }))); }
catch (e) { problems.push(`체인 확인 요청 실패: ${e.message}`); }
for (const [i, p] of (checked ? data.pools : []).entries()) {
  const v = checked[i];
  if (!v) problems.push(`체인에서 확인 안 되는 풀: ${p.name} (${p.proto}, ${p.id})`);
  else if (v.fee !== p.fee || (p.proto === 'v4' && (v.ts !== p.ts || v.hooks !== p.hooks))) problems.push(`풀 설정이 파일과 다름: ${p.name} (${p.id})`);
}

console.log(`유니스왑 풀 목록: ${data.generatedAt.slice(0, 16)} · 풀 ${data.pools.length}개 · 경로 ` +
  Object.entries(data.routes).map(([k, v]) => `${k} ${v.length}`).join(', '));
if (problems.length) {
  console.error('유니스왑 풀 목록 점검 실패:\n- ' + problems.join('\n- ') + '\n고치는 절차는 Docs/UNI_POOLS_CHECK.md');
  process.exit(1);
}
console.log('유니스왑 풀 목록 점검 정상');
