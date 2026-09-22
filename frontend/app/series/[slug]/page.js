import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSeriesBySlug } from '../../../lib/api';
import SeriesClient from './SeriesClient';
import styles from './seriesDetail.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  try {
    const series = await getSeriesBySlug(params.slug);
    if (!series) {
      return {
        title: 'المسلسل غير موجود - EgyMax',
        description: 'عذراً، المسلسل المطلوب غير متوفر حالياً على منصة EgyMax.',
      };
    }

    const seriesTitle = series.title || series.titleAr || 'مسلسل';
    const metaTitle = `مشاهدة مسلسل ${seriesTitle} مترجم كامل اون لاين - EgyMax`;
    const metaDescription = series.synopsis
      ? `${series.synopsis.slice(0, 160)}...`
      : `مشاهدة وتحميل مسلسل ${seriesTitle} بجميع المواسم والحلقات مترجمة بجودة عالية 1080p على EgyMax.`;

    const posterUrl = series.posterUrl || 'https://egymax.vercel.app/icon.svg';
    const pageUrl = `https://egymax.vercel.app/series/${params.slug}`;

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
      description: 'شاهد أقوى المسلسلات الأجنبية والعربية كاملة مترجمة على منصة EgyMax.',
    };
  }
}

export default async function SeriesDetailPage({ params }) {
  const series = await getSeriesBySlug(params.slug);

  if (!series) {
    notFound();
  }

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
        <section className={styles.heroCard}>
          <div className={styles.posterCol}>
            <div className={styles.posterWrapper}>
              <Image
                src={series.posterUrl}
                alt={series.title}
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
        <SeriesClient series={series} />
      </div>
    </div>
  );
}
