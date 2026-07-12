# 네이버 뉴스 키워드 대시보드

## 프로젝트 개요
등록한 키워드별로 네이버 뉴스를 매일 자동 수집·분류해 보여주는 대시보드. 설계서: [docs/design.md](docs/design.md)

## 아키텍처 요약
- **런타임 서버 없음.** GitHub Actions/Pages + Cloudflare Worker(서버리스) 조합으로 동작한다.
- **일일 자동 수집 + "업데이트" 버튼**: GitHub Actions(`update-news.yml`)가 Node 스크립트(`scripts/`)로 전체 키워드에 대해 네이버 검색 API를 순회 호출하고, 결과를 `data/keywords.json` / `data/news.json`에 커밋한다. 브라우저는 저장된 fine-grained PAT로 `workflow_dispatch`를 호출해 트리거하며, 응답까지 수십 초~1-2분 걸린다.
- **"키워드 추가" 버튼**: Cloudflare Worker(`worker/src/index.js`)가 처리한다. 키워드를 받아 네이버 API를 즉시 호출해 결과를 바로 응답하고(수 초), `ctx.waitUntil()`로 응답 이후 백그라운드에서 GitHub Contents API를 통해 `data/keywords.json`·`data/news.json`에 커밋한다. Worker는 자체 GitHub 토큰을 시크릿으로 보관하므로 이 흐름에는 브라우저 PAT가 필요 없다. 대신 Worker 호출 자체는 `X-App-Secret` 헤더(브라우저 localStorage에 저장)로 보호한다.
- **화면**: `site/`의 정적 HTML/CSS/JS를 GitHub Pages(`deploy-pages.yml`)가 배포한다. 프론트엔드는 `raw.githubusercontent.com`에서 데이터 JSON을 직접 fetch하므로 Pages 재배포를 기다리지 않고 커밋 즉시 최신 데이터가 반영된다. "키워드 추가"는 Worker 응답을 받은 즉시 로컬 상태에 반영해 화면에 보여주므로 그마저도 기다리지 않는다.
- 런타임에 LLM 판단 단계는 없다 — 분류는 단순 키워드 문자열 매칭(스크립트 100%, `update-news.yml`과 Worker 양쪽에 동일 로직 중복 구현됨). 자세한 내용은 [docs/design.md](docs/design.md) 참고.

## 로컬 개발/테스트 방법
`scripts/*.js`는 Actions 러너와 동일하게 로컬에서도 바로 실행할 수 있다 (Node 18+, 별도 의존성 없음).

```bash
# .env는 만들지 말고 그때그때 환경변수로 넘긴다 (커밋 방지)
NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy node scripts/runUpdate.js
```

`worker/src/index.js`는 Cloudflare Workers 런타임(Web Crypto, 표준 fetch) 전용이라 Node로 직접 실행할 수 없다. Wrangler CLI(`wrangler dev`)로 로컬 테스트하거나 Cloudflare 대시보드의 Quick Edit으로 배포 전 미리보기한다.

`site/`는 정적 파일이라 아무 정적 서버로 열어봐도 되지만, `raw.githubusercontent.com` 기반 데이터 fetch와 GitHub API 호출은 실제 GitHub Pages 배포 후에만 (또는 설정 패널에 Owner/Repo/PAT을 수동 입력하면) 정상 동작한다.

## GitHub 저장소 설정 방법
1. 저장소 Settings → **Secrets and variables → Actions**에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 등록
2. 저장소 Settings → **Pages** → Source를 **GitHub Actions**로 설정
3. main 브랜치에 처음 push하면 `deploy-pages.yml`이 `site/`를 배포한다

## Cloudflare Worker 설정 방법
1. Cloudflare 대시보드 → Workers & Pages → Create → `worker/src/index.js` 내용을 붙여넣어 배포 (또는 Wrangler CLI로 `wrangler deploy`)
2. Settings → Variables and Secrets에 등록:
   - `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (secret)
   - `GITHUB_TOKEN` (secret) — 이 저장소의 **Contents: Read/Write** 권한만 가진 별도의 fine-grained PAT (브라우저용 PAT와는 다른, Worker 전용 토큰)
   - `APP_SHARED_SECRET` (secret) — 임의의 긴 랜덤 문자열, 대시보드 설정 패널의 "앱 시크릿"과 동일해야 함
   - `GITHUB_OWNER`, `GITHUB_REPO` (variable)
3. 배포된 Worker URL을 대시보드 설정(⚙) 패널의 "Worker URL"에 입력

## 데이터 모델 요약
- `data/keywords.json`: `[{ id, keyword, createdAt }]`
- `data/news.json`: `{ articles: { [urlHash]: { url, title, description, pubDate, fetchedAt, matchedKeywords[] } }, meta: { lastUpdateAt, lastUpdateStatus, lastUpdateErrors[] } }`
- 같은 URL이 여러 키워드에 매칭되면 한 번만 저장되고 `matchedKeywords`에 누적된다.

## 네이버 API 사용 규칙
- 엔드포인트: `https://openapi.naver.com/v1/search/news.json` (`X-Naver-Client-Id` / `X-Naver-Client-Secret` 헤더)
- 일 25,000회 호출 제한, 1회 최대 100건 — 개인 사용 범위에서는 여유 있음
- Client ID/Secret은 **절대 코드/커밋에 포함하지 않는다.** GitHub Actions Secrets 또는 Cloudflare Worker Secrets로만 주입한다 (이 저장소는 public).

## PAT 발급·권한 범위 안내
두 종류의 GitHub 토큰이 쓰인다 — 서로 다른 용도이므로 섞어 쓰지 않는다.

| 용도 | 저장 위치 | 권한 |
|---|---|---|
| "업데이트" 버튼 (`workflow_dispatch` 트리거) | 브라우저 localStorage (대시보드 설정 ⚙ 패널) | Contents = Read/write, **Actions = Read/write** |
| Worker의 백그라운드 GitHub 저장 | Cloudflare Worker Secret(`GITHUB_TOKEN`) | Contents = Read/write 만 있으면 됨 (Actions 권한 불필요) |

둘 다 github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → **Repository access: 이 저장소만 선택**해서 발급한다.

## 향후 확장 메모
- LLM 기반 관련도 필터링/일일 브리핑 요약 (Actions 워크플로에 선택적 단계 추가)
- 키워드 삭제·수정 UI
- PAT 대신 GitHub App/OAuth 로그인 방식으로 전환(보안 강화)
- 다중 사용자별 키워드 셋 분리, 이메일/슬랙 알림 연동
