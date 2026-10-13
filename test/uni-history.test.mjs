import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSwap, addToHours, trimHistory, emptyState, POOLS } from '../src/uni-history.mjs';

// A real Swap event from the WBMB/MOVN 0.1% pool on 2026-09-28 (block 0x76b96b8): MOVN paid, 0.50007467 WBMB received.
const WM_DATA = '0xfffffffffffffffffffffffffffffffffffffffffffffffceeb48ba6ae3360000000000000000000000000000000000000000000000000000000000002fb0dab000000000000000000000000000000000000000000000fc7a9cbbfb8ac374d76000000000000000000000000000000000000000000000000049010e962b7681dfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbc3d200000000000000000000000000000000000000000000000000000000000004a9';

test('Swap 이벤트에서 가격(상대 자산/기준 자산)과 거래 방향을 읽는다', () => {
  const s = decodeSwap(WM_DATA, POOLS.wm10);
  assert.ok(Math.abs(s.base - 0.50007467) < 1e-9, '받은 WBMB');
  assert.equal(s.buy, true, '거래한 쪽이 WBMB를 받았으니 매수');
  assert.ok(s.quote < 0, 'MOVN은 냄');
  // Same magnitude as the displayed price at the time (1 WBMB ≈ 113 MOVN).
  assert.ok(s.price > 90 && s.price < 140, `가격 ${s.price}`);
  // MOVN paid ÷ WBMB received is near the pool price (off by fees and price impact).
  assert.ok(Math.abs(-s.quote / s.base / s.price - 1) < 0.02);
});

test('MOVN/USDT 풀: sqrtPriceX96 = 2^96이면 1 MOVN = 1 USDT', () => {
  const w = (v) => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(64, '0');
  const data = '0x' + w(-(10n ** 18n)) + w(99n * 10n ** 16n) + w(1n << 96n) + w(0n) + w(0n) + w(500n);
  const s = decodeSwap(data, POOLS.mu05);
  assert.ok(Math.abs(s.price - 1) < 1e-12);
  assert.equal(s.buy, false, 'MOVN을 냈으니 매도');
  assert.ok(Math.abs(s.quote - 0.99) < 1e-12);
});

test('시간 봉은 그 시간 마지막 스왑이 종가, 거래량은 상대 자산 합', () => {
  const hours = addToHours([[3600, 1.0, 5]], [
    { t: 3700, price: 1.1, quote: -2 }, { t: 7300, price: 1.2, quote: 3 }, { t: 7400, price: 1.3, quote: -1 },
  ]);
  assert.deepEqual(hours, [[3600, 1.1, 7], [7200, 1.3, 4]]);
});

test('기록은 7일치 봉과 26시간 큰 거래만 남기고 같은 거래는 한 번만 둔다', () => {
  const now = 100 * 86400;
  const st = emptyState();
  st.pools.wm10.hours = [[now - 8 * 86400, 1, 1], [now - 3600, 2, 2]];
  const tx = '0x' + 'a'.repeat(64);
  st.trades = [{ t: now - 30 * 3600, pool: 'wm10', tx: '0x' + 'b'.repeat(64) }, { t: now - 60, pool: 'wm10', tx }, { t: now - 60, pool: 'wm10', tx }];
  trimHistory(st, now);
  assert.deepEqual(st.pools.wm10.hours, [[now - 3600, 2, 2]]);
  assert.equal(st.trades.length, 1);
});
