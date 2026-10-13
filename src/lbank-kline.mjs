// LBank BMB/USDT hourly candles (last 7 days) written to a file for the market price chart.
// The LBank public API blocks cross-site browser requests, so the GitHub Action reads it and publishes the file with the page.
//
//   node src/lbank-kline.mjs site/data/lbank-kline.json [previous file URL]
//
// File format: { at, candles: [[candle start unix seconds, close USDT, volume BMB], ...] } in time order.
// If reading fails, the previous file's values are written back unchanged, keeping the old timestamp.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAYS = 7;

export function parseLbankKline(payload) {
  if (!payload || payload.result !== 'true' || !Array.isArray(payload.data)) throw new Error('LBank 응답 형식이 다릅니다');
  const candles = payload.data
    .map((row) => [Number(row[0]), Number(row[4]), Number(row[5]) >= 0 ? Number(row[5]) : 0])
    .filter(([t, close]) => Number.isInteger(t) && t > 0 && close > 0)
    .sort((a, b) => a[0] - b[0]);
  if (!candles.length) throw new Error('봉이 없습니다');
  return candles;
}

async function readLbankKline() {
  const from = Math.floor(Date.now() / 1000) - DAYS * 86400 - 3600;
  const res = await fetch(`https://api.lbkex.com/v2/kline.do?symbol=bmb_usdt&size=${DAYS * 24 + 2}&type=hour1&time=${from}`,
    { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`요청 실패 ${res.status}`);
  return { at: new Date().toISOString(), candles: parseLbankKline(await res.json()) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out, previousUrl] = process.argv.slice(2);
  if (!out) {
    console.error('쓸 파일 경로를 적어 주십시오');
    process.exit(2);
  }
  let record = null;
  try {
    record = await readLbankKline();
    console.log('LBank 1시간 봉', record.candles.length, '개');
  } catch (err) {
    console.error('LBank 1시간 봉을 읽지 못했습니다:', err.message);
    if (previousUrl) {
      try {
        const res = await fetch(previousUrl, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          record = await res.json();
          console.log('이전 값을 유지합니다', record.at);
        }
      } catch (e) {
        console.error('이전 값도 받지 못했습니다:', e.message);
      }
    }
  }
  if (!record) process.exit(1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(record) + '\n');
}
