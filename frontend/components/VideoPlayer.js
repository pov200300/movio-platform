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
  // Default on load: Server 1 (Embed / Fast Mirror) for immediate video loading
  const [activeServer, setActiveServer] = useState(1); // 1 = Server 1, 2 = Server 2, 3 = EGYMAX VIP
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
  let server1Url = rawUrl;
  let server2Url = null;

  if (rawUrl) {
    server1Url = rawUrl.replace('dood.to', 'doodstream.com').replace('dood.so', 'doodstream.com');
    server2Url = rawUrl.replace('doodstream.com', 'dood.so').replace('dood.to', 'dood.so');
  }

  // Function to resolve direct stream link for EGYMAX VIP player
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

    // Mark as failed if unresolvable, but keep user on EGYMAX tab without bouncing
    setStreamFailed(true);
  }, [slug, embedUrl, directStreamUrl]);

  // Attempt stream resolution when user activates EGYMAX server (Server 3)
  useEffect(() => {
    if (activeServer === 3 && !streamUrl && !streamFailed && isPlaying) {
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
    if (activeServer === 3 && !streamUrl && !streamFailed) {
      resolveStream();
    }
  };

  const handleServerChange = (serverNum) => {
    setActiveServer(serverNum);
    setIsPlaying(true);
    if (serverNum === 3 && (streamFailed || !streamUrl)) {
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
                {activeServer === 3 ? 'EGYMAX VIP Cinema Player' : `Server ${activeServer} • FHD 1080p`}
              </span>
              <p className={styles.playText}>انقر هنا لبدء المشاهدة</p>
            </div>
          </div>
        ) : activeServer === 1 && server1Url ? (
          /* Server 1 (Default): Fast DoodStream Embed */
          <div className={styles.iframeWrapper}>
            <iframe 
              src={server1Url} 
              title={title || 'EGYMAX Server 1'}
              width="100%" 
              height="100%" 
              frameBorder="0" 
              allowFullScreen 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              scrolling="no"
            />
          </div>
        ) : activeServer === 2 && (server2Url || server1Url) ? (
          /* Server 2: CDN / Backup Embed */
          <div className={styles.iframeWrapper}>
            <iframe 
              src={server2Url || server1Url} 
              title={title || 'EGYMAX Server 2'}
              width="100%" 
              height="100%" 
              frameBorder="0" 
              allowFullScreen 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              scrolling="no"
            />
          </div>
        ) : activeServer === 3 ? (
          /* Server 3: Custom EGYMAX VIP CinemaPlayer */
          isResolving ? (
            <div className={styles.loaderBox}>
              <div className={styles.cinemaSpinner} />
              <h4>Connecting to EGYMAX VIP Stream...</h4>
              <p>جارٍ فحص واستقرار سيرفر العرض المباشر فائق الجودة.</p>
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
              <h3>سيرفر EGYMAX قيد التجهيز</h3>
              <p>
                لم يتم ربط البث المباشر لهذا الفيلم بعد على مشغل EGYMAX.
                يمكنك إعادة المحاولة أو الانتقال فوراً إلى Server 1 للمشاهدة.
              </p>
              <div className={styles.noticeActionButtons}>
                <button type="button" onClick={handleRetry} className={styles.retryBtn}>
                  🔄 Retry EGYMAX
                </button>
                <button type="button" onClick={() => handleServerChange(1)} className={styles.switchMirrorBtn}>
                  ⚡ Switch to Server 1
                </button>
              </div>
            </div>
          )
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
            {activeServer === 3 && streamUrl && !streamFailed && (
              <span className={styles.vipTag}>VIP Ultra HD</span>
            )}
          </div>
          <span className={styles.serverHint}>يمكنك التبديل بين السيرفرات بحرية في أي وقت</span>
        </div>

        {/* English-Only Button Labels */}
        <div className={styles.serverTabs}>
          {/* First Tab (Default Active): Server 1 */}
          <button 
            type="button"
            onClick={() => handleServerChange(1)} 
            className={`${styles.serverTab} ${activeServer === 1 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>⚡</span>
            <span>Server 1</span>
          </button>
          
          {/* Second Tab: Server 2 */}
          <button 
            type="button"
            onClick={() => handleServerChange(2)} 
            className={`${styles.serverTab} ${activeServer === 2 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>💾</span>
            <span>Server 2</span>
          </button>
          
          {/* Third Tab (Last in list): EGYMAX VIP */}
          <button 
            type="button"
            onClick={() => handleServerChange(3)} 
            className={`${styles.serverTab} ${activeServer === 3 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>🔴</span>
            <span>EGYMAX</span>
            {isResolving && <span className={styles.tabLoading}>⏳</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
