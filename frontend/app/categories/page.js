import Link from 'next/link';
import { getCategories } from '../../lib/api';
import styles from './categories.module.css';

export const revalidate = 60;

export const metadata = {
  title: 'All Categories | CineVault',
  description: 'Browse all available movie genres and categories.',
};

export default async function CategoriesPage() {
  const categories = await getCategories();

  if (!categories || categories.length === 0) {
    return (
      <div className={styles.emptyState}>
        <h2>No categories found.</h2>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Browse Categories</h1>
        <p className={styles.description}>
          Explore our complete collection of legal media by genre.
        </p>
      </header>

      <div className={styles.grid}>
        {categories.map(category => (
          <Link key={category.id} href={`/category/${category.slug}`} className={styles.card}>
            <div className={styles.cardContent}>
              <h2 className={styles.categoryName}>{category.name}</h2>
              <span className={styles.count}>{category.count} Movies</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
