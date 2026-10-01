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
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/, '');
  const pageUrl = `${siteUrl}/movie/${params.slug}`;

  try {
    const post = await getMovieBySlug(params.slug);
    if (!post) {
      return {
        title: 'الفيلم غير موجود - EgyMax',
        description: 'عذراً، الفيلم المطلوب غير متوفر حالياً على منصة EgyMax.',
        alternates: { canonical: pageUrl },
        robots: { index: false, follow: true },
      };
    }

    const movie = parseMovieData(post);
    if (!movie) {
      return {
        title: 'الفيلم غير موجود - EgyMax',
        description: 'عذراً، الفيلم المطلوب غير متوفر حالياً على منصة EgyMax.',
        alternates: { canonical: pageUrl },
        robots: { index: false, follow: true },
      };
    }

    // 1. Title format: "مشاهدة وتحميل فيلم {title} ({year}) مترجم كامل HD - EgyMax"
    const movieTitle = (movie.title || movie.displayTitle || movie.cleanTitle || movie.rawTitle || '').trim();
    const movieYear = movie.year || '2026';
    const metaTitle = movieTitle
      ? `مشاهدة وتحميل فيلم ${movieTitle} (${movieYear}) مترجم كامل HD - EgyMax`
      : 'مشاهدة وتحميل أحدث الأفلام مترجمة كاملة HD - EgyMax';

    // 2. Description: Extract the first 160 characters of the Arabic movie synopsis from the API/TMDB
    let synopsisRaw = movie.overview_ar || movie.synopsis || movie.seoDescription || '';
    if (!synopsisRaw && post.excerpt?.rendered) {
      synopsisRaw = post.excerpt.rendered;
    }
    if (!synopsisRaw && post.content?.rendered) {
      synopsisRaw = post.content.rendered;
    }

    let cleanDesc = synopsisRaw
      .replace(/<[^>]+>/g, '')
      .replace(/(Rating|Release Year|Genres|Quality|السنة|النوع|الجودة|التقييم):[^\n]+/gi, '')
      .replace(/★\s*[0-9.]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    cleanDesc = decodeHtmlEntities(cleanDesc);

    if (!cleanDesc || cleanDesc.length < 20) {
      cleanDesc = `تدور أحداث قصة فيلم ${movieTitle || 'الفيلم'} (${movieYear}) في إطار سينمائي ممتع ومميز. شاهد وحمل الفيلم مترجم كامل بدقة عالية 1080p Full HD على منصة EgyMax.`;
    }

    const metaDescription = cleanDesc.length > 160
      ? cleanDesc.slice(0, 157).trim() + '...'
      : cleanDesc;

    // 3. OpenGraph & Twitter Share Tags
    const posterUrl = movie.posterUrl && !movie.posterUrl.includes('placeholder')
      ? movie.posterUrl
      : `${siteUrl}/icon.svg`;

    return {
      title: metaTitle,
      description: metaDescription,
      alternates: {
        canonical: pageUrl,
      },
      openGraph: {
        title: metaTitle,
        description: metaDescription,
        url: pageUrl,
        siteName: 'EgyMax',
        locale: 'ar_EG',
        type: 'video.movie',
        images: [
          {
            url: posterUrl,
            width: 1200,
            height: 630,
            alt: `بوستر فيلم ${movieTitle || 'الفيلم'}`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: metaTitle,
        description: metaDescription,
        images: [posterUrl],
      },
    };
  } catch (error) {
    console.error(`[SEO] generateMetadata error for slug "${params.slug}":`, error.message);
    return {
      title: 'مشاهدة وتحميل فيلم مترجم كامل HD - EgyMax',
      description: 'شاهد وحمل أحدث الأفلام والمسلسلات الحصرية مترجمة بجودة فائقة 1080p اون لاين على منصة EgyMax.',
      alternates: {
        canonical: pageUrl,
      },
    };
  }
}

// Helper to derive high-speed direct download link from DoodStream or direct sources
const getDownloadUrl = (movie) => {
  if (!movie) return null;
  let url = null;
  if (movie.download_url) {
    url = movie.download_url;
  } else if (movie.downloadUrl) {
    url = movie.downloadUrl;
  } else if (movie.embed_url && typeof movie.embed_url === 'string') {
    url = movie.embed_url;
  } else if (movie.embedUrl && typeof movie.embedUrl === 'string') {
    url = movie.embedUrl;
  } else if (movie.dood_url && typeof movie.dood_url === 'string') {
    url = movie.dood_url;
  } else if (movie.doodUrl && typeof movie.doodUrl === 'string') {
    url = movie.doodUrl;
  } else {
    url = movie.stream_url || movie.directStreamUrl || null;
  }

  if (!url || typeof url !== 'string') return null;
  if (url.includes('/e/')) url = url.replace('/e/', '/d/');
  return url.replace(/^http:\/\//i, 'https://');
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

  const movieTitle = (movie.cleanTitle || movie.title || movie.displayTitle || movie.rawTitle || 'الفيلم').trim();

  // Derive direct download URL
  const downloadUrl = getDownloadUrl(movie);

  // Fetch related movies for bottom recommendations
  const allMovies = await getLatestMovies(10);
  const relatedMovies = (allMovies || [])
    .filter(m => m.id !== post.id)
    .slice(0, 6);

  // Extract clean synopsis (stripping residual technical headers if from legacy posts)
  let cleanSynopsis = (movie.synopsis || '')
    .replace(/<[^>]+>/g, '')
    .replace(/(Rating|Release Year|Genres|Quality):.*?(?=(Rating|Release Year|Genres|Quality|$))/gi, '')
    .replace(/★\s*[0-9.]+/g, '')
    .trim();

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
                alt={`بوستر فيلم ${movieTitle}`} 
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
                <span 
                  className={`${styles.actionBtnDownload} ${styles.actionBtnDownloadDisabled}`}
                  aria-disabled="true"
                >
                  التحميل غير متوفر حالياً
                </span>
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
              {movie.cast && movie.cast.length > 0 && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>طاقم العمل:</span>
                  <span className={styles.metaValue}>{movie.cast.join('، ')}</span>
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

            {/* Professional Arabic SEO Description */}
            {movie.seoDescription && (
              <div className={styles.seoIntroBox}>
                <p className={styles.seoIntroText}>{movie.seoDescription}</p>
              </div>
            )}

            <div className={styles.synopsisBox}>
              <h3 className={styles.synopsisHeading}>📖 قصة الفيلم</h3>
              <p className={styles.synopsisText}>
                {cleanSynopsis || 'تدور أحداث الفيلم في إطار مشوق ومثير مليء بالأحداث غير المتوقعة والمغامرات الشيقة.'}
              </p>
            </div>

            <div className={styles.noticeBox}>
              <span className={styles.noticeIcon}>💡</span>
              <p className={styles.noticeText}>
                إذا واجهت أي مشكلة في تشغيل الفيديو أو الصوت، يرجى التبديل بين سيرفرات المشاهدة المتاحة أعلى مشغل الفيديو مباشرة.
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
            servers={movie.servers}
            embedUrl={movie.embedUrl || movie.primaryEmbed}
            primaryEmbed={movie.primaryEmbed}
            vidmolyEmbed={movie.vidmolyEmbed}
            streamhgEmbed={movie.streamhgEmbed}
            streamtapeEmbed={movie.streamtapeEmbed}
            doodEmbed={movie.doodEmbed}
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
