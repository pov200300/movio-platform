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
    <div className={styles.playerSection}>
      {/* Interactive Multi-Server Selection Tabs */}
      <div className={styles.serverTabs}>
        <button 
          onClick={() => setActiveServer(1)} 
          className={`${styles.serverTab} ${activeServer === 1 ? styles.activeTab : ''}`}
        >
          🔴 سيرفر 1 (Doodstream Fast)
        </button>
        <button 
          onClick={() => setActiveServer(2)} 
          className={`${styles.serverTab} ${activeServer === 2 ? styles.activeTab : ''}`}
        >
          ⚡ سيرفر 2 (CDN Mirror)
        </button>
        <button 
          onClick={() => setActiveServer(3)} 
          className={`${styles.serverTab} ${activeServer === 3 ? styles.activeTab : ''}`}
        >
          💾 سيرفر 3 (Direct Player)
        </button>
      </div>

      <div className={styles.playerContainer}>
        {!isPlaying ? (
          <div className={styles.overlay} onClick={handlePlayClick}>
            {posterUrl && posterUrl !== '/placeholder.jpg' && (
              <Image 
                src={posterUrl} 
                alt={title || 'Video Backdrop'} 
                fill
                className={styles.backdropImage} 
              />
            )}
            <div className={styles.backdropOverlay} />
            
            <div className={styles.playPulse}>
              <div className={styles.playButton}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
            <p className={styles.playText}>انقر لبدء المشاهدة (FHD)</p>
            <span className={styles.streamBadge}>DoodStream Server {activeServer}</span>
          </div>
        ) : currentEmbedUrl ? (
          <div className={styles.iframeWrapper}>
            <iframe 
              src={currentEmbedUrl} 
              width="100%" 
              height="100%" 
              frameBorder="0" 
              allowFullScreen 
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
              <h3>سيرفر التشغيل قيد التجهيز</h3>
              <p>سيتم تفعيل البث تلقائياً عبر DoodStream بمجرد اكتمال المعالجة.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

