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
 * Fetch latest movies (posts)
 */
export async function getLatestMovies(limit = 18) {
  const posts = await fetchAPI(`posts?per_page=${limit}&_embed`);
  return Array.isArray(posts) ? posts : [];
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
 * Extract featured image URL from an embedded WP post object or fallback
 */
export function getFeaturedImage(post) {
  if (!post) return '/placeholder.jpg';
  let img = '/placeholder.jpg';
  if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]?.source_url) {
    img = post._embedded['wp:featuredmedia'][0].source_url;
  } else if (post.meta?.backdrop_url) {
    img = post.meta.backdrop_url;
  }
  return enforceHttps(img);
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

export const CURATED_SERIES = [
  {
    id: 'series-breaking-bad',
    slug: 'breaking-bad',
    title: 'Breaking Bad',
    titleAr: 'اختلال ضال',
    year: '2008 - 2013',
    rating: '9.5',
    status: 'مكتمل',
    quality: '1080p Full HD',
    genres: ['جريمة', 'دراما', 'إثارة'],
    seasonsCount: 5,
    episodesCount: 62,
    posterUrl: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    synopsis: 'مدرس كيمياء في المدرسة الثانوية يُشخص بسرطان الرئة في مرحلة متقدمة، فيتحول إلى تصنيع وبيع الميثامفيتامين لتأمين مستقبل عائلته المالي.',
    cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn', 'Dean Norris'],
    seasons: [
      {
        seasonNumber: 1,
        title: 'الموسم الأول',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - البداية',
            duration: '58 دقيقة',
            doodEmbed: 'https://doodstream.com/e/bb_s01e01',
            streamtapeEmbed: 'https://streamtape.com/e/bb_s01e01',
            embedUrl: 'https://doodstream.com/e/bb_s01e01',
            synopsis: 'والتر وايت مدرس كيمياء يكتشف إصابته بالسرطان ويتعاون مع طالبه السابق جيسي بينكمان.'
          },
          {
            episodeNumber: 2,
            title: 'الحلقة 2 - القطة في الحقيبة',
            duration: '48 دقيقة',
            doodEmbed: 'https://doodstream.com/e/bb_s01e02',
            streamtapeEmbed: 'https://streamtape.com/e/bb_s01e02',
            embedUrl: 'https://doodstream.com/e/bb_s01e02',
            synopsis: 'يحاول والتر وجيسي التخلص من جثتين بعد مواجهتهما الأولى الكارثية.'
          },
          {
            episodeNumber: 3,
            title: 'الحلقة 3 - ونفاد الحيلة',
            duration: '48 دقيقة',
            doodEmbed: 'https://doodstream.com/e/bb_s01e03',
            streamtapeEmbed: 'https://streamtape.com/e/bb_s01e03',
            embedUrl: 'https://doodstream.com/e/bb_s01e03',
            synopsis: 'والتر يواجه قراراً مصيرياً وأخلاقياً بشأن مصير كريزي-8 المحتجز في القبو.'
          },
          {
            episodeNumber: 4,
            title: 'الحلقة 4 - علاج السرطان',
            duration: '47 دقيقة',
            doodEmbed: 'https://doodstream.com/e/bb_s01e04',
            streamtapeEmbed: 'https://streamtape.com/e/bb_s01e04',
            embedUrl: 'https://doodstream.com/e/bb_s01e04',
            synopsis: 'عائلة والتر تضغط عليه لقبول التمويل لعلاجه الكيميائي، بينما يعود جيسي لمنزل عائلته.'
          }
        ]
      },
      {
        seasonNumber: 2,
        title: 'الموسم الثاني',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - السبعة وسبعة وثلاثون',
            duration: '47 دقيقة',
            doodEmbed: 'https://doodstream.com/e/bb_s02e01',
            streamtapeEmbed: 'https://streamtape.com/e/bb_s02e01',
            embedUrl: 'https://doodstream.com/e/bb_s02e01',
            synopsis: 'والتر وجيسي يدركان مدى خطورة توكو سالامانكا ويخططان للتخلص منه.'
          },
          {
            episodeNumber: 2,
            title: 'الحلقة 2 - مشوي',
            duration: '48 دقيقة',
            doodEmbed: 'https://doodstream.com/e/bb_s02e02',
            streamtapeEmbed: 'https://streamtape.com/e/bb_s02e02',
            embedUrl: 'https://doodstream.com/e/bb_s02e02',
            synopsis: 'توكو يختطف والتر وجيسي ويأخذهما إلى مخبأ في الصحراء حيث يلتقيان بعمه هيكتور.'
          }
        ]
      }
    ]
  },
  {
    id: 'series-game-of-thrones',
    slug: 'game-of-thrones',
    title: 'Game of Thrones',
    titleAr: 'صراع العروش',
    year: '2011 - 2019',
    rating: '9.2',
    status: 'مكتمل',
    quality: '1080p Full HD',
    genres: ['فانتازيا', 'دراما', 'مغامرة'],
    seasonsCount: 8,
    episodesCount: 73,
    posterUrl: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/original/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg',
    synopsis: 'تسع عائلات نبيلة تتقاتل من أجل السيطرة على أراضي ويستروس، بينما يستيقظ عدو قديم بعد أن ظل خامداً لآلاف السنين.',
    cast: ['Emilia Clarke', 'Kit Harington', 'Peter Dinklage', 'Lena Headey'],
    seasons: [
      {
        seasonNumber: 1,
        title: 'الموسم الأول',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - الشتاء قادم',
            duration: '62 دقيقة',
            doodEmbed: 'https://doodstream.com/e/got_s01e01',
            streamtapeEmbed: 'https://streamtape.com/e/got_s01e01',
            embedUrl: 'https://doodstream.com/e/got_s01e01',
            synopsis: 'الملك روبرت براثيون يزور وينترفيل ليطلب من إيدارد ستارك أن يصبح يد الملك الجديد.'
          },
          {
            episodeNumber: 2,
            title: 'الحلقة 2 - طريق الملك',
            duration: '56 دقيقة',
            doodEmbed: 'https://doodstream.com/e/got_s01e02',
            streamtapeEmbed: 'https://streamtape.com/e/got_s01e02',
            embedUrl: 'https://doodstream.com/e/got_s01e02',
            synopsis: 'ند ستارك وبناته يتجهون جنوباً نحو كينغز لاندينغ، بينما ينضم جون سنو إلى حرس الليل.'
          },
          {
            episodeNumber: 3,
            title: 'الحلقة 3 - اللورد سنو',
            duration: '57 دقيقة',
            doodEmbed: 'https://doodstream.com/e/got_s01e03',
            streamtapeEmbed: 'https://streamtape.com/e/got_s01e03',
            embedUrl: 'https://doodstream.com/e/got_s01e03',
            synopsis: 'ند يصل إلى كينغز لاندينغ ويصدم بالديون والفساد في البلاط الملكي.'
          }
        ]
      }
    ]
  },
  {
    id: 'series-house-of-the-dragon',
    slug: 'house-of-the-dragon',
    title: 'House of the Dragon',
    titleAr: 'آل التنين',
    year: '2022 - الآن',
    rating: '8.5',
    status: 'مستمر',
    quality: '1080p Full HD',
    genres: ['فانتازيا', 'دراما', 'أكشن'],
    seasonsCount: 2,
    episodesCount: 18,
    posterUrl: 'https://image.tmdb.org/t/p/w500/t9Xke5724fqW3429IOP0q994NcK.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/original/etj8E2o0Bud0HkONVQPjyCkIvpv.jpg',
    synopsis: 'قبل 200 عام من أحداث صراع العروش، تبدأ حرب أهلية مدمرة داخل آل تارغاريان تُعرف باسم رقصة التنانين للسيطرة على العرش الحديدي.',
    cast: ['Matt Smith', 'Emma D\'Arcy', 'Olivia Cooke', 'Rhys Ifans'],
    seasons: [
      {
        seasonNumber: 1,
        title: 'الموسم الأول',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - ورثة التنين',
            duration: '66 دقيقة',
            doodEmbed: 'https://doodstream.com/e/hotd_s01e01',
            streamtapeEmbed: 'https://streamtape.com/e/hotd_s01e01',
            embedUrl: 'https://doodstream.com/e/hotd_s01e01',
            synopsis: 'الملك فيسيريس ينظم بطولة للاحتفال بولادة طفله المنتظر، بينما يختار خليفته على العرش.'
          },
          {
            episodeNumber: 2,
            title: 'الحلقة 2 - الأمير المارق',
            duration: '54 دقيقة',
            doodEmbed: 'https://doodstream.com/e/hotd_s01e02',
            streamtapeEmbed: 'https://streamtape.com/e/hotd_s01e02',
            embedUrl: 'https://doodstream.com/e/hotd_s01e02',
            synopsis: 'الأميرة رينيرا تتحدى رغبة والدها في اختيار زوج جديد وتواجه عمها ديمون في دراغونستون.'
          }
        ]
      }
    ]
  },
  {
    id: 'series-stranger-things',
    slug: 'stranger-things',
    title: 'Stranger Things',
    titleAr: 'أشياء غريبة',
    year: '2016 - 2025',
    rating: '8.7',
    status: 'مستمر',
    quality: '1080p Full HD',
    genres: ['خيال علمي', 'رعب', 'غموض'],
    seasonsCount: 4,
    episodesCount: 34,
    posterUrl: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg',
    synopsis: 'في بلدة هوكينز بولاية إنديانا، يختفي صبي صغير في ظروف غامضة، فتكشف التحقيقات عن تجارب سرية وقوى خارقة وفتاة غريبة الأطوار.',
    cast: ['Millie Bobby Brown', 'Finn Wolfhard', 'Winona Ryder', 'David Harbour'],
    seasons: [
      {
        seasonNumber: 1,
        title: 'الموسم الأول',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - اختفاء ويل بايرز',
            duration: '48 دقيقة',
            doodEmbed: 'https://doodstream.com/e/st_s01e01',
            streamtapeEmbed: 'https://streamtape.com/e/st_s01e01',
            embedUrl: 'https://doodstream.com/e/st_s01e01',
            synopsis: 'في طريق عودته إلى المنزل، يواجه ويل شيئاً مرعباً في الظلام ويختفي بلا أثر.'
          },
          {
            episodeNumber: 2,
            title: 'الحلقة 2 - الفتاة الغريبة في مابل ستريت',
            duration: '55 دقيقة',
            doodEmbed: 'https://doodstream.com/e/st_s01e02',
            streamtapeEmbed: 'https://streamtape.com/e/st_s01e02',
            embedUrl: 'https://doodstream.com/e/st_s01e02',
            synopsis: 'يعثر الأصدقاء على فتاة حليقة الرأس في الغابة، بينما تبحث جويس عن ابنها بيأس.'
          }
        ]
      }
    ]
  },
  {
    id: 'series-chernobyl',
    slug: 'chernobyl',
    title: 'Chernobyl',
    titleAr: 'تشرنوبل',
    year: '2019',
    rating: '9.4',
    status: 'مكتمل',
    quality: '1080p Full HD',
    genres: ['دراما', 'تاريخي', 'إثارة'],
    seasonsCount: 1,
    episodesCount: 5,
    posterUrl: 'https://image.tmdb.org/t/p/w500/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/original/uL6AdB5CqR66h3c2d4wZl2Q9fTz.jpg',
    synopsis: 'في أبريل 1986، وقع انفجار هائل في محطة تشرنوبل للطاقة النووية في الاتحاد السوفيتي، مما أدى إلى واحدة من أسوأ الكوارث التي صنعها الإنسان.',
    cast: ['Jared Harris', 'Stellan Skarsgård', 'Emily Watson'],
    seasons: [
      {
        seasonNumber: 1,
        title: 'الموسم الأول (مسلسل قصير)',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - 1:23:45',
            duration: '59 دقيقة',
            doodEmbed: 'https://doodstream.com/e/chernobyl_e01',
            streamtapeEmbed: 'https://streamtape.com/e/chernobyl_e01',
            embedUrl: 'https://doodstream.com/e/chernobyl_e01',
            synopsis: 'ينفجر المفاعل رقم 4 في محطة تشرنوبل للطاقة النووية، ويحاول العمال احتواء الحريق غير مدركين لحجم الكارثة الإشعاعية.'
          },
          {
            episodeNumber: 2,
            title: 'الحلقة 2 - الرجاء الهدوء',
            duration: '65 دقيقة',
            doodEmbed: 'https://doodstream.com/e/chernobyl_e02',
            streamtapeEmbed: 'https://streamtape.com/e/chernobyl_e02',
            embedUrl: 'https://doodstream.com/e/chernobyl_e02',
            synopsis: 'فاليري ليجاسوف ويولانا خوميوك يحذران الحكومة السوفيتية من عواقب الانفجار الثاني المحتمل.'
          }
        ]
      }
    ]
  },
  {
    id: 'series-loki',
    slug: 'loki',
    title: 'Loki',
    titleAr: 'لوكي',
    year: '2021 - 2023',
    rating: '8.2',
    status: 'مكتمل',
    quality: '1080p Full HD',
    genres: ['أكشن', 'مغامرة', 'خيال علمي'],
    seasonsCount: 2,
    episodesCount: 12,
    posterUrl: 'https://image.tmdb.org/t/p/w500/voHUmlvjysvgFdnFiFrnfF31Drq.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/original/bZGAX8oMDm3Mo5i0ZPKh9G2hcaO.jpg',
    synopsis: 'بعد سرقة التيسراكت، يتم القبض على لوكي من قبل منظمة تباين الوقت الغامضة ويُجبر على إصلاح الخطوط الزمنية المتفرعة.',
    cast: ['Tom Hiddleston', 'Owen Wilson', 'Sophia Di Martino', 'Ke Huy Quan'],
    seasons: [
      {
        seasonNumber: 1,
        title: 'الموسم الأول',
        episodes: [
          {
            episodeNumber: 1,
            title: 'الحلقة 1 - الهدف المجيد',
            duration: '51 دقيقة',
            doodEmbed: 'https://doodstream.com/e/loki_s01e01',
            streamtapeEmbed: 'https://streamtape.com/e/loki_s01e01',
            embedUrl: 'https://doodstream.com/e/loki_s01e01',
            synopsis: 'لوكي يجد نفسه أمام محكمة منظمة تباين الوقت (TVA) ويكتشف حقيقة القوى الكونية التي تحكم الزمن.'
          }
        ]
      }
    ]
  }
];

/**
 * Fetch series list with optional search and category filters
 */
export async function getSeriesList({ search = '', category = null } = {}) {
  let list = [...CURATED_SERIES];

  // Also query WordPress for any posts containing "مسلسل" or "series"
  try {
    const wpPosts = await searchMovies({ search: search ? `${search} مسلسل` : 'مسلسل', perPage: 12 });
    if (Array.isArray(wpPosts) && wpPosts.length > 0) {
      const dynamicSeries = wpPosts.map(post => {
        const movie = parseMovieData(post);
        return {
          id: `wp-${movie.id}`,
          slug: movie.slug,
          title: movie.title,
          titleAr: movie.titleAr || movie.title,
          year: movie.year,
          rating: movie.rating,
          status: 'مستمر',
          quality: movie.quality,
          genres: movie.genres.length > 0 ? movie.genres : ['دراما'],
          seasonsCount: 1,
          episodesCount: 1,
          posterUrl: movie.posterUrl,
          backdropUrl: movie.posterUrl,
          synopsis: movie.synopsis,
          cast: movie.cast,
          seasons: [
            {
              seasonNumber: 1,
              title: 'الموسم الأول',
              episodes: [
                {
                  episodeNumber: 1,
                  title: 'الحلقة 1',
                  duration: '45 دقيقة',
                  servers: movie.servers,
                  primaryEmbed: movie.primaryEmbed,
                  vidmolyEmbed: movie.vidmolyEmbed,
                  streamhgEmbed: movie.streamhgEmbed,
                  hgcloudEmbed: movie.streamhgEmbed,
                  doodEmbed: movie.doodEmbed,
                  streamtapeEmbed: movie.streamtapeEmbed,
                  embedUrl: movie.embedUrl,
                  synopsis: movie.synopsis
                }
              ]
            }
          ]
        };
      });

      // Avoid duplicates
      for (const ds of dynamicSeries) {
        if (!list.some(s => s.slug === ds.slug)) {
          list.unshift(ds);
        }
      }
    }
  } catch (err) {
    console.warn('[Series API] WP series query notice:', err.message);
  }

  // Filter by search query
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(s => 
      s.title.toLowerCase().includes(q) ||
      (s.titleAr && s.titleAr.includes(q)) ||
      (s.synopsis && s.synopsis.includes(q))
    );
  }

  // Filter by genre/category
  if (category && category.trim()) {
    const cat = category.trim();
    list = list.filter(s => 
      s.genres.some(g => g.toLowerCase() === cat.toLowerCase() || g === cat)
    );
  }

  return list;
}

/**
 * Fetch a single series by slug with complete seasons and episodes
 */
export async function getSeriesBySlug(slug) {
  if (!slug) return null;

  // 1. Search in curated list
  const found = CURATED_SERIES.find(s => s.slug === slug);
  if (found) return found;

  // 2. Search in WordPress
  try {
    const post = await getMovieBySlug(slug);
    if (post) {
      const movie = parseMovieData(post);
      return {
        id: `wp-${movie.id}`,
        slug: movie.slug,
        title: movie.title,
        titleAr: movie.titleAr || movie.title,
        year: movie.year,
        rating: movie.rating,
        status: 'مستمر',
        quality: movie.quality,
        genres: movie.genres.length > 0 ? movie.genres : ['دراما'],
        seasonsCount: 1,
        episodesCount: 1,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.posterUrl,
        synopsis: movie.synopsis,
        cast: movie.cast,
        seasons: [
          {
            seasonNumber: 1,
            title: 'الموسم الأول',
            episodes: [
              {
                episodeNumber: 1,
                title: 'الحلقة 1',
                duration: '45 دقيقة',
                servers: movie.servers,
                primaryEmbed: movie.primaryEmbed,
                vidmolyEmbed: movie.vidmolyEmbed,
                streamhgEmbed: movie.streamhgEmbed,
                hgcloudEmbed: movie.streamhgEmbed,
                doodEmbed: movie.doodEmbed,
                streamtapeEmbed: movie.streamtapeEmbed,
                embedUrl: movie.embedUrl,
                synopsis: movie.synopsis
              }
            ]
          }
        ]
      };
    }
  } catch (err) {
    console.warn('[Series API] WP getSeriesBySlug notice:', err.message);
  }

  return null;
}

