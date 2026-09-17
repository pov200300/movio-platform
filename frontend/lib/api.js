// Base URL for WordPress REST API (supports standard /wp-json/wp/v2 or index.php?rest_route=/wp/v2)
const WP_API_URL = (
  process.env.NEXT_PUBLIC_WORDPRESS_API_URL ||
  process.env.WORDPRESS_INTERNAL_URL ||
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
 * Fetch generic data from WordPress REST API
 */
export async function fetchAPI(endpoint, { method = 'GET', body = null } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };

  const url = buildApiUrl(endpoint);

  const options = {
    method,
    headers,
    // Use Next.js Incremental Static Regeneration (ISR) revalidation
    next: { revalidate: 60 },
    // Prevent build hangs if backend host is unreachable
    signal: AbortSignal.timeout(5000),
  };

  if (body) {
    options.body = JSON.stringify(body);
    delete options.next;
    options.cache = 'no-store';
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
export async function getLatestMovies(limit = 10) {
  const posts = await fetchAPI(`posts?per_page=${limit}&_embed`);
  return posts;
}

/**
 * Fetch a single movie by its slug
 */
export async function getMovieBySlug(slug) {
  const posts = await fetchAPI(`posts?slug=${slug}&_embed`);
  return posts && posts.length > 0 ? posts[0] : null;
}

/**
 * Fetch all categories
 */
export async function getCategories() {
  return await fetchAPI('categories?hide_empty=true');
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

