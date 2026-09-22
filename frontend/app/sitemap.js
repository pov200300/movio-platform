const WP_API_URL = (
  process.env.NEXT_PUBLIC_WORDPRESS_API_URL ||
  'https://dev-movio-stream.pantheonsite.io/wp-json/wp/v2'
).replace(/\/+$/, '');

const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://egymax.vercel.app'
).replace(/\/+$/, '');

export const revalidate = 3600; // Revalidate sitemap at most once per hour

/**
 * Robust fetch helper for sitemap generation with ISR caching & timeout protection
 */
async function fetchFromWordPress(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = WP_API_URL.includes('rest_route=')
    ? `${WP_API_URL}/${cleanEndpoint.replace('?', '&')}`
    : `${WP_API_URL}/${cleanEndpoint}`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; EGYMAX-Sitemap/1.0; +https://egymax.vercel.app)',
    },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`WordPress API returned HTTP ${res.status}: ${res.statusText}`);
  }

  return await res.json();
}

/**
 * Generate XML sitemap for search engines
 */
export default async function sitemap() {
  const now = new Date();

  // 1. Static Core Routes
  const staticRoutes = [
    {
      url: `${BASE_URL}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/movies`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/categories`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // 2. Dynamic Movie Routes from WordPress REST API
  let movieRoutes = [];
  try {
    const posts = await fetchFromWordPress('posts?per_page=100&_fields=id,slug,modified');
    if (Array.isArray(posts) && posts.length > 0) {
      movieRoutes = posts
        .filter((post) => Boolean(post && post.slug))
        .map((post) => ({
          url: `${BASE_URL}/movie/${post.slug}`,
          lastModified: post.modified ? new Date(post.modified) : now,
          changeFrequency: 'weekly',
          priority: 0.8,
        }));
    }
  } catch (err) {
    console.error('[SITEMAP] Warning: Failed to fetch movie posts from WordPress:', err.message);
  }

  // 3. Dynamic Category Routes from WordPress REST API
  let categoryRoutes = [];
  try {
    const categories = await fetchFromWordPress('categories?per_page=100&_fields=id,slug&hide_empty=true');
    if (Array.isArray(categories) && categories.length > 0) {
      categoryRoutes = categories
        .filter((cat) => Boolean(cat && cat.slug && cat.slug !== 'uncategorized'))
        .map((cat) => ({
          url: `${BASE_URL}/category/${cat.slug}`,
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.7,
        }));
    }
  } catch (err) {
    console.error('[SITEMAP] Warning: Failed to fetch categories from WordPress:', err.message);
  }

  // 4. Return combined sitemap entries (static fallback always preserved)
  return [...staticRoutes, ...categoryRoutes, ...movieRoutes];
}
