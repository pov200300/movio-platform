import { NextResponse } from 'next/server';
import { getMovieBySlug, parseMovieData, getMovieEmbedUrl } from '../../../../lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request, { params }) {
  try {
    const slug = params?.slug;
    const { searchParams } = new URL(request.url);
    const queryUrl = searchParams.get('url');

    let embedUrl = queryUrl || null;
    let directStreamUrl = null;
    let movie = null;

    if (slug) {
      const post = await getMovieBySlug(slug);
      if (post) {
        movie = parseMovieData(post);
        // Check for direct video links in post meta
        directStreamUrl = post.meta?.direct_stream_url ||
                          post.meta?.stream_url ||
                          post.meta?.direct_video_url ||
                          post.meta?.video_url ||
                          post.meta?.mp4_url ||
                          null;

        if (!embedUrl) {
          embedUrl = movie?.embedUrl || getMovieEmbedUrl(post);
        }
      }
    }

    // 1. If direct stream URL is already in the database/meta, serve it immediately
    if (directStreamUrl) {
      return NextResponse.json({
        success: true,
        streamUrl: directStreamUrl,
        type: directStreamUrl.endsWith('.m3u8') ? 'm3u8' : 'mp4',
        fallbackEmbedUrl: embedUrl,
      });
    }

    // 2. If DoodStream API key is available, attempt resolving via DoodStream API
    const doodApiKey = process.env.DOOD_API_KEY || process.env.DOODSTREAM_API_KEY;
    if (doodApiKey && embedUrl) {
      const fileCodeMatch = embedUrl.match(/(?:dood\.[a-z]+|doodstream\.com)\/(?:e|d)\/([a-zA-Z0-9]+)/i);
      const fileCode = fileCodeMatch ? fileCodeMatch[1] : null;

      if (fileCode) {
        try {
          // Query DoodStream API file info
          const apiUrl = `https://doodapi.com/api/file/info?key=${doodApiKey}&file_code=${fileCode}`;
          const res = await fetch(apiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://doodstream.com/',
            },
            signal: AbortSignal.timeout(6000),
          });

          if (res.ok) {
            const data = await res.json();
            if (data?.status === 200 && data.result?.[0]?.download_url) {
              return NextResponse.json({
                success: true,
                streamUrl: data.result[0].download_url,
                type: 'mp4',
                fallbackEmbedUrl: embedUrl,
              });
            }
          }
        } catch (apiErr) {
          console.warn('DoodStream API resolve error:', apiErr.message);
        }
      }
    }

    // 3. If direct stream is not available, return structured fallback response
    return NextResponse.json({
      success: false,
      error: 'Direct video stream URL not available for this title',
      fallbackEmbedUrl: embedUrl,
    });
  } catch (error) {
    console.error('Stream resolver error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to resolve stream link',
      fallbackEmbedUrl: null,
    }, { status: 500 });
  }
}
