const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KEYWORDS_PATH = path.join(DATA_DIR, 'keywords.json');
const NEWS_PATH = path.join(DATA_DIR, 'news.json');

function hashUrl(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function readKeywords() {
  if (!fs.existsSync(KEYWORDS_PATH)) return [];
  return JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf8'));
}

function writeKeywords(keywords) {
  fs.writeFileSync(KEYWORDS_PATH, `${JSON.stringify(keywords, null, 2)}\n`);
}

function readNews() {
  if (!fs.existsSync(NEWS_PATH)) {
    return { articles: {}, meta: { lastUpdateAt: null, lastUpdateStatus: null, lastUpdateErrors: [] } };
  }
  const parsed = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
  if (!parsed.articles) parsed.articles = {};
  if (!parsed.meta) parsed.meta = { lastUpdateAt: null, lastUpdateStatus: null, lastUpdateErrors: [] };
  return parsed;
}

function writeNews(news) {
  fs.writeFileSync(NEWS_PATH, `${JSON.stringify(news, null, 2)}\n`);
}

// cleanedItems({url,title,description,pubDate})를 news.articles에 병합한다.
// 같은 url은 한 번만 저장되고 matchedKeywords에 키워드가 누적된다.
function mergeArticles(news, keyword, cleanedItems) {
  for (const item of cleanedItems) {
    const id = hashUrl(item.url);
    const existing = news.articles[id];
    const matchedKeywords = new Set(existing ? existing.matchedKeywords : []);
    matchedKeywords.add(keyword);
    news.articles[id] = {
      url: item.url,
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      fetchedAt: new Date().toISOString(),
      matchedKeywords: Array.from(matchedKeywords)
    };
  }
}

module.exports = { hashUrl, readKeywords, writeKeywords, readNews, writeNews, mergeArticles };
