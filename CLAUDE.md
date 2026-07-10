# 네이버 뉴스 키워드 대시보드

## 프로젝트 개요
등록한 키워드별로 네이버 뉴스를 매일 자동 수집·분류해 보여주는 대시보드. 설계서: [docs/design.md](docs/design.md)

## 아키텍처 요약
- **런타임 서버 없음.** 전부 GitHub 생태계 위에서 동작한다.
- **수집**: GitHub Actions(`update-news.yml`, `add-keyword.yml`)가 Node 스크립트(`scripts/`)로 네이버 검색 API를 호출하고, 결과를 `data/keywords.json` / `data/news.json`에 커밋한다.
- **화면**: `site/`의 정적 HTML/CSS/JS를 GitHub Pages(`deploy-pages.yml`)가 배포한다. 프론트엔드는 `raw.githubusercontent.com`에서 데이터 JSON을 직접 fetch하므로 Pages 재배포를 기다리지 않고 커밋 즉시 최신 데이터가 반영된다.
- **인증**: "업데이트"/"키워드 추가" 버튼은 사용자가 브라우저에 저장해 둔 GitHub fine-grained PAT로 `workflow_dispatch`를 호출한다. 읽기(대시보드 열람)는 누구나 가능하지만 쓰기(업데이트/키워드추가)는 PAT 보유자만 가능하다.
- 런타임에 LLM 판단 단계는 없다 — 분류는 단순 키워드 문자열 매칭(스크립트 100%). 자세한 내용은 [docs/design.md](docs/design.md) 참고.

## 로컬 개발/테스트 방법
`scripts/*.js`는 Actions 러너와 동일하게 로컬에서도 바로 실행할 수 있다 (Node 18+, 별도 의존성 없음).

```bash
# .env는 만들지 말고 그때그때 환경변수로 넘긴다 (커밋 방지)
NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy node scripts/runUpdate.js
NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy node scripts/addKeyword.js "테스트키워드"
```

`site/`는 정적 파일이라 아무 정적 서버로 열어봐도 되지만, `raw.githubusercontent.com` 기반 데이터 fetch와 GitHub API 호출은 실제 GitHub Pages 배포 후에만 (또는 설정 패널에 Owner/Repo/PAT을 수동 입력하면) 정상 동작한다.

## GitHub 저장소 설정 방법
1. 저장소 Settings → **Secrets and variables → Actions**에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 등록
2. 저장소 Settings → **Pages** → Source를 **GitHub Actions**로 설정
3. main 브랜치에 처음 push하면 `deploy-pages.yml`이 `site/`를 배포한다

## 데이터 모델 요약
- `data/keywords.json`: `[{ id, keyword, createdAt }]`
- `data/news.json`: `{ articles: { [urlHash]: { url, title, description, pubDate, fetchedAt, matchedKeywords[] } }, meta: { lastUpdateAt, lastUpdateStatus, lastUpdateErrors[] } }`
- 같은 URL이 여러 키워드에 매칭되면 한 번만 저장되고 `matchedKeywords`에 누적된다.

## 네이버 API 사용 규칙
- 엔드포인트: `https://openapi.naver.com/v1/search/news.json` (`X-Naver-Client-Id` / `X-Naver-Client-Secret` 헤더)
- 일 25,000회 호출 제한, 1회 최대 100건 — 개인 사용 범위에서는 여유 있음
- Client ID/Secret은 **절대 코드/커밋에 포함하지 않는다.** GitHub Actions Secrets로만 주입한다 (이 저장소는 public).

## PAT 발급·권한 범위 안내
- github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- **Repository access**: 이 저장소만 선택
- **Permissions**: Contents = Read and write, Actions = Read and write
- 발급된 토큰은 대시보드의 설정(⚙) 패널에 입력 → 이 브라우저의 localStorage에만 저장됨

## 향후 확장 메모
- LLM 기반 관련도 필터링/일일 브리핑 요약 (Actions 워크플로에 선택적 단계 추가)
- 키워드 삭제·수정 UI
- PAT 대신 GitHub App/OAuth 로그인 방식으로 전환(보안 강화)
- 다중 사용자별 키워드 셋 분리, 이메일/슬랙 알림 연동
