// Base URL for WordPress REST API (Pantheon Headless CMS)
const WP_API_URL = (
  process.env.NEXT_PUBLIC_WORDPRESS_API_URL ||
  'https://dev-movio-stream.pantheonsite.io/wp-json/wp/v2'
).replace(/\/+$/, '');

/**
 * Construct full URL handling both standard REST and rest_route query parameter syntax
 */
function buildApiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  if (WP_API_URL.includes('rest_route=')) {
    const formatted = cleanEndpoint.replace('?', '&');
    return `${WP_API_URL}/${formatted}`;
  }
  return `${WP_API_URL}/${cleanEndpoint}`;
}

/**
 * Fetch generic data from WordPress REST API with zero-caching for real-time live data
 */
export async function fetchAPI(endpoint, { method = 'GET', body = null } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  const url = buildApiUrl(endpoint);

  const options = {
    method,
    headers,
    // Real-time live data fetching: prevent build-time caching and stale post locks
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`WordPress API returned ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (error) {
    console.error(`Error fetching ${endpoint} from ${url}:`, error.message);
    return null;
  }
}

/**
 * Fetch latest movies (posts) strictly excluding TV series/episodes
 */
export async function getLatestMovies(limit = 24) {
  const posts = await fetchAPI('posts?per_page=50&_embed');
  if (!Array.isArray(posts)) return [];
  const moviesOnly = posts.filter((p) => !isSeriesPost(p));
  return moviesOnly.slice(0, limit);
}

/**
 * Fetch latest TV series posts strictly belonging to category 'series'
 */
export async function getLatestSeries(limit = 12) {
  const posts = await fetchAPI('posts?per_page=50&_embed');
  if (!Array.isArray(posts)) return [];
  const seriesOnly = posts.filter((p) => isSeriesPost(p));
  return seriesOnly.slice(0, limit);
}

/**
 * Search or filter movies from WordPress
 */
export async function searchMovies({ search = '', perPage = 50 } = {}) {
  let endpoint = `posts?per_page=${perPage}&_embed`;
  if (search && search.trim()) {
    endpoint += `&search=${encodeURIComponent(search.trim())}`;
  }
  const posts = await fetchAPI(endpoint);
  return Array.isArray(posts) ? posts : [];
}

/**
 * Fetch a single movie by its slug
 */
export async function getMovieBySlug(slug) {
  const posts = await fetchAPI(`posts?slug=${slug}&_embed`);
  return Array.isArray(posts) && posts.length > 0 ? posts[0] : null;
}

/**
 * Fetch all categories
 */
export async function getCategories() {
  const cats = await fetchAPI('categories?hide_empty=true');
  return Array.isArray(cats) ? cats : [];
}

/**
 * Enforce HTTPS protocol on external URLs to eliminate SSL and mixed-content issues
 */
export function enforceHttps(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/^http:\/\//i, 'https://');
}

/**
 * Normalizes any StreamHG / hgcloud embed URL to working https://hgcloud.to/e/{code} format
 * Converts:
 * - streamhg.com/e/{code} -> https://hgcloud.to/e/{code}
 * - streamhg.com/{code}   -> https://hgcloud.to/e/{code}
 * - streamhgapi.com/e/{code} -> https://hgcloud.to/e/{code}
 * - streamhgapi.com/{code}   -> https://hgcloud.to/e/{code}
 * - hgcloud.to/{code}     -> https://hgcloud.to/e/{code}
 * - hgcloud.to/e/{code}   -> https://hgcloud.to/e/{code}
 */
export function normalizeStreamHgUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const match = url.match(/(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.)?(?:streamhg(?:api)?\.com|hgcloud\.to)\/(?:e\/|d\/|v\/|embed\/)?([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    const code = match[1];
    if (!['api', 'upload', 'dl', 'contact', 'faq'].includes(code.toLowerCase())) {
      return `https://hgcloud.to/e/${code}`;
    }
  }
  return url;
}

/**
 * Formats and normalizes Vidmoly embed URL into a clean, working embed URL:
 * https://{targetDomain}/embed-{fileCode}.html
 * Safely extracts the alphanumeric file code and prevents /embed-embed.html corruption.
 *
 * @param {string} url - Raw Vidmoly URL or file code
 * @param {string} targetDomain - Target mirror domain (default: 'vidmoly.biz')
 * @returns {string} Formatted Vidmoly embed URL
 */
export function formatVidmolyEmbed(url, targetDomain = "vidmoly.biz") {
  if (!url || typeof url !== 'string') return "";
  const cleanUrl = url.trim();

  // 1. Primary extraction: matches /embed-CODE.html, /embed/CODE, or /v/CODE
  let match = cleanUrl.match(/(?:embed-|embed\/|v\/)([a-zA-Z0-9]+)/i);

  // 2. Secondary extraction: matches vidmoly.xxx/CODE.html or vidmoly.xxx/CODE
  if (!match) {
    match = cleanUrl.match(/vidmoly\.[a-z0-9-]+\/([a-zA-Z0-9]+)(?:\.html)?/i);
  }

  // 3. Raw file code pattern fallback (e.g. '85o4zszwyiij')
  if (!match && /^[a-zA-Z0-9]{6,}$/.test(cleanUrl)) {
    match = [null, cleanUrl];
  }

  if (match && match[1]) {
    const fileCode = match[1];
    // Reject keywords and corruptions that are not valid video file codes
    const reserved = ['embed', 'api', 'upload', 'dl', 'contact', 'faq'];
    if (!reserved.includes(fileCode.toLowerCase())) {
      return `https://${targetDomain}/embed-${fileCode}.html`;
    }
  }

  return cleanUrl;
}

/**
 * Normalizes any Vidmoly embed URL to valid embed format: https://vidmoly.biz/embed-{code}.html
 * (or preferred mirror domain). Delegates to robust formatVidmolyEmbed.
 */
export function normalizeVidmolyUrl(url, preferredMirror = "vidmoly.biz") {
  if (!url || typeof url !== 'string') return url;
  return formatVidmolyEmbed(url, preferredMirror || "vidmoly.biz");
}

/**
 * Switch Vidmoly URL between primary domain (vidmoly.biz) and mirror domain (vidmoly.to)
 * Preserves the extracted fileCode and prevents URL corruption.
 */
export function getVidmolyMirrorUrl(url, targetDomain = null) {
  if (!url || typeof url !== 'string') return url;
  if (targetDomain) {
    return formatVidmolyEmbed(url, targetDomain);
  }
  // Toggle between vidmoly.biz and vidmoly.to (or legacy vidmoly.me)
  if (url.includes('vidmoly.biz')) {
    return formatVidmolyEmbed(url, 'vidmoly.to');
  } else if (url.includes('vidmoly.to')) {
    return formatVidmolyEmbed(url, 'vidmoly.biz');
  } else if (url.includes('vidmoly.me')) {
    return formatVidmolyEmbed(url, 'vidmoly.biz');
  }
  return formatVidmolyEmbed(url, 'vidmoly.to');
}

/**
 * Safely extracts Vidmoly alphanumeric file code from any Vidmoly URL or code string.
 */
export function getVidmolyFileCode(url) {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();
  let match = cleanUrl.match(/(?:embed-|embed\/|v\/|dl\/)([a-zA-Z0-9]+)/i);
  if (!match) {
    match = cleanUrl.match(/vidmoly\.[a-z0-9-]+\/([a-zA-Z0-9]+)(?:\.html)?/i);
  }
  if (!match && /^[a-zA-Z0-9]{6,}$/.test(cleanUrl)) {
    match = [null, cleanUrl];
  }
  if (match && match[1]) {
    const fileCode = match[1];
    const reserved = ['embed', 'api', 'upload', 'dl', 'contact', 'faq'];
    if (!reserved.includes(fileCode.toLowerCase())) {
      return fileCode;
    }
  }
  return null;
}

/**
 * Returns clean direct stream/view URL for Vidmoly (1080p FHD):
 * https://vidmoly.biz/v/{fileCode}
 * Uses /v/ to avoid MENA geo-restrictions encountered on /dl/.
 */
export function getVidmolyDownloadUrl(url) {
  const code = getVidmolyFileCode(url);
  return code ? `https://vidmoly.biz/v/${code}` : null;
}

/**
 * Converts DoodStream embed URLs (e.g. doodstream.com/e/CODE, dood.to/e/CODE, ds2play.com/e/CODE, doood.watch/e/CODE)
 * to direct download URL format: https://doodstream.com/d/{fileCode}
 */
export function getDoodstreamDownloadUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();
  let match = cleanUrl.match(/(?:doodstream|dood|ds2play|doood)\.[a-z0-9-]+\/(?:e|d)\/([a-zA-Z0-9_-]+)/i);
  if (!match) {
    match = cleanUrl.match(/\/(?:e|d)\/([a-zA-Z0-9_-]+)/i);
  }
  if (!match && /^[a-zA-Z0-9_-]{6,}$/.test(cleanUrl)) {
    match = [null, cleanUrl];
  }
  if (match && match[1]) {
    const fileCode = match[1];
    const reserved = ['embed', 'api', 'upload', 'dl', 'contact', 'faq'];
    if (!reserved.includes(fileCode.toLowerCase())) {
      return `https://doodstream.com/d/${fileCode}`;
    }
  }
  return null;
}

/**
 * Converts Streamtape embed URL (https://streamtape.com/e/{code})
 * to its direct high-speed view/download URL (https://streamtape.com/v/{code}).
 */
export function getStreamtapeDownloadUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();
  const match = cleanUrl.match(/streamtape\.[a-z0-9-]+\/(?:e|v)\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return `https://streamtape.com/v/${match[1]}`;
  }
  if (cleanUrl.includes('streamtape')) {
    return cleanUrl.replace('/e/', '/v/');
  }
  return null;
}

/**
 * Converts StreamHG / HgCloud embed URL (https://hgcloud.to/e/{code})
 * to its direct view/download URL (https://hgcloud.to/v/{code}).
 */
export function getStreamhgDownloadUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();
  const match = cleanUrl.match(/(?:streamhg(?:api)?\.[a-z0-9-]+|hgcloud\.[a-z0-9-]+)\/(?:e|v|d)\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return `https://hgcloud.to/v/${match[1]}`;
  }
  if (cleanUrl.includes('hgcloud') || cleanUrl.includes('streamhg')) {
    return cleanUrl.replace('/e/', '/v/');
  }
  return null;
}

/**
 * Extracts dual-quality download links:
 * - 1080p Primary: DoodStream direct download (no MENA geo-restrictions)
 * - 1080p Mirror: Vidmoly /v/ view/download link
 * - 720p Speed: Streamtape (priority 1) or StreamHG (priority 2)
 */
export function getDualQualityDownloadLinks(movie) {
  if (!movie) {
    return {
      download1080_dood: null,
      download1080_vidmoly: null,
      download1080: null,
      download720: null,
      provider720: null,
    };
  }

  // 1. Doodstream 1080p Download Link (Primary 1080p - No Geo-restrictions)
  let doodSource = movie.doodEmbed || movie.dood_embed || movie.dood_url || movie.doodstream_url || null;
  if (!doodSource && Array.isArray(movie.servers)) {
    const dServer = movie.servers.find(s => s && (s.id === 'doodstream' || s.id === 'dood' || (s.name && s.name.toLowerCase().includes('dood')) || (s.url && (s.url.includes('dood') || s.url.includes('ds2play') || s.url.includes('doood')))));
    if (dServer) doodSource = dServer.url;
  }
  if (!doodSource && movie.embed_url_1080p && (movie.embed_url_1080p.includes('dood') || movie.embed_url_1080p.includes('ds2play') || movie.embed_url_1080p.includes('doood'))) {
    doodSource = movie.embed_url_1080p;
  }

  const download1080_dood = getDoodstreamDownloadUrl(doodSource);

  // 2. Vidmoly 1080p Secondary Mirror Link (Uses /v/ to bypass MENA dl/ block)
  let vidmolySource = movie.vidmolyEmbed || movie.vidmoly_url || movie.vidmoly_embed || null;
  if (!vidmolySource && Array.isArray(movie.servers)) {
    const vServer = movie.servers.find(s => s && (s.id === 'vidmoly' || (s.name && s.name.toLowerCase().includes('vidmoly')) || (s.url && s.url.includes('vidmoly'))));
    if (vServer) vidmolySource = vServer.url;
  }
  if (!vidmolySource && movie.embed_url_1080p && movie.embed_url_1080p.includes('vidmoly')) {
    vidmolySource = movie.embed_url_1080p;
  }
  if (!vidmolySource && movie.primaryEmbed && movie.primaryEmbed.includes('vidmoly')) {
    vidmolySource = movie.primaryEmbed;
  }

  const download1080_vidmoly = getVidmolyDownloadUrl(vidmolySource);
  const download1080 = download1080_dood || download1080_vidmoly || null;

  // 3. 720p Fast Download Link: Prioritize Streamtape first for uncapped download speed
  let streamtapeSource = movie.streamtapeEmbed || movie.streamtape_url || movie.streamtape_embed || null;
  if (!streamtapeSource && Array.isArray(movie.servers)) {
    const sServer = movie.servers.find(s => s && (s.id === 'streamtape' || (s.name && s.name.toLowerCase().includes('streamtape')) || (s.url && s.url.includes('streamtape'))));
    if (sServer) streamtapeSource = sServer.url;
  }
  if (!streamtapeSource && movie.embed_url_720p && (movie.embed_url_720p.includes('streamtape') || movie.embed_url_720p.includes('strtape'))) {
    streamtapeSource = movie.embed_url_720p;
  }

  let download720 = getStreamtapeDownloadUrl(streamtapeSource);
  let provider720 = download720 ? 'Streamtape' : null;

  // Fallback gracefully to StreamHG if Streamtape is unavailable
  if (!download720) {
    let streamhgSource = movie.streamhgEmbed || movie.streamhg_url || movie.streamhg_embed ||
                         movie.hgcloudEmbed || movie.hgcloud_url || movie.hgcloud_embed || null;
    if (!streamhgSource && Array.isArray(movie.servers)) {
      const hServer = movie.servers.find(s => s && (s.id === 'streamhg' || s.id === 'hgcloud' || (s.url && (s.url.includes('streamhg') || s.url.includes('hgcloud')))));
      if (hServer) streamhgSource = hServer.url;
    }
    if (!streamhgSource && movie.embed_url_720p && (movie.embed_url_720p.includes('streamhg') || movie.embed_url_720p.includes('hgcloud'))) {
      streamhgSource = movie.embed_url_720p;
    }

    download720 = getStreamhgDownloadUrl(streamhgSource);
    if (download720) provider720 = 'StreamHG';
  }

  return {
    download1080_dood,
    download1080_vidmoly,
    download1080,
    download720,
    provider720,
  };
}

/**
 * Extract featured image URL from an embedded WP post object, post meta, or fallback
 */
export function getFeaturedImage(post) {
  if (!post) return '/placeholder.jpg';
  const meta = { ...(post.meta_input || {}), ...(post.meta || {}) };
  let img = null;
  if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]?.source_url) {
    img = post._embedded['wp:featuredmedia'][0].source_url;
  } else if (meta.poster_url) {
    img = meta.poster_url;
  } else if (meta.backdrop_url) {
    img = meta.backdrop_url;
  } else if (post.meta?.backdrop_url) {
    img = post.meta.backdrop_url;
  }
  return enforceHttps(img || '/placeholder.jpg');
}

/**
 * Detect whether a WordPress post belongs to a TV series or episode.
 * Inspects taxonomy terms, post meta, and title patterns.
 */
export function isSeriesPost(post) {
  if (!post) return false;
  const meta = { ...(post.meta_input || {}), ...(post.meta || {}) };

  // 1. Explicit post type
  if (meta.type === 'tv_episode' || meta.type === 'series') return true;
  if (meta.type === 'movie') return false;

  // 2. TV-specific metadata fields
  if (meta.show_title || meta.episode_tag || meta.season_number || meta.episode_number) return true;

  // 3. Embedded WordPress Category Taxonomy
  if (post._embedded && post._embedded['wp:term'] && Array.isArray(post._embedded['wp:term'][0])) {
    const terms = post._embedded['wp:term'][0];
    const isSeriesTerm = terms.some((t) => {
      const slug = (t.slug || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      return slug === 'series' || slug === 'tv-shows' || slug === 'tv-series' || name.includes('مسلسل');
    });
    if (isSeriesTerm) return true;

    const isMovieTerm = terms.some((t) => {
      const slug = (t.slug || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      return slug === 'movies' || name === 'أفلام' || name === 'افلام';
    });
    if (isMovieTerm) return false;
  }

  // 4. Fallback: Title or slug pattern matching (e.g. S01E01, Season 1, الحلقة 1)
  const title = (post.title?.rendered || post.title || '').trim();
  const slug = (post.slug || '').trim();
  if (/\b[sS]\d+[eE]\d+\b/i.test(title) || /\b[sS]\d+[eE]\d+\b/i.test(slug)) return true;
  if (/(?:الموسم|موسم|الحلقة|حلقة)\s*\d+/i.test(title)) return true;
  if (/^مسلسل\s+/i.test(title)) return true;

  return false;
}

/**
 * Extract streaming embed URL from post meta or content
 */
export function getMovieEmbedUrl(post) {
  if (!post) return null;
  const meta = { ...(post.meta_input || {}), ...(post.meta || {}) };

  let url = meta._stream_vidmoly ||
            meta.vidmoly_url ||
            meta.vidmoly_embed ||
            meta._stream_streamhg ||
            meta.streamhg_url ||
            meta.streamhg_embed ||
            meta._stream_hgcloud ||
            meta.hgcloud_url ||
            meta.hgcloud_embed ||
            meta._stream_streamtape ||
            meta.streamtape_url ||
            meta.streamtape_embed ||
            meta._stream_doodstream ||
            meta.doodstream_url ||
            meta.dood_embed ||
            meta.embed_url ||
            meta.embed_url_1080p ||
            meta.embed_url_720p ||
            null;

  if (!url) {
    const contentStr = post.content?.rendered || '';
    const serversMatch = contentStr.match(/<!--\s*SERVERS:\s*([\s\S]*?)-->/i);
    if (serversMatch) {
      const commentStr = serversMatch[1];
      const vMatch = commentStr.match(/\bvidmoly=(https?:\/\/[^\s>]+)/i);
      const hMatch = commentStr.match(/\b(?:streamhg|hgcloud)=(https?:\/\/[^\s>]+)/i);
      const sMatch = commentStr.match(/\bstreamtape=(https?:\/\/[^\s>]+)/i);
      const dMatch = commentStr.match(/\bdood=(https?:\/\/[^\s>]+)/i);
      url = (vMatch && vMatch[1]) || (hMatch && hMatch[1]) || (sMatch && sMatch[1]) || (dMatch && dMatch[1]);
    }
    if (!url) {
      const iframeMatch = contentStr.match(/<iframe.*?src=["']([^"']+)["'].*?<\/iframe>/i) ||
                          contentStr.match(/src=["'](https?:\/\/[^"']+)["']/i);
      if (iframeMatch) url = iframeMatch[1];
    }
  }

  return normalizeStreamHgUrl(enforceHttps(url));
}

// Arabic translation map for TMDB genres
export const GENRE_MAP_AR = {
  Action: 'أكشن',
  Adventure: 'مغامرة',
  Animation: 'رسوم متحركة',
  Comedy: 'كوميديا',
  Crime: 'جريمة',
  Documentary: 'وثائقي',
  Drama: 'دراما',
  Family: 'عائلي',
  Fantasy: 'فانتازيا',
  History: 'تاريخي',
  Horror: 'رعب',
  Music: 'موسيقى',
  Mystery: 'غموض',
  Romance: 'رومانسي',
  'Science Fiction': 'خيال علمي',
  'Sci-Fi': 'خيال علمي',
  Thriller: 'إثارة',
  War: 'حرب',
  Western: 'غرب أمريكي',
};

// Decode common HTML entities cleanly
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8230;/g, '…')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

/**
 * Parse all movie attributes with deep fallbacks across meta, title, and HTML content
 */
export function parseMovieData(post) {
  if (!post) return null;

  const rawTitle = post.title?.rendered || 'Movie';
  
  // Extract year from title if present, e.g. "The Beekeeper (2024)"
  const titleYearMatch = rawTitle.match(/\((\d{4})\)/);
  const titleExtractedYear = titleYearMatch ? titleYearMatch[1] : null;
  const cleanTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/g, '').trim();

  const content = post.content?.rendered || '';

  // 1. Release Year
  let year = post.meta?.video_year;
  if (!year && titleExtractedYear) {
    year = titleExtractedYear;
  }
  if (!year) {
    const yearMatch = content.match(/<strong>Release Year:<\/strong>\s*(\d{4})/i) || content.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) year = yearMatch[1];
  }
  if (!year) year = new Date().getFullYear().toString();

  // 2. Rating - Extract and preserve exact decimal rating (e.g. "8.5")
  let rating = post.meta?.imdb_rating || post.meta?.rating || post.meta?.vote_average || post.meta_input?.imdb_rating;
  if (!rating) {
    const ratingMatch = content.match(/<strong>Rating:<\/strong>\s*([0-9.]+)/i) || content.match(/★\s*([0-9.]+)/);
    if (ratingMatch) rating = ratingMatch[1];
  }
  if (rating) {
    const num = parseFloat(rating);
    if (!isNaN(num) && num > 0) {
      rating = num.toFixed(1);
    } else {
      rating = '7.5';
    }
  } else {
    rating = '7.5';
  }

  // 3. Quality Badge
  let quality = post.meta?.quality;
  if (!quality) {
    const qualityMatch = content.match(/<strong>Quality:<\/strong>\s*([^<\n]+)/i);
    if (qualityMatch) quality = qualityMatch[1].trim();
  }
  if (!quality) quality = '1080p Full HD';

  // 4. Multi-Server Embed & Download URLs (Vidmoly, StreamHG, Streamtape, Doodstream)
  const meta = { ...(post.meta_input || {}), ...(post.meta || {}) };

  let vidmolyUrl = meta._stream_vidmoly || meta.vidmoly_url || meta.vidmoly_embed || null;
  let streamhgUrl = meta._stream_streamhg || meta.streamhg_url || meta.streamhg_embed ||
                    meta._stream_hgcloud || meta.hgcloud_url || meta.hgcloud_embed || null;
  let streamtapeUrl = meta._stream_streamtape || meta.streamtape_url || meta.streamtape_embed || null;
  let doodstreamUrl = meta._stream_doodstream || meta.doodstream_url || meta.dood_embed || null;

  // Extract from HTML comments:
  // e.g. <!-- SERVERS: vidmoly=... streamhg=... streamtape=... dood=... -->
  // or legacy: <!-- SERVERS: dood=... streamtape=... -->
  const serversMatch = content.match(/<!--\s*SERVERS:\s*([\s\S]*?)-->/i);
  if (serversMatch) {
    const commentStr = serversMatch[1];
    const vMatch = commentStr.match(/\bvidmoly=(https?:\/\/[^\s>]+)/i);
    const hMatch = commentStr.match(/\b(?:streamhg|hgcloud)=(https?:\/\/[^\s>]+)/i);
    const sMatch = commentStr.match(/\bstreamtape=(https?:\/\/[^\s>]+)/i);
    const dMatch = commentStr.match(/\bdood=(https?:\/\/[^\s>]+)/i);

    if (!vidmolyUrl && vMatch && vMatch[1]) vidmolyUrl = vMatch[1].trim();
    if (!streamhgUrl && hMatch && hMatch[1]) streamhgUrl = hMatch[1].trim();
    if (!streamtapeUrl && sMatch && sMatch[1]) streamtapeUrl = sMatch[1].trim();
    if (!doodstreamUrl && dMatch && dMatch[1]) doodstreamUrl = dMatch[1].trim();
  }

  // Fallbacks from embed_url_1080p and embed_url_720p
  if (!vidmolyUrl && meta.embed_url_1080p && meta.embed_url_1080p.includes('vidmoly')) {
    vidmolyUrl = meta.embed_url_1080p;
  }
  if (!streamhgUrl && meta.embed_url_720p && (meta.embed_url_720p.includes('streamhg') || meta.embed_url_720p.includes('hgcloud'))) {
    streamhgUrl = meta.embed_url_720p;
  }
  if (!streamtapeUrl && meta.embed_url_720p && (meta.embed_url_720p.includes('streamtape') || meta.embed_url_720p.includes('tapecontent') || meta.embed_url_720p.includes('strtape'))) {
    streamtapeUrl = meta.embed_url_720p;
  }
  if (!doodstreamUrl && meta.embed_url_1080p && (meta.embed_url_1080p.includes('dood') || meta.embed_url_1080p.includes('ds2play') || meta.embed_url_1080p.includes('doood'))) {
    doodstreamUrl = meta.embed_url_1080p;
  }

  // Fallbacks based on fallbackEmbed domain
  const fallbackEmbed = getMovieEmbedUrl(post);
  if (fallbackEmbed && typeof fallbackEmbed === 'string') {
    const fLower = fallbackEmbed.toLowerCase();
    if (!vidmolyUrl && fLower.includes('vidmoly')) {
      vidmolyUrl = fallbackEmbed;
    } else if (!streamhgUrl && (fLower.includes('streamhg') || fLower.includes('streamhgapi') || fLower.includes('hgcloud'))) {
      streamhgUrl = fallbackEmbed;
    } else if (!streamtapeUrl && (fLower.includes('streamtape') || fLower.includes('tapecontent') || fLower.includes('strtape'))) {
      streamtapeUrl = fallbackEmbed;
    } else if (!doodstreamUrl && (fLower.includes('dood') || fLower.includes('ds2play') || fLower.includes('doood'))) {
      doodstreamUrl = fallbackEmbed;
    }
  }

  // Enforce HTTPS and normalize domains (StreamHG -> hgcloud.to/e/{code}, Vidmoly -> vidmoly.me/embed-{code}.html)
  vidmolyUrl = normalizeVidmolyUrl(enforceHttps(vidmolyUrl));
  streamhgUrl = normalizeStreamHgUrl(enforceHttps(streamhgUrl));
  streamtapeUrl = enforceHttps(streamtapeUrl);
  doodstreamUrl = enforceHttps(doodstreamUrl);

  // Set default primary player URL in order of priority:
  // primaryEmbed = vidmoly_url || streamhg_url || streamtape_url || doodstream_url || fallback_url
  const primaryEmbed = vidmolyUrl || streamhgUrl || streamtapeUrl || doodstreamUrl || fallbackEmbed || null;

  // Create clean servers array for each item:
  const servers = [
    { id: 'vidmoly', name: 'Vidmoly (1080p)', label: '🚀 سيرفر 1 (Vidmoly 1080p)', url: vidmolyUrl, fast: true },
    { id: 'streamhg', name: 'StreamHG (720p)', label: '⚡ سيرفر 2 (StreamHG 720p)', url: streamhgUrl, fast: true },
    { id: 'streamtape', name: 'Streamtape', label: '🌐 سيرفر 3 (Streamtape)', url: streamtapeUrl, fast: false },
    { id: 'doodstream', name: 'Doodstream', label: '🎬 سيرفر 4 (Doodstream)', url: doodstreamUrl, fast: false },
  ].filter(s => !!s.url).map(s => {
    let u = s.url;
    if (s.id === 'vidmoly' || u.includes('vidmoly')) u = normalizeVidmolyUrl(u);
    if (s.id === 'streamhg' || u.includes('streamhg') || u.includes('hgcloud')) u = normalizeStreamHgUrl(u);
    return { ...s, url: u };
  });

  // Fallback for older posts that have a single generic embed
  if (servers.length === 0 && primaryEmbed) {
    servers.push({
      id: 'default',
      name: 'السيرفر الأساسي',
      label: '🚀 السيرفر الأساسي',
      url: primaryEmbed,
      fast: true,
    });
  }

  // Backwards compatibility for legacy properties
  servers.server1 = primaryEmbed;
  servers.server2 = streamhgUrl || streamtapeUrl || null;

  const downloadUrl = meta.download_url || 
                      meta.downloadUrl || 
                      (doodstreamUrl && typeof doodstreamUrl === 'string' && doodstreamUrl.includes('/e/') ? doodstreamUrl.replace('/e/', '/d/') : null) ||
                      (primaryEmbed && typeof primaryEmbed === 'string' && primaryEmbed.includes('/e/') ? primaryEmbed.replace('/e/', '/d/') : null);

  // 5. Poster Image
  const posterUrl = getFeaturedImage(post);

  // 6. Professional SEO Description
  let seoDescription = post.meta?.seo_description || '';
  if (!seoDescription) {
    const seoMatch = content.match(/<div class=["']movie-seo-intro["']>\s*<p>(.*?)<\/p>/is);
    if (seoMatch) {
      seoDescription = seoMatch[1].replace(/<[^>]+>/g, '').trim();
    }
  }
  seoDescription = decodeHtmlEntities(seoDescription);

  // 7. Clean Arabic Synopsis / Story
  let synopsis = post.meta?.overview_ar || '';
  if (!synopsis) {
    const storyMatch = content.match(/<p class=["']story-text["']>(.*?)<\/p>/is);
    if (storyMatch) {
      synopsis = storyMatch[1];
    }
  }
  if (!synopsis) {
    const sectionMatch = content.match(/<div class=["']movie-story-section["']>.*?<p.*?>(.*?)<\/p>/is);
    if (sectionMatch) {
      synopsis = sectionMatch[1];
    }
  }
  if (!synopsis) {
    // Legacy fallback: strip technical tags and raw meta dumps
    synopsis = post.excerpt?.rendered || content;
    synopsis = synopsis
      .replace(/<div class="video-container".*?<\/div>/gis, '')
      .replace(/<iframe.*?<\/iframe>/gis, '')
      .replace(/<div class="movie-meta-summary".*?<\/div>/gis, '')
      .replace(/<div class="movie-seo-intro".*?<\/div>/gis, '')
      .replace(/<p><strong>(Rating|Release Year|Genres|Quality):<\/strong>.*?<\/p>/gis, '')
      .replace(/<strong>(Rating|Release Year|Genres|Quality):<\/strong>[^<\n]+/gis, '')
      .replace(/<hr\s*\/?>/gis, '')
      .trim();
  }
  synopsis = decodeHtmlEntities(synopsis.replace(/<[^>]+>/g, '').trim());

  // 8. Cast
  let cast = [];
  if (post.meta?.cast) {
    const rawCast = Array.isArray(post.meta.cast)
      ? post.meta.cast
      : String(post.meta.cast).split(/[,،]/);
    cast = rawCast.map(c => c.trim()).filter(Boolean);
  }

  // 9. Arabic Title
  const titleAr = post.meta?.title_ar || '';

  // 10. Extract Genres from embedded WordPress taxonomy, meta, or content
  let genres = [];
  if (post._embedded && post._embedded['wp:term'] && Array.isArray(post._embedded['wp:term'][0])) {
    genres = post._embedded['wp:term'][0]
      .map(t => t.name)
      .filter(name => name && name.toLowerCase() !== 'uncategorized' && name !== 'غير مصنف');
  }

  if ((!genres || genres.length === 0) && post.meta?.genres) {
    const rawList = Array.isArray(post.meta.genres)
      ? post.meta.genres
      : String(post.meta.genres).split(',');
    genres = rawList
      .map(g => g.trim())
      .map(g => GENRE_MAP_AR[g] || g)
      .filter(Boolean);
  }

  if (!genres || genres.length === 0) {
    const genreMatch = content.match(/<strong>Genres:<\/strong>\s*([^<\n]+)/i);
    if (genreMatch) {
      genres = genreMatch[1]
        .split(',')
        .map(g => g.trim())
        .map(g => GENRE_MAP_AR[g] || g)
        .filter(Boolean);
    }
  }

  // Deduplicate and ensure clean Arabic display
  genres = Array.from(new Set(genres.map(g => GENRE_MAP_AR[g] || g)));

  const secureDownloadUrl = enforceHttps(downloadUrl);
  const securePosterUrl = enforceHttps(posterUrl);
  const rawDirectStream = post.meta?.direct_stream_url ||
                          post.meta?.stream_url ||
                          post.meta?.direct_video_url ||
                          post.meta?.video_url ||
                          post.meta?.mp4_url ||
                          null;
  const secureDirectStream = enforceHttps(rawDirectStream);

  const {
    download1080_dood,
    download1080_vidmoly,
    download1080,
    download720,
    provider720,
  } = getDualQualityDownloadLinks({
    doodEmbed: doodstreamUrl,
    vidmolyEmbed: vidmolyUrl,
    streamhgEmbed: streamhgUrl,
    streamtapeEmbed: streamtapeUrl,
    servers,
    primaryEmbed,
    embed_url_1080p: meta.embed_url_1080p,
    embed_url_720p: meta.embed_url_720p,
  });

  return {
    id: post.id,
    slug: post.slug,
    rawTitle,
    cleanTitle,
    title: cleanTitle || rawTitle,
    displayTitle: cleanTitle || rawTitle,
    titleAr,
    year,
    rating,
    quality,
    genres,
    cast,
    seoDescription,
    embedUrl: primaryEmbed,
    embed_url: primaryEmbed,
    primaryEmbed: primaryEmbed,
    vidmolyEmbed: vidmolyUrl,
    streamhgEmbed: streamhgUrl,
    hgcloudEmbed: streamhgUrl,
    streamtapeEmbed: streamtapeUrl,
    doodEmbed: doodstreamUrl,
    vidmoly_url: vidmolyUrl,
    streamhg_url: streamhgUrl,
    hgcloud_url: streamhgUrl,
    streamtape_url: streamtapeUrl,
    doodstream_url: doodstreamUrl,
    embedUrl1080p: vidmolyUrl || doodstreamUrl || primaryEmbed,
    embedUrl720p: streamhgUrl || streamtapeUrl || primaryEmbed,
    servers,
    download1080_dood,
    download1080_vidmoly,
    download1080,
    download720,
    provider720,
    downloadUrl: secureDownloadUrl,
    download_url: secureDownloadUrl,
    directStreamUrl: secureDirectStream,
    stream_url: secureDirectStream,
    dood_url: doodstreamUrl || primaryEmbed || null,
    posterUrl: securePosterUrl,
    synopsis,
    categories: post.categories || [],
  };
}

// =============================================================================
// TV SERIES DATA & API ENGINE
// =============================================================================

export const CURATED_SERIES = [];

/**
 * Groups WordPress posts (episodes / series posts) into unified TV Show entities.
 * Ensures individual episodes are NEVER listed as standalone cards in the catalog.
 * Groups by show_name / series_slug and aggregates distinct seasons and episodes.
 */
export function groupPostsIntoSeries(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return [];

  const seriesMap = new Map();

  for (const post of posts) {
    if (!post) continue;
    const movie = parseMovieData(post);
    const meta = { ...(post.meta_input || {}), ...(post.meta || {}) };

    const rawTitle = movie.rawTitle || movie.title || '';
    const cleanSlug = movie.slug || '';

    // 1. Determine show_name / series_slug from explicit metadata if provided
    let seriesSlug = meta.series_slug || meta.show_slug || meta._series_slug;
    let seriesTitle = meta.series_name || meta.show_name || meta._series_name;
    let seasonNumber = parseInt(meta.season_number || meta.season || meta._season || 0, 10);
    let episodeNumber = parseInt(meta.episode_number || meta.episode || meta._episode || 0, 10);

    // 2. Parse SxxExx (e.g. S01E05 or S1E5) from title or slug
    const seMatch = (cleanSlug + ' ' + rawTitle).match(/\b[sS](\d+)[eE](\d+)\b/);
    if (seMatch) {
      if (!seasonNumber) seasonNumber = parseInt(seMatch[1], 10);
      if (!episodeNumber) episodeNumber = parseInt(seMatch[2], 10);
    }

    // Parse Arabic Season: "الموسم 2" or "موسم 2" or "الموسم الثاني"
    if (!seasonNumber) {
      const seasonMatch = rawTitle.match(/(?:الموسم|موسم|Season)\s*(\d+)/i);
      if (seasonMatch) seasonNumber = parseInt(seasonMatch[1], 10);
    }

    // Parse Arabic Episode: "الحلقة 4" or "حلقة 4"
    if (!episodeNumber) {
      const epMatch = rawTitle.match(/(?:الحلقة|حلقة|Episode|Ep)\s*(\d+)/i);
      if (epMatch) episodeNumber = parseInt(epMatch[1], 10);
    }

    // Default to season 1 / episode 1 if unparsed
    if (!seasonNumber) seasonNumber = 1;
    if (!episodeNumber) episodeNumber = 1;

    // Clean show title from episode and quality artifacts
    if (!seriesTitle) {
      let cleanName = rawTitle
        .replace(/^مسلسل\s+/i, '')
        .replace(/(?:الموسم|موسم|Season)\s*\d+/ig, '')
        .replace(/(?:الحلقة|حلقة|Episode|Ep)\s*\d+/ig, '')
        .replace(/\b[sS]\d+[eE]\d+\b/ig, '')
        .replace(/(?:مترجم|مدبلج|كامل|اون لاين|HD|FHD|1080p|720p|4K)/ig, '')
        .replace(/[-–—_:]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      seriesTitle = cleanName || movie.title;
    }

    // Clean show slug from episode/season suffix
    if (!seriesSlug) {
      let s = cleanSlug
        .replace(/-s\d+e\d+/gi, '')
        .replace(/-season-\d+/gi, '')
        .replace(/-episode-\d+/gi, '')
        .replace(/-ep-\d+/gi, '')
        .replace(/-الموسم-\d+/gi, '')
        .replace(/-الحلقة-\d+/gi, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      seriesSlug = s || movie.slug;
    }

    // Resolve or initialize the unified TV Show entity in seriesMap
    if (!seriesMap.has(seriesSlug)) {
      seriesMap.set(seriesSlug, {
        id: `wp-${seriesSlug}`,
        slug: seriesSlug,
        title: seriesTitle,
        titleAr: movie.titleAr || (rawTitle.includes('مسلسل') ? `مسلسل ${seriesTitle}` : seriesTitle),
        year: movie.year || meta.release_year || '2024',
        rating: movie.rating && movie.rating !== 'N/A' ? movie.rating : '8.5',
        status: meta.series_status || 'مكتمل',
        quality: movie.quality || '1080p Full HD',
        genres: movie.genres && movie.genres.length > 0 ? movie.genres : ['دراما', 'إثارة'],
        posterUrl: movie.posterUrl,
        poster_url: movie.posterUrl,
        backdropUrl: meta.backdrop_url || movie.posterUrl,
        backdrop_url: meta.backdrop_url || movie.posterUrl,
        synopsis: movie.synopsis || `مشاهدة وتحميل جميع مواسم وحلقات مسلسل ${seriesTitle} مترجم كامل بجودة عالية 1080p FHD على منصة EgyMax.`,
        overview: movie.synopsis || `مشاهدة وتحميل جميع مواسم وحلقات مسلسل ${seriesTitle} مترجم كامل بجودة عالية 1080p FHD على منصة EgyMax.`,
        cast: movie.cast || [],
        seasonsMap: new Map(),
      });
    }

    const show = seriesMap.get(seriesSlug);

    // Resolve or initialize the season in seasonsMap
    if (!show.seasonsMap.has(seasonNumber)) {
      show.seasonsMap.set(seasonNumber, {
        seasonNumber,
        season_number: seasonNumber,
        title: `الموسم ${seasonNumber}`,
        episodes: [],
      });
    }

    const seasonObj = show.seasonsMap.get(seasonNumber);
    // Add episode if not already present
    if (!seasonObj.episodes.some((e) => e.episodeNumber === episodeNumber)) {
      const epQualities = [];
      if (movie.vidmolyEmbed || movie.doodEmbed || (movie.quality && movie.quality.includes('1080'))) {
        epQualities.push('1080p FHD');
      }
      if (movie.streamhgEmbed || movie.streamtapeEmbed || (movie.quality && movie.quality.includes('720'))) {
        epQualities.push('720p HD');
      }
      if (epQualities.length === 0) {
        epQualities.push(movie.quality || '1080p FHD');
      }

      const watchUrl = `/series/${seriesSlug}/s${seasonNumber}e${episodeNumber}`;

      seasonObj.episodes.push({
        id: `ep-${post.id || `${seriesSlug}-s${seasonNumber}e${episodeNumber}`}`,
        episodeNumber,
        episode_number: episodeNumber,
        seasonNumber,
        season_number: seasonNumber,
        title: `الحلقة ${episodeNumber}`,
        slug: movie.slug || `${seriesSlug}-s${seasonNumber}e${episodeNumber}`,
        watch_url: watchUrl,
        watchUrl: watchUrl,
        duration: meta.duration || '45 دقيقة',
        servers: movie.servers || [],
        qualities: epQualities,
        quality: movie.quality || '1080p FHD',
        primaryEmbed: movie.primaryEmbed || movie.embedUrl,
        vidmolyEmbed: movie.vidmolyEmbed,
        streamhgEmbed: movie.streamhgEmbed,
        hgcloudEmbed: movie.streamhgEmbed,
        doodEmbed: movie.doodEmbed,
        streamtapeEmbed: movie.streamtapeEmbed,
        embedUrl: movie.embedUrl || movie.primaryEmbed || movie.vidmolyEmbed || movie.doodEmbed,
        download1080_dood: movie.download1080_dood,
        download720: movie.download720,
        download1080_vidmoly: movie.download1080_vidmoly || (movie.vidmolyEmbed ? getVidmolyDownloadUrl(movie.vidmolyEmbed) : null),
        synopsis: movie.synopsis,
      });
    }
  }

  // Convert each show's seasonsMap into sorted arrays and calculate totals
  return Array.from(seriesMap.values()).map((show) => {
    const seasons = Array.from(show.seasonsMap.values())
      .map((s) => {
        s.season_number = s.seasonNumber;
        s.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
        return s;
      })
      .sort((a, b) => a.seasonNumber - b.seasonNumber);

    const totalEpisodes = seasons.reduce((acc, s) => acc + s.episodes.length, 0);

    return {
      ...show,
      seasonsCount: seasons.length || 1,
      episodesCount: totalEpisodes || 1,
      seasons: seasons.length > 0 ? seasons : [
        {
          seasonNumber: 1,
          season_number: 1,
          title: 'الموسم الأول',
          episodes: [
            {
              episodeNumber: 1,
              episode_number: 1,
              seasonNumber: 1,
              season_number: 1,
              title: 'الحلقة 1',
              slug: `${show.slug}-s01e01`,
              watch_url: `/series/${show.slug}/s1e1`,
              watchUrl: `/series/${show.slug}/s1e1`,
              duration: '45 دقيقة',
              servers: [],
              qualities: ['1080p FHD'],
              quality: '1080p FHD',
              embedUrl: null,
            },
          ],
        },
      ],
    };
  });
}

/**
 * Fetch series list with optional search and category filters.
 * Returns unique TV Show entities (never individual episodes).
 * Returns empty array [] if no real series are fetched from WP.
 */
export async function getSeriesList({ search = '', category = null } = {}) {
  let list = [];

  // Query WordPress for any posts related to series/episodes
  try {
    const wpPosts = await searchMovies({
      search: search ? `${search} مسلسل` : 'مسلسل',
      perPage: 50,
    });

    if (Array.isArray(wpPosts) && wpPosts.length > 0) {
      const dynamicSeries = groupPostsIntoSeries(wpPosts);
      list.push(...dynamicSeries);
    }
  } catch (err) {
    console.warn('[Series API] WP series query notice:', err.message);
  }

  // Filter by search query
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      (s.titleAr && s.titleAr.includes(q)) ||
      (s.synopsis && s.synopsis.includes(q))
    );
  }

  // Filter by genre/category
  if (category && category.trim()) {
    const cat = category.trim();
    list = list.filter((s) =>
      s.genres.some((g) => g.toLowerCase() === cat.toLowerCase() || g === cat)
    );
  }

  return list;
}

/**
 * Fetch a single series by slug with complete seasons and episodes.
 * Aggregates individual episode posts into a unified TV Series Object.
 */
export async function getSeriesBySlug(slug) {
  if (!slug) return null;

  const targetSlug = slug.toLowerCase().trim();

  try {
    // 1. If direct post by slug exists and is already a complete series with seasons
    const directPost = await getMovieBySlug(targetSlug);
    if (directPost && directPost.seasons && Array.isArray(directPost.seasons) && directPost.seasons.length > 0) {
      return directPost;
    }

    // 2. Fetch candidate episode posts from WordPress
    // Fetch via search, and also fetch recent posts to guarantee full episode retrieval
    const cleanSearchQuery = targetSlug.replace(/-/g, ' ');
    const [searchPosts, recentPosts] = await Promise.all([
      searchMovies({ search: cleanSearchQuery, perPage: 50 }).catch(() => []),
      fetchAPI('posts?per_page=100&_embed').catch(() => []),
    ]);

    const candidatePosts = [];
    const seenIds = new Set();

    if (directPost && directPost.id) {
      seenIds.add(directPost.id);
      candidatePosts.push(directPost);
    }

    for (const p of [...(searchPosts || []), ...(recentPosts || [])]) {
      if (p && p.id && !seenIds.has(p.id)) {
        seenIds.add(p.id);
        candidatePosts.push(p);
      }
    }

    // 3. Filter posts belonging to this TV Show
    const matchingEpisodePosts = candidatePosts.filter((post) => {
      if (!post) return false;
      const meta = { ...(post.meta_input || {}), ...(post.meta || {}) };
      const postSlug = (post.slug || '').toLowerCase();
      const postTitle = (post.title?.rendered || '').toLowerCase();

      // Explicit meta match
      if (meta.show_slug && meta.show_slug.toLowerCase() === targetSlug) return true;
      if (meta.series_slug && meta.series_slug.toLowerCase() === targetSlug) return true;

      // Slug prefix match: e.g. "breaking-bad-s01e01" begins with "breaking-bad"
      if (postSlug === targetSlug || postSlug.startsWith(`${targetSlug}-`) || postSlug.startsWith(targetSlug)) return true;

      // Title match: e.g. "Breaking Bad S01E01" begins with "breaking bad"
      if (postTitle.startsWith(cleanSearchQuery) || postTitle.includes(cleanSearchQuery)) return true;

      // Check parsed series slug from movie data
      const parsedSlug = postSlug
        .replace(/-s\d+e\d+/gi, '')
        .replace(/-season-\d+/gi, '')
        .replace(/-episode-\d+/gi, '')
        .replace(/-ep-\d+/gi, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (parsedSlug === targetSlug) return true;

      return false;
    });

    if (matchingEpisodePosts.length > 0) {
      const groupedSeries = groupPostsIntoSeries(matchingEpisodePosts);
      const matched =
        groupedSeries.find(
          (s) =>
            s.slug.toLowerCase() === targetSlug ||
            targetSlug.startsWith(s.slug.toLowerCase()) ||
            s.slug.toLowerCase().startsWith(targetSlug)
        ) || groupedSeries[0];

      if (matched) {
        matched.slug = targetSlug;
        return matched;
      }
    }
  } catch (err) {
    console.warn('[Series API] WP getSeriesBySlug notice:', err.message);
  }

  return null;
}

