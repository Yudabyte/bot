const CHANNEL_ID = 'UCX972mJESlydleknucLpk7w';
const CHANNEL_NAME = 'Ideologi Akal';
const CHANNEL_URL = 'https://www.youtube.com/@IdeologiAkal';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const CACHE_DURATION_MS = 5 * 60 * 1000;
const MAX_FEED_BYTES = 1_000_000;

let cachedVideo = null;
let hasCachedResult = false;
let cacheExpiresAt = 0;
let pendingRequest = null;

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/&#([0-9]+);/g, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readXmlTag(source, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`));
  return match ? decodeXml(match[1]).trim() : '';
}

function parseLatestVideo(xml) {
  const entry = String(xml).match(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/);
  if (!entry) return null;

  const source = entry[1];
  const channelId = readXmlTag(source, 'yt:channelId');
  const videoId = readXmlTag(source, 'yt:videoId');
  const title = readXmlTag(source, 'title');
  if (channelId !== CHANNEL_ID || !/^[\w-]{11}$/.test(videoId) || !title) {
    throw new Error('Data video terbaru dari YouTube tidak valid.');
  }

  const publishedAt = readXmlTag(source, 'published');
  const description = readXmlTag(source, 'media:description');
  const publishedTimestamp = Date.parse(publishedAt);
  return {
    id: videoId,
    title: title.slice(0, 256),
    description: description.slice(0, 1200),
    publishedAt: Number.isNaN(publishedTimestamp) ? null : new Date(publishedTimestamp).toISOString(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

async function loadLatestVideo(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(FEED_URL, {
      headers: { 'User-Agent': 'EmbedStudio-DaxiaYT/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('YouTube tidak merespons dalam 10 detik. Coba jalankan command lagi.', { cause: error });
    }
    throw new Error(`Feed YouTube tidak dapat diakses: ${error.message}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Feed YouTube merespons dengan HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/xml|atom/i.test(contentType)) throw new Error('YouTube tidak mengembalikan RSS feed yang valid.');

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_FEED_BYTES) throw new Error('Ukuran feed YouTube melebihi batas yang diizinkan.');
  const xml = await response.text();
  if (Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) {
    throw new Error('Ukuran feed YouTube melebihi batas yang diizinkan.');
  }
  const video = parseLatestVideo(xml);
  if (!video) return null;
  return video;
}

function getLatestYoutubeVideo({ fetchImpl = fetch, now = Date.now } = {}) {
  if (hasCachedResult && cacheExpiresAt > now()) return Promise.resolve(cachedVideo);
  if (pendingRequest) return pendingRequest;

  pendingRequest = loadLatestVideo(fetchImpl)
    .then((video) => {
      cachedVideo = video;
      hasCachedResult = true;
      cacheExpiresAt = now() + CACHE_DURATION_MS;
      return video;
    })
    .finally(() => {
      pendingRequest = null;
    });
  return pendingRequest;
}

module.exports = {
  CHANNEL_NAME,
  CHANNEL_URL,
  FEED_URL,
  getLatestYoutubeVideo,
  parseLatestVideo,
};
