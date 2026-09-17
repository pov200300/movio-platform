import { getMovieBySlug, getFeaturedImage, getMovieEmbedUrl } from '../../../lib/api';
import VideoPlayer from '../../../components/VideoPlayer';
import Image from 'next/image';
import styles from './movie.module.css';
import { notFound } from 'next/navigation';

export const revalidate = 60;

export async function generateMetadata({ params }) {
  const movie = await getMovieBySlug(params.slug);
  if (!movie) return { title: 'الفيلم غير موجود | CineVault' };
  
  return {
    title: `مشاهدة فيلم ${movie.title.rendered} مترجم | CineVault`,
    description: `مشاهدة وتحميل فيلم ${movie.title.rendered} مترجم بجودة عالية FHD على سيرفرات سريعة.`,
  };
}

export default async function MoviePage({ params }) {
  const movie = await getMovieBySlug(params.slug);
  
  if (!movie) {
    notFound();
  }

  const titleHtml = movie.title.rendered;
  const contentStr = movie.content?.rendered || '';
  
  // Extract Embed URL & HTML
  const embedUrl = getMovieEmbedUrl(movie);
  let embedHtml = '';
  if (embedUrl) {
    embedHtml = `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen scrolling="no"></iframe>`;
  } else {
    const genericIframe = contentStr.match(/<iframe.*?<\/iframe>/i);
    if (genericIframe) embedHtml = genericIframe[0];
  }

  const year = movie.meta?.video_year || '2026';
  const rating = movie.meta?.imdb_rating || '8.5';
  const quality = movie.meta?.quality || 'WEB-DL 1080p';
  const posterUrl = getFeaturedImage(movie);

  let synopsis = movie.excerpt?.rendered || movie.content?.rendered || '';
  synopsis = synopsis.replace(/<iframe.*?<\/iframe>/gi, '').trim();

  return (
    <div className="container">
      <div className={styles.pageWrapper}>
        {/* Top Header Card */}
        <div className={styles.movieHeaderCard}>
          <div className={styles.posterBox}>
            <Image 
              src={posterUrl} 
              alt={titleHtml} 
              fill
              priority
              sizes="220px"
              className={styles.posterImg} 
            />
            <span className={styles.qualityTag}>{quality}</span>
          </div>

          <div className={styles.infoBox}>
            <h1 className={styles.title}>
              مشاهدة فيلم <span dangerouslySetInnerHTML={{ __html: titleHtml }} /> {year} مترجم
            </h1>

            <div className={styles.tagsRow}>
              <span className={styles.tagRating}>★ {rating} IMDB</span>
              <span className={styles.tagPill}>مترجم للعربية</span>
              <span className={styles.tagPill}>{year}</span>
              <span className={styles.tagPillRed}>{quality}</span>
              <span className={styles.tagPillGreen}>سيرفر مباشر</span>
            </div>

            <div className={styles.synopsisSection}>
              <h3>📖 قصة الفيلم</h3>
              <div className={styles.synopsisContent} dangerouslySetInnerHTML={{ __html: synopsis }} />
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
            embedUrl={embedUrl}
            embedHtml={embedHtml} 
            posterUrl={posterUrl} 
            title={titleHtml} 
          />
        </div>
      </div>
    </div>
  );
}
