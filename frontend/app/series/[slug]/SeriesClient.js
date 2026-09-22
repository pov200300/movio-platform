'use client';
import { useState } from 'react';
import VideoPlayer from '../../../components/VideoPlayer';
import styles from './seriesDetail.module.css';

export default function SeriesClient({ series }) {
  const seasons = series?.seasons || [];
  const [activeSeasonNum, setActiveSeasonNum] = useState(
    seasons.length > 0 ? seasons[0].seasonNumber : 1
  );

  const currentSeason = seasons.find((s) => s.seasonNumber === activeSeasonNum) || seasons[0];
  const episodes = currentSeason?.episodes || [];

  const [activeEpisodeNum, setActiveEpisodeNum] = useState(
    episodes.length > 0 ? episodes[0].episodeNumber : 1
  );

  const currentEpisode = episodes.find((e) => e.episodeNumber === activeEpisodeNum) || episodes[0];

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
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

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
          embedUrl={currentEpisode?.embedUrl || currentEpisode?.doodEmbed}
          doodEmbed={currentEpisode?.doodEmbed}
          streamtapeEmbed={currentEpisode?.streamtapeEmbed}
          posterUrl={series.backdropUrl || series.posterUrl}
          title={`${series.title} S${activeSeasonNum}E${activeEpisodeNum}`}
        />
      </section>

      {/* Season & Episode Browser Section */}
      <section className={styles.browserSection}>
        <div className={styles.browserHeader}>
          <h3 className={styles.browserTitle}>فهرس الحلقات والمواسم</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {episodes.length} حلقة متوفرة في هذا الموسم
          </span>
        </div>

        {/* Season Selector Tabs */}
        {seasons.length > 1 && (
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
                {s.title || `الموسم ${s.seasonNumber}`}
              </button>
            ))}
          </div>
        )}

        {/* Episodes Grid */}
        <div className={styles.episodesGrid}>
          {episodes.map((ep) => {
            const isSelected = activeEpisodeNum === ep.episodeNumber;
            return (
              <button
                key={ep.episodeNumber}
                type="button"
                onClick={() => handleEpisodeChange(ep.episodeNumber)}
                className={`${styles.episodeCard} ${isSelected ? styles.activeEpisodeCard : ''}`}
              >
                <div className={styles.episodeTop}>
                  <span className={styles.episodeNumber}>الحلقة {ep.episodeNumber}</span>
                  {ep.duration && <span className={styles.episodeDuration}>{ep.duration}</span>}
                </div>
                <p className={styles.episodeName}>{ep.title || `الحلقة ${ep.episodeNumber}`}</p>
                {isSelected && <span className={styles.playIconMini}>▶ قيد التشغيل الآن</span>}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
