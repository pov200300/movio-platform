'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import CinemaPlayer from './CinemaPlayer';
import { normalizeStreamHgUrl, normalizeVidmolyUrl, getVidmolyMirrorUrl, formatVidmolyEmbed, getDualQualityDownloadLinks } from '../lib/api';
import styles from './VideoPlayer.module.css';

// Provider label mapping for clean Arabic display
const PROVIDER_LABELS = {
  vidmoly: '🚀 سيرفر 1 (Vidmoly 1080p)',
  streamhg: '⚡ سيرفر 2 (StreamHG 720p)',
  streamtape: '🌐 سيرفر 3 (Streamtape)',
  doodstream: '🎬 سيرفر 4 (Doodstream)',
  dood: '🎬 سيرفر 4 (Doodstream)',
};

function formatServerLabel(server, index) {
  if (server.label) return server.label;
  const id = (server.id || '').toLowerCase();
  const name = (server.name || '').toLowerCase();
  const url = (server.url || '').toLowerCase();

  if (id === 'vidmoly' || name.includes('vidmoly')) {
    return PROVIDER_LABELS.vidmoly;
  }
  if (id === 'streamhg' || id === 'hgcloud' || name.includes('streamhg') || name.includes('hgcloud') || url.includes('hgcloud.to') || url.includes('streamhg')) {
    return PROVIDER_LABELS.streamhg;
  }
  if (id === 'streamtape' || name.includes('streamtape')) {
    return PROVIDER_LABELS.streamtape;
  }
  if (id === 'doodstream' || id === 'dood' || name.includes('dood')) {
    return PROVIDER_LABELS.doodstream;
  }
  return server.name || `سيرفر ${index + 1}`;
}

export default function VideoPlayer({
  slug,
  servers = [],
  embedUrl,
  primaryEmbed,
  vidmolyEmbed,
  streamhgEmbed,
  hgcloudEmbed,
  streamtapeEmbed,
  doodEmbed,
  directStreamUrl,
  embedHtml,
  posterUrl,
  title,
  download1080,
  download720,
  provider720,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState(directStreamUrl || null);
  const [isResolving, setIsResolving] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const [isTheater, setIsTheater] = useState(false);

  // Normalize server list from props
  const resolvedServers = useMemo(() => {
    let list = [];

    if (Array.isArray(servers) && servers.length > 0) {
      list = servers
        .filter((s) => s && s.url && typeof s.url === 'string')
        .map((s, idx) => {
          let normUrl = normalizeStreamHgUrl(s.url);
          if (s.id === 'vidmoly' || (s.name && s.name.toLowerCase().includes('vidmoly')) || normUrl.includes('vidmoly')) {
            normUrl = formatVidmolyEmbed(normUrl, 'vidmoly.to');
          }
          return {
            id: s.id || `server-${idx + 1}`,
            name: s.name || `Server ${idx + 1}`,
            label: formatServerLabel({ ...s, url: normUrl }, idx),
            url: normUrl,
            fast: s.fast !== undefined ? s.fast : (s.id === 'vidmoly' || s.id === 'streamhg' || s.id === 'hgcloud' || normUrl.includes('hgcloud.to')),
          };
        });
    }

    // Fallback: construct from individual embed props (for backwards compatibility)
    if (list.length === 0) {
      let rawUrl = primaryEmbed || embedUrl;
      if (!rawUrl && embedHtml) {
        const match = embedHtml.match(/src=["']([^"']+)["']/i);
        if (match) rawUrl = match[1];
      }

      // Vidmoly
      let vUrl = vidmolyEmbed;
      if (!vUrl && rawUrl && rawUrl.toLowerCase().includes('vidmoly')) vUrl = rawUrl;
      if (vUrl) {
        list.push({
          id: 'vidmoly',
          name: 'Vidmoly (1080p)',
          label: PROVIDER_LABELS.vidmoly,
          url: formatVidmolyEmbed(vUrl, 'vidmoly.to'),
          fast: true,
        });
      }

      // StreamHG / HgCloud
      let hUrl = streamhgEmbed || hgcloudEmbed;
      if (!hUrl && rawUrl && (rawUrl.toLowerCase().includes('streamhg') || rawUrl.toLowerCase().includes('streamhgapi') || rawUrl.toLowerCase().includes('hgcloud'))) {
        hUrl = rawUrl;
      }
      if (hUrl) {
        list.push({
          id: 'streamhg',
          name: 'StreamHG (720p)',
          label: PROVIDER_LABELS.streamhg,
          url: normalizeStreamHgUrl(hUrl),
          fast: true,
        });
      }

      // Streamtape
      let sUrl = streamtapeEmbed;
      if (!sUrl && rawUrl && (rawUrl.toLowerCase().includes('streamtape') || rawUrl.toLowerCase().includes('tapecontent') || rawUrl.toLowerCase().includes('strtape'))) sUrl = rawUrl;
      if (sUrl) {
        list.push({
          id: 'streamtape',
          name: 'Streamtape',
          label: PROVIDER_LABELS.streamtape,
          url: sUrl,
          fast: false,
        });
      }

      // Doodstream
      let dUrl = doodEmbed;
      if (!dUrl && rawUrl && (rawUrl.toLowerCase().includes('dood') || rawUrl.toLowerCase().includes('ds2play') || rawUrl.toLowerCase().includes('doood'))) dUrl = rawUrl;
      if (dUrl) {
        list.push({
          id: 'doodstream',
          name: 'Doodstream',
          label: PROVIDER_LABELS.doodstream,
          url: dUrl,
          fast: false,
        });
      }

      // Single fallback embed if no specific provider matched
      if (list.length === 0 && rawUrl) {
        list.push({
          id: 'default',
          name: 'السيرفر الأساسي',
          label: '🚀 السيرفر الأساسي',
          url: normalizeStreamHgUrl(rawUrl),
          fast: true,
        });
      }
    }

    // Deduplicate by URL
    const seenUrls = new Set();
    return list.filter((s) => {
      if (seenUrls.has(s.url)) return false;
      seenUrls.add(s.url);
      return true;
    });
  }, [servers, embedUrl, primaryEmbed, vidmolyEmbed, streamhgEmbed, hgcloudEmbed, streamtapeEmbed, doodEmbed, embedHtml]);

  // Active Server ID: default to first available server in priority order
  const [activeServerId, setActiveServerId] = useState(() => resolvedServers[0]?.id || 'default');

  // Mirror fallback state for Vidmoly (toggles between vidmoly.to and vidmoly.biz)
  const [useVidmolyMirror, setUseVidmolyMirror] = useState(false);

  // Synchronize active server if servers list changes (e.g. episode switch)
  useEffect(() => {
    if (resolvedServers.length > 0 && !resolvedServers.some((s) => s.id === activeServerId) && activeServerId !== 'vip') {
      setActiveServerId(resolvedServers[0].id);
    }
  }, [resolvedServers, activeServerId]);

  // Ensure vidmoly.to is ALWAYS the immediate default domain upon first load or server/episode switch
  useEffect(() => {
    setUseVidmolyMirror(false);
  }, [activeServerId, slug]);

  // Active Server details & mirror fallback URL resolution
  const activeServer = resolvedServers.find((s) => s.id === activeServerId) || resolvedServers[0];
  const rawActiveUrl = activeServer?.url || null;
  const isVidmoly = activeServer?.id === 'vidmoly' || (rawActiveUrl && rawActiveUrl.includes('vidmoly'));

  // Formatted server embed URL with safe mirror switching (vidmoly.to <-> vidmoly.biz)
  const formattedServerUrl = useMemo(() => {
    if (!rawActiveUrl) return null;
    if (isVidmoly) {
      const targetDomain = useVidmolyMirror ? 'vidmoly.biz' : 'vidmoly.to';
      return formatVidmolyEmbed(rawActiveUrl, targetDomain);
    }
    return rawActiveUrl;
  }, [rawActiveUrl, isVidmoly, useVidmolyMirror]);

  const activeUrl = formattedServerUrl;

  // Derive dual-quality download links (1080p Vidmoly & 720p Fast Streamtape/StreamHG)
  const resolvedDownloads = useMemo(() => {
    if (download1080 || download720) {
      return { download1080, download720, provider720: provider720 || 'Streamtape' };
    }
    return getDualQualityDownloadLinks({
      vidmolyEmbed,
      streamhgEmbed: streamhgEmbed || hgcloudEmbed,
      streamtapeEmbed,
      servers: resolvedServers,
      primaryEmbed: primaryEmbed || embedUrl,
    });
  }, [download1080, download720, provider720, vidmolyEmbed, streamhgEmbed, hgcloudEmbed, streamtapeEmbed, resolvedServers, primaryEmbed, embedUrl]);

  // Resolve direct stream link for optional EGYMAX VIP player
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
      const res = await fetch(`/api/stream/${slug}${activeUrl ? `?url=${encodeURIComponent(activeUrl)}` : ''}`);
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
  }, [slug, activeUrl, directStreamUrl]);

  // Handle stream resolution for VIP
  useEffect(() => {
    if (activeServerId === 'vip' && !streamUrl && !streamFailed && isPlaying) {
      resolveStream();
    }
  }, [activeServerId, streamUrl, streamFailed, isPlaying, resolveStream]);

  const handleCinemaError = useCallback(() => {
    console.warn('Direct stream playback error in CinemaPlayer.');
    setStreamFailed(true);
  }, []);

  const handlePlayClick = () => {
    setIsPlaying(true);
    if (activeServerId === 'vip' && !streamUrl && !streamFailed) {
      resolveStream();
    }
  };

  const handleServerChange = (serverId) => {
    setActiveServerId(serverId);
    setIsPlaying(true);
    if (serverId === 'vip' && (streamFailed || !streamUrl)) {
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
      {/* Horizontal Multi-Server Switcher Tabs Above Player */}
      {resolvedServers.length > 0 && (
        <div className={styles.serverSection}>
          <div className={styles.serverHeader}>
            <div className={styles.serverTitleGroup}>
              <span className={styles.serverIcon}>📺</span>
              <span className={styles.serverTitle}>سيرفرات المشاهدة:</span>
              {activeServer?.fast && (
                <span className={styles.fastServerBadge}>⚡ سيرفر سريع بدون تقطيع</span>
              )}
            </div>
            <span className={styles.serverHint}>
              يمكنك التبديل بين السيرفرات فوراً وبدون إعادة تحميل الصفحة
            </span>
          </div>

          {/* Interactive Server Tabs */}
          <div className={styles.serverTabs} role="tablist" aria-label="سيرفرات المشاهدة">
            {resolvedServers.map((server) => {
              const isActive = activeServerId === server.id;
              return (
                <button
                  key={server.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleServerChange(server.id)}
                  className={`${styles.serverTab} ${isActive ? styles.activeTab : ''}`}
                  title={server.label || server.name}
                >
                  <span className={styles.tabText}>{server.label || server.name}</span>
                  {server.fast && (
                    <span className={styles.fastIndicator}>سريع</span>
                  )}
                </button>
              );
            })}

            {/* Optional EGYMAX VIP Button if direct stream is available */}
            {directStreamUrl && (
              <button
                type="button"
                role="tab"
                aria-selected={activeServerId === 'vip'}
                onClick={() => handleServerChange('vip')}
                className={`${styles.serverTab} ${activeServerId === 'vip' ? styles.activeTab : ''}`}
                title="سيرفر EGYMAX VIP المباشر بدون إعلانات"
              >
                <span>👑 EGYMAX VIP (مباشر)</span>
                <span className={`${styles.tabBadge} ${styles.tabBadgeVip}`}>VIP Direct</span>
                {isResolving && <span className={styles.tabLoading}>⏳</span>}
              </button>
            )}

            {/* Vidmoly Mirror Domain Switcher (vidmoly.to <-> vidmoly.biz) */}
            {isVidmoly && (
              <button
                type="button"
                onClick={() => setUseVidmolyMirror((prev) => !prev)}
                className={`${styles.serverTab} ${useVidmolyMirror ? styles.activeTab : ''}`}
                style={{ borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
                title="التبديل بين نطاق vidmoly.to ونطاق vidmoly.biz الاحتياطي في حال حجب أحدهما"
              >
                <span>🔄 مرآة بديلة: {useVidmolyMirror ? 'vidmoly.to' : 'vidmoly.biz'}</span>
              </button>
            )}

            {/* Dual-Quality Quick Download Buttons in Player */}
            {resolvedDownloads.download1080 && (
              <a
                href={resolvedDownloads.download1080}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.serverTab}
                style={{ borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8', textDecoration: 'none' }}
                title="تحميل الفيلم بجودة 1080p FHD عبر Vidmoly"
              >
                <span>📥 تحميل 1080p</span>
                <span className={`${styles.tabBadge} ${styles.tabBadgeVip}`} style={{ background: '#0284c7' }}>FHD</span>
              </a>
            )}
            {resolvedDownloads.download720 && (
              <a
                href={resolvedDownloads.download720}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.serverTab}
                style={{ borderColor: 'rgba(52, 211, 153, 0.4)', color: '#34d399', textDecoration: 'none' }}
                title={`تحميل فائق السرعة 720p عبر ${resolvedDownloads.provider720 || 'سيرفر سريع'}`}
              >
                <span>⚡ تحميل 720p</span>
                <span className={`${styles.tabBadge} ${styles.tabBadgeFast}`} style={{ background: '#059669' }}>Fast</span>
              </a>
            )}
          </div>
        </div>
      )}

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
                {activeServer?.label || activeServer?.name || 'سيرفر المشاهدة السريع'}
              </span>
              <p className={styles.playText}>انقر هنا لبدء المشاهدة</p>
            </div>
          </div>
        ) : activeServerId !== 'vip' && formattedServerUrl ? (
          /* Dynamic Iframe Embed Switcher */
          <div className={styles.iframeWrapper}>
            <iframe 
              key={formattedServerUrl}
              src={formattedServerUrl} 
              title={title ? `${title} - ${activeServer?.label || activeServer?.name}` : 'مشغل الفيديو'}
              className="w-full h-full border-0"
              allowFullScreen 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : activeServerId === 'vip' ? (
          /* EGYMAX VIP Cinema Player */
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
                يمكنك التبديل فوراً إلى السيرفرات الأخرى المتاحة بالأعلى للمشاهدة دون انقطاع.
              </p>
              <div className={styles.noticeActionButtons}>
                <button type="button" onClick={handleRetry} className={styles.retryBtn}>
                  🔄 إعادة محاولة VIP
                </button>
                {resolvedServers.length > 0 && (
                  <button 
                    type="button" 
                    onClick={() => handleServerChange(resolvedServers[0].id)} 
                    className={styles.switchMirrorBtn}
                  >
                    ⚡ الانتقال إلى {resolvedServers[0].label || resolvedServers[0].name}
                  </button>
                )}
              </div>
            </div>
          )
        ) : embedHtml ? (
          <div 
            className={styles.iframeWrapper}
            dangerouslySetInnerHTML={{ __html: embedHtml.replace(/(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.)?(?:streamhg(?:api)?\.com|hgcloud\.to)\/(?:e\/)?([a-zA-Z0-9_-]+)/gi, 'https://hgcloud.to/e/$1') }} 
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
    </div>
  );
}
