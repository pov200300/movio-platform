'use client';
import { useState } from 'react';
import Image from 'next/image';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({ embedHtml, posterUrl, title }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayClick = () => {
    setIsPlaying(true);
  };

  return (
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
          <p className={styles.playText}>Click to Watch Stream</p>
          <span className={styles.streamBadge}>Doodstream Player</span>
        </div>
      ) : embedHtml ? (
        <div 
          className={styles.iframeWrapper}
          dangerouslySetInnerHTML={{ __html: embedHtml }} 
        />
      ) : (
        <div className={styles.demoWrapper}>
          <div className={styles.demoNotice}>
            <h3>Stream Demo Player</h3>
            <p>Doodstream embed link will automatically activate once the worker processes this video.</p>
          </div>
        </div>
      )}
    </div>
  );
}
