import { fetchAPI } from '../../../lib/api';
import MovieCard from '../../../components/MovieCard';
import styles from './category.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Dynamic metadata
export async function generateMetadata({ params, searchParams }) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://egymax.vercel.app')
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/, '');
  const canonicalUrl = `${siteUrl}/category/${params.slug}`;

  try {
    const categories = await fetchAPI('categories?hide_empty=true');
    const cat = categories?.find(c => c.slug === params.slug);
    const genre = cat ? cat.name : (params.slug || 'السينما');
    const pageNumber = searchParams?.page ? String(searchParams.page) : '1';

    // Title format: "أفلام {genre} - EgyMax | صفحة {page_number}"
    const title = `أفلام ${genre} - EgyMax | صفحة ${pageNumber}`;
    const description = `تصفح وشاهد أفضل وأحدث أفلام ${genre} مترجمة بجودة عالية 1080p Full HD و 4K مجاناً على منصة EgyMax. صفحة ${pageNumber}.`.slice(0, 160);

    const hasFilters = Boolean(searchParams?.page && Number(searchParams.page) > 1);

    return {
      title,
      description,
      alternates: {
        canonical: canonicalUrl,
      },
      robots: hasFilters ? { index: false, follow: true } : { index: true, follow: true },
      openGraph: {
        title,
        description,
        url: canonicalUrl,
        siteName: 'EgyMax',
        locale: 'ar_EG',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
      },
    };
  } catch (error) {
    const pageNumber = searchParams?.page ? String(searchParams.page) : '1';
    return {
      title: `أفلام السينما - EgyMax | صفحة ${pageNumber}`,
      description: 'شاهد أحدث الأفلام والمسلسلات الحصرية مترجمة بجودة عالية على منصة EgyMax.',
      alternates: {
        canonical: canonicalUrl,
      },
    };
  }
}

export default async function CategoryPage({ params }) {
  // 1. Get the category ID by slug
  const categories = await fetchAPI(`categories?slug=${params.slug}`);
  
  if (!categories || categories.length === 0) {
    return (
      <div className="container" style={{ paddingTop: '3rem' }}>
        <div className={styles.emptyState}>
          <h2>التصنيف غير موجود</h2>
        </div>
      </div>
    );
  }
  
  const category = categories[0];
  
  // 2. Fetch posts in this category
  const posts = await fetchAPI(`posts?categories=${category.id}&_embed&per_page=30`);

  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
      <header className={styles.header}>
        <h1 className={styles.title}>أفلام {category.name}</h1>
        <p className={styles.description}>
          {category.description || `تصفح أحدث ما تم إضافته في قسم ${category.name} على منصة EGYMAX.`}
        </p>
      </header>

      {posts && posts.length > 0 ? (
        <div className={styles.grid}>
          {posts.map(movie => (
            <MovieCard key={movie.id} post={movie} />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <h3>لا توجد أفلام معروضة حالياً في هذا القسم.</h3>
        </div>
      )}
    </div>
  );
}
