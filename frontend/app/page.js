import { getLatestMovies, getLatestSeries, parseMovieData } from '../lib/api';
import HeroSection from '../components/HeroSection';
import MovieCard from '../components/MovieCard';
import Link from 'next/link';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
  .replace(/^http:\/\//i, 'https://')
  .replace(/\/+$/, '');

export const metadata = {
  title: 'EGYMAX | بوابة المشاهدة الأولى للأفلام والمسلسلات الحصرية',
  description: 'شاهد وحمل أحدث الأفلام والمسلسلات العربية والأجنبية المترجمة بجودة 4K و 1080p مجاناً على سيرفرات سريعة وبدون إعلانات مزعجة على EgyMax.',
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: 'EGYMAX | بوابة المشاهدة الأولى للأفلام والمسلسلات الحصرية',
    description: 'شاهد وحمل أحدث الأفلام والمسلسلات العربية والأجنبية المترجمة بجودة 4K و 1080p مجاناً على سيرفرات سريعة وبدون إعلانات مزعجة على EgyMax.',
    url: siteUrl,
    siteName: 'EgyMax',
    locale: 'ar_EG',
    type: 'website',
  },
};

export default async function Home() {
  const [latestMovies, latestSeries] = await Promise.all([
    getLatestMovies(24),
    getLatestSeries(12),
  ]);

  const hasContent = (latestMovies && latestMovies.length > 0) || (latestSeries && latestSeries.length > 0);

  if (!hasContent) {
    return (
      <div className="container">
        <div className={styles.emptyCard}>
          <div className={styles.emptyIcon}>🎬</div>
          <h2>لا توجد أفلام أو مسلسلات معروضة حالياً</h2>
          <p>يتم تحديث مكتبة EGYMAX تلقائياً عبر السحابة. يرجى إعادة المحاولة بعد قليل.</p>
        </div>
      </div>
    );
  }

  const featuredMovie = (latestMovies && latestMovies.length > 0) ? latestMovies[0] : latestSeries[0];
  const topRatedMovies = [...(latestMovies || [])]
    .sort((a, b) => {
      const rA = parseFloat(parseMovieData(a).rating || '7.5');
      const rB = parseFloat(parseMovieData(b).rating || '7.5');
      return rB - rA;
    })
    .slice(0, 6);

  return (
    <div className="container">
      {/* Cinematic Hero Section (Top Showcase) */}
      <HeroSection featuredMovie={featuredMovie} />

      {/* Section 1: الأفلام الأعلى تقييماً */}
      {topRatedMovies.length > 0 && (
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
      )}

      {/* Section 2: أحدث الأفلام المضافة */}
      {latestMovies && latestMovies.length > 0 && (
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
      )}

      {/* Section 3: أحدث المسلسلات المضافة */}
      {latestSeries && latestSeries.length > 0 && (
        <section id="latest-series" className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.titleGroup}>
              <span className={styles.iconPulse}>🔥</span>
              <h2 className={styles.sectionTitle}>أحدث المسلسلات المضافة 🔥</h2>
            </div>
            <Link href="/series" className={styles.viewAllBtn}>
              <span>المزيد من المسلسلات</span>
              <span className={styles.arrowIcon}>‹</span>
            </Link>
          </div>

          <div className={styles.grid}>
            {latestSeries.map((seriesItem, index) => (
              <MovieCard
                key={`latest-series-${seriesItem.id}`}
                post={seriesItem}
                quality={index % 2 === 0 ? '1080p FHD' : 'WEB-DL'}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
