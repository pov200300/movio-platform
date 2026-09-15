import Link from 'next/link';
import Image from 'next/image';
import styles from './HeroSection.module.css';

export default function HeroSection({ featuredMovie }) {
  if (!featuredMovie) return null;

  const title = featuredMovie.title?.rendered || 'Featured Title';
  const slug = featuredMovie.slug;
  const year = featuredMovie.meta?.video_year || '2026';
  const licenseType = featuredMovie.meta?.license_type?.replace('_', ' ').toUpperCase() || 'PUBLIC DOMAIN';
  
  // Extract synopsis
  let synopsis = featuredMovie.excerpt?.rendered?.replace(/<[^>]+>/g, '') || '';
  if (synopsis.length > 200) {
    synopsis = synopsis.substring(0, 200) + '...';
  }

  // Extract featured backdrop image
  let backdropUrl = '/placeholder.jpg';
  if (featuredMovie._embedded && featuredMovie._embedded['wp:featuredmedia']) {
    backdropUrl = featuredMovie._embedded['wp:featuredmedia'][0].source_url;
  }

  return (
    <div className={styles.heroBanner}>
      {/* Background Image with Vignette & Gradients */}
      <div className={styles.backdropWrapper}>
        <Image
          src={backdropUrl}
          alt={title}
          fill
          priority
          sizes="100vw"
          className={styles.backdropImage}
        />
        <div className={styles.vignetteOverlay} />
        <div className={styles.bottomGradient} />
      </div>

      {/* Hero Content */}
      <div className={styles.heroContent}>
        <div className={styles.badgeRow}>
          <span className={styles.featuredBadge}>FEATURED</span>
          <span className={styles.licenseBadge}>{licenseType}</span>
        </div>

        <h1 className={styles.title} dangerouslySetInnerHTML={{ __html: title }} />

        <div className={styles.metaRow}>
          <span className={styles.year}>{year}</span>
          <span className={styles.qualityBadge}>4K ULTRA HD</span>
          <span className={styles.audioBadge}>5.1 SURROUND</span>
        </div>

        {synopsis && <p className={styles.synopsis}>{synopsis}</p>}

        <div className={styles.actionButtons}>
          <Link href={`/movie/${slug}`} className={styles.playBtn}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Watch Now
          </Link>
          <Link href={`/movie/${slug}`} className={styles.detailsBtn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            More Details
          </Link>
        </div>
      </div>
    </div>
  );
}
