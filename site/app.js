(() => {
  'use strict';

  const GH_API = 'https://api.github.com';
  const UPDATE_WORKFLOW = 'update-news.yml';
  const POLL_INTERVAL_MS = 5000;
  const POLL_TIMEOUT_MS = 3 * 60 * 1000;

  const state = {
    keywords: [],
    news: { articles: {}, meta: {} },
    scope: 'today',
    selectedKeyword: null // null = 전체
  };

  // ---------- 저장소 정보 ----------

  function detectRepoFromPages() {
    const host = location.hostname; // {owner}.github.io
    if (!host.endsWith('.github.io')) return null;
    const owner = host.split('.')[0];
    const pathParts = location.pathname.split('/').filter(Boolean);
    const repo = pathParts.length > 0 ? pathParts[0] : `${owner}.github.io`;
    return { owner, repo };
  }

  function getRepoInfo() {
    const fromPages = detectRepoFromPages();
    if (fromPages) return fromPages;
    const owner = localStorage.getItem('ghOwner');
    const repo = localStorage.getItem('ghRepo');
    if (owner && repo) return { owner, repo };
    return null;
  }

  // ---------- PAT / 설정 ----------

  function getPat() {
    return localStorage.getItem('ghPat') || '';
  }

  function getWorkerUrl() {
    let url = (localStorage.getItem('workerUrl') || '').trim();
    // https:// 없이 저장된 경우 상대경로로 해석되는 문제를 방지 (예: naver-news-search.xxx.workers.dev)
    if (url && !/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    return url;
  }

  function getAppSecret() {
    return localStorage.getItem('appSecret') || '';
  }

  function authHeaders() {
    const token = getPat();
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  // ---------- 데이터 로드 ----------

  async function fetchJSON(relativePath) {
    const repoInfo = getRepoInfo();
    if (!repoInfo) throw new Error('저장소 정보를 알 수 없습니다. 설정에서 Owner/Repo를 입력해주세요.');
    const url = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/main/${relativePath}?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${relativePath} 로드 실패 (HTTP ${res.status})`);
    return res.json();
  }

  async function loadData() {
    const [keywords, news] = await Promise.all([
      fetchJSON('data/keywords.json'),
      fetchJSON('data/news.json')
    ]);
    state.keywords = keywords;
    state.news = news;
    renderAll();
  }

  // ---------- 렌더링 (textContent만 사용 — XSS 방지) ----------

  function isToday(pubDate) {
    if (!pubDate) return false;
    const d = new Date(pubDate);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  function formatDate(pubDate) {
    if (!pubDate) return '';
    const d = new Date(pubDate);
    if (Number.isNaN(d.getTime())) return pubDate;
    return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // 선택된 키워드(state.selectedKeyword)와 보기 범위(state.scope)를 반영해 정렬된 기사 목록을 만든다.
  // null(전체 탭)이면 키워드로 거르지 않는다 — 같은 기사가 여러 키워드에 매칭돼도 한 번만 나온다(데이터가 url 기준으로 이미 중복 제거되어 있음).
  function articlesFiltered() {
    const all = Object.values(state.news.articles || {});
    const byKeyword = state.selectedKeyword
      ? all.filter((a) => a.matchedKeywords.includes(state.selectedKeyword))
      : all;
    const scoped = state.scope === 'today' ? byKeyword.filter((a) => isToday(a.pubDate)) : byKeyword;
    return scoped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  }

  function formatTime(pubDate) {
    const d = new Date(pubDate);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatMonthHeading(monthKey) {
    const [y, m] = monthKey.split('-');
    return `${y}년 ${parseInt(m, 10)}월`;
  }

  function formatDayHeading(dayKey) {
    const d = new Date(dayKey);
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
  }

  // 이미 pubDate 내림차순으로 정렬된 articles를 월 -> 일 단위로 묶는다.
  // Map은 삽입 순서를 보존하므로, 정렬된 입력을 그대로 넣으면 최신 월/일이 먼저 오는 순서가 유지된다.
  function groupByMonthDay(articles) {
    const months = new Map();
    for (const article of articles) {
      const d = new Date(article.pubDate);
      if (Number.isNaN(d.getTime())) continue; // 날짜 정보 없는 기사는 그룹핑 불가하므로 제외
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dayKey = `${monthKey}-${String(d.getDate()).padStart(2, '0')}`;
      if (!months.has(monthKey)) months.set(monthKey, new Map());
      const days = months.get(monthKey);
      if (!days.has(dayKey)) days.set(dayKey, []);
      days.get(dayKey).push(article);
    }
    return months;
  }

  function renderMeta() {
    const el = document.getElementById('last-update');
    const meta = state.news.meta || {};
    if (!meta.lastUpdateAt) {
      el.textContent = '아직 업데이트된 적 없음';
      return;
    }
    const statusLabel = { success: '정상', partial_fail: '일부 실패', fail: '실패' }[meta.lastUpdateStatus] || meta.lastUpdateStatus || '';
    el.textContent = `마지막 업데이트: ${formatDate(meta.lastUpdateAt)} (${statusLabel})`;
  }

  function renderKeywordTabs() {
    const nav = document.getElementById('keyword-tabs');
    nav.innerHTML = '';

    const allTab = document.createElement('button');
    allTab.type = 'button';
    allTab.className = `keyword-tab${state.selectedKeyword === null ? ' active' : ''}`;
    allTab.textContent = '전체';
    allTab.addEventListener('click', () => {
      state.selectedKeyword = null;
      renderAll();
    });
    nav.appendChild(allTab);

    for (const { keyword } of state.keywords) {
      const tab = document.createElement('div');
      tab.className = `keyword-tab${state.selectedKeyword === keyword ? ' active' : ''}`;

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'tab-label';
      label.textContent = keyword; // textContent만 사용 — XSS 방지
      label.addEventListener('click', () => {
        state.selectedKeyword = keyword;
        renderAll();
      });
      tab.appendChild(label);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'tab-delete';
      delBtn.textContent = '×';
      delBtn.title = `"${keyword}" 삭제`;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteKeyword(keyword);
      });
      tab.appendChild(delBtn);

      nav.appendChild(tab);
    }
  }

  function renderArticleCard(article) {
    const card = document.createElement('article');
    card.className = 'article-card';

    const link = document.createElement('a');
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'card-title';
    link.textContent = article.title; // textContent만 사용 — 외부 입력 XSS 방지
    card.appendChild(link);

    if (article.description) {
      const desc = document.createElement('p');
      desc.className = 'card-desc';
      desc.textContent = article.description;
      card.appendChild(desc);
    }

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const time = document.createElement('span');
    time.className = 'card-time';
    time.textContent = formatTime(article.pubDate);
    footer.appendChild(time);

    const tags = document.createElement('div');
    tags.className = 'card-keywords';
    for (const kw of article.matchedKeywords) {
      const tag = document.createElement('span');
      tag.className = 'card-tag';
      tag.textContent = kw;
      tags.appendChild(tag);
    }
    footer.appendChild(tags);

    card.appendChild(footer);
    return card;
  }

  function renderFeed() {
    const container = document.getElementById('feed');
    container.innerHTML = '';

    const articles = articlesFiltered();
    if (articles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = state.keywords.length === 0
        ? '등록된 키워드가 없습니다. 위에서 새 키워드를 추가해보세요.'
        : (state.scope === 'today' ? '오늘 수집된 기사가 없습니다.' : '수집된 기사가 없습니다.');
      container.appendChild(empty);
      return;
    }

    const months = groupByMonthDay(articles);
    for (const [monthKey, days] of months) {
      const monthSection = document.createElement('section');
      monthSection.className = 'month-group';

      const monthHeading = document.createElement('h2');
      monthHeading.className = 'month-heading';
      monthHeading.textContent = formatMonthHeading(monthKey);
      monthSection.appendChild(monthHeading);

      for (const [dayKey, dayArticles] of days) {
        const daySection = document.createElement('div');
        daySection.className = 'day-group';

        const dayHeading = document.createElement('h3');
        dayHeading.className = 'day-heading';
        dayHeading.textContent = `${formatDayHeading(dayKey)} · ${dayArticles.length}건`;
        daySection.appendChild(dayHeading);

        const grid = document.createElement('div');
        grid.className = 'card-grid';
        for (const article of dayArticles) {
          grid.appendChild(renderArticleCard(article));
        }
        daySection.appendChild(grid);

        monthSection.appendChild(daySection);
      }
      container.appendChild(monthSection);
    }
  }

  function renderAll() {
    renderMeta();
    renderKeywordTabs();
    renderFeed();
  }

  // ---------- 토스트 ----------

  let toastTimer = null;
  function showToast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.toggle('toast-error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // ---------- GitHub Actions 트리거 & 폴링 ----------

  async function dispatchWorkflow(workflowFile, inputs) {
    const repoInfo = getRepoInfo();
    if (!repoInfo) throw new Error('저장소 정보를 알 수 없습니다.');
    if (!getPat()) throw new Error('GitHub 토큰이 필요합니다. 설정(⚙)에서 등록해주세요.');

    const body = { ref: 'main' };
    if (inputs) body.inputs = inputs;

    const res = await fetch(
      `${GH_API}/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${workflowFile}/dispatches`,
      { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (res.status !== 204) {
      const detail = await res.text().catch(() => '');
      throw new Error(`워크플로 트리거 실패 (HTTP ${res.status}) ${detail}`);
    }
  }

  async function findRunSince(workflowFile, sinceMs) {
    const repoInfo = getRepoInfo();
    const res = await fetch(
      `${GH_API}/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${workflowFile}/runs?per_page=5`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const runs = data.workflow_runs || [];
    return runs.find((r) => new Date(r.created_at).getTime() >= sinceMs - 5000) || null;
  }

  async function waitForWorkflow(workflowFile, sinceMs, onStatus) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const run = await findRunSince(workflowFile, sinceMs);
      if (run) {
        onStatus(run.status);
        if (run.status === 'completed') return run.conclusion;
      }
    }
    throw new Error('실행 확인 시간이 초과되었습니다. 잠시 후 GitHub Actions 탭에서 직접 확인해주세요.');
  }

  async function runAndReload(button, workflowFile, inputs, label) {
    const originalText = button.textContent;
    button.disabled = true;
    try {
      const sinceMs = Date.now();
      button.textContent = '요청 전송 중...';
      await dispatchWorkflow(workflowFile, inputs);
      button.textContent = '실행 대기 중...';
      const conclusion = await waitForWorkflow(workflowFile, sinceMs, (status) => {
        button.textContent = status === 'queued' ? '대기열에서 대기 중...' : '수집 중...';
      });
      if (conclusion !== 'success') {
        showToast(`${label} 완료되었지만 결과가 "${conclusion}"입니다. Actions 탭을 확인해주세요.`, true);
      } else {
        showToast(`${label} 완료되었습니다.`);
      }
      await loadData();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  // ---------- 키워드 삭제 (GitHub Contents API 직접 호출, PAT 사용) ----------

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

  // data/keywords.json에서 해당 키워드만 제거해 커밋한다. 이미 수집된 기사(data/news.json)는 건드리지 않는다.
  async function deleteKeywordRemote(keyword) {
    const repoInfo = getRepoInfo();
    if (!repoInfo) throw new Error('저장소 정보를 알 수 없습니다.');
    if (!getPat()) throw new Error('GitHub 토큰이 필요합니다. 설정(⚙)에서 등록해주세요.');

    const getRes = await fetch(
      `${GH_API}/repos/${repoInfo.owner}/${repoInfo.repo}/contents/data/keywords.json?ref=main`,
      { headers: authHeaders() }
    );
    if (!getRes.ok) throw new Error(`키워드 목록 조회 실패 (HTTP ${getRes.status})`);
    const fileData = await getRes.json();
    const currentList = JSON.parse(decodeBase64Utf8(fileData.content));
    const updatedList = currentList.filter((k) => k.keyword !== keyword);

    const putRes = await fetch(
      `${GH_API}/repos/${repoInfo.owner}/${repoInfo.repo}/contents/data/keywords.json`,
      {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `chore: remove keyword (${keyword})`,
          content: encodeBase64Utf8(`${JSON.stringify(updatedList, null, 2)}\n`),
          sha: fileData.sha,
          branch: 'main'
        })
      }
    );
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => '');
      throw new Error(`키워드 삭제 실패 (HTTP ${putRes.status}) ${detail}`);
    }
  }

  async function handleDeleteKeyword(keyword) {
    const confirmed = confirm(`"${keyword}" 키워드를 삭제하시겠습니까?\n이미 수집된 기사는 유지되고, 목록에서만 제거됩니다.`);
    if (!confirmed) return;

    try {
      await deleteKeywordRemote(keyword);
      state.keywords = state.keywords.filter((k) => k.keyword !== keyword);
      if (state.selectedKeyword === keyword) state.selectedKeyword = null;
      renderAll();
      showToast(`"${keyword}" 키워드를 삭제했습니다.`);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---------- 설정 패널 ----------

  function initSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    const settingsBtn = document.getElementById('settings-btn');
    const patInput = document.getElementById('pat-input');
    const ownerInput = document.getElementById('owner-input');
    const repoInput = document.getElementById('repo-input');
    const workerUrlInput = document.getElementById('worker-url-input');
    const appSecretInput = document.getElementById('app-secret-input');

    patInput.value = getPat();
    ownerInput.value = localStorage.getItem('ghOwner') || '';
    repoInput.value = localStorage.getItem('ghRepo') || '';
    workerUrlInput.value = getWorkerUrl();
    appSecretInput.value = getAppSecret();

    settingsBtn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });

    document.getElementById('pat-save-btn').addEventListener('click', () => {
      if (patInput.value.trim()) localStorage.setItem('ghPat', patInput.value.trim());
      if (ownerInput.value.trim()) localStorage.setItem('ghOwner', ownerInput.value.trim());
      if (repoInput.value.trim()) localStorage.setItem('ghRepo', repoInput.value.trim());
      if (workerUrlInput.value.trim()) localStorage.setItem('workerUrl', workerUrlInput.value.trim());
      if (appSecretInput.value.trim()) localStorage.setItem('appSecret', appSecretInput.value.trim());
      showToast('설정이 저장되었습니다.');
      panel.hidden = true;
    });

    document.getElementById('pat-clear-btn').addEventListener('click', () => {
      localStorage.removeItem('ghPat');
      localStorage.removeItem('workerUrl');
      localStorage.removeItem('appSecret');
      patInput.value = '';
      workerUrlInput.value = '';
      appSecretInput.value = '';
      showToast('저장된 설정을 삭제했습니다.');
    });
  }

  // ---------- 이벤트 바인딩 ----------

  function initUpdateButton() {
    const btn = document.getElementById('update-btn');
    btn.addEventListener('click', () => {
      runAndReload(btn, UPDATE_WORKFLOW, undefined, '업데이트가');
    });
  }

  // 키워드 검색 결과를 로컬 state에 즉시 반영한다 (병합 규칙은 scripts/dataStore.js의 mergeArticles와 동일).
  // 실제 GitHub 저장은 Worker가 백그라운드에서 처리하므로, 여기서는 화면 표시만 담당한다.
  function applyArticlesToState(keyword, articles) {
    if (!state.keywords.some((k) => k.keyword === keyword)) {
      state.keywords.push({ keyword, createdAt: new Date().toISOString() });
    }
    for (const article of articles) {
      const id = article.url;
      const existing = state.news.articles[id];
      const matchedKeywords = new Set(existing ? existing.matchedKeywords : []);
      matchedKeywords.add(keyword);
      state.news.articles[id] = { ...article, fetchedAt: new Date().toISOString(), matchedKeywords: Array.from(matchedKeywords) };
    }
    state.news.meta = { ...state.news.meta, lastUpdateAt: new Date().toISOString() };
  }

  async function searchKeywordInstant(keyword) {
    const workerUrl = getWorkerUrl();
    const appSecret = getAppSecret();
    if (!workerUrl || !appSecret) {
      throw new Error('설정(⚙)에서 Worker URL과 앱 시크릿을 먼저 등록해주세요.');
    }
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Secret': appSecret },
      body: JSON.stringify({ keyword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `검색 실패 (HTTP ${res.status})`);
    return data.articles || [];
  }

  function initAddKeywordForm() {
    const form = document.getElementById('add-keyword-form');
    const input = document.getElementById('new-keyword-input');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keyword = input.value.trim();
      if (!keyword) return;

      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = '검색 중...';
      try {
        const articles = await searchKeywordInstant(keyword);
        applyArticlesToState(keyword, articles);
        renderAll();
        showToast(`"${keyword}" 기사 ${articles.length}건 표시됨 (GitHub 저장은 백그라운드 진행 중)`);
        input.value = '';
      } catch (err) {
        showToast(err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  function initScopeToggle() {
    const buttons = document.querySelectorAll('.scope-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.scope = btn.dataset.scope;
        renderAll();
      });
    });
  }

  // ---------- 시작 ----------

  async function init() {
    initSettingsPanel();
    initUpdateButton();
    initAddKeywordForm();
    initScopeToggle();
    try {
      await loadData();
    } catch (err) {
      const feed = document.getElementById('feed');
      feed.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'empty-hint';
      p.textContent = `데이터를 불러오지 못했습니다: ${err.message}`;
      feed.appendChild(p);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
