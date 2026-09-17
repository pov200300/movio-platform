import { getMovieBySlug, parseMovieData } from '../../../lib/api';
import VideoPlayer from '../../../components/VideoPlayer';
import Image from 'next/image';
import styles from './movie.module.css';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  const post = await getMovieBySlug(params.slug);
  if (!post) return { title: 'الفيلم غير موجود | CineVault' };
  
  const movie = parseMovieData(post);
  return {
    title: `مشاهدة فيلم ${movie.displayTitle} (${movie.year}) مترجم | CineVault`,
    description: `مشاهدة وتحميل فيلم ${movie.displayTitle} (${movie.year}) مترجم بجودة عالية ${movie.quality} على سيرفرات سريعة.`,
  };
}

export default async function MoviePage({ params }) {
  const post = await getMovieBySlug(params.slug);
  
  if (!post) {
    notFound();
  }

  const movie = parseMovieData(post);
  if (!movie) {
    notFound();
  }

  return (
    <div className="container">
      <div className={styles.pageWrapper}>
        {/* Top Header Card */}
        <div className={styles.movieHeaderCard}>
          <div className={styles.posterBox}>
            <Image 
              src={movie.posterUrl} 
              alt={movie.rawTitle} 
              fill
              priority
              sizes="220px"
              className={styles.posterImg} 
            />
            <span className={styles.qualityTag}>{movie.quality}</span>
          </div>

          <div className={styles.infoBox}>
            <h1 className={styles.title}>
              مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} /> ({movie.year}) مترجم
            </h1>

            <div className={styles.tagsRow}>
              <span className={styles.tagRating}>★ {movie.rating} IMDB</span>
              <span className={styles.tagPill}>مترجم للعربية</span>
              <span className={styles.tagPill}>{movie.year}</span>
              <span className={styles.tagPillRed}>{movie.quality}</span>
              <span className={styles.tagPillGreen}>سيرفر مباشر</span>
            </div>

            <div className={styles.synopsisSection}>
              <h3>📖 قصة الفيلم</h3>
              <div 
                className={styles.synopsisContent} 
                dangerouslySetInnerHTML={{ __html: movie.synopsis || 'لا يوجد ملخص متاح حالياً.' }} 
              />
            </div>

            <div className={styles.actionRow}>
              <a href="#player" className={styles.watchBtn}>
                ▶ مشاهدة الفيلم الان
              </a>
              <a href="#player" className={styles.downloadBtn}>
                ⬇ تحميل الفيلم FHD
              </a>
            </div>
          </div>
        </div>

        {/* Video Player Box with Multi-Server Tabs */}
        <div id="player" className={styles.playerContainer}>
          <VideoPlayer 
            embedUrl={movie.embedUrl}
            posterUrl={movie.posterUrl} 
            title={movie.rawTitle} 
          />
        </div>
      </div>
    </div>
  );
}
