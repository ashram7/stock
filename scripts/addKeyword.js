const { searchNews } = require('./naverClient');
const { filterAndClean } = require('./classify');
const { readKeywords, writeKeywords, readNews, writeNews, mergeArticles } = require('./dataStore');

async function main() {
  const keyword = (process.argv[2] || '').trim();
  if (!keyword) {
    console.error('사용법: node addKeyword.js "<키워드>"');
    process.exit(1);
  }
  if (keyword.length > 50) {
    console.error('키워드가 너무 깁니다 (최대 50자).');
    process.exit(1);
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.');
    process.exit(1);
  }

  const keywords = readKeywords();
  if (keywords.some((k) => k.keyword === keyword)) {
    console.log(`이미 존재하는 키워드입니다: ${keyword}`);
    return;
  }

  const id = `${keyword.replace(/\s+/g, '-').toLowerCase()}-${Date.now().toString(36)}`;
  keywords.push({ id, keyword, createdAt: new Date().toISOString() });
  writeKeywords(keywords);
  console.log(`키워드 추가됨: ${keyword}`);

  const news = readNews();
  try {
    const items = await searchNews(keyword, { clientId, clientSecret });
    const cleaned = filterAndClean(items, keyword);
    mergeArticles(news, keyword, cleaned);
    news.meta.lastUpdateAt = new Date().toISOString();
    writeNews(news);
    console.log(`[${keyword}] 기사 ${cleaned.length}건 즉시 수집 완료`);
  } catch (err) {
    console.error(`[${keyword}] 즉시 수집 실패(키워드는 저장됨, 다음 정기 수집에 포함): ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
