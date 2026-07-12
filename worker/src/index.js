// Cloudflare Worker: 키워드를 받아 네이버 뉴스를 즉시 검색해 응답하고,
// GitHub 저장(commit)은 waitUntil()로 응답 이후 백그라운드에서 계속 진행한다.
//
// 필요한 값 (Cloudflare 대시보드 → Settings → Variables and Secrets):
//   NAVER_CLIENT_ID       (secret)
//   NAVER_CLIENT_SECRET   (secret)
//   GITHUB_TOKEN          (secret)  — 이 저장소의 Contents: Read/Write 권한을 가진 fine-grained PAT
//   GITHUB_OWNER          (variable, 예: ashram7)
//   GITHUB_REPO           (variable, 예: stock)
//   APP_SHARED_SECRET     (secret)  — 대시보드 설정 패널에 입력하는 값과 동일해야 함(무단 호출 방지)

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }
    if (request.method !== 'POST') {
      return withCors(jsonResponse({ error: 'POST만 지원합니다' }, 405));
    }

    const providedSecret = request.headers.get('X-App-Secret') || '';
    if (!env.APP_SHARED_SECRET || providedSecret !== env.APP_SHARED_SECRET) {
      return withCors(jsonResponse({ error: '인증되지 않은 요청입니다' }, 401));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(jsonResponse({ error: '잘못된 요청 본문입니다' }, 400));
    }
    if (!body || typeof body !== 'object') body = {};

    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    if (!keyword) return withCors(jsonResponse({ error: '키워드가 필요합니다' }, 400));
    if (keyword.length > 50) return withCors(jsonResponse({ error: '키워드가 너무 깁니다 (최대 50자)' }, 400));

    let items;
    try {
      items = await searchNaverNews(keyword, env);
    } catch (err) {
      return withCors(jsonResponse({ error: `네이버 API 호출 실패: ${err.message}` }, 502));
    }

    const articles = filterAndClean(items, keyword);

    // 응답은 여기서 바로 반환하고, 실제 GitHub 커밋은 응답 이후 백그라운드에서 계속한다.
    ctx.waitUntil(
      persistToGitHub(keyword, articles, env).catch((err) => {
        console.error(`백그라운드 저장 실패 [${keyword}]: ${err.message}`);
      })
    );

    return withCors(jsonResponse({ keyword, articles }));
  }
};

function withCors(res) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  return new Response(res.body, { status: res.status, headers });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// ---------- 네이버 검색 (scripts/naverClient.js와 동일 로직) ----------

async function searchNaverNews(keyword, env, retries = 1) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(keyword)}&display=20&sort=date`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET
        }
      });
      if (!res.ok) throw new Error(`Naver API HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.items)) throw new Error('Naver API 응답에 items 배열이 없습니다');
      return data.items;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastErr;
}

// ---------- 정제·매칭 (scripts/classify.js와 동일 로직) ----------

const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' '
};

function decodeEntities(str) {
  return str.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;|&#(\d+);/g, (match, dec) => {
    if (dec) return String.fromCharCode(parseInt(dec, 10));
    return ENTITY_MAP[match];
  });
}

function stripTags(str) {
  return str.replace(/<\/?[^>]+>/g, '');
}

function cleanText(raw) {
  if (!raw) return '';
  return decodeEntities(stripTags(raw)).trim();
}

function matchesKeyword(article, keyword) {
  const haystack = `${article.title} ${article.description}`.toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

function filterAndClean(items, keyword) {
  const results = [];
  for (const item of items || []) {
    const title = cleanText(item.title);
    const description = cleanText(item.description);
    if (!title || !item.link) continue;
    if (!matchesKeyword({ title, description }, keyword)) continue;
    results.push({ url: item.link, title, description, pubDate: item.pubDate || null });
  }
  return results;
}

// ---------- GitHub 백그라운드 저장 ----------

async function ghGetFile(path, env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=main`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'naver-news-worker',
        Accept: 'application/vnd.github+json'
      }
    }
  );
  if (!res.ok) throw new Error(`${path} 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return { json: JSON.parse(decodeBase64Utf8(data.content)), sha: data.sha };
}

async function ghPutFile(path, jsonValue, sha, message, env) {
  const content = encodeBase64Utf8(`${JSON.stringify(jsonValue, null, 2)}\n`);
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'naver-news-worker',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, content, sha, branch: 'main' })
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${path} 저장 실패 (HTTP ${res.status}) ${detail}`);
  }
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha1Hex16(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

// keywords.json에 키워드를 추가하고(신규인 경우), news.json에 기사를 병합해 각각 커밋한다.
// scripts/dataStore.js의 mergeArticles와 동일한 병합 규칙(같은 url은 한 번만 저장, matchedKeywords에 누적)을 따른다.
async function persistToGitHub(keyword, articles, env) {
  const kw = await ghGetFile('data/keywords.json', env);
  const alreadyExists = kw.json.some((k) => k.keyword === keyword);
  if (!alreadyExists) {
    kw.json.push({
      id: `${keyword.replace(/\s+/g, '-').toLowerCase()}-${Date.now().toString(36)}`,
      keyword,
      createdAt: new Date().toISOString()
    });
    await ghPutFile('data/keywords.json', kw.json, kw.sha, `chore: add keyword (${keyword})`, env);
  }

  const news = await ghGetFile('data/news.json', env);
  for (const item of articles) {
    const id = await sha1Hex16(item.url);
    const existing = news.json.articles[id];
    const matchedKeywords = new Set(existing ? existing.matchedKeywords : []);
    matchedKeywords.add(keyword);
    news.json.articles[id] = {
      url: item.url,
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      fetchedAt: new Date().toISOString(),
      matchedKeywords: Array.from(matchedKeywords)
    };
  }
  news.json.meta.lastUpdateAt = new Date().toISOString();
  await ghPutFile('data/news.json', news.json, news.sha, `chore: instant-collect "${keyword}"`, env);
}
