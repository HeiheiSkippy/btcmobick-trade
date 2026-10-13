# BTCMobick 거래 비교

BTCMobick(BMB)을 사고팔거나 옮길 때 어느 경로가 가장 유리한지 비교하는 페이지입니다.

https://skippy0813g.github.io/btcmobick-trade/

빗썸·바이낸스·LBank 호가와 출금비, 유니스왑(BSC) 견적으로 가능한 매매·송금·전환 경로를 계산해 받는 수량 순으로 보여 줍니다.
값은 참고용 추정치이며 실제 체결 결과와 다를 수 있습니다.

## 구성

- `site/` — 페이지. 빌드 없이 `index.html`이 `engine.js` → `common.js` → `trade.js` 순서로 읽습니다.
  가격·호가·견적은 방문자 브라우저가 각 거래소와 BSC 노드에서 직접 받습니다.
- `src/` — 브라우저가 직접 받을 수 없는 값(LBank 봉·출금비, GeckoTerminal 봉, 유니스왑 풀 목록)을 받아 `site/data/`에 쓰는 스크립트와 점검 스크립트.
- `.github/workflows/pages.yml` — `main`에 올릴 때와 5분마다 위 스크립트를 돌리고 페이지를 배포합니다.

개인키나 거래소 API 키를 쓰지 않고, 주문을 내지 않습니다.

## 로컬에서 보기

```bash
python -m http.server 8765 --directory site
```

`http://localhost:8765/`에서 볼 수 있습니다. `site/data/`가 비어 있으면 그래프의 LBank 선 등 일부 값이 빠집니다.

```bash
npm test
```

## 문의

Skippy0813g@gmail.com
