import { getMovieBySlug, getLatestMovies, parseMovieData } from '../../../lib/api';
import VideoPlayer from '../../../components/VideoPlayer';
import MovieCard from '../../../components/MovieCard';
import Image from 'next/image';
import Link from 'next/link';
import styles from './movie.module.css';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  const post = await getMovieBySlug(params.slug);
  if (!post) return { title: 'الفيلم غير موجود | EGYMAX' };
  
  const movie = parseMovieData(post);
  return {
    title: `مشاهدة فيلم ${movie.displayTitle} (${movie.year}) مترجم | EGYMAX`,
    description: `مشاهدة وتحميل فيلم ${movie.displayTitle} (${movie.year}) مترجم بجودة فائقة ${movie.quality} بدقة 1080p مجاناً على سيرفرات سريعة حصرياً على EGYMAX.`,
  };
}

// Helper to derive high-speed direct download link from DoodStream or direct sources
const getDownloadUrl = (movie) => {
  if (!movie) return null;
  if (movie.download_url) {
    return movie.download_url.includes('/e/') ? movie.download_url.replace('/e/', '/d/') : movie.download_url;
  }
  if (movie.downloadUrl) {
    return movie.downloadUrl.includes('/e/') ? movie.downloadUrl.replace('/e/', '/d/') : movie.downloadUrl;
  }
  if (movie.embed_url && typeof movie.embed_url === 'string' && movie.embed_url.includes('/e/')) {
    return movie.embed_url.replace('/e/', '/d/');
  }
  if (movie.embedUrl && typeof movie.embedUrl === 'string' && movie.embedUrl.includes('/e/')) {
    return movie.embedUrl.replace('/e/', '/d/');
  }
  if (movie.dood_url && typeof movie.dood_url === 'string' && movie.dood_url.includes('/e/')) {
    return movie.dood_url.replace('/e/', '/d/');
  }
  if (movie.doodUrl && typeof movie.doodUrl === 'string' && movie.doodUrl.includes('/e/')) {
    return movie.doodUrl.replace('/e/', '/d/');
  }
  return movie.stream_url || movie.directStreamUrl || movie.embed_url || movie.embedUrl || null;
};

export default async function MoviePage({ params }) {
  const post = await getMovieBySlug(params.slug);
  
  if (!post) {
    notFound();
  }

  const movie = parseMovieData(post);
  if (!movie) {
    notFound();
  }

  // Derive direct download URL
  const downloadUrl = getDownloadUrl(movie);

  // Fetch related movies for bottom recommendations
  const allMovies = await getLatestMovies(10);
  const relatedMovies = (allMovies || [])
    .filter(m => m.id !== post.id)
    .slice(0, 6);

  // Extract clean synopsis
  let cleanSynopsis = movie.synopsis || '';
  cleanSynopsis = cleanSynopsis.replace(/<[^>]+>/g, '').trim();

  return (
    <div className="container">
      <div className={styles.pageWrapper}>
        {/* Breadcrumbs Navigation */}
        <nav className={styles.breadcrumb}>
          <Link href="/">الرئيسية</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <Link href="/movies">الأفلام</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <span className={styles.breadcrumbCurrent}>{movie.displayTitle}</span>
        </nav>

        {/* Top Section: Detailed Metadata & Synopsis Card */}
        <section className={styles.movieDetailsCard}>
          <div className={styles.posterCol}>
            <div className={styles.posterWrapper}>
              <Image 
                src={movie.posterUrl} 
                alt={movie.rawTitle} 
                fill
                priority
                sizes="240px"
                className={styles.posterImg} 
              />
              <span className={styles.qualityTag}>{movie.quality}</span>
            </div>

            <div className={styles.posterActions}>
              <a href="#player-section" className={styles.actionBtnPlay}>
                ▶ تشغيل الفيلم
              </a>
              {downloadUrl ? (
                <a 
                  href={downloadUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className={styles.actionBtnDownload}
                >
                  ⬇ سيرفر التحميل
                </a>
              ) : (
                <a 
                  className={`${styles.actionBtnDownload} ${styles.actionBtnDownloadDisabled}`}
                  aria-disabled="true"
                >
                  التحميل غير متوفر حالياً
                </a>
              )}
            </div>
          </div>

          <div className={styles.infoCol}>
            <h1 className={styles.infoTitle}>
              تفاصيل فيلم <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} /> ({movie.year})
            </h1>

            <div className={styles.metaRow}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>التقييم:</span>
                <span className={styles.tagRating}>★ {movie.rating} IMDB</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>سنة الإنتاج:</span>
                <span className={styles.metaValue}>{movie.year}</span>
              </div>
              {movie.genres && movie.genres.length > 0 && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>التصنيف:</span>
                  <div className={styles.genreTagsList}>
                    {movie.genres.map((genre, idx) => (
                      <span key={idx} className={styles.tagGenre}>
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>الجودة:</span>
                <span className={styles.tagQuality}>{movie.quality}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>الترجمة:</span>
                <span className={styles.tagSub}>مترجم كامل احترافياً</span>
              </div>
            </div>

            <div className={styles.synopsisBox}>
              <h3 className={styles.synopsisHeading}>📖 قصة العرض</h3>
              <p className={styles.synopsisText}>
                {cleanSynopsis || 'تدور أحداث الفيلم في إطار مشوق ومثير مليء بالأحداث غير المتوقعة والمغامرات الشيقة.'}
              </p>
            </div>

            <div className={styles.noticeBox}>
              <span className={styles.noticeIcon}>💡</span>
              <p className={styles.noticeText}>
                إذا واجهت أي مشكلة في تشغيل الفيديو أو الصوت، يرجى التبديل بين سيرفرات المشاهدة المتاحة أسفل مشغل الفيديو مباشرة.
              </p>
            </div>
          </div>
        </section>

        {/* Middle Section: Theater Video Player */}
        <section id="player-section" className={styles.theaterSection}>
          <div className={styles.theaterHeader}>
            <h2 className={styles.playerTitle}>
              مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: movie.displayTitle }} /> ({movie.year}) مترجم
            </h2>
            <div className={styles.theaterBadges}>
              {movie.genres && movie.genres.length > 0 && (
                <span className={styles.badgeGenre}>{movie.genres[0]}</span>
              )}
              <span className={styles.badgeQuality}>{movie.quality}</span>
              <span className={styles.badgeSub}>مترجم بالعربية</span>
            </div>
          </div>

          <VideoPlayer 
            slug={params.slug}
            embedUrl={movie.embedUrl}
            directStreamUrl={movie.directStreamUrl}
            posterUrl={movie.posterUrl} 
            title={movie.rawTitle} 
          />
        </section>

        {/* Related Movies Section */}
        {relatedMovies.length > 0 && (
          <section className={styles.relatedSection}>
            <div className={styles.sectionHeader}>
              <div className={styles.titleGroup}>
                <span className={styles.relatedIcon}>🎬</span>
                <h2 className={styles.sectionTitle}>أفلام قد تعجبك (ذات صلة)</h2>
              </div>
              <Link href="/movies" className={styles.viewAllBtn}>
                عرض المزيد ‹
              </Link>
            </div>

            <div className={styles.relatedGrid}>
              {relatedMovies.map((relMovie) => (
                <MovieCard key={`rel-${relMovie.id}`} post={relMovie} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
