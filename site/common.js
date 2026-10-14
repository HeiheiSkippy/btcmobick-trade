"use strict";
// Values and helpers shared by both pages. Loaded after engine.js and before the page script,
// which calls commonStart() at the end to begin the shared refresh loops.

var RPC = "https://bsc-dataseed.binance.org";
// Backup node, raced against RPC when it has not answered within RPC_HEDGE_MS (requests sometimes stall for 2-6 s).
var RPC_BACKUP = "https://bsc-rpc.publicnode.com", RPC_HEDGE_MS = 1000;
var BITHUMB_TICKER = "https://api.bithumb.com/v1/ticker?markets=KRW-USDT";

// Uniswap v4 quoter on BSC.
var QUOTER = "0x9F75dD27D6664c475B90e105573E550ff69437B0";
var QUOTE_SELECTOR = "0xaa9d21cb";  // quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))
var QUOTE_EXACT_OUTPUT_SELECTOR = "0x58733073";  // quoteExactOutputSingle, same arguments

var WBMB = "0x9E4c611B834672c3643D9818249366bf65ae4C86";
var MOVN = "0x200b63AA750c901892d4DCf82439860F9C270274";
var USDT = "0x55d398326f99059fF775485246999027B3197955";
var PM   = "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df";

// keccak256(poolId ‖ uint256(6)): storage slot of the pool mapping. Constant, so precomputed.
var SLOT_WBMB_MOVN = "0x918f38e4c2935e49e74d32d294b4e4caa569014f56cf489cde9aa91e1de38b3d";
var SLOT_USDT_WBMB = "0xd0f5f2db549e8effe04d768dd6d78a628cc512c16321835a4c088b276ce1c460";

var FEE = {
  bithumbTrade: 0.0004,
  binanceTrade: 0.001,
  lbankTrade: 0.001,
  maniaSell: 0.005  // Mobickmania charges 0.5% on BMB sells only, taken from the BMB sold
};

var DAYS = ["일", "월", "화", "수", "목", "금", "토"];
var $ = function (id) { return document.getElementById(id); };

function fmt(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 2 : d });
}
function pct(x) { return !isFinite(x) ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%"; }

function settle(promise) {
  return promise.then(function (v) { return { ok: true, v: v }; }, function () { return { ok: false }; });
}
function json(r) { if (!r.ok) throw new Error(r.status); return r.json(); }

// POSTs a JSON-RPC body and resolves with the parsed reply from whichever node answers first.
// The backup is sent only if RPC is slow or fails, so normal load on it stays near zero.
function rpcPost(body) {
  return new Promise(function (resolve, reject) {
    var settled = false, pending = 0, backupSent = false, timer;
    function send(url) {
      pending++;
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(j);
        }, function (err) {
          pending--;
          if (settled) return;
          if (!backupSent) { clearTimeout(timer); backup(); return; }
          if (pending === 0) { settled = true; reject(err); }
        });
    }
    function backup() { backupSent = true; send(RPC_BACKUP); }
    send(RPC);
    timer = setTimeout(function () { if (!settled && !backupSent) backup(); }, RPC_HEDGE_MS);
  });
}
function rpc(method, params) {
  return rpcPost(JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })).then(function (j) {
    if (j.error) throw new Error(j.error.message);
    return j.result;
  });
}
function pad32(a) { return a.toLowerCase().replace("0x", "").padStart(64, "0"); }
function call(to, data) { return rpc("eth_call", [{ to: to, data: data }, "latest"]); }
function scaled(hex, dec) { return Number(BigInt(hex)) / Math.pow(10, dec); }

function poolPrice(slot, dec0, dec1) {
  return call(PM, "0x1e2eaeaf" + slot.slice(2)).then(function (word) {
    var w = BigInt(word);
    if (w === 0n) throw new Error("빈 풀");
    var sqrt = w & ((1n << 160n) - 1n);
    return (Math.pow(Number(sqrt), 2) / Math.pow(2, 192)) * Math.pow(10, dec0 - dec1);
  });
}

// Reference pool for the header MOVN price and the peg view: among the hookless MOVN/USDT v4 pools in the pool list,
// the one with the most active liquidity, re-picked on every read so a better new pool is followed. Before the list loads, only the 0.05% pool is used.
// Both tokens have 18 decimals, so raw price equals display price.
var MOVN_POOL = { id: "0x5de52159724f0d421445f4a5eeccc047bb6cc7821a008b7a171d896256d3a217", fee: 500 };
function feeLabel(pool) { return pool.fee / 1e4 + "%"; }
function movnUsdtPrice() {
  var list = pegPoolList();
  if (!list.length) list = [MOVN_POOL];
  return svBatch(list.reduce(function (a, p) { return a.concat([SV_SLOT0 + p.id.slice(2), SV_LIQ + p.id.slice(2)]); }, []))
    .then(function (r) {
      var best = null;
      list.forEach(function (p, i) {
        var sqrt = Number(BigInt("0x" + r[2 * i].slice(2, 66))) / Math.pow(2, 96), L = Number(BigInt(r[2 * i + 1]));
        if (sqrt > 0 && L > 0 && (!best || L > best.L)) best = { pool: p, L: L, price: sqrt * sqrt };
      });
      if (!best) throw new Error("빈 풀");
      // When the reference pool changes, recompute the peg view with the new pool (only if it is on screen).
      if (best.pool.id !== MOVN_POOL.id && typeof PEG !== "undefined" && PEG.at) {
        PEG.at = 0;
        if (onMarketPage()) setTimeout(loadPeg, 0);
      }
      MOVN_POOL = best.pool;
      return best.price;
    });
}

// Rounds to units of 10^4 or 10^8 (Korean man/eok), marking inexact values as approximate.
function man(x) {
  var unit = x >= 1e8 ? 1e8 : 1e4, name = x >= 1e8 ? "억" : "만";
  var v = Math.round(x / unit * 10) / 10;
  return (Math.abs(x - v * unit) < 1 ? "" : "약 ") + v + name;
}

function nextAnnouncement(now) {
  for (var i = 0; i < 8; i++) {
    var kst = new Date(now.getTime() + i * 86400000 + 9 * 3600000);
    var day = kst.getUTCDay();
    if (day === 1 || day === 3 || day === 6) {
      var t = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 3, 0, 0);
      if (t > now.getTime()) return new Date(t);
    }
  }
  return null;
}

// Fetched values. A value never fetched since page load stays null and shows as not received.
// If a later refresh fails, the previous value is kept and shown with its last fetch time and a failure note.
var D = {
  lbank: null,
  usdtKrw: null, wbmbInMovn: null, movnUsdt: null,
  wbmbSupply: null, movnSupply: null,
  lbankAsk: null, lbankBid: null, lbankAsks: null, lbankBids: null
};
var loaded = false;

var SRC = {
  bithumb:   { at: null, ok: false },
  pools:     { at: null, ok: false },
  chain:     { at: null, ok: false }
};
function mark(key, ok) { SRC[key].tried = true; SRC[key].ok = ok; if (ok) SRC[key].at = new Date(); }
// Fresh timestamps are green; failed or stale values are orange (.fail, .stale).
function fresh(text) { return '<span class="fresh">' + text + "</span>"; }
function stamp(key, seconds) {
  var s = SRC[key];
  if (s.live) return fresh(hmss(s.at) + " 갱신");
  if (!s.tried) return "불러오는 중";
  if (!s.at) return '<span class="fail">받지 못함</span>';
  var t = seconds ? hmss(s.at) : hm(s.at);
  return s.ok ? fresh(t + " 갱신") : '<span class="fail">' + t + " 값 · 갱신 실패</span>";
}
function has(v) { return typeof v === "number" && isFinite(v); }
// Collapsible help (details.help). Sections that are re-rendered often remember their open state by the data-help key.
var HELP_OPEN = {};
document.addEventListener("toggle", function (e) {
  var key = e.target.getAttribute && e.target.getAttribute("data-help");
  if (key) HELP_OPEN[key] = e.target.open;
}, true);
function helpHtml(key, label, inner) {
  return '<details class="help" data-help="' + key + '"' + (HELP_OPEN[key] ? " open" : "") + "><summary>" + label + "</summary>" + inner + "</details>";
}

function n64(v) { return BigInt(v).toString(16).padStart(64, "0"); }

// Asks how much of the other token comes out for token0 in (zeroForOne) or token1 in.
function quoteData(c0, c1, pool, zeroForOne, amount, exactOutput) {
  return (exactOutput ? QUOTE_EXACT_OUTPUT_SELECTOR : QUOTE_SELECTOR) + n64(0x20)
    + pad32(c0) + pad32(c1) + n64(pool.fee) + n64(pool.tickSpacing) + pad32("0x0")
    + n64(zeroForOne ? 1 : 0) + n64(amount) + n64(0x100) + n64(0);
}
function quote(c0, c1, pool, zeroForOne, amount, exactOutput) {
  return call(QUOTER, quoteData(c0, c1, pool, zeroForOne, amount, exactOutput)).then(function (r) {
    if (!r || r === "0x") throw new Error("빈 견적");
    return BigInt("0x" + r.slice(2, 66));
  });
}

// Uniswap pool and route list from data/uni-pools.json (built by src/uni-pools.mjs).
// If it fails to load, Uniswap quote cells show UNI_FAIL_NOTE and the list is retried every minute.
var UNI = { pools: {}, routes: {}, fromFile: false, loadedAt: 0 }, uniRetryTimer = null;
var UNI_FAIL_NOTE = "유니스왑 풀 목록을 불러오지 못했습니다. 유니스왑 견적은 낼 수 없습니다. 1분 후에 다시 시도합니다.";
function loadUniPools() {
  clearTimeout(uniRetryTimer);
  UNI.loadedAt = Date.now();
  return fetch("data/uni-pools.json", { cache: "no-cache" }).then(json).then(function (j) {
    var list = uniNormalizeList(j);
    list.at = j.generatedAt; list.fromFile = true; list.loadedAt = UNI.loadedAt;
    var wasFailed = UNI.failed;
    UNI = list; UNI_CACHE = {};
  }).catch(function () {
    UNI.failed = true;
    uniRetryTimer = setTimeout(loadUniPools, 60000);
  }).then(function () {
    // Quotes computed before the list arrived are empty, so request them again.
    if (typeof loadPoolSizes === "function") loadPoolSizes();
    // The peg view can run before the list arrives on first open, so read it again once the list is in.
    if (onMarketPage() && PEG && !pegBusy) { PEG.at = 0; loadPeg(); }
  });
}

// Quote calls are batched 20 per Multicall3 eth_call, with up to 8 batches in flight (stays under the public node's rate limit).
// A batch that fails twice falls back to JSON-RPC batch requests of 10. Returns a BigInt or null per call.
var UNI_CHUNK = 20, UNI_CONCURRENCY = 8;
function uniWait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function uniBatchOld(chunk) {
  var out = [], i = 0;
  function next() {
    if (i >= chunk.length) return Promise.resolve(out);
    var part = chunk.slice(i, i + 10), base = i;
    i += 10;
    return rpcPost(JSON.stringify(part.map(function (c, k) { return { jsonrpc: "2.0", id: k, method: "eth_call", params: [{ to: c.to, data: c.data }, "latest"] }; })))
      .then(function (arr) {
        if (!Array.isArray(arr)) throw new Error("일괄 응답이 아닙니다");
        arr.forEach(function (j) { if (!j.error && j.result && j.result !== "0x") out[base + j.id] = uniReadWord(j.result.slice(2), part[j.id].word); });
        return uniWait(300).then(next);
      });
  }
  return next().then(function () { return chunk.map(function (c, k) { return out[k] === undefined ? null : out[k]; }); });
}
function uniMulticall(calls, size) {
  var chunks = [], out = new Array(calls.length).fill(null), next = 0, n = size || UNI_CHUNK;
  for (var i = 0; i < calls.length; i += n) chunks.push(calls.slice(i, i + n));
  function one(chunk) {
    return call(MULTICALL3, uniEncodeAggregate3(chunk)).then(function (hex) {
      return uniDecodeAggregate3(hex).map(function (b, k) { return uniReadWord(b, chunk[k].word); });
    });
  }
  function worker() {
    if (next >= chunks.length) return Promise.resolve();
    var ci = next++, chunk = chunks[ci];
    return one(chunk).catch(function () { return uniWait(700).then(function () { return one(chunk); }); })
      .catch(function () { return uniBatchOld(chunk); })
      .then(function (res) { res.forEach(function (v, k) { out[ci * n + k] = v; }); }, function () {})
      .then(worker);
  }
  var workers = [];
  for (var w = 0; w < Math.min(UNI_CONCURRENCY, chunks.length); w++) workers.push(worker());
  return Promise.all(workers).then(function () { return out; });
}
// items: [{ hops, amount }], one per route. Calls are grouped by hop index (first pool, then second, then third).
// When buying (exactIn = false), work backwards from the output amount to the required input.
function uniQuotePaths(items, exactIn) {
  var jobs = items.map(function (it) { return { hops: exactIn ? it.hops : it.hops.slice().reverse(), x: it.amount }; });
  var maxHops = Math.max.apply(null, jobs.map(function (j) { return j.hops.length; }));
  var step = Promise.resolve();
  for (var h = 0; h < maxHops; h++) (function (h) {
    step = step.then(function () {
      var live = jobs.filter(function (j) { return j.x !== null && j.x > 0n && h < j.hops.length; });
      if (!live.length) return;
      return uniMulticall(live.map(function (j) { var hop = j.hops[h]; return uniCall(hop.pool, hop.tin, hop.tout, j.x, exactIn); }))
        .then(function (res) { live.forEach(function (j, k) { j.x = res[k]; }); });
    });
  })(h);
  return step.then(function () { return jobs.map(function (j) { return j.x; }); });
}
// Split quote. exactIn: amount of `to` received for raw `from`; otherwise amount of `from` needed for raw `to` (quote).
// Identical requests are reused for 10 seconds (route steps are shared across many paths); no result rejects.
// Two passes to cut the number of calls: first quote 5%, 95% and 100% per route, then drop routes whose 5% is worse than
// the best route's last 5% (the gain from 95% to 100%), since splitting cannot help them. Only the rest get every 5% step.
var UNI_CACHE = {}, UNI_PROBE = [5, 95, 100];
// Route math feeds slightly different amounts into the same swap many times because of earlier fees. With `near`, reuse a
// same-direction quote from the last 10 seconds whose amount is within 1%, scaled proportionally (error < 0.01% on a $100 trade).
var UNI_NEAR = [], UNI_NEAR_TOL = 0.01;
function uniScaled(r, ratio) {
  var k = function (v) { return BigInt(Math.round(Number(v) * ratio)); };
  return { quote: k(r.quote), parts: r.parts.map(function (p) { return { percent: p.percent, route: p.route, q: k(p.q), hops: p.hops }; }) };
}
function uniSplit(from, to, raw, exactIn, near) {
  var key = [from, to, raw, exactIn].join(":").toLowerCase(), hit = UNI_CACHE[key];
  if (hit && Date.now() - hit.at < 10000) return hit.promise;
  var dir = [from, to, exactIn].join(":").toLowerCase(), now = Date.now();
  UNI_NEAR = UNI_NEAR.filter(function (e) { return now - e.at < 10000; });
  if (near) {
    var close = UNI_NEAR.find(function (e) { return e.dir === dir && Math.abs(Number(raw) / e.raw - 1) <= UNI_NEAR_TOL; });
    if (close) return Promise.resolve(uniScaled(close.result, Number(raw) / close.raw));
  }
  if (!UNI.fromFile) return Promise.reject(new Error("유니스왑 풀 목록을 못 불러왔습니다"));
  var routes = uniRouteHops(UNI, from, to);
  var better = function (a, b) { return exactIn ? a > b : a < b; };
  var quotes = {};
  function ask(routeIds, percents) {
    var items = [];
    routeIds.forEach(function (ri) {
      percents.forEach(function (p) { items.push({ hops: routes[ri], amount: raw * BigInt(p) / 100n, route: ri, percent: p }); });
    });
    return uniQuotePaths(items, exactIn).then(function (res) {
      items.forEach(function (it, k) {
        if (res[k] === null || res[k] <= 0n) return;
        (quotes[it.percent] = quotes[it.percent] || []).push({ q: res[k], percent: it.percent, route: it.route,
          pools: routes[it.route].map(function (hop) { return hop.pool.id; }) });
      });
    });
  }
  var quoteOf = function (p, ri) { var x = (quotes[p] || []).find(function (e) { return e.route === ri; }); return x ? x.q : null; };
  var promise = ask(routes.map(function (r, i) { return i; }), UNI_PROBE).then(function () {
    var top = (quotes[100] || []).reduce(function (b, e) { return !b || better(e.q, b.q) ? e : b; }, null);
    var q95 = top && quoteOf(95, top.route);
    var edge = top && q95 !== null ? top.q - q95 : null;
    var keep = routes.map(function (r, i) { return i; }).filter(function (ri) {
      var q5 = quoteOf(5, ri);
      return q5 !== null && (edge === null || (top && ri === top.route) || (exactIn ? q5 >= edge : q5 <= edge));
    });
    var rest = UNI_PERCENTS.filter(function (p) { return UNI_PROBE.indexOf(p) < 0; });
    // Drop the 5%, 95% and 100% quotes of pruned routes from the split search.
    UNI_PROBE.forEach(function (p) { if (quotes[p]) quotes[p] = quotes[p].filter(function (e) { return keep.indexOf(e.route) >= 0; }); });
    return keep.length > 1 ? ask(keep, rest) : null;
  }).then(function () {
    var best = uniBestSplit(quotes, exactIn);
    if (!best) throw new Error("유니스왑 견적을 받지 못했습니다");
    best.parts.forEach(function (part) { part.hops = routes[part.route]; });
    UNI_NEAR.push({ dir: dir, raw: Number(raw), at: Date.now(), result: best });
    return best;
  });
  promise.catch(function () { delete UNI_CACHE[key]; });
  UNI_CACHE[key] = { at: Date.now(), promise: promise };
  return promise;
}

// KST M/D(weekday) HH:MM
function mdhm(d) {
  var k = new Date(d.getTime() + 9 * 3600000);
  return (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + "(" + DAYS[k.getUTCDay()] + ") " + hm(d);
}

// KST HH:MM
function hm(d) {
  var k = new Date(d.getTime() + 9 * 3600000);
  return String(k.getUTCHours()).padStart(2, "0") + ":" + String(k.getUTCMinutes()).padStart(2, "0");
}

// One source: title, update time, bar, and price (native unit → USDT → KRW).
function hmss(d) {
  var k = new Date(d.getTime() + 9 * 3600000);
  return hm(d) + ":" + String(k.getUTCSeconds()).padStart(2, "0");
}

function load() {
  Promise.all([
    USDT_WS.state === "live" ? Promise.resolve({ ok: true, v: null, live: true })
      : settle(fetch(BITHUMB_TICKER).then(json).then(function (j) { return Number(j[0].trade_price); })),
    settle(Promise.all([poolPrice(SLOT_WBMB_MOVN, 18, 8), movnUsdtPrice()])),
    settle(Promise.all([
      call(WBMB, "0x18160ddd"),
      call(MOVN, "0x18160ddd")
    ]))
  ]).then(function (r) {
    if (!r[0].live) {
      if (r[0].ok) D.usdtKrw = r[0].v;
      mark("bithumb", r[0].ok);
    }
    if (r[1].ok) { D.wbmbInMovn = 1 / r[1].v[0]; D.movnUsdt = r[1].v[1]; }
    mark("pools", r[1].ok);
    if (r[2].ok) {
      var c = r[2].v;
      D.wbmbSupply = scaled(c[0], 8);
      D.movnSupply = scaled(c[1], 18);
    }
    mark("chain", r[2].ok);

    loaded = true;
    applyLbank();
    lbankRequest();
    renderAll();

    // refresh may rebuild the pool list file, so reload it every 30 minutes.
    if (Date.now() - UNI.loadedAt > 30 * 60 * 1000) loadUniPools();
  });
}


// ── Market price chart: last 7 days of BMB price in USDT, one line each for Uniswap and LBank ──
// Uniswap = WBMB/MOVN 0.1% hourly close × the latest MOVN/USDT 0.05% hourly close at or before that hour (GeckoTerminal).
// LBank = BMB/USDT hourly close. LBank REST blocks browser requests, so read data/lbank-kline.json saved by the collector.
// The last point is the current pool price and LBank's last websocket trade.
// Bars are hourly volume in USDT. Uniswap = WBMB/MOVN pool volume (in MOVN) × MOVN/USDT price at that hour;
// LBank = BMB traded × that hour's close. Points are [time ms, price, volume].
// BTC = Binance BTC/USDT hourly close on its own right-hand axis, for comparing moves in the same hours.
var CHART_DAYS = 7;
var CHART = { uni: null, lbank: null, btc: null, at: 0, stale: false }, chartHover = false;
// Current BTC price (Binance ticker, every 10 seconds while visible): the legend value and the chart's last point.
var BTC_NOW = null;
function loadBtcNow() {
  fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT", { cache: "no-store" }).then(json).then(function (j) {
    var v = Number(j && j.price);
    if (v > 0) { BTC_NOW = v; renderMarketNow(); }
  }, function () {});
}

// ── Uniswap hourly candles, large trades and 24h volume, from two files written by the collector ──
// Visitors' browsers never call GeckoTerminal directly (30 requests/min per IP). Use data/uni-gecko.json, refreshed every 5 minutes,
// and fall back to data/uni-history.json (built from on-chain swaps) when it is missing or empty.
var UNI_GECKO = null, uniGeckoAt = 0;
function loadUniGecko() {
  if (UNI_GECKO && Date.now() - uniGeckoAt < 60000) return Promise.resolve(UNI_GECKO);
  return fetch("data/uni-gecko.json", { cache: "no-cache" }).then(json).then(function (j) {
    if (j && j.at) { UNI_GECKO = j; uniGeckoAt = Date.now(); }
    return UNI_GECKO;
  }, function () { return UNI_GECKO; });
}
// Whether one part of a saved file (candles, large trades, volume) was fetched within maxMin minutes.
function freshAt(iso, maxMin) { var t = Date.parse(iso || ""); return isFinite(t) && Date.now() - t < maxMin * 60000; }
function uniGeckoHours(key) {
  var h = UNI_GECKO && UNI_GECKO.hours && UNI_GECKO.hours[key];
  return (Array.isArray(h) ? h : []).map(function (x) { return [x[0] * 1000, Number(x[1]), Number(x[2])]; })
    .filter(function (x) { return isFinite(x[0]) && x[1] > 0; });
}
var UNI_HIST = null, uniHistAt = 0;
function loadUniHistory() {
  if (UNI_HIST && Date.now() - uniHistAt < 60000) return Promise.resolve(UNI_HIST);
  return fetch("data/uni-history.json", { cache: "no-cache" }).then(json).then(function (j) {
    if (j && j.pools) { UNI_HIST = j; uniHistAt = Date.now(); }
    return UNI_HIST;
  }, function () { return UNI_HIST; });
}
// Hourly candles for one pool as [time ms, close, volume (quote asset)], the same shape as GeckoTerminal currency=token candles.
function uniHistHours(key) {
  var p = UNI_HIST && UNI_HIST.pools && UNI_HIST.pools[key];
  return (p && Array.isArray(p.hours) ? p.hours : []).map(function (h) { return [h[0] * 1000, Number(h[1]), Number(h[2])]; })
    .filter(function (h) { return isFinite(h[0]) && h[1] > 0; });
}
// Last 24h volume in USD. WBMB/MOVN volume is in MOVN, so multiply by the current MOVN price.
function uniHistVolume24(key) {
  var since = Date.now() - 86400000, sum = 0, hours = uniHistHours(key);
  if (!hours.length) return null;
  hours.forEach(function (h) { if (h[0] + 3600000 > since && h[2] > 0) sum += h[2]; });
  return MARKET_POOLS[key].quote === "MOVN" ? (has(D.movnUsdt) ? sum * D.movnUsdt : null) : sum;
}
// Last 7 days of hourly candles for one pool (saved GeckoTerminal candles, else on-chain history), for 7-day averages and time in range.
function uniHours7(key) {
  var since = Date.now() - 7 * 86400000, h = uniGeckoHours(key);
  if (!h.length) h = uniHistHours(key);
  return h.filter(function (x) { return x[0] >= since; });
}
// Average daily USD volume over the last 7 days; null if there is less than a day of candles.
function uniVolumeDay7(key) {
  var h = uniHours7(key), q = usdOf(MARKET_POOLS[key].quote);
  if (h.length < 24 || !has(q)) return null;
  var sum = h.reduce(function (t, x) { return t + (x[2] > 0 ? x[2] : 0); }, 0);
  return sum * q / Math.min(7, (Date.now() - h[0][0]) / 86400000);
}
// Uniswap WBMB price in USDT: WBMB/MOVN candle × the latest MOVN/USDT candle at or before it. Volume is converted the same way.
function mergeUniHours(w, movn) {
  return w.map(function (x) {
    var m = null;
    for (var i = movn.length - 1; i >= 0; i--) if (movn[i][0] <= x[0]) { m = movn[i]; break; }
    return m ? [x[0], x[1] * m[1], x[2] >= 0 ? x[2] * m[1] : null] : null;
  }).filter(Boolean);
}
function loadMarketChart() {
  Promise.all([
    loadUniGecko(),
    loadUniHistory(),
    fetch("data/lbank-kline.json", { cache: "no-cache" }).then(json).then(function (j) {
      return (j.candles || []).map(function (c) { return [c[0] * 1000, Number(c[1]), c[2] >= 0 ? Number(c[2]) * Number(c[1]) : null]; })
        .filter(function (c) { return c[1] > 0; });
    }, function () { return null; }),
    fetch("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=" + (CHART_DAYS * 24 + 1), { cache: "no-store" })
      .then(json).then(function (k) {
        return (Array.isArray(k) ? k : []).map(function (c) { return [Number(c[0]), Number(c[4])]; })
          .filter(function (c) { return isFinite(c[0]) && c[1] > 0; });
      }, function () { return null; })
  ]).then(function (r) {
    // Base series is the saved GeckoTerminal candles, else the last GeckoTerminal candles remembered in this browser.
    // From the base's last (possibly incomplete) candle onward, on-chain history replaces and extends it when available.
    var w = uniGeckoHours("wm10"), m = uniGeckoHours("mu05"), base = null, uni;
    if (w.length && m.length) {
      base = mergeUniHours(w, m);
      try { localStorage.setItem("chart-uni-v2", JSON.stringify(base)); } catch (e) {}
    } else {
      try { base = JSON.parse(localStorage.getItem("chart-uni-v2") || "null"); } catch (e) {}
    }
    var cw = uniHistHours("wm10"), cm = uniHistHours("mu05"), chain = cw.length && cm.length ? mergeUniHours(cw, cm) : [];
    if (base && base.length) {
      var cutoff = base[base.length - 1][0], tail = chain.filter(function (p) { return p[0] >= cutoff; });
      uni = tail.length ? base.filter(function (p) { return p[0] < cutoff; }).concat(tail) : base;
    } else {
      uni = chain;
    }
    // If neither file has been refreshed for over an hour, warn that recent candles may be missing.
    var stale = !(UNI_GECKO && freshAt(UNI_GECKO.hoursAt, 60)) && !(UNI_HIST && freshAt(UNI_HIST.at, 60));
    var btc = r[3] && r[3].length ? r[3] : CHART.btc;
    if (!has(BTC_NOW) && btc && btc.length) BTC_NOW = btc[btc.length - 1][1];
    CHART = { uni: uni, lbank: r[2], btc: btc, at: Date.now(), stale: stale };
    renderMarketChart();
    renderMarketNow();
  });
}
function renderMarketChart() {
  var box = $("market-chart");
  if (!CHART.at || chartHover) return;
  var now = Date.now(), x0 = now - CHART_DAYS * 86400000, x1 = now;
  function recent(list) { return (list || []).filter(function (p) { return p[0] >= x0; }); }
  var uni = recent(CHART.uni), lb = recent(CHART.lbank), btc = recent(CHART.btc);
  if (has(D.wbmbInMovn) && has(D.movnUsdt)) uni.push([now, D.wbmbInMovn * D.movnUsdt]);
  if (has(D.lbank)) lb.push([now, D.lbank]);
  if (btc.length && has(BTC_NOW)) btc.push([now, BTC_NOW]);
  if (!uni.length && !lb.length) { box.innerHTML = '<p class="loading">그래프 자료를 받지 못했습니다.</p>'; return; }
  // Price on top (T..PB), volume bars below (VT..VB), dates at the bottom.
  // On narrow screens (phones) axis numbers sit inside the plot edges instead of in side margins, so the lines get the full width.
  var W = Math.max(260, Math.round(box.clientWidth || 320)), narrow = W < 480;
  var L = narrow ? 8 : 44, R = narrow ? 8 : btc.length > 1 ? 50 : 8, T = 28, PB = 150, VT = 206, VB = 252, H = 298;
  var vals = uni.concat(lb).map(function (p) { return p[1]; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = Math.max((hi - lo) * 0.06, hi * 0.004);
  lo -= pad; hi += pad;
  var X = function (t) { return L + (t - x0) / (x1 - x0) * (W - L - R); };
  var Y = function (v) { return T + (hi - v) / (hi - lo) * (PB - T); };
  var bv = btc.map(function (p) { return p[1]; }), bLo = Math.min.apply(null, bv), bHi = Math.max.apply(null, bv), bPad = Math.max((bHi - bLo) * 0.06, bHi * 0.002);
  bLo -= bPad; bHi += bPad;
  var YB = function (v) { return T + (bHi - v) / (bHi - bLo) * (PB - T); };
  // Hourly volume: merge both venues keyed by candle start hour.
  var vol = {}, volUni = 0, volLb = 0;
  function addVol(list, side) {
    list.forEach(function (p) {
      if (!has(p[2])) return;
      var h = Math.floor(p[0] / 3600000);
      vol[h] = vol[h] || { u: 0, l: 0 };
      vol[h][side] += p[2];
      if (side === "u") volUni += p[2]; else volLb += p[2];
    });
  }
  addVol(uni, "u"); addVol(lb, "l");
  var volMax = Math.max.apply(null, Object.keys(vol).map(function (h) { return vol[h].u + vol[h].l; }).concat([0]));
  // 7-day totals: how much larger the bigger venue is (%), plus both amounts, bigger venue first.
  // Returned as two lines to fit phone width: [comparison, (amounts)].
  function volCompare() {
    var bigLb = volLb >= volUni, big = bigLb ? volLb : volUni, small = bigLb ? volUni : volLb;
    return [small > 0 ? "7일 합계 " + (bigLb ? "LBank" : "유니스왑") + "가 " + Math.round((big / small - 1) * 100) + "% 많음" : "7일 합계",
      "(" + (bigLb ? "LBank " + fmt(volLb, 0) + " · 유니스왑 " + fmt(volUni, 0) : "유니스왑 " + fmt(volUni, 0) + " · LBank " + fmt(volLb, 0)) + " USDT)"];
  }
  var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="유니스왑과 LBank의 BMB 시장가, BTC 가격, 시간별 거래대금, USDT, 최근 7일">';
  if (volMax > 0) {
    var bw = Math.max(0.6, (W - L - R) / (CHART_DAYS * 24) - 0.4), VY = function (v) { return (VB - VT) * v / volMax; };
    svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + VB + '" y2="' + VB + '"/>' +
      '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + VT + '" y2="' + VT + '"/>' +
      (narrow ? '<text class="in" x="' + (L + 2) + '" y="' + (VT + 11) + '">' + fmt(volMax, 0) + "</text>"
        : '<text x="' + (L - 4) + '" y="' + (VT + 3.5) + '" text-anchor="end">' + fmt(volMax, 0) + "</text>" +
          '<text x="' + (L - 4) + '" y="' + (VB) + '" text-anchor="end">0</text>') +
      '<text class="ax-title" x="4" y="' + (VT - 12) + '">↑ 거래대금 (USDT)</text>';
    Object.keys(vol).forEach(function (h) {
      var x = X(h * 3600000);
      if (x < L || x > W - R) return;
      var hu = VY(vol[h].u), hl = VY(vol[h].l);
      if (hu > 0) svg += '<rect x="' + x.toFixed(1) + '" y="' + (VB - hu).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hu.toFixed(1) + '" fill="var(--c-uni)"/>';
      if (hl > 0) svg += '<rect x="' + x.toFixed(1) + '" y="' + (VB - hu - hl).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hl.toFixed(1) + '" fill="var(--c-lbank)"/>';
    });
  }
  for (var k = 0; k <= 2; k++) {
    var v = lo + (hi - lo) * k / 2, yv = Y(v).toFixed(1);
    // Inside labels sit just above their grid line, except the top one, which goes below it to clear the axis titles.
    var yIn = (k === 2 ? Y(v) + 11 : Y(v) - 3).toFixed(1);
    svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yv + '" y2="' + yv + '"/>' +
      (narrow ? '<text class="in" x="' + (L + 2) + '" y="' + yIn + '">'
        : '<text x="' + (L - 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">') + v.toFixed(1) + "</text>";
    if (btc.length > 1) svg += (narrow ? '<text class="btc in" x="' + (W - R - 2) + '" y="' + yIn + '" text-anchor="end">'
      : '<text class="btc" x="' + (W - R + 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '">') + fmt(bLo + (bHi - bLo) * k / 2, 0) + "</text>";
  }
  if (btc.length > 1) svg += '<text class="ax-title btc" x="' + (W - 4) + '" y="' + (T - 12) + '" text-anchor="end">BTC ↑</text>';
  svg += '<text class="ax-title" x="4" y="' + (T - 12) + '">↑ 가격 (USDT)</text>' +
    '<text class="ax-title" x="' + (W - R) + '" y="' + (PB + 16) + '" text-anchor="end">1시간 종가 · 맨 오른쪽은 현재가</text>';
  if (volMax > 0) svg += '<text class="ax-title" x="' + (W - R) + '" y="' + (H - 18) + '" text-anchor="end">1시간 거래대금 · ' + volCompare()[0] + '</text>' +
    '<text class="ax-title" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' + volCompare()[1] + "</text>";
  // Date ticks at KST midnight, counted back from the latest one. A label like "10/10" is about 32px wide,
  // so on narrow screens every other day is labeled to keep them from running together.
  var dayStep = (W - L - R) / CHART_DAYS < 38 ? 2 : 1;
  for (var t = Math.floor((x1 + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000; t >= x0; t -= dayStep * 86400000) {
    var dt = new Date(t + 9 * 3600000);
    if (X(t) - L < 16 || W - R - X(t) < 16) continue;
    svg += '<text x="' + X(t).toFixed(1) + '" y="' + (VB + 14) + '" text-anchor="middle">' + (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "</text>";
  }
  function line(list, color) {
    return list.length > 1 ? '<polyline fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" points="' +
      list.map(function (p) { return X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join(" ") + '"/>' : "";
  }
  if (btc.length > 1) svg += '<polyline fill="none" stroke="var(--c-btc)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linejoin="round" points="' +
    btc.map(function (p) { return X(p[0]).toFixed(1) + "," + YB(p[1]).toFixed(1); }).join(" ") + '"/>';
  svg += line(lb, "var(--c-lbank)") + line(uni, "var(--c-uni)");
  svg += '<line id="mc-cross" x1="0" x2="0" y1="' + T + '" y2="' + VB + '" stroke="var(--faint)" stroke-dasharray="3 3" visibility="hidden"/>' +
    '<circle id="mc-dot-b" r="3" fill="var(--c-btc)" visibility="hidden"/><circle id="mc-dot-l" r="3.5" fill="var(--c-lbank)" visibility="hidden"/>' +
    '<circle id="mc-dot-u" r="3.5" fill="var(--c-uni)" visibility="hidden"/>' +
    '<rect id="mc-hit" x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>';
  // The current-price line above the chart (#market-now) serves as the legend.
  // Values at the pointed time go in a strip above the chart (space kept while empty), so they never cover the lines.
  box.innerHTML = '<div class="tip" id="mc-tip"></div>' + svg + '<figcaption>' + (lb.length ? "" : "LBank 봉을 받지 못함 · ") +
    // Values filled from on-chain history come from the same trades, so no notice; warn only when both files are stale.
    (CHART.stale ? "유니스왑 최근 봉을 받지 못함 · " : "") +
    'On-chain data powered by <a href="https://www.geckoterminal.com/" target="_blank" rel="noopener">GeckoTerminal</a></figcaption>' +
    helpHtml("market-chart", "설명", "<p>가격: 유니스왑은 WBMB/MOVN 풀 가격 × MOVN/USDT 풀 가격, LBank는 BMB/USDT 체결가입니다.<br>" +
      "BTC: 바이낸스 BTC/USDT 1시간 종가이며 오른쪽 축입니다(회색 점선). 현재가는 10초마다 받습니다.<br>" +
      "거래대금(USDT 환산): 유니스왑은 MOVN 거래량 × MOVN 가격, LBank는 BMB 거래량 × 종가입니다. 막대는 두 곳을 쌓은 것입니다(파랑 유니스왑 · 주황 LBank).<br>" +
      "그래프를 가리키면(휴대폰은 누르면) 그 시각의 가격·차이·거래대금이 그래프 위에 나옵니다. 휴대폰은 그래프 밖을 누르면 닫힙니다.</p>");
  // Mouse: follows the pointer and clears on leave. Touch: a tap pins the values (dragging sideways moves them),
  // and a tap outside the chart clears them (marketChartTipClose).
  var hit = $("mc-hit"), cross = $("mc-cross"), tip = $("mc-tip"), svgEl = box.querySelector("svg");
  var dots = [["mc-dot-u", Y], ["mc-dot-l", Y], ["mc-dot-b", YB]].map(function (d) { return { el: $(d[0]), y: d[1] }; });
  function before(list, t) {
    var best = null;
    list.forEach(function (p) { if (p[0] <= t && (!best || p[0] > best[0])) best = p; });
    return best;
  }
  function move(e) {
    chartHover = true;
    var rect = svgEl.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * W;
    var t = x0 + (Math.min(Math.max(px, L), W - R) - L) / (W - L - R) * (x1 - x0);
    // Within the current, unfinished hour or the last 2px, show the rightmost point (current price); elsewhere show the hourly candle.
    // An hour is only a few px wide, so a wider zone would label the previous candle as current too.
    var isNow = t >= Math.floor(x1 / 3600000) * 3600000 || px >= W - R - 2;
    if (isNow) t = x1;
    var u = before(uni, t), l = before(lb, t), b = before(btc, t), dt = new Date(t + 9 * 3600000);
    cross.setAttribute("x1", X(t)); cross.setAttribute("x2", X(t)); cross.setAttribute("visibility", "visible");
    [u, l, b].forEach(function (p, i) {
      var d = dots[i].el;
      if (!p || (i === 2 && btc.length < 2)) { d.setAttribute("visibility", "hidden"); return; }
      d.setAttribute("cx", X(t).toFixed(1)); d.setAttribute("cy", dots[i].y(p[1]).toFixed(1)); d.setAttribute("visibility", "visible");
    });
    var v = vol[Math.floor(t / 3600000)];
    tip.innerHTML = [isNow ? "지금 " + String(dt.getUTCHours()).padStart(2, "0") + ":" + String(dt.getUTCMinutes()).padStart(2, "0") +
        " <small>(" + String(dt.getUTCHours()).padStart(2, "0") + "시 봉 진행 중)</small>"
      : (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + " " + String(dt.getUTCHours()).padStart(2, "0") + "시",
      u ? "유니스왑 <b>" + u[1].toFixed(2) + "</b>" : "",
      l ? "LBank <b>" + l[1].toFixed(2) + "</b>" + (u ? " <small>(" + pct(l[1] / u[1] - 1) + ")</small>" : "") : "",
      b ? "BTC <b>" + fmt(b[1], 0) + "</b>" : "",
      v && (v.u > 0 || v.l > 0) ? "거래대금 유니스왑 <b>" + fmt(v.u, 0) + "</b> · LBank <b>" + fmt(v.l, 0) + "</b> USDT" : ""]
      .filter(Boolean).map(function (x) { return "<span>" + x + "</span>"; }).join("");
    tip.style.visibility = "visible";
  }
  function clear() {
    chartHover = false;
    cross.setAttribute("visibility", "hidden");
    dots.forEach(function (d) { d.el.setAttribute("visibility", "hidden"); });
    tip.style.visibility = "hidden";
  }
  marketChartTipClose = clear;
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") clear(); });
}
// Clears values pinned by a tap when the user taps anywhere outside the chart's plot area.
var marketChartTipClose = null;
document.addEventListener("pointerdown", function (e) {
  if (marketChartTipClose && chartHover && !(e.target.closest && e.target.closest("#mc-hit"))) marketChartTipClose();
});
window.addEventListener("resize", function () { clearTimeout(renderMarketChart.t); renderMarketChart.t = setTimeout(renderMarketChart, 200); });

// Balances of reference addresses: BSC via WBMB/MOVN balanceOf, Mobick chain via the explorer's chain_stats.
// funded_txo_sum − spent_txo_sum matches balanceSat on explorer.mobick.info (checked 2026-09-27).
// Only blockchain.mobick.info allows browser requests, so it is used.
function renderAll() {
  $("head-usdt").textContent = fmt(D.usdtKrw, 0);
  $("stamp-bithumb").innerHTML = stamp("bithumb");
  renderMovn();

  if (!$("stamp-supply")) return;  // Supply is shown on the market structure page only.
  $("stamp-supply").innerHTML = stamp("chain");
  var extra = has(D.wbmbSupply) && D.wbmbSupply !== 500000;
  $("wbmb-supply-c").innerHTML = has(D.wbmbSupply) ? "총 발행량 " + man(D.wbmbSupply) +
    (extra ? ' <span style="color:var(--warn)">추가 발행됨</span>' : "") : "받지 못함";
  $("movn-supply-c").textContent = has(D.movnSupply) ? "총 발행량 " + man(D.movnSupply) : "받지 못함";

}

// Bithumb USDT/KRW over websocket, per trade. It is the KRW conversion basis, so it is kept live.
// If disconnected, the 2-minute load() covers it and the socket reconnects after 30 seconds.
// Trades are frequent, so the screen is redrawn at most every 10 seconds.
var USDT_WS_URL = "wss://ws-api.bithumb.com/websocket/v1";
var USDT_WS = { state: "connecting", ws: null, drawTimer: null };

function connectUsdtWs() {
  var ws;
  try { ws = new WebSocket(USDT_WS_URL); } catch (e) { USDT_WS.state = "failed"; return; }
  ws.binaryType = "arraybuffer";
  USDT_WS.ws = ws;
  var ping = null;
  ws.onopen = function () {
    ws.send(JSON.stringify([{ ticket: "btcmobick-" + Math.random().toString(36).slice(2) },
                            { type: "ticker", codes: ["KRW-USDT"] }]));
    ping = setInterval(function () { if (ws.readyState === 1) ws.send("PING"); }, 60000);
  };
  ws.onmessage = function (ev) {
    var m;
    try {
      m = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
    } catch (e) { return; }
    if (m.type !== "ticker" || !(m.trade_price > 0)) return;
    D.usdtKrw = Number(m.trade_price);
    USDT_WS.state = "live";
    SRC.bithumb.live = true;
    mark("bithumb", true);
    if (!USDT_WS.drawTimer) USDT_WS.drawTimer = setTimeout(function () {
      USDT_WS.drawTimer = null;
      if (loaded) renderAll();
    }, 10000);
  };
  ws.onclose = function () {
    clearInterval(ping);
    USDT_WS.ws = null; USDT_WS.state = "failed"; SRC.bithumb.live = false;
    if (loaded) renderAll();
    setTimeout(connectUsdtWs, 30000);
  };
}

var LBANK_WS = "wss://api.lbank.info/ws/V2/";

// Only Uniswap pool prices are re-read every 10 seconds: two requests, light on the public node.
// Supply stays in the 2-minute load().
var POOL_POLL_MS = 10000;
function pollPools() {
  if (!loaded) return;
  Promise.all([poolPrice(SLOT_WBMB_MOVN, 18, 8), movnUsdtPrice()])
    .then(function (r) {
      D.wbmbInMovn = 1 / r[0];
      D.movnUsdt = r[1];
      mark("pools", true);
    }, function () { mark("pools", false); })
    .then(function () {
      renderMovn();
    });
}

function renderMovn() {
  var ok = has(D.movnUsdt);
  $("head-movn").textContent = ok ? D.movnUsdt.toFixed(4) : "—";
  var link = $("head-movn-pool");
  link.href = "https://app.uniswap.org/explore/pools/bnb/" + MOVN_POOL.id;
  link.title = "유니스왑 MOVN/USDT " + feeLabel(MOVN_POOL) + " 풀";
  link.textContent = "유니스왑 " + feeLabel(MOVN_POOL);
  $("stamp-pools").innerHTML = stamp("pools", true);
  renderMarketNow();
}
// Current prices in the legend slot above the chart. Uniswap = pool price (WBMB/MOVN × MOVN/USDT), LBank = last websocket trade.
// Updated on pool price reads (10 s), LBank redraws (10 s) and Bithumb rate changes.
function renderMarketNow() {
  var uni = has(D.wbmbInMovn) && has(D.movnUsdt) ? D.wbmbInMovn * D.movnUsdt : null, lb = has(D.lbank) ? D.lbank : null;
  var krw = has(D.usdtKrw) ? D.usdtKrw : null;
  // basis: where the value comes from. Uniswap is computed from two pool prices and can differ from the Uniswap app's price.
  function item(cls, name, v, basis, missing) {
    return '<span class="now-item"><i class="' + cls + '"></i>' + name + " " +
      (has(v) ? "<b>" + v.toFixed(2) + "</b> USDT<small>(" + basis + (krw ? " · ₩" + fmt(v * krw, 0) : "") + ")</small>" : '<small>' + missing + "</small>") + "</span>";
  }
  $("market-now").innerHTML = item("uni", "유니스왑", uni, "풀 가격 기준 계산값", "받는 중") +
    item("lbank", "LBank", lb, "마지막 체결가", LBK.state === "live" ? "체결 기다리는 중" : LBK.state === "failed" ? "연결 안 됨" : "연결 중") +
    (has(BTC_NOW) ? '<span class="now-item"><i class="btc"></i>BTC <b>' + fmt(BTC_NOW, 0) +
      "</b> USDT<small>(바이낸스 · 10초마다" + (krw ? " · ₩" + fmt(BTC_NOW * krw, 0) : "") + ")</small></span>" : "");
}
var LBK = { state: "connecting", last: null, ask: null, asks: null, bids: null, depthAt: null, bid: null, ws: null, drawTimer: null, books: {} };

function lbankSend(obj) {
  if (LBK.ws && LBK.ws.readyState === 1) LBK.ws.send(JSON.stringify(obj));
}
function lbankRequest() {
  lbankSend({ action: "request", request: "tick", pair: "bmb_usdt" });
  ["bmb_usdt"].forEach(function (pair) {
    lbankSend({ action: "request", request: "depth", depth: "100", pair: pair });
  });
}

function connectLbank() {
  var ws;
  try { ws = new WebSocket(LBANK_WS); } catch (e) { LBK.state = "failed"; refreshLbank(); return; }
  LBK.ws = ws;
  var giveUp = setTimeout(function () {
    if (LBK.state !== "live") { LBK.state = "failed"; refreshLbank(); }
  }, 10000);
  ws.onopen = function () {
    lbankRequest();
    lbankSend({ action: "subscribe", subscribe: "tick", pair: "bmb_usdt" });
    ["bmb_usdt"].forEach(function (pair) {
      lbankSend({ action: "subscribe", subscribe: "depth", depth: "100", pair: pair });
    });
  };
  ws.onmessage = function (ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.action === "ping") { lbankSend({ action: "pong", pong: m.ping }); return; }
    if (m.type === "tick" && m.tick && m.tick.latest) {
      LBK.last = Number(m.tick.latest);
    } else if (m.type === "depth") {
      var book = m.depth || m;
      var pair = m.pair || "bmb_usdt";
      var current = LBK.books[pair] || {};
      if (Array.isArray(book.asks)) {
        current.asks = book.asks.map(function (row) { return [Number(row[0]), Number(row[1])]; })
          .filter(function (row) { return has(row[0]) && row[0] > 0 && has(row[1]) && row[1] > 0; })
          .sort(function (a, b) { return a[0] - b[0]; });
      }
      if (Array.isArray(book.bids)) {
        current.bids = book.bids.map(function (row) { return [Number(row[0]), Number(row[1])]; })
          .filter(function (row) { return has(row[0]) && row[0] > 0 && has(row[1]) && row[1] > 0; })
          .sort(function (a, b) { return b[0] - a[0]; });
      }
      if (Array.isArray(book.asks) || Array.isArray(book.bids)) {
        current.at = new Date();
        LBK.books[pair] = current;
      }
      if (pair === "bmb_usdt") {
        // Draw immediately on the first order book instead of waiting 10 seconds, so the fill table does not stay in its loading state.
        var firstBook = !LBK.asks && current.asks;
        LBK.asks = current.asks || null;
        LBK.bids = current.bids || null;
        LBK.ask = LBK.asks && LBK.asks.length ? LBK.asks[0][0] : null;
        LBK.bid = LBK.bids && LBK.bids.length ? LBK.bids[0][0] : null;
        LBK.depthAt = new Date();
        if (firstBook && LBK.state === "live") { LBK.at = new Date(); refreshLbank(); return; }
      }
    } else {
      return;
    }
    // Draw immediately on first connect, then at most every 10 seconds like the Bithumb rate.
    LBK.at = new Date();
    if ((LBK.last || LBK.asks) && LBK.state !== "live") { LBK.state = "live"; clearTimeout(giveUp); refreshLbank(); return; }
    if (!LBK.drawTimer) LBK.drawTimer = setTimeout(function () { LBK.drawTimer = null; refreshLbank(); }, 10000);
  };
  ws.onclose = function () {
    clearTimeout(giveUp);
    LBK.ws = null; LBK.state = "failed"; LBK.last = null; LBK.ask = null; LBK.asks = null; LBK.bids = null; LBK.depthAt = null; LBK.bid = null; LBK.books = {};
    refreshLbank();
    setTimeout(connectLbank, 30000);
  };
}

function applyLbank() {
  var live = LBK.state === "live";
  D.lbank = live && LBK.last ? LBK.last : null;
  D.lbankAsk = live && LBK.ask ? LBK.ask : null;
  D.lbankAsks = live ? LBK.asks : null;
  D.lbankBids = live ? LBK.bids : null;
  D.lbankBid = live && LBK.bid ? LBK.bid : null;
}
function refreshLbank() {
  if (!loaded) return;
  applyLbank();
  renderMarketNow();
}

// Runs periodic jobs only while the page is visible. Hidden tabs make no requests; on return, overdue jobs run once right away.
// This keeps idle tabs from polling the BSC public node, Bithumb and the Mobick explorer.
function everyVisible(fn, ms) {
  var last = Date.now();
  function run() { last = Date.now(); fn(); }
  setInterval(function () { if (!document.hidden) run(); }, ms);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - last >= ms) run(); });
}
// ── Shared by both pages: pool state reads, MOVN reference pool, pool definitions, number formatting ──
// ── Market structure: pool state and liquidity provision calculator ──
// Reads pool state and per-tick liquidity from Uniswap v4 StateView (BSC).
var STATE_VIEW = "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4";

var SV_SLOT0 = "0xc815641c", SV_LIQ = "0xfa6793d5", SV_BITMAP = "0x1c7ccb4c", SV_TICKLIQ = "0xcaedab54";

function int256Hex(v) { return (v < 0 ? (1n << 256n) + BigInt(v) : BigInt(v)).toString(16).padStart(64, "0"); }

function signedWord(hex, from) {
  var v = BigInt("0x" + hex.slice(from, from + 64));
  return v >= (1n << 255n) ? v - (1n << 256n) : v;
}

// Sends StateView calls in batches of 10. If the node briefly rejects or returns empty, that batch is retried after 0.8 s and 1.6 s.
function svBatch(datas) {
  var chunks = [];
  for (var k = 0; k < datas.length; k += 10) chunks.push(datas.slice(k, k + 10));
  function send(chunk, tries) {
    return rpcPost(JSON.stringify(chunk.map(function (d, i) { return { jsonrpc: "2.0", id: i, method: "eth_call", params: [{ to: STATE_VIEW, data: d }, "latest"] }; })))
      .then(function (arr) {
        if (!Array.isArray(arr)) throw new Error("일괄 응답이 아닙니다");
        var out = [];
        arr.forEach(function (j) { out[j.id] = j.result; });
        if (out.length < chunk.length || out.some(function (v) { return typeof v !== "string"; })) throw new Error("빠진 답이 있습니다");
        return out;
      }).catch(function (err) {
        if (tries <= 0) throw err;
        return uniWait(800 * (3 - tries)).then(function () { return send(chunk, tries - 1); });
      });
  }
  return chunks.reduce(function (acc, chunk, ci) {
    return acc.then(function (all) {
      return send(chunk, 2).then(function (out) { out.forEach(function (v, i) { all[ci * 10 + i] = v; }); return all; });
    });
  }, Promise.resolve([]));
}

function pegPoolList() {
  return Object.keys(UNI.pools).map(function (id) { return UNI.pools[id]; }).filter(function (p) {
    return p.proto === "v4" && /^0x0+$/.test(p.hooks) && p.t0 === MOVN.toLowerCase() && p.t1 === USDT.toLowerCase();
  });
}

// Uniswap pools used by the market structure features. The 0.01% and 0.25% MOVN/USDT pools are nearly empty and left out.
// invert: the display price (quote per base) is the inverse of the pool's raw price (token1/token0).
var MARKET_POOLS = {
  mu05: { pair: "MOVN/USDT", name: "MOVN/USDT 0.05%", fee: 500, ts: 10, id: "0x5de52159724f0d421445f4a5eeccc047bb6cc7821a008b7a171d896256d3a217",
    dec0: 18, dec1: 18, base: "MOVN", quote: "USDT", invert: false },
  mu29: { pair: "MOVN/USDT", name: "MOVN/USDT 2.9%", fee: 29000, ts: 290, id: "0x68ed65f5029ed3b40fdb23baadb1ee3b2327eefdb5f08e5d31715a8d8e4ff7f6",
    dec0: 18, dec1: 18, base: "MOVN", quote: "USDT", invert: false },
  wm10: { pair: "WBMB/MOVN", name: "WBMB/MOVN 0.1%", fee: 1000, ts: 10, id: "0x56e0a9b160ade73e83d236e31ef9cb3527905a820c8cb61aba6c949e9472cab6",
    dec0: 18, dec1: 8, base: "WBMB", quote: "MOVN", invert: true }
};

// USD value of one token.
function usdOf(asset) {
  if (asset === "USDT") return 1;
  if (asset === "MOVN") return has(D.movnUsdt) ? D.movnUsdt : null;
  if (asset === "WBMB") return has(D.movnUsdt) && has(D.wbmbInMovn) ? D.movnUsdt * D.wbmbInMovn : null;
  return null;
}

function boardQty(v) { return Number(v.toFixed(v >= 100 ? 2 : 4)).toLocaleString("en-US", { maximumFractionDigits: 4 }); }

// Withdraw fee for sending USDT on one network: { fee, basis }, { missing } if the input is empty, or { skip } if unusable.
// The fee source is shown in parentheses on the fee line, e.g. LBank public value with its time.
function routeWhen(d) {
  var k = new Date(d.getTime() + 9 * 3600000);
  return (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + " " + hm(d);
}

function onMarketPage() { return !!document.getElementById("tab-market"); }
function onTradePage() { return !!document.getElementById("tab-trade"); }
function commonStart() {
  connectLbank();
  connectUsdtWs();
  load();
  everyVisible(load, 120000);
  everyVisible(pollPools, POOL_POLL_MS);
  // Market price chart: once at start, candles every 10 minutes, current price point every minute (deferred while hovering).
  setTimeout(loadMarketChart, 1200);
  everyVisible(loadBtcNow, 10000);
  setInterval(function () { if (!document.hidden) loadMarketChart(); }, 10 * 60000);
  setInterval(function () { if (!document.hidden) renderMarketChart(); }, 60000);
}
