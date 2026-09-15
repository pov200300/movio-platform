import Link from 'next/link';
import Image from 'next/image';
import styles from './MovieCard.module.css';

export default function MovieCard({ post, quality = 'WEB-DL' }) {
  if (!post) return null;

  const title = post.title?.rendered || 'عنوان الفيلم';
  const slug = post.slug || '';
  const year = post.meta?.video_year || '2026';
  const rating = post.meta?.imdb_rating || '8.5';
  
  let imageUrl = '/placeholder.jpg';
  if (post._embedded && post._embedded['wp:featuredmedia']) {
    imageUrl = post._embedded['wp:featuredmedia'][0].source_url;
  }

  return (
    <Link href={`/movie/${slug}`} className={styles.cardLink}>
      <div className={styles.card}>
        <div className={styles.posterWrapper}>
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 14vw"
            className={styles.posterImage}
          />
          
          <div className={styles.gradientOverlay} />
          <div className={styles.shimmerEffect} />

          {/* Top Right: Quality Badge */}
          <div className={styles.badgeTopRight}>
            <span className={styles.badgeQuality}>{quality}</span>
          </div>
          
          {/* Top Left: IMDB Rating */}
          <div className={styles.badgeTopLeft}>
            <span className={styles.badgeRating}>★ {rating}</span>
          </div>

          {/* Play Icon Glow */}
          <div className={styles.playIconOverlay}>
            <div className={styles.playBtn}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>

          {/* Bottom Title Box */}
          <div className={styles.cardTitleBox}>
            <div className={styles.subBadge}>مترجم</div>
            <h3 className={styles.cardTitle}>
              مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: title }} /> {year}
            </h3>
          </div>
        </div>
      </div>
    </Link>
  );
}
