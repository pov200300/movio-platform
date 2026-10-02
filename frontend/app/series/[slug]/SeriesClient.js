'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import VideoPlayer from '../../../components/VideoPlayer';
import {
  getDoodstreamDownloadUrl,
  getStreamtapeDownloadUrl,
  getVidmolyDownloadUrl,
} from '../../../lib/api';
import styles from './seriesDetail.module.css';

export default function SeriesClient({ series, initialSeason = null, initialEpisode = null }) {
  const seasons = series?.seasons || [];
  const defaultSeason = initialSeason && seasons.some(s => s.seasonNumber === initialSeason)
    ? initialSeason
    : (seasons.length > 0 ? seasons[0].seasonNumber : 1);

  const [activeSeasonNum, setActiveSeasonNum] = useState(defaultSeason);

  const currentSeason = seasons.find((s) => s.seasonNumber === activeSeasonNum) || seasons[0];
  const episodes = currentSeason?.episodes || [];

  const defaultEpisode = initialEpisode && episodes.some(e => e.episodeNumber === initialEpisode)
    ? initialEpisode
    : (episodes.length > 0 ? episodes[0].episodeNumber : 1);

  const [activeEpisodeNum, setActiveEpisodeNum] = useState(defaultEpisode);

  const currentEpisode = episodes.find((e) => e.episodeNumber === activeEpisodeNum) || episodes[0];

  const currentEpIndex = episodes.findIndex((e) => e.episodeNumber === activeEpisodeNum);
  const prevEpisode = currentEpIndex > 0 ? episodes[currentEpIndex - 1] : null;
  const nextEpisode = currentEpIndex >= 0 && currentEpIndex < episodes.length - 1 ? episodes[currentEpIndex + 1] : null;

  const handleSeasonChange = (num) => {
    setActiveSeasonNum(num);
    const newSeason = seasons.find((s) => s.seasonNumber === num);
    if (newSeason && newSeason.episodes.length > 0) {
      setActiveEpisodeNum(newSeason.episodes[0].episodeNumber);
    }
  };

  const handleEpisodeChange = (num) => {
    setActiveEpisodeNum(num);
    const el = document.getElementById('player-anchor');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Derive dual-quality download links for currently active episode
  const download1080_dood = useMemo(() => {
    if (currentEpisode?.download1080_dood) return currentEpisode.download1080_dood;
    if (currentEpisode?.doodEmbed) return getDoodstreamDownloadUrl(currentEpisode.doodEmbed);
    return null;
  }, [currentEpisode]);

  const download720 = useMemo(() => {
    if (currentEpisode?.download720) return currentEpisode.download720;
    if (currentEpisode?.streamtapeEmbed) return getStreamtapeDownloadUrl(currentEpisode.streamtapeEmbed);
    return null;
  }, [currentEpisode]);

  const download1080_vidmoly = useMemo(() => {
    if (currentEpisode?.vidmolyEmbed) return getVidmolyDownloadUrl(currentEpisode.vidmolyEmbed);
    return null;
  }, [currentEpisode]);

  return (
    <div>
      {/* Interactive Video Player Section */}
      <section id="player-anchor" className={styles.playerSection}>
        <div className={styles.playerSectionHeader}>
          <h2 className={styles.playerHeading}>
            مشاهدة {series.title} — الموسم {activeSeasonNum} ({currentEpisode?.title || `الحلقة ${activeEpisodeNum}`})
          </h2>
          <span className={styles.activeEpisodeBadge}>
            الموسم {activeSeasonNum} • الحلقة {activeEpisodeNum}
          </span>
        </div>

        <VideoPlayer
          key={`${series.slug}-s${activeSeasonNum}e${activeEpisodeNum}`}
          slug={series.slug}
          servers={currentEpisode?.servers}
          primaryEmbed={currentEpisode?.primaryEmbed}
          vidmolyEmbed={currentEpisode?.vidmolyEmbed}
          streamhgEmbed={currentEpisode?.streamhgEmbed}
          doodEmbed={currentEpisode?.doodEmbed}
          streamtapeEmbed={currentEpisode?.streamtapeEmbed}
          embedUrl={currentEpisode?.embedUrl || currentEpisode?.primaryEmbed || currentEpisode?.vidmolyEmbed || currentEpisode?.doodEmbed}
          download1080_dood={download1080_dood}
          download720={download720}
          download1080_vidmoly={download1080_vidmoly}
          posterUrl={series.backdropUrl || series.posterUrl}
          title={`${series.title} — الموسم ${activeSeasonNum} (الحلقة ${activeEpisodeNum})`}
        />

        {/* Next / Previous Episode Navigation Bar */}
        <div className={styles.episodeNavRow}>
          {prevEpisode ? (
            <Link
              href={prevEpisode.watch_url || `/series/${series.slug}/s${activeSeasonNum}e${prevEpisode.episodeNumber}`}
              onClick={() => handleEpisodeChange(prevEpisode.episodeNumber)}
              className={styles.episodeNavBtn}
              title={`الانتقال إلى الحلقة السابقة (${prevEpisode.title || `الحلقة ${prevEpisode.episodeNumber}`})`}
            >
              <span>‹</span>
              <span>الحلقة السابقة ({prevEpisode.episodeNumber})</span>
            </Link>
          ) : (
            <span className={`${styles.episodeNavBtn} ${styles.episodeNavBtnDisabled}`}>
              <span>‹</span>
              <span>الحلقة السابقة</span>
            </span>
          )}

          <div className={styles.episodeNavCenter}>
            <span className={styles.episodeNavBadge}>
              الموسم {activeSeasonNum} • الحلقة {activeEpisodeNum} {episodes.length > 1 ? `من ${episodes.length}` : ''}
            </span>
          </div>

          {nextEpisode ? (
            <Link
              href={nextEpisode.watch_url || `/series/${series.slug}/s${activeSeasonNum}e${nextEpisode.episodeNumber}`}
              onClick={() => handleEpisodeChange(nextEpisode.episodeNumber)}
              className={styles.episodeNavBtn}
              title={`الانتقال إلى الحلقة التالية (${nextEpisode.title || `الحلقة ${nextEpisode.episodeNumber}`})`}
            >
              <span>الحلقة التالية ({nextEpisode.episodeNumber})</span>
              <span>›</span>
            </Link>
          ) : (
            <span className={`${styles.episodeNavBtn} ${styles.episodeNavBtnDisabled}`}>
              <span>الحلقة التالية</span>
              <span>›</span>
            </span>
          )}
        </div>

        {/* Dual-Quality Download Bar for Active Episode */}
        {(download1080_dood || download720 || download1080_vidmoly) && (
          <div className={styles.episodeDownloadCard}>
            <div className={styles.downloadCardHeader}>
              <div className={styles.downloadCardTitle}>
                <span>📥</span>
                <span>تحميل {currentEpisode?.title || `الحلقة ${activeEpisodeNum}`} بجودة عالية</span>
              </div>
              <span className={styles.downloadMetaBadge}>
                الموسم {activeSeasonNum} • الحلقة {activeEpisodeNum}
              </span>
            </div>

            <div className={styles.downloadButtonsGrid}>
              {/* Button 1: 1080p FHD (DoodStream) */}
              {download1080_dood && (
                <a
                  href={download1080_dood}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.downloadBtn} ${styles.downloadBtn1080}`}
                  title="تحميل الحلقة بجودة 1080p FHD عبر DoodStream (سريع ومباشر)"
                >
                  <div className={styles.downloadBtnIcon}>⚡</div>
                  <div className={styles.downloadBtnContent}>
                    <span className={styles.downloadBtnLabel}>تحميل 1080p FHD</span>
                    <span className={styles.downloadBtnServer}>سيرفر DoodStream الصاروخي</span>
                  </div>
                </a>
              )}

              {/* Button 2: 720p HD (Streamtape) */}
              {download720 && (
                <a
                  href={download720}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.downloadBtn} ${styles.downloadBtn720}`}
                  title="تحميل الحلقة بجودة 720p HD عبر Streamtape (سريع وخفيف)"
                >
                  <div className={styles.downloadBtnIcon}>🚀</div>
                  <div className={styles.downloadBtnContent}>
                    <span className={styles.downloadBtnLabel}>تحميل 720p HD</span>
                    <span className={styles.downloadBtnServer}>سيرفر Streamtape المباشر</span>
                  </div>
                </a>
              )}

              {/* Button 3: Optional 1080p Mirror (Vidmoly) */}
              {download1080_vidmoly && (
                <a
                  href={download1080_vidmoly}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.downloadBtn} ${styles.downloadBtnMirror}`}
                  title="مرآة بديلة لمشاهدة وتحميل الحلقة بجودة 1080p عبر Vidmoly"
                >
                  <div className={styles.downloadBtnIcon}>🔄</div>
                  <div className={styles.downloadBtnContent}>
                    <span className={styles.downloadBtnLabel}>مرآة بديلة 1080p</span>
                    <span className={styles.downloadBtnServer}>سيرفر Vidmoly الاحتياطي</span>
                  </div>
                </a>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Season & Episode Browser Section */}
      <section className={styles.browserSection}>
        <div className={styles.browserHeader}>
          <h3 className={styles.browserTitle}>فهرس الحلقات والمواسم</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {episodes.length} حلقة متوفرة في هذا الموسم
          </span>
        </div>

        {/* Season Selector Tabs (Horizontal pill buttons) */}
        {seasons.length > 0 && (
          <div className={styles.seasonTabs}>
            {seasons.map((s) => (
              <button
                key={s.seasonNumber}
                type="button"
                onClick={() => handleSeasonChange(s.seasonNumber)}
                className={`${styles.seasonBtn} ${
                  activeSeasonNum === s.seasonNumber ? styles.activeSeasonBtn : ''
                }`}
              >
                <span>📺</span> {s.title || `الموسم ${s.seasonNumber}`}
                <span className={styles.seasonCountBadge}>
                  {s.episodes?.length || 0} حلقات
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Episodes Grid with release tags and play status */}
        <div className={styles.episodesGrid}>
          {episodes.map((ep) => {
            const isSelected = activeEpisodeNum === ep.episodeNumber;
            const episodeWatchUrl = ep.watch_url || `/series/${series.slug}/s${activeSeasonNum}e${ep.episodeNumber}`;
            return (
              <Link
                key={ep.episodeNumber}
                href={episodeWatchUrl}
                onClick={() => handleEpisodeChange(ep.episodeNumber)}
                className={`${styles.episodeCard} ${isSelected ? styles.activeEpisodeCard : ''}`}
                title={`تشغيل ${ep.title || `الحلقة ${ep.episodeNumber}`}`}
              >
                <div className={styles.episodeTop}>
                  <span className={styles.episodeNumber}>الحلقة {ep.episodeNumber}</span>
                  <span className={styles.episodeReleaseTag}>{ep.quality || '1080p FHD'}</span>
                </div>
                <p className={styles.episodeName}>{ep.title || `الحلقة ${ep.episodeNumber}`}</p>
                <div className={styles.episodeFooter}>
                  <span className={styles.episodeDuration}>{ep.duration || '45 دقيقة'}</span>
                  {isSelected ? (
                    <span className={styles.playIconActive}>▶ قيد التشغيل</span>
                  ) : (
                    <span className={styles.playIconIdle}>▶ تشغيل</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
