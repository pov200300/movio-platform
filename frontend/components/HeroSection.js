import Link from 'next/link';
import Image from 'next/image';
import styles from './HeroSection.module.css';
import { parseMovieData } from '../lib/api';

export default function HeroSection({ featuredMovie }) {
  if (!featuredMovie) return null;

  const movie = parseMovieData(featuredMovie);
  if (!movie) return null;

  // Extract backdrop or poster
  let backdropUrl = featuredMovie.meta?.backdrop_url;
  if (!backdropUrl && featuredMovie._embedded && featuredMovie._embedded['wp:featuredmedia']?.[0]?.source_url) {
    backdropUrl = featuredMovie._embedded['wp:featuredmedia'][0].source_url;
  }
  if (!backdropUrl) {
    backdropUrl = movie.posterUrl || '/placeholder.jpg';
  }

  // Synopsis cleanup
  let cleanSynopsis = movie.synopsis || '';
  cleanSynopsis = cleanSynopsis.replace(/<[^>]+>/g, '').trim();
  if (cleanSynopsis.length > 220) {
    cleanSynopsis = cleanSynopsis.substring(0, 220) + '...';
  }

  return (
    <div className={styles.heroBanner}>
      {/* Background Image with Vignette & Gradients */}
      <div className={styles.backdropWrapper}>
        <Image
          src={backdropUrl}
          alt={movie.rawTitle}
          fill
          priority
          sizes="100vw"
          className={styles.backdropImage}
        />
        <div className={styles.vignetteOverlay} />
        <div className={styles.radialGlow} />
        <div className={styles.bottomGradient} />
      </div>

      {/* Hero Content */}
      <div className={styles.heroContent}>
        <div className={styles.badgeRow}>
          <span className={styles.featuredBadge}>🔥 المميز اليوم</span>
          <span className={styles.badgeSub}>مترجم بالعربية</span>
          <span className={styles.badgeQuality}>4K ULTRA HD</span>
        </div>

        <h1 className={styles.title}>
          مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} />
        </h1>

        <div className={styles.metaRow}>
          <span className={styles.ratingBadge}>
            ★ {movie.rating} <span className={styles.ratingLabel}>TMDB</span>
          </span>
          <span className={styles.metaItem}>{movie.year}</span>
          <span className={styles.metaDot}>•</span>
          <span className={styles.metaItem}>سيرفر مباشر فائقة السرعة</span>
        </div>

        {cleanSynopsis && (
          <p className={styles.synopsis}>
            {cleanSynopsis}
          </p>
        )}

        <div className={styles.actionButtons}>
          <Link href={`/movie/${movie.slug}`} className={styles.playBtn}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>شاهد الآن</span>
          </Link>
          <Link href={`/movie/${movie.slug}`} className={styles.detailsBtn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>المزيد من التفاصيل</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
