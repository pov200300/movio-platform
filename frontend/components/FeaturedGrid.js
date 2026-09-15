import Link from 'next/link';
import Image from 'next/image';
import styles from './FeaturedGrid.module.css';

export default function FeaturedGrid({ movies }) {
  if (!movies || movies.length === 0) return null;

  // Take top 6 movies for the top banner grid
  const featured = movies.slice(0, 6);

  return (
    <div className={styles.gridContainer}>
      {featured.map((movie) => {
        const title = movie.title?.rendered || 'فيلم جديد';
        const slug = movie.slug || '';
        const year = movie.meta?.video_year || '2026';
        
        let posterUrl = '/placeholder.jpg';
        if (movie._embedded && movie._embedded['wp:featuredmedia']) {
          posterUrl = movie._embedded['wp:featuredmedia'][0].source_url;
        }

        return (
          <Link href={`/movie/${slug}`} key={movie.id} className={styles.card}>
            <div className={styles.imageWrapper}>
              <Image
                src={posterUrl}
                alt={title}
                fill
                priority
                sizes="(max-width: 640px) 50vw, (max-width: 1200px) 25vw, 20vw"
                className={styles.posterImage}
              />
              <div className={styles.gradientOverlay} />
              
              <div className={styles.topBadges}>
                <span className={styles.badgeSub}>مترجم</span>
                <span className={styles.badgeYear}>{year}</span>
              </div>

              <div className={styles.contentBottom}>
                <h3 className={styles.movieTitle}>
                  مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: title }} /> {year} مترجم
                </h3>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
