(() => {
  'use strict';

  const GH_API = 'https://api.github.com';
  const UPDATE_WORKFLOW = 'update-news.yml';
  const POLL_INTERVAL_MS = 5000;
  const POLL_TIMEOUT_MS = 3 * 60 * 1000;

  const state = {
    keywords: [],
    news: { articles: {}, meta: {} },
    scope: 'today'
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
    return (localStorage.getItem('workerUrl') || '').trim();
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

  function articlesForKeyword(keyword) {
    const all = Object.values(state.news.articles || {}).filter((a) => a.matchedKeywords.includes(keyword));
    const scoped = state.scope === 'today' ? all.filter((a) => isToday(a.pubDate)) : all;
    return scoped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
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

  function renderKeywordColumn(keyword) {
    const section = document.createElement('section');
    section.className = 'keyword-column';

    const heading = document.createElement('h2');
    heading.textContent = keyword;
    section.appendChild(heading);

    const articles = articlesForKeyword(keyword);
    if (articles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = state.scope === 'today' ? '오늘 수집된 기사가 없습니다.' : '수집된 기사가 없습니다.';
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement('ul');
    list.className = 'article-list';
    for (const article of articles) {
      const li = document.createElement('li');

      const link = document.createElement('a');
      link.href = article.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = article.title; // textContent만 사용 — 외부 입력 XSS 방지
      li.appendChild(link);

      if (article.description) {
        const desc = document.createElement('p');
        desc.className = 'article-desc';
        desc.textContent = article.description;
        li.appendChild(desc);
      }

      const meta = document.createElement('span');
      meta.className = 'article-meta';
      meta.textContent = formatDate(article.pubDate);
      li.appendChild(meta);

      list.appendChild(li);
    }
    section.appendChild(list);
    return section;
  }

  function renderAll() {
    renderMeta();
    const container = document.getElementById('keyword-columns');
    container.innerHTML = '';
    if (state.keywords.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = '등록된 키워드가 없습니다. 위에서 새 키워드를 추가해보세요.';
      container.appendChild(empty);
      return;
    }
    for (const { keyword } of state.keywords) {
      container.appendChild(renderKeywordColumn(keyword));
    }
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
      document.getElementById('keyword-columns').innerHTML = '';
      const p = document.createElement('p');
      p.className = 'empty-hint';
      p.textContent = `데이터를 불러오지 못했습니다: ${err.message}`;
      document.getElementById('keyword-columns').appendChild(p);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
