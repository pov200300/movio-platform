import Link from 'next/link';
import { getCategories } from '../../lib/api';
import styles from './categories.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'جميع الأقسام والتصنيفات | EGYMAX',
  description: 'تصفح كافة تصنيفات وأقسام الأفلام المتاحة على منصة EGYMAX.',
};

export default async function CategoriesPage() {
  const categories = await getCategories();

  if (!categories || categories.length === 0) {
    return (
      <div className="container" style={{ paddingTop: '3rem' }}>
        <div className={styles.emptyState}>
          <h2>لا توجد تصنيفات حالياً</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
      <header className={styles.header}>
        <h1 className={styles.title}>تصفح حسب التصنيف</h1>
        <p className={styles.description}>
          استكشف مكتبة أفلام EGYMAX المتنوعة مقسمة حسب النوع والتصنيف السينمائي.
        </p>
      </header>

      <div className={styles.grid}>
        {categories.map(category => (
          <Link key={category.id} href={`/category/${category.slug}`} className={styles.card}>
            <div className={styles.cardContent}>
              <h2 className={styles.categoryName}>{category.name}</h2>
              <span className={styles.count}>{category.count} فيلم</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
