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
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
            className={styles.posterImage}
          />
          
          <div className={styles.gradientOverlay} />

          {/* Top Right: Quality Badge */}
          <div className={styles.badgeTopRight}>
            <span className={styles.badgeQuality}>{displayQuality}</span>
          </div>
          
          {/* Top Left: Gold Rating Badge */}
          <div className={styles.badgeTopLeft}>
            <span className={styles.badgeRating}>★ {movie.rating}</span>
          </div>

          {/* Center Play Button Overlay on Hover */}
          <div className={styles.playIconOverlay}>
            <div className={styles.playBtn}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>

          {/* Bottom Card Title Box */}
          <div className={styles.cardInfoBottom}>
            <div className={styles.metaPills}>
              <span className={styles.subPill}>مترجم</span>
              <span className={styles.yearPill}>{movie.year}</span>
            </div>
            <h3 className={styles.cardTitle}>
              <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} />
            </h3>
          </div>
        </div>
      </div>
    </Link>
  );
}
