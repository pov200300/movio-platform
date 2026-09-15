import styles from './loading.module.css';

export default function Loading() {
  // Render a skeleton layout for the Home page
  return (
    <div className={styles.container}>
      <div className={styles.heroSkeleton}></div>
      
      <div className={styles.sectionHeaderSkeleton}></div>
      <div className={styles.grid}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={styles.cardSkeleton}>
            <div className={styles.imageSkeleton}></div>
            <div className={styles.textSkeleton}></div>
            <div className={styles.textSkeletonShort}></div>
          </div>
        ))}
      </div>
    </div>
  );
}
