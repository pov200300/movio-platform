import { getLatestMovies, fetchAPI } from '../../../lib/api';
import MovieCard from '../../../components/MovieCard';
import styles from './category.module.css';

export const revalidate = 60;

// Dynamic metadata
export async function generateMetadata({ params }) {
  // Try to find the category name by fetching categories and matching the slug
  const categories = await fetchAPI('categories?hide_empty=true');
  const cat = categories?.find(c => c.slug === params.slug);
  
  return {
    title: `${cat ? cat.name : 'Category'} Movies | CineVault`,
    description: `Watch the best authorized ${cat ? cat.name : ''} movies online.`,
  };
}

export default async function CategoryPage({ params }) {
  // 1. Get the category ID by slug
  const categories = await fetchAPI(`categories?slug=${params.slug}`);
  
  if (!categories || categories.length === 0) {
    return (
      <div className={styles.emptyState}>
        <h2>Category Not Found</h2>
      </div>
    );
  }
  
  const category = categories[0];
  
  // 2. Fetch posts in this category
  const posts = await fetchAPI(`posts?categories=${category.id}&_embed&per_page=20`);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{category.name} Movies</h1>
        <p className={styles.description}>
          {category.description || `Browse our collection of authorized ${category.name} content.`}
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
          <h3>No movies currently available in this category.</h3>
        </div>
      )}
    </div>
  );
}
