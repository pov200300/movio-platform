'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import styles from './Navbar.module.css';

export default function Navbar() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/movies?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setIsMobileMenuOpen(false);
    }
  };

  return (
    <header className={`${styles.header} ${scrolled ? styles.headerScrolled : ''}`}>
      <div className={styles.navContainer}>
        {/* Right Section: Mobile Toggle + Logo + Nav Links */}
        <div className={styles.navRight}>
          <button
            className={styles.mobileToggle}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="تبديل القائمة"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {isMobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>

          <Link href="/" className={styles.logo}>
            <span className={styles.logoRed}>EGY</span>
            <span className={styles.logoWhite}>MAX</span>
          </Link>

          <nav className={styles.desktopNav}>
            <Link 
              href="/" 
              className={`${styles.navLink} ${pathname === '/' ? styles.navLinkActive : ''}`}
            >
              الرئيسية
            </Link>
            <Link 
              href="/movies?category=arabic" 
              className={styles.navLink}
            >
              أفلام عربي
            </Link>
            <Link 
              href="/movies?category=foreign" 
              className={styles.navLink}
            >
              أفلام أجنبي
            </Link>
            <Link 
              href="/movies?sort=views" 
              className={styles.navLink}
            >
              الأكثر مشاهدة
            </Link>
            <Link 
              href="/categories" 
              className={styles.navLink}
            >
              التصنيفات
            </Link>
          </nav>
        </div>

        {/* Left Section: Search & Browse Category */}
        <div className={styles.navLeft}>
          <form onSubmit={handleSearchSubmit} className={styles.searchForm}>
            <input
              type="text"
              placeholder="ابحث عن فيلم أو ممثل..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            <button type="submit" className={styles.searchBtn} aria-label="بحث">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {isMobileMenuOpen && (
        <div className={styles.mobileDrawer}>
          <form onSubmit={handleSearchSubmit} className={styles.mobileSearchForm}>
            <input
              type="text"
              placeholder="ابحث عن فيلم أو ممثل..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.mobileSearchInput}
            />
            <button type="submit" className={styles.mobileSearchBtn} aria-label="بحث">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </form>

          <ul className={styles.mobileNavList}>
            <li>
              <Link href="/" className={pathname === '/' ? styles.mobileActive : ''}>
                🏠 الرئيسية
              </Link>
            </li>
            <li>
              <Link href="/movies?category=arabic">
                🎭 أفلام عربي
              </Link>
            </li>
            <li>
              <Link href="/movies?category=foreign">
                🎬 أفلام أجنبي
              </Link>
            </li>
            <li>
              <Link href="/movies?sort=views">
                🔥 الأكثر مشاهدة
              </Link>
            </li>
            <li>
              <Link href="/movies?year=2026">
                ⭐ أفلام 2026
              </Link>
            </li>
            <li>
              <Link href="/categories">
                📂 جميع الأقسام والتصنيفات
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
