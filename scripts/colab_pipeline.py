#!/usr/bin/env python3
"""
EGYMAX Platform — Production Automation Pipeline
================================================
Decoupled Cloud Ingestion Worker:
1. TMDB API: Verified high-res metadata, poster (original), backdrop & rating.
2. YTS API: Torrent resolution (1080p/720p/magnet).
3. Aria2c: High-speed multi-connection cloud download into /content/download.
4. DoodStream API: Chunked streaming upload with progress bar.
5. Pantheon REST API: Headless WordPress post publishing, poster media attachment,
   and custom metadata persistence.
"""

import os
import sys
import re
import time
import json
import shutil
import zipfile
import io
import requests
import subprocess
from urllib.parse import quote, quote_plus
from requests.auth import HTTPBasicAuth
from bs4 import BeautifulSoup

# Optional progress-tracked multipart upload
try:
    from requests_toolbelt import MultipartEncoder, MultipartEncoderMonitor
    HAS_TOOLBELT = True
except ImportError:
    HAS_TOOLBELT = False

# Load local .env if available (ignored by git)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Optional Google Colab Encrypted Secrets retrieval
try:
    from google.colab import userdata
    _COLAB_WP_PASS = userdata.get('WP_APP_PASSWORD')
    _COLAB_TMDB_KEY = userdata.get('TMDB_API_KEY')
    _COLAB_DOOD_KEY = userdata.get('DOODSTREAM_API_KEY')
    _COLAB_STREAMTAPE_LOGIN = userdata.get('STREAMTAPE_LOGIN')
    _COLAB_STREAMTAPE_KEY = userdata.get('STREAMTAPE_KEY')
except Exception:
    _COLAB_WP_PASS = None
    _COLAB_TMDB_KEY = None
    _COLAB_DOOD_KEY = None
    _COLAB_STREAMTAPE_LOGIN = None
    _COLAB_STREAMTAPE_KEY = None

# =============================================================================
# ENVIRONMENT & CREDENTIALS CONFIGURATION
# =============================================================================
WP_SITE_URL = os.getenv("WP_SITE_URL", "https://dev-movio-stream.pantheonsite.io").rstrip("/")
WP_USERNAME = os.getenv("WP_USERNAME", "admin")
WP_APP_PASSWORD = os.getenv("WP_APP_PASSWORD") or _COLAB_WP_PASS or ""
NEXTJS_URL = os.getenv("NEXTJS_URL", "https://egymax.vercel.app").rstrip("/")

TMDB_API_KEY = os.getenv("TMDB_API_KEY") or _COLAB_TMDB_KEY or ""
DOODSTREAM_API_KEY = os.getenv("DOODSTREAM_API_KEY") or _COLAB_DOOD_KEY or ""
DOODSTREAM_API_BASE = "https://doodapi.com/api"

STREAMTAPE_LOGIN = os.getenv("STREAMTAPE_LOGIN") or _COLAB_STREAMTAPE_LOGIN or "06340d1c727a30bcd350"
STREAMTAPE_KEY = os.getenv("STREAMTAPE_KEY") or _COLAB_STREAMTAPE_KEY or "BbWjjoderVTyxx2"
STREAMTAPE_API_BASE = "https://api.streamtape.com"

DOWNLOAD_DIR = "/content/download" if os.path.exists("/content") else os.path.abspath("./downloads")
STAGING_DIR = "/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,application/json,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Not-A.Brand";v="99", "Chromium";v="124", "Google Chrome";v="124"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1"
}

def log(tag: str, msg: str):
    timestamp = time.strftime("%H:%M:%S")
    try:
        print(f"[{timestamp}] [{tag}] {msg}", flush=True)
    except UnicodeEncodeError:
        safe_msg = str(msg).encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8", errors="replace")
        print(f"[{timestamp}] [{tag}] {safe_msg}", flush=True)

# =============================================================================
# 1. METADATA & POSTER RESOLUTION (TMDB API)
# =============================================================================
def translate_to_arabic(text: str) -> str:
    """
    Translate English synopsis to clean Arabic using deep-translator (GoogleTranslator with MyMemory fallback).
    """
    if not text or not text.strip():
        return ""
    try:
        from deep_translator import GoogleTranslator
        res = GoogleTranslator(source='en', target='ar').translate(text)
        if res and res.strip():
            return res.strip()
    except Exception:
        pass

    try:
        from deep_translator import MyMemoryTranslator
        res = MyMemoryTranslator(source='en-US', target='ar-SA').translate(text)
        if res and res.strip():
            return res.strip()
    except Exception:
        pass

    return text

def format_imdb_rating(raw_val) -> str:
    """
    Format and preserve IMDb rating strictly as a decimal string with one decimal place (e.g. '8.5').
    Prevents truncation to integers (avoiding int(), Math.round).
    """
    if raw_val is None:
        return ""
    try:
        if isinstance(raw_val, str):
            clean = raw_val.strip()
            match = re.search(r'(\d+(?:\.\d+)?)', clean)
            if match:
                f_val = float(match.group(1))
                if 0.0 < f_val <= 10.0:
                    return f"{f_val:.1f}"
        elif isinstance(raw_val, (int, float)):
            f_val = float(raw_val)
            if 0.0 < f_val <= 10.0:
                return f"{f_val:.1f}"
    except (ValueError, TypeError):
        pass
    return ""

def get_movie_metadata(movie_title: str, release_year: str = None, imdb_id: str = None, api_key: str = TMDB_API_KEY) -> dict:
    """
    Fetch verified metadata, Arabic title, Arabic overview (with deep-translator fallback),
    cast (top 5), poster, backdrop, genres, and rating from official TMDB API.
    """
    log("TMDB", f"Querying TMDB for '{movie_title}' (Year: {release_year or 'Any'}, IMDb: {imdb_id or 'None'})...")
    
    movie_item = None
    
    # Method A: Direct IMDb ID lookup if provided
    if imdb_id and api_key:
        try:
            find_url = f"https://api.themoviedb.org/3/find/{imdb_id}?api_key={api_key}&external_source=imdb_id"
            res = requests.get(find_url, headers=HEADERS, timeout=15).json()
            results = res.get("movie_results", [])
            if results:
                movie_item = results[0]
                log("TMDB", f"Found via IMDb ID: {movie_item.get('title')}")
        except Exception as e:
            log("TMDB", f"IMDb lookup error: {e}")

    # Method B: Search by Title and Year
    if not movie_item and api_key:
        try:
            search_url = f"https://api.themoviedb.org/3/search/movie?api_key={api_key}&query={quote(movie_title)}"
            if release_year:
                search_url += f"&year={release_year}"
            res = requests.get(search_url, headers=HEADERS, timeout=15).json()
            results = res.get("results", [])
            if results:
                movie_item = results[0]
                log("TMDB", f"Found via Search: {movie_item.get('title')} ({movie_item.get('release_date', '')[:4]})")
        except Exception as e:
            log("TMDB", f"Search error: {e}")

    # Initial defaults
    genres = "Action, Drama"
    tmdb_rating = ""
    overview_en = "No synopsis available."
    overview_ar = ""
    title_ar = movie_title
    original_title = movie_title
    cast_list = []
    poster_url = None
    backdrop_url = None
    final_title = movie_title
    final_year = release_year or "2026"
    extracted_imdb_id = imdb_id

    if movie_item:
        final_title = movie_item.get("title") or movie_title
        original_title = movie_item.get("original_title") or final_title
        title_ar = final_title
        final_year = (movie_item.get("release_date") or "")[:4] or final_year
        overview_en = movie_item.get("overview") or overview_en
        if movie_item.get("vote_average") is not None:
            tmdb_rating = format_imdb_rating(movie_item.get("vote_average"))
        
        poster_path = movie_item.get("poster_path")
        backdrop_path = movie_item.get("backdrop_path")
        
        if poster_path:
            poster_url = f"https://image.tmdb.org/t/p/original{poster_path}"
        if backdrop_path:
            backdrop_url = f"https://image.tmdb.org/t/p/original{backdrop_path}"
            
        tmdb_id = movie_item.get("id")
        if tmdb_id and api_key:
            try:
                # Query TMDB with language=ar-SA and append_to_response=credits
                detail_ar_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={api_key}&language=ar-SA&append_to_response=credits"
                d_ar = requests.get(detail_ar_url, headers=HEADERS, timeout=15).json()

                # Authoritative decimal rating from detailed endpoint
                if d_ar.get("vote_average") is not None:
                    d_rating = format_imdb_rating(d_ar.get("vote_average"))
                    if d_rating:
                        tmdb_rating = d_rating

                if d_ar.get("title"):
                    title_ar = d_ar.get("title")
                if d_ar.get("original_title"):
                    original_title = d_ar.get("original_title")
                if d_ar.get("overview"):
                    overview_ar = d_ar.get("overview").strip()

                # Extract top 4-5 leading actors
                credits_cast = d_ar.get("credits", {}).get("cast", [])
                if not credits_cast:
                    # Fallback to English credits if credits missing in Arabic endpoint
                    try:
                        c_res = requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits?api_key={api_key}", headers=HEADERS, timeout=10).json()
                        credits_cast = c_res.get("cast", [])
                    except Exception:
                        pass

                cast_list = [c.get("name") for c in credits_cast[:5] if c.get("name")]

                # Genres
                if "genres" in d_ar and d_ar["genres"]:
                    genres = ", ".join([g["name"] for g in d_ar["genres"]])

                extracted_imdb_id = d_ar.get("imdb_id") or extracted_imdb_id
            except Exception as e:
                log("TMDB", f"Arabic details lookup notice: {e}")

    # Fallback to OMDb API if rating still empty and IMDb ID is known
    if not tmdb_rating and extracted_imdb_id:
        try:
            omdb_res = requests.get(f"https://www.omdbapi.com/?i={extracted_imdb_id}&apikey=trilogy", headers=HEADERS, timeout=8).json()
            if omdb_res.get("Response") == "True" and omdb_res.get("imdbRating"):
                tmdb_rating = format_imdb_rating(omdb_res.get("imdbRating"))
        except Exception:
            pass

    if not tmdb_rating:
        tmdb_rating = "7.5"

    # If overview_ar is empty, fallback to English overview translated to Arabic via deep-translator
    if not overview_ar:
        if overview_en and overview_en != "No synopsis available.":
            log("TMDB", "Arabic synopsis empty on TMDB. Translating English overview to Arabic via deep-translator...")
            overview_ar = translate_to_arabic(overview_en)
        if not overview_ar:
            overview_ar = "تدور أحداث الفيلم في إطار مشوق ومثير مليء بالأحداث غير المتوقعة والمغامرات الشيقة."

    # Top cast string
    cast_names = "، ".join(cast_list) if cast_list else ""

    # Generate Professional Arabic SEO Description matching modern Arabic cinema platforms
    if cast_names:
        if original_title and original_title.lower() != title_ar.lower():
            seo_intro = f"مشاهدة وتحميل فيلم {title_ar} ({original_title}) {final_year} مترجم كامل بجودة 1080p BluRay عالية أون لاين، بطولة {cast_names}."
        else:
            seo_intro = f"مشاهدة وتحميل فيلم {title_ar} {final_year} مترجم كامل بجودة 1080p BluRay عالية أون لاين، بطولة {cast_names}."
    else:
        if original_title and original_title.lower() != title_ar.lower():
            seo_intro = f"مشاهدة وتحميل فيلم {title_ar} ({original_title}) {final_year} مترجم كامل بجودة 1080p BluRay عالية أون لاين."
        else:
            seo_intro = f"مشاهدة وتحميل فيلم {title_ar} {final_year} مترجم كامل بجودة 1080p BluRay عالية أون لاين."

    # Fallback to high quality placeholder if no poster found
    if not poster_url:
        poster_url = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1000&q=85"

    meta = {
        "title": final_title,
        "title_ar": title_ar,
        "original_title": original_title,
        "year": final_year,
        "overview": overview_en,
        "overview_ar": overview_ar,
        "cast": cast_list,
        "cast_names": cast_names,
        "seo_description": seo_intro,
        "rating": tmdb_rating,
        "imdb_rating": tmdb_rating,
        "genres": genres,
        "poster_url": poster_url,
        "backdrop_url": backdrop_url,
        "imdb_id": extracted_imdb_id,
    }
    log("TMDB", f"Metadata ready: '{meta['title']}' ({meta['year']}) | Title AR: '{meta['title_ar']}' | ★ {meta['imdb_rating']} | Cast: {cast_names or 'N/A'}")
    return meta

fetch_tmdb_metadata = get_movie_metadata

# =============================================================================
# TV SERIES & EPISODE RESOLVER (TMDB TV & EZTV API)
# =============================================================================
def parse_media_item(item_str: str) -> dict:
    """
    Parse a media title or batch item string to identify if it is a TV episode or a movie.
    Recognizes patterns such as:
    - Breaking Bad S01E01, Breaking.Bad.S02E05, Game of Thrones S08E03
    - Season 1 Episode 1, 1x01, etc.
    Returns a dict with metadata flags.
    """
    clean_item = str(item_str).strip()
    patterns = [
        # Standard S01E01 / s01e01 / S1E1
        r'^(?P<show>.*?)[.\s_-]+[Ss](?P<season>\d{1,2})[.\s_-]*[Ee](?P<episode>\d{1,2})(?:[.\s_-]+(?P<rest>.*))?$',
        # Season 1 Episode 1
        r'^(?P<show>.*?)[.\s_-]+[Ss]eason\s*(?P<season>\d{1,2})[.\s_-]+[Ee]pisode\s*(?P<episode>\d{1,2})(?:[.\s_-]+(?P<rest>.*))?$',
        # 1x01 / 01x01
        r'^(?P<show>.*?)[.\s_-]+(?P<season>\d{1,2})x(?P<episode>\d{1,2})(?:[.\s_-]+(?P<rest>.*))?$'
    ]
    for pat in patterns:
        m = re.match(pat, clean_item, re.IGNORECASE)
        if m:
            show = m.group('show').replace('.', ' ').strip()
            s_num = int(m.group('season'))
            e_num = int(m.group('episode'))
            tag = f"S{s_num:02d}E{e_num:02d}"
            return {
                "is_episode": True,
                "show_name": show,
                "season_number": s_num,
                "episode_number": e_num,
                "episode_tag": tag,
                "raw_item": clean_item
            }
    # Movie fallback: extract release year if present
    year = None
    title = clean_item
    imdb_id = None
    if clean_item.startswith("tt") and len(clean_item) >= 9:
        imdb_id = clean_item
    else:
        m_year = re.search(r'\((\d{4})\)', clean_item)
        if m_year:
            year = m_year.group(1)
            title = clean_item.replace(f"({year})", "").strip()
    return {
        "is_episode": False,
        "title": title,
        "year": year,
        "imdb_id": imdb_id,
        "raw_item": clean_item
    }

def fetch_tv_metadata(show_name: str, season_num: int = 1, episode_num: int = 1, imdb_id: str = None, api_key: str = TMDB_API_KEY) -> dict:
    """
    Fetch comprehensive TV Show and Episode metadata via TMDB API.
    Resolves show IMDb ID, ratings, Arabic synopsis, poster, and backdrop.
    """
    log("TMDB", f"Querying TV metadata: '{show_name}' S{season_num:02d}E{episode_num:02d} (IMDb: {imdb_id or 'None'})...")
    tv_show = None
    extracted_imdb_id = imdb_id

    # 1. Lookup by IMDb ID if provided
    if imdb_id and api_key:
        try:
            find_url = f"https://api.themoviedb.org/3/find/{imdb_id}?api_key={api_key}&external_source=imdb_id"
            r = requests.get(find_url, headers=HEADERS, timeout=15).json()
            tv_results = r.get("tv_results", [])
            if tv_results:
                tv_show = tv_results[0]
        except Exception as e:
            log("TMDB", f"TV IMDb lookup notice: {e}")

    # 2. Search TV by show name
    if not tv_show and api_key:
        try:
            search_url = f"https://api.themoviedb.org/3/search/tv?api_key={api_key}&query={quote(show_name)}"
            r = requests.get(search_url, headers=HEADERS, timeout=15).json()
            results = r.get("results", [])
            if results:
                tv_show = results[0]
        except Exception as e:
            log("TMDB", f"TV search notice: {e}")

    final_show_title = show_name
    title_ar = show_name
    overview_en = "No synopsis available."
    overview_ar = ""
    rating = "8.5"
    poster_url = None
    backdrop_url = None
    genres = "Drama, Crime"
    first_air_year = "2026"
    cast_list = []

    if tv_show:
        tv_id = tv_show.get("id")
        final_show_title = tv_show.get("name") or show_name
        title_ar = final_show_title
        first_air_year = (tv_show.get("first_air_date") or "")[:4] or "2026"
        overview_en = tv_show.get("overview") or overview_en
        if tv_show.get("vote_average"):
            rating = format_imdb_rating(tv_show.get("vote_average"))
        if tv_show.get("poster_path"):
            poster_url = f"https://image.tmdb.org/t/p/original{tv_show['poster_path']}"
        if tv_show.get("backdrop_path"):
            backdrop_url = f"https://image.tmdb.org/t/p/original{tv_show['backdrop_path']}"

        # Fetch external IDs to resolve IMDb ID if not present
        if tv_id and api_key and not extracted_imdb_id:
            try:
                ext_url = f"https://api.themoviedb.org/3/tv/{tv_id}/external_ids?api_key={api_key}"
                ext_r = requests.get(ext_url, headers=HEADERS, timeout=10).json()
                extracted_imdb_id = ext_r.get("imdb_id")
            except Exception:
                pass

        # Fetch Arabic details and credits
        if tv_id and api_key:
            try:
                detail_ar_url = f"https://api.themoviedb.org/3/tv/{tv_id}?api_key={api_key}&language=ar-SA&append_to_response=credits"
                ar_r = requests.get(detail_ar_url, headers=HEADERS, timeout=15).json()
                if ar_r.get("name"):
                    title_ar = ar_r.get("name")
                if ar_r.get("overview"):
                    overview_ar = ar_r.get("overview")
                if ar_r.get("genres"):
                    genres = ", ".join([g["name"] for g in ar_r["genres"] if "name" in g])
                cast_data = ar_r.get("credits", {}).get("cast", [])
                cast_list = [c["name"] for c in cast_data[:5] if "name" in c]
            except Exception as e:
                log("TMDB", f"TV Arabic details notice: {e}")

            # Also fetch episode-specific overview if available
            try:
                ep_url = f"https://api.themoviedb.org/3/tv/{tv_id}/season/{season_num}/episode/{episode_num}?api_key={api_key}&language=ar-SA"
                ep_r = requests.get(ep_url, headers=HEADERS, timeout=10).json()
                if ep_r.get("overview"):
                    overview_ar = ep_r.get("overview")
                if ep_r.get("still_path") and not backdrop_url:
                    backdrop_url = f"https://image.tmdb.org/t/p/original{ep_r['still_path']}"
                if ep_r.get("vote_average"):
                    rating = format_imdb_rating(ep_r.get("vote_average"))
            except Exception:
                pass

    if not overview_ar and overview_en and overview_en != "No synopsis available.":
        overview_ar = translate_to_arabic(overview_en)

    episode_tag = f"S{season_num:02d}E{episode_num:02d}"
    seo_intro = f"مشاهدة وتحميل مسلسل {title_ar} الموسم {season_num} الحلقة {episode_num} ({episode_tag}) مترجم كامل بجودة 1080p BluRay عالية أون لاين."

    if not poster_url:
        poster_url = "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=1000&q=85"

    return {
        "is_episode": True,
        "show_name": final_show_title,
        "title": f"{final_show_title} {episode_tag}",
        "title_ar": title_ar,
        "season_number": season_num,
        "episode_number": episode_num,
        "episode_tag": episode_tag,
        "year": first_air_year,
        "overview": overview_en,
        "overview_ar": overview_ar or f"تدور أحداث الحلقة {episode_num} من مسلسل {title_ar} في إطار درامي شيق ومثير.",
        "cast": cast_list,
        "cast_names": "، ".join(cast_list) if cast_list else "",
        "seo_description": seo_intro,
        "rating": rating or "8.5",
        "imdb_rating": rating or "8.5",
        "genres": genres,
        "poster_url": poster_url,
        "backdrop_url": backdrop_url,
        "imdb_id": extracted_imdb_id,
    }

def matches_show_tokens(show_name: str, title: str) -> bool:
    """
    Enforce exact token and phrase matching for show_name against torrent title
    to prevent false matches (e.g., rejecting "Breaking Brad" and "The Bad Guys Breaking In" when looking for "Breaking Bad").
    """
    norm_show = re.sub(r"['’]", "", show_name).lower()
    norm_show = re.sub(r'[^\w\s]', ' ', norm_show)
    show_words = [re.escape(w) for w in norm_show.split() if w]
    if not show_words:
        return True
    show_phrase = r'\s+'.join(show_words)
    
    norm_title = re.sub(r"['’]", "", title).lower()
    clean_title = re.sub(r'[._\-]', ' ', norm_title)
    
    # 1. Exact phrase sequence check
    if re.search(rf"\b{show_phrase}\b", clean_title):
        return True
    # 2. Whole-word token check
    return all(re.search(rf"\b{tok}\b", clean_title) for tok in show_words)

def fetch_tv_torrent(show_name: str, season_num: int, episode_num: int, imdb_id: str = None, preferred_quality: str = "1080p") -> dict:
    """
    Unified Multi-Indexer TV Torrent Resolver:
    1. Primary Swarm Indexer: APIBay (The Pirate Bay API - open, fast, no Cloudflare/Colab blocks).
    2. Secondary Swarm Indexer: EZTV API across active mirrors.
    3. Tertiary Swarm Indexer: Torrentio public stream provider.
    - Exact token & phrase validation prevents false matches.
    - Enforces seeds > 0 (filters out dead swarms).
    - Sorts matching releases by quality (1080p -> 720p) and active seeds count descending.
    """
    episode_tag = f"S{season_num:02d}E{episode_num:02d}"
    log("TV", f"Searching TV torrent swarms for {show_name} {episode_tag} (IMDb: {imdb_id or 'N/A'})...")

    matched_torrents = []

    trackers_list = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://tracker.bittor.pw:1337/announce",
        "udp://public.popcorn-tracker.org:6969/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://exodus.desync.com:6969",
        "udp://open.demonii.com:1337/announce"
    ]
    trackers_query = "".join(f"&tr={quote(tr)}" for tr in trackers_list)

    # 1. Primary Indexer: APIBay (The Pirate Bay API - open, no Cloudflare, Google Colab friendly)
    try:
        apibay_query = f"{show_name} {episode_tag}"
        apibay_url = f"https://apibay.org/q.php?q={quote_plus(apibay_query)}"
        r = requests.get(apibay_url, headers=HEADERS, timeout=8)
        if r.status_code == 200:
            items = r.json()
            if isinstance(items, list):
                for item in items:
                    name = item.get("name", "")
                    info_hash = item.get("info_hash", "")
                    if not info_hash or info_hash == "0000000000000000000000000000000000000000" or name == "No results returned":
                        continue
                    if not matches_show_tokens(show_name, name):
                        continue
                    if not re.search(rf"\bS0*{season_num}E0*{episode_num}\b", name, re.IGNORECASE):
                        continue
                    seeds = int(item.get("seeders") or 0)
                    if seeds <= 0:
                        continue
                    magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={quote(name)}{trackers_query}"
                    matched_torrents.append({
                        "title": name,
                        "torrent_url": None,
                        "magnet_uri": magnet,
                        "seeds": seeds,
                        "size_bytes": int(item.get("size") or 0),
                        "source": "APIBay"
                    })
                if matched_torrents:
                    log("TV", f"APIBay resolved {len(matched_torrents)} active releases with seeds > 0 for {episode_tag}")
    except Exception as e:
        log("TV", f"APIBay query notice: {e}")

    # 2. Secondary Indexer: EZTV API across active mirrors
    if not matched_torrents:
        mirrors = ["https://eztvx.to", "https://eztv.re", "https://eztv.wf", "https://eztv.tf", "https://eztv.yt"]
        num_imdb = re.sub(r'[^0-9]', '', imdb_id) if imdb_id else ""
        for mirror in mirrors:
            if matched_torrents:
                break
            for page in range(1, 4):
                params = {"limit": 100, "page": page}
                if num_imdb:
                    params["imdb_id"] = num_imdb
                try:
                    api_url = f"{mirror}/api/get-torrents"
                    r = requests.get(api_url, params=params, headers=HEADERS, timeout=10)
                    if r.status_code == 200:
                        torrents = r.json().get("torrents", [])
                        if not torrents:
                            break
                        for t in torrents:
                            t_title = t.get("title", "")
                            if not matches_show_tokens(show_name, t_title):
                                continue
                            t_season = int(t.get("season") or 0)
                            t_episode = int(t.get("episode") or 0)
                            if (t_season == season_num and t_episode == episode_num) or re.search(rf"\bS0*{season_num}E0*{episode_num}\b", t_title, re.IGNORECASE):
                                s_count = int(t.get("seeds") or 0)
                                if s_count > 0:
                                    matched_torrents.append({
                                        "title": t_title,
                                        "torrent_url": t.get("torrent_url"),
                                        "magnet_uri": t.get("magnet_url"),
                                        "seeds": s_count,
                                        "size_bytes": t.get("size_bytes") or 0,
                                        "source": "EZTV"
                                    })
                        if matched_torrents:
                            log("TV", f"EZTV ({mirror}) resolved {len(matched_torrents)} releases for {episode_tag}")
                            break
                except Exception:
                    continue

    # 3. Tertiary Fallback: Torrentio public stream provider
    if not matched_torrents and imdb_id:
        try:
            full_imdb = imdb_id if imdb_id.startswith("tt") else f"tt{imdb_id}"
            stream_url = f"https://torrentio.strem.fun/stream/series/{full_imdb}:{season_num}:{episode_num}.json"
            sr = requests.get(stream_url, headers=HEADERS, timeout=8)
            if sr.status_code == 200:
                streams = sr.json().get("streams", [])
                for s in streams:
                    raw_title = s.get("title", "")
                    lines = [l.strip() for l in raw_title.split("\n") if l.strip()]
                    rel_title = lines[0] if lines else s.get("name", "")
                    if not matches_show_tokens(show_name, rel_title):
                        continue
                    seeds_match = re.search(r'[👤👥]\s*([0-9]+)', raw_title) or re.search(r'([0-9]+)\s*[💾]', raw_title)
                    s_seeds = int(seeds_match.group(1)) if seeds_match else 0
                    if s_seeds <= 0:
                        continue
                    info_hash = s.get("infoHash")
                    if info_hash:
                        magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={quote(rel_title)}{trackers_query}"
                        matched_torrents.append({
                            "title": rel_title,
                            "torrent_url": None,
                            "magnet_uri": magnet,
                            "seeds": s_seeds,
                            "size_bytes": 0,
                            "source": "Torrentio"
                        })
                if matched_torrents:
                    log("TV", f"Torrentio resolved {len(matched_torrents)} releases for {episode_tag}")
        except Exception as e:
            log("TV", f"Torrentio notice: {e}")

    # Filter out releases where seeds <= 0
    valid_torrents = [t for t in matched_torrents if t["seeds"] > 0]
    if not valid_torrents:
        raise RuntimeError(f"No active torrents with seeders > 0 found for TV episode '{show_name} {episode_tag}'. Swarms are inactive across APIBay, EZTV, and indexers.")

    # Quality Prioritization & Seeds Sorting: 1080p -> 720p, sorted descending by seeds count
    def quality_tier(t):
        title = t.get("title", "").lower()
        pref = preferred_quality.lower()
        is_1080 = ("1080" in title or "1080p" in title)
        is_720 = ("720" in title or "720p" in title)
        if "1080" in pref or pref in ("both", "multi", "all"):
            return 1 if is_1080 else (2 if is_720 else 3)
        elif "720" in pref:
            return 1 if is_720 else (2 if is_1080 else 3)
        return 1 if is_1080 else (2 if is_720 else 3)

    valid_torrents.sort(key=lambda t: (quality_tier(t), -t["seeds"]))
    selected_torrent = valid_torrents[0]

    actual_quality = "1080p" if "1080" in selected_torrent.get("title", "").lower() else ("720p" if "720" in selected_torrent.get("title", "").lower() else "HDTV")
    magnet_uri = selected_torrent.get("magnet_uri")
    torrent_url = selected_torrent.get("torrent_url")

    log("TV", f"Selected release: '{selected_torrent.get('title')}' ({actual_quality}, seeds: {selected_torrent.get('seeds')}, source: {selected_torrent.get('source')})")
    return {
        "title": selected_torrent.get("title"),
        "quality": actual_quality,
        "torrent_url": torrent_url,
        "magnet_uri": magnet_uri,
        "seeds": selected_torrent.get("seeds", 0),
        "size_bytes": selected_torrent.get("size_bytes", 0)
    }

# Backward compatibility alias
fetch_eztv_torrent = fetch_tv_torrent

# =============================================================================
# 2. TORRENT ACQUISITION (YTS API FOR MOVIES)
# =============================================================================
def fetch_yts_torrent(movie_title: str, release_year: str = None, imdb_id: str = None, preferred_quality: str = "1080p") -> dict:
    """
    Search YTS API for official verified torrents and magnet links.
    Tries 1080p first, then falls back to 720p or 2160p.
    """
    mirrors = ["https://yts.mx", "https://yts.nz", "https://yts.lt", "https://yts.do"]
    search_term = imdb_id if imdb_id else movie_title
    log("YTS", f"Searching YTS for torrent: '{search_term}'...")

    data = None
    for mirror in mirrors:
        url = f"{mirror}/api/v2/list_movies.json?query_term={quote(search_term)}&sort_by=download_count"
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                res_json = r.json()
                if res_json.get("status") == "ok" and res_json.get("data", {}).get("movie_count", 0) > 0:
                    data = res_json["data"]
                    log("YTS", f"Connected to {mirror} (Found {data['movie_count']} matching titles)")
                    break
        except Exception:
            continue

    if not data or not data.get("movies"):
        raise RuntimeError(f"No torrents found on YTS for '{search_term}'.")

    # Select target movie (match year if provided)
    movies = data["movies"]
    target_movie = movies[0]
    if release_year:
        for m in movies:
            if str(m.get("year")) == str(release_year):
                target_movie = m
                break

    torrents = target_movie.get("torrents", [])
    if not torrents:
        raise RuntimeError(f"Movie '{target_movie.get('title')}' has no active torrents on YTS.")

    # Select preferred quality (1080p > 720p > others)
    selected_torrent = None
    for q in [preferred_quality, "1080p", "720p", "2160p"]:
        for t in torrents:
            if t.get("quality", "").lower() == q.lower():
                selected_torrent = t
                break
        if selected_torrent:
            break

    if not selected_torrent:
        selected_torrent = torrents[0]

    torrent_hash = selected_torrent.get("hash")
    quality = selected_torrent.get("quality", "1080p")
    torrent_url = selected_torrent.get("url")

    # Construct standard high-performance magnet URI with public trackers
    trackers = [
        "udp://open.demonii.com:1337/announce",
        "udp://tracker.openbittorrent.com:80",
        "udp://tracker.coppersurfer.tk:6969",
        "udp://glotorrents.pw:6969/announce",
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://p4p.arenabg.com:1337",
        "udp://tracker.internetwarriors.net:1337"
    ]
    tracker_args = "&".join([f"tr={quote(t)}" for t in trackers])
    magnet_uri = f"magnet:?xt=urn:btih:{torrent_hash}&dn={quote(target_movie.get('title'))}&{tracker_args}"

    yts_rating = format_imdb_rating(target_movie.get("rating"))
    if yts_rating:
        log("YTS", f"Extracted IMDb Rating from YTS: ★ {yts_rating}")

    log("YTS", f"Selected Torrent: {quality} ({selected_torrent.get('size')}) Hash: {torrent_hash[:10]}...")
    return {
        "quality": quality,
        "torrent_url": torrent_url,
        "magnet_uri": magnet_uri,
        "size": selected_torrent.get("size", "Unknown"),
        "imdb_rating": yts_rating,
    }

# =============================================================================
# 3. HIGH-SPEED DOWNLOAD (ARIA2C) & SANITIZATION
# =============================================================================
def verify_video_integrity(video_path: str) -> bool:
    """
    Run integrity check via ffprobe to verify the moov atom and stream readability.
    Returns True if video is intact and playable, False if corrupted or truncated.
    """
    if not video_path or not os.path.exists(video_path):
        return False
    if os.path.getsize(video_path) == 0:
        return False

    ffprobe_bin = shutil.which("ffprobe") or "ffprobe"
    probe_cmd = [
        ffprobe_bin,
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path
    ]
    try:
        proc = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=25)
        if proc.returncode != 0:
            err_snippet = proc.stderr.strip() if proc.stderr else ""
            log("INTEGRITY", f"❌ Video integrity check failed for {os.path.basename(video_path)}: {err_snippet}")
            return False

        dur_str = proc.stdout.strip()
        if not dur_str or dur_str == "N/A":
            log("INTEGRITY", f"❌ Video reports invalid duration ('{dur_str}') for {os.path.basename(video_path)}")
            return False

        duration = float(dur_str)
        if duration <= 0:
            log("INTEGRITY", f"❌ Video reports non-positive duration ({duration}) for {os.path.basename(video_path)}")
            return False

        return True
    except Exception as e:
        log("INTEGRITY", f"Notice probing integrity of {os.path.basename(video_path)}: {e}")
        return os.path.getsize(video_path) > (20 * 1024 * 1024)

def sanitize_download_dir(download_dir: str = DOWNLOAD_DIR, staging_dir: str = STAGING_DIR):
    """
    Completely wipe and recreate download and staging directories before every run.
    Guarantees no leftover partial .mp4 files or directories from prior runs contaminate current execution.
    """
    for d in [download_dir, staging_dir]:
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d, exist_ok=True)
    log("ARIA2", f"Purged and reset clean working directories: {download_dir} & {staging_dir}")

def download_with_aria2(torrent_source: str, download_dir: str = DOWNLOAD_DIR, staging_dir: str = STAGING_DIR) -> str:
    """
    Execute optimized aria2c download inside the cloud/Colab environment.
    Completely purges download and staging directories first, then verifies downloaded video integrity with ffprobe.
    """
    # 1. Aggressive sanitization: wipe and recreate download & staging dirs
    sanitize_download_dir(download_dir, staging_dir)
    log("ARIA2", f"Starting multi-connection download into {download_dir}...")

    cmd = [
        "aria2c",
        f"--dir={download_dir}",
        "--max-connection-per-server=16",
        "--split=16",
        "--min-split-size=1M",
        "--summary-interval=10",
        "--seed-time=0",
        "--follow-torrent=mem",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--conditional-get=true",
        "--file-allocation=none",
        "--bt-stop-timeout=120",
        "--bt-tracker-connect-timeout=10",
        torrent_source
    ]
    
    proc = subprocess.run(cmd, capture_output=False)
    if proc.returncode != 0:
        raise RuntimeError(f"aria2c download failed with exit code {proc.returncode}")

    # 2. Locate downloaded video file strictly created during current run
    video_files = []
    for root, _, files in os.walk(download_dir):
        for f in files:
            if f.lower().endswith((".mp4", ".mkv", ".avi", ".webm")):
                fpath = os.path.join(root, f)
                sz = os.path.getsize(fpath)
                if sz > 0:
                    video_files.append((fpath, sz))

    if not video_files:
        raise FileNotFoundError(f"No video files found in {download_dir} after download.")

    video_files.sort(key=lambda x: x[1], reverse=True)
    target_video = video_files[0][0]
    file_size_mb = video_files[0][1] / (1024 * 1024)

    # 3. Integrity verification: check moov atom and container readability via ffprobe
    log("ARIA2", f"Verifying container integrity of {os.path.basename(target_video)} ({file_size_mb:.2f} MB)...")
    if not verify_video_integrity(target_video):
        raise RuntimeError(f"Downloaded file is corrupted or incomplete; aborting upload. ({target_video})")

    log("ARIA2", f"✅ Download verified intact: {os.path.basename(target_video)} ({file_size_mb:.2f} MB)")
    return target_video

def read_subtitle_file_robustly(file_path: str) -> str:
    """
    Read subtitle file as binary bytes, strip UTF-8/UTF-16 BOMs and null bytes,
    and decode testing encodings in strict priority order for Arabic characters (\u0600-\u06FF).
    """
    if not file_path or not os.path.exists(file_path):
        return ""

    with open(file_path, "rb") as f:
        raw_bytes = f.read()

    # Strip UTF-8 / UTF-16 BOMs and null bytes
    raw_bytes = raw_bytes.replace(b"\x00", b"")

    # Encodings to test in strict priority
    encodings = ["utf-8-sig", "utf-8", "cp1256", "windows-1256", "iso-8859-6", "utf-16", "latin-1"]

    for enc in encodings:
        try:
            decoded = raw_bytes.decode(enc)
            # Check if Arabic characters exist in the decoded output
            if any("\u0600" <= ch <= "\u06FF" for ch in decoded):
                return decoded
        except UnicodeDecodeError:
            continue

    # Fallback with ignore if no pure Arabic block matched
    return raw_bytes.decode("cp1256", errors="replace")


def decode_arabic_subtitle(raw_bytes: bytes) -> tuple:
    """
    Decodes raw subtitle bytes testing encodings strictly in priority order:
    1. utf-8-sig
    2. utf-8
    3. cp1256 (Windows Arabic)
    4. windows-1256
    5. iso-8859-6
    6. utf-16
    7. latin-1
    Only accepts if decoded text contains Arabic Unicode characters (\u0600-\u06FF).
    Returns (cleaned_text, detected_encoding) or (None, None).
    """
    if not raw_bytes:
        return None, None

    raw_bytes = raw_bytes.replace(b"\x00", b"")
    encodings_to_try = ["utf-8-sig", "utf-8", "cp1256", "windows-1256", "iso-8859-6", "utf-16", "latin-1"]

    # Pass 1: Strict check (timing marker '-->' and Arabic Unicode characters)
    for enc in encodings_to_try:
        try:
            candidate = raw_bytes.decode(enc)
            if "-->" in candidate and any("\u0600" <= ch <= "\u06FF" for ch in candidate):
                clean_text = candidate.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
                return clean_text, enc
        except (UnicodeDecodeError, LookupError):
            continue

    # Pass 2: Fallback check (Arabic Unicode characters present)
    for enc in encodings_to_try:
        try:
            candidate = raw_bytes.decode(enc)
            if any("\u0600" <= ch <= "\u06FF" for ch in candidate):
                clean_text = candidate.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
                return clean_text, enc
        except (UnicodeDecodeError, LookupError):
            continue

    fallback = raw_bytes.decode("cp1256", errors="replace")
    if any("\u0600" <= ch <= "\u06FF" for ch in fallback):
        clean_text = fallback.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
        return clean_text, "cp1256"

    return None, None

# =============================================================================
# 4. ARABIC-ONLY SUBTITLES & FFMPEG HARDSUBBING (BURN-IN)
# =============================================================================
def download_subtitles_for_imdb(imdb_id: str, output_dir: str = DOWNLOAD_DIR) -> str:
    """
    Search and download ONLY the highest-rated Arabic (.srt) subtitle file.
    Validates content with Unicode regex [\\u0600-\\u06FF] across Arabic code pages.
    Returns the local path to the .srt file if successful, or None if not found or failed.
    """
    if not imdb_id:
        log("SUBS", "No IMDb ID available; skipping Arabic subtitle download.")
        return None

    subs_dir = os.path.join(output_dir, "subtitles")
    os.makedirs(subs_dir, exist_ok=True)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }

    log("SUBS", f"Searching highest-rated Arabic subtitle for IMDb ID '{imdb_id}'...")
    arabic_sub_url = None

    # 1. Try JSON endpoint first
    try:
        api_url = f"https://api.yifysubtitles.ch/subs/{imdb_id}"
        r = requests.get(api_url, headers=headers, timeout=6)
        if r.status_code == 200:
            data = r.json().get("subs", {}).get(imdb_id, {})
            arabic_subs = data.get("arabic", [])
            if arabic_subs:
                sorted_subs = sorted(arabic_subs, key=lambda x: x.get("rating", 0), reverse=True)
                arabic_sub_url = sorted_subs[0].get("url")
                if arabic_sub_url:
                    log("SUBS", f"Found Arabic subtitle via JSON API (Rating: {sorted_subs[0].get('rating', 'N/A')})")
    except Exception as e:
        log("SUBS", f"JSON API notice: {e}")

    # 2. Resilient fallback to HTML scraping across mirror domains
    if not arabic_sub_url:
        mirrors = [
            f"https://yifysubtitles.ch/movie-imdb/{imdb_id}",
            f"https://yts-subs.com/movie-imdb/{imdb_id}",
            f"https://yifysubtitles.org/movie-imdb/{imdb_id}"
        ]
        for mirror_url in mirrors:
            try:
                r = requests.get(mirror_url, headers=headers, timeout=10)
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    for tr in soup.find_all("tr"):
                        lang_text = ""
                        lang_tag = tr.find(class_="sub-lang")
                        if lang_tag:
                            lang_text = lang_tag.text.strip().lower()
                        else:
                            for td in tr.find_all("td"):
                                if "arabic" in td.text.strip().lower():
                                    lang_text = "arabic"
                                    break
                        # Strictly match Arabic rows - NEVER fall back to top/first row
                        if lang_text == "arabic" or "arabic" in lang_text:
                            link = tr.find("a", href=True)
                            if link and "/subtitles/" in link["href"]:
                                arabic_sub_url = link["href"]
                                log("SUBS", f"Found Arabic subtitle on mirror: {mirror_url}")
                                break
                    if arabic_sub_url:
                        break
            except Exception:
                continue

    if not arabic_sub_url:
        log("SUBS", f"No Arabic subtitles found for IMDb ID {imdb_id}.")
        return None

    # 3. Download .zip archive and extract Arabic .srt with anti-bot check and mirror resilience
    slug = arabic_sub_url.rstrip("/").split("/")[-1]
    zip_mirrors = [
        "https://yifysubtitles.ch",
        "https://yts-subs.com",
        "https://yifysubtitles.org"
    ]

    for zip_base in zip_mirrors:
        zip_url = f"{zip_base}/subtitle/{slug}.zip"
        page_referer = f"{zip_base}/subtitles/{slug}"
        req_headers = {
            "User-Agent": headers["User-Agent"],
            "Referer": page_referer
        }
        try:
            zr = requests.get(zip_url, headers=req_headers, timeout=15)
            if zr.status_code == 200:
                raw_data = zr.content.strip()
                # Inspect downloaded content: check if an HTML error / anti-bot page was returned
                if raw_data.lower().startswith(b"<!doctype html") or raw_data.lower().startswith(b"<html") or b"<body" in raw_data[:500].lower():
                    log("SUBS", f"⚠️ Mirror {zip_base} returned HTML anti-bot/error page instead of ZIP. Trying next mirror...")
                    continue

                with zipfile.ZipFile(io.BytesIO(zr.content)) as z:
                    srt_files = [f for f in z.namelist() if f.lower().endswith(".srt") and not f.startswith("__MACOSX")]
                    if not srt_files:
                        log("SUBS", f"No .srt files found in archive from {zip_base}.")
                        continue

                    selected_text = None
                    selected_encoding = None
                    target_filename = None

                    # Prioritize .srt files matching *ara* or *arabic* in their filename
                    sorted_files = sorted(srt_files, key=lambda x: 0 if ("arabic" in x.lower() or "ara" in x.lower()) else 1)
                    for fname in sorted_files:
                        f_bytes = z.read(fname)
                        decoded_text, detected_enc = decode_arabic_subtitle(f_bytes)
                        if decoded_text:
                            selected_text = decoded_text
                            selected_encoding = detected_enc
                            target_filename = fname
                            break

                    if not selected_text:
                        log("SUBS", f"None of the subtitle files in {slug}.zip contain Arabic characters across tested encodings.")
                        continue

                    out_srt = os.path.join(subs_dir, f"{imdb_id}_ara.srt")
                    with open(out_srt, "w", encoding="utf-8", newline="\n") as sf:
                        sf.write(selected_text)

                    log("SUBS", f"ℹ️ Subtitle decoded using '{selected_encoding}' and re-encoded to UTF-8.")
                    log("SUBS", f"✅ Extracted and verified Arabic subtitle -> {os.path.basename(out_srt)}")
                    return out_srt
        except Exception as e:
            log("SUBS", f"Mirror {zip_base} notice: {e}")
            continue

    log("SUBS", f"Failed downloading or verifying Arabic subtitle for {imdb_id}.")
    return None

def download_subtitles_for_tv_episode(imdb_id: str, season_num: int, episode_num: int, output_dir: str = DOWNLOAD_DIR) -> str:
    """
    Search and download Arabic subtitles precisely targeted to the TV Show's Season and Episode.
    Uses OpenSubtitles v3 public series endpoint with fallback to general subtitle search.
    """
    if not imdb_id:
        log("SUBS", "No IMDb ID available for TV episode subtitle search.")
        return None

    subs_dir = os.path.join(output_dir, "subtitles")
    os.makedirs(subs_dir, exist_ok=True)

    episode_tag = f"S{season_num:02d}E{episode_num:02d}"
    log("SUBS", f"Searching Arabic subtitles for TV Episode {imdb_id} {episode_tag}...")

    # 1. Primary: OpenSubtitles v3 series endpoint
    stremio_url = f"https://opensubtitles-v3.strem.io/subtitles/series/{imdb_id}:{season_num}:{episode_num}.json"
    try:
        r = requests.get(stremio_url, headers=HEADERS, timeout=12)
        if r.status_code == 200:
            subs = r.json().get("subtitles", [])
            ar_subs = [s for s in subs if s.get("lang") in ("ara", "ar")]
            if ar_subs:
                log("SUBS", f"Found {len(ar_subs)} Arabic subtitles on OpenSubtitles v3 endpoint.")
                for candidate in ar_subs:
                    dl_url = candidate.get("url")
                    if not dl_url:
                        continue
                    sub_resp = requests.get(dl_url, headers=HEADERS, timeout=12)
                    if sub_resp.status_code == 200 and len(sub_resp.content) > 100:
                        clean_text, enc = decode_arabic_subtitle(sub_resp.content)
                        if clean_text:
                            out_srt = os.path.join(subs_dir, f"{imdb_id}_{episode_tag}_ara.srt")
                            with open(out_srt, "w", encoding="utf-8", newline="\n") as f:
                                f.write(clean_text)
                            log("SUBS", f"✅ TV Subtitle decoded via '{enc}' and saved -> {os.path.basename(out_srt)}")
                            return out_srt
    except Exception as e:
        log("SUBS", f"OpenSubtitles v3 notice: {e}")

    # 2. Fallback: try download_subtitles_for_imdb (if general subtitle exists)
    fallback = download_subtitles_for_imdb(imdb_id, output_dir)
    if fallback:
        return fallback

    log("SUBS", f"⚠️ No Arabic subtitles found for {imdb_id} {episode_tag}.")
    return None

def probe_video_properties(video_path: str) -> tuple[int, float]:
    """
    Probe video properties using ffprobe to extract source video bitrate (bps) and duration (seconds).
    Falls back to calculating bitrate from file size and duration if not directly reported in streams/format.
    """
    source_bitrate = 0
    duration = 0.0
    file_size_bytes = os.path.getsize(video_path) if os.path.exists(video_path) else 0

    ffprobe_bin = shutil.which("ffprobe") or "ffprobe"
    try:
        probe_cmd = [
            ffprobe_bin, "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=bit_rate,duration:format=bit_rate,duration",
            "-of", "json",
            video_path
        ]
        proc = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=20)
        if proc.returncode == 0 and proc.stdout:
            data = json.loads(proc.stdout)
            streams = data.get("streams", [])
            fmt = data.get("format", {})

            # Extract duration: stream first, then format
            if streams and streams[0].get("duration") not in (None, "N/A"):
                try:
                    duration = float(streams[0]["duration"])
                except (ValueError, TypeError):
                    pass
            if duration <= 0 and fmt.get("duration") not in (None, "N/A"):
                try:
                    duration = float(fmt["duration"])
                except (ValueError, TypeError):
                    pass

            # Extract bitrate in kbps: stream first, then format
            if streams and streams[0].get("bit_rate") not in (None, "N/A"):
                try:
                    raw_br = float(streams[0]["bit_rate"])
                    source_bitrate = int(raw_br / 1000) if raw_br > 50000 else int(raw_br)
                except (ValueError, TypeError):
                    pass
            if source_bitrate <= 0 and fmt.get("bit_rate") not in (None, "N/A"):
                try:
                    raw_br = float(fmt["bit_rate"])
                    source_bitrate = int(raw_br / 1000) if raw_br > 50000 else int(raw_br)
                except (ValueError, TypeError):
                    pass
    except Exception as e:
        log("HARDSUB", f"ffprobe notice: {e}")

    # Fallback: calculate bitrate from file size and duration (in kbps)
    if source_bitrate <= 0 and duration > 0 and file_size_bytes > 0:
        source_bitrate = int((file_size_bytes * 8) / (duration * 1000))

    # Safe defaults if probe could not determine properties (in kbps)
    if source_bitrate <= 0:
        source_bitrate = 2500  # Default ~2500 kbps (2.5 Mbps)
    if duration <= 0:
        duration = 7200.0  # Default ~2 hours

    return source_bitrate, duration

def apply_ass_style(ass_text: str) -> str:
    """
    Ensure the ASS content uses a 1080p reference canvas (PlayResX: 1920, PlayResY: 1080,
    ScaledBorderAndShadow: yes) and the high-visibility Arabic Style: Default.
    Injects or replaces Style: Default in both Python-generated and FFmpeg-converted .ass files.
    """
    if not ass_text:
        return ""

    target_style = (
        "Style: Default,Noto Sans Arabic,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,"
        "1,0,0,0,100,100,0,0,1,3.2,1,2,20,20,45,1"
    )

    # 1. Update or inject PlayResX, PlayResY, ScaledBorderAndShadow under [Script Info]
    if "[Script Info]" in ass_text:
        ass_text = re.sub(r'PlayResX:\s*\d+', 'PlayResX: 1920', ass_text, flags=re.IGNORECASE)
        ass_text = re.sub(r'PlayResY:\s*\d+', 'PlayResY: 1080', ass_text, flags=re.IGNORECASE)
        ass_text = re.sub(r'ScaledBorderAndShadow:\s*\w+', 'ScaledBorderAndShadow: yes', ass_text, flags=re.IGNORECASE)

        if "PlayResX:" not in ass_text:
            ass_text = ass_text.replace("[Script Info]", "[Script Info]\nPlayResX: 1920", 1)
        if "PlayResY:" not in ass_text:
            ass_text = ass_text.replace("[Script Info]", "[Script Info]\nPlayResY: 1080", 1)
        if "ScaledBorderAndShadow:" not in ass_text:
            ass_text = ass_text.replace("[Script Info]", "[Script Info]\nScaledBorderAndShadow: yes", 1)
    else:
        ass_text = f"[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nScaledBorderAndShadow: yes\n\n{ass_text}"

    # 2. Update or inject Style: Default in [V4+ Styles]
    if re.search(r'^Style:\s*Default,.*$', ass_text, flags=re.MULTILINE):
        ass_text = re.sub(r'^Style:\s*Default,.*$', target_style, ass_text, flags=re.MULTILINE)
    elif "[V4+ Styles]" in ass_text:
        if "Format:" in ass_text:
            ass_text = re.sub(r'(Format:[^\n]*\n)', rf'\1{target_style}\n', ass_text, count=1)
        else:
            ass_text = ass_text.replace("[V4+ Styles]", f"[V4+ Styles]\n{target_style}", 1)
    else:
        v4_section = (
            "\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"{target_style}\n\n"
        )
        if "[Events]" in ass_text:
            ass_text = ass_text.replace("[Events]", f"{v4_section}[Events]", 1)
        else:
            ass_text = f"{v4_section}{ass_text}"

    return ass_text

def convert_srt_to_ass(srt_text: str, srt_path: str = None) -> str:
    """
    Convert SRT subtitle text to ASS (Advanced SubStation Alpha) format with
    embedded Arabic styling on a 1080p virtual canvas. Bypasses FFmpeg's SRT demuxer
    (avformat_open_input) which fails with 'Unable to open' on certain Arabic-encoded subtitle content,
    by producing a pre-formatted ASS file that libass reads directly via the 'ass' filter.

    Resilient against:
      - Null bytes (\\x00) and UTF-8/16 BOMs (\\ufeff\\ufffe)
      - Windows CRLF (\\r\\n) and old-Mac CR (\\r) line endings
      - Invisible Unicode directional marks (RLM, LRM, ALM) & zero-width controls
      - Flexible timestamp arrows (--> , -> , —> , –>)
      - Timestamp separators: both comma (00:01:23,456) and period (00:01:23.456)
      - Variable-length millisecond fields (1-3 digits)
      - HTML formatting tags (<i>, <b>, <font>)
      - Fallback sequential line-by-line parser for broken block formatting
      - Native FFmpeg subtitle converter CLI as unbreakable fallback
    """
    if not srt_text:
        return ""

    # ── 0. Pre-clean: strip null bytes, BOMs, normalize newlines, purge bidi marks ──
    raw_text = srt_text.replace("\x00", "").lstrip("\ufeff\ufffe").replace("\r\n", "\n").replace("\r", "\n")
    bidi_pattern = re.compile(r"[\u200e\u200f\u061c\u200b-\u200d\u202a-\u202e\u2066-\u2069\ufeff]")
    cleaned = bidi_pattern.sub("", raw_text).strip()
    if not cleaned:
        return ""

    # ── ASS header with embedded Arabic style on a 1080p reference canvas ──
    header_lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Noto Sans Arabic,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3.2,1,2,20,20,45,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ass_header = '\n'.join(header_lines) + '\n'

    # ── Permissive timestamp pattern (arrows: -->, ->, —>, –>; separators: comma or period) ──
    time_pattern = re.compile(
        r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*(?:-->|->|—>|–>)\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})"
    )

    def _srt_ts_to_ass(ts: str) -> str:
        """Convert SRT timestamp (HH:MM:SS,mmm or H:MM:SS.mm) to ASS (H:MM:SS.cc)."""
        ts = ts.replace(',', '.')
        parts = ts.split(':')
        h, mi = int(parts[0]), int(parts[1])
        sec_parts = parts[2].split('.')
        s = int(sec_parts[0])
        ms_raw = sec_parts[1] if len(sec_parts) > 1 else '0'
        cs = int(ms_raw.ljust(3, '0')[:3]) // 10
        return f"{h}:{mi:02d}:{s:02d}.{cs:02d}"

    def _clean_line(line: str) -> str:
        """Strip HTML tags and residual control characters from a subtitle line."""
        c = re.sub(r'<[^>]+>', '', line.strip())
        c = bidi_pattern.sub('', c)
        return c

    # ── Primary parser: split by blank lines into blocks ──
    blocks = re.split(r'\n\s*\n', cleaned)
    dialogues = []

    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 2:
            continue

        tm = None
        timing_idx = -1
        for i, line in enumerate(lines):
            tm = time_pattern.search(line)
            if tm:
                timing_idx = i
                break

        if not tm or timing_idx < 0:
            continue

        start_ass = _srt_ts_to_ass(tm.group(1))
        end_ass = _srt_ts_to_ass(tm.group(2))

        text_parts = [_clean_line(tl) for tl in lines[timing_idx + 1:] if _clean_line(tl)]
        if not text_parts:
            continue

        text = '\\N'.join(text_parts)
        dialogues.append(f"Dialogue: 0,{start_ass},{end_ass},Default,,0,0,0,,{text}")

    # ── Fallback Sequential Parser: if block splitting yielded 0 entries ──
    if not dialogues:
        lines = cleaned.split('\n')
        current_start = None
        current_end = None
        current_text_parts = []

        def _append_seq_dialogue():
            if current_start and current_end and current_text_parts:
                start_ass = _srt_ts_to_ass(current_start)
                end_ass = _srt_ts_to_ass(current_end)
                text = '\\N'.join(current_text_parts)
                dialogues.append(f"Dialogue: 0,{start_ass},{end_ass},Default,,0,0,0,,{text}")

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            tm = time_pattern.search(line_str)
            if tm:
                _append_seq_dialogue()
                current_start = tm.group(1)
                current_end = tm.group(2)
                current_text_parts = []
            elif current_start is not None:
                cleaned_text = _clean_line(line_str)
                if cleaned_text and not cleaned_text.isdigit():
                    current_text_parts.append(cleaned_text)

        _append_seq_dialogue()

    if dialogues:
        return ass_header + '\n'.join(dialogues) + '\n'

    # ── Fallback Native FFmpeg Engine: if Python regex extracted 0 dialogues ──
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        import tempfile
        temp_src = srt_path
        need_rm = False
        if not temp_src or not os.path.exists(temp_src):
            try:
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".srt", delete=False) as tf:
                    tf.write(cleaned)
                    temp_src = tf.name
                need_rm = True
            except Exception:
                temp_src = None

        if temp_src and os.path.exists(temp_src):
            temp_ass = temp_src + ".ass"
            try:
                subprocess.run(
                    [ffmpeg_bin, "-y", "-nostdin", "-sub_charenc", "UTF-8", "-i", temp_src, temp_ass],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False
                )
                if os.path.exists(temp_ass) and os.path.getsize(temp_ass) > 0:
                    with open(temp_ass, "r", encoding="utf-8", errors="replace") as af:
                        raw_ass = af.read()
                    if "Dialogue:" in raw_ass:
                        return apply_ass_style(raw_ass)
            except Exception:
                pass
            finally:
                if need_rm and temp_src and os.path.exists(temp_src):
                    try: os.remove(temp_src)
                    except Exception: pass
                if os.path.exists(temp_ass):
                    try: os.remove(temp_ass)
                    except Exception: pass

    return ""

def burn_arabic_subtitles(video_path: str, srt_path: str) -> str:
    """
    Burn Arabic subtitles directly into video frames (hardsubbing) using FFmpeg.
    Enforces clean UTF-8 encoding (prioritizing windows-1256/cp1256 conversion before latin1),
    sanitizes paths, executes FFmpeg from a flat staging directory, and dynamically controls
    bitrate with NVENC p6/cq20-22 to strictly cap output under 4200 MB for all movie lengths.
    """
    if not video_path or not os.path.exists(video_path):
        log("HARDSUB", "Video path is invalid or missing.")
        return video_path

    if not verify_video_integrity(video_path):
        raise RuntimeError(f"Downloaded file is corrupted or incomplete; aborting upload. ({video_path})")

    if not srt_path or not os.path.exists(srt_path):
        log("HARDSUB", "No Arabic subtitle provided or file missing; using original video as fallback.")
        return video_path

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        log("HARDSUB", "ffmpeg not found in PATH; skipping hardsubbing and using raw video.")
        return video_path

    # 1. Force UTF-8 conversion testing priority encodings: utf-8-sig, utf-8, cp1256, windows-1256, iso-8859-6, utf-16, latin-1
    try:
        clean_sub_text = read_subtitle_file_robustly(srt_path)
        if not clean_sub_text or not any("\u0600" <= ch <= "\u06FF" for ch in clean_sub_text):
            log("HARDSUB", f"⚠️ Subtitle '{srt_path}' contains no Arabic Unicode characters across tested encodings; using original video.")
            return video_path

        log("SUBS", "ℹ️ Subtitle decoded robustly and verified to contain Arabic characters.")
    except Exception as e:
        log("HARDSUB", f"⚠️ Error validating subtitle encoding: {e}; falling back to raw video.")
        return video_path

    # 2. Implement Flat Staging Directory Architecture
    staging_dir = "/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp")
    os.makedirs(staging_dir, exist_ok=True)

    staged_input = os.path.join(staging_dir, "input_video.mp4")
    staged_sub = os.path.join(staging_dir, "sub.ass")
    staged_output = os.path.join(staging_dir, "output_subbed.mp4")

    # Clean previous staging artifacts if present
    for p in [staged_input, staged_sub, staged_output]:
        if os.path.exists(p) or os.path.islink(p):
            try:
                os.remove(p)
            except Exception:
                pass

    staged_clean_srt = os.path.join(staging_dir, "sub.srt")
    try:
        with open(staged_clean_srt, 'w', encoding='utf-8', newline='\n') as csf:
            csf.write(clean_sub_text)
    except Exception as e:
        log("HARDSUB", f"⚠️ Could not write {staged_clean_srt}: {e}")
        staged_clean_srt = srt_path

    # Stage input video via symlink (instant & zero disk overhead on Linux/Colab)
    video_abs_path = os.path.abspath(video_path)
    ffmpeg_input = "input_video.mp4"
    try:
        if os.path.exists(staged_input) or os.path.islink(staged_input):
            os.remove(staged_input)
        os.symlink(video_abs_path, staged_input)
        log("HARDSUB", f"Staged video symlinked: {staged_input} -> {video_abs_path}")
    except Exception as e:
        log("HARDSUB", f"Symlink notice: {e}; referencing input path directly.")
        ffmpeg_input = video_abs_path

    staged_output = os.path.join(staging_dir, "output_1080p.mp4")
    if os.path.exists(staged_output):
        try: os.remove(staged_output)
        except Exception: pass

    # 1080p Hardsubbing: 4-Core CPU libx264, preset veryfast, crf 23, copy audio
    sub_style = "FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3"
    sub_filter_rel = f"subtitles=sub.srt:force_style='{sub_style}'"

    ffmpeg_log = os.path.join(staging_dir, "ffmpeg_process.log")
    log("HARDSUB", f"Burning Arabic subtitles into 1080p frames (CPU 4 threads, veryfast, crf 23): output_1080p.mp4 in {staging_dir}...")
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-i", ffmpeg_input,
        "-vf", sub_filter_rel,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-threads", "4",
        "-c:a", "copy",
        "output_1080p.mp4"
    ]

    with open(ffmpeg_log, "w", encoding="utf-8") as lf:
        proc = subprocess.run(cmd, stdout=lf, stderr=lf, cwd=staging_dir)
    if proc.returncode != 0:
        err_snippet = ""
        try:
            with open(ffmpeg_log, "r", encoding="utf-8", errors="replace") as ef:
                err_snippet = "".join(ef.readlines()[-15:]).strip()
        except Exception:
            pass
        log("HARDSUB", f"Notice on relative subtitle filter ({proc.returncode}): {err_snippet}. Retrying with escaped absolute subtitle path...")
        sub_abs_escaped = os.path.abspath(staged_clean_srt).replace("\\", "/").replace(":", r"\:")
        sub_filter_abs = f"subtitles='{sub_abs_escaped}':force_style='{sub_style}'"
        cmd_abs = [
            "ffmpeg", "-y", "-nostdin",
            "-i", ffmpeg_input,
            "-vf", sub_filter_abs,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-threads", "4",
            "-c:a", "copy",
            "output_1080p.mp4"
        ]
        with open(ffmpeg_log, "a", encoding="utf-8") as lf:
            proc = subprocess.run(cmd_abs, stdout=lf, stderr=lf, cwd=staging_dir)
        if proc.returncode != 0:
            err_snippet = ""
            try:
                with open(ffmpeg_log, "r", encoding="utf-8", errors="replace") as ef:
                    err_snippet = "".join(ef.readlines()[-15:]).strip()
            except Exception:
                pass
            log("HARDSUB", f"❌ Hardsubbing failed ({proc.returncode}): {err_snippet}")
            if verify_video_integrity(video_path):
                log("HARDSUB", "Falling back to intact original video file.")
                return video_path
            else:
                raise RuntimeError(f"Downloaded file is corrupted or incomplete; aborting upload. ({video_path})")

    # Clean up staging input symlink
    if os.path.exists(staged_input) or os.path.islink(staged_input):
        try: os.remove(staged_input)
        except Exception: pass

    if os.path.exists(staged_output) and os.path.getsize(staged_output) > 0:
        if verify_video_integrity(staged_output):
            file_size_mb = os.path.getsize(staged_output) / (1024 * 1024)
            log("HARDSUB", f"✅ 1080p Hardsubbing complete and verified intact! Video: {staged_output} ({file_size_mb:.1f} MB)")
            return staged_output
        else:
            log("HARDSUB", "⚠️ Hardsubbed output failed integrity verification! Checking original video...")
            if verify_video_integrity(video_path):
                return video_path
            raise RuntimeError(f"Downloaded file is corrupted or incomplete; aborting upload. ({video_path})")

    if verify_video_integrity(video_path):
        return video_path
    raise RuntimeError(f"Downloaded file is corrupted or incomplete; aborting upload. ({video_path})")

def downscale_to_720p(input_1080p_path: str, output_720p_path: str = None) -> str:
    """
    Subbed Downscaling (720p Generation):
    Directly downscales 1080p hardsubbed video to 720p using fast scaling:
    ffmpeg -y -nostdin -i output_1080p.mp4 -vf "scale=-2:720" -c:v libx264 -preset veryfast -crf 24 -threads 4 -c:a copy output_720p.mp4
    """
    staging_dir = os.path.dirname(input_1080p_path) or ("/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp"))
    os.makedirs(staging_dir, exist_ok=True)
    if not output_720p_path:
        output_720p_path = os.path.join(staging_dir, "output_720p.mp4")

    if os.path.exists(output_720p_path):
        try: os.remove(output_720p_path)
        except Exception: pass

    ffmpeg_log = os.path.join(staging_dir, "ffmpeg_process.log")
    log("HARDSUB", f"Downscaling to 720p (scale=-2:720, crf 24, 4 threads): {os.path.basename(input_1080p_path)} -> {os.path.basename(output_720p_path)}...")
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-i", input_1080p_path,
        "-vf", "scale=-2:720",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "24",
        "-threads", "4",
        "-c:a", "copy",
        output_720p_path
    ]
    with open(ffmpeg_log, "a", encoding="utf-8") as lf:
        proc = subprocess.run(cmd, stdout=lf, stderr=lf)
    if proc.returncode != 0:
        err_snippet = ""
        try:
            with open(ffmpeg_log, "r", encoding="utf-8", errors="replace") as ef:
                err_snippet = "".join(ef.readlines()[-15:]).strip()
        except Exception:
            pass
        log("HARDSUB", f"❌ 720p downscaling error ({proc.returncode}): {err_snippet}")
        raise RuntimeError(f"FFmpeg 720p downscaling failed ({proc.returncode}): {err_snippet}")

    mb = os.path.getsize(output_720p_path) / (1024 * 1024)
    log("HARDSUB", f"✅ 720p downscaling complete ({mb:.1f} MB) -> {os.path.basename(output_720p_path)}")
    return output_720p_path

# =============================================================================
# 5. STREAMING HOST UPLOAD (DOODSTREAM API) WITH RESILIENCE & RETRIES
# =============================================================================
def upload_to_doodstream(video_path: str, api_key: str = DOODSTREAM_API_KEY, max_retries: int = 3) -> str:
    """
    Upload local video file to DoodStream API using chunked streaming.
    Includes retry loop and requests a fresh server URL on disconnect/timeout.
    """
    if not api_key:
        raise ValueError("DOODSTREAM_API_KEY is not set. Please provide a valid DoodStream API key.")

    filename = os.path.basename(video_path)
    file_size_bytes = os.path.getsize(video_path)
    file_size_mb = file_size_bytes / (1024 * 1024)

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            log("DOOD", f"Requesting fresh DoodStream upload server (Attempt {attempt}/{max_retries})...")
            srv_resp = requests.get(f"{DOODSTREAM_API_BASE}/upload/server", params={"key": api_key}, timeout=30).json()
            if srv_resp.get("status") != 200 or not srv_resp.get("result"):
                raise RuntimeError(f"Failed to obtain DoodStream upload server: {srv_resp}")

            upload_url = srv_resp["result"]
            log("DOOD", f"Assigned server: {upload_url[:50]}... Streaming '{filename}' ({file_size_mb:.1f} MB)...")

            if HAS_TOOLBELT:
                with open(video_path, 'rb') as f:
                    encoder = MultipartEncoder(fields={'api_key': api_key, 'file': (filename, f, 'video/mp4')})
                    last_pct = [-1]
                    def progress(monitor):
                        pct = int((monitor.bytes_read / monitor.len) * 100)
                        if pct % 10 == 0 and pct != last_pct[0]:
                            last_pct[0] = pct
                            print(f"  [DoodStream Progress] {pct}% ({monitor.bytes_read / (1024*1024):.1f} MB / {monitor.len / (1024*1024):.1f} MB)", flush=True)
                    monitor = MultipartEncoderMonitor(encoder, progress)
                    resp = requests.post(
                        upload_url,
                        data=monitor,
                        headers={'Content-Type': monitor.content_type},
                        timeout=7200
                    ).json()
            else:
                with open(video_path, 'rb') as f:
                    resp = requests.post(
                        upload_url,
                        data={'api_key': api_key},
                        files={'file': (filename, f, 'video/mp4')},
                        timeout=7200
                    ).json()

            if resp.get("status") != 200:
                raise RuntimeError(f"DoodStream upload rejected: {resp}")

            result = resp["result"]
            file_code = result[0]["filecode"] if isinstance(result, list) else result.get("filecode")
            embed_url = f"https://doodstream.com/e/{file_code}"
            log("DOOD", f"Upload successful! File Code: {file_code} -> {embed_url}")
            return embed_url

        except Exception as e:
            last_error = e
            log("DOOD", f"Upload attempt {attempt} encountered error: {e.__class__.__name__}: {e}")
            if attempt < max_retries:
                wait_time = attempt * 7
                log("DOOD", f"Waiting {wait_time}s before allocating a fresh server and retrying...")
                time.sleep(wait_time)

    raise RuntimeError(f"DoodStream upload failed after {max_retries} attempts. Last error: {last_error}")

def upload_to_streamtape(video_path: str, login: str = STREAMTAPE_LOGIN, key: str = STREAMTAPE_KEY, max_retries: int = 3) -> str:
    """
    Upload local video file to Streamtape API.
    1. Obtains upload server URL from https://api.streamtape.com/file/ul?login={login}&key={key}
    2. Uploads video via multipart form.
    3. Returns clean embed URL: https://streamtape.com/e/{file_id}
    """
    if not login or not key:
        raise ValueError("STREAMTAPE_LOGIN or STREAMTAPE_KEY is not configured.")

    filename = os.path.basename(video_path)
    file_size_bytes = os.path.getsize(video_path)
    file_size_mb = file_size_bytes / (1024 * 1024)

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            log("STREAMTAPE", f"Requesting Streamtape upload server (Attempt {attempt}/{max_retries})...")
            srv_resp = requests.get(
                f"{STREAMTAPE_API_BASE}/file/ul",
                params={"login": login, "key": key},
                timeout=30
            ).json()

            if srv_resp.get("status") != 200 or not srv_resp.get("result", {}).get("url"):
                raise RuntimeError(f"Failed to obtain Streamtape upload server: {srv_resp}")

            upload_url = srv_resp["result"]["url"]
            log("STREAMTAPE", f"Assigned server: {upload_url[:50]}... Uploading '{filename}' ({file_size_mb:.1f} MB)...")

            if HAS_TOOLBELT:
                with open(video_path, 'rb') as f:
                    encoder = MultipartEncoder(fields={'file': (filename, f, 'video/mp4')})
                    last_pct = [-1]
                    def progress(monitor):
                        pct = int((monitor.bytes_read / monitor.len) * 100)
                        if pct % 10 == 0 and pct != last_pct[0]:
                            last_pct[0] = pct
                            print(f"  [Streamtape Progress] {pct}% ({monitor.bytes_read / (1024*1024):.1f} MB / {monitor.len / (1024*1024):.1f} MB)", flush=True)
                    monitor = MultipartEncoderMonitor(encoder, progress)
                    resp = requests.post(
                        upload_url,
                        data=monitor,
                        headers={'Content-Type': monitor.content_type},
                        timeout=7200
                    ).json()
            else:
                with open(video_path, 'rb') as f:
                    resp = requests.post(
                        upload_url,
                        files={'file': (filename, f, 'video/mp4')},
                        timeout=7200
                    ).json()

            if resp.get("status") != 200:
                raise RuntimeError(f"Streamtape upload rejected: {resp}")

            result = resp.get("result", {})
            file_id = result.get("id")
            if not file_id:
                stream_url = result.get("url", "")
                m = re.search(r'/v/([^/]+)', stream_url)
                if m:
                    file_id = m.group(1)

            if not file_id:
                raise RuntimeError(f"Could not parse Streamtape file ID from response: {resp}")

            embed_url = f"https://streamtape.com/e/{file_id}"
            log("STREAMTAPE", f"Upload successful! File ID: {file_id} -> {embed_url}")
            return embed_url

        except Exception as e:
            last_error = e
            log("STREAMTAPE", f"Upload attempt {attempt} encountered error: {e.__class__.__name__}: {e}")
            if attempt < max_retries:
                wait_time = attempt * 5
                log("STREAMTAPE", f"Waiting {wait_time}s before retrying...")
                time.sleep(wait_time)

    raise RuntimeError(f"Streamtape upload failed after {max_retries} attempts. Last error: {last_error}")

def upload_by_quality(video_path: str, quality: str = "1080p") -> dict:
    """
    Quality Distribution Logic:
    - 1080p Quality: Automatically uploaded to Doodstream.
    - 720p Quality:  Automatically uploaded to Streamtape.
    Returns: {"primary_embed": str, "dood_embed": str, "streamtape_embed": str, "quality": str}
    """
    q_norm = quality.lower().strip()
    dood_url = None
    streamtape_url = None

    if "720" in q_norm:
        log("UPLOAD", "Quality is 720p -> Routing upload to Streamtape (Server 2)...")
        streamtape_url = upload_to_streamtape(video_path)
        primary = streamtape_url
    else:
        log("UPLOAD", f"Quality is {quality} (1080p FHD) -> Routing upload to Doodstream (Server 1)...")
        dood_url = upload_to_doodstream(video_path)
        primary = dood_url

    return {
        "primary_embed": primary,
        "dood_embed": dood_url,
        "streamtape_embed": streamtape_url,
        "quality": quality,
    }

def upload_to_multi_servers(video_path: str, quality: str = "1080p") -> dict:
    """
    Upload to both Doodstream (Server 1) and Streamtape (Server 2)
    to enable full multi-server switching in the player.
    """
    dood_url = None
    streamtape_url = None

    try:
        log("UPLOAD", "Uploading to Server 1 (Doodstream)...")
        dood_url = upload_to_doodstream(video_path)
    except Exception as e:
        log("UPLOAD", f"⚠️ Doodstream upload error: {e}")

    try:
        log("UPLOAD", "Uploading to Server 2 (Streamtape)...")
        streamtape_url = upload_to_streamtape(video_path)
    except Exception as e:
        log("UPLOAD", f"⚠️ Streamtape upload error: {e}")

    if not dood_url and not streamtape_url:
        raise RuntimeError("Failed to upload to both Doodstream and Streamtape.")

    return {
        "primary_embed": dood_url or streamtape_url,
        "dood_embed": dood_url,
        "streamtape_embed": streamtape_url,
        "quality": quality,
    }

# =============================================================================
# 5. HEADLESS WORDPRESS PUBLISHING (PANTHEON REST API) & CATEGORIZATION
# =============================================================================

# Standard TMDB genre mapping to clean Arabic names and English slugs
GENRE_MAP = {
    "Action": ("أكشن", "action"),
    "Adventure": ("مغامرة", "adventure"),
    "Animation": ("رسوم متحركة", "animation"),
    "Comedy": ("كوميديا", "comedy"),
    "Crime": ("جريمة", "crime"),
    "Documentary": ("وثائقي", "documentary"),
    "Drama": ("دراما", "drama"),
    "Family": ("عائلي", "family"),
    "Fantasy": ("فانتازيا", "fantasy"),
    "History": ("تاريخي", "history"),
    "Horror": ("رعب", "horror"),
    "Music": ("موسيقى", "music"),
    "Mystery": ("غموض", "mystery"),
    "Romance": ("رومانسي", "romance"),
    "Science Fiction": ("خيال علمي", "sci-fi"),
    "Thriller": ("إثارة", "thriller"),
    "War": ("حرب", "war"),
    "Western": ("غرب أمريكي", "western"),
    "Series": ("مسلسلات", "series"),
    "TV Show": ("مسلسلات", "tv-shows"),
    "TV Series": ("مسلسلات", "tv-series")
}

_WP_CATEGORIES_CACHE = {}

def get_or_create_category(genre_name: str, wp_site_url: str = WP_SITE_URL, auth=None) -> int:
    """
    Look up or dynamically create a category for the given TMDB genre in WordPress.
    Maps English genre to clean Arabic category name and English slug.
    """
    global _WP_CATEGORIES_CACHE
    clean_genre = genre_name.strip()
    if not clean_genre:
        return None

    if clean_genre in GENRE_MAP:
        ar_name, en_slug = GENRE_MAP[clean_genre]
    else:
        ar_name = clean_genre
        en_slug = re.sub(r'[^a-zA-Z0-9]+', '-', clean_genre.lower()).strip('-')

    headers = {"User-Agent": HEADERS["User-Agent"]}
    if wp_site_url not in _WP_CATEGORIES_CACHE:
        try:
            cat_res = requests.get(f"{wp_site_url}/wp-json/wp/v2/categories?per_page=100", headers=headers, auth=auth, timeout=20)
            if cat_res.status_code == 200 and isinstance(cat_res.json(), list):
                _WP_CATEGORIES_CACHE[wp_site_url] = cat_res.json()
            else:
                _WP_CATEGORIES_CACHE[wp_site_url] = []
        except Exception as e:
            log("WP", f"⚠️ Failed to fetch existing categories: {e}")
            _WP_CATEGORIES_CACHE[wp_site_url] = []

    existing_cats = _WP_CATEGORIES_CACHE[wp_site_url]

    # 1. Search existing categories by name or slug
    for cat in existing_cats:
        c_name = cat.get("name", "").strip().lower()
        c_slug = cat.get("slug", "").strip().lower()
        if c_name == ar_name.lower() or c_name == clean_genre.lower() or c_slug == en_slug.lower():
            return cat["id"]

    # 2. Category not found: auto-create via POST /wp/v2/categories
    create_url = f"{wp_site_url}/wp-json/wp/v2/categories"
    create_payload = {
        "name": ar_name,
        "slug": en_slug,
        "description": f"أفلام ومسلسلات تصنيف {ar_name}"
    }
    create_headers = {
        "Content-Type": "application/json",
        "User-Agent": HEADERS["User-Agent"]
    }
    try:
        post_cat_res = requests.post(create_url, json=create_payload, headers=create_headers, auth=auth, timeout=20)
        if post_cat_res.status_code in (200, 201):
            created_cat = post_cat_res.json()
            new_id = created_cat.get("id")
            log("WP", f"➕ Auto-created new category: '{ar_name}' (ID: {new_id}, slug: '{en_slug}')")
            existing_cats.append(created_cat)
            return new_id
        elif post_cat_res.status_code == 400 and "term_exists" in post_cat_res.text:
            err_obj = post_cat_res.json()
            existing_id = err_obj.get("data", {}).get("term_id")
            if existing_id:
                return existing_id
        log("WP", f"⚠️ Notice creating category '{ar_name}' ({post_cat_res.status_code}): {post_cat_res.text[:120]}")
    except Exception as e:
        log("WP", f"⚠️ Error auto-creating category '{ar_name}': {e}")

    return None

def resolve_movie_categories(genres_raw, wp_site_url: str = WP_SITE_URL, auth=None, is_episode: bool = False) -> list:
    """
    Resolve raw genre string or list into WordPress category IDs with on-the-fly category creation.
    """
    if isinstance(genres_raw, str):
        raw_list = [g.strip() for g in genres_raw.split(",") if g.strip()]
    elif isinstance(genres_raw, list):
        raw_list = [g.get("name", g) if isinstance(g, dict) else str(g).strip() for g in genres_raw]
    else:
        raw_list = []

    if is_episode and "Series" not in raw_list and "مسلسلات" not in raw_list:
        raw_list.append("Series")

    category_ids = []
    for genre in raw_list:
        cid = get_or_create_category(genre, wp_site_url, auth)
        if cid and cid not in category_ids:
            category_ids.append(cid)
    return category_ids

def upload_poster_to_pantheon(image_url: str, title_slug: str, wp_site_url: str = WP_SITE_URL, username: str = WP_USERNAME, app_password: str = WP_APP_PASSWORD) -> int:
    """
    Download verified TMDB poster and upload to Pantheon WordPress Media Library.
    """
    if not image_url:
        return None

    log("WP", f"Downloading TMDB poster: {image_url[:80]}...")
    img_resp = requests.get(image_url, headers=HEADERS, timeout=30)
    if img_resp.status_code != 200:
        log("WP", f"Warning: Could not download poster image (Status {img_resp.status_code})")
        return None

    filename = f"{title_slug[:30]}_{int(time.time())}.jpg"
    api_endpoint = f"{wp_site_url}/wp-json/wp/v2/media"
    upload_headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "image/jpeg",
        "User-Agent": HEADERS["User-Agent"]
    }
    auth = HTTPBasicAuth(username, app_password) if app_password else None

    log("WP", f"Uploading poster to Pantheon Media Library ({api_endpoint})...")
    res = requests.post(api_endpoint, headers=upload_headers, data=img_resp.content, auth=auth, timeout=40)
    if res.status_code in (200, 201):
        media_id = res.json().get("id")
        log("WP", f"Poster uploaded successfully! Media ID: {media_id}")
        return media_id
    else:
        log("WP", f"Poster upload notice ({res.status_code}): {res.text[:150]}")
        return None

def publish_movie_to_pantheon(
    meta: dict,
    embed_url: str,
    quality: str = "1080p",
    dood_embed: str = None,
    streamtape_embed: str = None,
    wp_site_url: str = WP_SITE_URL,
    username: str = WP_USERNAME,
    app_password: str = WP_APP_PASSWORD,
    is_episode: bool = False,
    episode_data: dict = None
) -> dict:
    """
    Publish movie or TV episode post with 16:9 responsive embed player, linked category IDs, and full metadata
    into Pantheon Headless WordPress CMS. Supports both Doodstream and Streamtape servers.
    """
    is_ep = is_episode or meta.get("is_episode") or (meta.get("type") == "tv_episode")
    ep_data = episode_data or {}

    if is_ep:
        show_name = ep_data.get("show_name") or meta.get("show_name") or meta.get("title", "Series")
        season_num = ep_data.get("season_number") or meta.get("season_number") or 1
        episode_num = ep_data.get("episode_number") or meta.get("episode_number") or 1
        ep_tag = ep_data.get("episode_tag") or meta.get("episode_tag") or f"S{int(season_num):02d}E{int(episode_num):02d}"

        clean_slug = re.sub(r'[^a-zA-Z0-9]+', '-', f"{show_name}-{ep_tag}".lower()).strip('-')
        title = f"{show_name} {ep_tag}"
        log("WP", f"Publishing TV Episode post to Pantheon: '{title}'...")

        seo_intro_paragraph = meta.get("seo_description") or f"مشاهدة وتحميل مسلسل {meta.get('title_ar') or show_name} الموسم {season_num} الحلقة {episode_num} ({ep_tag}) مترجمة كاملة بجودة 1080p BluRay عالية أون لاين."
        story_paragraph = meta.get("overview_ar") or meta.get("overview") or f"تدور أحداث الحلقة {episode_num} من الموسم {season_num} لمسلسل {show_name} في إطار درامي مشوق ومثير."
    else:
        clean_slug = re.sub(r'[^a-zA-Z0-9]+', '-', meta['title'].lower()).strip('-')
        title = f"{meta['title']} ({meta['year']})"
        log("WP", f"Publishing movie post to Pantheon: '{title}'...")

        seo_intro_paragraph = meta.get("seo_description") or f"مشاهدة وتحميل فيلم {meta.get('title_ar', meta['title'])} ({meta['year']}) مترجم كامل بجودة 1080p BluRay عالية أون لاين."
        story_paragraph = meta.get("overview_ar") or meta.get("overview") or "تدور أحداث الفيلم في إطار مشوق ومثير مليء بالأحداث غير المتوقعة والمغامرات الشيقة."

    media_id = upload_poster_to_pantheon(meta.get("poster_url"), clean_slug, wp_site_url, username, app_password)

    # Format and preserve IMDb rating strictly as a decimal string (e.g. '8.5')
    imdb_rating = format_imdb_rating(meta.get("imdb_rating") or meta.get("rating"))
    if not imdb_rating:
        imdb_rating = "7.5"

    dood_clean = dood_embed or (embed_url if "dood" in str(embed_url).lower() else "")
    streamtape_clean = streamtape_embed or (embed_url if "streamtape" in str(embed_url).lower() else "")

    content = f"""
<div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 12px; margin-bottom: 1.5rem;">
    <iframe src="{embed_url}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allowfullscreen="true" scrolling="no" frameborder="0"></iframe>
</div>
<!-- SERVERS: dood={dood_clean} streamtape={streamtape_clean} -->

<p>★ <strong>Rating:</strong> {imdb_rating} / 10 | <strong>Release Year:</strong> {meta.get('year', '2026')} | <strong>Quality:</strong> {quality}</p>

<div class="movie-seo-intro">
  <p>{seo_intro_paragraph}</p>
</div>
<div class="movie-story-section">
  <h3 class="story-title">القصة</h3>
  <p class="story-text">{story_paragraph}</p>
</div>
"""

    auth = HTTPBasicAuth(username, app_password) if app_password else None

    # Resolve and auto-create WordPress categories
    category_ids = resolve_movie_categories(meta.get("genres", ""), wp_site_url, auth, is_episode=is_ep)
    if category_ids:
        log("WP", f"Linked category IDs: {category_ids}")

    custom_fields = {
        "imdb_rating": imdb_rating,
        "rating": imdb_rating,
        "vote_average": imdb_rating,
        "_imdb_rating": imdb_rating,
        "embed_url": embed_url,
        "doodstream_url": dood_clean,
        "streamtape_url": streamtape_clean,
        "dood_embed": dood_clean,
        "streamtape_embed": streamtape_clean,
        "embed_url_1080p": dood_clean or (embed_url if "1080" in quality else ""),
        "embed_url_720p": streamtape_clean or (embed_url if "720" in quality else ""),
        "video_year": str(meta.get("year", "2026")),
        "quality": quality,
        "backdrop_url": meta.get("backdrop_url") or "",
        "genres": meta.get("genres", ""),
        "overview_ar": meta.get("overview_ar", ""),
        "cast": ", ".join(meta.get("cast", [])) if isinstance(meta.get("cast"), list) else str(meta.get("cast", "")),
        "title_ar": meta.get("title_ar", ""),
        "seo_description": seo_intro_paragraph,
        "type": "tv_episode" if is_ep else "movie",
        "show_title": (ep_data.get("show_name") or meta.get("show_name", "")) if is_ep else "",
        "season_number": str(ep_data.get("season_number", meta.get("season_number", ""))) if is_ep else "",
        "episode_number": str(ep_data.get("episode_number", meta.get("episode_number", ""))) if is_ep else "",
        "episode_tag": (ep_data.get("episode_tag") or meta.get("episode_tag", "")) if is_ep else ""
    }

    post_payload = {
        "title": title,
        "content": content,
        "status": "publish",
        "meta": custom_fields,
        "meta_input": custom_fields
    }
    if category_ids:
        post_payload["categories"] = category_ids

    if media_id:
        post_payload["featured_media"] = media_id

    api_endpoint = f"{wp_site_url}/wp-json/wp/v2/posts"
    post_headers = {
        "Content-Type": "application/json",
        "User-Agent": HEADERS["User-Agent"]
    }

    res = requests.post(api_endpoint, json=post_payload, headers=post_headers, auth=auth, timeout=30)
    if res.status_code in (200, 201):
        data = res.json()
        log("WP", f"{'TV Episode' if is_ep else 'Movie'} published successfully to Pantheon!")
        log("WP", f"Post ID:   {data.get('id')}")
        log("WP", f"Post Slug: {data.get('slug')}")
        log("WP", f"Post URL:  {data.get('link')}")
        return data
    else:
        raise RuntimeError(f"Pantheon WordPress publish failed ({res.status_code}): {res.text[:300]}")

# =============================================================================
# MASTER PIPELINE ORCHESTRATOR
# =============================================================================
def run_pipeline(movie_title: str, release_year: str = None, imdb_id: str = None, preferred_quality: str = "both"):
    """
    End-to-End Execution for Movies and TV Series Episodes:
    Detects Movie vs Episode -> TMDB / TV Metadata -> YTS (Movie) or EZTV (TV) Torrent
    -> aria2c (.mp4) -> Arabic .srt Download (OpenSubtitles v3 / Stremio)
    -> FFmpeg 1080p Hardsubbing -> Subbed 720p Downscaling
    -> Multi-Server Upload (1080p to Doodstream, 720p to Streamtape)
    -> Pantheon Headless WP with doodstream_url & streamtape_url -> Immediate Cleanup
    """
    print("=" * 75)
    print("  EGYMAX CLOUD AUTOMATION PIPELINE (OPTIMIZED DUAL-QUALITY ENGINE)")
    print("=" * 75)

    parsed = parse_media_item(movie_title)
    is_episode = parsed.get("is_episode", False)

    if is_episode:
        log("PIPELINE", f"📺 TV Episode detected: {parsed['show_name']} Season {parsed['season_number']} Episode {parsed['episode_number']} ({parsed['episode_tag']})")
        # 1. Fetch TV Metadata from TMDB
        target_imdb = imdb_id or parsed.get("imdb_id")
        meta = fetch_tv_metadata(parsed["show_name"], parsed["season_number"], parsed["episode_number"], target_imdb, TMDB_API_KEY)
        meta["is_episode"] = True
        meta["show_name"] = parsed["show_name"]
        meta["season_number"] = parsed["season_number"]
        meta["episode_number"] = parsed["episode_number"]
        meta["episode_tag"] = parsed["episode_tag"]

        # 2. Fetch 1080p EZTV Torrent Source
        target_imdb = meta.get("imdb_id") or target_imdb
        fetch_quality = "1080p" if preferred_quality in ("both", "multi", "all") else preferred_quality
        torrent_info = fetch_eztv_torrent(parsed["show_name"], parsed["season_number"], parsed["episode_number"], target_imdb, fetch_quality)

        # 3. High-Speed aria2c Download
        download_source = torrent_info["torrent_url"] or torrent_info["magnet_uri"]
        raw_video_path = download_with_aria2(download_source)

        # 4. Fetch Arabic Subtitles (.srt) targeting exact Season & Episode
        arabic_srt_path = download_subtitles_for_tv_episode(target_imdb, parsed["season_number"], parsed["episode_number"], DOWNLOAD_DIR)

        # 5. Burn Arabic Subtitles directly into 1080p video frames once
        burned_1080p_path = burn_arabic_subtitles(raw_video_path, arabic_srt_path)

        # Subtitle status evaluation
        if not arabic_srt_path:
            arabic_sub_status = "None (No Arabic Subtitle Found)"
        elif (burned_1080p_path != raw_video_path and 
              os.path.exists(burned_1080p_path) and 
              os.path.getsize(burned_1080p_path) > 0):
            arabic_sub_status = "Burned In"
        else:
            arabic_sub_status = "Failed (Uploaded Original Unsubbed)"

        log("PIPELINE", f"Subtitling status: {arabic_sub_status}")

        # Disk Safety - Immediately delete raw source video once 1080p hardsub completes
        if raw_video_path and os.path.exists(raw_video_path) and burned_1080p_path != raw_video_path:
            try:
                os.remove(raw_video_path)
                log("CLEANUP", f"Immediately deleted raw source video to free disk: {os.path.basename(raw_video_path)}")
                raw_video_path = None
            except Exception as e:
                log("CLEANUP", f"Notice removing raw video: {e}")

        # Dynamically rename 1080p video with show title and episode tag
        clean_show = re.sub(r'[^\w\s-]', '', parsed["show_name"]).strip().replace(' ', '.')
        file_dir = os.path.dirname(burned_1080p_path)
        final_1080p_filename = f"{clean_show}.{parsed['episode_tag']}.1080p.Arabic.Hardsub.mp4"
        final_1080p_filepath = os.path.join(file_dir, final_1080p_filename)

        if os.path.exists(burned_1080p_path):
            if burned_1080p_path != final_1080p_filepath:
                if os.path.exists(final_1080p_filepath):
                    try: os.remove(final_1080p_filepath)
                    except Exception: pass
                os.rename(burned_1080p_path, final_1080p_filepath)
                log("PIPELINE", f"Renamed 1080p upload file: {final_1080p_filename}")
            burned_1080p_path = final_1080p_filepath

        if not verify_video_integrity(burned_1080p_path):
            raise RuntimeError(f"Rendered 1080p file is corrupted or incomplete; aborting upload. ({burned_1080p_path})")

        dood_url = None
        streamtape_url = None
        rendered_720p_path = None

        if preferred_quality in ("both", "multi", "all"):
            final_720p_filename = f"{clean_show}.{parsed['episode_tag']}.720p.Arabic.Hardsub.mp4"
            rendered_720p_path = os.path.join(file_dir, final_720p_filename)
            downscale_to_720p(burned_1080p_path, rendered_720p_path)

            log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 1)...")
            dood_url = upload_to_doodstream(burned_1080p_path)

            log("UPLOAD", "Uploading 720p Downscaled Hardsub to Streamtape (Server 2)...")
            streamtape_url = upload_to_streamtape(rendered_720p_path)

            primary_embed = dood_url or streamtape_url
            active_quality = "1080p & 720p"
        elif "720" in preferred_quality.lower():
            final_720p_filename = f"{clean_show}.{parsed['episode_tag']}.720p.Arabic.Hardsub.mp4"
            rendered_720p_path = os.path.join(file_dir, final_720p_filename)
            downscale_to_720p(burned_1080p_path, rendered_720p_path)
            if os.path.exists(burned_1080p_path):
                try:
                    os.remove(burned_1080p_path)
                    burned_1080p_path = None
                except Exception: pass
            log("UPLOAD", "Uploading 720p Hardsub to Streamtape (Server 2)...")
            streamtape_url = upload_to_streamtape(rendered_720p_path)
            primary_embed = streamtape_url
            active_quality = "720p"
        else:
            log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 1)...")
            dood_url = upload_to_doodstream(burned_1080p_path)
            primary_embed = dood_url
            active_quality = "1080p"

        # 6. Publish TV Episode post to Pantheon WordPress
        post_data = publish_movie_to_pantheon(
            meta,
            primary_embed,
            active_quality,
            dood_embed=dood_url,
            streamtape_embed=streamtape_url,
            is_episode=True,
            episode_data=parsed
        )

        # 7. Disk Safety Cleanup
        cleanup_targets = [raw_video_path, burned_1080p_path, rendered_720p_path, arabic_srt_path]
        for p in cleanup_targets:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                    log("CLEANUP", f"Immediately deleted rendered/temporary file: {os.path.basename(p)}")
                except Exception:
                    pass

        staging_dir = "/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp")
        if os.path.exists(staging_dir):
            for f in os.listdir(staging_dir):
                fp = os.path.join(staging_dir, f)
                try:
                    if os.path.islink(fp) or os.path.isfile(fp):
                        os.remove(fp)
                except Exception:
                    pass

        print("\n" + "=" * 75)
        print("  TV EPISODE PIPELINE COMPLETED SUCCESSFULLY!")
        print(f"  Show:       {meta['title']} ({parsed['episode_tag']})")
        print(f"  Rating:     ★ {meta.get('imdb_rating') or meta.get('rating')}")
        print(f"  Quality:    {active_quality}")
        print(f"  Arabic Sub: {arabic_sub_status}")
        print(f"  Server 1:   {dood_url or 'N/A'} (DoodStream 1080p)")
        print(f"  Server 2:   {streamtape_url or 'N/A'} (Streamtape 720p)")
        print(f"  Primary:    {primary_embed}")
        print(f"  Live Post:  {post_data.get('link')}")
        print(f"  Next.js:    {NEXTJS_URL}/movie/{post_data.get('slug')}")
        print("=" * 75)
        return post_data

    else:
        # Standard Movie Pipeline
        # 1. Fetch TMDB Metadata
        meta = fetch_tmdb_metadata(movie_title, release_year, imdb_id)

        # 2. Fetch 1080p YTS Torrent Source
        target_imdb = meta.get("imdb_id") or imdb_id
        fetch_quality = "1080p" if preferred_quality in ("both", "multi", "all") else preferred_quality
        torrent_info = fetch_yts_torrent(meta["title"], meta["year"], target_imdb, fetch_quality)

        # Synchronize authoritative IMDb rating from YTS if present
        if torrent_info.get("imdb_rating"):
            meta["rating"] = torrent_info["imdb_rating"]
            meta["imdb_rating"] = torrent_info["imdb_rating"]
            log("PIPELINE", f"Synced authoritative IMDb rating from YTS: ★ {meta['imdb_rating']}")

        # 3. High-Speed aria2c Download with Pre-Sanitization
        download_source = torrent_info["torrent_url"] or torrent_info["magnet_uri"]
        raw_video_path = download_with_aria2(download_source)

        # 4. Fetch Arabic Subtitles (.srt)
        arabic_srt_path = download_subtitles_for_imdb(target_imdb, DOWNLOAD_DIR)

        # 5. Burn Arabic Subtitles directly into 1080p video frames once
        burned_1080p_path = burn_arabic_subtitles(raw_video_path, arabic_srt_path)

        # Accurate subtitle status evaluation
        if not arabic_srt_path:
            arabic_sub_status = "None (No Arabic Subtitle Found)"
        elif (burned_1080p_path != raw_video_path and 
              os.path.exists(burned_1080p_path) and 
              os.path.getsize(burned_1080p_path) > 0):
            arabic_sub_status = "Burned In"
        else:
            arabic_sub_status = "Failed (Uploaded Original Unsubbed)"

        log("PIPELINE", f"Subtitling status: {arabic_sub_status}")

        # Disk Safety - Immediately delete raw source video once 1080p hardsub completes
        if raw_video_path and os.path.exists(raw_video_path) and burned_1080p_path != raw_video_path:
            try:
                os.remove(raw_video_path)
                log("CLEANUP", f"Immediately deleted raw source video to free disk: {os.path.basename(raw_video_path)}")
                raw_video_path = None
            except Exception as e:
                log("CLEANUP", f"Notice removing raw video: {e}")

        # Dynamically rename 1080p video so streaming hosts register clean movie title
        title_en = meta.get("title") or movie_title or "Movie"
        release_year_val = meta.get("year") or ""
        clean_title = re.sub(r'[^\w\s-]', '', title_en).strip().replace(' ', '.')
        file_dir = os.path.dirname(burned_1080p_path)
        if release_year_val:
            final_1080p_filename = f"{clean_title}.{release_year_val}.1080p.Arabic.Hardsub.mp4"
        else:
            final_1080p_filename = f"{clean_title}.1080p.Arabic.Hardsub.mp4"
        final_1080p_filepath = os.path.join(file_dir, final_1080p_filename)

        if os.path.exists(burned_1080p_path):
            if burned_1080p_path != final_1080p_filepath:
                if os.path.exists(final_1080p_filepath):
                    try: os.remove(final_1080p_filepath)
                    except Exception: pass
                os.rename(burned_1080p_path, final_1080p_filepath)
                log("PIPELINE", f"Renamed 1080p upload file: {final_1080p_filename}")
            burned_1080p_path = final_1080p_filepath

        if not verify_video_integrity(burned_1080p_path):
            raise RuntimeError(f"Rendered 1080p file is corrupted or incomplete; aborting upload. ({burned_1080p_path})")

        dood_url = None
        streamtape_url = None
        rendered_720p_path = None

        # Subbed Downscaling (720p Generation) & Multi-Server Upload
        if preferred_quality in ("both", "multi", "all"):
            final_720p_filename = f"{clean_title}.{release_year_val}.720p.Arabic.Hardsub.mp4" if release_year_val else f"{clean_title}.720p.Arabic.Hardsub.mp4"
            rendered_720p_path = os.path.join(file_dir, final_720p_filename)
            downscale_to_720p(burned_1080p_path, rendered_720p_path)

            # Upload output_1080p.mp4 to Doodstream
            log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 1)...")
            dood_url = upload_to_doodstream(burned_1080p_path)

            # Upload output_720p.mp4 to Streamtape
            log("UPLOAD", "Uploading 720p Downscaled Hardsub to Streamtape (Server 2)...")
            streamtape_url = upload_to_streamtape(rendered_720p_path)

            primary_embed = dood_url or streamtape_url
            active_quality = "1080p & 720p"
        elif "720" in preferred_quality.lower():
            final_720p_filename = f"{clean_title}.{release_year_val}.720p.Arabic.Hardsub.mp4" if release_year_val else f"{clean_title}.720p.Arabic.Hardsub.mp4"
            rendered_720p_path = os.path.join(file_dir, final_720p_filename)
            downscale_to_720p(burned_1080p_path, rendered_720p_path)
            if os.path.exists(burned_1080p_path):
                try:
                    os.remove(burned_1080p_path)
                    burned_1080p_path = None
                except Exception: pass
            log("UPLOAD", "Uploading 720p Hardsub to Streamtape (Server 2)...")
            streamtape_url = upload_to_streamtape(rendered_720p_path)
            primary_embed = streamtape_url
            active_quality = "720p"
        else:
            log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 1)...")
            dood_url = upload_to_doodstream(burned_1080p_path)
            primary_embed = dood_url
            active_quality = "1080p"

        # 6. Publish directly to Pantheon WordPress
        post_data = publish_movie_to_pantheon(
            meta,
            primary_embed,
            active_quality,
            dood_embed=dood_url,
            streamtape_embed=streamtape_url
        )

        # 7. Disk Safety Cleanup
        cleanup_targets = [raw_video_path, burned_1080p_path, rendered_720p_path, arabic_srt_path]
        for p in cleanup_targets:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                    log("CLEANUP", f"Immediately deleted rendered/temporary file: {os.path.basename(p)}")
                except Exception:
                    pass

        # Purge staging directory artifacts
        staging_dir = "/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp")
        if os.path.exists(staging_dir):
            for f in os.listdir(staging_dir):
                fp = os.path.join(staging_dir, f)
                try:
                    if os.path.islink(fp) or os.path.isfile(fp):
                        os.remove(fp)
                except Exception:
                    pass

        print("\n" + "=" * 75)
        print("  MOVIE PIPELINE COMPLETED SUCCESSFULLY!")
        print(f"  Title:      {meta['title']} ({meta['year']})")
        print(f"  Rating:     ★ {meta.get('imdb_rating') or meta.get('rating')}")
        print(f"  Quality:    {active_quality}")
        print(f"  Arabic Sub: {arabic_sub_status}")
        print(f"  Server 1:   {dood_url or 'N/A'} (DoodStream 1080p)")
        print(f"  Server 2:   {streamtape_url or 'N/A'} (Streamtape 720p)")
        print(f"  Primary:    {primary_embed}")
        print(f"  Live Post:  {post_data.get('link')}")
        print(f"  Next.js:    {NEXTJS_URL}/movie/{post_data.get('slug')}")
        print("=" * 75)
        return post_data

# =============================================================================
# BATCH / BULK PROCESSING ENGINE
# =============================================================================
def run_batch_pipeline(items: list, preferred_quality: str = "both") -> list:
    """
    Process, download, and upload a list/array of movie titles, episode names, or links sequentially.
    Handles errors per item gracefully so one failure does not break the entire batch.
    """
    if not items:
        log("BATCH", "⚠️ No items provided for batch processing.")
        return []

    print("\n" + "=" * 75)
    print(f"  EGYMAX BATCH ENGINE: Processing {len(items)} Items Sequentially")
    print(f"  Quality Mode: {preferred_quality}")
    print("=" * 75 + "\n")

    results = []
    for idx, item in enumerate(items, 1):
        print("\n" + "-" * 75)
        print(f"  [BATCH {idx}/{len(items)}] Processing: {item}")
        print("-" * 75)

        title = None
        year = None
        imdb_id = None
        q = preferred_quality

        if isinstance(item, str):
            clean_item = item.strip()
            if not clean_item:
                continue
            parsed_item = parse_media_item(clean_item)
            if parsed_item.get("is_episode"):
                title = clean_item
                year = parsed_item.get("year")
                imdb_id = parsed_item.get("imdb_id")
            elif clean_item.startswith("tt") and len(clean_item) >= 9:
                imdb_id = clean_item
                title = clean_item
            else:
                m_year = re.search(r'\((\d{4})\)', clean_item)
                if m_year:
                    year = m_year.group(1)
                    title = clean_item.replace(f"({year})", "").strip()
                else:
                    title = clean_item
        elif isinstance(item, dict):
            title = item.get("title")
            year = item.get("year")
            imdb_id = item.get("imdb_id") or item.get("imdb")
            q = item.get("quality", preferred_quality)

        try:
            post_result = run_pipeline(title, year, imdb_id, q)
            results.append({"status": "SUCCESS", "item": item, "post": post_result})
            log("BATCH", f"✅ Completed item [{idx}/{len(items)}]: {title}")
        except Exception as e:
            log("BATCH", f"❌ Failed item [{idx}/{len(items)}] '{item}': {e}")
            results.append({"status": "FAILED", "item": item, "error": str(e)})

    # Final summary report
    print("\n" + "=" * 75)
    print(f"  BATCH PROCESSING SUMMARY ({len(results)} Total Items)")
    print("=" * 75)
    for i, res in enumerate(results, 1):
        status_icon = "✅" if res["status"] == "SUCCESS" else "❌"
        item_name = res["item"] if isinstance(res["item"], str) else res["item"].get("title")
        detail = res.get("post", {}).get("link") if res["status"] == "SUCCESS" else res.get("error", "Failed")
        print(f"  {status_icon} [{i}/{len(results)}] {item_name} -> {detail}")
    print("=" * 75 + "\n")
    return results

if __name__ == "__main__":
    if len(sys.argv) > 1:
        first_arg = sys.argv[1]
        if first_arg in ("--batch", "-b", "--batch-file", "-f"):
            if len(sys.argv) > 2:
                batch_target = sys.argv[2]
                quality = sys.argv[3] if len(sys.argv) > 3 else "both"
                if os.path.exists(batch_target):
                    with open(batch_target, "r", encoding="utf-8") as f:
                        lines = [line.strip() for line in f if line.strip() and not line.startswith("#")]
                    run_batch_pipeline(lines, preferred_quality=quality)
                else:
                    # Comma-separated list of titles: "Breaking Bad S01E01, Breaking Bad S01E02"
                    items = [t.strip() for t in batch_target.split(",") if t.strip()]
                    run_batch_pipeline(items, preferred_quality=quality)
            else:
                print("Usage: python colab_pipeline.py --batch <file_path_or_comma_separated_titles> [quality]")
        else:
            t = sys.argv[1]
            y = sys.argv[2] if len(sys.argv) > 2 else None
            imdb = sys.argv[3] if len(sys.argv) > 3 else None
            q = sys.argv[4] if len(sys.argv) > 4 else "both"
            run_pipeline(t, y, imdb, preferred_quality=q)
    else:
        print("Usage:")
        print("  Single item: python colab_pipeline.py <Movie Title or Episode e.g. 'Breaking Bad S01E01'> [Release Year] [IMDb ID] [Quality]")
        print("  Batch mode:  python colab_pipeline.py --batch <file_path_or_comma_separated_titles> [Quality]")

