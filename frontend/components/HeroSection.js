import Link from 'next/link';
import Image from 'next/image';
import styles from './HeroSection.module.css';

export default function HeroSection({ featuredMovie }) {
  // Extract high-res backdrop if available from featured movie or series
  let backdropUrl = featuredMovie?.meta?.backdrop_url || featuredMovie?.backdropUrl || featuredMovie?.backdrop_url;
  if (!backdropUrl && featuredMovie?._embedded && featuredMovie._embedded['wp:featuredmedia']?.[0]?.source_url) {
    backdropUrl = featuredMovie._embedded['wp:featuredmedia'][0].source_url;
  }
  if (!backdropUrl && (featuredMovie?.posterUrl || featuredMovie?.poster_url)) {
    backdropUrl = featuredMovie.posterUrl || featuredMovie.poster_url;
  }

  const featuredTitle = (
    featuredMovie?.title?.rendered ||
    featuredMovie?.title ||
    featuredMovie?.cleanTitle ||
    featuredMovie?.rawTitle ||
    'السينما العالمية'
  ).replace(/<[^>]+>/g, '').trim();

  return (
    <div
      className={styles.heroBanner}
      style={backdropUrl ? {
        background: `linear-gradient(to top, #0a0b10 10%, rgba(10, 11, 16, 0.7) 60%, rgba(10, 11, 16, 0.3) 100%), url(${backdropUrl}) center/cover no-repeat`
      } : undefined}
    >
      {/* Background Image with Rich Multi-Stop Vignette */}
      <div className={styles.backdropWrapper}>
        {backdropUrl && (
          <Image
            src={backdropUrl}
            alt={`بوستر فيلم ${featuredTitle}`}
            fill
            priority
            sizes="100vw"
            className={styles.backdropImage}
          />
        )}
        <div className={styles.cinematicOverlay} />
        <div className={styles.radialGlow} />
      </div>

      {/* Hero Showcase Content */}
      <div className={styles.heroContent}>
        {/* Top Badges */}
        <div className={styles.badgeRow}>
          <span className={styles.badgeFire}>🔥 المنصة الأولى</span>
          <span className={styles.badgeQuality}>1080p Full HD</span>
          <span className={styles.badgeSub}>مترجم بالكامل</span>
        </div>

        {/* Main Showcase Title */}
        <h1 className={styles.heroTitle}>
          <span className={styles.textRed}>EGY</span>
          <span className={styles.textWhite}>MAX</span>
        </h1>

        {/* Catchy Arabic Tagline */}
        <p className={styles.tagline}>
          بوابتك الأولى لمشاهدة وتحميل أحدث الأفلام والمسلسلات الحصرية بجودة فائقة وترجمة احترافية وسيرفرات فائقة السرعة.
        </p>

        {/* Feature Highlights Row */}
        <div className={styles.featuresRow}>
          <div className={styles.featurePill}>
            <span className={styles.featureIcon}>⚡</span>
            <span>سيرفرات مباشرة فائقة السرعة</span>
          </div>
          <span className={styles.featureDot}>•</span>
          <div className={styles.featurePill}>
            <span className={styles.featureIcon}>🎬</span>
            <span>مكتبة متجددة يومياً</span>
          </div>
          <span className={styles.featureDot}>•</span>
          <div className={styles.featurePill}>
            <span className={styles.featureIcon}>🍿</span>
            <span>مشاهدة مجانية 100%</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className={styles.actionButtons}>
          <a href="#latest-movies" className={styles.primaryBtn}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>تصفح أحدث الأفلام</span>
          </a>

          <Link href="/movies?sort=rating" className={styles.secondaryBtn}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
            <span>الأعلى تقييماً</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
