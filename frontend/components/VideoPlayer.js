'use client';
import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import CinemaPlayer from './CinemaPlayer';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({
  slug,
  embedUrl,
  doodEmbed,
  streamtapeEmbed,
  directStreamUrl,
  embedHtml,
  posterUrl,
  title,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  // Default on load: Server 1 (Doodstream 1080p FHD) for immediate high quality loading
  const [activeServer, setActiveServer] = useState(1); // 1 = Doodstream (1080p), 2 = Streamtape (720p), 3 = EGYMAX VIP
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

  // Generate verified server URLs
  // Server 1: 1080p FHD via Doodstream
  let server1Url = doodEmbed || rawUrl;
  if (server1Url) {
    server1Url = server1Url.replace('dood.to', 'doodstream.com').replace('dood.so', 'doodstream.com');
  }

  // Server 2: 720p HD via Streamtape (or mirror)
  let server2Url = streamtapeEmbed;
  if (!server2Url && rawUrl) {
    if (rawUrl.includes('streamtape') || rawUrl.includes('tapecontent')) {
      server2Url = rawUrl;
    } else if (rawUrl.includes('dood')) {
      // Fallback mirror if streamtape embed is not yet populated
      server2Url = rawUrl.replace('doodstream.com', 'dood.so').replace('dood.to', 'dood.so');
    }
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

    setStreamFailed(true);
  }, [slug, embedUrl, directStreamUrl]);

  // Attempt stream resolution when user activates EGYMAX VIP server (Server 3)
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
                {activeServer === 1 ? 'سيرفر 1 • FHD 1080p' : activeServer === 2 ? 'سيرفر 2 • HD 720p' : 'EGYMAX VIP Cinema Player'}
              </span>
              <p className={styles.playText}>انقر هنا لبدء المشاهدة</p>
            </div>
          </div>
        ) : activeServer === 1 && server1Url ? (
          /* Server 1 (Default): DoodStream 1080p FHD */
          <div className={styles.iframeWrapper}>
            <iframe 
              src={server1Url} 
              title={title ? `${title} - سيرفر 1 (1080p FHD)` : 'سيرفر 1 - 1080p FHD'}
              width="100%" 
              height="100%" 
              frameBorder="0" 
              allowFullScreen 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              scrolling="no"
            />
          </div>
        ) : activeServer === 2 && (server2Url || server1Url) ? (
          /* Server 2: Streamtape 720p HD */
          <div className={styles.iframeWrapper}>
            <iframe 
              src={server2Url || server1Url} 
              title={title ? `${title} - سيرفر 2 (720p HD)` : 'سيرفر 2 - 720p HD'}
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
              <h3>سيرفر EGYMAX VIP قيد التجهيز</h3>
              <p>
                لم يتم ربط البث المباشر لهذا المحتوى بعد على مشغل EGYMAX VIP.
                يمكنك التبديل فوراً إلى سيرفر 1 (1080p) أو سيرفر 2 (720p) للمشاهدة دون انقطاع.
              </p>
              <div className={styles.noticeActionButtons}>
                <button type="button" onClick={handleRetry} className={styles.retryBtn}>
                  🔄 إعادة محاولة VIP
                </button>
                <button type="button" onClick={() => handleServerChange(1)} className={styles.switchMirrorBtn}>
                  ⚡ الانتقال لسيرفر 1 (1080p)
                </button>
                <button type="button" onClick={() => handleServerChange(2)} className={styles.switchMirrorBtn}>
                  🎬 الانتقال لسيرفر 2 (720p)
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
            {activeServer === 1 && <span className={styles.serverQualityTag}>1080p FHD</span>}
            {activeServer === 2 && <span className={styles.serverQualityTag}>720p HD</span>}
            {activeServer === 3 && streamUrl && !streamFailed && (
              <span className={styles.vipTag}>VIP Ultra HD</span>
            )}
          </div>
          <span className={styles.serverHint}>يمكنك التبديل بين السيرفرات بحرية وبدون إعادة تحميل الصفحة</span>
        </div>

        {/* Multi-Server Buttons with Quality Badges */}
        <div className={styles.serverTabs}>
          {/* Server 1 Tab: Doodstream 1080p */}
          <button 
            type="button"
            onClick={() => handleServerChange(1)} 
            className={`${styles.serverTab} ${activeServer === 1 ? styles.activeTab : ''}`}
            title="سيرفر 1: جودة فائقة 1080p Full HD عبر Doodstream"
          >
            <span className={styles.tabIcon}>⚡</span>
            <span>سيرفر 1 (Doodstream)</span>
            <span className={`${styles.tabBadge} ${styles.tabBadgeFhd}`}>1080p FHD</span>
          </button>
          
          {/* Server 2 Tab: Streamtape 720p */}
          <button 
            type="button"
            onClick={() => handleServerChange(2)} 
            className={`${styles.serverTab} ${activeServer === 2 ? styles.activeTab : ''}`}
            title="سيرفر 2: جودة عالية 720p HD عبر Streamtape"
          >
            <span className={styles.tabIcon}>🎬</span>
            <span>سيرفر 2 (Streamtape)</span>
            <span className={`${styles.tabBadge} ${styles.tabBadgeHd}`}>720p HD</span>
          </button>
          
          {/* Server 3 Tab: EGYMAX VIP */}
          <button 
            type="button"
            onClick={() => handleServerChange(3)} 
            className={`${styles.serverTab} ${activeServer === 3 ? styles.activeTab : ''}`}
            title="سيرفر VIP: مشغل سينمائي مباشر بدون إعلانات مزعجة"
          >
            <span className={styles.tabIcon}>🔴</span>
            <span>EGYMAX VIP</span>
            <span className={`${styles.tabBadge} ${styles.tabBadgeVip}`}>VIP Direct</span>
            {isResolving && <span className={styles.tabLoading}>⏳</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
