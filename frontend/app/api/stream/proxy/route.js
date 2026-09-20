import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoUrl = searchParams.get('url');

    if (!videoUrl) {
      return NextResponse.json({ error: 'Missing video URL parameter' }, { status: 400 });
    }

    const rangeHeader = request.headers.get('range');
    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://doodstream.com/',
      'Accept': '*/*',
    };

    if (rangeHeader) {
      proxyHeaders['Range'] = rangeHeader;
    }

    console.log(`[Stream Proxy] Proxying video stream from: ${videoUrl.substring(0, 60)}... with Range: ${rangeHeader || 'none'}`);

    const res = await fetch(videoUrl, {
      headers: proxyHeaders,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok && res.status !== 206) {
      console.warn(`[Stream Proxy] Target video server returned status: ${res.status}`);
      return new Response(`Upstream server returned ${res.status}`, { status: res.status });
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', res.headers.get('content-type') || 'video/mp4');
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');

    if (res.headers.get('content-range')) {
      responseHeaders.set('Content-Range', res.headers.get('content-range'));
    }
    if (res.headers.get('content-length')) {
      responseHeaders.set('Content-Length', res.headers.get('content-length'));
    }

    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Stream Proxy] Error proxying video stream:', error.message);
    return NextResponse.json({ error: 'Failed to proxy video stream' }, { status: 502 });
  }
}
