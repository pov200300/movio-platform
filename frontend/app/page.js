import { getLatestMovies, parseMovieData } from '../lib/api';
import HeroSection from '../components/HeroSection';
import MovieCard from '../components/MovieCard';
import Link from 'next/link';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const latestMovies = await getLatestMovies(24);

  if (!latestMovies || latestMovies.length === 0) {
    return (
      <div className="container">
        <div className={styles.emptyCard}>
          <div className={styles.emptyIcon}>🎬</div>
          <h2>لا توجد أفلام معروضة حالياً</h2>
          <p>يتم تحديث مكتبة EGYMAX تلقائياً عبر السحابة. يرجى إعادة المحاولة بعد قليل.</p>
        </div>
      </div>
    );
  }

  const featuredMovie = latestMovies[0];
  const topRatedMovies = [...latestMovies]
    .sort((a, b) => {
      const rA = parseFloat(parseMovieData(a).rating || '7.5');
      const rB = parseFloat(parseMovieData(b).rating || '7.5');
      return rB - rA;
    })
    .slice(0, 6);

  return (
    <div className="container">
      {/* Cinematic Hero Section (Top Movie Showcase) */}
      <HeroSection featuredMovie={featuredMovie} />

      {/* Section 1: الأفلام الأعلى تقييماً */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.iconPulse}>⭐</span>
            <h2 className={styles.sectionTitle}>الأعلى تقييماً والأكثر طلباً</h2>
          </div>
          <Link href="/movies?quality=1080p" className={styles.viewAllBtn}>
            <span>عرض الكل</span>
            <span className={styles.arrowIcon}>‹</span>
          </Link>
        </div>

        <div className={styles.grid}>
          {topRatedMovies.map((movie) => (
            <MovieCard key={`top-${movie.id}`} post={movie} quality="1080p FHD" />
          ))}
        </div>
      </section>

      {/* Section 2: أحدث الأفلام المضافة */}
      <section id="latest-movies" className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.iconPulse}>🔥</span>
            <h2 className={styles.sectionTitle}>أحدث الأفلام المضافة</h2>
          </div>
          <Link href="/movies" className={styles.viewAllBtn}>
            <span>المزيد من الأفلام</span>
            <span className={styles.arrowIcon}>‹</span>
          </Link>
        </div>

        <div className={styles.grid}>
          {latestMovies.map((movie, index) => (
            <MovieCard
              key={`latest-${movie.id}`}
              post={movie}
              quality={index % 3 === 0 ? '4K Ultra' : index % 2 === 0 ? 'WEB-DL' : '1080p'}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
