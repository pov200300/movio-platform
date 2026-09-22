'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SearchBar from './SearchBar';
import styles from './Navbar.module.css';

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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

          <Link href="/" className={styles.logo} aria-label="EGYMAX الرئيسية">
            <span className={styles.logoIconWrapper}>
              <svg viewBox="0 0 64 64" width="32" height="32" className={styles.logoIconSvg} aria-hidden="true">
                <rect width="64" height="64" rx="16" fill="#050608" />
                <rect width="61" height="61" x="1.5" y="1.5" rx="14.5" fill="none" stroke="#ffffff" strokeWidth="1.8" />
                <circle cx="51" cy="14" r="2.5" fill="#ff1723" />
                <path d="M14 16 H31 L28 23 H21 V28 H28 L25 35 H21 V41 H30 L27 48 H14 Z" fill="#e50914" />
                <path d="M33 16 H40 L50 32 L40 48 H33 L43 32 Z" fill="#ffffff" />
                <path d="M49 16 H43 L33 32 L43 48 H49 L39 32 Z" fill="#ff1723" />
              </svg>
            </span>
            <span className={styles.logoText}>
              <span className={styles.logoRed}>EGY</span>
              <span className={styles.logoWhite}>MAX</span>
            </span>
          </Link>

          <nav className={styles.desktopNav}>
            <Link 
              href="/" 
              className={`${styles.navLink} ${pathname === '/' ? styles.navLinkActive : ''}`}
            >
              الرئيسية
            </Link>
            <Link 
              href="/movies?category=foreign" 
              className={styles.navLink}
            >
              أفلام أجنبي
            </Link>
            <Link 
              href="/movies?category=arabic" 
              className={styles.navLink}
            >
              أفلام عربي
            </Link>
            <Link 
              href="/series" 
              className={`${styles.navLink} ${pathname.startsWith('/series') ? styles.navLinkActive : ''}`}
            >
              المسلسلات
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

        {/* Left Section: Real-Time Autocomplete Search */}
        <div className={styles.navLeft}>
          <SearchBar />
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {isMobileMenuOpen && (
        <div className={styles.mobileDrawer}>
          <div className={styles.mobileSearchContainer}>
            <SearchBar isMobile onNavigate={() => setIsMobileMenuOpen(false)} />
          </div>

          <ul className={styles.mobileNavList}>
            <li>
              <Link href="/" className={pathname === '/' ? styles.mobileActive : ''}>
                🏠 الرئيسية
              </Link>
            </li>
            <li>
              <Link href="/series" className={pathname.startsWith('/series') ? styles.mobileActive : ''}>
                📺 المسلسلات
              </Link>
            </li>
            <li>
              <Link href="/movies?category=foreign">
                🎬 أفلام أجنبي
              </Link>
            </li>
            <li>
              <Link href="/movies?category=arabic">
                🎭 أفلام عربي
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
