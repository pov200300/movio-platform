import Link from 'next/link';
import Image from 'next/image';
import styles from './MovieCard.module.css';
import { parseMovieData, isSeriesPost } from '../lib/api';

export default function MovieCard({ post, quality, href }) {
  const movie = parseMovieData(post);
  if (!movie) return null;

  const movieTitle = (movie.cleanTitle || movie.title || movie.displayTitle || movie.rawTitle || 'المحتوى').trim();
  const displayQuality = quality || movie.quality || '1080p';
  const isSeries = post?.isSeries || isSeriesPost(post);

  let cardHref = href;
  if (!cardHref) {
    if (isSeries) {
      const meta = { ...(post?.meta_input || {}), ...(post?.meta || {}) };
      const showSlug = meta.series_slug || meta.show_slug || (movie.slug ? movie.slug.replace(/-s\d+e\d+.*/i, '') : '');
      cardHref = showSlug ? `/series/${showSlug}` : `/movie/${movie.slug}`;
    } else {
      cardHref = `/movie/${movie.slug}`;
    }
  }

  return (
    <Link href={cardHref} className={styles.cardLink}>
      <div className={styles.card}>
        <div className={styles.posterWrapper}>
          <Image
            src={movie.posterUrl}
            alt={`بوستر ${isSeries ? 'مسلسل' : 'فيلم'} ${movieTitle}`}
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
