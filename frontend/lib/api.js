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
 * Extract featured image URL from an embedded WP post object or fallback
 */
export function getFeaturedImage(post) {
  if (!post) return '/placeholder.jpg';
  if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]?.source_url) {
    return post._embedded['wp:featuredmedia'][0].source_url;
  }
  if (post.meta?.backdrop_url) return post.meta.backdrop_url;
  return '/placeholder.jpg';
}

/**
 * Extract streaming embed URL from post meta or content
 */
export function getMovieEmbedUrl(post) {
  if (!post) return null;
  if (post.meta?.embed_url) return post.meta.embed_url;
  if (post.meta?.dood_embed) return post.meta.dood_embed;

  const contentStr = post.content?.rendered || '';
  const iframeMatch = contentStr.match(/<iframe.*?src="([^"]+)".*?<\/iframe>/i);
  if (iframeMatch) return iframeMatch[1];

  return null;
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

  // 2. Rating
  let rating = post.meta?.imdb_rating;
  if (!rating) {
    const ratingMatch = content.match(/<strong>Rating:<\/strong>\s*([0-9.]+)/i) || content.match(/★\s*([0-9.]+)/);
    if (ratingMatch) rating = ratingMatch[1];
  }
  if (!rating) rating = '8.0';

  // 3. Quality Badge
  let quality = post.meta?.quality;
  if (!quality) {
    const qualityMatch = content.match(/<strong>Quality:<\/strong>\s*([^<\n]+)/i);
    if (qualityMatch) quality = qualityMatch[1].trim();
  }
  if (!quality) quality = '1080p Full HD';

  // 4. Embed URL
  const embedUrl = getMovieEmbedUrl(post);

  // 5. Poster Image
  const posterUrl = getFeaturedImage(post);

  // 6. Synopsis
  let synopsis = post.excerpt?.rendered || content;
  synopsis = synopsis
    .replace(/<div class="video-container".*?<\/div>/gis, '')
    .replace(/<iframe.*?<\/iframe>/gis, '')
    .trim();

  return {
    id: post.id,
    slug: post.slug,
    rawTitle,
    cleanTitle,
    displayTitle: cleanTitle || rawTitle,
    year,
    rating,
    quality,
    embedUrl,
    posterUrl,
    synopsis,
    categories: post.categories || [],
  };
}

