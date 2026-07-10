const NAVER_ENDPOINT = 'https://openapi.naver.com/v1/search/news.json';

async function searchNews(keyword, { clientId, clientSecret, display = 20, retries = 1 } = {}) {
  const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(keyword)}&display=${display}&sort=date`;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret
        }
      });
      if (!res.ok) {
        throw new Error(`Naver API HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data.items)) {
        throw new Error('Naver API 응답에 items 배열이 없습니다');
      }
      return data.items;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastErr;
}

module.exports = { searchNews };
