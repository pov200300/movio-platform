import { NextResponse } from 'next/server';
import { searchMovies, parseMovieData } from '../../../lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const query = q.trim();

    // 1. Return early with empty list if query is shorter than 2 characters
    if (query.length < 2) {
      return NextResponse.json([]);
    }

    // 2. Query WordPress REST API for matching posts
    const rawPosts = await searchMovies({ search: query, perPage: 12 });

    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
      return NextResponse.json([]);
    }

    const lowerQuery = query.toLowerCase();
    const suggestions = [];

    for (const post of rawPosts) {
      const parsed = parseMovieData(post);
      if (!parsed) continue;

      const rawTitle = parsed.rawTitle || '';
      const cleanTitle = parsed.cleanTitle || '';

      // Determine Arabic and English titles
      let titleAr = post.meta?.title_ar || '';
      let titleEn = post.meta?.title_en || post.meta?.original_title || '';

      const hasArabic = /[\u0600-\u06FF]/.test(cleanTitle);
      const hasEnglish = /[a-zA-Z]/.test(cleanTitle);

      if (!titleAr || !titleEn) {
        if (hasArabic && hasEnglish) {
          const parts = cleanTitle.split(/[-/|:]/);
          if (parts.length >= 2) {
            const p1 = parts[0].trim();
            const p2 = parts[1].trim();
            if (/[\u0600-\u06FF]/.test(p1)) {
              titleAr = titleAr || p1;
              titleEn = titleEn || p2;
            } else {
              titleEn = titleEn || p1;
              titleAr = titleAr || p2;
            }
          }
        }

        if (!titleAr) {
          titleAr = hasArabic ? cleanTitle : `فيلم ${cleanTitle}`;
        }

        if (!titleEn) {
          titleEn = hasEnglish
            ? cleanTitle.replace(/[\u0600-\u06FF]+/g, '').trim() || cleanTitle
            : cleanTitle;
        }
      }

      // Check if either title matches
      const matchesAr = titleAr.toLowerCase().includes(lowerQuery);
      const matchesEn = titleEn.toLowerCase().includes(lowerQuery);
      const matchesRaw = rawTitle.toLowerCase().includes(lowerQuery);

      if (matchesAr || matchesEn || matchesRaw || query.length >= 2) {
        suggestions.push({
          id: post.id,
          slug: parsed.slug,
          title_ar: titleAr,
          title_en: titleEn,
          year: parsed.year || '2026',
          rating: parsed.rating || '7.5',
          poster_url: parsed.posterUrl || '/placeholder.svg',
          quality: parsed.quality || '1080p',
        });
      }

      // Limit to top 5-6 results for optimal speed
      if (suggestions.length >= 6) {
        break;
      }
    }

    return NextResponse.json(suggestions);
  } catch (error) {
    console.error('Error in search API route:', error);
    return NextResponse.json([]);
  }
}
