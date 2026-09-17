import { searchMovies, getLatestMovies, parseMovieData } from '../../lib/api';
import MovieCard from '../../components/MovieCard';
import styles from '../page.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'All Movies | CineVault',
  description: 'Browse our entire collection of authorized movies.',
};

export default async function MoviesPage({ searchParams }) {
  const searchTerm = searchParams?.search || '';
  const filterYear = searchParams?.year || '';
  const filterQuality = searchParams?.quality || '';

  // 1. Fetch movies (using search if query present)
  let rawMovies = [];
  if (searchTerm.trim()) {
    rawMovies = await searchMovies({ search: searchTerm.trim(), perPage: 50 });
  } else {
    rawMovies = await getLatestMovies(50);
  }

  // 2. Parse & Filter movies
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

  // Title description
  let pageHeading = 'جميع الأفلام';
  if (searchTerm) pageHeading = `نتائج البحث عن: "${searchTerm}"`;
  else if (filterYear) pageHeading = `أفلام سنة ${filterYear}`;
  else if (filterQuality) pageHeading = `أفلام بجودة ${filterQuality}`;

  return (
    <div className="container">
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.fireIcon}>🎬</span>
            <h1 className={styles.sectionTitle} style={{ fontSize: '2rem' }}>{pageHeading}</h1>
            <span className={styles.redBar} />
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            {movies.length} فيلم متاح
          </span>
        </div>

        {movies.length === 0 ? (
          <div className={styles.emptyCard} style={{ margin: '3rem auto' }}>
            <h2>لا توجد أفلام مطابقة للبحث</h2>
            <p>جرّب البحث بكلمة أخرى أو تصفّح قائمة أحدث الأفلام.</p>
            <a href="/movies" className={styles.viewAllBtn} style={{ display: 'inline-block', marginTop: '1rem' }}>
              عرض جميع الأفلام
            </a>
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
