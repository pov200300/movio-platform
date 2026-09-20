'use client';
import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import CinemaPlayer from './CinemaPlayer';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({
  slug,
  embedUrl,
  directStreamUrl,
  embedHtml,
  posterUrl,
  title,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeServer, setActiveServer] = useState(1); // 1 = VIP Direct, 2 = DoodStream Mirror, 3 = CDN Embed
  const [streamUrl, setStreamUrl] = useState(directStreamUrl || null);
  const [isResolving, setIsResolving] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const [isTheater, setIsTheater] = useState(false);

  // Extract clean embed URL if embedHtml was passed instead
  let rawUrl = embedUrl;
  if (!rawUrl && embedHtml) {
    const match = embedHtml.match(/src=["']([^"']+)["']/i);
    if (match) rawUrl = match[1];
  }

  // Generate live mirror servers
  let doodMirrorUrl = rawUrl;
  let cdnMirrorUrl = null;

  if (rawUrl) {
    doodMirrorUrl = rawUrl.replace('dood.to', 'doodstream.com').replace('dood.so', 'doodstream.com');
    cdnMirrorUrl = rawUrl.replace('doodstream.com', 'dood.so').replace('dood.to', 'dood.so');
  }

  // Function to resolve direct stream link without switching tabs
  const resolveStream = useCallback(async () => {
    if (directStreamUrl) {
      setStreamUrl(directStreamUrl);
      setStreamFailed(false);
      return;
    }

    if (!slug) {
      setStreamFailed(true);
      return;
    }

    setIsResolving(true);
    setStreamFailed(false);

    try {
      const res = await fetch(`/api/stream/${slug}${embedUrl ? `?url=${encodeURIComponent(embedUrl)}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.success && data?.streamUrl) {
          setStreamUrl(data.streamUrl);
          setStreamFailed(false);
          setIsResolving(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Could not resolve direct stream link:', err);
    } finally {
      setIsResolving(false);
    }

    // Set error state, but strictly KEEP activeServer at 1 (NO auto-switching)
    setStreamFailed(true);
  }, [slug, embedUrl, directStreamUrl]);

  // Attempt stream resolution when user activates Server 1
  useEffect(() => {
    if (activeServer === 1 && !streamUrl && !streamFailed && isPlaying) {
      resolveStream();
    }
  }, [activeServer, streamUrl, streamFailed, isPlaying, resolveStream]);

  // Fallback handler when stream playback errors out inside Artplayer
  const handleCinemaError = useCallback(() => {
    console.warn('Direct stream playback error in CinemaPlayer.');
    setStreamFailed(true);
  }, []);

  const handlePlayClick = () => {
    setIsPlaying(true);
    if (activeServer === 1 && !streamUrl && !streamFailed) {
      resolveStream();
    }
  };

  const handleServerChange = (serverNum) => {
    setActiveServer(serverNum);
    setIsPlaying(true);
    if (serverNum === 1 && (streamFailed || !streamUrl)) {
      resolveStream();
    }
  };

  const handleRetry = () => {
    setStreamUrl(null);
    setStreamFailed(false);
    resolveStream();
  };

  return (
    <div className={`${styles.playerWrapper} ${isTheater ? styles.playerWrapperTheater : ''}`}>
      {/* 16:9 Responsive Player Frame */}
      <div className={styles.playerContainer}>
        {!isPlaying ? (
          /* Pre-Playback Poster Overlay */
          <div className={styles.overlay} onClick={handlePlayClick}>
            {posterUrl && posterUrl !== '/placeholder.jpg' && (
              <Image 
                src={posterUrl} 
                alt={title || 'Movie Player Poster'} 
                fill
                priority
                className={styles.backdropImage} 
              />
            )}
            <div className={styles.backdropOverlay} />
            
            <div className={styles.playCenter}>
              <div className={styles.playPulseRing} />
              <div className={styles.playButton}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>

            <div className={styles.overlayInfo}>
              <span className={styles.streamBadge}>
                {activeServer === 1 ? 'مشغل EGYMAX السينمائي VIP' : 'FHD 1080p • سيرفر سريع'}
              </span>
              <p className={styles.playText}>انقر هنا لبدء المشاهدة السينمائية الفائقة</p>
            </div>
          </div>
        ) : activeServer === 1 ? (
          /* Server 1: VIP Direct Cinema Player or Inline Status/Retry Box */
          isResolving ? (
            <div className={styles.loaderBox}>
              <div className={styles.cinemaSpinner} />
              <h4>جارٍ الاتصال بسيرفر البث المباشر (VIP)...</h4>
              <p>يتم فحص سرعة واستقرار سيرفر العرض فائق الجودة.</p>
            </div>
          ) : streamUrl && !streamFailed ? (
            <CinemaPlayer
              url={streamUrl}
              poster={posterUrl}
              title={title}
              isTheater={isTheater}
              onTheaterToggle={() => setIsTheater((prev) => !prev)}
              onError={handleCinemaError}
            />
          ) : (
            <div className={styles.directStreamNoticeBox}>
              <span className={styles.noticeStatusIcon}>📡</span>
              <h3>سيرفر البث المباشر (VIP) قيد التجهيز</h3>
              <p>
                لم يتم ربط البث المباشر لهذا الفيلم بعد أو قد تكون الخدمة تحت الصيانة.
                يمكنك إعادة المحاولة أو التبديل فوراً إلى السيرفر البديل.
              </p>
              <div className={styles.noticeActionButtons}>
                <button type="button" onClick={handleRetry} className={styles.retryBtn}>
                  🔄 إعادة المحاولة
                </button>
                <button type="button" onClick={() => handleServerChange(2)} className={styles.switchMirrorBtn}>
                  ⚡ التبديل إلى سيرفر بديل 1 (DoodStream Mirror)
                </button>
              </div>
            </div>
          )
        ) : activeServer === 2 && doodMirrorUrl ? (
          /* Fallback Server 1: DoodStream Mirror */
          <div className={styles.iframeWrapper}>
            <iframe 
              src={doodMirrorUrl} 
              title={title || 'EGYMAX DoodStream Mirror'}
              width="100%" 
              height="100%" 
              frameBorder="0" 
              allowFullScreen 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              scrolling="no"
            />
          </div>
        ) : activeServer === 3 && cdnMirrorUrl ? (
          /* Fallback Server 2: CDN Embed */
          <div className={styles.iframeWrapper}>
            <iframe 
              src={cdnMirrorUrl} 
              title={title || 'EGYMAX CDN Mirror'}
              width="100%" 
              height="100%" 
              frameBorder="0" 
              allowFullScreen 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              scrolling="no"
            />
          </div>
        ) : embedHtml ? (
          <div 
            className={styles.iframeWrapper}
            dangerouslySetInnerHTML={{ __html: embedHtml }} 
          />
        ) : (
          <div className={styles.demoWrapper}>
            <div className={styles.demoNotice}>
              <span className={styles.demoIcon}>⏳</span>
              <h3>سيرفر المشاهدة قيد التجهيز</h3>
              <p>يتم إعداد ومعالجة البث عالي الدقة تلقائياً عبر سحابة EGYMAX.</p>
            </div>
          </div>
        )}
      </div>

      {/* Multi-Server Selection Tabs Directly Below Player */}
      <div className={styles.serverSection}>
        <div className={styles.serverHeader}>
          <div className={styles.serverTitleGroup}>
            <span className={styles.serverTitle}>اختر سيرفر المشاهدة:</span>
            {activeServer === 1 && streamUrl && !streamFailed && (
              <span className={styles.vipTag}>VIP Ultra HD</span>
            )}
          </div>
          <span className={styles.serverHint}>يمكنك التبديل بين السيرفرات بحرية في أي وقت</span>
        </div>

        <div className={styles.serverTabs}>
          {/* Server 1: VIP Direct Cinema Player */}
          <button 
            type="button"
            onClick={() => handleServerChange(1)} 
            className={`${styles.serverTab} ${activeServer === 1 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>🔴</span>
            <span>سيرفر EGYMAX السينمائي (VIP Direct)</span>
            {isResolving && <span className={styles.tabLoading}>⏳</span>}
          </button>
          
          {/* Server 2: DoodStream Mirror */}
          <button 
            type="button"
            onClick={() => handleServerChange(2)} 
            className={`${styles.serverTab} ${activeServer === 2 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>⚡</span>
            <span>سيرفر بديل 1 (DoodStream Mirror)</span>
          </button>
          
          {/* Server 3: CDN Embed */}
          <button 
            type="button"
            onClick={() => handleServerChange(3)} 
            className={`${styles.serverTab} ${activeServer === 3 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>💾</span>
            <span>سيرفر بديل 2 (CDN Embed)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
