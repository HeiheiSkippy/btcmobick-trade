// Route and pool math. No DOM access; also loaded by tests and data collectors.
// route-engine-start
function enumerateRoutes(edges, from, to, maxSteps = 4) {
  const routes = [];
  function visit(node, path, used, visits) {
    if (path.length && node === to) { routes.push(path); return; }
    if (path.length >= maxSteps) return;
    const last = path[path.length - 1];
    for (const edge of edges) {
      if (edge.from !== node || used.has(edge.id)) continue;
      // Skip an immediate reversal of the same kind: it only adds cost. A trade round trip back to the start is kept,
      // but a wrap/transfer round trip is not, since nothing can change in between.
      if (last && last.from === edge.to && last.kind === edge.kind &&
          (edge.to !== from || edge.kind === "wrap" || edge.kind === "transfer")) continue;
      const count = visits.get(edge.to) || 0;
      if (from !== to && count > 0) continue;
      if (from === to && edge.to !== to && count >= 2) continue;
      const nextUsed = new Set(used);
      nextUsed.add(edge.id);
      const nextVisits = new Map(visits);
      nextVisits.set(edge.to, count + 1);
      visit(edge.to, [...path, edge], nextUsed, nextVisits);
    }
  }
  visit(from, [], new Set(), new Map([[from, 1]]));
  return routes;
}
function buyFromBook(asks, budget, feeRate) {
  if (!(budget > 0) || !(feeRate >= 0) || !Array.isArray(asks)) return null;
  let left = budget / (1 + feeRate), received = 0;
  for (const [price, volume] of asks) {
    if (!(price > 0) || !(volume > 0)) continue;
    const used = Math.min(left, price * volume);
    received += used / price;
    left -= used;
    if (left <= budget * 1e-10) return received;
  }
  return null;
}
// For route card notes: first level touched, last level reached, and average price before fees.
// amount is quote spent (fee included) when buying and base sold when selling, as in buyFromBook/sellToBook.
function bookRange(levels, amount, buy, feeRate) {
  if (!Array.isArray(levels) || !(amount > 0)) return null;
  let left = buy ? amount / (1 + feeRate) : amount, base = 0, quote = 0, first = null, last = null;
  for (const [price, volume] of levels) {
    if (!(price > 0) || !(volume > 0)) continue;
    if (first === null) first = price;
    const take = buy ? Math.min(left, price * volume) / price : Math.min(left, volume);
    base += take; quote += take * price; last = price;
    left -= buy ? take * price : take;
    if (left <= amount * 1e-10) return { first, last, avg: quote / base };
  }
  return null;
}
function sellToBook(bids, amount, feeRate) {
  if (!(amount > 0) || !(feeRate >= 0) || !Array.isArray(bids)) return null;
  let left = amount, received = 0;
  for (const [price, volume] of bids) {
    if (!(price > 0) || !(volume > 0)) continue;
    const used = Math.min(left, volume);
    received += used * price;
    left -= used;
    if (left <= amount * 1e-10) return received * (1 - feeRate);
  }
  return null;
}
// Walks book levels (asks ascending to buy, bids descending to sell) for qty.
// avg includes the trading fee, last is the last level reached, depth is the total volume received.
// If the book is too thin, full is false and only `filled` is counted.
function fillFromBook(levels, qty, buy, feeRate) {
  if (!Array.isArray(levels) || !(qty > 0)) return null;
  let left = qty, usdt = 0, last = null, depth = 0;
  for (const [price, volume] of levels) {
    if (!(price > 0) || !(volume > 0)) continue;
    depth += volume;
    if (left > qty * 1e-12) {
      const take = Math.min(left, volume);
      usdt += take * price;
      left -= take;
      last = price;
    }
  }
  const filled = qty - Math.max(left, 0);
  if (!(filled > 0)) return { full: false, filled: 0, depth };
  const total = buy ? usdt * (1 + feeRate) : usdt * (1 - feeRate);
  return { full: left <= qty * 1e-12, filled, total, avg: total / filled, last, depth };
}
function parseBithumbFees(payloads) {
  const fees = {};
  for (const payload of payloads) {
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (!item || !item.currency) continue;
    for (const network of item.networks || []) {
      if (network.withdraw_fee_quantity == null || network.withdraw_minimum_quantity == null) continue;
      const fee = Number(network.withdraw_fee_quantity);
      const min = Number(network.withdraw_minimum_quantity);
      if (Number.isFinite(fee) && fee >= 0 && Number.isFinite(min) && min >= 0)
        fees[item.currency + "-" + network.net_name.toLowerCase()] = { fee, min };
    }
  }
  return fees;
}
// Bithumb deposit/withdraw status per network (1 = open, 0 = suspended).
// The fee endpoint does not report suspensions, so this is read alongside it.
const BITHUMB_NETWORKS = { TRX: "tron", ETH: "ethereum", KAIA: "kaia", APT: "aptos" };
function parseBithumbStatus(payload) {
  const status = {};
  if (!payload || payload.status !== "0000" || !Array.isArray(payload.data)) return status;
  for (const row of payload.data) {
    const net = BITHUMB_NETWORKS[row.net_type];
    if (!net) continue;
    status[net] = { canDeposit: Number(row.deposit_status) === 1, canWithdraw: Number(row.withdrawal_status) === 1 };
  }
  return status;
}
// Reads withdraw fee, minimum and deposit/withdraw flags from the public endpoint behind Binance's withdraw page.
// The endpoint is undocumented and may change.
const BINANCE_NETWORKS = { TRX: "tron", ETH: "ethereum", BSC: "bsc", KAIA: "kaia", APT: "aptos", BTC: "bitcoin" };
function parseBinanceFees(payload) {
  const fees = {};
  if (!payload || !Array.isArray(payload.data)) return fees;
  for (const row of payload.data) {
    const net = BINANCE_NETWORKS[row.network];
    const fee = Number(row.withdrawFee), min = Number(row.withdrawMin);
    // A fee above 100 USDT means the response format changed; ignore it.
    if (!net || row.withdrawFee == null || !Number.isFinite(fee) || fee < 0 || fee > 100) continue;
    fees[net] = { fee, min: Number.isFinite(min) && min >= 0 ? min : 0,
      canWithdraw: row.withdrawEnable === true, canDeposit: row.depositEnable === true };
  }
  return fees;
}
// USDT networks. Each transfer step tries every network both sides support and keeps the best one.
const USDT_NETWORKS = { tron: "Tron", ethereum: "Ethereum", kaia: "Kaia", aptos: "Aptos", bsc: "BSC" };
// Networks each place can send/receive USDT on (only those with a public fee source).
// LBank "klay" is excluded: not confirmed to be the official Tether USDT on Kaia.
// The personal wallet uses BSC only, where the Uniswap pools are.
const ROUTE_USDT_NETWORKS = {
  bithumb: ["tron", "ethereum", "kaia", "aptos"],
  binance: ["tron", "ethereum", "bsc", "kaia", "aptos"],
  lbank: ["tron", "ethereum", "bsc"],
  wallet: ["bsc"]
};
const LBANK_USDT_CHAINS = { tron: "trc20", ethereum: "erc20", bsc: "bep20(bsc)" };
// Allowed USDT transfer pairs, following Bithumb's list of supported counterparties (as of 2026-04-30).
// Korean exchange <-> personal wallet is left out: wallet registration makes it impractical.
const ROUTE_USDT_TRANSFERS = [
  ["bithumb", "binance"], ["bithumb", "lbank"],
  ["binance", "bithumb"], ["binance", "lbank"], ["binance", "wallet"],
  ["lbank", "bithumb"], ["lbank", "binance"], ["lbank", "wallet"],
  ["wallet", "binance"], ["wallet", "lbank"]
];
function routeCommonNetworks(from, to) {
  const receivable = ROUTE_USDT_NETWORKS[to] || [];
  return (ROUTE_USDT_NETWORKS[from] || []).filter((net) => receivable.includes(net));
}
// Picks the option with the highest `out` from [{ net, out } | { net, skip }]; the first wins ties.
function bestNetwork(options) {
  let best = null;
  for (const option of options) if (option.out > 0 && (!best || option.out > best.out)) best = option;
  return best;
}
// Assets each place can hold. Route node ids are `place-asset`.
const ROUTE_EXCHANGE_IDS = ["bithumb", "binance", "lbank"];
const ROUTE_PLACES = [
  { id: "wallet", name: "개인 지갑", assets: ["usdt", "movn", "bmb", "wbmb", "bnb", "eth", "btc"] },
  { id: "bithumb", name: "빗썸", assets: ["krw", "usdt", "btc", "eth"] },
  { id: "binance", name: "바이낸스", assets: ["usdt", "bnb", "eth", "btc"] },
  { id: "lbank", name: "LBank", assets: ["usdt", "bmb"] }
];
const ROUTE_ASSET_NAMES = { krw: "원화", usdt: "USDT", movn: "MOVN", bmb: "BMB", wbmb: "WBMB",
  bnb: "BNB", eth: "ETH", btc: "BTC" };
const ROUTE_WALLET_CHAINS = { usdt: "BSC", movn: "BSC", wbmb: "BSC", bnb: "BSC", bmb: "BMB", eth: "이더리움", btc: "비트코인" };
const ROUTE_ASSET_ORDER = ["krw", "usdt", "movn", "bmb", "wbmb", "bnb", "eth", "btc"];
// place "all" (exchanges in the UI) offers any asset held by at least one enabled exchange.
function routeAssetsFor(place, enabled) {
  if (place === "all") {
    const assets = new Set();
    ROUTE_PLACES.forEach((p) => { if (ROUTE_EXCHANGE_IDS.includes(p.id) && enabled && enabled[p.id]) p.assets.forEach((a) => assets.add(a)); });
    if (enabled && enabled.mania) assets.add("krw");
    return ROUTE_ASSET_ORDER.filter((a) => assets.has(a));
  }
  const found = ROUTE_PLACES.find((p) => p.id === place);
  return found ? found.assets.slice() : [];
}
// Start/end nodes for a place and asset. Mobickmania holds nothing, so it is not a place; when enabled it joins
// exchanges/KRW as a way to buy and sell. "any" also includes the personal wallet, and BMB includes wallet WBMB.
function routeStartNodes(place, asset, enabled) {
  if (place === "any") {
    const nodes = ROUTE_PLACES[0].assets.includes(asset) ? ["wallet-" + asset] : [];
    if (asset === "bmb") nodes.push("wallet-wbmb");
    return nodes.concat(routeStartNodes("all", asset, enabled));
  }
  if (place !== "all") return [place + "-" + asset];
  const nodes = ROUTE_PLACES.filter((p) => ROUTE_EXCHANGE_IDS.includes(p.id) && enabled[p.id] && p.assets.includes(asset))
    .map((p) => p.id + "-" + asset);
  if (asset === "krw" && enabled.mania) nodes.push("mania-krw");
  return nodes;
}
function routeNodeName(node) {
  if (node === "mania-krw") return "모빅매니아";
  const place = ROUTE_PLACES.find((p) => p.id === node.slice(0, node.indexOf("-")));
  return (place ? place.name : "") + " " + (ROUTE_ASSET_NAMES[routeAsset(node)] || routeAsset(node));
}
function routeAsset(node) { return node.slice(node.indexOf("-") + 1); }
function routePlace(node) { return node.slice(0, node.indexOf("-")); }
function routeUnit(node) {
  const asset = routeAsset(node);
  return asset === "krw" ? "원" : ROUTE_ASSET_NAMES[asset] || asset.toUpperCase();
}
function routeDigits(node) { return ["bmb", "wbmb", "btc"].includes(routeAsset(node)) ? 8 : 6; }
// Consecutive Uniswap steps are labeled as one swap (WBMB → MOVN → USDT); the details list each hop.
// Quoting pool by pool gives the same result as a single multi-hop swap.
function routeGroupSteps(items, edgeOf = (x) => x) {
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    // Don't group consecutive swaps that return to the starting asset; a router would not do that.
    if (last && edgeOf(item).kind === "dex" && edgeOf(last[last.length - 1]).kind === "dex" &&
        edgeOf(last[0]).from !== edgeOf(item).to) last.push(item);
    else groups.push([item]);
  }
  return groups;
}
function routeGroupLabel(edges) {
  if (edges.length === 1) return edges[0].label;
  const unit = (node) => ROUTE_ASSET_NAMES[routeAsset(node)] || routeAsset(node);
  return "유니스왑 " + [unit(edges[0].from)].concat(edges.map((e) => unit(e.to))).join(" → ");
}
// Route keys with one intermediate USDT hop removed (Bithumb → Binance → LBank becomes Bithumb → LBank
// when a direct transfer exists). Used to drop detours that receive no more than the shorter route.
function routeShorterKeys(path, directIds) {
  const ids = path.map((edge) => edge.id), keys = [];
  const isSend = (edge) => edge && edge.kind === "transfer" && edge.asset === "usdt";
  for (let i = 0; i + 1 < path.length; i++) {
    if (!isSend(path[i]) || !isSend(path[i + 1])) continue;
    const direct = "send-usdt-" + routePlace(path[i].from) + "-" + routePlace(path[i + 1].to);
    if (!directIds.has(direct)) continue;
    keys.push(ids.slice(0, i).concat([direct], ids.slice(i + 2)).join(">"));
  }
  return keys;
}
function routeVenue(node) {
  for (const venue of ROUTE_EXCHANGE_IDS)
    if (node.startsWith(venue + "-")) return venue;
  return null;
}
function filterRouteExchanges(edges, enabled) {
  return edges.filter(function (edge) {
    const from = routeVenue(edge.from), to = routeVenue(edge.to);
    return (!from || enabled[from]) && (!to || enabled[to]);
  });
}

// ─── Uniswap split quotes ───
// Same approach as the Uniswap app's smart-order-router (getBestSwapRouteBy): quote each route alone at 5%..100%,
// then combine routes that share no pool, summing to 100%, for the best total (most out, or least in when buying).
// Up to 3 pools per route and 7 routes per split. Gas is ignored (a few cents per route on BSC).
const UNI_PERCENTS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
const UNI_V4_QUOTER = "0x9f75dd27d6664c475b90e105573e550ff69437b0";
const UNI_V3_QUOTER = "0x78d78e420da98ad378d7799be8f4af69033eb077";
const UNI_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const uniWord = (v) => (typeof v === "string" ? v.toLowerCase().replace("0x", "") : BigInt(v).toString(16)).padStart(64, "0");

// Normalizes the pool list file into { pools: { id: pool }, routes: { "WBMB>USDT": [[poolId, ...]] } }.
function uniNormalizeList(list) {
  const pools = {}, routes = {};
  const raw = list.pools.map((p) => Array.isArray(p)
    ? { proto: p[0], id: p[1], t0: p[2], t1: p[3], fee: p[4], ts: p[5], hooks: p[6] }
    : p);
  raw.forEach((p) => {
    pools[p.id.toLowerCase()] = { proto: p.proto, id: p.id.toLowerCase(), t0: p.t0.toLowerCase(), t1: p.t1.toLowerCase(), fee: p.fee,
      ts: p.ts, hooks: (p.hooks || "0x0000000000000000000000000000000000000000").toLowerCase(), name: p.name || "" };
  });
  Object.keys(list.routes).forEach((key) => {
    routes[key] = list.routes[key].map((r) => (Array.isArray(r) ? r : r.pools)
      .map((x) => (typeof x === "number" ? raw[x].id : x).toLowerCase()));
  });
  return { pools: pools, routes: routes };
}
// Routes from token `from` to `to` as hop lists. Uses reversed to>from routes if only those exist.
function uniRouteHops(list, from, to) {
  from = from.toLowerCase(); to = to.toLowerCase();
  const symbolOf = (a) => ({ "0x9e4c611b834672c3643d9818249366bf65ae4c86": "WBMB", "0x200b63aa750c901892d4dcf82439860f9c270274": "MOVN",
    "0x55d398326f99059ff775485246999027b3197955": "USDT" })[a];
  const fwd = list.routes[symbolOf(from) + ">" + symbolOf(to)], back = list.routes[symbolOf(to) + ">" + symbolOf(from)];
  const ids = fwd || (back || []).map((r) => r.slice().reverse());
  return ids.map((r) => {
    let token = from;
    return r.map((id) => {
      const pool = list.pools[id];
      if (!pool || (pool.t0 !== token && pool.t1 !== token)) throw new Error("풀 목록이 맞지 않습니다");
      const tout = pool.t0 === token ? pool.t1 : pool.t0, hop = { pool: pool, tin: token, tout: tout };
      token = tout;
      return hop;
    });
  }).filter((hops) => hops.length && hops[hops.length - 1].tout === to);
}
// One pool quote call. exactIn: output for `amount` of tin; otherwise the tin needed to receive `amount` of tout.
// word: the 32-byte slot to read from the result (the v2 router returns an array).
function uniCall(pool, tin, tout, amount, exactIn) {
  if (pool.proto === "v4") {
    return { to: UNI_V4_QUOTER, word: 0, data: (exactIn ? "0xaa9d21cb" : "0x58733073") + uniWord(0x20) + uniWord(pool.t0) + uniWord(pool.t1) +
      uniWord(pool.fee) + uniWord(pool.ts) + uniWord(pool.hooks) + uniWord(tin === pool.t0 ? 1 : 0) + uniWord(amount) + uniWord(0x100) + uniWord(0) };
  }
  if (pool.proto === "v3") {
    return { to: UNI_V3_QUOTER, word: 0, data: (exactIn ? "0xc6a5026a" : "0xbd21704a") + uniWord(tin) + uniWord(tout) + uniWord(amount) + uniWord(pool.fee) + uniWord(0) };
  }
  // v2: getAmountsOut(amount, [tin, tout]) → [in, out], getAmountsIn(amount, [tin, tout]) → [in, out]
  return { to: UNI_V2_ROUTER, word: exactIn ? 3 : 2, data: (exactIn ? "0xd06ca61f" : "0x1f00ca74") + uniWord(amount) + uniWord(0x40) + uniWord(2) + uniWord(tin) + uniWord(tout) };
}
// Multicall3 aggregate3((address target, bool allowFailure, bytes callData)[]) encoding and decoding.
function uniEncodeAggregate3(calls) {
  const elems = calls.map((c) => {
    const d = c.data.replace("0x", ""), len = d.length / 2;
    return uniWord(c.to) + uniWord(1) + uniWord(0x60) + uniWord(len) + d.padEnd(Math.ceil(len / 32) * 64, "0");
  });
  let off = calls.length * 32, heads = "";
  elems.forEach((e) => { heads += uniWord(off); off += e.length / 2; });
  return "0x82ad56cb" + uniWord(0x20) + uniWord(calls.length) + heads + elems.join("");
}
// Each call's return bytes as hex, or null if it failed.
function uniDecodeAggregate3(hex) {
  const h = hex.replace("0x", ""), w = (byte) => Number(BigInt("0x" + h.slice(byte * 2, byte * 2 + 64)));
  const arr = w(0), n = w(arr), base = arr + 32, out = [];
  for (let i = 0; i < n; i++) {
    const e = base + w(base + 32 * i), ok = w(e) === 1, bo = e + w(e + 32), len = w(bo);
    out.push(ok && len > 0 ? h.slice((bo + 32) * 2, (bo + 32 + len) * 2) : null);
  }
  return out;
}
function uniReadWord(bytesHex, i) {
  if (!bytesHex || bytesHex.length < (i + 1) * 64) return null;
  const v = BigInt("0x" + bytesHex.slice(i * 64, (i + 1) * 64));
  return v > 0n ? v : null;
}
// quotes: { percent: [{ q: BigInt, route, pools: [poolId] }] }. Returns { quote, parts: [{ percent, route, q }] } or null.
function uniBestSplit(quotes, exactIn, maxSplits = 7) {
  const better = (a, b) => (exactIn ? a > b : a < b);
  const sorted = {};
  UNI_PERCENTS.forEach((p) => {
    if (quotes[p] && quotes[p].length) sorted[p] = quotes[p].slice().sort((x, y) => (better(x.q, y.q) ? -1 : better(y.q, x.q) ? 1 : 0));
  });
  let bestQuote = null, best = null;
  if (sorted[100]) { bestQuote = sorted[100][0].q; best = [sorted[100][0]]; }
  const queue = [];
  for (let i = UNI_PERCENTS.length - 1; i >= 0; i--) {
    const p = UNI_PERCENTS[i];
    if (!sorted[p]) continue;
    queue.push({ cur: [sorted[p][0]], idx: i, rem: 100 - p });
    if (sorted[p][1]) queue.push({ cur: [sorted[p][1]], idx: i, rem: 100 - p });
  }
  // First candidate sharing no pool with the routes already used (findFirstRouteNotUsingUsedPools).
  const firstFree = (used, cands) => {
    const seen = new Set();
    used.forEach((u) => u.pools.forEach((id) => seen.add(id)));
    return cands.find((c) => !c.pools.some((id) => seen.has(id))) || null;
  };
  let splits = 1;
  while (queue.length) {
    let layer = queue.length;
    splits++;
    if (splits >= 3 && best && best.length < splits - 1) break;
    if (splits > maxSplits) break;
    while (layer-- > 0) {
      const { rem, cur, idx } = queue.shift();
      for (let i = idx; i >= 0; i--) {
        const pA = UNI_PERCENTS[i];
        if (pA > rem || !sorted[pA]) continue;
        const a = firstFree(cur, sorted[pA]);
        if (!a) continue;
        const remN = rem - pA, curN = cur.concat([a]);
        if (remN === 0) {
          const q = curN.reduce((t, r) => t + r.q, 0n);
          if (bestQuote === null || better(q, bestQuote)) { bestQuote = q; best = curN; }
        } else queue.push({ cur: curN, rem: remN, idx: i });
      }
    }
  }
  return best ? { quote: bestQuote, parts: best.map((r) => ({ percent: r.percent, route: r.route, q: r.q })) } : null;
}
// Pool label: one pool, hops joined by →, or each split route with its share (%).
// Pool names come from the pool list file (e.g. "MOVN / USDT 0.05%").
function uniPct(x) { return Number((x * 100).toFixed(4)) + "%"; }
function uniPoolName(pool) {
  const name = String(pool.name || "").replace(/\s*\/\s*/g, "/");
  return name ? (/%/.test(name) ? name : name + " " + uniPct(pool.fee / 1e6)) : uniPct(pool.fee / 1e6);
}
function uniPoolText(parts) {
  const list = parts.slice().sort((a, b) => b.percent - a.percent);
  const route = (p) => p.hops.map((h) => uniPoolName(h.pool)).join(" → ");
  if (list.length === 1) return route(list[0]) + " 풀";
  return list.map((p) => route(p) + " " + p.percent + "%").join(" · ");
}
// route-engine-end
