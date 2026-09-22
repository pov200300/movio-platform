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

  // 4. Multi-Server Embed & Download URLs
  const embedUrl = getMovieEmbedUrl(post);

  let doodEmbed = post.meta?.dood_embed || post.meta?.embed_url_1080p || null;
  let streamtapeEmbed = post.meta?.streamtape_embed || post.meta?.embed_url_720p || null;

  // Extract from HTML comment: <!-- SERVERS: dood=... streamtape=... -->
  if (!doodEmbed || !streamtapeEmbed) {
    const serversMatch = content.match(/<!--\s*SERVERS:\s*dood=(.*?)\s+streamtape=(.*?)\s*-->/i);
    if (serversMatch) {
      if (!doodEmbed && serversMatch[1] && serversMatch[1].trim()) {
        doodEmbed = serversMatch[1].trim();
      }
      if (!streamtapeEmbed && serversMatch[2] && serversMatch[2].trim()) {
        streamtapeEmbed = serversMatch[2].trim();
      }
    }
  }

  // Fallbacks based on embed domain
  if (!doodEmbed && embedUrl && (embedUrl.includes('dood') || embedUrl.includes('ds2play') || embedUrl.includes('doood'))) {
    doodEmbed = embedUrl;
  }
  if (!streamtapeEmbed && embedUrl && (embedUrl.includes('streamtape') || embedUrl.includes('tapecontent') || embedUrl.includes('strtape'))) {
    streamtapeEmbed = embedUrl;
  }

  const downloadUrl = post.meta?.download_url || 
                      post.meta?.downloadUrl || 
                      (doodEmbed && typeof doodEmbed === 'string' && doodEmbed.includes('/e/') ? doodEmbed.replace('/e/', '/d/') : null) ||
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
    doodEmbed,
    streamtapeEmbed,
    embedUrl1080p: doodEmbed || embedUrl,
    embedUrl720p: streamtapeEmbed || embedUrl,
    servers: {
      server1: doodEmbed || embedUrl,
      server2: streamtapeEmbed || null,
    },
    downloadUrl,
    download_url: downloadUrl,
    directStreamUrl: post.meta?.direct_stream_url ||
                     post.meta?.stream_url ||
                     post.meta?.direct_video_url ||
                     post.meta?.video_url ||
                     post.meta?.mp4_url ||
                     null,
    stream_url: post.meta?.stream_url || post.meta?.direct_stream_url || null,
    dood_url: doodEmbed || post.meta?.dood_url || post.meta?.dood_embed || embedUrl || null,
    posterUrl,
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

