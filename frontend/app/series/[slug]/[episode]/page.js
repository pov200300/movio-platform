import { notFound } from 'next/navigation';
import { getSeriesBySlug } from '../../../../lib/api';
import SeriesClient from '../SeriesClient';
import Image from 'next/image';
import Link from 'next/link';
import styles from '../seriesDetail.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseEpisodeParam(param) {
  if (!param) return { season: 1, episode: 1 };
  const str = String(param).toLowerCase();
  const seMatch = str.match(/s(\d+)e(\d+)/);
  if (seMatch) {
    return { season: parseInt(seMatch[1], 10), episode: parseInt(seMatch[2], 10) };
  }
  const num = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return { season: 1, episode: isNaN(num) || num <= 0 ? 1 : num };
}

export async function generateMetadata({ params }) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/, '');
  const cleanCanonical = `${siteUrl}/series/${params.slug}/${params.episode}`;

  try {
    const series = await getSeriesBySlug(params.slug);
    if (!series) {
      return {
        title: 'المسلسل غير موجود - EgyMax',
        description: 'عذراً، المسلسل المطلوب غير متوفر حالياً على منصة EgyMax.',
        alternates: { canonical: cleanCanonical },
        robots: { index: false, follow: true },
      };
    }

    const { season: parsedSeason, episode: parsedEpisode } = parseEpisodeParam(params.episode);
    const seriesTitle = (series.title || series.titleAr || 'مسلسل').trim();

    // Find if specific episode exists to get episode title / synopsis
    let epTitle = `الحلقة ${parsedEpisode}`;
    let epSynopsis = '';
    const seasonObj = series.seasons?.find(s => s.seasonNumber === parsedSeason);
    const epObj = seasonObj?.episodes?.find(e => e.episodeNumber === parsedEpisode);
    if (epObj) {
      if (epObj.title) epTitle = epObj.title;
      if (epObj.synopsis) epSynopsis = epObj.synopsis;
    }

    // Title format: "مشاهدة مسلسل {title} الموسم {season} الحلقة {episode} مترجم - EgyMax"
    const metaTitle = `مشاهدة مسلسل ${seriesTitle} الموسم ${parsedSeason} الحلقة ${parsedEpisode} مترجم - EgyMax`;

    let cleanDesc = (epSynopsis || series.synopsis || series.overview_ar || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanDesc || cleanDesc.length < 20) {
      cleanDesc = `مشاهدة وتحميل مسلسل ${seriesTitle} الموسم ${parsedSeason} الحلقة ${parsedEpisode} مترجم كامل بجودة عالية 1080p اون لاين على منصة EgyMax.`;
    }

    const metaDescription = cleanDesc.length > 160
      ? cleanDesc.slice(0, 157).trim() + '...'
      : cleanDesc;

    const posterUrl = series.posterUrl && !series.posterUrl.includes('placeholder')
      ? series.posterUrl
      : `${siteUrl}/icon.svg`;

    return {
      title: metaTitle,
      description: metaDescription,
      alternates: {
        canonical: cleanCanonical,
      },
      openGraph: {
        title: metaTitle,
        description: metaDescription,
        url: cleanCanonical,
        siteName: 'EgyMax',
        locale: 'ar_EG',
        type: 'video.tv_show',
        images: [
          {
            url: posterUrl,
            width: 1200,
            height: 630,
            alt: `بوستر مسلسل ${seriesTitle} الموسم ${parsedSeason} الحلقة ${parsedEpisode}`,
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
    return {
      title: 'مشاهدة مسلسلات مترجمة اون لاين - EgyMax',
      description: 'شاهد أقوى المسلسلات الأجنبية والعربية كاملة مترجمة بجودة عالية Full HD على منصة EgyMax.',
      alternates: {
        canonical: cleanCanonical,
      },
    };
  }
}

export default async function SeriesEpisodePage({ params }) {
  const series = await getSeriesBySlug(params.slug);

  if (!series) {
    notFound();
  }

  const { season, episode } = parseEpisodeParam(params.episode);

  return (
    <div className="container">
      <div className={styles.pageWrapper}>
        {/* Breadcrumb Navigation */}
        <nav className={styles.breadcrumb}>
          <Link href="/">الرئيسية</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <Link href="/series">المسلسلات</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <Link href={`/series/${series.slug}`}>{series.title}</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <span className={styles.breadcrumbCurrent}>الموسم {season} • الحلقة {episode}</span>
        </nav>

        {/* Hero Card / Metadata Overview */}
        <section
          className={styles.heroCard}
          style={(series.backdropUrl || series.posterUrl) ? {
            backgroundImage: `linear-gradient(to top, #0a0b10 15%, rgba(10, 11, 16, 0.88) 65%, rgba(10, 11, 16, 0.45) 100%), url(${series.backdropUrl || series.posterUrl})`,
            backgroundPosition: 'center 20%',
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
          } : undefined}
        >
          <div className={styles.posterCol}>
            <div className={styles.posterWrapper}>
              <Image
                src={series.posterUrl}
                alt={`بوستر مسلسل ${series.title}`}
                fill
                priority
                sizes="260px"
                className={styles.posterImg}
              />
            </div>
          </div>

          <div className={styles.infoCol}>
            <h1 className={styles.seriesMainTitle}>
              مشاهدة مسلسل {series.title} — الموسم {season} الحلقة {episode}
            </h1>
            {series.titleAr && <h2 className={styles.seriesSubTitle}>{series.titleAr}</h2>}

            <div className={styles.metaRow}>
              <span className={styles.ratingTag}>★ {series.rating} IMDB</span>
              <span className={styles.qualityTag}>{series.quality || '1080p FHD'}</span>
              <span className={styles.statusTag}>{series.status || 'مكتمل'}</span>
              <span className={styles.yearTag}>{series.year}</span>
              <span className={styles.yearTag}>
                {series.seasonsCount} {series.seasonsCount > 2 ? 'مواسم' : 'موسم'} • {series.episodesCount} حلقة
              </span>
            </div>

            {series.genres && series.genres.length > 0 && (
              <div className={styles.genresList}>
                {series.genres.map((g, idx) => (
                  <span key={idx} className={styles.genreItem}>
                    {g}
                  </span>
                ))}
              </div>
            )}

            <div className={styles.synopsisSection}>
              <h3 className={styles.synopsisHeading}>📖 قصة المسلسل</h3>
              <p className={styles.synopsisText}>
                {series.synopsis || 'تدور أحداث المسلسل في إطار مشوق ومثير مليء بالأحداث غير المتوقعة والمغامرات الشيقة.'}
              </p>
            </div>

            {series.cast && series.cast.length > 0 && (
              <div className={styles.castRow}>
                <strong>طاقم العمل: </strong>
                {series.cast.join('، ')}
              </div>
            )}
          </div>
        </section>

        {/* Client Interactive Player & Season/Episode Browser */}
        <SeriesClient
          series={series}
          initialSeason={season}
          initialEpisode={episode}
        />
      </div>
    </div>
  );
}
