# 네이버 뉴스 키워드 대시보드 — 설계서 (GitHub 완전 클라우드 버전)

## 1. 작업 컨텍스트

### 배경
매일 네이버 뉴스를 수동으로 검색해 관심 키워드별로 훑어보는 대신, 지정한 키워드마다 자동으로 뉴스를 모아 분류해 보여주는 대시보드가 필요하다. 로컬 PC 구동 여부와 무관하게, 어디서든(폰 포함) URL로 접속해 볼 수 있어야 한다.

### 목적
- 등록한 키워드별로 네이버 뉴스를 매일 자동 수집·분류해서 GitHub Pages에 호스팅된 대시보드에서 확인한다.
- 대시보드에서 새 키워드를 직접 추가할 수 있다.
- "업데이트" 버튼으로 원할 때 즉시(GitHub Actions를 통해) 최신 뉴스를 다시 수집한다.

### 목표와 성공 기준
- 매일 정해진 시각(UTC 기준 cron, 예: 07:00 KST = 전날 22:00 UTC)에 GitHub Actions가 자동으로 모든 키워드의 뉴스를 수집해 저장소에 커밋한다 — 로컬 PC 전원 상태와 무관하게 동작한다.
- `https://{username}.github.io/{repo}/` 접속 시 키워드별로 분류된 뉴스 목록(제목/링크/게시시각)이 보인다.
- 새 키워드를 추가하면(본인 GitHub 토큰 입력 후) 목록에 반영되고, 그 키워드의 뉴스가 즉시 1회 수집된다.
- "업데이트" 버튼을 누르면 GitHub Actions 실행이 트리거되고, 완료 후(대략 수십 초~1-2분) 대시보드가 최신 결과로 갱신된다.
- 마지막 업데이트 시각/상태가 화면에 표시된다.

### 범위
**포함**
- 키워드 목록 조회·추가 (GitHub 토큰으로 인증된 본인만 가능)
- 키워드별 네이버 뉴스 자동(매일 1회, cron) + 수동(버튼, workflow_dispatch) 수집
- GitHub Pages에 호스팅되는, 키워드별로 분류된 뉴스 대시보드 (읽기는 누구나 가능 — public repo)
- 마지막 업데이트 시각/상태 표시, 진행 중 상태 폴링

**제외 (이번 설계 범위 아님, 5절 "향후 확장" 참고)**
- 키워드 삭제·수정
- LLM 기반 관련도 판단, 요약, 중복 클러스터링
- 다중 사용자별 별도 키워드 셋, 이메일/슬랙 알림
- 과거 뉴스 대량 백필 (Naver API 특성상 최신 뉴스 위주만 가능)
- 비인가 방문자도 쓸 수 있는 "업데이트/키워드추가" (읽기는 공개, 쓰기는 본인 토큰 필요 — 의도된 설계)

### 입출력 정의
- **입력**: 사용자가 등록한 키워드(문자열), 네이버 뉴스 검색 API 응답(JSON), Worker 호출용 앱 시크릿(브라우저에만 저장 — 2026-07-14부터 GitHub PAT는 브라우저에 저장하지 않음, 7절 참고)
- **출력**: GitHub Pages 대시보드 화면(HTML), 저장소에 커밋되는 데이터 파일(`data/keywords.json`, `data/news.json`)

### 제약조건
- 저장소가 **public** → 코드와 수집된 뉴스 데이터(키워드 목록 포함)가 누구나 볼 수 있음 (사용자가 명시적으로 허용)
- 네이버 `Client ID/Secret`은 **GitHub Actions Secrets로만 저장**, 코드/커밋에 절대 포함 금지 (public repo이므로 특히 중요)
- 네이버 API는 **반드시 Actions 러너 안에서만 호출** — 정적 페이지(브라우저)에서 직접 호출 불가 (Secret 노출 방지, 또한 Naver API는 브라우저 CORS를 허용하지 않음)
- "업데이트"/"키워드 추가"/"키워드 삭제"는 Cloudflare Worker를 거쳐 동작하며, 브라우저에는 Worker URL과 앱 시크릿(`X-App-Secret`)만 있으면 된다 — GitHub PAT는 브라우저에 저장하지 않는다(7절 참고). 앱 시크릿이 없는 방문자는 읽기만 가능
- 응답 속도: workflow_dispatch 트리거 후 실제 반영까지 **수십 초~1-2분** 소요(Actions 러너 대기열 + 실행 시간) — 로컬 서버 대비 명확히 느림
- GitHub Actions 스케줄은 UTC 기준이며, 저장소가 60일 이상 비활동이면 자동 비활성화될 수 있음(개인용으로 꾸준히 쓰면 해당 없음)
- 네이버 오픈API 일 25,000회 호출 제한, 1회 최대 100건 — 개인 사용 범위에서 여유 있음

### 용어 정의
| 용어 | 정의 |
|---|---|
| 키워드 | 사용자가 등록한 검색어이자 대시보드의 분류 카테고리 |
| 기사 | 네이버 뉴스 검색 API가 반환하는 개별 뉴스 항목 |
| 수집(업데이트) | 키워드별 API 호출 → 매칭 필터 → 데이터 파일 커밋까지의 전체 과정 |
| 매칭 | 정제된 기사 제목/요약에 키워드 문자열이 포함되는지 확인하는 필터(대소문자 무시) |
| PAT | Personal Access Token. 이 저장소에 한정된 권한(fine-grained)을 가진 개인 GitHub 인증 토큰, 브라우저에만 저장 |
| workflow_dispatch | GitHub Actions 워크플로를 API/UI로 수동 트리거하는 이벤트 |
| 실시간 | "버튼 클릭 시 GitHub Actions를 트리거해 최신 뉴스를 다시 수집·반영"을 의미. 즉시(1-2초)가 아니라 수십 초~1-2분 내 반영을 뜻함 |

---

## 2. 워크플로우 정의

### 트리거 (2종, 모두 GitHub Actions)
1. **스케줄(cron)** — 매일 지정 UTC 시각에 자동 실행 (`update-news.yml`)
2. **수동(workflow_dispatch)** — 대시보드의 "업데이트" 버튼(전체 키워드 재수집) 또는 "키워드 추가" 폼(신규 키워드 1건 추가 + 즉시 수집)이 GitHub REST API를 통해 트리거

### 상태 전이
`idle → queued → in_progress → (success | partial_fail | fail) → idle`
프론트엔드는 GitHub Actions API로 최근 실행(run)의 상태를 폴링해 버튼에 진행 상태를 표시한다.

### 분기 조건
- 키워드별 API 호출 실패: 1회 자동 재시도 → 그래도 실패면 해당 키워드만 건너뛰고 나머지는 계속 진행, 실행 로그에 기록
- 데이터 파일 커밋 중 push 충돌(동시 실행 등): `pull --rebase` 후 1회 재시도 → 그래도 실패하면 워크플로 실패로 표시(에스컬레이션: 사용자가 Actions 탭에서 직접 확인)
- 방문자가 PAT 없이 "업데이트"/"키워드 추가" 시도: 요청 자체를 프론트에서 막고 "GitHub 토큰이 필요합니다" 안내

### 단계별 상세

| 단계 | 처리 주체 | 성공 기준 | 검증 방법 | 실패 시 처리 |
|---|---|---|---|---|
| ① 트리거 | GitHub(코드) | cron 시각 도달 또는 workflow_dispatch 수신 | 규칙 기반 | 해당 없음 |
| ② 키워드별 네이버 API 호출 | 코드(Actions 러너) | HTTP 200 + `items` 배열 존재 | 스키마 검증 | 1회 자동 재시도 → 실패 시 해당 키워드 skip+log, 나머지 계속 |
| ③ 정제·매칭 필터 | 코드 | HTML 태그 제거 후 키워드 포함 확인 | 규칙 기반 | 미매칭 기사는 정상 제외, 필드 누락 기사는 skip+log |
| ④ 데이터 파일 갱신 | 코드 | `keywords.json`/`news.json`이 유효 JSON으로 쓰기 성공 | 스키마 검증(쓰기 후 재파싱) | 실패 시 커밋 중단, 이전 상태 유지 |
| ⑤ 커밋·푸시 | 코드 | `git push` 성공 | 규칙 기반(exit code) | 충돌 시 rebase 후 1회 재시도 → 실패 시 워크플로 실패 표시 |
| ⑥ Pages 배포 | 코드 | `site/` 폴더 변경 시에만 재배포 | 규칙 기반 | 실패 시 Actions 탭에 에러 표시(에스컬레이션) |
| ⑦ 프론트 반영 확인 | 코드+사람 | 프론트가 최신 커밋의 데이터를 읽어 재렌더 | 사람 검토(화면 확인) | 지연 시 폴링이 자동 재확인, 최종적으로 사용자가 새로고침 가능 |

### LLM 판단 영역 vs 코드 처리 영역
분류(단순 키워드 매칭)와 수집·저장 로직은 여전히 100% 코드로 처리되며, **런타임에 LLM 판단이 필요한 단계는 없다.** GitHub Actions 러너 안에서 Node.js 스크립트가 전 과정을 처리한다. Claude Code는 최초 구현과 향후 유지보수에만 관여한다. 향후 관련도 재평가나 일일 브리핑 요약이 필요해지면 ③ 단계 뒤에 선택적 LLM 단계를 Actions 워크플로에 추가할 수 있다 (5절 참고, 이번 범위 아님).

---

## 3. 구현 스펙

### 폴더 구조
```
/네이버 뉴스 대시보드           (로컬 작업 사본 — GitHub 저장소로 push됨)
  ├── CLAUDE.md                   # (구현 단계에서 작성) 프로젝트 온보딩 문서
  ├── package.json
  ├── .gitignore
  ├── .github/
  │   └── workflows/
  │       ├── update-news.yml     # cron(매일) + workflow_dispatch(버튼) → 전체 키워드 재수집
  │       ├── add-keyword.yml     # workflow_dispatch(input: keyword) → 키워드 추가 + 해당 키워드만 즉시 수집
  │       └── deploy-pages.yml    # site/** 변경 시 GitHub Pages 배포
  ├── scripts/                    # Actions 러너 안에서 실행되는 Node 스크립트
  │   ├── naverClient.js          # 네이버 검색 API 호출 래퍼(재시도 포함)
  │   ├── classify.js             # HTML 정제 + 키워드 매칭 필터
  │   ├── dataStore.js            # keywords.json/news.json 읽기·쓰기
  │   ├── runUpdate.js            # 전체 키워드 수집 CLI 진입점 (update-news.yml이 호출)
  │   └── addKeyword.js           # 키워드 추가 + 단건 수집 CLI 진입점 (add-keyword.yml이 호출)
  ├── site/                       # GitHub Pages로 배포되는 정적 프론트엔드
  │   ├── index.html
  │   ├── app.js                  # PAT 입력/저장, 데이터 fetch·렌더, 버튼 → workflow_dispatch 호출, 진행상태 폴링
  │   └── style.css
  ├── data/
  │   ├── keywords.json           # Actions가 커밋하는 소스 오브 트루스
  │   └── news.json
  └── docs/
      └── design.md               # 이 설계서
```

### 데이터 모델
`data/keywords.json`
```json
[ { "id": "짧은 슬러그/해시", "keyword": "인공지능", "createdAt": "ISO8601" } ]
```
`data/news.json`
```json
{
  "articles": {
    "<url의 해시>": {
      "url": "...", "title": "정제된 제목", "description": "정제된 요약",
      "pubDate": "ISO8601", "fetchedAt": "ISO8601",
      "matchedKeywords": ["인공지능", "반도체"]
    }
  },
  "meta": {
    "lastUpdateAt": "ISO8601", "lastUpdateStatus": "success|partial_fail|fail",
    "lastUpdateErrors": [{ "keyword": "...", "error": "..." }]
  }
}
```
같은 URL이 여러 키워드에 매칭되면 한 번만 저장되고 `matchedKeywords`에 누적된다. 대시보드의 "오늘 뉴스"는 `pubDate` 기준 당일 기사만 필터링해서 보여주고, 과거 기록은 전체보기 토글로 조회한다.

### 프론트엔드 ↔ GitHub 연동 방식
| 동작 | 방식 |
|---|---|
| 뉴스 데이터 읽기 | `raw.githubusercontent.com/{owner}/{repo}/main/data/news.json` (또는 Contents API)를 직접 fetch — Pages 재배포를 기다리지 않고 커밋 즉시 최신 데이터 반영 |
| Worker 연결 정보 등록 | 대시보드 최초 접속 시 설정 화면에서 Worker URL·앱 시크릿 입력 → `localStorage`에 저장(본인 브라우저에만 존재, 코드에는 절대 포함 안 됨). GitHub PAT는 더 이상 입력받지 않음(2026-07-14 변경, 7절 참고) |
| "업데이트" 버튼 | Cloudflare Worker로 `{ action: 'update' }` POST → Worker가 자체 GITHUB_TOKEN으로 `workflow_dispatch` 호출 |
| "키워드 추가" | Cloudflare Worker로 `{ action: 'add', keyword }` POST — 상세는 5절 "키워드 추가 즉시응답화" 참고 (2026-07-12 변경) |
| "키워드 삭제" | Cloudflare Worker로 `{ action: 'delete', keyword }` POST → Worker가 `data/keywords.json`에서 제거 후 커밋 |
| 진행 상태 표시("업데이트"만 해당) | `GET /repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=1`을 몇 초 간격으로 폴링해 상태를 버튼에 반영(공개 저장소 읽기라 인증 불필요), 완료되면 뉴스 데이터 재fetch |

### CLAUDE.md 핵심 섹션 목록 (구현 단계에서 작성, 지금은 목차만)
- 프로젝트 개요, 아키텍처 요약(Actions+Pages, 로컬 서버 없음)
- 로컬 개발/테스트 방법 (`scripts/*.js`를 로컬에서 직접 실행해보는 법)
- GitHub 저장소 설정 방법 (Secrets, Pages 소스 설정)
- 데이터 모델 요약
- 네이버 API 사용 규칙(레이트리밋, Secrets 보관 위치)
- PAT 발급·권한 범위 안내
- 향후 확장 메모

### 에이전트 구조
- **런타임**: 에이전트 없음 — GitHub Actions 위의 순수 스크립트 파이프라인 (2절 참고)
- **빌드/유지보수**: Claude Code 단일 에이전트. 워크플로우가 단순하고 지침이 짧아 서브에이전트 분리는 불필요.

### 하네스 스펙 적용 여부
`[RaiN] 에이전트 가이드 지침서.md`의 풀 하네스(자동 게이트/훅, 파이프라인 상태 파일, 환각 차단, 워크트리 격리)는 **이번 프로젝트에는 적용하지 않는다.** 근거:
1. 런타임에 LLM 판단·생성 단계가 없어 환각 차단·LLM 자기검증 게이트를 적용할 대상이 없음
2. GitHub Actions의 실행 로그와 git 커밋 히스토리 자체가 "파이프라인 상태 기록" 역할을 상당 부분 대신함(별도 `_pipeline_state.json` 불필요)
3. 병렬 서브에이전트나 대규모 동시 편집이 없어 워크트리 격리가 불필요

대신 기본형(`프롬프트.txt`) 구조 — 작업 컨텍스트 / 워크플로우 정의 / 구현 스펙 — 을 충실히 채우는 것으로 충분하다고 판단했다. 이견이 있으면 리뷰 시 하네스 적용으로 전환 가능하다.

### 보안 유의사항 (구현 시 반드시 반영)
- 뉴스 제목/요약은 외부(네이버) 입력이므로 프론트엔드 렌더링 시 `innerHTML`이 아닌 `textContent`로 삽입해 XSS를 방지한다.
- `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`은 GitHub Actions Secrets에만 저장한다.
- GitHub PAT(`GITHUB_TOKEN`)는 fine-grained 토큰으로 발급하고 권한을 이 저장소의 `Contents: Read/Write`, `Actions: Read/Write`로만 제한하며, **Cloudflare Worker secret으로만 보관한다 — 브라우저에는 절대 저장하지 않는다**(7절 참고).

---

## 4. 사전 준비 (구현 착수 전 사용자가 할 일)
1. https://developers.naver.com 에서 애플리케이션 등록(사용 API: 검색) → Client ID/Secret 발급
2. GitHub에 새 저장소 생성 (public, 예: `naver-news-dashboard`)
3. 저장소 Settings → Secrets and variables → Actions에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 등록
4. 저장소 Settings → Pages에서 Source를 "GitHub Actions"로 설정
5. GitHub에서 fine-grained PAT 발급 (대상 저장소 한정, `Contents`·`Actions` Read/Write 권한) → 대시보드 최초 접속 시 입력

---

## 5. 키워드 추가 즉시응답화 (2026-07-12 변경)

원래 설계에서는 "키워드 추가"도 "업데이트"와 동일하게 GitHub Actions `workflow_dispatch`를 거쳤기 때문에 결과 반영까지 수십 초~1-2분이 걸렸다. 사용자가 "검색 결과는 즉시 보여주고 저장은 나중에 처리"하는 방식으로 변경을 요청해 아래와 같이 바뀌었다.

### 새 흐름
```
사용자가 키워드 입력
   ↓
브라우저 → Cloudflare Worker로 POST (X-App-Secret 헤더로 인증)
   ↓
Worker가 네이버 API 즉시 호출 → 정제·매칭(단순 키워드 매칭, 기존과 동일 로직)
   ↓
Worker가 결과를 바로 HTTP 응답으로 반환 (수 초)
   ↓
브라우저가 응답을 로컬 state에 반영해 즉시 화면 표시
   ↓
(응답과 무관하게) Worker가 ctx.waitUntil()로 GitHub Contents API 호출을 계속 진행
   → data/keywords.json, data/news.json에 커밋 (백그라운드, 사용자는 기다리지 않음)
```

### 왜 서버리스 함수가 필요한가
브라우저에서 네이버 API를 직접 호출할 수 없다 (CORS 미허용 + Client Secret 노출 위험). 즉시 응답을 원한다면 그 호출을 대신해줄 서버가 필요한데, GitHub Actions는 "즉시성"과 안 맞고(대기열+수십 초 단위) GitHub Pages는 정적 호스팅이라 서버 코드를 못 돌린다. 그래서 별도의 경량 서버리스 함수(Cloudflare Worker)를 추가했다. 마찬가지 이유로 GitHub에 쓰기(커밋)하는 토큰도 브라우저가 아니라 Worker가 시크릿으로 보관한다 — 응답 이후 background로 계속 실행하는 패턴은 Cloudflare Workers의 `ctx.waitUntil()`이 가장 깔끔하게 지원한다.

### 영향받은 범위
- "업데이트"(전체 키워드 재수집) 버튼은 이 시점에는 변경 없음 — 여전히 GitHub Actions `workflow_dispatch` + 브라우저 PAT 방식. 키워드가 많아지면 순차 호출이 오래 걸릴 수 있어 서버리스 함수 타임아웃보다 Actions가 안전하다는 판단(트리거 자체를 Worker가 대신 호출하도록 바뀐 건 이후 7절 변경).
- 일일 자동 수집(cron)도 **변경 없음** — `update-news.yml` 그대로.
- 기존 `add-keyword.yml` 워크플로와 `scripts/addKeyword.js`는 Worker로 완전히 대체되어 삭제했다.

### 구현 스펙 추가
```
/worker
  ├── src/index.js     # Cloudflare Worker 본체 (네이버 검색 + GitHub 백그라운드 저장, 단일 파일)
  └── wrangler.toml     # Wrangler 설정 (시크릿 값은 여기 넣지 않고 별도 등록)
```
- Worker가 보관하는 시크릿: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GITHUB_TOKEN`(Contents Read/Write — 이후 7절 변경으로 Actions Read/Write까지 확장됨), `APP_SHARED_SECRET`
- 변수: `GITHUB_OWNER`, `GITHUB_REPO`
- 프론트엔드는 설정(⚙) 패널에 Worker URL과 `APP_SHARED_SECRET`을 추가로 입력받아 localStorage에 저장하고, 요청 시 `X-App-Secret` 헤더로 실어 보낸다 — Worker 엔드포인트가 공개 URL이라도 이 값이 없으면 401로 거부되어 무단 호출(네이버 쿼터 소진, 임의 커밋)을 막는다.
- 병합 규칙(같은 URL은 한 번만 저장, `matchedKeywords`에 누적)은 `scripts/dataStore.js`의 `mergeArticles`와 동일하게 Worker 안에 재구현했다 (Workers 런타임에서 Node 전용 모듈은 쓸 수 없어 로직을 복제함).
- 실패 처리: Worker의 GitHub 저장이 실패해도(예: 커밋 충돌) 키워드 자체 저장과 기사 저장은 각각 독립적인 커밋이라 부분 실패가 가능 — 어느 쪽이 실패하든 다음 날 정기 수집(cron)이 다시 시도하므로 데이터 유실로 이어지지 않는다.

---

## 6. 향후 확장 아이디어 (이번 범위 아님)
- LLM 기반 관련도 필터링, 일일 브리핑 요약 (Actions 워크플로에 선택적 단계 추가)
- 키워드 수정 UI (삭제는 구현됨, 7절 참고)
- 다중 사용자별 키워드 셋 분리, 이메일/슬랙 알림 연동

---

## 7. 브라우저 PAT 제거 — 모든 쓰기 동작을 Worker로 일원화 (2026-07-14 변경)

### 배경
다른 브라우저에서 대시보드를 열 때마다 GitHub PAT를 다시 입력해야 하는 게 불편하다는 요청이 있었다. PAT는 fine-grained라도 이 저장소에 `Contents: Read/Write` 권한을 가지므로, 유출 시 `.github/workflows/*.yml`을 고쳐 Actions Secrets(네이버 API 키)를 빼돌리거나 공개 사이트에 악성 스크립트를 심는 것도 이론상 가능하다 — 그런 값을 "기억하기 쉬운 짧은 비밀번호"로 암호화해 공개 저장소에 저장하는 방식은 오프라인 무차별 대입에 취약해 채택하지 않았다.

### 새 흐름
"업데이트"(전체 재수집)와 "키워드 삭제"도 "키워드 추가"와 동일하게 Cloudflare Worker를 거치도록 통합했다. Worker가 자체 보관한 `GITHUB_TOKEN`으로 GitHub API를 대신 호출하므로, 브라우저는 어떤 GitHub 토큰도 저장할 필요가 없다.

```
브라우저 → Worker로 POST { action: 'update' | 'add' | 'delete', ... } (X-App-Secret 헤더로 인증)
   ↓
Worker가 action에 따라 분기:
  - update: GitHub workflow_dispatch(update-news.yml) 호출
  - add   : 네이버 API 즉시 호출 + 백그라운드 커밋 (기존과 동일, 5절 참고)
  - delete: data/keywords.json에서 키워드 제거 후 커밋
```

### 브라우저에 남는 값
- Worker URL — 비밀값 아님(엔드포인트 주소일 뿐)
- 앱 시크릿(`X-App-Secret`) — Worker의 `APP_SHARED_SECRET`과 동일한 값. **기억하기 쉬운 값으로 정해도 된다.** 유출되더라도 공격자가 할 수 있는 일은 Worker가 노출한 세 가지 동작(추가/삭제/업데이트 트리거)으로 한정되며, GitHub API에 대한 임의 접근(파일 임의 수정, 워크플로 변조, 시크릿 탈취)은 불가능하다 — GitHub PAT 유출과는 위험 등급이 다르다.

### 영향받은 범위
- Worker의 `GITHUB_TOKEN` 권한이 `Contents: Read/Write`에서 **`Contents: Read/Write` + `Actions: Read/Write`로 확장**되어야 한다("업데이트" 트리거를 대신 호출하려면 Actions 권한이 필요).
- `site/app.js`에서 PAT 관련 코드(`getPat`, `authHeaders`의 Authorization 로직, GitHub API 직접 호출을 통한 `dispatchWorkflow`/`deleteKeywordRemote`)를 모두 제거하고 Worker 호출(`callWorker`)로 대체했다.
- `site/index.html` 설정 패널에서 PAT 입력 필드를 제거했다.
- 진행 상태 폴링(`GET .../runs`)은 공개 저장소의 읽기 전용 엔드포인트라 인증 없이 그대로 유지된다.
