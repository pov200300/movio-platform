import { searchMovies, getLatestMovies, parseMovieData } from '../../lib/api';
import MovieCard from '../../components/MovieCard';
import Link from 'next/link';
import styles from '../page.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'مكتبة الأفلام الكاملة | EGYMAX',
  description: 'تصفح وشاهد أحدث الأفلام العالمية والعربية المترجمة بجودة فائقة 1080p و 4K على منصة EGYMAX.',
};

export default async function MoviesPage({ searchParams }) {
  const searchTerm = searchParams?.search || '';
  const filterYear = searchParams?.year || '';
  const filterQuality = searchParams?.quality || '';
  const filterCategory = searchParams?.category || '';
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
