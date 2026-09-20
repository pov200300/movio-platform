import { fetchAPI } from '../../../lib/api';
import MovieCard from '../../../components/MovieCard';
import styles from './category.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Dynamic metadata
export async function generateMetadata({ params }) {
  const categories = await fetchAPI('categories?hide_empty=true');
  const cat = categories?.find(c => c.slug === params.slug);
  
  return {
    title: `أفلام قسم ${cat ? cat.name : 'التصنيف'} | EGYMAX`,
    description: `شاهد أفضل وأحدث أفلام قسم ${cat ? cat.name : ''} مترجمة بجودة عالية على منصة EGYMAX.`,
  };
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
