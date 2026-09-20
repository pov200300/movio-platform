'use client';
import { useState } from 'react';
import Image from 'next/image';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({ embedUrl, embedHtml, posterUrl, title }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeServer, setActiveServer] = useState(1);

  // Extract clean embed URL if embedHtml was passed instead
  let rawUrl = embedUrl;
  if (!rawUrl && embedHtml) {
    const match = embedHtml.match(/src=["']([^"']+)["']/i);
    if (match) rawUrl = match[1];
  }

  // Generate live mirror servers from primary DoodStream embed
  let server1Url = rawUrl;
  let server2Url = null;
  let server3Url = null;

  if (rawUrl) {
    server1Url = rawUrl.replace('dood.to', 'doodstream.com').replace('dood.so', 'doodstream.com');
    server2Url = rawUrl.replace('doodstream.com', 'dood.to');
    server3Url = rawUrl.replace('doodstream.com', 'dood.so').replace('dood.to', 'dood.so');
  }

  const currentEmbedUrl = activeServer === 1 ? server1Url : activeServer === 2 ? server2Url : server3Url;

  const handlePlayClick = () => {
    setIsPlaying(true);
  };

  return (
    <div className={styles.playerWrapper}>
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
              <span className={styles.streamBadge}>FHD 1080p • سيرفر صاروخي</span>
              <p className={styles.playText}>انقر هنا لبدء المشاهدة المباشرة</p>
            </div>
          </div>
        ) : currentEmbedUrl ? (
          <div className={styles.iframeWrapper}>
            <iframe 
              src={currentEmbedUrl} 
              title={title || 'EGYMAX Player'}
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
              <h3>سيرفر المشاهدة قيد المعالجة</h3>
              <p>يتم تجهيز النسخة فائقة الجودة وترجمة الفيلم تلقائياً عبر سحابة EGYMAX.</p>
            </div>
          </div>
        )}
      </div>

      {/* Multi-Server Selection Tabs Directly Below Player */}
      <div className={styles.serverSection}>
        <div className={styles.serverHeader}>
          <span className={styles.serverTitle}>اختر سيرفر المشاهدة:</span>
          <span className={styles.serverHint}>إذا توقف سيرفر، قم بالتبديل إلى سيرفر آخر فوراً</span>
        </div>

        <div className={styles.serverTabs}>
          <button 
            type="button"
            onClick={() => { setActiveServer(1); setIsPlaying(true); }} 
            className={`${styles.serverTab} ${activeServer === 1 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>🔴</span>
            <span>سيرفر المشاهدة 1 (DoodStream)</span>
          </button>
          
          <button 
            type="button"
            onClick={() => { setActiveServer(2); setIsPlaying(true); }} 
            className={`${styles.serverTab} ${activeServer === 2 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>⚡</span>
            <span>سيرفر بديل 2 (CDN Mirror)</span>
          </button>
          
          <button 
            type="button"
            onClick={() => { setActiveServer(3); setIsPlaying(true); }} 
            className={`${styles.serverTab} ${activeServer === 3 ? styles.activeTab : ''}`}
          >
            <span className={styles.tabIcon}>💾</span>
            <span>سيرفر 3 (Fast Stream)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
