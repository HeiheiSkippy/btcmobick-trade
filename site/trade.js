"use strict";
// Trade comparison page (index.html) only: route calculation and trade inputs.
// Exchange links whose withdraw targets and per-account permissions are unverified are not added as route steps.
var routeVersion = 0, routeBaseAmount = 0;
var routeCompletedAt = null, routeSummary = "";
// Mobickmania is a way to trade bank KRW <-> wallet BMB, not a place that holds assets, so it is not in ROUTE_EXCHANGE_IDS;
// it only shares the venue checkbox and its saving.
// Uniswap is likewise used from the personal wallet (BSC), so it has a checkbox (on by default) but no place entry.
// BMB <-> WBMB conversion is always available, so it is always included without a checkbox.
var ROUTE_EXCHANGES = ROUTE_EXCHANGE_IDS.concat(["uniswap", "mania"]);
try {
  var savedRouteExchanges = JSON.parse(localStorage.getItem("route-exchanges-v1") || "null") || {};
  ROUTE_EXCHANGES.forEach(function (venue) {
    if (typeof savedRouteExchanges[venue] === "boolean") $("route-exchange-" + venue).checked = savedRouteExchanges[venue];
  });
} catch (e) {}
function selectedRouteExchanges() {
  var enabled = {};
  ROUTE_EXCHANGES.forEach(function (venue) { enabled[venue] = $("route-exchange-" + venue).checked; });
  return enabled;
}
// Pick the asset first; locations list only places that can hold it (all/any, personal wallet, enabled exchanges).
function fillRouteAssets(side) {
  var asset = $("route-" + side + "-asset").value, select = $("route-" + side + "-place");
  var previous = select.value || select.dataset.default, enabled = selectedRouteExchanges();
  var places = [{ id: "any", name: side === "from" ? "전체" : "지정 안 함" }].concat(ROUTE_PLACES.filter(function (p) {
    return (p.id === "wallet" || enabled[p.id]) && p.assets.indexOf(asset) >= 0;
  }));
  select.innerHTML = places.map(function (p) {
    return '<option value="' + p.id + '">' + p.name + (p.id === "wallet" ? " (" + ROUTE_WALLET_CHAINS[asset] + ")" : "") + "</option>";
  }).join("");
  select.value = places.some(function (p) { return p.id === previous; }) ? previous : "any";
}
function fillRoutePlaces() {
  var enabled = selectedRouteExchanges();
  var assets = routeAssetsFor("all", enabled);
  ROUTE_PLACES[0].assets.forEach(function (x) { if (assets.indexOf(x) < 0) assets.push(x); });
  assets = ROUTE_ASSET_ORDER.filter(function (x) { return assets.indexOf(x) >= 0; });
  ["from", "to"].forEach(function (side) {
    var select = $("route-" + side + "-asset"), previous = select.value || select.dataset.default;
    select.innerHTML = assets.map(function (x) { return '<option value="' + x + '">' + ROUTE_ASSET_NAMES[x] + "</option>"; }).join("");
    select.value = assets.indexOf(previous) >= 0 ? previous : assets[0];
    fillRouteAssets(side);
  });
}
// Values not available from public APIs are entered by the user and stored in this browser only.
// No inputs are laid out up front: settings show values as text, and results ask only for what is missing.
var ROUTE_INPUTS = [
  { id: "route-trade-bithumb", group: "trade", label: "빗썸 거래 수수료", unit: "%", def: "0.04", max: 5 },
  { id: "route-trade-binance", group: "trade", label: "바이낸스 거래 수수료", unit: "%", def: "0.1", max: 5 },
  { id: "route-trade-lbank", group: "trade", label: "LBank 거래 수수료", unit: "%", def: "0.1", max: 5 },
  // Withdraw fees below come from public endpoints; the inputs are used only when the lookup fails.
  { id: "route-fee-bithumb-usdt-tron", group: "fees", label: "빗썸 USDT Tron 출금비", unit: "USDT", fallback: "빗썸", hint: "빗썸 출금비 조회가 안 될 때만 씁니다 · 빗썸 → 출금 → USDT → Tron에서 확인" },
  { id: "route-fee-bithumb-usdt-ethereum", group: "fees", label: "빗썸 USDT Ethereum 출금비", unit: "USDT", fallback: "빗썸", hint: "빗썸 출금비 조회가 안 될 때만 씁니다 · 빗썸 → 출금 → USDT → Ethereum에서 확인" },
  { id: "route-fee-bithumb-usdt-kaia", group: "fees", label: "빗썸 USDT Kaia 출금비", unit: "USDT", fallback: "빗썸", hint: "빗썸 출금비 조회가 안 될 때만 씁니다 · 빗썸 → 출금 → USDT → Kaia에서 확인" },
  { id: "route-fee-bithumb-usdt-aptos", group: "fees", label: "빗썸 USDT Aptos 출금비", unit: "USDT", fallback: "빗썸", hint: "빗썸 출금비 조회가 안 될 때만 씁니다 · 빗썸 → 출금 → USDT → Aptos에서 확인" },
  { id: "route-fee-binance-usdt-tron", group: "fees", label: "바이낸스 USDT Tron 출금비", unit: "USDT", fallback: "바이낸스", hint: "바이낸스 출금비 조회가 안 될 때만 씁니다 · 바이낸스 → 출금 → USDT → Tron(TRC20)에서 확인" },
  { id: "route-fee-binance-usdt-ethereum", group: "fees", label: "바이낸스 USDT Ethereum 출금비", unit: "USDT", fallback: "바이낸스", hint: "바이낸스 출금비 조회가 안 될 때만 씁니다 · 바이낸스 → 출금 → USDT → Ethereum(ERC20)에서 확인" },
  { id: "route-fee-binance-usdt-bsc", group: "fees", label: "바이낸스 USDT BSC 출금비", unit: "USDT", fallback: "바이낸스", hint: "바이낸스 출금비 조회가 안 될 때만 씁니다 · 바이낸스 → 출금 → USDT → BSC(BEP20)에서 확인" },
  { id: "route-fee-binance-usdt-kaia", group: "fees", label: "바이낸스 USDT Kaia 출금비", unit: "USDT", fallback: "바이낸스", hint: "바이낸스 출금비 조회가 안 될 때만 씁니다 · 바이낸스 → 출금 → USDT → Kaia에서 확인" },
  { id: "route-fee-binance-usdt-aptos", group: "fees", label: "바이낸스 USDT Aptos 출금비", unit: "USDT", fallback: "바이낸스", hint: "바이낸스 출금비 조회가 안 될 때만 씁니다 · 바이낸스 → 출금 → USDT → Aptos에서 확인" },
  { id: "route-fee-lbank-usdt-tron", group: "fees", label: "LBank USDT Tron 출금비", unit: "USDT", fallback: "LBank", hint: "LBank 출금비를 받지 못했거나 6시간 넘게 묵었을 때만 씁니다 · LBank → 출금 → USDT → TRC20에서 확인" },
  { id: "route-fee-lbank-usdt-ethereum", group: "fees", label: "LBank USDT Ethereum 출금비", unit: "USDT", fallback: "LBank", hint: "LBank 출금비를 받지 못했거나 6시간 넘게 묵었을 때만 씁니다 · LBank → 출금 → USDT → ERC20에서 확인" },
  { id: "route-fee-lbank-usdt-bsc", group: "fees", label: "LBank USDT BSC 출금비", unit: "USDT", fallback: "LBank", hint: "LBank 출금비를 받지 못했거나 6시간 넘게 묵었을 때만 씁니다 · LBank → 출금 → USDT → BEP20(BSC)에서 확인" },
  { id: "route-mania-buy", group: "mania", label: "모빅매니아에서 살 때 가격", unit: "원/BMB", hint: "지금 바로 사려면 올라와 있는 판매 매물 중 가장 싼 가격에 사야 합니다" },
  { id: "route-mania-sell", group: "mania", label: "모빅매니아에서 팔 때 가격", unit: "원/BMB", hint: "지금 바로 팔려면 올라와 있는 구매 주문 중 가장 비싼 가격에 팔아야 합니다" }
];
var ROUTE_VALUES = {};
// Mobickmania prices and withdraw fee inputs are not saved; a reload clears them.
// Only trading fee rates (discount tiers etc.) are saved in this browser.
function saveRouteValues() {
  var keep = {};
  Object.keys(ROUTE_VALUES).forEach(function (id) { if (routeDef(id).group === "trade") keep[id] = ROUTE_VALUES[id]; });
  try { localStorage.setItem("route-inputs-v1", JSON.stringify(keep)); } catch (e) {}
}
try {
  var savedRouteInputs = JSON.parse(localStorage.getItem("route-inputs-v1") || "null");
  if (savedRouteInputs && typeof savedRouteInputs === "object") ROUTE_INPUTS.forEach(function (d) {
    if (d.group !== "trade") return;
    if (typeof savedRouteInputs[d.id] === "string" && savedRouteInputs[d.id] !== "" && savedRouteInputs[d.id] !== d.def)
      ROUTE_VALUES[d.id] = savedRouteInputs[d.id];
  });
} catch (e) {}
function routeDef(id) { return ROUTE_INPUTS.find(function (d) { return d.id === id; }); }
function routeValue(id) {
  var d = routeDef(id);
  return ROUTE_VALUES[id] != null ? ROUTE_VALUES[id] : (d.def || "");
}
function routeValid(id, value) {
  var d = routeDef(id), n = Number(value);
  return String(value).trim() !== "" && isFinite(n) && n >= 0 && (!d.max || n <= d.max);
}
function setRouteValue(id, value) {
  value = value == null ? "" : String(value).trim();
  // A Mobickmania price of 0 counts as empty.
  if (routeDef(id).group === "mania" && value !== "" && Number(value) === 0) value = "";
  if (value === "" || value === routeDef(id).def) delete ROUTE_VALUES[id];
  else ROUTE_VALUES[id] = value;
  saveRouteValues();
  renderRouteSettings();
}
function routeInputLabel(id) { return routeDef(id).label; }
function routeTradeFee(venue) {
  var id = "route-trade-" + venue;
  if (!routeValid(id, routeValue(id))) {
    var error = new Error(routeInputLabel(id) + " 입력이 필요합니다");
    error.inputId = id;
    throw error;
  }
  return Number(routeValue(id)) / 100;
}
function routeEscape(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function routeEditHtml(id, value, applyLabel) {
  // Mobickmania price arrows step by 1,000 KRW; other inputs are free-form.
  var step = id === "route-mania-buy" || id === "route-mania-sell" ? "1000" : "any";
  return '<span class="route-edit"><input type="number" min="0" step="' + step + '" inputmode="decimal" data-route-edit="' + id +
    '" value="' + routeEscape(value) + '" aria-label="' + routeEscape(routeInputLabel(id)) + '"> ' + routeEscape(routeDef(id).unit) +
    ' <button type="button" class="route-button" data-route-save="' + id + '">' + applyLabel + '</button></span>';
}
function routeSettingRow(d, editing) {
  var saved = ROUTE_VALUES[d.id] != null, value = routeValue(d.id);
  var html = '<div class="route-setting-row"><span class="name">' + routeEscape(d.label) + '</span>';
  if (editing) return html + routeEditHtml(d.id, value, "저장") +
    ' <button type="button" class="route-link-button" data-route-cancel>취소</button></div>';
  html += value !== "" ? '<span class="value">' + routeEscape(value) + ' ' + routeEscape(d.unit) + '</span>' +
    (d.def && !saved ? ' <span class="tag">기본값</span>' : saved ? ' <span class="tag">내가 입력</span>' : '')
    : '<span class="tag">입력 안 함</span>';
  html += ' <button type="button" class="route-link-button" data-route-change="' + d.id + '">' + (value !== "" ? "수정" : "입력") + '</button>';
  if (saved) html += ' <button type="button" class="route-link-button" data-route-clear="' + d.id + '">' + (d.def ? "기본값으로" : "지우기") + '</button>';
  return html + '</div>';
}
var routeEditing = null;
// Inputs needed because the automatic withdraw fee lookup failed. Filled during route lookup and shown in settings right away.
var ROUTE_FEE_ASK = {};
// Exchanges whose automatic fee lookup failed on the last run. Manual fees are shown only for these exchanges
// (they are unused while the lookup works). Hidden values stay saved and come back if the lookup fails again.
var ROUTE_FEE_DOWN = {};
var routeFeeWasDown = false;
function routeAskRow(d) {
  return '<div class="route-setting-row route-setting-ask"><span class="name">' + routeEscape(d.label) + '</span>' + routeEditHtml(d.id, "", "저장") +
    (d.hint ? '<p class="route-setting-hint">' + routeEscape(d.hint) + '</p>' : '') + '</div>';
}
function renderRouteSettings() {
  ["trade"].forEach(function (group) {
    $("route-setting-" + group).innerHTML = ROUTE_INPUTS.filter(function (d) { return d.group === group; })
      .map(function (d) { return routeSettingRow(d, routeEditing === d.id); }).join("");
  });
  var ask = ROUTE_FEE_ASK || {};
  var fees = ROUTE_INPUTS.filter(function (d) {
    return d.group === "fees" && (routeEditing === d.id || ask[d.id] || (ROUTE_VALUES[d.id] != null && ROUTE_FEE_DOWN[d.id.split("-")[2]]));
  });
  $("route-setting-fees").innerHTML = fees.map(function (d) {
    return ask[d.id] && ROUTE_VALUES[d.id] == null && routeEditing !== d.id ? routeAskRow(d) : routeSettingRow(d, routeEditing === d.id);
  }).join("");
  var mine = Object.keys(ROUTE_VALUES).filter(function (id) {
    var g = routeDef(id).group;
    return g === "trade" || (g === "fees" && fees.indexOf(routeDef(id)) >= 0);
  }).length;
  $("route-settings-summary").textContent = mine ? "내가 입력한 값 " + mine + "개" : "";
  $("route-inputs-reset-row").hidden = !mine;
  // Focus only the input opened via its edit button, so inputs shown after a failed lookup don't steal focus on every run.
  var editInput = routeEditing && document.querySelector('#route-settings [data-route-edit="' + routeEditing + '"]');
  if (editInput) editInput.focus();
  renderManiaBox();
}
// Mobickmania price inputs under the venue list, shown only when Mobickmania is checked (route-mania-buy/sell).
function renderManiaBox() {
  $("route-mania-box").hidden = !$("route-exchange-mania").checked;
  document.querySelectorAll("[data-mania-box]").forEach(function (input) {
    if (input !== document.activeElement) input.value = routeValue(input.getAttribute("data-mania-box"));
  });
}
// Manual inputs used by each step of a path, so missing values can be reported together before the lookup.
function routeEdgeInputs(edge) {
  if (edge.kind === "bithumb" || edge.kind === "binance" || edge.kind === "lbank")
    return ["route-trade-" + edge.kind];
  if (edge.kind === "mania") return [edge.id === "mania-buy" ? "route-mania-buy" : "route-mania-sell"];
  // A USDT transfer needs only one network to work, so that is decided during the lookup (routeUsdtTransfer).
  return [];
}
function routeMissingInputs(path) {
  var missing = [];
  path.forEach(function (edge) {
    routeEdgeInputs(edge).forEach(function (id) {
      if (!routeValid(id, routeValue(id)) && missing.indexOf(id) < 0) missing.push(id);
    });
  });
  return missing;
}
function routeNode(side) { var q = routeQueryNow(); return (side === "from" ? q.starts : q.ends)[0] || ""; }
fillRoutePlaces();
function routeStatusAge() {
  if (!routeCompletedAt) return;
  var stale = Date.now() - routeCompletedAt.getTime() > 60000;
  $("route-status").className = "route-status" + (stale ? " fail" : "");
  $("route-status").textContent = routeSummary + (stale ? " · 견적이 오래됐습니다. 다시 조회하세요." : "");
}
// Transfer step names read as "to X", so a path does not repeat the asset at every arrow.
var ROUTE_SEND_TO = { bithumb: "빗썸으로", binance: "바이낸스로", lbank: "LBank로", wallet: "개인 지갑으로" };
// BTC and BNB move between Binance and the personal wallet on one fixed network each (Binance network ids BTC, BSC).
// ETH is left out: the same asset lives on several networks and choosing the wrong one loses funds.
var ROUTE_COIN_NETWORKS = { btc: { net: "bitcoin", name: "Bitcoin" }, bnb: { net: "bsc", name: "BSC" } };
function routeEdges(scenario) {
  var edges = [
    { id: "dex-usdt-movn", from: "wallet-usdt", to: "wallet-movn", label: "유니스왑 USDT → MOVN", kind: "dex" },
    { id: "dex-movn-usdt", from: "wallet-movn", to: "wallet-usdt", label: "유니스왑 MOVN → USDT", kind: "dex" },
    { id: "dex-movn-wbmb", from: "wallet-movn", to: "wallet-wbmb", label: "유니스왑 MOVN → WBMB", kind: "dex" },
    { id: "dex-wbmb-movn", from: "wallet-wbmb", to: "wallet-movn", label: "유니스왑 WBMB → MOVN", kind: "dex" },
    // Single swap (WBMB <-> USDT). The two-swap path through MOVN can differ, so both are kept.
    { id: "dex-wbmb-usdt", from: "wallet-wbmb", to: "wallet-usdt", label: "유니스왑 WBMB → USDT", kind: "dex" },
    { id: "dex-usdt-wbmb", from: "wallet-usdt", to: "wallet-wbmb", label: "유니스왑 USDT → WBMB", kind: "dex" },
    { id: "lbank-buy", from: "lbank-usdt", to: "lbank-bmb", label: "LBank BMB 매수", kind: "lbank" },
    { id: "lbank-sell", from: "lbank-bmb", to: "lbank-usdt", label: "LBank BMB 매도", kind: "lbank" }
  ];
  ["usdt", "btc", "eth"].forEach(function (asset) {
    var name = ROUTE_ASSET_NAMES[asset];
    edges.push(
      { id: "bithumb-buy-" + asset, from: "bithumb-krw", to: "bithumb-" + asset, label: "빗썸 " + name + " 매수", kind: "bithumb" },
      { id: "bithumb-sell-" + asset, from: "bithumb-" + asset, to: "bithumb-krw", label: "빗썸 " + name + " 매도", kind: "bithumb" }
    );
  });
  ["btc", "eth", "bnb"].forEach(function (asset) {
    var name = ROUTE_ASSET_NAMES[asset];
    edges.push(
      { id: "binance-buy-" + asset, from: "binance-usdt", to: "binance-" + asset, label: "바이낸스 " + name + " 매수", kind: "binance" },
      { id: "binance-sell-" + asset, from: "binance-" + asset, to: "binance-usdt", label: "바이낸스 " + name + " 매도", kind: "binance" }
    );
  });
  ROUTE_USDT_TRANSFERS.forEach(function (pair) {
    edges.push({ id: "send-usdt-" + pair[0] + "-" + pair[1], from: pair[0] + "-usdt", to: pair[1] + "-usdt",
      label: ROUTE_SEND_TO[pair[1]] + " USDT 송금", kind: "transfer", asset: "usdt" });
  });
  Object.keys(ROUTE_COIN_NETWORKS).forEach(function (asset) {
    var name = ROUTE_ASSET_NAMES[asset];
    edges.push(
      { id: "withdraw-" + asset + "-binance-wallet", from: "binance-" + asset, to: "wallet-" + asset, label: ROUTE_SEND_TO.wallet + " " + name + " 출금", kind: "transfer", asset: asset },
      { id: "deposit-" + asset + "-wallet-binance", from: "wallet-" + asset, to: "binance-" + asset, label: ROUTE_SEND_TO.binance + " " + name + " 입금", kind: "transfer", asset: asset }
    );
  });
  edges.push(
    { id: "lbank-withdraw-bmb", from: "lbank-bmb", to: "wallet-bmb", label: ROUTE_SEND_TO.wallet + " BMB 출금", kind: "transfer" },
    { id: "lbank-deposit-bmb", from: "wallet-bmb", to: "lbank-bmb", label: ROUTE_SEND_TO.lbank + " BMB 입금", kind: "transfer" }
  );
  edges.push(
    { id: "wrap-bmb", from: "wallet-bmb", to: "wallet-wbmb", label: "BMB → WBMB 전환", kind: "wrap" },
    { id: "unwrap-bmb", from: "wallet-wbmb", to: "wallet-bmb", label: "WBMB → BMB 전환", kind: "wrap" }
  );
  if ($("route-exchange-mania").checked) edges.push(
    { id: "mania-buy", from: "mania-krw", to: "wallet-bmb", label: "모빅매니아에서 BMB 매수 (계좌 이체)", kind: "mania" },
    { id: "mania-sell", from: "wallet-bmb", to: "mania-krw", label: "모빅매니아에서 BMB 매도 (계좌 입금)", kind: "mania" }
  );
  // With Uniswap off, drop Uniswap (dex) steps.
  if (!$("route-exchange-uniswap").checked) edges = edges.filter(function (e) { return e.kind !== "dex"; });
  return filterRouteExchanges(edges, selectedRouteExchanges());
}
function routeRaw(amount, decimals) {
  if (!(amount > 0) || amount > 1e9) throw new Error("조회 가능한 수량 범위를 벗어났습니다");
  var scaled = decimals === 8 ? BigInt(Math.floor(amount * 1e8))
    : BigInt(Math.floor(amount * 1e6)) * 10n ** 12n;
  if (scaled <= 0n) throw new Error("수량이 너무 작습니다");
  return scaled;
}
// One Uniswap step = one swap, including splits across routes like the Uniswap app (uniSplit).
function routeDex(edge, amount, info) {
  var token = { "wallet-wbmb": WBMB, "wallet-movn": MOVN, "wallet-usdt": USDT };
  var inputDecimals = edge.from === "wallet-wbmb" ? 8 : 18;
  var outputDecimals = edge.to === "wallet-wbmb" ? 8 : 18;
  return uniSplit(token[edge.from], token[edge.to], routeRaw(amount, inputDecimals), true, true)
    .then(function (r) {
      if (info) info.what = "유니스왑 " + uniPoolText(r.parts) + " 포함";
      return Number(r.quote) / Math.pow(10, outputDecimals);
    });
}
function routeInputNumber(id, label) {
  var value = routeValue(id);
  if (!routeValid(id, value)) {
    var error = new Error(label + " 입력이 필요합니다");
    error.inputId = id;
    throw error;
  }
  return Number(value);
}
async function routeBithumbBooks() {
  var response = await fetch("https://api.bithumb.com/v1/orderbook?markets=KRW-USDT%2CKRW-BTC%2CKRW-ETH", { cache: "no-store" });
  if (!response.ok) throw new Error("빗썸 호가 요청 실패");
  var data = await response.json(), books = {};
  data.forEach(function (item) {
    books[item.market] = { at: item.timestamp,
      asks: item.orderbook_units.map(function (row) { return [Number(row.ask_price), Number(row.ask_size)]; }),
      bids: item.orderbook_units.map(function (row) { return [Number(row.bid_price), Number(row.bid_size)]; }) };
  });
  return books;
}
async function routeBinanceBooks(assets) {
  var books = {};
  await Promise.all(assets.map(async function (asset) {
    var symbol = asset.toUpperCase() + "USDT";
    var response = await fetch("https://data-api.binance.vision/api/v3/depth?symbol=" + symbol + "&limit=100", { cache: "no-store" });
    if (!response.ok) return;
    var data = await response.json();
    books[symbol] = { at: Date.now(), asks: data.asks.map(function (row) { return row.map(Number); }),
      bids: data.bids.map(function (row) { return row.map(Number); }) };
  }));
  return books;
}
async function routeBithumbFees() {
  var assets = ["USDT"];
  var data = await Promise.all(assets.map(async function (asset) {
    var response = await fetch("https://api.bithumb.com/v2/fee/inout/" + asset, { cache: "no-store" });
    if (!response.ok) throw new Error("빗썸 " + asset + " 출금비 요청 실패");
    return response.json();
  }));
  var fees = parseBithumbFees(data);
  // If nothing could be parsed, the format changed: treat it as a failure so the inputs are used.
  if (!Object.keys(fees).length) throw new Error("빗썸 출금비 형식이 바뀌었습니다");
  try {
    var st = parseBithumbStatus(await fetch("https://api.bithumb.com/public/assetsstatus/multichain/USDT", { cache: "no-store" }).then(json));
    Object.keys(st).forEach(function (net) { var row = fees["USDT-" + net]; if (row) { row.canWithdraw = st[net].canWithdraw; row.canDeposit = st[net].canDeposit; } });
  } catch (e) {}
  return fees;
}
// If the first endpoint is blocked or changes format, read USDT from the fallback endpoint (all coins, about 2 MB).
// Neither endpoint is documented. If both fail, find a new one following Docs/FEE_SOURCE_CHECK.md.
async function routeBinanceFees(coin) {
  coin = coin || "USDT";
  try {
    var response = await fetch("https://www.binance.com/bapi/capital/v2/public/capital/config/getOne?coin=" + coin + "&lang=en", { cache: "no-store" });
    var fees = response.ok ? parseBinanceFees(await response.json()) : {};
    if (Object.keys(fees).length) return fees;
  } catch (e) {}
  var all = await fetch("https://www.binance.com/bapi/capital/v1/public/capital/getNetworkCoinAll", { cache: "no-store" });
  if (!all.ok) throw new Error("바이낸스 " + coin + " 출금비 요청 실패");
  var row = ((await all.json()).data || []).find(function (c) { return c.coin === coin; });
  var backup = parseBinanceFees({ data: row && row.networkList });
  if (!Object.keys(backup).length) throw new Error("바이낸스 " + coin + " 출금비 형식이 바뀌었습니다");
  return backup;
}
// LBank deposit/withdraw settings come from a file saved by the GitHub Action (the LBank API blocks browser requests).
var LBANK_FEES = null, LBANK_FEES_STALE_MS = 6 * 3600000;
function loadLbankFees() {
  return fetch("data/lbank-fees.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("LBank 입출금 설정 파일 없음");
    return r.json();
  }).then(function (j) {
    if (!j || !j.assets || !j.at) throw new Error("LBank 입출금 설정 형식 오류");
    LBANK_FEES = { at: new Date(j.at), assets: j.assets };
  }).catch(function () {});
}
function routeLbankChain(asset, chain) {
  if (!LBANK_FEES) return null;
  return (LBANK_FEES.assets[asset] || []).find(function (row) { return row.chain === chain; }) || null;
}
function routeLbankFresh(asset, chain) {
  if (!LBANK_FEES) throw new Error("LBank 입출금 설정을 받지 못했습니다");
  if (Date.now() - LBANK_FEES.at.getTime() > LBANK_FEES_STALE_MS) throw new Error("LBank 입출금 설정이 오래됐습니다");
  var row = routeLbankChain(asset, chain);
  if (!row) throw new Error("LBank " + asset.toUpperCase() + " " + chain + " 네트워크 정보가 없습니다");
  return row;
}
function routeLbankWithdraw(asset, chain, amount) {
  var row = routeLbankFresh(asset, chain);
  if (!row.canWithdraw) throw new Error("LBank " + asset.toUpperCase() + " " + chain + " 출금이 중지돼 있습니다");
  if (!(row.fee >= 0)) throw new Error("LBank " + asset.toUpperCase() + " 출금비 정보가 없습니다");
  if (row.min > 0 && amount < row.min) throw new Error("LBank " + asset.toUpperCase() + " 최소 출금량 " + row.min + " 미만입니다");
  return row.fee;
}
function routeLbankDeposit(asset, chain) {
  if (!routeLbankFresh(asset, chain).canDeposit) throw new Error("LBank " + asset.toUpperCase() + " " + chain + " 입금이 중지돼 있습니다");
}
function routeLbankBook(asset) {
  var book = LBK.books[asset + "_usdt"];
  // Websocket order books arrive only on change. While connected, the last book is still current during quiet periods,
  // so it is used for up to 10 minutes (a fresh request is also sent when a route lookup starts).
  if (LBK.state !== "live" || !book || !book.at || Date.now() - book.at.getTime() > 10 * 60000)
    throw new Error("LBank " + asset.toUpperCase() + " 호가가 없거나 오래됐습니다");
  return book;
}
function routeUsdtWithdraw(place, net, amount, marketData) {
  if (place === "wallet") return { fee: 0, wallet: true };
  // Exchanges whose lookup worked use only the fetched values; otherwise fall through to the inputs below.
  if (place === "bithumb" && marketData.bithumbFees) {
    var row = marketData.bithumbFees["USDT-" + net];
    if (!row) return { skip: "빗썸 출금비 정보 없음" };
    if (row.canWithdraw === false) return { skip: "빗썸 출금 중지" };
    if (amount < row.min) return { skip: "빗썸 최소 출금량 " + row.min + " 미만" };
    return { fee: row.fee, src: "빗썸 공개값" + (marketData.bithumbFeesAt ? ", " + routeWhen(marketData.bithumbFeesAt) : "") };
  }
  if (place === "lbank" && routeLbankUsable()) {
    try { return { fee: routeLbankWithdraw("usdt", LBANK_USDT_CHAINS[net], amount), src: "LBank 공개값, " + routeWhen(LBANK_FEES.at) }; }
    catch (e) { return { skip: e.message }; }
  }
  if (place === "binance" && marketData.binanceFees) {
    var b = marketData.binanceFees[net];
    if (!b) return { skip: "바이낸스 출금비 정보 없음" };
    if (!b.canWithdraw) return { skip: "바이낸스 출금 중지" };
    if (amount < b.min) return { skip: "바이낸스 최소 출금량 " + b.min + " 미만" };
    return { fee: b.fee, src: "바이낸스 공개값, " + routeWhen(marketData.binanceFeesAt) };
  }
  var id = "route-fee-" + place + "-usdt-" + net, d = routeDef(id);
  if (!d || !routeValid(id, routeValue(id))) return { missing: id };
  return { fee: Number(routeValue(id)), src: "입력값", note: "최소 출금량·출금 가능 여부 미확인" };
}
function routeLbankUsable() {
  return !!LBANK_FEES && Date.now() - LBANK_FEES.at.getTime() <= LBANK_FEES_STALE_MS;
}
// Returns the reason if the receiving side cannot accept deposits on that network.
function routeUsdtDepositBlocked(place, net, arrived, marketData) {
  if (place === "binance" && marketData.binanceFees && marketData.binanceFees[net] && !marketData.binanceFees[net].canDeposit)
    return "바이낸스 입금 중지";
  if (place === "bithumb" && marketData.bithumbFees && marketData.bithumbFees["USDT-" + net] && marketData.bithumbFees["USDT-" + net].canDeposit === false)
    return "빗썸 입금 중지";
  if (place === "lbank" && routeLbankUsable()) {
    try { routeLbankDeposit("usdt", LBANK_USDT_CHAINS[net]); } catch (e) { return e.message; }
  }
  return null;
}
// Computes every network both sides support and sends on the one that delivers the most.
// Networks without a fee input drop out of the comparison; input is requested only if no network can be computed.
function routeUsdtTransfer(edge, amount, marketData, info) {
  var from = routePlace(edge.from), to = routePlace(edge.to), missing = [], skipped = [], options = [];
  routeCommonNetworks(from, to).forEach(function (net) {
    var name = USDT_NETWORKS[net], w = routeUsdtWithdraw(from, net, amount, marketData);
    if (w.missing) { missing.push(w.missing); return; }
    if (w.skip) { skipped.push(name + " " + w.skip); return; }
    if (!(amount > w.fee)) { skipped.push(name + " 출금비 이하"); return; }
    var blocked = routeUsdtDepositBlocked(to, net, amount - w.fee, marketData);
    if (blocked) { skipped.push(name + " " + blocked); return; }
    options.push({ net: net, out: amount - w.fee, fee: w.fee, src: w.src, note: w.note, wallet: w.wallet });
  });
  var best = bestNetwork(options);
  if (!best) {
    var error = new Error(missing.length ? missing.map(routeInputLabel).join(", ") + " 중 하나 이상 입력이 필요합니다"
      : "보낼 수 있는 네트워크가 없습니다" + (skipped.length ? " (" + skipped.join(" · ") + ")" : ""));
    if (missing.length) error.inputIds = missing;
    throw error;
  }
  info.fee = best.fee;
  info.feeNode = edge.from;
  info.network = USDT_NETWORKS[best.net];
  // Fee line: amount (source). Note: the network actually used (the cheapest). Sending from a personal wallet has no withdraw fee.
  if (best.wallet) { info.noAmount = true; info.what = "없음"; }
  else info.src = best.src;
  if (best.wallet) info.gas = info.network;
  info.basis = info.network + " 네트워크 " + (best.wallet ? "전송 · " + info.network + " 가스비 별도" : "출금") + (best.note ? " · " + best.note : "") +
    (to === "lbank" ? (routeLbankUsable() ? " · LBank 입금 가능 확인됨" : " · LBank 입금 가능 여부 미확인") : "");
  info.skippedInputs = missing;
  return best.out;
}
// BTC/BNB between Binance and the personal wallet. Withdrawals pay Binance's fee and must meet its minimum;
// deposits from the wallet pay only the network fee, which is shown as excluded.
function routeCoinTransfer(edge, amount, marketData, info) {
  var c = ROUTE_COIN_NETWORKS[edge.asset], name = ROUTE_ASSET_NAMES[edge.asset];
  var fees = marketData.binanceCoinFees && marketData.binanceCoinFees[edge.asset];
  if (!fees) throw new Error("바이낸스 " + name + " 출금비를 받지 못했습니다");
  var row = fees[c.net];
  if (!row) throw new Error("바이낸스 " + name + " " + c.name + " 네트워크 정보가 없습니다");
  info.network = c.name;
  info.feeNode = edge.from;
  var excluded = edge.asset === "bnb" ? "BSC 가스비 별도" : "비트코인 전송 수수료 별도";
  if (routePlace(edge.from) === "wallet") {
    if (!row.canDeposit) throw new Error("바이낸스 " + name + " " + c.name + " 입금이 중지되어 있습니다");
    info.fee = 0;
    info.noAmount = true;
    info.what = "없음";
    if (edge.asset === "bnb") info.gas = "BSC";
    info.basis = c.name + " 네트워크 전송 · 바이낸스 입금 가능 확인됨 · " + excluded;
    return amount;
  }
  if (!row.canWithdraw) throw new Error("바이낸스 " + name + " " + c.name + " 출금이 중지되어 있습니다");
  if (amount < row.min) throw new Error("바이낸스 " + name + " 최소 출금량 " + row.min + " 미만입니다");
  if (!(amount > row.fee)) throw new Error("전송 수량이 출금 수수료 이하입니다");
  info.fee = row.fee;
  info.src = "바이낸스 공개값, " + routeWhen(marketData.binanceCoinFeesAt);
  info.basis = c.name + " 네트워크 출금";
  return amount - row.fee;
}
// Source label for trading fee rates.
// Backs out a trade step's fee from its input and output amounts: paid in the input currency when buying, the output when selling.
// Fee line: whether the trading fee is the default or user-set. Note: the book range touched (asks when buying, bids when selling) and the average price.
function routeTradeInfo(info, edge, venue, buy, amount, out, levels) {
  var rate = routeTradeFee(venue);
  info.fee = buy ? amount * rate / (1 + rate) : out / (1 - rate) - out;
  info.feeNode = buy ? edge.from : edge.to;
  info.what = "거래 수수료 " + (ROUTE_VALUES["route-trade-" + venue] != null ? "입력값(" : "기본값(") + routeValue("route-trade-" + venue) + "%)";
  var r = bookRange(levels, amount, buy, rate);
  var p = function (v) { return fmt(v, v >= 1000 ? 0 : v >= 1 ? 2 : 6); };
  info.basis = r ? (buy ? "매도 호가 " : "매수 호가 ") + p(r.first) + " → " + p(r.last) + " (" + pct(r.last / r.first - 1) + ") · 평균 " + p(r.avg) : "";
}
function routeStep(edge, amount, scenario, marketData, info) {
  info = info || {};
  if (edge.kind === "dex") {
    // Which pools are used depends on the split, so no single pool fee rate is shown.
    info.noAmount = true;
    info.what = "유니스왑 풀 수수료 포함";
    info.gas = "BSC";
    info.basis = "BSC 가스비 별도";
    return routeDex(edge, amount, info);
  }
  if (edge.kind === "bithumb") {
    var bithumbAsset = edge.id.split("-")[2].toUpperCase();
    var bithumbBook = marketData.bithumb && marketData.bithumb["KRW-" + bithumbAsset];
    if (!bithumbBook || Date.now() - bithumbBook.at > 60000) throw new Error("빗썸 " + bithumbAsset + " 호가가 없거나 오래됐습니다");
    var bithumbOut = edge.id.startsWith("bithumb-buy-")
      ? buyFromBook(bithumbBook.asks, amount, routeTradeFee("bithumb"))
      : sellToBook(bithumbBook.bids, amount, routeTradeFee("bithumb"));
    if (!(bithumbOut > 0)) throw new Error("빗썸 호가 물량이 부족합니다");
    routeTradeInfo(info, edge, "bithumb", edge.id.startsWith("bithumb-buy-"), amount, bithumbOut, edge.id.startsWith("bithumb-buy-") ? bithumbBook.asks : bithumbBook.bids);
    return Promise.resolve(bithumbOut);
  }
  if (edge.kind === "binance") {
    var binanceAsset = edge.id.split("-")[2].toUpperCase();
    var binanceBook = marketData.binance && marketData.binance[binanceAsset + "USDT"];
    if (!binanceBook || Date.now() - binanceBook.at > 60000) throw new Error("바이낸스 " + binanceAsset + " 호가가 없거나 오래됐습니다");
    var binanceOut = edge.id.startsWith("binance-buy-")
      ? buyFromBook(binanceBook.asks, amount, routeTradeFee("binance"))
      : sellToBook(binanceBook.bids, amount, routeTradeFee("binance"));
    if (!(binanceOut > 0)) throw new Error("바이낸스 " + binanceAsset + " 호가 물량이 부족합니다");
    routeTradeInfo(info, edge, "binance", edge.id.startsWith("binance-buy-"), amount, binanceOut, edge.id.startsWith("binance-buy-") ? binanceBook.asks : binanceBook.bids);
    return Promise.resolve(binanceOut);
  }
  if (edge.kind === "lbank") {
    var lbankAsset = edge.id === "lbank-buy" || edge.id === "lbank-sell" ? "bmb" : edge.id.split("-")[2];
    var lbankBook = routeLbankBook(lbankAsset);
    var lbankOut = edge.id.startsWith("lbank-buy")
      ? buyFromBook(lbankBook.asks, amount, routeTradeFee("lbank"))
      : sellToBook(lbankBook.bids, amount, routeTradeFee("lbank"));
    if (!(lbankOut > 0)) throw new Error("LBank " + lbankAsset.toUpperCase() + " 호가 물량이 부족합니다");
    routeTradeInfo(info, edge, "lbank", edge.id.startsWith("lbank-buy"), amount, lbankOut, edge.id.startsWith("lbank-buy") ? lbankBook.asks : lbankBook.bids);
    return Promise.resolve(lbankOut);
  }
  if (edge.kind === "transfer" && edge.asset === "usdt") return Promise.resolve(routeUsdtTransfer(edge, amount, marketData, info));
  if (edge.kind === "transfer" && ROUTE_COIN_NETWORKS[edge.asset]) return Promise.resolve(routeCoinTransfer(edge, amount, marketData, info));
  if (edge.kind === "transfer") {
    var fee = edge.id === "lbank-withdraw-bmb" ? routeLbankWithdraw("bmb", "mobick", amount) : 0;
    if (edge.id === "lbank-deposit-bmb") routeLbankDeposit("bmb", "mobick");
    if (!(amount > fee)) throw new Error("전송 수량이 출금 수수료 이하입니다");
    info.fee = fee;
    info.feeNode = edge.from;
    // LBank's public API does not report deposit fees, so no amount is shown.
    if (edge.id === "lbank-deposit-bmb") info.noAmount = true;
    if (edge.id === "lbank-deposit-bmb") info.what = "없음"; else info.src = "LBank 공개값, " + routeWhen(LBANK_FEES.at);
    if (edge.id === "lbank-deposit-bmb") info.gas = "BMB";
    info.basis = edge.id === "lbank-deposit-bmb" ? "LBank 입금 가능 확인됨 · BMB 가스비 별도" : "BMB 네트워크 출금";
    return Promise.resolve(amount - fee);
  }
  if (edge.kind === "wrap") {
    // Conversion costs are network fees: BMB -> WBMB pays a Mobick chain transfer fee (BMB), WBMB -> BMB pays BSC gas (BNB).
    // Gas is never included in the amounts; step notes only mark it as excluded.
    info.fee = 0;
    info.feeNode = edge.from;
    info.noAmount = true;  // No amount, so no number like "0 BMB" is shown.
    info.what = "없음";
    // BMB -> WBMB sends BMB on the Mobick chain; WBMB -> BMB sends WBMB on BSC.
    info.gas = edge.id === "wrap-bmb" ? "BMB" : "BSC";
    info.basis = "모빅원 교환 · " + info.gas + " 가스비 별도";  // Conversion is done in the MobickOne app.
    return Promise.resolve(amount);
  }
  if (edge.kind === "mania") {
    var buy = edge.id === "mania-buy";
    var price = routeInputNumber(buy ? "route-mania-buy" : "route-mania-sell", routeInputLabel(buy ? "route-mania-buy" : "route-mania-sell"));
    if (!(price > 0)) throw new Error(routeInputLabel(buy ? "route-mania-buy" : "route-mania-sell") + "을 입력해 주세요");
    // Sell fee: 0.5% is taken from the BMB sold and the rest is sold at the sell price.
    info.fee = buy ? 0 : amount * FEE.maniaSell;
    info.feeNode = edge.from;
    info.what = (buy ? "살 때 수수료 없음" : "팔 때 수수료 " + (FEE.maniaSell * 100).toFixed(1) + "%") + (buy ? " · 살 때 가격 " : " · 팔 때 가격 ") + fmt(price, 0) + "원/BMB";
    info.basis = "내가 입력한 " + (buy ? "살 때 가격" : "팔 때 가격") + " · 수수료는 팔 때만 파는 BMB의 0.5% · 물량과 원화 이체 비용은 확인하지 않음";
    return Promise.resolve(buy ? amount / price : amount * price * (1 - FEE.maniaSell));
  }
  throw new Error("계산할 수 없는 단계입니다");
}
async function routeQuote(path, amount, scenario, marketData) {
  var out = amount, steps = [];
  for (var i = 0; i < path.length; i++) {
    var input = out, info = {};
    out = await routeStep(path[i], out, scenario, marketData, info);
    if (!(out > 0) || !isFinite(out)) throw new Error("견적을 받지 못했습니다");
    steps.push({ edge: path[i], input: input, output: out, info: info });
  }
  return { out: out, steps: steps };
}
// KRW in whole won; other assets at their own decimals.
// Headline amounts: KRW in whole won, BTC to 6 decimals, others to 2 decimals from 100 up and 4 below.
function routeShortQty(value, node) {
  var asset = routeAsset(node);
  return asset === "krw" ? fmt(value, 0) : asset === "btc" ? fmt(value, 6) : fmt(value, value >= 100 ? 2 : 4);
}
function routeQty(value, node) {
  return routeAsset(node) === "krw" ? fmt(value, value < 100 ? 2 : 0) : fmt(value, routeDigits(node));
}
// If start and end assets are the same, show the change versus simply holding.
function routeChangeHtml(start, destination, out) {
  if (!(routeBaseAmount > 0) || routeAsset(start) !== routeAsset(destination)) return "";
  var diff = out - routeBaseAmount, pct = diff / routeBaseAmount * 100;
  var sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return '<span class="route-change ' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">보유 대비 ' + sign +
    Math.abs(pct).toFixed(2) + '% (' + sign + routeShortQty(Math.abs(diff), destination) + ' ' + routeUnit(destination) + ')</span>';
}
// Fees are shown without trailing zeros.
function routeFeeQty(value, node) {
  var digits = routeAsset(node) === "krw" ? (value < 100 ? 2 : 0) : routeDigits(node);
  return Number(value.toFixed(digits)).toLocaleString("ko-KR", { maximumFractionDigits: digits });
}
// Path name. Transfer steps read "to X", so a path that starts with one also names where it starts
// ("빗썸 USDT → 바이낸스로 송금 → ...").
function routePathSteps(path) {
  var labels = routeGroupSteps(path).map(routeGroupLabel);
  if (path[0].kind === "transfer") labels[0] = routeNodeName(path[0].from) + " → " + path[0].label.replace(/ (USDT|BMB|BTC|BNB) /, " ");
  return labels;
}
function routePathName(path) { return routePathSteps(path).join(" → "); }
// Result card: the amounts first (in -> out), then one line of context (top card) or the gap to the top path (others),
// then the path as a vertical list of steps, then per-step details folded.
function routeCard(result, opts) {
  var path = result.path;
  // Details are not grouped: each trade is numbered, since consecutive Uniswap steps are separate swaps for the user.
  var detail = result.steps.map(function (step) {
    var info = step.info || {};
    var feeAmount = info.noAmount ? '' : '<b>' + routeFeeQty(info.fee, info.feeNode) + ' ' + routeUnit(info.feeNode) + '</b>';
    var fee = info.what || info.src ? '<span class="route-fee-line">수수료 ' + feeAmount +
      (info.src ? ' (' + routeEscape(info.src) + ')' : (feeAmount ? ' · ' : '') + routeEscape(info.what)) + '</span>' + (info.basis ? '<span class="route-fee">비고: ' + routeEscape(info.basis) + '</span>' : '') : '';
    return '<li><strong>' + routeEscape(step.edge.label + (info.network ? " (" + info.network + ")" : "")) + '</strong><span class="route-qty">' + routeQty(step.input, step.edge.from) + ' ' + routeUnit(step.edge.from) +
      ' → ' + routeQty(step.output, step.edge.to) + ' ' + routeUnit(step.edge.to) + '</span>' + fee + '</li>';
  }).join("");
  return '<article class="route-card' + (opts.best ? ' route-card-best' : '') + '">' +
    (opts.best ? '<span class="route-best">최적 경로</span>' : '') +
    '<h3 class="route-amount">' + opts.main + '</h3>' +
    (opts.meta ? '<p class="route-meta">' + opts.meta + '</p>' : '') +
    (opts.gap ? '<p class="route-gap">' + opts.gap + '</p>' : '') +
    '<ul class="route-path">' + routePathSteps(path).map(function (s) { return '<li>' + routeEscape(s) + '</li>'; }).join("") + '</ul>' +
    // Per-step amounts, fees and basis are folded under details. Open state is remembered per path (step id list) across auto refreshes.
    helpHtml("route-" + path.map(function (e) { return e.id; }).join(">"), "상세",
      '<ol class="route-steps-detail">' + detail + '</ol>') + '</article>';
}
function routeFailure(path, reason) {
  var names = routePathName(path);
  var safe = String(reason || "견적 실패").replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
  return '<article class="route-card"><h3>' + names + '</h3><p class="fail">' + safe + '</p></article>';
}
// Auto refresh keeps the current results on screen and swaps them in at once when the new ones are ready.
// If the ranking is unchanged, cards stay put and only numbers change. If the top path changes, a notice stays on top until the next manual run.
var routeLastBest = null, routeBestNotice = "", routeLastHtml = "";
async function runRouteSimulator(auto) {
  auto = auto === true;
  var version = ++routeVersion;
  routeBusy(false);
  var enabledExchanges = selectedRouteExchanges();
  var query = routeQueryNow();
  var starts = query.starts, ends = query.ends, inverse = query.kind === "inverse";
  var to = ends[0] || "", from = starts[0] || "";
  var amount = query.amount;
  var scenario = null;  // Always null; kept only for the route function signatures.
  var button = $("route-run"), status = $("route-status"), results = $("route-results");
  routeCompletedAt = null;
  status.className = "route-status";
  if (!auto) { results.innerHTML = ""; routeLastHtml = ""; routeLastBest = null; routeBestNotice = ""; }
  if (!(amount > 0) || amount > 1e9) {
    status.textContent = "매도 수량 또는 매수 수량을 입력해 주세요.";
    results.innerHTML = "";
    return;
  }
  if (!starts.length || !ends.length) {
    status.textContent = "이 자산을 가질 수 있는 이용 거래소가 없습니다. 이용 거래소를 확인해 주세요.";
    return;
  }
  if (((starts.length === 1 && routeVenue(from) && !enabledExchanges[routeVenue(from)]) ||
      (ends.length === 1 && routeVenue(to) && !enabledExchanges[routeVenue(to)]))) {
    status.textContent = "보유 위치·수령처의 거래소를 이용 거래소에 포함해 주세요.";
    return;
  }
  routeBaseAmount = inverse ? 0 : amount;
  var edges = routeEdges(scenario);
  var paths = starts.flatMap(function (start) {
    return ends.flatMap(function (end) { return enumerateRoutes(edges, start, end, 8); });
  }).filter(function (path) {
    // With no destination chosen, a path ends where the target asset is first acquired (the last trade); paths that then move it elsewhere
    // are dropped (choose a destination to see moving costs).
    var stopAt = query.stopAt;
    if (stopAt && path.slice(0, -1).some(function (edge) { return stopAt.indexOf(routeAsset(edge.to)) >= 0; })) return false;
    // Buying and immediately reselling on Mobickmania (or the reverse) only loses the spread, so drop it.
    return !path.some(function (edge, i) { return i > 0 && edge.kind === "mania" && path[i - 1].kind === "mania"; });
  });
  if (!paths.length) {
    status.textContent = /-eth$/.test(from) || /-eth$/.test(to)
      ? "ETH는 거래소 안의 매수·매도만 계산합니다. 거래소 간 송금과 개인 지갑 경로는 넣지 않습니다."
      : "이용 거래소로는 연결되는 경로가 없습니다. 이용 거래소 선택을 확인해 주세요.";
    return;
  }
  button.disabled = true;
  routeBusy(true, !auto);
  if (LBK.state === "live") lbankRequest();
  // Right after page load the LBank book may not have arrived yet; when LBank is enabled, wait up to 5 seconds for it.
  if (enabledExchanges.lbank && !(LBK.books.bmb_usdt && LBK.books.bmb_usdt.at)) {
    status.textContent = "LBank 호가를 받는 중입니다…";
    for (var w = 0; w < 25 && !(LBK.books.bmb_usdt && LBK.books.bmb_usdt.at) && LBK.state !== "failed"; w++) await uniWait(200);
    if (version !== routeVersion) return;
  }
  status.textContent = auto ? routeSummary + " · 새 견적 받는 중…" : paths.length + "개 경로의 수량별 견적을 조회 중입니다…";
  var succeeded = [], failed = [];
  var marketData = {}, allEdges = paths.flat();
  await Promise.all([
    allEdges.some(function (edge) { return edge.kind === "bithumb"; })
      ? routeBithumbBooks().then(function (books) { marketData.bithumb = books; }, function () {}) : null,
    allEdges.some(function (edge) { return edge.kind === "binance"; })
      ? routeBinanceBooks(allEdges.filter(function (edge) { return edge.kind === "binance"; })
        .map(function (edge) { return edge.id.split("-")[2]; })
        .filter(function (asset, i, list) { return list.indexOf(asset) === i; }))
        .then(function (books) { marketData.binance = books; }, function () {}) : null,
    allEdges.some(function (edge) { return edge.kind === "transfer" && (edge.from === "bithumb-usdt" || edge.to === "bithumb-usdt"); })
      ? routeBithumbFees().then(function (fees) { marketData.bithumbFees = fees; marketData.bithumbFeesAt = new Date(); },
        function () { marketData.bithumbFeesFailed = true; }) : null,
    allEdges.some(function (edge) { return edge.kind === "transfer" && (edge.from === "binance-usdt" || edge.to === "binance-usdt"); })
      ? routeBinanceFees().then(function (fees) { marketData.binanceFees = fees; marketData.binanceFeesAt = new Date(); },
        function () { marketData.binanceFeesFailed = true; }) : null
  ].concat(Object.keys(ROUTE_COIN_NETWORKS).map(function (asset) {
    if (!allEdges.some(function (edge) { return edge.kind === "transfer" && edge.asset === asset; })) return null;
    return routeBinanceFees(asset.toUpperCase()).then(function (fees) {
      marketData.binanceCoinFees = marketData.binanceCoinFees || {};
      marketData.binanceCoinFees[asset] = fees;
      marketData.binanceCoinFeesAt = new Date();
    }, function () {});
  })));
  if (inverse) {
    var inv = await routeInverse(paths, amount, marketData, version, failed);
    if (inv === null) return;
    succeeded = inv;
  }
  // Paths are quoted one by one to avoid bursts on the public node. Uniswap quotes within 1% of a recent amount are reused (uniSplit near).
  for (var i = 0; !inverse && i < paths.length; i++) {
    routeProgress(i + 1, paths.length, succeeded.reduce(function (b, r) { return !b || r.out > b.out ? r : b; }, null), false);
    var missingInputs = routeMissingInputs(paths[i]);
    if (missingInputs.length) {
      failed.push({ path: paths[i], inputIds: missingInputs,
        reason: missingInputs.map(routeInputLabel).join(", ") + " 입력이 필요합니다" });
      continue;
    }
    try {
      var quoteResult = await routeQuote(paths[i], amount, scenario, marketData);
      succeeded.push({ path: paths[i], out: quoteResult.out, steps: quoteResult.steps });
    } catch (e) { failed.push({ path: paths[i], reason: e.message, inputIds: e.inputIds }); }
    if (version !== routeVersion) return;
  }
  // Drop send-only detours that receive no more than the direct transfer (they tie when both networks have zero fees).
  var directIds = new Set(edges.map(function (e) { return e.id; }));
  var byIds = {};
  succeeded.forEach(function (r) { byIds[r.path.map(function (e) { return e.id; }).join(">")] = r.out; });
  if (!inverse) succeeded = succeeded.filter(function (r) {
    return !routeShorterKeys(r.path, directIds).some(function (key) {
      return byIds[key] != null && byIds[key] >= r.out * (1 - 1e-12);
    });
  });
  // On equal output, fewer steps first.
  function byOut(a, b) {
    return inverse ? (a.cost - b.cost) || (a.path.length - b.path.length) : (b.out - a.out) || (a.path.length - b.path.length);
  }
  var now = succeeded.slice().sort(byOut);
  var html = "", missing = {};
  failed.forEach(function (r) {
    (r.inputIds || []).forEach(function (id) {
      missing[id] = missing[id] || { label: routeInputLabel(id), count: 0 };
      missing[id].count++;
    });
  });
  // Networks computed but left out of the comparison because their withdraw fee is empty; filling it may reveal a cheaper one.
  var uncompared = {};
  succeeded.forEach(function (r) {
    var ids = [];
    r.steps.forEach(function (s) { (s.info.skippedInputs || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    ids.forEach(function (id) {
      if (missing[id]) return;
      uncompared[id] = uncompared[id] || { count: 0 };
      uncompared[id].count++;
    });
  });
  var missingIds = Object.keys(missing).sort(function (a, b) { return missing[b].count - missing[a].count; });
  // Withdraw fees are not asked in the results; inputs appear in the fee settings (only for exchanges whose lookup failed).
  // The results show a single notice line on top (feeDown below).
  ROUTE_FEE_ASK = {};
  ROUTE_FEE_DOWN = { bithumb: !!marketData.bithumbFeesFailed, binance: !!marketData.binanceFeesFailed, lbank: !routeLbankUsable() };
  missingIds.concat(Object.keys(uncompared)).forEach(function (id) { if (routeDef(id).group === "fees") ROUTE_FEE_ASK[id] = true; });
  renderRouteSettings();
  // With multiple start/end places, the answer is whichever path receives the most, so only the ranked list is shown.
  if (starts.some(function (st) { return ends.indexOf(st) >= 0; })) html += '<article class="route-card"><h3>거래하지 않고 보유</h3><div class="route-amount">' +
    routeQty(amount, to) + ' ' + routeUnit(to) + '</div></article>';
  if (now.length) {
    // Ranked regardless of start place; only the top path is expanded and the rest are folded under other paths.
    var better = inverse ? function (a, b) { return a.cost < b.cost || (a.cost === b.cost && a.path.length < b.path.length); }
      : function (a, b) { return a.out > b.out || (a.out === b.out && a.path.length < b.path.length); };
    var order = function (a, b) { return better(a, b) ? -1 : better(b, a) ? 1 : 0; };
    var sorted = now.slice().sort(order), ranked = sorted.slice(0, 1), rest = sorted.slice(1);
    var top = sorted[0];
    var num = routeShortQty;
    var endOf = function (r) { return r.path[r.path.length - 1].to; };
    // Every card shows in -> out. The top card adds where it starts and ends; the others show how much worse they are
    // than the top path (more spent when solving backwards, less received otherwise).
    var gapNode = inverse ? top.path[0].from : endOf(top);
    var card = function (r, best) {
      var inNode = r.path[0].from, outNode = endOf(r), input = inverse ? r.cost : amount;
      var main = num(input, inNode) + " " + routeUnit(inNode) + " → " + num(r.out, outNode) + " " + routeUnit(outNode);
      if (best) return routeCard(r, { best: true, main: main,
        meta: "소요 → 수령 · " + routeEscape(routeNodeName(inNode)) + " 출발 · " + routeEscape(routeNodeName(outNode)) + " 수령" +
          (inverse ? "" : " " + routeChangeHtml(inNode, outNode, r.out)) });
      var shown = num(inverse ? r.cost - top.cost : top.out - r.out, gapNode);
      var gap = Number(shown.replace(/,/g, "")) === 0 ? "최적 경로와 같음"
        : "최적 경로보다 " + shown + " " + routeUnit(gapNode) + (inverse ? " 더 듦" : " 적게 수령");
      return routeCard(r, { main: main, gap: gap });
    };
    html += ranked.map(function (r, i) { return card(r, i === 0); }).join("") +
      (rest.length ? '<details class="route-more"><summary>다른 경로 ' + Math.min(rest.length, 5) + "개</summary>" +
        rest.slice(0, 5).map(function (r) { return card(r, false); }).join("") +
        (rest.length > 5 ? '<p class="route-status">나머지 ' + rest.length + "개 중 상위 5개만 보여 줍니다.</p>" : "") + "</details>" : "");
    // Fill the non-basis input with the top result (unless the user is typing in it).
    var other = tradeOtherInput();
    if (other !== document.activeElement) {
      var v = inverse ? top.cost : top.out, node = inverse ? top.path[0].from : endOf(top);
      other.value = routeAsset(node) === "krw" ? String(Math.round(v)) : String(Number(v.toFixed(routeDigits(node))));
    }
  } else if (tradeOtherInput() !== document.activeElement) tradeOtherInput().value = "";
  if (failed.length) html += '<details class="route-more"><summary>견적을 계산하지 못한 ' + failed.length + '개 경로 보기</summary>' +
    failed.map(function (r) { return routeFailure(r.path, r.reason); }).join("") + '</details>';
  // If both Binance fee endpoints are blocked, every Binance transfer drops out, so a notice goes on top of the results.
  // A Mobickmania sell price above the buy price would allow instant risk-free profit,
  // which can't happen in a real market; the two inputs were most likely swapped, so warn.
  if (allEdges.some(function (e) { return e.kind === "mania"; }) &&
      routeValid("route-mania-buy", routeValue("route-mania-buy")) && routeValid("route-mania-sell", routeValue("route-mania-sell")) &&
      Number(routeValue("route-mania-sell")) > Number(routeValue("route-mania-buy")))
    html = '<p class="route-notice">모빅매니아 팔 때 가격(' + fmt(Number(routeValue("route-mania-sell")), 0) +
      '원)이 살 때 가격(' + fmt(Number(routeValue("route-mania-buy")), 0) + '원)보다 높습니다. ' +
      '두 값을 바꿔 넣지 않았는지 이용 거래소 아래 모빅매니아 칸에서 확인하세요.</p>' + html;
  var feeDown = [];
  if (marketData.binanceFeesFailed) feeDown.push("바이낸스");
  if (marketData.bithumbFeesFailed) feeDown.push("빗썸");
  if (allEdges.some(function (e) { return e.from === "lbank-usdt" && e.kind === "transfer"; }) && !routeLbankUsable()) feeDown.push("LBank");
  // Open the fee settings when a fee lookup starts failing; while it keeps failing, respect the user's collapsed state.
  if (feeDown.length && !routeFeeWasDown) $("route-settings").open = true;
  routeFeeWasDown = feeDown.length > 0;
  if (feeDown.length) html = '<p class="route-notice">' + feeDown.join("·") + ' USDT 출금비 조회에 실패했습니다(30초마다 다시 조회합니다). ' +
    '출금비를 넣지 않으면 ' + feeDown.join("·") + '에서 출금하는 경로는 계산에서 빠집니다. ' +
    '<button type="button" class="route-link-button" data-open-settings>수수료 및 출금비 설정</button>에서 입력해 주세요.</p>' + html;
  // Check whether the top path changed. Paths are compared by step ids, so number-only changes don't count.
  var bestNow = now.length ? { key: now[0].path.map(function (e) { return e.id; }).join(">"),
    name: routePathName(now[0].path), out: now[0].out } : null;
  if (auto && routeLastBest && (!bestNow || bestNow.key !== routeLastBest.key))
    routeBestNotice = '<p class="route-status route-changed">' + hmss(new Date()) + ' 갱신에서 1위 경로가 바뀌었습니다. 이전 1위: ' +
      routeEscape(routeLastBest.name) + ' (' + routeShortQty(routeLastBest.out, to) + ' ' + routeUnit(to) + ')</p>';
  routeLastBest = bestNow;
  html = routeBestNotice + (html || '<p class="route-status">현재 시세나 물량으로 계산할 수 있는 경로가 없습니다.</p>');
  if (html !== routeLastHtml) {
    // Keep open sections and scroll position. Path card details (data-help) are remembered per path, not restored by order.
    var opened = Array.prototype.map.call(results.querySelectorAll("details:not([data-help])"), function (d) { return d.open; });
    var scrollY = window.scrollY;
    results.innerHTML = html;
    Array.prototype.forEach.call(results.querySelectorAll("details:not([data-help])"), function (d, i) { if (opened[i]) d.open = true; });
    if (auto) window.scrollTo(0, scrollY);
    routeLastHtml = html;
  }
  routeCompletedAt = new Date();
  // Detours equivalent to a direct transfer are dropped silently.
  routeSummary = hmss(routeCompletedAt) + " 견적 완료 · 30초마다 자동 갱신 · 경로 " + succeeded.length + "개 계산" +
    (failed.length ? " · " + failed.length + "개는 계산 못함(입력·호가 확인)" : "") +
    (function () {
      // List the gas networks (BSC, Mobick chain, etc.) that appear in the computed paths.
      var nets = [];
      succeeded.forEach(function (r) { r.steps.forEach(function (st) { if (st.info.gas && nets.indexOf(st.info.gas) < 0) nets.push(st.info.gas); }); });
      return nets.length ? " · " + nets.join("·") + " 가스비 별도" : "";
    })();
  routeStatusAge();
  button.disabled = false;
  routeBusy(false);
}
$("route-run").addEventListener("click", function () { runRouteSimulator(false); });
// x where the line through two (x, out) points reaches target. Falls back to a ratio if the slope is unusable.
function routeSecant(a, b, target) {
  var slope = (b.out - a.out) / (b.x - a.x);
  return slope > 0 && isFinite(slope) && Math.abs(b.x - a.x) > 1e-12 ? b.x + (target - b.out) / slope : b.x * target / b.out;
}
// While computing, the status line shows progress k/n and the best result so far.
function routeProgress(k, n, best, inverse) {
  var line = "계산 중 " + k + "/" + n;
  if (best) {
    var end = best.path[best.path.length - 1].to, start = best.path[0].from;
    line += " · 지금까지 1위: " + routeNodeName(start) + " 출발 " + (inverse
      ? (routeAsset(start) === "krw" ? fmt(best.cost, 0) : fmt(best.cost, 2)) + " " + routeUnit(start)
      : (routeAsset(end) === "krw" ? fmt(best.out, 0) : fmt(best.out, 4)) + " " + routeUnit(end));
  }
  $("route-status").textContent = line;
  $("route-progress-bar").style.width = Math.round(k / n * 100) + "%";
}
// Spinner and elapsed seconds while a lookup runs, so a node stalling for a few seconds doesn't look like a hang.
// Manual runs also show it on the button; 30-second auto refreshes show it on the status line only.
var routeBusyTimer = null;
function routeBusy(on, manual) {
  var row = $("route-run").parentNode, started = Date.now();
  clearInterval(routeBusyTimer);
  row.classList.toggle("busy", on);
  row.classList.toggle("busy-manual", on && !!manual);
  $("route-run").textContent = on && manual ? "조회 중" : "다시 조회";
  $("route-progress-bar").style.width = "0";
  $("route-elapsed").textContent = on ? "0초 경과" : "";
  if (on) routeBusyTimer = setInterval(function () {
    $("route-elapsed").textContent = Math.floor((Date.now() - started) / 1000) + "초 경과";
  }, 1000);
}
// Receive-amount basis (solving backwards): for each path, find how much must go in to get `target` out at the end.
// Output is nearly linear in input (proportional plus fixed costs like withdraw fees), so a secant through two points finds it.
// 1) All paths: estimate the input from market prices, then correct it by the observed ratio.
// 2) Up to INVERSE_PER_PAIR paths per start/end pair: refine with the estimate, the ratio-corrected value and the secant (step amounts use this input).
// Most evaluations differ by under 1% in input, so Uniswap quotes are reused by ratio and requests stay low (uniSplit near).
var INVERSE_PER_PAIR = 6;
async function routeInverse(paths, target, marketData, version, failed) {
  // First guess: value each asset in USDT at current prices, plus a 3% margin and about 3 USDT for withdraw fees.
  // BTC, ETH and BNB are priced from the Binance USDT book or the Bithumb KRW book fetched for this lookup.
  // A guess far off (e.g. 1:1) can fall below withdraw minimums and fail the whole path before it is corrected.
  var spot = has(D.wbmbInMovn) && has(D.movnUsdt) ? D.wbmbInMovn * D.movnUsdt : null;
  function mid(book) { return book && book.asks[0] && book.bids[0] ? (book.asks[0][0] + book.bids[0][0]) / 2 : null; }
  function bookValue(asset) {
    var b = mid(marketData.binance && marketData.binance[asset.toUpperCase() + "USDT"]);
    if (b > 0) return b;
    var k = mid(marketData.bithumb && marketData.bithumb["KRW-" + asset.toUpperCase()]);
    return k > 0 && has(D.usdtKrw) ? k / D.usdtKrw : null;
  }
  function usdtValue(asset) {
    return asset === "usdt" ? 1 : asset === "krw" ? (has(D.usdtKrw) ? 1 / D.usdtKrw : null)
      : asset === "movn" ? (has(D.movnUsdt) ? D.movnUsdt : null) : asset === "bmb" || asset === "wbmb" ? spot
      : bookValue(asset);
  }
  function guess(path) {
    var vs = usdtValue(routeAsset(path[0].from)), ve = usdtValue(routeAsset(path[path.length - 1].to));
    return vs && ve ? target * ve / vs * 1.03 + 3 / vs : target;
  }
  async function quoteAt(path, x) { var q = await routeQuote(path, x, null, marketData); return { x: x, out: q.out, steps: q.steps }; }
  var first = [];
  for (var i = 0; i < paths.length; i++) {
    routeProgress(i + 1, paths.length, first.reduce(function (b, r) { return !b || r.cost < b.cost ? r : b; }, null), true);
    var miss = routeMissingInputs(paths[i]);
    if (miss.length) { failed.push({ path: paths[i], inputIds: miss, reason: miss.map(routeInputLabel).join(", ") + " 입력이 필요합니다" }); continue; }
    try {
      var x0 = guess(paths[i]), p0 = await quoteAt(paths[i], x0);
      if (p0.out > 0) { var p0b = await quoteAt(paths[i], x0 * target / p0.out); first.push({ path: paths[i], cost: routeSecant(p0, p0b, target) }); }
    } catch (e) { failed.push({ path: paths[i], reason: e.message, inputIds: e.inputIds }); }
    if (version !== routeVersion) return null;
  }
  // Drop send-only detours that cost no less than the direct transfer (same rule as the send-amount basis),
  // then refine up to INVERSE_PER_PAIR paths per start/end pair: the top card plus the 5 under "other paths".
  var ids = new Set(paths.flat().map(function (e) { return e.id; })), costByKey = {};
  first.forEach(function (r) { costByKey[r.path.map(function (e) { return e.id; }).join(">")] = r.cost; });
  first = first.filter(function (r) {
    return !routeShorterKeys(r.path, ids).some(function (key) { return costByKey[key] != null && costByKey[key] <= r.cost * (1 + 1e-12); });
  });
  var count = {}, out = [], picks = first.slice().sort(function (a, b) { return a.cost - b.cost; })
    .filter(function (r) { var k = r.path[0].from + ">" + r.path[r.path.length - 1].to; count[k] = (count[k] || 0) + 1; return count[k] <= INVERSE_PER_PAIR; });
  for (var k = 0; k < picks.length; k++) {
    var r = picks[k];
    try {
      var p1 = await quoteAt(r.path, r.cost), p2 = await quoteAt(r.path, r.cost * target / p1.out);
      var x = routeSecant(p1, p2, target), p3 = await quoteAt(r.path, x);
      out.push({ path: r.path, cost: x, out: p3.out, steps: p3.steps });
    } catch (e) { failed.push({ path: r.path, reason: e.message, inputIds: e.inputIds }); }
    if (version !== routeVersion) return null;
  }
  return out;
}
function routeInputsChanged(rerun) {
  routeVersion++;
  routeCompletedAt = null;
  $("route-run").disabled = false;
  routeBusy(false);
  if (rerun || tradeAutoRun()) { runRouteSimulator(); return; }
  $("route-results").innerHTML = "";
  $("route-status").textContent = "조건이 바뀌었습니다. 경로를 다시 조회하세요.";
}
function routeSaveFrom(button) {
  var id = button.getAttribute("data-route-save");
  var input = button.parentNode.querySelector("[data-route-edit]");
  if (!routeValid(id, input.value)) {
    input.setCustomValidity("0 이상의 숫자를 넣어 주세요");
    input.reportValidity();
    return false;
  }
  routeEditing = null;
  setRouteValue(id, input.value);
  return true;
}
$("route-results").addEventListener("click", function (event) {
  var button = event.target.closest && event.target.closest("[data-route-save]");
  if (button && routeSaveFrom(button)) routeInputsChanged(true);
});
// The fee settings link in the notice above the results opens the settings and scrolls to them.
$("route-results").addEventListener("click", function (event) {
  if (!event.target.closest || !event.target.closest("[data-open-settings]")) return;
  var box = $("route-settings");
  box.open = true;
  box.scrollIntoView({ block: "start", behavior: "smooth" });
  var first = box.querySelector(".route-setting-ask [data-route-edit]");
  if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 300);
});
$("route-settings").addEventListener("click", function (event) {
  var t = event.target.closest && event.target.closest("button");
  if (!t) return;
  if (t.hasAttribute("data-route-change")) { routeEditing = t.getAttribute("data-route-change"); renderRouteSettings(); }
  else if (t.hasAttribute("data-route-cancel")) { routeEditing = null; renderRouteSettings(); }
  else if (t.hasAttribute("data-route-clear")) { setRouteValue(t.getAttribute("data-route-clear"), ""); routeInputsChanged(false); }
  else if (t.hasAttribute("data-route-save")) { if (routeSaveFrom(t)) routeInputsChanged(false); }
});
["route-results", "route-settings"].forEach(function (box) {
  $(box).addEventListener("keydown", function (event) {
    var input = event.target;
    if (event.key !== "Enter" || !input.hasAttribute || !input.hasAttribute("data-route-edit")) return;
    event.preventDefault();
    input.parentNode.querySelector("[data-route-save]").click();
  });
  $(box).addEventListener("input", function (event) {
    if (event.target.setCustomValidity) event.target.setCustomValidity("");
  });
});
$("route-mania-box").addEventListener("change", function (e) {
  var id = e.target.getAttribute && e.target.getAttribute("data-mania-box");
  if (!id) return;
  var v = e.target.value.trim();
  if (v !== "" && !routeValid(id, v)) { e.target.setCustomValidity("0 이상의 숫자를 넣어 주세요"); e.target.reportValidity(); return; }
  e.target.setCustomValidity("");
  setRouteValue(id, v);
  if (ROUTE_VALUES[id] == null) e.target.value = "";
  routeInputsChanged(false);
});
// Reset: clear both Mobickmania buy and sell prices.
$("route-mania-reset").addEventListener("click", function () {
  delete ROUTE_VALUES["route-mania-buy"]; delete ROUTE_VALUES["route-mania-sell"];
  document.querySelectorAll("[data-mania-box]").forEach(function (input) { input.value = ""; input.setCustomValidity(""); });
  renderRouteSettings();
  routeInputsChanged(false);
});
$("route-mania-box").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-mania-box")) e.target.blur();
});
// Clears only trading fee rates and withdraw fees entered in this settings box; Mobickmania prices (outside it) stay.
$("route-inputs-reset").addEventListener("click", function () {
  Object.keys(ROUTE_VALUES).forEach(function (id) { if (routeDef(id).group !== "mania") delete ROUTE_VALUES[id]; });
  routeEditing = null;
  saveRouteValues();
  renderRouteSettings();
  routeInputsChanged(false);
});
renderRouteSettings();
setInterval(function () {
  // Skip the refresh while the user is typing in an input inside the results, so the value is not wiped.
  if (routeCompletedAt && Date.now() - routeCompletedAt.getTime() >= 30000 && routeShown() &&
      !document.hidden && !$("route-run").disabled && !$("route-results").contains(document.activeElement)) runRouteSimulator(true);
}, 5000);
["route-from-place", "route-from-asset", "route-to-place", "route-to-asset",
  "route-exchange-bithumb", "route-exchange-binance", "route-exchange-lbank",
  "route-exchange-uniswap", "route-exchange-mania"].forEach(function (id) {
  $(id).addEventListener("change", function () {
    if (id.startsWith("route-exchange-")) {
      try { localStorage.setItem("route-exchanges-v1", JSON.stringify(selectedRouteExchanges())); } catch (e) {}
      // Toggling Mobickmania clears its price inputs.
      if (id === "route-exchange-mania") {
        delete ROUTE_VALUES["route-mania-buy"]; delete ROUTE_VALUES["route-mania-sell"];
      }
      fillRoutePlaces();
      renderRouteSettings();
    }
    // Changing an asset refills the location list with places that can hold it and clears the other input, whose result no longer applies.
    if (id === "route-from-asset") fillRouteAssets("from");
    if (id === "route-to-asset") fillRouteAssets("to");
    if (id.slice(-6) === "-asset") tradeOtherInput().value = "";
    routeInputsChanged(true);
  });
});

// ── Trade comparison: held asset/place -> received asset/place; the amount input the user typed in is the basis ──
// basis "send" (typed in the send input): maximum received for that amount. "get" (typed in the receive input): minimum needed (solved backwards).
// A reload resets assets, places and amounts (nothing is saved). Nothing is computed until an amount is entered.
var TRADE = { basis: "get" };
try { localStorage.removeItem("trade-v1"); localStorage.removeItem("trade-v2"); } catch (e) {}
function tradeAmountInput() { return $(TRADE.basis === "get" ? "route-get-amount" : "route-amount"); }
function tradeOtherInput() { return $(TRADE.basis === "get" ? "route-amount" : "route-get-amount"); }
// The non-basis input displays the computed result and is cleared when there is none.
function markTradeBasis() {
  tradeAmountInput().classList.remove("computed");
  tradeOtherInput().classList.add("computed");
}
function routeShown() { return !!TRADE && onTradePage(); }
function tradeAutoRun() { return routeShown(); }
function routeQueryNow() {
  var en = selectedRouteExchanges(), get = TRADE.basis === "get";
  var fp = $("route-from-place").value, fa = $("route-from-asset").value, tp = $("route-to-place").value, ta = $("route-to-asset").value;
  // No destination chosen: end where the target asset is first acquired (no moving afterwards). BMB also counts wallet WBMB.
  return { kind: get ? "inverse" : "forward", starts: routeStartNodes(fp, fa, en), ends: routeStartNodes(tp, ta, en),
    amount: Number(tradeAmountInput().value), stopAt: tp === "any" ? (ta === "bmb" ? ["bmb", "wbmb"] : [ta]) : null,
    from: [fp, fa], to: [tp, ta] };
}
// Compute when the tab opens if there are no results yet.
function tradeTabShown() {
  if (!routeCompletedAt && !$("route-results").innerHTML) runRouteSimulator(false);
}
// Amount inputs: the one typed in becomes the basis; recompute after typing pauses for 0.6 seconds.
["route-amount", "route-get-amount"].forEach(function (id) {
  $(id).addEventListener("input", function () {
    TRADE.basis = id === "route-get-amount" ? "get" : "send";
    tradeOtherInput().value = "";
    markTradeBasis();
    clearTimeout(tradeAmountInput.t);
    tradeAmountInput.t = setTimeout(function () { routeInputsChanged(true); }, 600);
  });
});

// Reset: assets and places back to their defaults, both amounts cleared, results cleared (same as a fresh page).
$("trade-reset").addEventListener("click", function () {
  clearTimeout(tradeAmountInput.t);
  $("route-from-asset").value = $("route-from-asset").dataset.default;
  $("route-from-place").value = $("route-from-place").dataset.default;
  $("route-to-asset").value = $("route-to-asset").dataset.default;
  $("route-to-place").value = $("route-to-place").dataset.default;
  fillRouteAssets("from");
  fillRouteAssets("to");
  $("route-amount").value = "";
  $("route-get-amount").value = "";
  $("route-amount").classList.remove("computed");
  $("route-get-amount").classList.remove("computed");
  TRADE.basis = "get";
  routeInputsChanged(true);
});

loadLbankFees();
everyVisible(loadLbankFees, 10 * 60000);
setInterval(routeStatusAge, 10000);
commonStart();
tradeTabShown();
