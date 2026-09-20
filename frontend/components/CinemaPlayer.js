'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './CinemaPlayer.module.css';

export default function CinemaPlayer({
  url,
  poster,
  title = 'EGYMAX Cinema Stream',
  isTheater = false,
  onTheaterToggle,
  onError,
}) {
  const containerRef = useRef(null);
  const artInstanceRef = useRef(null);
  const [loadError, setLoadError] = useState(false);
  const [gestureNotice, setGestureNotice] = useState(null);
  const gestureTimeoutRef = useRef(null);

  const showGestureNotice = (text) => {
    if (gestureTimeoutRef.current) clearTimeout(gestureTimeoutRef.current);
    setGestureNotice(text);
    gestureTimeoutRef.current = setTimeout(() => {
      setGestureNotice(null);
    }, 700);
  };

  useEffect(() => {
    let art = null;
    let isCancelled = false;

    if (!containerRef.current || !url) return;

    setLoadError(false);

    // Dynamic import to guarantee SSR safety in Next.js App Router
    import('artplayer').then((module) => {
      if (isCancelled || !containerRef.current) return;
      const Artplayer = module.default;

      // Clean up previous instance if any
      if (artInstanceRef.current && artInstanceRef.current.destroy) {
        artInstanceRef.current.destroy(false);
      }

      art = new Artplayer({
        container: containerRef.current,
        url: url,
        poster: poster || '',
        title: title,
        theme: '#e50914', // Cinema Red accent
        volume: 0.8,
        isLive: false,
        muted: false,
        autoplay: false,
        pip: true,
        autoSize: false,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: true,
        playbackRate: true,
        aspectRatio: true,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: true,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: true,
        airplay: true,
        hotkey: true, // Space, Arrow keys, M, F built-in
        lang: 'ar',
        playbackRate: [0.5, 0.75, 1, 1.25, 1.5, 2],
        whitelist: ['*'],
        moreVideoAttr: {
          crossOrigin: 'anonymous',
          preload: 'metadata',
        },
        controls: [
          // 1. Custom Rewind 10s Button
          {
            name: 'rewind-10',
            position: 'left',
            index: 10,
            html: `
              <button class="art-custom-btn" title="رجوع 10 ثواني (⏪ 10s)" aria-label="Rewind 10 seconds" style="display:inline-flex;align-items:center;justify-content:center;background:none;border:none;color:#ffffff;cursor:pointer;padding:0 8px;height:100%;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>
                </svg>
                <span style="font-size:11px;font-weight:800;margin-right:2px;font-family:sans-serif;">10</span>
              </button>
            `,
            click: function () {
              if (!art) return;
              art.seek = Math.max(0, art.currentTime - 10);
              showGestureNotice('⏪ 10 ثواني');
            },
          },
          // 2. Custom Forward 10s Button
          {
            name: 'forward-10',
            position: 'left',
            index: 11,
            html: `
              <button class="art-custom-btn" title="تقديم 10 ثواني (10s ⏩)" aria-label="Forward 10 seconds" style="display:inline-flex;align-items:center;justify-content:center;background:none;border:none;color:#ffffff;cursor:pointer;padding:0 8px;height:100%;">
                <span style="font-size:11px;font-weight:800;margin-left:2px;font-family:sans-serif;">10</span>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>
                </svg>
              </button>
            `,
            click: function () {
              if (!art) return;
              art.seek = Math.min(art.duration || 99999, art.currentTime + 10);
              showGestureNotice('10 ثواني ⏩');
            },
          },
          // 3. Custom Theater Mode Switcher
          ...(onTheaterToggle
            ? [
                {
                  name: 'theater-mode',
                  position: 'right',
                  index: 15,
                  html: `
                    <button class="art-custom-btn" title="${isTheater ? 'الوضع العادي' : 'وضع المسرح السينمائي'}" style="display:inline-flex;align-items:center;justify-content:center;background:none;border:none;color:#ffffff;cursor:pointer;padding:0 8px;height:100%;">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="5" width="20" height="14" rx="2" />
                        <line x1="2" y1="15" x2="22" y2="15" />
                      </svg>
                    </button>
                  `,
                  click: function () {
                    onTheaterToggle();
                  },
                },
              ]
            : []),
        ],
        // Floating EGYMAX Watermark (Non-clickable, semi-transparent)
        layers: [
          {
            name: 'egymax-brand-watermark',
            html: `
              <div style="display:inline-flex;align-items:center;direction:ltr;font-weight:900;letter-spacing:1.5px;font-size:15px;opacity:0.65;user-select:none;pointer-events:none;text-shadow:0 2px 8px rgba(0,0,0,0.8);">
                <span style="color:#e50914;">EGY</span><span style="color:#ffffff;">MAX</span>
              </div>
            `,
            style: {
              position: 'absolute',
              top: '16px',
              right: '20px',
              zIndex: 25,
            },
          },
        ],
        customType: {
          m3u8: function (video, m3u8Url) {
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = m3u8Url;
            }
          },
        },
      });

      // Handle stream playback errors safely
      art.on('error', (err) => {
        console.warn('CinemaPlayer stream error:', err);
        setLoadError(true);
        if (onError) onError(err);
      });

      // Enhanced Keyboard Shortcuts (K, Space, Left, Right, Up, Down, F, M)
      const handleGlobalKeyDown = (e) => {
        if (!art || !art.template || !art.template.$container) return;
        // Don't intercept if user is typing in an input
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

        if (e.code === 'KeyK' || (e.code === 'Space' && document.activeElement === document.body)) {
          e.preventDefault();
          art.toggle();
        } else if (e.code === 'KeyF') {
          e.preventDefault();
          art.fullscreen = !art.fullscreen;
        } else if (e.code === 'KeyM') {
          e.preventDefault();
          art.muted = !art.muted;
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          art.seek = Math.max(0, art.currentTime - 10);
          showGestureNotice('⏪ 10s');
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          art.seek = Math.min(art.duration || 99999, art.currentTime + 10);
          showGestureNotice('10s ⏩');
        } else if (e.code === 'ArrowUp') {
          e.preventDefault();
          art.volume = Math.min(1, art.volume + 0.05);
        } else if (e.code === 'ArrowDown') {
          e.preventDefault();
          art.volume = Math.max(0, art.volume - 0.05);
        }
      };

      window.addEventListener('keydown', handleGlobalKeyDown);

      // Mobile Touch Gesture Handler (Double tap left side -> -10s, right side -> +10s)
      let lastTapTime = 0;
      let lastTapX = 0;

      const handleTouchEnd = (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;
        const touch = e.changedTouches[0];
        if (!touch || !art) return;

        if (tapLength < 320 && tapLength > 0) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const tapX = touch.clientX - rect.left;
            const width = rect.width;

            if (tapX < width * 0.4) {
              // Left side double tap -> Rewind 10s
              e.preventDefault();
              art.seek = Math.max(0, art.currentTime - 10);
              showGestureNotice('⏪ 10 ثواني');
            } else if (tapX > width * 0.6) {
              // Right side double tap -> Forward 10s
              e.preventDefault();
              art.seek = Math.min(art.duration || 99999, art.currentTime + 10);
              showGestureNotice('10 ثواني ⏩');
            }
          }
        }
        lastTapTime = currentTime;
        lastTapX = touch.clientX;
      };

      const containerEl = containerRef.current;
      containerEl?.addEventListener('touchend', handleTouchEnd);

      artInstanceRef.current = art;

      return () => {
        window.removeEventListener('keydown', handleGlobalKeyDown);
        containerEl?.removeEventListener('touchend', handleTouchEnd);
        if (art && art.destroy) {
          art.destroy(false);
        }
      };
    });

    return () => {
      isCancelled = true;
      if (artInstanceRef.current && artInstanceRef.current.destroy) {
        artInstanceRef.current.destroy(false);
      }
    };
  }, [url, poster, title, isTheater, onTheaterToggle, onError]);

  return (
    <div className={`${styles.playerContainer} ${isTheater ? styles.theaterMode : ''}`}>
      <div ref={containerRef} className={styles.artWrapper} />

      {/* Double Tap Gesture Floating Notice */}
      {gestureNotice && (
        <div className={styles.gestureOverlay}>
          <div className={styles.gestureBadge}>{gestureNotice}</div>
        </div>
      )}

      {/* Error Fallback Banner */}
      {loadError && (
        <div className={styles.errorOverlay}>
          <span className={styles.errorIcon}>⚠️</span>
          <h4>تعذر تحميل المشغل المباشر</h4>
          <p>يتم الآن التبديل تلقائياً إلى سيرفر المشاهدة البديل لضمان استمرار العرض...</p>
        </div>
      )}
    </div>
  );
}
