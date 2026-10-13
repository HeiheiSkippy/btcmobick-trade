import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, parseTrades, parseVolumes, collect } from '../src/uni-gecko.mjs';
import { POOLS } from '../src/uni-history.mjs';

const TX = '0x' + 'ab'.repeat(32), WALLET = '0x' + 'cd'.repeat(20);

test('1시간 봉: 종가·거래량만 시각순으로 남긴다', () => {
  const j = { data: { attributes: { ohlcv_list: [[7200, 1, 1, 1, 0.99, 50], [3600, 1, 1, 1, 0.98, 20], [10800, 1, 1, 1, 0, 0]] } } };
  assert.deepEqual(parseHours(j), [[3600, 0.98, 20], [7200, 0.99, 50]]);
  assert.throws(() => parseHours({ data: { attributes: {} } }), /형식/);
});

test('큰 거래: 매수는 받은 양, 매도는 낸 양, 형식이 틀린 주소·해시는 뺀다', () => {
  const t = (kind, extra = {}) => ({ attributes: { kind, block_timestamp: '2026-10-01T00:00:00Z', to_token_amount: '10', from_token_amount: '3',
    volume_in_usd: '1000', tx_from_address: WALLET, tx_hash: TX, ...extra } });
  const rows = parseTrades({ data: [t('buy'), t('sell'), t('buy', { tx_hash: '<script>' })] }, 'mu05');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.buy, r.qty]), [[true, 10], [false, 3]]);
  assert.equal(rows[0].t, Date.parse('2026-10-01T00:00:00Z') / 1000);
});

test('24시간 거래량: 풀 주소로 키를 찾는다', () => {
  const j = { data: [{ attributes: { address: POOLS.mu05.id, volume_usd: { h24: '123.5' } } }, { attributes: { address: '0xother', volume_usd: { h24: '9' } } }] };
  assert.deepEqual(parseVolumes(j), { mu05: 123.5 });
});

test('받지 못한 부분은 이전 값을 두고, 429는 고장으로 치지 않는다', async () => {
  const prev = { hours: { wm10: [[1, 2, 3]], mu05: [[1, 1, 1]] }, hoursAt: 'old', trades: [{ tx: 'old' }], tradesAt: 'old', volume: { mu05: 1 }, volumeAt: 'old' };
  const get = async (path) => {
    if (path.includes('ohlcv')) throw new Error('요청 제한(429)');
    if (path.includes('trades')) return { data: [] };
    throw new Error('GeckoTerminal 404');
  };
  const { state, problems, limited } = await collect(structuredClone(prev), get);
  assert.equal(state.hoursAt, 'old');
  assert.deepEqual(state.trades, []);
  assert.notEqual(state.tradesAt, 'old');
  assert.equal(state.volumeAt, 'old');
  assert.equal(limited.length, 2);
  assert.equal(problems.length, 1);
});
