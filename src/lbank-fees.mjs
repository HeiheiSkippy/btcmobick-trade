// LBank deposit/withdraw settings (withdraw fee, minimum, open/suspended per chain) written to a file for the page.
// The LBank public API blocks cross-site browser requests, so the GitHub Action reads it and publishes the file with the page.
//
//   node src/lbank-fees.mjs site/data/lbank-fees.json [previous file URL]
//
// If reading fails, the previous file's values are written back unchanged, keeping the old timestamp.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSETS = ['usdt', 'bmb'];

export function parseLbankAssetConfigs(payload) {
  if (!payload || payload.result !== 'true' || !Array.isArray(payload.data)) throw new Error('LBank 응답 형식이 다릅니다');
  return payload.data.map((row) => {
    const fee = Number(row.assetFee && row.assetFee.feeAmt);
    const min = Number(row.assetFee && row.assetFee.minAmt);
    return {
      chain: row.chainName,
      canDeposit: row.canDeposit === true,
      canWithdraw: row.canDraw === true,
      fee: row.assetFee && row.assetFee.feeAmt != null && Number.isFinite(fee) && fee >= 0 ? fee : null,
      min: Number.isFinite(min) && min >= 0 ? min : null,
    };
  });
}

async function readLbankFees() {
  const assets = {};
  for (const asset of ASSETS) {
    const res = await fetch(`https://api.lbank.info/v2/assetConfigs.do?assetCode=${asset}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${asset} 요청 실패 ${res.status}`);
    assets[asset] = parseLbankAssetConfigs(await res.json());
  }
  return { at: new Date().toISOString(), assets };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out, previousUrl] = process.argv.slice(2);
  if (!out) {
    console.error('쓸 파일 경로를 적어 주십시오');
    process.exit(2);
  }
  let record = null;
  try {
    record = await readLbankFees();
    console.log('LBank 입출금 설정', JSON.stringify(record));
  } catch (err) {
    console.error('LBank 입출금 설정을 읽지 못했습니다:', err.message);
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
