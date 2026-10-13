// Keccak-256. Node's built-in sha3-256 uses different padding, so it can't be used for Ethereum-style hashing.
// Needed to compute Uniswap v4 pool state storage slots.

const MASK = (1n << 64n) - 1n;

// r[x][y] is written row by row in x, so lookups use ROTATION[x * 5 + y],
// while lanes live at lanes[x + 5 * y]; the index orders differ.
const ROTATION = [
  0, 36, 3, 41, 18,
  1, 44, 10, 45, 2,
  62, 6, 43, 15, 61,
  28, 55, 25, 21, 56,
  27, 20, 39, 8, 14,
];

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const rotl = (value, shift) =>
  ((value << shift) | (value >> (64n - shift))) & MASK;

function permute(lanes) {
  for (let round = 0; round < 24; round += 1) {
    const c = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y += 1) lanes[x + 5 * y] ^= d;
    }

    const b = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] =
          rotl(lanes[x + 5 * y], BigInt(ROTATION[x * 5 + y]));
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        lanes[x + 5 * y] =
          b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & b[((x + 2) % 5) + 5 * y] & MASK);
      }
    }
    lanes[0] ^= ROUND_CONSTANTS[round];
  }
}

export function keccak256(bytes) {
  const RATE = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const lanes = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i += 1) {
      let lane = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) {
        lane = (lane << 8n) | BigInt(padded[offset + i * 8 + byte]);
      }
      lanes[i] ^= lane;
    }
    permute(lanes);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    let lane = lanes[i];
    for (let byte = 0; byte < 8; byte += 1) {
      out[i * 8 + byte] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

export const toHex = (bytes) =>
  '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex) => {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

export const keccakHex = (hex) => toHex(keccak256(fromHex(hex)));

// Function selector: first 4 bytes of keccak256 of the signature string.
export const selector = (signature) =>
  toHex(keccak256(new TextEncoder().encode(signature)).slice(0, 4));
