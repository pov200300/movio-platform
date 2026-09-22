import Image from 'next/image';
import Link from 'next/link';
import { getSeriesList } from '../../lib/api';
import styles from './series.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'مسلسلات أجنبية وعربية كاملة مترجمة اون لاين | EgyMax',
  description: 'شاهد وحمّل أحدث وأقوى المسلسلات الأجنبية والعربية كاملة بجميع المواسم والحلقات بجودة 1080p Full HD مع مشغل سريع ومتعدد السيرفرات على EgyMax.',
  openGraph: {
    title: 'مسلسلات اون لاين كاملة مترجمة - EgyMax',
    description: 'تصفح مكتبة المسلسلات العالمية والمواسم الكاملة مترجمة باحترافية وبأعلى دقة.',
    url: 'https://egymax.vercel.app/series',
    siteName: 'EgyMax',
    locale: 'ar_EG',
    type: 'website',
  },
};

const GENRES = [
  'الكل',
  'دراما',
  'جريمة',
  'أكشن',
  'فانتازيا',
  'خيال علمي',
  'تاريخي',
  'إثارة',
  'رعب',
];

export default async function SeriesCatalogPage({ searchParams }) {
  const selectedCategory = searchParams?.category || '';
  const searchTerm = searchParams?.search || '';

  const series = await getSeriesList({
    search: searchTerm,
    category: selectedCategory === 'الكل' ? '' : selectedCategory,
  });

  return (
    <div className="container">
      <div className={styles.seriesPageWrapper}>
        {/* Hero Banner */}
        <section className={styles.heroBanner}>
          <h1 className={styles.heroTitle}>
            <span>📺</span> مكتبة المسلسلات العالمية
          </h1>
          <p className={styles.heroSubtitle}>
            استمتع بمشاهدة أحدث المواسم والحلقات الحصرية لأفضل المسلسلات الأجنبية والعربية مترجمة بدقة فائقة وبأعلى جودة مع سيرفرات تشغيل فائقة السرعة ومتعددة الجودات.
          </p>
        </section>

        {/* Filter Bar & Genre Pills */}
        <div className={styles.filterBar}>
          <div className={styles.genrePills}>
            {GENRES.map((genre) => {
              const isActive = (!selectedCategory && genre === 'الكل') || selectedCategory === genre;
              const href = genre === 'الكل' ? '/series' : `/series?category=${encodeURIComponent(genre)}`;
              return (
                <Link
                  key={genre}
                  href={href}
                  className={`${styles.genrePill} ${isActive ? styles.activeGenrePill : ''}`}
                >
                  {genre}
                </Link>
              );
            })}
          </div>

          <span className={styles.seriesCount}>
            {series.length} مسلسل متوفر
          </span>
        </div>

        {/* Series Grid */}
        {series.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔍</div>
            <h2>لا توجد مسلسلات مطابقة</h2>
            <p>جرّب اختيار تصنيف آخر أو تصفح القائمة الكاملة.</p>
            <Link href="/series" className={styles.genrePill} style={{ marginTop: '1rem' }}>
              عرض جميع المسلسلات
            </Link>
          </div>
        ) : (
          <div className={styles.seriesGrid}>
            {series.map((item) => (
              <Link
                key={item.id}
                href={`/series/${item.slug}`}
                className={styles.seriesCard}
                title={`مشاهدة مسلسل ${item.title}`}
              >
                <div className={styles.posterWrapper}>
                  <Image
                    src={item.posterUrl}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                    className={styles.posterImg}
                  />
                  <div className={styles.topBadges}>
                    <span className={styles.ratingBadge}>★ {item.rating}</span>
                    <span className={styles.qualityBadge}>{item.quality || '1080p FHD'}</span>
                  </div>
                  <span className={styles.statusBadge}>{item.status || 'مكتمل'}</span>
                </div>

                <div className={styles.cardBody}>
                  <h3 className={styles.seriesTitle}>{item.title}</h3>
                  {item.titleAr && <h4 className={styles.seriesTitleAr}>{item.titleAr}</h4>}
                  <div className={styles.metaDetails}>
                    <span>{item.year}</span>
                    <span className={styles.seasonsTag}>
                      {item.seasonsCount} {item.seasonsCount > 2 ? 'مواسم' : 'موسم'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
