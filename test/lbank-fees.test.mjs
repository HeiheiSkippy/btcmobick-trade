import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLbankAssetConfigs } from '../src/lbank-fees.mjs';

test('LBank 입출금 설정에서 체인별 출금비·최소량·가능 여부를 읽고 결측값은 비운다', () => {
  const rows = parseLbankAssetConfigs({ result: 'true', data: [
    { chainName: 'bep20(bsc)', canDeposit: true, canDraw: true, assetFee: { feeAmt: '0.2', minAmt: '5' } },
    { chainName: 'omni', canDeposit: false, canDraw: false, assetFee: { feeAmt: null, minAmt: '0' } },
  ] });
  assert.deepEqual(rows[0], { chain: 'bep20(bsc)', canDeposit: true, canWithdraw: true, fee: 0.2, min: 5 });
  assert.equal(rows[1].fee, null);
  assert.equal(rows[1].canWithdraw, false);
  assert.throws(() => parseLbankAssetConfigs({ result: 'false' }));
});

test('LBank 1시간 봉은 시작 시각·종가·거래량만 남기고 시간순으로 둔다', async () => {
  const { parseLbankKline } = await import('../src/lbank-kline.mjs');
  const rows = parseLbankKline({ result: 'true', data: [
    [1790006400, 117.2, 118, 117, 117.5, 3], [1790002800, 117, 117.9, 116.8, 117.2, 1], [1790010000, 1, 1, 1, 0, 0],
  ] });
  assert.deepEqual(rows, [[1790002800, 117.2, 1], [1790006400, 117.5, 3]]);
  assert.throws(() => parseLbankKline({ result: 'false', data: [] }));
  assert.throws(() => parseLbankKline({ result: 'true', data: [] }));
});
