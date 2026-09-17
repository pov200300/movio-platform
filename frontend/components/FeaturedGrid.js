import Link from 'next/link';
import Image from 'next/image';
import styles from './FeaturedGrid.module.css';
import { parseMovieData } from '../lib/api';

export default function FeaturedGrid({ movies }) {
  if (!movies || movies.length === 0) return null;

  // Take top 6 movies for the top banner grid
  const featured = movies.slice(0, 6);

  return (
    <div className={styles.gridContainer}>
      {featured.map((post) => {
        const movie = parseMovieData(post);
        if (!movie) return null;

        return (
          <Link href={`/movie/${movie.slug}`} key={movie.id} className={styles.card}>
            <div className={styles.imageWrapper}>
              <Image
                src={movie.posterUrl}
                alt={movie.rawTitle}
                fill
                priority
                sizes="(max-width: 640px) 50vw, (max-width: 1200px) 25vw, 20vw"
                className={styles.posterImage}
              />
              <div className={styles.gradientOverlay} />
              
              <div className={styles.topBadges}>
                <span className={styles.badgeSub}>مترجم</span>
                <span className={styles.badgeYear}>{movie.year}</span>
              </div>

              <div className={styles.contentBottom}>
                <h3 className={styles.movieTitle}>
                  مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} /> ({movie.year}) مترجم
                </h3>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
