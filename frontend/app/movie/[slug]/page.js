import { getMovieBySlug, getLatestMovies, parseMovieData, getDualQualityDownloadLinks } from '../../../lib/api';
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

  // Derive dual-quality download links (1080p DoodStream + 720p Streamtape + 1080p Vidmoly mirror)
  const download1080_dood = movie.download1080_dood || null;
  const download1080_vidmoly = movie.download1080_vidmoly || null;
  const download720 = movie.download720 || null;
  const provider720 = movie.provider720 || 'Streamtape';
  const legacyDownloadUrl = getDownloadUrl(movie);

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

              {/* Redesigned Modern Download Section Card */}
              <div className={styles.downloadCard}>
                <div className={styles.downloadCardHeader}>
                  <span className={styles.downloadCardIcon}>⬇️</span>
                  <span className={styles.downloadCardTitle}>سيرفرات التحميل المباشر والسريع</span>
                </div>

                <div className={styles.downloadCardButtons}>
                  {/* Button 1: Primary 1080p (DoodStream - No Geo-restrictions) */}
                  {download1080_dood && (
                    <a 
                      href={download1080_dood} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className={`${styles.downloadBtn} ${styles.downloadBtn1080}`}
                      title="تحميل الفيلم بجودة 1080p FHD عبر DoodStream (مباشر وسريع بدون حجب)"
                    >
                      <div className={styles.downloadBtnContent}>
                        <span className={styles.downloadBtnLabel}>تحميل الفيلم بجودة 1080p FHD</span>
                        <span className={styles.downloadBtnServer}>DoodStream (مباشر وسريع)</span>
                      </div>
                      <span className={styles.downloadBadge1080}>1080p FHD</span>
                    </a>
                  )}

                  {/* Button 2: Speed 720p (Streamtape / StreamHG) */}
                  {download720 && (
                    <a 
                      href={download720} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className={`${styles.downloadBtn} ${styles.downloadBtn720}`}
                      title={`تحميل الفيلم بجودة 720p عبر ${provider720 === 'Streamtape' ? 'Streamtape (أقصى سرعة)' : 'StreamHG'}`}
                    >
                      <div className={styles.downloadBtnContent}>
                        <span className={styles.downloadBtnLabel}>تحميل الفيلم بجودة 720p HD</span>
                        <span className={styles.downloadBtnServer}>
                          {provider720 === 'Streamtape' ? 'Streamtape (أقصى سرعة)' : 'StreamHG (سريع ومباشر)'}
                        </span>
                      </div>
                      <span className={styles.downloadBadge720}>720p Fast</span>
                    </a>
                  )}

                  {/* Button 3: Optional 1080p Mirror (Vidmoly /v/) */}
                  {download1080_vidmoly && (
                    <a 
                      href={download1080_vidmoly} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className={`${styles.downloadBtn} ${styles.downloadBtnMirror}`}
                      title="سيرفر بديل لمشاهدة وتحميل الفيلم بجودة 1080p عبر Vidmoly"
                    >
                      <div className={styles.downloadBtnContent}>
                        <span className={styles.downloadBtnMirrorLabel}>مرآة بديلة 1080p (Vidmoly)</span>
                        <span className={styles.downloadBtnServer}>Vidmoly Server</span>
                      </div>
                      <span className={styles.downloadBadgeMirror}>سيرفر بديل</span>
                    </a>
                  )}

                  {/* Fallback to legacy single download if no dual servers resolved */}
                  {!download1080_dood && !download720 && !download1080_vidmoly && legacyDownloadUrl && (
                    <a 
                      href={legacyDownloadUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className={`${styles.downloadBtn} ${styles.downloadBtn1080}`}
                      title="تحميل الفيلم المباشر"
                    >
                      <div className={styles.downloadBtnContent}>
                        <span className={styles.downloadBtnLabel}>تحميل الفيلم المباشر</span>
                        <span className={styles.downloadBtnServer}>سيرفر التحميل</span>
                      </div>
                      <span className={styles.downloadBadge1080}>تحميل</span>
                    </a>
                  )}

                  {/* Disabled state when no download servers are found */}
                  {!download1080_dood && !download720 && !download1080_vidmoly && !legacyDownloadUrl && (
                    <div className={styles.downloadDisabledNotice}>
                      <span>التحميل غير متوفر حالياً لهذا الفيلم</span>
                    </div>
                  )}
                </div>
              </div>
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
            download1080_dood={download1080_dood}
            download1080_vidmoly={download1080_vidmoly}
            download720={download720}
            provider720={provider720}
          />

          {/* Dual-Quality Download Bar under Player */}
          {(download1080_dood || download720 || download1080_vidmoly || legacyDownloadUrl) && (
            <div className={styles.playerDownloadCard}>
              <div className={styles.playerDownloadCardHeader}>
                <div className={styles.playerDownloadTitleGroup}>
                  <span className={styles.playerDownloadIcon}>⬇️</span>
                  <span className={styles.playerDownloadHeading}>سيرفرات التحميل المباشر والسريع</span>
                </div>
                <span className={styles.playerDownloadSub}>اختر الجودة وسيرفر التحميل المفضل لجهازك للتحميل المباشر بدون قيود</span>
              </div>

              <div className={styles.playerDownloadGrid}>
                {download1080_dood && (
                  <a
                    href={download1080_dood}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.downloadBtn} ${styles.downloadBtn1080}`}
                    title="تحميل مباشر 1080p FHD عبر DoodStream بدون حجب"
                  >
                    <div className={styles.downloadBtnContent}>
                      <span className={styles.downloadBtnLabel}>تحميل الفيلم بجودة 1080p FHD</span>
                      <span className={styles.downloadBtnServer}>DoodStream (مباشر وسريع)</span>
                    </div>
                    <span className={styles.downloadBadge1080}>1080p FHD</span>
                  </a>
                )}

                {download720 && (
                  <a
                    href={download720}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.downloadBtn} ${styles.downloadBtn720}`}
                    title={`تحميل فائق السرعة 720p HD عبر ${provider720}`}
                  >
                    <div className={styles.downloadBtnContent}>
                      <span className={styles.downloadBtnLabel}>تحميل الفيلم بجودة 720p HD</span>
                      <span className={styles.downloadBtnServer}>
                        {provider720 === 'Streamtape' ? 'Streamtape (أقصى سرعة)' : 'StreamHG (سريع ومباشر)'}
                      </span>
                    </div>
                    <span className={styles.downloadBadge720}>720p Fast</span>
                  </a>
                )}

                {download1080_vidmoly && (
                  <a
                    href={download1080_vidmoly}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.downloadBtn} ${styles.downloadBtnMirror}`}
                    title="مرآة بديلة 1080p عبر Vidmoly"
                  >
                    <div className={styles.downloadBtnContent}>
                      <span className={styles.downloadBtnMirrorLabel}>مرآة بديلة 1080p (Vidmoly)</span>
                      <span className={styles.downloadBtnServer}>Vidmoly Server</span>
                    </div>
                    <span className={styles.downloadBadgeMirror}>سيرفر بديل</span>
                  </a>
                )}

                {!download1080_dood && !download720 && !download1080_vidmoly && legacyDownloadUrl && (
                  <a
                    href={legacyDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.downloadBtn} ${styles.downloadBtn1080}`}
                  >
                    <div className={styles.downloadBtnContent}>
                      <span className={styles.downloadBtnLabel}>تحميل الفيلم المباشر</span>
                    </div>
                    <span className={styles.downloadBadge1080}>تحميل</span>
                  </a>
                )}
              </div>
            </div>
          )}
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
