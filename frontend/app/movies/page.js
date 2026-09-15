import { getLatestMovies } from '../../lib/api';
import MovieCard from '../../components/MovieCard';
import styles from '../page.module.css';

export const revalidate = 60;

export const metadata = {
  title: 'All Movies | CineVault',
  description: 'Browse our entire collection of authorized movies.',
};

export default async function MoviesPage() {
  // Fetch up to 50 latest movies for the all movies page
  const movies = await getLatestMovies(50);
  
  if (!movies || movies.length === 0) {
    return (
      <div className={styles.emptyState}>
        <h2>No movies found.</h2>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h1 className={styles.sectionTitle} style={{fontSize: '2.5rem', marginBottom: '2rem'}}>All Movies</h1>
        </div>
        
        <div className={styles.grid}>
          {movies.map(movie => (
            <MovieCard key={movie.id} post={movie} />
          ))}
        </div>
      </section>
    </div>
  );
}
