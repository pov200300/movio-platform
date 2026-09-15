'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './Navbar.module.css';

export default function Navbar() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/movies?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className={styles.headerStack}>
      {/* Top Header Bar */}
      <div className={styles.topBar}>
        <div className={styles.container}>
          {/* Logo Group */}
          <div className={styles.brandGroup}>
            <button 
              className={styles.mobileToggle}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle Navigation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <Link href="/" className={styles.logo}>
              <span className={styles.logoRed}>EGY</span>VAULT
              <span className={styles.logoBadge}>HD</span>
            </Link>
          </div>

          {/* Search Box */}
          <div className={styles.searchBox}>
            <form onSubmit={handleSearchSubmit} className={styles.searchForm}>
              <input
                type="text"
                placeholder="ابحث عن اسم الفيلم أو المسلسل..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
              <button type="submit" className={styles.searchBtn} aria-label="Search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Sub Navigation Bar */}
      <div className={`${styles.subNavBar} ${isMobileMenuOpen ? styles.subNavBarOpen : ''}`}>
        <div className={styles.container}>
          <ul className={styles.subNavList}>
            <li><Link href="/" className={styles.activeItem}>🏠 الرئيسية</Link></li>
            <li><Link href="/movies?year=2026">🔥 أفلام 2026</Link></li>
            <li><Link href="/movies?type=translated">🎬 أفلام مترجمة</Link></li>
            <li><Link href="/movies?type=dubbed">🎙️ أفلام مدبلجة</Link></li>
            <li><Link href="/categories?type=series">📺 المسلسلات</Link></li>
            <li><Link href="/categories?type=anime">⚔️ أنمي</Link></li>
            <li><Link href="/movies?quality=1080p">⭐ الأعلى تقييماً</Link></li>
          </ul>
        </div>
      </div>
    </header>
  );
}
