const { searchNews } = require('./naverClient');
const { filterAndClean } = require('./classify');
const { readKeywords, readNews, writeNews, mergeArticles } = require('./dataStore');

async function collectKeyword(keyword, news, creds) {
  const items = await searchNews(keyword, creds);
  const cleaned = filterAndClean(items, keyword);
  mergeArticles(news, keyword, cleaned);
  return cleaned.length;
}

async function main() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.');
    process.exit(1);
  }

  const keywords = readKeywords();
  const news = readNews();
  const errors = [];

  for (const { keyword } of keywords) {
    try {
      const count = await collectKeyword(keyword, news, { clientId, clientSecret });
      console.log(`[${keyword}] 기사 ${count}건 반영`);
    } catch (err) {
      console.error(`[${keyword}] 수집 실패: ${err.message}`);
      errors.push({ keyword, error: err.message });
    }
  }

  let status = 'success';
  if (errors.length > 0) {
    status = keywords.length > 0 && errors.length === keywords.length ? 'fail' : 'partial_fail';
  }

  news.meta = {
    lastUpdateAt: new Date().toISOString(),
    lastUpdateStatus: status,
    lastUpdateErrors: errors
  };

  writeNews(news);
  console.log(`업데이트 완료: 키워드 ${keywords.length}개, 실패 ${errors.length}건, 상태=${status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
