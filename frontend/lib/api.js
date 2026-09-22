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
  const iframeMatch = contentStr.match(/<iframe.*?src=["']([^"']+)["'].*?<\/iframe>/i) ||
                      contentStr.match(/src=["'](https?:\/\/[^"']+)["']/i);
  if (iframeMatch) return iframeMatch[1];

  return null;
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

  // 4. Embed & Download URLs
  const embedUrl = getMovieEmbedUrl(post);
  const downloadUrl = post.meta?.download_url || 
                      post.meta?.downloadUrl || 
                      (embedUrl && typeof embedUrl === 'string' && embedUrl.includes('/e/') ? embedUrl.replace('/e/', '/d/') : null);

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
    embedUrl,
    embed_url: embedUrl,
    downloadUrl,
    download_url: downloadUrl,
    directStreamUrl: post.meta?.direct_stream_url ||
                     post.meta?.stream_url ||
                     post.meta?.direct_video_url ||
                     post.meta?.video_url ||
                     post.meta?.mp4_url ||
                     null,
    stream_url: post.meta?.stream_url || post.meta?.direct_stream_url || null,
    dood_url: post.meta?.dood_url || post.meta?.dood_embed || embedUrl || null,
    posterUrl,
    synopsis,
    categories: post.categories || [],
  };
}

