import { searchMovies, getLatestMovies, parseMovieData } from '../../lib/api';
import MovieCard from '../../components/MovieCard';
import Link from 'next/link';
import styles from '../page.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GENRE_MAP = {
  action: 'أكشن',
  thriller: 'إثارة',
  comedy: 'كوميديا',
  scifi: 'خيال علمي',
  drama: 'دراما',
  horror: 'رعب',
  romance: 'رومانسي',
  adventure: 'مغامرة',
  animation: 'رسوم متحركة',
  crime: 'جريمة',
  fantasy: 'فانتازيا',
  mystery: 'غموض',
};

export async function generateMetadata({ searchParams }) {
  const searchTerm = (searchParams?.search || '').trim();
  const filterYear = searchParams?.year || '';
  const filterQuality = searchParams?.quality || '';
  const filterCategory = searchParams?.category || '';
  const filterGenre = searchParams?.genre || '';
  const filterSort = searchParams?.sort || '';
  const pageNumber = searchParams?.page || '';

  const hasFilter = Boolean(searchTerm || filterYear || filterQuality || filterCategory || filterGenre || filterSort || pageNumber);

  let title = 'مكتبة الأفلام الكاملة - EgyMax | شاهد وحمل أحدث الأفلام المترجمة';
  let description = 'تصفح وشاهد أحدث الأفلام العالمية والعربية المترجمة بجودة فائقة 1080p و 4K مجاناً مع سيرفرات متعددة على منصة EgyMax.';

  if (searchTerm) {
    title = `نتائج البحث عن: ${searchTerm} - EgyMax`;
    description = `شاهد نتائج البحث عن فيلم "${searchTerm}" بجودة عالية مترجم على EgyMax.`;
  } else if (filterGenre) {
    const genreAr = GENRE_MAP[filterGenre.toLowerCase()] || filterGenre;
    title = `أفلام ${genreAr} - EgyMax | مشاهدة وتحميل اون لاين`;
    description = `استمتع بمشاهدة أحدث أفلام ${genreAr} مترجمة كاملة بجودة عالية على EgyMax.`;
  } else if (filterCategory === 'arabic') {
    title = 'الأفلام العربية - EgyMax | شاهد أحدث الأفلام العربية اون لاين';
    description = 'شاهد وحمل أحدث الأفلام العربية الجديدة بجودة عالية HD على منصة EgyMax.';
  } else if (filterCategory === 'foreign') {
    title = 'الأفلام الأجنبية المترجمة - EgyMax | مشاهدة وتحميل مباشر';
    description = 'تصفح مكتبة الأفلام الأجنبية العالمية كاملة مترجمة باحترافية بدقة 1080p على EgyMax.';
  } else if (filterYear) {
    title = `أفلام سنة ${filterYear} مترجمة - EgyMax | شاهد الآن`;
    description = `قائمة كاملة بأفضل وأحدث أفلام عام ${filterYear} مترجمة بجودة Full HD على EgyMax.`;
  } else if (filterSort === 'views') {
    title = 'الأفلام الأكثر مشاهدة وطلباً - EgyMax | توب سينما';
    description = 'شاهد قائمة الأفلام الأعلى مشاهدة والأكثر طلباً على منصة EgyMax بجودة فائقة.';
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/, '');
  const canonicalUrl = `${siteUrl}/movies`;

  return {
    title,
    description: description.slice(0, 160),
    alternates: {
      canonical: canonicalUrl,
    },
    // Prevent duplicate content indexing on filtered/searched lists
    robots: hasFilter ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      title,
      description: description.slice(0, 160),
      url: canonicalUrl,
      siteName: 'EgyMax',
      locale: 'ar_EG',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: description.slice(0, 160),
    },
  };
}

export default async function MoviesPage({ searchParams }) {
  const searchTerm = searchParams?.search || '';
  const filterYear = searchParams?.year || '';
  const filterQuality = searchParams?.quality || '';
  const filterCategory = searchParams?.category || '';
  const filterGenre = searchParams?.genre || '';
  const filterSort = searchParams?.sort || '';

  // 1. Fetch movies (using search if query present)
  let rawMovies = [];
  if (searchTerm.trim()) {
    rawMovies = await searchMovies({ search: searchTerm.trim(), perPage: 60 });
  } else {
    rawMovies = await getLatestMovies(60);
  }

  // 2. Parse movies
  let movies = (rawMovies || []).map(post => ({
    post,
    parsed: parseMovieData(post)
  })).filter(item => item.parsed !== null);

  // Apply Year filter e.g. /movies?year=2026
  if (filterYear) {
    movies = movies.filter(item => item.parsed.year === filterYear);
  }

  // Apply Quality filter e.g. /movies?quality=1080p
  if (filterQuality) {
    movies = movies.filter(item => item.parsed.quality.toLowerCase().includes(filterQuality.toLowerCase()));
  }

  // Apply Genre filter e.g. /movies?genre=action
  if (filterGenre) {
    const targetGenreAr = GENRE_MAP[filterGenre.toLowerCase()] || filterGenre.toLowerCase();
    movies = movies.filter(item => {
      const genres = (item.parsed.genres || []).map(g => g.toLowerCase());
      return genres.some(g => g.includes(targetGenreAr.toLowerCase()) || g.includes(filterGenre.toLowerCase()));
    });
  }

  // Sort by rating or views if requested
  if (filterSort === 'views' || filterSort === 'rating') {
    movies.sort((a, b) => {
      const rA = parseFloat(a.parsed.rating || '7.5');
      const rB = parseFloat(b.parsed.rating || '7.5');
      return rB - rA;
    });
  }

  // Determine Page Heading
  let pageHeading = 'جميع الأفلام المتاحة';
  if (searchTerm) pageHeading = `نتائج البحث عن: "${searchTerm}"`;
  else if (filterGenre) {
    const genreAr = GENRE_MAP[filterGenre.toLowerCase()] || filterGenre;
    pageHeading = `أفلام ${genreAr}`;
  }
  else if (filterYear) pageHeading = `أفلام سنة ${filterYear}`;
  else if (filterQuality) pageHeading = `أفلام بجودة ${filterQuality}`;
  else if (filterCategory === 'arabic') pageHeading = 'الأفلام العربية';
  else if (filterCategory === 'foreign') pageHeading = 'الأفلام الأجنبية المترجمة';
  else if (filterSort === 'views') pageHeading = 'الأفلام الأكثر مشاهدة وطلباً';

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.iconPulse}>🎬</span>
            <h1 className={styles.sectionTitle} style={{ fontSize: '1.6rem' }}>{pageHeading}</h1>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.95rem', fontWeight: '700' }}>
            {movies.length} فيلم متوفر
          </span>
        </div>

        {movies.length === 0 ? (
          <div className={styles.emptyCard}>
            <div className={styles.emptyIcon}>🔍</div>
            <h2>لم نتمكن من العثور على أفلام</h2>
            <p>جرّب البحث بكلمة أخرى أو تصفّح قائمة أحدث الأفلام المضافة على منصة EGYMAX.</p>
            <Link href="/movies" className={styles.viewAllBtn} style={{ marginTop: '1rem', color: 'var(--accent-red)' }}>
              عرض جميع الأفلام ‹
            </Link>
          </div>
        ) : (
          <div className={styles.grid}>
            {movies.map(({ post, parsed }) => (
              <MovieCard key={post.id} post={post} quality={parsed.quality} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
