import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../site/engine.js', import.meta.url), 'utf8');
const source = html.split('// route-engine-start')[1]?.split('// route-engine-end')[0];
assert(source, '화면에 경로 계산 기능이 있어야 합니다');
const { enumerateRoutes, buyFromBook, sellToBook, parseBithumbFees, parseBithumbStatus, uniPoolText, filterRouteExchanges, routeAssetsFor, routeUnit, routeDigits, routeStartNodes, routeGroupSteps, routeGroupLabel, uniBestSplit, uniEncodeAggregate3, uniDecodeAggregate3, uniReadWord, uniCall, uniNormalizeList, uniRouteHops, UNI_PERCENTS, bookRange } = runInNewContext(
  `${source}\n({ enumerateRoutes, buyFromBook, sellToBook, parseBithumbFees, parseBithumbStatus, uniPoolText, filterRouteExchanges, routeAssetsFor, routeUnit, routeDigits, routeStartNodes, routeGroupSteps, routeGroupLabel, uniBestSplit, uniEncodeAggregate3, uniDecodeAggregate3, uniReadWord, uniCall, uniNormalizeList, uniRouteHops, UNI_PERCENTS, bookRange })`
);

test('목적지까지의 직행·우회·왕복 경로를 나열하고 무한 순환은 막는다', () => {
  const edges = [
    { id: 'um', from: 'u', to: 'm' },
    { id: 'mu', from: 'm', to: 'u' },
    { id: 'mw-dex', from: 'm', to: 'w' },
    { id: 'mw-council', from: 'm', to: 'w' },
    { id: 'wm', from: 'w', to: 'm' },
  ];
  const paths = enumerateRoutes(edges, 'u', 'w').map((route) => route.map((e) => e.id).join(','));
  assert(paths.includes('um,mw-dex'));
  assert(paths.includes('um,mw-council'));
  assert(!enumerateRoutes(edges, 'm', 'w').some((route) => route.map((e) => e.id).join(',') === 'mu,um,mw-dex'));
  const cycles = enumerateRoutes(edges, 'u', 'u');
  assert(cycles.some((route) => route.map((e) => e.id).join(',') === 'um,mu'));
  assert(cycles.every((route) => route.length <= 4));
});

test('LBank 구매는 여러 매도 호가와 수수료를 사용하며 부족하면 거절한다', () => {
  assert.equal(buyFromBook([[100, 1], [110, 2]], 210.21, 0.001), 2);
  assert.equal(buyFromBook([[100, 1]], 210.21, 0.001), null);
});

test('LBank 판매는 여러 매수 호가와 수수료를 사용하며 부족하면 거절한다', () => {
  assert.equal(sellToBook([[100, 1], [90, 2]], 2, 0.001), 190 * 0.999);
  assert.equal(sellToBook([[100, 1]], 2, 0.001), null);
});

test('빗썸 체인별 출금비는 공개 API의 배열 응답에서 읽고 결측값은 제외한다', () => {
  const fees = parseBithumbFees([
    [{ currency: 'USDT', networks: [
      { net_name: 'Tron', withdraw_fee_quantity: '0', withdraw_minimum_quantity: '0.000001' },
      { net_name: 'Ethereum', withdraw_fee_quantity: null, withdraw_minimum_quantity: '4' },
    ] }],
    [{ currency: 'XRP', networks: [
      { net_name: 'XRP', withdraw_fee_quantity: '0.4', withdraw_minimum_quantity: '1' },
    ] }],
  ]);
  assert.equal(fees['USDT-tron'].fee, 0);
  assert.equal(fees['XRP-xrp'].min, 1);
  assert.equal(fees['USDT-ethereum'], undefined);
});

test('선택하지 않은 거래소를 거치는 출발·도착 경로를 모두 제외한다', () => {
  const edges = [
    { id: 'binance-buy', from: 'krw', to: 'binance-usdt' },
    { id: 'binance-wallet', from: 'binance-usdt', to: 'wallet-usdt' },
    { id: 'bithumb-buy', from: 'krw', to: 'bithumb-usdt' },
    { id: 'bithumb-lbank', from: 'bithumb-usdt', to: 'lbank-usdt' },
    { id: 'bank-in', from: 'bank-krw', to: 'lbank-usdt' },
    { id: 'wallet-swap', from: 'wallet-usdt', to: 'wallet-movn' },
  ];
  const filtered = filterRouteExchanges(edges, { bithumb: true, binance: false, lbank: false });
  assert.deepEqual(Array.from(filtered, (edge) => edge.id), ['bithumb-buy', 'wallet-swap']);
});

test('장소를 먼저 고르면 그 장소에서 보유할 수 있는 자산만 고를 수 있다', () => {
  assert.deepEqual(Array.from(routeAssetsFor('wallet')), ['usdt', 'movn', 'bmb', 'wbmb', 'bnb', 'eth', 'btc']);
  assert.equal(routeAssetsFor('upbit').length, 0);  // Upbit is not a supported venue
  assert(routeAssetsFor('bithumb').includes('krw'));
  assert(!routeAssetsFor('wallet').includes('krw'));
  assert(!routeAssetsFor('binance').includes('krw'));
  assert.equal(routeUnit('bithumb-krw'), '원');
  assert.equal(routeUnit('wallet-wbmb'), 'WBMB');
  assert.equal(routeDigits('binance-btc'), 8);
  assert.equal(routeDigits('wallet-usdt'), 6);
});

test('같은 방식으로 바로 되돌아가는 경로는 빼되 출발지 왕복과 다른 방식의 되돌림은 남긴다', () => {
  const edges = [
    { id: 'buy', from: 'krw', to: 'usdt', kind: 'ex' },
    { id: 'sell', from: 'usdt', to: 'krw', kind: 'ex' },
    { id: 'send', from: 'usdt', to: 'bmb', kind: 'ex' },
    { id: 'wrap', from: 'bmb', to: 'wbmb', kind: 'wrap' },
    { id: 'unwrap', from: 'wbmb', to: 'bmb', kind: 'wrap' },
    { id: 'council', from: 'bmb', to: 'movn', kind: 'council' },
    { id: 'dex-in', from: 'movn', to: 'bmb', kind: 'dex' },
    { id: 'cash', from: 'bmb', to: 'krw', kind: 'mania' },
  ];
  const ids = (from, to) => enumerateRoutes(edges, from, to, 8).map((r) => r.map((e) => e.id).join(','));
  const toKrw = ids('krw', 'krw');
  assert(toKrw.includes('buy,sell'));
  assert(!toKrw.some((p) => p.includes('wrap,unwrap')));
  assert(ids('wbmb', 'bmb').includes('unwrap'));
  assert(ids('bmb', 'bmb').includes('council,dex-in'));
  assert(!ids('bmb', 'bmb').includes('wrap,unwrap'));
});

test('이용 거래소 모두 비교는 체크한 거래소 중 그 자산을 가질 수 있는 곳을 모두 출발지로 쓴다', () => {
  const enabled = { bithumb: true, binance: true, lbank: true };
  assert.deepEqual(Array.from(routeStartNodes('all', 'krw', enabled)), ['bithumb-krw']);
  assert.deepEqual(Array.from(routeStartNodes('all', 'usdt', { ...enabled, bithumb: false })), ['binance-usdt', 'lbank-usdt']);
  assert.deepEqual(Array.from(routeStartNodes('bithumb', 'krw', enabled)), ['bithumb-krw']);
  // 'any' also compares the personal wallet, and BMB includes wallet WBMB.
  assert.deepEqual(Array.from(routeStartNodes('any', 'bmb', enabled)), ['wallet-bmb', 'wallet-wbmb', 'lbank-bmb']);
  assert.deepEqual(Array.from(routeStartNodes('any', 'krw', enabled)), ['bithumb-krw']);
  assert.deepEqual(Array.from(routeStartNodes('any', 'usdt', enabled)), ['wallet-usdt', 'bithumb-usdt', 'binance-usdt', 'lbank-usdt']);
  assert.deepEqual(Array.from(routeStartNodes('all', 'krw', { ...enabled, mania: true })), ['bithumb-krw', 'mania-krw']);
  assert(!Array.from(routeStartNodes('all', 'usdt', { ...enabled, mania: true })).includes('mania-usdt'));
  assert(Array.from(routeAssetsFor('all', { mania: true })).includes('krw'));
  assert(!Array.from(routeAssetsFor('all', enabled)).includes('movn'));
  assert(Array.from(routeAssetsFor('all', enabled)).includes('krw'));
  assert(!Array.from(routeAssetsFor('all', { bithumb: false, binance: true, lbank: true })).includes('krw'));
});

test('경로 이름에서 연달아 나오는 유니스왑 단계는 거치는 자산을 모두 적어 묶는다', () => {
  const path = [
    { kind: 'transfer', from: 'lbank-usdt', to: 'wallet-usdt', label: 'LBank USDT → BSC 지갑' },
    { kind: 'dex', from: 'wallet-usdt', to: 'wallet-movn', label: '유니스왑 USDT → MOVN' },
    { kind: 'dex', from: 'wallet-movn', to: 'wallet-wbmb', label: '유니스왑 MOVN → WBMB' },
    { kind: 'wrap', from: 'wallet-wbmb', to: 'wallet-bmb', label: 'WBMB → BMB 전환' },
  ];
  const groups = routeGroupSteps(path);
  assert.deepEqual(Array.from(groups, (g) => g.length), [1, 2, 1]);
  assert.equal(routeGroupLabel(groups[1]), '유니스왑 USDT → MOVN → WBMB');
  assert.equal(routeGroupLabel(groups[0]), 'LBank USDT → BSC 지갑');
  const roundTrip = [
    { kind: 'dex', from: 'wallet-wbmb', to: 'wallet-movn', label: 'a' },
    { kind: 'dex', from: 'wallet-movn', to: 'wallet-wbmb', label: 'b' },
  ];
  assert.equal(routeGroupSteps(roundTrip).length, 2);
});

test('USDT 전송은 양쪽이 모두 지원하는 네트워크만 후보로 삼고 가장 많이 받는 네트워크를 고른다', () => {
  const { routeCommonNetworks, bestNetwork, ROUTE_USDT_TRANSFERS } = runInNewContext(
    `${source}\n({ routeCommonNetworks, bestNetwork, ROUTE_USDT_TRANSFERS })`
  );
  assert.deepEqual(Array.from(routeCommonNetworks('bithumb', 'binance')), ['tron', 'ethereum', 'kaia', 'aptos']);
  assert.deepEqual(Array.from(routeCommonNetworks('bithumb', 'lbank')), ['tron', 'ethereum']);
  assert.deepEqual(Array.from(routeCommonNetworks('binance', 'wallet')), ['bsc']);
  assert.deepEqual(Array.from(routeCommonNetworks('lbank', 'binance')), ['tron', 'ethereum', 'bsc']);
  assert.equal(bestNetwork([{ net: 'tron', out: 99 }, { net: 'kaia', out: 99.9 }, { net: 'eth', skip: 'x' }]).net, 'kaia');
  assert.equal(bestNetwork([{ net: 'tron', out: 99 }, { net: 'kaia', out: 99 }]).net, 'tron');
  assert.equal(bestNetwork([{ net: 'tron', skip: 'x' }]), null);
  const pairs = Array.from(ROUTE_USDT_TRANSFERS, (p) => p.join('>'));
  // Upbit is not a venue, and Korean exchange <-> personal wallet transfers are not included.
  assert(!pairs.some((p) => p.includes('upbit')));
  for (const banned of ['bithumb>wallet', 'wallet>bithumb'])
    assert(!pairs.includes(banned), banned);
  for (const wanted of ['bithumb>binance', 'bithumb>lbank', 'binance>bithumb', 'lbank>bithumb', 'lbank>binance', 'wallet>lbank'])
    assert(pairs.includes(wanted), wanted);
});

test('바이낸스 USDT 출금비는 쓰는 네트워크만 읽고 입출금 가능 여부를 함께 둔다', () => {
  const { parseBinanceFees } = runInNewContext(`${source}\n({ parseBinanceFees })`);
  const fees = parseBinanceFees({ data: [
    { network: 'TRX', withdrawFee: '1.5', withdrawMin: '5', withdrawEnable: true, depositEnable: true },
    { network: 'KAIA', withdrawFee: '0.02', withdrawMin: '5', withdrawEnable: false, depositEnable: true },
    { network: 'SOL', withdrawFee: '0.3', withdrawMin: '5', withdrawEnable: true, depositEnable: true },
    { network: 'BSC', withdrawFee: null, withdrawMin: '5', withdrawEnable: true, depositEnable: true },
  ] });
  assert.deepEqual(Array.from(Object.keys(fees)), ['tron', 'kaia']);
  assert.equal(fees.tron.fee, 1.5);
  assert.equal(fees.kaia.canWithdraw, false);
  assert.equal(Object.keys(parseBinanceFees(null)).length, 0);
});

test('연달아 보내기만 하는 USDT 우회는 중간에 들르는 곳을 하나씩 뺀 경로와 견준다', () => {
  const { routeShorterKeys } = runInNewContext(`${source}
({ routeShorterKeys })`);
  const send = (a, b) => ({ id: `send-usdt-${a}-${b}`, from: `${a}-usdt`, to: `${b}-usdt`, kind: 'transfer', asset: 'usdt' });
  const buy = { id: 'buy', from: 'bithumb-krw', to: 'bithumb-usdt', kind: 'bithumb' };
  const direct = new Set(['send-usdt-bithumb-binance', 'send-usdt-bithumb-lbank', 'send-usdt-binance-lbank', 'send-usdt-lbank-wallet']);
  // Bithumb -> Binance -> LBank -> wallet: dropping Binance gives Bithumb -> LBank (exists); dropping LBank gives Binance -> wallet (not in this list).
  const keys = routeShorterKeys([buy, send('bithumb', 'binance'), send('binance', 'lbank'), send('lbank', 'wallet')], direct);
  assert.deepEqual(Array.from(keys), ['buy>send-usdt-bithumb-lbank>send-usdt-lbank-wallet']);
  assert.equal(routeShorterKeys([buy, send('bithumb', 'binance')], direct).length, 0);
});

test('호가를 수량만큼 더해 수수료를 넣은 평균가와 물량이 모자란지를 준다', () => {
  const { fillFromBook } = runInNewContext(`${source}
({ fillFromBook })`);
  const asks = [[100, 1], [110, 2], [120, 5]];
  const buy = fillFromBook(asks, 2, true, 0.001);
  assert.equal(buy.full, true);
  assert.equal(buy.last, 110);
  assert.ok(Math.abs(buy.total - 210 * 1.001) < 1e-9);
  assert.ok(Math.abs(buy.avg - 105 * 1.001) < 1e-9);
  const short = fillFromBook(asks, 10, true, 0);
  assert.equal(short.full, false);
  assert.equal(short.filled, 8);
  assert.equal(short.depth, 8);
  const sell = fillFromBook([[100, 1], [90, 2]], 2, false, 0.001);
  assert.ok(Math.abs(sell.total - 190 * 0.999) < 1e-9);
  assert.equal(fillFromBook(null, 1, true, 0), null);
});

// Uniswap split quotes (ported from smart-order-router getBestSwapRouteBy)
const q = (percent, route, value, pools) => ({ percent, route, q: BigInt(value), pools });
const table = (fn, routes) => {
  const out = {};
  for (const p of UNI_PERCENTS) out[p] = routes.map((pools, r) => q(p, r, fn(r, p), pools)).filter((x) => x.q > 0n);
  return out;
};
test('유니스왑 분할: 풀 하나가 가장 좋으면 100% 그 경로', () => {
  // Route 0 scales linearly (no price impact); route 1 always returns slightly less.
  const best = uniBestSplit(table((r, p) => p * (r ? 9 : 10), [['a'], ['b']]), true);
  assert.equal(best.parts.length, 1);
  assert.equal(best.parts[0].route, 0);
  assert.equal(best.quote, 1000n);
});

test('유니스왑 분할: 가격이 밀리는 두 경로는 나눠 넣는 쪽을 고른다', () => {
  // With two identical concave curves (less out per unit as more goes in), a 50/50 split is best.
  const f = (r, p) => Math.round(1000 * Math.sqrt(p));
  const best = uniBestSplit(table(f, [['a'], ['b']]), true);
  assert.deepEqual(Array.from(best.parts, (x) => x.percent).sort((a, b) => a - b), [50, 50]);
  assert.equal(best.quote, BigInt(2 * f(0, 50)));
});

test('유니스왑 분할: 풀이 겹치는 경로끼리는 나누지 않는다', () => {
  const f = (r, p) => Math.round(1000 * Math.sqrt(p));
  const best = uniBestSplit(table(f, [['wm', 'mu1'], ['wm', 'mu2']]), true);
  assert.equal(best.parts.length, 1);
});

test('유니스왑 분할: 살 때(넣을 양)는 적은 쪽이 좋다', () => {
  const best = uniBestSplit(table((r, p) => p * (r ? 9 : 10), [['a'], ['b']]), false);
  assert.equal(best.parts[0].route, 1);
  assert.equal(best.quote, 900n);
});

test('Multicall3 aggregate3 인코딩을 되읽으면 호출마다 돌려받은 값이 나온다', () => {
  const data = uniEncodeAggregate3([{ to: '0x' + '11'.repeat(20), data: '0xabcdef' }, { to: '0x' + '22'.repeat(20), data: '0x' + '00'.repeat(40) }]);
  assert(data.startsWith('0x82ad56cb'));
  // Response shape: (bool success, bytes returnData)[]; the first call succeeds (32-byte 5), the second fails.
  const w = (v) => BigInt(v).toString(16).padStart(64, '0');
  const e1 = w(1) + w(0x40) + w(32) + w(5), e2 = w(0) + w(0x40) + w(0);
  const resp = '0x' + w(0x20) + w(2) + w(0x40) + w(0x40 + e1.length / 2) + e1 + e2;
  const out = uniDecodeAggregate3(resp);
  assert.equal(uniReadWord(out[0], 0), 5n);
  assert.equal(out[1], null);
});

test('유니스왑 v2 견적은 라우터가 돌려주는 배열에서 알맞은 칸을 읽는다', () => {
  const pool = { proto: 'v2', t0: '0xaa', t1: '0xbb' };
  assert.equal(uniCall(pool, '0xaa', '0xbb', 1n, true).word, 3);  // getAmountsOut -> out of [in, out]
  assert.equal(uniCall(pool, '0xaa', '0xbb', 1n, false).word, 2);  // getAmountsIn -> in of [in, out]
});

test('유니스왑 경로 목록은 반대 방향도 뒤집어 쓴다', () => {
  const W = '0x9e4c611b834672c3643d9818249366bf65ae4c86', M = '0x200b63aa750c901892d4dcf82439860f9c270274', U = '0x55d398326f99059ff775485246999027b3197955';
  const list = uniNormalizeList({ pools: [['v4', '0x01', M, W, 1000, 10], ['v4', '0x02', M, U, 500, 10]], routes: { 'WBMB>USDT': [[0, 1]] } });
  const fwd = uniRouteHops(list, W, U), back = uniRouteHops(list, U, W);
  assert.deepEqual(Array.from(fwd[0], (h) => h.tout), [M, U]);
  assert.deepEqual(Array.from(back[0], (h) => h.tout), [M, W]);
});


test('호가 범위: 팔 때는 매수 호가를 위에서부터, 살 때는 쓰는 돈만큼 매도 호가를', () => {
  const sell = bookRange([[110, 50], [108, 30], [105, 100]], 100, false, 0.001);
  assert.equal(sell.first, 110); assert.equal(sell.last, 105);
  assert(Math.abs(sell.avg - (110 * 50 + 108 * 30 + 105 * 20) / 100) < 1e-9);
  const buy = bookRange([[100, 1], [101, 10]], 201 * 1.001, true, 0.001);
  assert.equal(buy.first, 100); assert.equal(buy.last, 101);
  assert(Math.abs(buy.avg - 201 / 2) < 1e-9);
  assert.equal(bookRange([[100, 1]], 500, false, 0), null);
});

test('빗썸 입출금 상태: 네트워크마다 입금·출금 중지를 읽는다', () => {
  const st = parseBithumbStatus({ status: '0000', data: [
    { currency: 'USDT', net_type: 'TRX', deposit_status: 1, withdrawal_status: 0 },
    { currency: 'USDT', net_type: 'ETH', deposit_status: 1, withdrawal_status: 1 },
    { currency: 'USDT', net_type: 'XYZ', deposit_status: 1, withdrawal_status: 1 },
  ] });
  assert.deepEqual({ ...st.tron }, { canDeposit: true, canWithdraw: false });
  assert.equal(st.ethereum.canWithdraw, true);
  assert.equal(Object.keys(st).length, 2);
  assert.deepEqual({ ...parseBithumbStatus({ status: '5600' }) }, {});
});

test('유니스왑 수수료 줄은 거친 풀을 정확히 적는다', () => {
  const p05 = { name: 'MOVN / USDT 0.05%', fee: 500 }, p045 = { name: 'MOVN / USDT 0.045%', fee: 450 }, wm = { name: 'WBMB / MOVN 0.1%', fee: 1000 };
  assert.equal(uniPoolText([{ percent: 100, hops: [{ pool: p05 }] }]), 'MOVN/USDT 0.05% 풀');
  assert.equal(uniPoolText([{ percent: 100, hops: [{ pool: p05 }, { pool: wm }] }]), 'MOVN/USDT 0.05% → WBMB/MOVN 0.1% 풀');
  assert.equal(uniPoolText([{ percent: 10, hops: [{ pool: p045 }] }, { percent: 90, hops: [{ pool: p05 }] }]),
    'MOVN/USDT 0.05% 90% · MOVN/USDT 0.045% 10%');
});
