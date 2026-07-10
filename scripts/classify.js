const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
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

// 네이버 API 응답 items를 정제하고, 키워드가 실제로 포함된 기사만 남긴다 (단순 문자열 매칭).
function filterAndClean(items, keyword) {
  const results = [];
  for (const item of items || []) {
    const title = cleanText(item.title);
    const description = cleanText(item.description);
    if (!title || !item.link) continue; // 필수 필드 누락 → skip
    if (!matchesKeyword({ title, description }, keyword)) continue; // 미매칭 → 정상 제외
    results.push({ url: item.link, title, description, pubDate: item.pubDate || null });
  }
  return results;
}

module.exports = { cleanText, matchesKeyword, filterAndClean };
