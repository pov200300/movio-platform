import { NextResponse } from 'next/server';
import { getMovieBySlug, parseMovieData, getMovieEmbedUrl } from '../../../../lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request, { params }) {
  try {
    const slug = params?.slug;
    const { searchParams } = new URL(request.url);
    const queryUrl = searchParams.get('url');

    console.log(`[Stream API] Incoming stream request for slug: "${slug}", queryUrl: "${queryUrl || 'none'}"`);

    let embedUrl = queryUrl || null;
    let directStreamUrl = null;
    let movie = null;
    let postMeta = null;

    if (slug) {
      const post = await getMovieBySlug(slug);
      if (post) {
        movie = parseMovieData(post);
        postMeta = post.meta || {};

        // 1. Prioritize direct video URLs in WordPress metadata
        directStreamUrl = postMeta.direct_url ||
                          postMeta.mp4_url ||
                          postMeta.direct_stream_url ||
                          postMeta.stream_url ||
                          postMeta.direct_video_url ||
                          postMeta.video_url ||
                          null;

        if (!embedUrl) {
          embedUrl = movie?.embedUrl || getMovieEmbedUrl(post);
        }
      } else {
        console.warn(`[Stream API] Post not found for slug: "${slug}"`);
      }
    }

    // 1. If direct stream URL is found in WordPress meta, serve it immediately
    if (directStreamUrl) {
      console.log(`[Stream API] Direct stream URL found in WordPress meta for "${slug}": ${directStreamUrl}`);
      return NextResponse.json({
        success: true,
        streamUrl: directStreamUrl,
        type: directStreamUrl.endsWith('.m3u8') ? 'm3u8' : 'mp4',
        fallbackEmbedUrl: embedUrl,
      });
    }

    console.log(`[Stream API] No direct stream URL in WordPress metadata. Checking DoodStream embed: ${embedUrl || 'none'}`);

    // 2. Inspect DoodStream API Key
    const doodApiKey = process.env.DOOD_API_KEY || process.env.DOODSTREAM_API_KEY;
    if (!doodApiKey) {
      console.warn(`[Stream API] DOOD_API_KEY is not configured in .env.local.`);
    } else {
      console.log(`[Stream API] DOOD_API_KEY found. Attempting DoodStream API resolution...`);
    }

    // Extract DoodStream file code if embed URL is present
    let fileCode = null;
    if (embedUrl) {
      const fileCodeMatch = embedUrl.match(/(?:dood\.[a-z]+|doodstream\.com)\/(?:e|d)\/([a-zA-Z0-9]+)/i);
      fileCode = fileCodeMatch ? fileCodeMatch[1] : null;
    }

    // 3. Attempt DoodStream API resolution if API key is provided
    if (doodApiKey && fileCode) {
      try {
        console.log(`[Stream API] Querying DoodStream API for file code: "${fileCode}"`);
        const apiUrl = `https://doodapi.com/api/file/info?key=${doodApiKey}&file_code=${fileCode}`;
        const apiRes = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://doodstream.com/',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (apiRes.ok) {
          const apiData = await apiRes.json();
          console.log(`[Stream API] DoodStream API response status: ${apiData?.status}`);
          if (apiData?.status === 200 && apiData.result?.[0]?.download_url) {
            const rawDownloadUrl = apiData.result[0].download_url;
            // Wrap through proxy route to bypass CORS/hotlink protection
            const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(rawDownloadUrl)}`;
            return NextResponse.json({
              success: true,
              streamUrl: proxiedUrl,
              type: 'mp4',
              fallbackEmbedUrl: embedUrl,
            });
          }
        }
      } catch (apiErr) {
        console.warn('[Stream API] DoodStream API request failed:', apiErr.message);
      }
    }

    // 4. Attempt pass_md5 token resolution flow if file code is available
    if (fileCode) {
      try {
        console.log(`[Stream API] Attempting pass_md5 token flow for file code: "${fileCode}"`);
        const embedHost = 'https://doodstream.com';
        const pageRes = await fetch(`${embedHost}/e/${fileCode}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(6000),
        });

        if (pageRes.ok) {
          const html = await pageRes.text();
          const passMatch = html.match(/\/pass_md5\/[a-zA-Z0-9_\-\/]+/i);
          if (passMatch) {
            const passUrl = `${embedHost}${passMatch[0]}`;
            console.log(`[Stream API] Found pass_md5 endpoint: ${passUrl}`);
            const passRes = await fetch(passUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': `${embedHost}/e/${fileCode}`,
              },
              signal: AbortSignal.timeout(6000),
            });

            if (passRes.ok) {
              const passData = await passRes.text();
              if (passData && passData.startsWith('http')) {
                // Generate random token string as required by DoodStream player script
                const randomChars = Math.random().toString(36).substring(2, 12);
                const expiry = Date.now();
                const directVideoUrl = `${passData.trim()}${randomChars}?token=${fileCode}&expiry=${expiry}`;
                console.log(`[Stream API] Successfully resolved direct stream URL via pass_md5 flow!`);

                const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(directVideoUrl)}`;
                return NextResponse.json({
                  success: true,
                  streamUrl: proxiedUrl,
                  type: 'mp4',
                  fallbackEmbedUrl: embedUrl,
                });
              }
            }
          }
        }
      } catch (passErr) {
        console.warn(`[Stream API] pass_md5 resolution error for file "${fileCode}":`, passErr.message);
      }
    }

    // 5. If direct stream is not yet available, return structured response without error crashing
    console.log(`[Stream API] Direct stream not available for slug: "${slug}". Returning structured fallback.`);
    return NextResponse.json({
      success: false,
      error: 'Direct video stream URL not available for this title yet.',
      fallbackEmbedUrl: embedUrl,
    });
  } catch (error) {
    console.error('[Stream API] Unhandled stream resolver error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to resolve stream link',
      fallbackEmbedUrl: null,
    }, { status: 500 });
  }
}
