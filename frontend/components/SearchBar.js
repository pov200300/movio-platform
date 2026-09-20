'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import styles from './SearchBar.module.css';

export default function SearchBar({ isMobile = false, onNavigate }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const router = useRouter();

  // 1. Debounced search trigger (300ms)
  useEffect(() => {
    const trimmed = query.trim();

    // Trigger threshold: >= 2 chars
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setIsOpen(false);
      setSelectedIndex(-1);
      return;
    }

    setIsLoading(true);
    setSelectedIndex(-1);

    const timer = setTimeout(async () => {
      // Cancel previous pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: abortControllerRef.current.signal,
        });

        if (res.ok) {
          const data = await res.json();
          setSuggestions(Array.isArray(data) ? data : []);
          setIsOpen(true);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Autocomplete fetch error:', err);
          setSuggestions([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  // 2. Click outside listener to dismiss
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // 3. Navigation handler
  const handleSelectMovie = useCallback((slug) => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(-1);
    if (onNavigate) onNavigate();
    router.push(`/movie/${slug}`);
  }, [router, onNavigate]);

  const handleSubmitAll = useCallback((e) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    // If an item is selected via keyboard arrow keys, open that movie
    if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
      handleSelectMovie(suggestions[selectedIndex].slug);
      return;
    }

    setIsOpen(false);
    setSelectedIndex(-1);
    if (onNavigate) onNavigate();
    router.push(`/movies?search=${encodeURIComponent(trimmed)}`);
  }, [query, selectedIndex, suggestions, handleSelectMovie, onNavigate, router]);

  // 4. Keyboard interaction listener
  const handleKeyDown = (e) => {
    if (!isOpen && e.key !== 'ArrowDown' && e.key !== 'Enter') return;

    if (e.key === 'Escape') {
      setIsOpen(false);
      setSelectedIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && query.trim().length >= 2) {
        setIsOpen(true);
        return;
      }
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      handleSubmitAll(e);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={`${styles.searchContainer} ${isMobile ? styles.searchContainerMobile : ''}`}
    >
      <form onSubmit={handleSubmitAll} className={styles.searchForm}>
        <input
          ref={inputRef}
          type="text"
          placeholder="ابحث عن فيلم، مسلسل، أو ممثل..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (query.trim().length >= 2 && suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          className={styles.searchInput}
          autoComplete="off"
          spellCheck="false"
        />

        {/* Loading Indicator or Submit Icon */}
        <button type="submit" className={styles.searchBtn} aria-label="بحث">
          {isLoading ? (
            <div className={styles.spinner} />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          )}
        </button>
      </form>

      {/* Autocomplete Suggestions Glassmorphic Dropdown */}
      {isOpen && (
        <div className={styles.dropdown}>
          {suggestions.length > 0 ? (
            <>
              <div className={styles.suggestionsHeader}>
                <span>أفضل النتائج المقترحة:</span>
              </div>

              <ul className={styles.suggestionsList}>
                {suggestions.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <li
                      key={item.id || item.slug}
                      className={`${styles.suggestionItem} ${isSelected ? styles.itemSelected : ''}`}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => handleSelectMovie(item.slug)}
                    >
                      {/* Mini Poster Thumbnail */}
                      <div className={styles.thumbWrapper}>
                        <Image
                          src={item.poster_url || '/placeholder.svg'}
                          alt={item.title_en || item.title_ar}
                          fill
                          sizes="42px"
                          className={styles.thumbImg}
                        />
                      </div>

                      {/* Movie Titles & Meta */}
                      <div className={styles.itemInfo}>
                        <h4 className={styles.itemTitleAr}>
                          {item.title_ar}
                        </h4>
                        {item.title_en && item.title_en !== item.title_ar && (
                          <span className={styles.itemTitleEn}>
                            {item.title_en}
                          </span>
                        )}

                        <div className={styles.itemMetaRow}>
                          <span className={styles.ratingBadge}>★ {item.rating}</span>
                          <span className={styles.yearBadge}>{item.year}</span>
                          <span className={styles.qualityBadge}>{item.quality}</span>
                        </div>
                      </div>

                      {/* Arrow indication */}
                      <div className={styles.itemArrow}>
                        ‹
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Footer All Results Link */}
              <div className={styles.dropdownFooter} onClick={handleSubmitAll}>
                <span>عرض جميع النتائج لـ <strong>"{query.trim()}"</strong></span>
                <span className={styles.footerArrow}>‹</span>
              </div>
            </>
          ) : !isLoading && query.trim().length >= 2 ? (
            <div className={styles.emptyResults}>
              <span className={styles.emptyIcon}>🔍</span>
              <p>لم يتم العثور على نتائج مطابقة لـ <strong>"{query.trim()}"</strong></p>
              <Link 
                href={`/movies?search=${encodeURIComponent(query.trim())}`}
                className={styles.emptyLink}
                onClick={() => {
                  setIsOpen(false);
                  if (onNavigate) onNavigate();
                }}
              >
                البحث في جميع الأفلام ‹
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
