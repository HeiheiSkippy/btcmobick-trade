// Checks that the withdraw fee endpoints used by route lookups are still up and unchanged in format.
//
//   node src/check-fees.mjs          checks the Binance fallback endpoint only when the main one fails
//   node src/check-fees.mjs --all    always checks the Binance fallback endpoint (about 2 MB)
//
// Prints what is wrong and exits with code 1 on problems.
// Reads the same fields as parseBithumbFees, parseBinanceFees and LBANK_USDT_CHAINS in site/engine.js.

const all = process.argv.includes('--all');
const problems = [];
const lines = [];

// Networks the page uses (ROUTE_USDT_NETWORKS).
const BITHUMB_NETS = ['Tron', 'Ethereum', 'Kaia', 'Aptos'];
const BINANCE_NETS = ['TRX', 'ETH', 'BSC', 'KAIA', 'APT'];
const LBANK_CHAINS = ['trc20', 'erc20', 'bep20(bsc)'];

const BINANCE_MAIN = 'https://www.binance.com/bapi/capital/v2/public/capital/config/getOne?coin=USDT&lang=en';
const BINANCE_BACKUP = 'https://www.binance.com/bapi/capital/v1/public/capital/getNetworkCoinAll';

function okFee(value) {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
}

async function get(url, { browser = false } = {}) {
  // The page calls these from the browser, so CORS is checked too.
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: browser ? { Origin: 'https://example.com' } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (browser && !res.headers.get('access-control-allow-origin')) throw new Error('브라우저 요청 허용(CORS) 헤더가 없어졌습니다');
  return res.json();
}

function checkRows(name, rows, keyOf, feeOf, wanted) {
  const found = {};
  for (const row of rows || []) found[keyOf(row)] = row;
  const bad = wanted.filter((k) => !found[k] || !okFee(feeOf(found[k])));
  const shown = wanted.filter((k) => found[k]).map((k) => `${k} ${feeOf(found[k])}`).join(' · ');
  if (bad.length) problems.push(`${name}: ${bad.join(', ')} 출금비를 읽지 못했습니다`);
  lines.push(`${bad.length ? '✗' : '✓'} ${name}  ${shown || '읽은 값 없음'}`);
  return bad.length === 0;
}

async function check(name, fn) {
  try { return await fn(); } catch (err) {
    problems.push(`${name}: ${err.message}`);
    lines.push(`✗ ${name}  ${err.message}`);
    return false;
  }
}

await check('빗썸 fee/inout/USDT', async () => {
  const j = await get('https://api.bithumb.com/v2/fee/inout/USDT', { browser: true });
  const item = Array.isArray(j) ? j[0] : j;
  return checkRows('빗썸 fee/inout/USDT', item && item.networks, (r) => r.net_name, (r) => r.withdraw_fee_quantity, BITHUMB_NETS);
});

const mainOk = await check('바이낸스 v2 config/getOne', async () => {
  const j = await get(BINANCE_MAIN, { browser: true });
  return checkRows('바이낸스 v2 config/getOne', j && j.data, (r) => r.network, (r) => r.withdrawFee, BINANCE_NETS);
});

if (all || !mainOk) await check('바이낸스 v1 getNetworkCoinAll(여벌)', async () => {
  const j = await get(BINANCE_BACKUP, { browser: true });
  const usdt = (j && j.data || []).find((c) => c.coin === 'USDT');
  return checkRows('바이낸스 v1 getNetworkCoinAll(여벌)', usdt && usdt.networkList, (r) => r.network, (r) => r.withdrawFee, BINANCE_NETS);
});

// LBank blocks browser requests and is fetched by src/lbank-fees.mjs instead, so CORS is not checked.
await check('LBank assetConfigs usdt', async () => {
  const j = await get('https://api.lbank.info/v2/assetConfigs.do?assetCode=usdt');
  return checkRows('LBank assetConfigs usdt', j && j.data, (r) => r.chainName, (r) => r.assetFee && r.assetFee.feeAmt, LBANK_CHAINS);
});

console.log(lines.join('\n'));
if (problems.length) {
  console.error(`\n출금비 주소 문제 ${problems.length}건 — Docs/FEE_SOURCE_CHECK.md 절차로 확인하세요.`);
  process.exit(1);
}
