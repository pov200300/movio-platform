import Link from 'next/link';
import Image from 'next/image';
import styles from './MovieCard.module.css';
import { parseMovieData } from '../lib/api';

export default function MovieCard({ post, quality }) {
  const movie = parseMovieData(post);
  if (!movie) return null;

  const displayQuality = quality || movie.quality || '1080p';

  return (
    <Link href={`/movie/${movie.slug}`} className={styles.cardLink}>
      <div className={styles.card}>
        <div className={styles.posterWrapper}>
          <Image
            src={movie.posterUrl}
            alt={movie.rawTitle}
            fill
            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 14vw"
            className={styles.posterImage}
          />
          
          <div className={styles.gradientOverlay} />
          <div className={styles.shimmerEffect} />

          {/* Top Right: Quality Badge */}
          <div className={styles.badgeTopRight}>
            <span className={styles.badgeQuality}>{displayQuality}</span>
          </div>
          
          {/* Top Left: IMDB Rating */}
          <div className={styles.badgeTopLeft}>
            <span className={styles.badgeRating}>★ {movie.rating}</span>
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
              مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} /> ({movie.year})
            </h3>
          </div>
        </div>
      </div>
    </Link>
  );
}
