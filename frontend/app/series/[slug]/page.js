import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSeriesBySlug } from '../../../lib/api';
import SeriesClient from './SeriesClient';
import styles from './seriesDetail.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params, searchParams }) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/, '');
  const cleanCanonical = `${siteUrl}/series/${params.slug}`;

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

    const seriesTitle = (series.title || series.titleAr || 'مسلسل').trim();
    const season = searchParams?.season || (series.seasons?.[0]?.seasonNumber) || 1;
    const episode = searchParams?.episode || (series.seasons?.[0]?.episodes?.[0]?.episodeNumber) || 1;

    // Title format: "مشاهدة مسلسل {title} الموسم {season} الحلقة {episode} مترجم - EgyMax"
    const metaTitle = `مشاهدة مسلسل ${seriesTitle} الموسم ${season} الحلقة ${episode} مترجم - EgyMax`;

    let cleanDesc = (series.synopsis || series.overview_ar || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanDesc || cleanDesc.length < 20) {
      cleanDesc = `مشاهدة وتحميل مسلسل ${seriesTitle} الموسم ${season} الحلقة ${episode} مترجم كامل بجودة عالية 1080p اون لاين على منصة EgyMax.`;
    }

    const metaDescription = cleanDesc.length > 160
      ? cleanDesc.slice(0, 157).trim() + '...'
      : cleanDesc;

    const posterUrl = series.posterUrl && !series.posterUrl.includes('placeholder')
      ? series.posterUrl
      : `${siteUrl}/icon.svg`;

    const hasEpisodeParams = Boolean(searchParams?.season || searchParams?.episode);

    return {
      title: metaTitle,
      description: metaDescription,
      alternates: {
        canonical: cleanCanonical,
      },
      robots: hasEpisodeParams ? { index: false, follow: true } : { index: true, follow: true },
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
            alt: `بوستر مسلسل ${seriesTitle}`,
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

export default async function SeriesDetailPage({ params, searchParams }) {
  const series = await getSeriesBySlug(params.slug);

  if (!series) {
    notFound();
  }

  const initialSeason = searchParams?.season ? Number(searchParams.season) : null;
  const initialEpisode = searchParams?.episode ? Number(searchParams.episode) : null;

  return (
    <div className="container">
      <div className={styles.pageWrapper}>
        {/* Breadcrumb Navigation */}
        <nav className={styles.breadcrumb}>
          <Link href="/">الرئيسية</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <Link href="/series">المسلسلات</Link>
          <span className={styles.breadcrumbSep}>‹</span>
          <span className={styles.breadcrumbCurrent}>{series.title}</span>
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
            <h1 className={styles.seriesMainTitle}>{series.title}</h1>
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
          initialSeason={initialSeason}
          initialEpisode={initialEpisode}
        />
      </div>
    </div>
  );
}
