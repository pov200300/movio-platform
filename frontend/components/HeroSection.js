import Link from 'next/link';
import Image from 'next/image';
import styles from './HeroSection.module.css';

export default function HeroSection({ featuredMovie }) {
  // Extract high-res backdrop if available from featured movie
  let backdropUrl = featuredMovie?.meta?.backdrop_url;
  if (!backdropUrl && featuredMovie?._embedded && featuredMovie._embedded['wp:featuredmedia']?.[0]?.source_url) {
    backdropUrl = featuredMovie._embedded['wp:featuredmedia'][0].source_url;
  }
  if (!backdropUrl && featuredMovie?.posterUrl) {
    backdropUrl = featuredMovie.posterUrl;
  }

  return (
    <div className={styles.heroBanner}>
      {/* Background Image with Rich Multi-Stop Vignette */}
      <div className={styles.backdropWrapper}>
        {backdropUrl && (
          <Image
            src={backdropUrl}
            alt="EGYMAX Cinema Backdrop"
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
          <span className={styles.badgeQuality}>4K ULTRA HD</span>
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
