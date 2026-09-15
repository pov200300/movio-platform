import { getLatestMovies } from '../lib/api';
import FeaturedGrid from '../components/FeaturedGrid';
import MovieCard from '../components/MovieCard';
import styles from './page.module.css';

export const revalidate = 60;

export default async function Home() {
  const latestMovies = await getLatestMovies(18);

  if (!latestMovies || latestMovies.length === 0) {
    return (
      <div className="container">
        <div className={styles.emptyCard}>
          <h2>لا توجد أفلام حالياً</h2>
          <p>يرجى إضافة مواضيع في وردبريس أو تشغيل الخادم لمزامنة الأفلام تلقائياً.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Top 5-Column Featured Grid (EgyDead Top Banner) */}
      <FeaturedGrid movies={latestMovies} />

      {/* Section 1: المواضيع المميزة */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.pinIcon}>📌</span>
            <h2 className={styles.sectionTitle}>المواضيع المميزه</h2>
            <span className={styles.redBar} />
          </div>
          <a href="/movies" className={styles.viewAllBtn}>عرض الكل ‹</a>
        </div>

        <div className={styles.grid}>
          {latestMovies.slice(0, 6).map((movie) => (
            <MovieCard key={`featured-${movie.id}`} post={movie} quality="WEB-DL" />
          ))}
        </div>
      </section>

      {/* Section 2: أحدث الأفلام المترجمة */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.fireIcon}>🔥</span>
            <h2 className={styles.sectionTitle}>أحدث الأفلام المترجمة</h2>
            <span className={styles.redBar} />
          </div>
          <a href="/movies" className={styles.viewAllBtn}>المزيد من الأفلام ‹</a>
        </div>

        <div className={styles.grid}>
          {latestMovies.map((movie, index) => (
            <MovieCard 
              key={`latest-${movie.id}`} 
              post={movie} 
              quality={index % 2 === 0 ? 'WEB-DL' : '1080p'} 
            />
          ))}
        </div>
      </section>
    </div>
  );
}
