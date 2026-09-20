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

  // Attempt resolving direct stream when VIP server is active
  useEffect(() => {
    let isCancelled = false;

    async function resolveStream() {
      if (directStreamUrl) {
        setStreamUrl(directStreamUrl);
        return;
      }

      if (!slug) return;

      setIsResolving(true);
      try {
        const res = await fetch(`/api/stream/${slug}${embedUrl ? `?url=${encodeURIComponent(embedUrl)}` : ''}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.streamUrl && !isCancelled) {
            setStreamUrl(data.streamUrl);
            setStreamFailed(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Could not resolve direct stream link:', err);
      } finally {
        if (!isCancelled) setIsResolving(false);
      }

      // If direct stream resolution failed, fallback to DoodStream mirror
      if (!isCancelled) {
        setStreamFailed(true);
        setActiveServer(2); // Auto-switch to DoodStream mirror
      }
    }

    if (activeServer === 1 && !streamUrl) {
      resolveStream();
    }

    return () => {
      isCancelled = true;
    };
  }, [slug, embedUrl, directStreamUrl, activeServer, streamUrl]);

  // Fallback handler when stream errors out during playback
  const handleCinemaError = useCallback(() => {
    console.warn('Direct stream error encountered, switching to fallback embed.');
    setStreamFailed(true);
    setActiveServer(2); // Switch to DoodStream Mirror
  }, []);

  const handlePlayClick = () => {
    setIsPlaying(true);
  };

  const handleServerChange = (serverNum) => {
    setActiveServer(serverNum);
    setIsPlaying(true);
    if (serverNum === 1 && streamFailed && !streamUrl) {
      setStreamFailed(false);
    }
  };

  return (
    <div className={`${styles.playerWrapper} ${isTheater ? styles.playerWrapperTheater : ''}`}>
      {/* 16:9 Responsive Theater Frame */}
      <div className={styles.playerContainer}>
        {!isPlaying ? (
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
        ) : activeServer === 1 && streamUrl && !streamFailed ? (
          /* Custom EGYMAX Cinema Player */
          <CinemaPlayer
            url={streamUrl}
            poster={posterUrl}
            title={title}
            isTheater={isTheater}
            onTheaterToggle={() => setIsTheater((prev) => !prev)}
            onError={handleCinemaError}
          />
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
          <span className={styles.serverHint}>إذا توقف سيرفر، قم بالتبديل إلى سيرفر آخر فوراً</span>
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
