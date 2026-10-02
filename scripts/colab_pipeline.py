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
import threading
import queue
from urllib.parse import quote, quote_plus
from requests.auth import HTTPBasicAuth
from bs4 import BeautifulSoup
import unicodedata

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

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
    _COLAB_VIDMOLY_KEY = userdata.get('VIDMOLY_API_KEY')
    _COLAB_STREAMHG_KEY = userdata.get('STREAMHG_API_KEY')
    _COLAB_DOOD_KEY = userdata.get('DOODSTREAM_API_KEY')
    _COLAB_STREAMTAPE_LOGIN = userdata.get('STREAMTAPE_LOGIN')
    _COLAB_STREAMTAPE_KEY = userdata.get('STREAMTAPE_KEY')
except Exception:
    _COLAB_WP_PASS = None
    _COLAB_TMDB_KEY = None
    _COLAB_VIDMOLY_KEY = None
    _COLAB_STREAMHG_KEY = None
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
VIDMOLY_API_KEY = os.getenv("VIDMOLY_API_KEY") or _COLAB_VIDMOLY_KEY or "6336771q20ng1yr881rjlr"
STREAMHG_API_KEY = os.getenv("STREAMHG_API_KEY") or _COLAB_STREAMHG_KEY or "33949r9v5gqs5jy2w0ecv"
DOODSTREAM_API_KEY = os.getenv("DOODSTREAM_API_KEY") or _COLAB_DOOD_KEY or "578084calkr4oo4gnpz7ni"
DOODSTREAM_API_BASE = "https://doodapi.com/api"

STREAMTAPE_LOGIN = os.getenv("STREAMTAPE_LOGIN") or _COLAB_STREAMTAPE_LOGIN or "06340d1c727a30bcd350"
STREAMTAPE_KEY = os.getenv("STREAMTAPE_KEY") or _COLAB_STREAMTAPE_KEY or "BbWjjoderVTyxx2"
STREAMTAPE_API_BASE = "https://api.streamtape.com"

DOWNLOAD_DIR = "/content/download" if os.path.exists("/content") else os.path.abspath("./downloads")
STAGING_DIR = "/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp")
FONTS_DIR = "/content/fonts" if os.path.exists("/content") else os.path.abspath("./fonts")

# Execution mode: default to False for full automated zero-touch uninterrupted run
PREVIEW_MODE = os.getenv("PREVIEW_MODE", "false").lower() in ("true", "1", "yes")


def get_system_fonts_dir() -> str:
    """
    Dynamic font directory resolver:
    Checks candidate directories in order of priority:
      1. /usr/share/fonts/truetype/noto (Standard system font path)
      2. ~/.local/share/fonts (User font path)
      3. /content/fonts (Google Colab font path)
    Returns the first existing directory containing .ttf files,
    or creates and returns /usr/share/fonts/truetype/noto (with graceful permission fallbacks).
    """
    candidates = [
        "/usr/share/fonts/truetype/noto",
        os.path.expanduser("~/.local/share/fonts"),
        "/content/fonts",
    ]
    for c in candidates:
        if os.path.isdir(c):
            try:
                ttf_files = [f for f in os.listdir(c) if f.lower().endswith(".ttf")]
                if ttf_files:
                    return c
            except Exception:
                pass

    for c in candidates:
        try:
            os.makedirs(c, exist_ok=True)
            if os.path.isdir(c) and os.access(c, os.W_OK):
                return c
        except Exception:
            continue

    fallback = os.path.abspath("./fonts")
    os.makedirs(fallback, exist_ok=True)
    return fallback


def setup_environment(fonts_dir: str = None) -> str:
    """
    System & Environment Provisioning:
    1. Installs system packages: fonts-noto-core, fonts-noto-extra, fonts-amiri, fontconfig via apt if available.
    2. Provisions Noto Sans Arabic fonts into standard system paths (/usr/share/fonts/truetype/noto).
    3. Executes fc-cache -fv to register fonts in fontconfig.
    4. Automated verification: tests fc-match "Noto Sans Arabic" and logs result.
    """
    if not fonts_dir:
        fonts_dir = get_system_fonts_dir()

    # 1. Install required apt packages on Debian/Ubuntu/Colab/Lightning.ai (root or sudo)
    if sys.platform.startswith("linux") and shutil.which("apt-get"):
        is_root = False
        try:
            is_root = os.geteuid() == 0
        except AttributeError:
            pass  # Windows — no geteuid()

        sudo_prefix = [] if is_root else (["sudo"] if shutil.which("sudo") else [])
        core_pkgs = ["aria2", "ffmpeg", "fontconfig", "fonts-noto-core", "fonts-noto-extra"]
        optional_pkgs = ["fonts-amiri"]

        # Install essential core packages with --ignore-missing to avoid aborting on deprecated repos
        try:
            core_cmd = sudo_prefix + ["apt-get", "install", "-y", "-qq", "--ignore-missing"] + core_pkgs
            res = subprocess.run(core_cmd, capture_output=True, timeout=120)
            if res.returncode != 0:
                log("FONTS", f"Core apt install notice ({res.returncode}); core packages may already exist.")
        except Exception as e:
            log("FONTS", f"Core apt package notice: {e}")

        # Install optional packages individually with silent fallback
        for opt_pkg in optional_pkgs:
            try:
                opt_cmd = sudo_prefix + ["apt-get", "install", "-y", "-qq", "--ignore-missing", opt_pkg]
                subprocess.run(opt_cmd, capture_output=True, timeout=60)
            except Exception:
                pass

    try:
        os.makedirs(fonts_dir, exist_ok=True)
        fonts = [
            ("NotoSansArabic-Regular.ttf", "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansArabic/NotoSansArabic-Regular.ttf"),
            ("NotoSansArabic-Bold.ttf", "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansArabic/NotoSansArabic-Bold.ttf"),
            ("Cairo-SemiBold.ttf", "https://github.com/google/fonts/raw/main/ofl/cairo/static/Cairo-SemiBold.ttf"),
            ("Amiri-Regular.ttf", "https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf"),
        ]
        for font_name, url in fonts:
            font_file = os.path.join(fonts_dir, font_name)
            if not os.path.exists(font_file) or os.path.getsize(font_file) == 0:
                log("FONTS", f"Provisioning Arabic font to {font_file}...")
                try:
                    r = requests.get(url, timeout=15)
                    if r.status_code == 200 and len(r.content) > 1000:
                        # Validate TTF magic bytes: TrueType = 00 01 00 00, OpenType = 4F 54 54 4F
                        ttf_magic = r.content[:4]
                        if ttf_magic in (b'\x00\x01\x00\x00', b'OTTO'):
                            with open(font_file, "wb") as f:
                                f.write(r.content)
                            log("FONTS", f"✅ Font provisioned -> {font_name} ({len(r.content)} bytes, valid TTF)")
                        else:
                            log("FONTS", f"⚠️ Downloaded {font_name} has invalid TTF magic bytes ({ttf_magic[:4].hex()}); skipping (possible HTML error page).")
                except Exception as dl_err:
                    log("FONTS", f"Notice downloading {font_name}: {dl_err}")

        # Also sync fonts to /content/fonts if running in Colab for dual-path availability
        if os.path.exists("/content") and fonts_dir != "/content/fonts":
            try:
                os.makedirs("/content/fonts", exist_ok=True)
                for font_name, _ in fonts:
                    src = os.path.join(fonts_dir, font_name)
                    dst = os.path.join("/content/fonts", font_name)
                    if os.path.exists(src) and not os.path.exists(dst):
                        shutil.copy2(src, dst)
            except Exception:
                pass

        fc_bin = shutil.which("fc-cache")
        if fc_bin:
            try:
                subprocess.run([fc_bin, "-fv", fonts_dir], capture_output=True, timeout=30)
                if os.path.exists("/content/fonts"):
                    subprocess.run([fc_bin, "-fv", "/content/fonts"], capture_output=True, timeout=30)
            except Exception as fc_err:
                log("FONTS", f"fc-cache notice: {fc_err}")

        # Automated verification: test fc-match "Noto Sans Arabic"
        fc_match_bin = shutil.which("fc-match")
        if fc_match_bin:
            try:
                match_proc = subprocess.run([fc_match_bin, "Noto Sans Arabic"], capture_output=True, text=True, timeout=10)
                match_out = match_proc.stdout.strip()
                log("FONTS", f"Font verification fc-match 'Noto Sans Arabic': {match_out}")
                if "noto" not in match_out.lower() and "arabic" not in match_out.lower() and "amiri" not in match_out.lower():
                    log("FONTS", f"⚠️ Warning: fc-match resolved to '{match_out}' instead of genuine Arabic font. Enforcing explicit :fontsdir fallback.")
            except Exception as match_err:
                log("FONTS", f"fc-match notice: {match_err}")

        return fonts_dir
    except Exception as e:
        log("FONTS", f"Notice on Arabic font setup (offline/fallback mode): {e}")
        return fonts_dir


setup_arabic_fonts = setup_environment

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
        if not poster_url and backdrop_url:
            poster_url = backdrop_url
        if not backdrop_url and poster_url:
            backdrop_url = poster_url
            
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
                if ep_r.get("still_path"):
                    still_url = f"https://image.tmdb.org/t/p/original{ep_r['still_path']}"
                    if not backdrop_url:
                        backdrop_url = still_url
                    if not poster_url:
                        poster_url = still_url
                if ep_r.get("vote_average"):
                    rating = format_imdb_rating(ep_r.get("vote_average"))
            except Exception:
                pass

    if not poster_url and backdrop_url:
        poster_url = backdrop_url
    if not backdrop_url and poster_url:
        backdrop_url = poster_url

    if not overview_ar and overview_en and overview_en != "No synopsis available.":
        overview_ar = translate_to_arabic(overview_en)

    episode_tag = f"S{season_num:02d}E{episode_num:02d}"
    seo_intro = f"مشاهدة وتحميل مسلسل {title_ar} الموسم {season_num} الحلقة {episode_num} ({episode_tag}) مترجم كامل بجودة 1080p BluRay عالية أون لاين."

    if not poster_url:
        poster_url = "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=1000&q=85"
    if not backdrop_url:
        backdrop_url = poster_url

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

def matches_show_tokens(show_name: str, title: str, season_num: int = None, episode_num: int = None) -> bool:
    r"""
    Enforce strict boundary matching on candidate torrent titles:
    - Normalizes show title (lowercased, punctuation stripped as a whole phrase with [\s._\-]+).
    - Rejects candidates where extraneous unbracketed words precede the title (e.g. rejecting 'The Bad Guys Breaking In' or 'Better Call Saul Breaking Bad').
    - If season_num and episode_num are provided, ensures season/episode pattern follows the show name.
    """
    if not show_name or not title:
        return False

    norm_show = re.sub(r"['’]", "", show_name).lower()
    norm_show = re.sub(r"[^\w\s]", " ", norm_show)
    words = [re.escape(w) for w in norm_show.split() if w]
    if not words:
        return False
    show_phrase = r"[\s\._\-]+".join(words)

    norm_title = re.sub(r"['’]", "", title).lower()

    # 1. Exact show phrase boundary check
    pattern = rf"(?:^|[\s\._\-])({show_phrase})(?=$|[\s\._\-])"
    m = re.search(pattern, norm_title)
    if not m:
        return False

    # 2. Reject if unbracketed words precede the show title
    prefix = norm_title[:m.start(1)]
    clean_prefix = re.sub(r"\[.*?\]|\(.*?\)|<.*?>|\{.*?\}", " ", prefix)
    clean_prefix = re.sub(r"(?:https?://)?(?:www\.)?[\w-]+\.[a-z0-9.-]+\b", " ", clean_prefix, flags=re.I)
    clean_prefix = re.sub(r"[^\w]", " ", clean_prefix).strip()
    if clean_prefix:
        return False

    # 3. If season and episode are specified, ensure the season/episode pattern follows
    if season_num is not None and episode_num is not None:
        after_show = norm_title[m.end(1):]
        clean_after = re.sub(r"[\s\._\-]+", " ", after_show)
        ep_pattern = rf"\b(?:s0*{season_num}\s*e0*{episode_num}|0*{season_num}\s*x\s*0*{episode_num})\b"
        if not re.search(ep_pattern, clean_after, re.IGNORECASE):
            # Check if this release explicitly specifies a different episode
            other_ep = re.search(r'\b(?:s0*\d+\s*e0*(\d+)|0*\d+\s*x\s*0*(\d+))\b', clean_after, re.IGNORECASE)
            if other_ep:
                matched_ep = int(other_ep.group(1) or other_ep.group(2))
                if matched_ep != episode_num:
                    return False
            # Allow complete season packs (e.g. "S01 Complete", "Season 1", "S01-S05")
            season_pack_pattern = rf"\b(?:season\s*0*{season_num}\b|s0*{season_num}\b|s0*{season_num}\s*-\s*s0*\d+)\b"
            if not re.search(season_pack_pattern, clean_after, re.IGNORECASE):
                return False

    return True

def is_excluded_release(text: str) -> bool:
    r"""
    Strictly excludes releases that break release quality or subtitle sync:
    - CAM, TeleSync, Telecine, Screeners (CAM, HDCAM, TS, HD-TS, TC, SCR)
    - Low-grade HDTV / TVRip (unless explicitly marked as BluRay or WEB-DL)
    """
    if not text:
        return False
    t = " " + re.sub(r'[\s._\-]+', ' ', text.lower()) + " "
    if re.search(r'\b(cam|hdcam|camrip|telesync|ts|hdts|telecine|tc|scr|screener|dvdscr|bdscr)\b', t):
        return True
    if re.search(r'\b(hdtv|pdtv|dsr|tvrip|hdtvrip)\b', t) and not re.search(r'\b(bluray|bdrip|brrip|bdr|web dl|webdl|webrip)\b', t):
        return True
    return False

def search_1337x_tv(show_name: str, season_num: int, episode_num: int, trackers_query: str = "") -> list:
    """
    Search 1337x across active mirrors for high-seed TV episode releases or season packs.
    """
    episode_tag = f"S{season_num:02d}E{episode_num:02d}"
    mirrors = ["https://1337xx.to", "https://1337x.so", "https://1337x.to"]
    queries = [f"{show_name} {episode_tag}", f"{show_name} S{season_num:02d}"]
    results = []

    for mirror in mirrors:
        for query in queries:
            try:
                url = f"{mirror}/category-search/{quote(query)}/TV/1/"
                r = requests.get(url, headers=HEADERS, timeout=8)
                if r.status_code != 200:
                    continue
                soup = BeautifulSoup(r.text, 'html.parser')
                rows = soup.select('table.table-list tr')
                if not rows or len(rows) < 2:
                    continue

                for row in rows[1:15]:
                    cols = row.select('td')
                    if len(cols) < 2:
                        continue
                    name_links = cols[0].select('a')
                    if not name_links:
                        continue
                    name_a = name_links[1] if len(name_links) > 1 else name_links[0]
                    title = name_a.text.strip()
                    detail_href = name_a.get('href', '')

                    if is_excluded_release(title):
                        continue
                    if not matches_show_tokens(show_name, title, season_num, episode_num):
                        continue

                    seeds_td = row.select_one('td.seeds')
                    seeds = int(seeds_td.text.strip()) if (seeds_td and seeds_td.text.strip().isdigit()) else 0
                    if seeds < 5:
                        continue

                    try:
                        det_url = f"{mirror}{detail_href}" if detail_href.startswith('/') else detail_href
                        det_res = requests.get(det_url, headers=HEADERS, timeout=6)
                        if det_res.status_code == 200:
                            det_soup = BeautifulSoup(det_res.text, 'html.parser')
                            magnet_a = det_soup.find('a', href=lambda h: h and h.startswith('magnet:'))
                            if magnet_a:
                                mag = magnet_a['href']
                                if trackers_query and "tr=" not in mag:
                                    mag += trackers_query
                                results.append({
                                    "title": title,
                                    "torrent_url": None,
                                    "magnet_uri": mag,
                                    "seeds": seeds,
                                    "size_bytes": 0,
                                    "source": "1337x"
                                })
                                if len(results) >= 5:
                                    break
                    except Exception:
                        continue
                if results:
                    break
            except Exception:
                continue
        if results:
            break
    return results

def fetch_tv_torrent(show_name: str, season_num: int, episode_num: int, imdb_id: str = None, preferred_quality: str = "1080p") -> dict:
    """
    Unified Multi-Indexer TV Torrent Resolver with Release Tier Prioritization:
    - Tier 1 (Highest Priority): BluRay / BDRip releases (sorted by highest seeders among them).
    - Tier 2 (Fallback only): High-quality WEB-DL / WEBRip (sorted by highest seeders).
    - Strictly excludes CAM, Telesync, and low-grade HDTV releases.
    - Preserves BluRay precedence to guarantee precise subtitle frame timing.
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
    apibay_queries = [f"{show_name} {episode_tag}", f"{show_name} S{season_num:02d}"]
    for apibay_query in apibay_queries:
        try:
            apibay_url = f"https://apibay.org/q.php?q={quote_plus(apibay_query)}"
            r = requests.get(apibay_url, headers=HEADERS, timeout=8)
            if r.status_code == 200:
                items = r.json()
                if isinstance(items, list):
                    added_ab = 0
                    for item in items:
                        name = item.get("name", "")
                        info_hash = item.get("info_hash", "")
                        if not info_hash or info_hash == "0000000000000000000000000000000000000000" or name == "No results returned":
                            continue
                        if is_excluded_release(name):
                            continue
                        if not matches_show_tokens(show_name, name, season_num, episode_num):
                            continue
                        seeds = int(item.get("seeders") or 0)
                        if seeds < 3:
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
                        added_ab += 1
                    if added_ab:
                        log("TV", f"APIBay query '{apibay_query}' resolved {added_ab} active releases for {episode_tag}")
        except Exception as e:
            log("TV", f"APIBay query notice ({apibay_query}): {e}")

    # 2. Secondary Indexer: EZTV API across active mirrors (always queried to merge swarms)
    apibay_count = len(matched_torrents)
    eztv_matched = []
    mirrors = ["https://eztvx.to", "https://eztv.re", "https://eztv.wf", "https://eztv.tf", "https://eztv.yt"]
    num_imdb = re.sub(r'[^0-9]', '', imdb_id) if imdb_id else ""
    eztv_found = False
    for mirror in mirrors:
        if eztv_found:
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
                        if is_excluded_release(t_title):
                            continue
                        if not matches_show_tokens(show_name, t_title, season_num, episode_num):
                            continue
                        s_count = int(t.get("seeds") or 0)
                        if s_count > 0:
                            eztv_matched.append({
                                "title": t_title,
                                "torrent_url": t.get("torrent_url"),
                                "magnet_uri": t.get("magnet_url"),
                                "seeds": s_count,
                                "size_bytes": t.get("size_bytes") or 0,
                                "source": "EZTV"
                            })
                    if eztv_matched:
                        log("TV", f"EZTV ({mirror}) resolved {len(eztv_matched)} releases for {episode_tag}")
                        eztv_found = True
                        break
            except Exception:
                continue

    # Merge EZTV results, deduplicating by info_hash from magnet URIs
    if eztv_matched:
        existing_hashes = set()
        for t in matched_torrents:
            m_uri = t.get("magnet_uri") or ""
            h = re.search(r'btih:([a-fA-F0-9]+)', m_uri)
            if h:
                existing_hashes.add(h.group(1).lower())
        for et in eztv_matched:
            et_uri = et.get("magnet_uri") or et.get("torrent_url") or ""
            et_h = re.search(r'btih:([a-fA-F0-9]+)', et_uri)
            if et_h and et_h.group(1).lower() in existing_hashes:
                continue
            matched_torrents.append(et)
        log("TV", f"Merged swarm pool: {apibay_count} APIBay + {len(eztv_matched)} EZTV = {len(matched_torrents)} total candidates")

    # 3. Tertiary Swarm Indexer: Torrentio (queried unconditionally to merge verified high-seeder swarms)
    if imdb_id:
        try:
            full_imdb = imdb_id if imdb_id.startswith("tt") else f"tt{imdb_id}"
            stream_url = f"https://torrentio.strem.fun/stream/series/{full_imdb}:{season_num}:{episode_num}.json"
            sr = requests.get(stream_url, headers=HEADERS, timeout=10)
            if sr.status_code == 200:
                streams = sr.json().get("streams", [])
                torrentio_matched = []
                for s in streams:
                    raw_title = s.get("title", "")
                    lines = [l.strip() for l in raw_title.split("\n") if l.strip()]
                    rel_title = lines[0] if lines else s.get("name", "")
                    filename = s.get("behaviorHints", {}).get("filename", "")
                    full_cand_text = f"{rel_title} {filename}"
                    
                    if is_excluded_release(full_cand_text):
                        continue

                    # Match on either the torrent release title or the specific episode filename inside it
                    matches_title = matches_show_tokens(show_name, rel_title, season_num, episode_num)
                    matches_file = bool(filename and matches_show_tokens(show_name, filename, season_num, episode_num))
                    if not (matches_title or matches_file):
                        continue

                    seeds_match = re.search(r'[👤👥]\s*([0-9]+)', raw_title) or re.search(r'([0-9]+)\s*[💾]', raw_title)
                    s_seeds = int(seeds_match.group(1)) if seeds_match else 0
                    if s_seeds <= 0:
                        continue

                    info_hash = s.get("infoHash")
                    if not info_hash:
                        continue

                    raw_fidx = s.get("fileIdx")
                    fidx = (raw_fidx + 1) if (isinstance(raw_fidx, int) and raw_fidx >= 0) else None
                    # Use filename if rel_title is a generic season pack
                    display_title = filename if (filename and re.search(rf's0*{season_num}\s*e0*{episode_num}', filename, re.I)) else rel_title
                    magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={quote(display_title)}{trackers_query}"
                    torrentio_matched.append({
                        "title": display_title,
                        "filename": filename,
                        "torrent_url": None,
                        "magnet_uri": magnet,
                        "seeds": s_seeds,
                        "size_bytes": 0,
                        "source": "Torrentio",
                        "file_idx": fidx,
                        "info_hash": info_hash.lower()
                    })

                # Deduplicate and merge Torrentio swarms
                if torrentio_matched:
                    existing_hashes = {}
                    for idx, t in enumerate(matched_torrents):
                        m_uri = t.get("magnet_uri") or ""
                        h = re.search(r'btih:([a-fA-F0-9]+)', m_uri)
                        if h:
                            existing_hashes[h.group(1).lower()] = idx

                    added_count = 0
                    for tm in torrentio_matched:
                        h = tm.get("info_hash")
                        if h and h in existing_hashes:
                            # Update seed count if Torrentio reports higher active swarm
                            matched_torrents[existing_hashes[h]]["seeds"] = max(
                                matched_torrents[existing_hashes[h]]["seeds"], tm["seeds"]
                            )
                            if tm.get("file_idx") and not matched_torrents[existing_hashes[h]].get("file_idx"):
                                matched_torrents[existing_hashes[h]]["file_idx"] = tm["file_idx"]
                        else:
                            matched_torrents.append(tm)
                            added_count += 1
                            if h:
                                existing_hashes[h] = len(matched_torrents) - 1
                    log("TV", f"Torrentio merged {added_count} additional verified releases ({len(torrentio_matched)} matched) for {episode_tag}")
        except Exception as e:
            log("TV", f"Torrentio query notice: {e}")

    # 4. Tertiary Fallback Indexer: 1337x (queried if swarm pool has < 5 candidates or Torrentio failed)
    if len(matched_torrents) < 5:
        try:
            x_results = search_1337x_tv(show_name, season_num, episode_num, trackers_query)
            if x_results:
                existing_hashes = set()
                for t in matched_torrents:
                    m_uri = t.get("magnet_uri") or ""
                    h = re.search(r'btih:([a-fA-F0-9]+)', m_uri)
                    if h:
                        existing_hashes.add(h.group(1).lower())
                added_x = 0
                for xr in x_results:
                    x_h = re.search(r'btih:([a-fA-F0-9]+)', xr.get("magnet_uri") or "")
                    if x_h and x_h.group(1).lower() in existing_hashes:
                        continue
                    matched_torrents.append(xr)
                    added_x += 1
                if added_x:
                    log("TV", f"1337x merged {added_x} verified releases ({len(x_results)} found) for {episode_tag}")
        except Exception as e:
            log("TV", f"1337x search notice: {e}")

    # 5. Strict Minimum Seeders Filter (Hard filter seeds < 5, emergency fallback to seeds >= 3, strictly reject seeds < 3)
    healthy_torrents = []
    fallback_torrents = []
    for t in matched_torrents:
        s = int(t.get("seeds", 0) or 0)
        t_title = t.get("title", "Unknown")
        if s >= 5:
            healthy_torrents.append(t)
        elif s >= 3:
            fallback_torrents.append(t)
        else:
            log("TV", f"⚠️ Filtered out candidate '{t_title}' due to low seeds ({s} < 5)")

    if healthy_torrents:
        valid_torrents = healthy_torrents
        for ft in fallback_torrents:
            log("TV", f"⚠️ Filtered out candidate '{ft.get('title')}' due to low seeds ({ft.get('seeds')} < 5)")
    elif fallback_torrents:
        log("TV", f"⚠️ No candidates with seeds >= 5 found. Falling back to {len(fallback_torrents)} candidates with seeds >= 3...")
        valid_torrents = fallback_torrents
    else:
        raise RuntimeError(f"No active torrents with seeders >= 3 found for TV episode '{show_name} {episode_tag}'. Swarms are inactive across APIBay, EZTV, and indexers.")

    # Release Tier Hierarchy for Subtitle Synchronization:
    # 1. Tier 1 (Highest Priority): BluRay / BDRip releases (sorted by highest seeders among them).
    # 2. Tier 2 (Fallback only): High-quality WEB-DL / WEBRip (sorted by highest seeders).
    # 3. Strictly exclude CAM, Telesync, and low-grade HDTV releases.
    # Gap of 600,000 points guarantees Tier 1 BluRay always precedes Tier 2 WEB-DL for subtitle sync.
    def release_score(t: dict) -> float:
        raw_text = (str(t.get("title", "")) + " " + str(t.get("filename", ""))).lower()
        full_text = " " + re.sub(r'[\s._\-]+', ' ', raw_text) + " "
        seeds = int(t.get("seeds", 0) or 0)

        is_bluray = bool(re.search(r'\b(bluray|blu-ray|bdrip|brrip|bd-rip|bdr)\b', full_text))
        is_web = bool(re.search(r'\b(web-?dl|webrip|web-?rip|amzn\s*web|nf\s*web|dsnp\s*web|hmax\s*web|web)\b', full_text))

        is_remux = bool(re.search(r'\b(bdremux|remux|bluray-?remux|complete\s*bluray)\b', full_text))
        is_4k = bool(re.search(r'\b(2160p?|4k|uhd)\b', full_text))
        is_1080 = bool(re.search(r'\b(1080p?|1920x1080)\b', full_text))
        is_720 = bool(re.search(r'\b(720p?|1280x720)\b', full_text))

        # Base tier score: 600,000 pt gap guarantees Tier 1 BluRay always precedes Tier 2 WEB-DL
        if is_bluray:
            if preferred_quality == "720p":
                base_score = 1000000.0 if is_720 else (900000.0 if is_1080 else 700000.0)
            else:
                base_score = 1000000.0 if (is_1080 and not is_remux and not is_4k) else (800000.0 if is_720 else 600000.0)
        elif is_web:
            if preferred_quality == "720p":
                base_score = 400000.0 if is_720 else (300000.0 if is_1080 else 200000.0)
            else:
                base_score = 400000.0 if (is_1080 and not is_remux and not is_4k) else (300000.0 if is_720 else 200000.0)
        else:
            base_score = 100000.0 if is_1080 else (80000.0 if is_720 else 50000.0)

        # Within each tier, rank strictly by seeders count (capped at 20,000 so it can NEVER cross tiers)
        seed_score = min(float(seeds), 20000.0)

        # Single episode bonus: +5000 so single episodes or season packs with file_idx are prioritized over full packs
        ep_bonus = 5000.0 if (re.search(rf'\b(?:s0*{season_num}\s*e0*{episode_num}|0*{season_num}\s*x\s*0*{episode_num})\b', full_text) or t.get('file_idx')) else 0.0

        # Subtle modifiers within tier
        modifier = 0.0
        if re.search(r'\b(psa|galaxytv|tgx|qxr|rarbg|x264)\b', full_text):
            modifier += 200.0
        if re.search(r'\b(megusta)\b', full_text):
            modifier -= 2000.0
        if re.search(r'\b(av1)\b', full_text):
            modifier -= 1000.0

        return base_score + seed_score + ep_bonus + modifier

    valid_torrents.sort(key=release_score, reverse=True)

    top_candidates = []
    for vt in valid_torrents:
        vt_title = vt.get("title", "").lower()
        if "2160" in vt_title or "4k" in vt_title or "uhd" in vt_title:
            q = "4K/2160p"
        elif "1080" in vt_title:
            q = "1080p"
        elif "720" in vt_title:
            q = "720p"
        else:
            q = "HDTV"
        raw_vt = (str(vt.get("title", "")) + " " + str(vt.get("filename", ""))).lower()
        clean_vt = " " + re.sub(r'[\s._\-]+', ' ', raw_vt) + " "
        is_br = bool(re.search(r'\b(bluray|blu-ray|bdrip|brrip|bd-rip|bdr)\b', clean_vt))
        is_wb = bool(re.search(r'\b(web-?dl|webrip|web-?rip|amzn\s*web|nf\s*web|dsnp\s*web|hmax\s*web|web)\b', clean_vt))
        is_single = bool(re.search(rf'\b(?:s0*{season_num}\s*e0*{episode_num}|0*{season_num}\s*x\s*0*{episode_num})\b', clean_vt))
        is_pack = not is_single and bool(re.search(rf'\b(?:season\s*0*{season_num}\b|s0*{season_num}\b|s0*{season_num}\s*-\s*s0*\d+|complete)\b', clean_vt))
        tier_label = "Tier 1 (BluRay)" if is_br else ("Tier 2 (WEB-DL)" if is_wb else "Standard")
        top_candidates.append({
            "title": vt.get("title"),
            "quality": q,
            "tier": tier_label,
            "torrent_url": vt.get("torrent_url"),
            "magnet_uri": vt.get("magnet_uri"),
            "seeds": vt.get("seeds", 0),
            "size": vt.get("size", "Unknown"),
            "size_bytes": vt.get("size_bytes", 0),
            "source": vt.get("source", "Unknown"),
            "file_idx": vt.get("file_idx"),
            "is_season_pack": is_pack
        })

    selected_torrent = top_candidates[0]
    log("TV", f"Selected release: '{selected_torrent.get('title')}' ({selected_torrent['quality']} - {selected_torrent.get('tier')}, seeds: {selected_torrent.get('seeds')}, source: {selected_torrent.get('source')})")

    result = selected_torrent.copy()
    result["candidates"] = top_candidates
    return result

# Aliases for unified resolution
fetch_eztv_torrent = fetch_tv_torrent
search_torrent_for_tv_episode = fetch_tv_torrent

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

def parse_aria2_speed(speed_str: str) -> float:
    """
    Parses aria2 download speed string (e.g. '1.5MiB', '850KiB', '0B', '2.1MB/s') to MB/s float.
    """
    if not speed_str:
        return 0.0
    m = re.match(r'([0-9.]+)\s*([a-zA-Z]*)', speed_str.strip())
    if not m:
        return 0.0
    val = float(m.group(1))
    unit = m.group(2).lower()
    if 'g' in unit:
        return val * 1024.0
    elif 'm' in unit:
        return val
    elif 'k' in unit:
        return val / 1024.0
    elif 'b' in unit:
        return val / (1024.0 * 1024.0)
    return val / (1024.0 * 1024.0)

def bdecode(data):
    """Simple robust bencode decoder in pure Python."""
    if isinstance(data, str):
        data = data.encode('latin1')
    
    def decode_item(idx):
        char = data[idx:idx+1]
        if char == b'i':
            idx += 1
            end = data.index(b'e', idx)
            val = int(data[idx:end])
            return val, end + 1
        elif char == b'l':
            idx += 1
            items = []
            while data[idx:idx+1] != b'e':
                item, idx = decode_item(idx)
                items.append(item)
            return items, idx + 1
        elif char == b'd':
            idx += 1
            d = {}
            while data[idx:idx+1] != b'e':
                key, idx = decode_item(idx)
                val, idx = decode_item(idx)
                if isinstance(key, bytes):
                    try:
                        key = key.decode('utf-8')
                    except UnicodeDecodeError:
                        key = key.decode('latin1')
                d[key] = val
            return d, idx + 1
        elif char.isdigit():
            colon = data.index(b':', idx)
            length = int(data[idx:colon])
            start = colon + 1
            end = start + length
            val = data[start:end]
            return val, end
        else:
            raise ValueError(f"Invalid bencode character at {idx}: {char}")

    val, _ = decode_item(0)
    return val

def check_episode_match(fname: str, season_num: int, episode_num: int) -> bool:
    """
    Checks if a filename or path strictly matches target season and episode.
    Rejects filenames matching conflicting episode numbers (e.g. S01E01 when seeking S01E02).
    """
    ep_pattern = rf'(?:s0*{season_num}\s*e0*{episode_num}|0*{season_num}x0*{episode_num}|\be0*{episode_num}\b|ep\s*0*{episode_num}\b)'
    if not re.search(ep_pattern, fname, re.IGNORECASE):
        return False
    
    found_eps = set()
    for m in re.finditer(r'\b(?:s0*\d+\s*e0*(\d+)|0*\d+\s*x\s*0*(\d+)|\be0*(\d+)\b|ep\s*0*(\d+)\b)', fname, re.IGNORECASE):
        for g in m.groups():
            if g is not None:
                try:
                    found_eps.add(int(g))
                except ValueError:
                    pass
    
    if found_eps and int(episode_num) not in found_eps:
        return False
        
    return True

def parse_aria2_show_files(output: str, season_num: int, episode_num: int) -> tuple:
    """
    Parses aria2c --show-files=true table output to identify 1-based file index for target episode.
    """
    lines = output.strip().splitlines()
    candidates = []
    for line in lines:
        m = re.match(r'^\s*(\d+)\|.*?\|(.*)$', line)
        if m:
            idx = int(m.group(1))
            path = m.group(2).strip()
            fname = os.path.basename(path)
            if fname.lower().endswith((".mp4", ".mkv", ".avi", ".webm", ".ts")):
                if check_episode_match(fname, season_num, episode_num) or check_episode_match(path, season_num, episode_num):
                    is_sample = "sample" in path.lower()
                    candidates.append((idx, path, is_sample))

    if not candidates:
        return None, None

    non_samples = [c for c in candidates if not c[2]]
    chosen = non_samples[0] if non_samples else candidates[0]
    return chosen[0], chosen[1]

def inspect_torrent_file_index(
    torrent_source: str,
    season_num: int,
    episode_num: int,
    staging_dir: str = STAGING_DIR
) -> tuple:
    """
    Inspects a torrent or magnet to determine the 1-based file index for target episode.
    Returns (select_file_idx, matched_rel_path, source_to_use).
    If inspection fails or cannot determine file index, returns (None, None, torrent_source).
    """
    if season_num is None or episode_num is None:
        return None, None, torrent_source

    target_tag = f"S{int(season_num):02d}E{int(episode_num):02d}"
    video_extensions = (".mp4", ".mkv", ".avi", ".webm", ".ts")

    def _find_best_index_from_info(info_dict):
        files = info_dict.get("files")
        if not files or not isinstance(files, list):
            fname = info_dict.get("name", "")
            if isinstance(fname, bytes):
                fname = fname.decode('utf-8', errors='ignore')
            if check_episode_match(fname, season_num, episode_num):
                return 1, fname
            return None, None

        candidates = []
        for idx, fentry in enumerate(files, 1):
            path_parts = fentry.get("path", [])
            parts_str = [p.decode('utf-8', errors='ignore') if isinstance(p, bytes) else str(p) for p in path_parts]
            rel_path = "/".join(parts_str)
            fname = parts_str[-1] if parts_str else ""
            if fname.lower().endswith(video_extensions):
                if check_episode_match(fname, season_num, episode_num) or check_episode_match(rel_path, season_num, episode_num):
                    flen = fentry.get("length", 0)
                    is_sample = "sample" in rel_path.lower()
                    candidates.append((idx, rel_path, flen, is_sample))

        if not candidates:
            return None, None

        non_samples = [c for c in candidates if not c[3]]
        pool = non_samples if non_samples else candidates
        pool.sort(key=lambda x: x[2], reverse=True)
        return pool[0][0], pool[0][1]

    # Case 1: Direct .torrent file on local disk
    if os.path.exists(torrent_source) and torrent_source.lower().endswith(".torrent"):
        try:
            with open(torrent_source, "rb") as f:
                decoded = bdecode(f.read())
            info = decoded.get("info", {})
            idx, pth = _find_best_index_from_info(info)
            if idx:
                saved_torrent = os.path.join(staging_dir, "resolved.torrent")
                if os.path.abspath(torrent_source) != os.path.abspath(saved_torrent):
                    shutil.copy2(torrent_source, saved_torrent)
                log("ARIA2", f"🎯 Pre-selected episode file index from local torrent: #{idx} -> '{pth}' for {target_tag}")
                return idx, pth, saved_torrent
        except Exception as e:
            log("ARIA2", f"Notice: failed to parse local torrent: {e}")

    # Case 2: HTTP/HTTPS URL returning .torrent
    if torrent_source.startswith("http://") or torrent_source.startswith("https://"):
        try:
            r = requests.get(torrent_source, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
            if r.status_code == 200 and len(r.content) > 50 and r.content.startswith(b'd'):
                saved_torrent = os.path.join(staging_dir, "resolved.torrent")
                with open(saved_torrent, "wb") as f:
                    f.write(r.content)
                decoded = bdecode(r.content)
                info = decoded.get("info", {})
                idx, pth = _find_best_index_from_info(info)
                if idx:
                    log("ARIA2", f"🎯 Pre-selected episode file index from HTTP torrent: #{idx} -> '{pth}' for {target_tag}")
                    return idx, pth, saved_torrent
        except Exception as e:
            log("ARIA2", f"Notice: HTTP torrent fetch failed: {e}")

    # Case 3: Magnet URI -> Fast metadata pre-fetch with aria2c
    if torrent_source.startswith("magnet:"):
        meta_dir = os.path.join(staging_dir, "meta_inspect")
        os.makedirs(meta_dir, exist_ok=True)
        extra_trackers = (
            "udp://tracker.opentrackr.org:1337/announce,"
            "udp://open.stealth.si:80/announce,"
            "udp://tracker.torrent.eu.org:451/announce,"
            "udp://explodie.org:6969/announce"
        )
        cmd = [
            "aria2c",
            f"--dir={meta_dir}",
            "--bt-metadata-only=true",
            "--bt-save-metadata=true",
            "--bt-stop-timeout=25",
            "--seed-time=0",
            "--follow-torrent=mem",
            "--disable-ipv6=true",
            "--enable-dht=true",
            f"--bt-tracker={extra_trackers}",
            "--bt-tracker-connect-timeout=10",
            torrent_source
        ]
        try:
            log("ARIA2", f"Fetching magnet metadata for {target_tag} selective download inspection...")
            res = subprocess.run(cmd, timeout=35, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for f in os.listdir(meta_dir):
                if f.endswith(".torrent"):
                    tpath = os.path.join(meta_dir, f)
                    with open(tpath, "rb") as tf:
                        decoded = bdecode(tf.read())
                    info = decoded.get("info", {})
                    idx, pth = _find_best_index_from_info(info)
                    if idx:
                        saved_torrent = os.path.join(staging_dir, "resolved.torrent")
                        shutil.copy2(tpath, saved_torrent)
                        log("ARIA2", f"🎯 Pre-selected episode file index from magnet metadata: #{idx} -> '{pth}' for {target_tag}")
                        return idx, pth, saved_torrent
        except Exception as e:
            log("ARIA2", f"Notice: magnet metadata prefetch skipped/timed out: {e}")

    return None, None, torrent_source

def resolve_downloaded_video_file(
    download_dir: str,
    season_num: int = None,
    episode_num: int = None
) -> str:
    """
    Strict video file resolver for single videos and multi-file season packs.
    If season_num and episode_num are provided:
    - Enforces exact regex matching for the target episode.
    - Excludes files matching a conflicting other episode (e.g. S01E01 when looking for S01E02).
    - Picks the largest matching video file (> 50MB) if multiple matches exist.
    - NEVER falls back to a file for a different episode; raises FileNotFoundError.
    """
    video_extensions = (".mp4", ".mkv", ".avi", ".webm", ".ts")
    video_files = []
    for root, _, files in os.walk(download_dir):
        for f in files:
            if f.lower().endswith(video_extensions):
                fpath = os.path.join(root, f)
                try:
                    sz = os.path.getsize(fpath)
                    if sz > 0:
                        video_files.append((fpath, sz, f))
                except OSError:
                    pass

    if not video_files:
        raise FileNotFoundError(f"No video files found in '{download_dir}' after download.")

    # 1. TV Episode Resolution
    if season_num is not None and episode_num is not None:
        target_tag = f"S{int(season_num):02d}E{int(episode_num):02d}"
        
        matching_videos = []
        for fpath, sz, fname in video_files:
            if check_episode_match(fname, season_num, episode_num):
                matching_videos.append((fpath, sz, fname))

        if not matching_videos:
            available = [f for _, _, f in video_files]
            raise FileNotFoundError(
                f"STRICT MISMATCH: Target episode {target_tag} video file not found in '{download_dir}'. "
                f"Found {len(video_files)} video file(s) for other episodes/releases: {available}. "
                f"Refusing to use an incorrect episode file!"
            )

        # Filter for real media files (> 50MB) to ignore stubs/samples
        large_matches = [v for v in matching_videos if v[1] > 50 * 1024 * 1024]
        target_pool = large_matches if large_matches else matching_videos
        non_samples = [v for v in target_pool if "sample" not in v[2].lower()]
        if non_samples:
            target_pool = non_samples
        target_pool.sort(key=lambda x: x[1], reverse=True)
        chosen_file = target_pool[0][0]
        log("ARIA2", f"🎯 Strict episode match: '{os.path.basename(chosen_file)}' ({target_pool[0][1]/(1024*1024):.1f} MB) for {target_tag}")
        return chosen_file

    # 2. Movie Resolution (or unassigned episode)
    large_videos = [v for v in video_files if v[1] > 50 * 1024 * 1024]
    non_samples = [v for v in large_videos if "sample" not in v[2].lower()]
    pool = non_samples if non_samples else (large_videos if large_videos else video_files)
    pool.sort(key=lambda x: x[1], reverse=True)
    return pool[0][0]

def download_with_aria2(
    torrent_source: str,
    download_dir: str = DOWNLOAD_DIR,
    staging_dir: str = STAGING_DIR,
    select_file: int = None,
    season_num: int = None,
    episode_num: int = None,
    is_season_pack: bool = False,
    candidate_title: str = "",
    min_speed_mb: float = 1.0,
    timeout_check_start: float = 60.0,
    timeout_check_limit: float = 90.0,
    min_progress_pct: float = 5.0
) -> str:
    """
    Execute optimized aria2c download with seed health monitoring and auto-skip for slow candidates.
    Monitors download speed in real-time:
    - If after 60-90s progress is under 5% or download speed is below 1 MB/s, terminates aria2
      and logs: [ARIA2] ⚠️ Candidate is slow/dead (< 1 MB/s). Skipping to next candidate...
      then raises RuntimeError so the pipeline immediately proceeds to the next candidate swarm.
    """
    # 1. Aggressive sanitization FIRST: wipe and recreate download & staging dirs
    # Purges leftover data while ensuring newly created .torrent files below are NOT deleted!
    sanitize_download_dir(download_dir, staging_dir)
    log("ARIA2", f"Starting multi-connection download into {download_dir}...")

    # Detect if release is a season pack or complete series
    title_str = str(candidate_title or torrent_source or "")
    is_pack = is_season_pack or bool(re.search(r'\b(complete|season[\s._-]*\d+|s0*\d+[\s._-]*s0*\d+|series[\s._-]*pack|all[\s._-]*seasons)\b', title_str, re.IGNORECASE))

    # 2. Selective File Resolution for TV Season Packs & Multi-File Torrents
    if season_num is not None and episode_num is not None:
        if not select_file or is_pack:
            inspected_idx, inspected_path, inspected_src = inspect_torrent_file_index(
                torrent_source, season_num, episode_num, staging_dir
            )
            if inspected_idx and inspected_src and os.path.exists(inspected_src):
                select_file = inspected_idx
                torrent_source = inspected_src
                log("ARIA2", f"🎯 Season pack selective download active: selecting file #{select_file} ('{inspected_path}') from local torrent on disk")

    # 3. SAFETY GUARD AGAINST GIANT TORRENTS (> 10GB) WITHOUT SELECTIVE DOWNLOAD:
    # If the release is identified as a season pack or complete series, but no valid episode file
    # was selected or we still only have an unparsed magnet URI:
    if is_pack:
        if not select_file or str(torrent_source).startswith("magnet:") or not os.path.exists(str(torrent_source)):
            log("ARIA2", "⛔ Refusing to download unindexed season pack without selective download!")
            sanitize_download_dir(download_dir, staging_dir)
            raise RuntimeError("Refusing to download unindexed season pack without selective download!")

    cmd = [
        "aria2c",
        f"--dir={download_dir}",
        "--max-connection-per-server=16",
        "--split=16",
        "--min-split-size=1M",
        "--summary-interval=2",
        "--seed-time=0",
        "--follow-torrent=mem",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--conditional-get=true",
        "--file-allocation=none",
        "--bt-stop-timeout=90",
        "--disable-ipv6=true",
        "--bt-tracker-connect-timeout=10",
    ]
    # IMPORTANT: Only pass --select-file when downloading from a local .torrent file, NEVER with a raw magnet!
    if select_file and isinstance(select_file, int) and select_file > 0:
        if not str(torrent_source).startswith("magnet:"):
            cmd.append(f"--select-file={select_file}")
        else:
            log("ARIA2", "⚠️ Cannot pass --select-file with raw magnet URI; omitted to prevent exit code 1.")

    cmd.append(torrent_source)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    out_q = queue.Queue()
    def _reader(pipe, q):
        try:
            for l in iter(pipe.readline, ''):
                q.put(l)
        finally:
            pipe.close()

    reader_thread = threading.Thread(target=_reader, args=(proc.stdout, out_q), daemon=True)
    reader_thread.start()

    start_time = time.time()
    last_speed_mb = 0.0
    last_progress_pct = 0.0
    max_downloaded_mb = 0.0
    stall_start_time = None
    aborted_slow = False
    abort_msg = ""

    while proc.poll() is None:
        try:
            line = out_q.get(timeout=1.0)
        except queue.Empty:
            line = None

        if line:
            line_str = line.strip()
            if line_str:
                if "DL:" in line_str or "(ETA:" in line_str:
                    print(f"  [ARIA2] {line_str}")
                p_match = re.search(r'\((\d+(?:\.\d+)?)%\)', line_str)
                if p_match:
                    last_progress_pct = float(p_match.group(1))
                s_match = re.search(r'DL:([0-9.]+[a-zA-Z]+(?:/s)?)', line_str)
                if s_match:
                    last_speed_mb = parse_aria2_speed(s_match.group(1))
                b_match = re.search(r'\[#[a-fA-F0-9]+\s+([0-9.]+[a-zA-Z]+)/', line_str)
                if b_match:
                    curr_mb = parse_aria2_speed(b_match.group(1))
                    if curr_mb > max_downloaded_mb:
                        max_downloaded_mb = curr_mb

        elapsed = time.time() - start_time
        # Periodically check disk usage in download_dir to accurately track bytes written
        if int(elapsed) % 5 == 0:
            try:
                disk_bytes = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(download_dir) for f in fs)
                disk_mb = disk_bytes / (1024.0 * 1024.0)
                if disk_mb > max_downloaded_mb:
                    max_downloaded_mb = disk_mb
            except Exception:
                pass

        # Progress-Aware Health Check: Do NOT kill in-progress downloads
        # If progress >= 15% OR downloaded > 500 MB, allow generous 120s stall grace period for peers to unchoke
        is_in_progress = (last_progress_pct >= 15.0 or max_downloaded_mb >= 500.0)

        if is_in_progress:
            if last_speed_mb < 0.05:
                if stall_start_time is None:
                    stall_start_time = time.time()
                    log("ARIA2", f"⚠️ In-progress download paused/stalled (progress: {last_progress_pct}%, downloaded: {max_downloaded_mb:.1f} MB). Starting 120s unchoke grace period...")
                stall_duration = time.time() - stall_start_time
                if stall_duration >= 120.0:
                    aborted_slow = True
                    abort_msg = (
                        f"In-progress download stalled at 0 MB/s for {int(stall_duration)}s "
                        f"(progress: {last_progress_pct}%, downloaded: {max_downloaded_mb:.1f} MB)"
                    )
                    log("ARIA2", f"⚠️ In-progress download stalled (>120s at 0 MB/s). Terminating candidate...")
                    break
            else:
                if stall_start_time is not None:
                    log("ARIA2", f"✅ Peers unchoked! Download resumed at {last_speed_mb:.2f} MB/s (progress: {last_progress_pct}%).")
                stall_start_time = None
        else:
            # Startup phase check: ONLY applies when progress < 5% and downloaded < 100MB
            if elapsed >= timeout_check_start:
                is_slow = False
                if elapsed >= timeout_check_start and last_progress_pct < min_progress_pct and max_downloaded_mb < 100.0 and last_speed_mb < min_speed_mb:
                    is_slow = True
                elif elapsed >= timeout_check_limit and last_progress_pct < 15.0 and max_downloaded_mb < 500.0 and last_speed_mb < min_speed_mb:
                    is_slow = True

                if is_slow:
                    aborted_slow = True
                    abort_msg = (
                        f"Candidate is slow/dead in startup phase (< {min_speed_mb:.1f} MB/s, "
                        f"progress: {last_progress_pct}%, downloaded: {max_downloaded_mb:.1f} MB after {int(elapsed)}s)"
                    )
                    log("ARIA2", "⚠️ Candidate is slow/dead (< 1 MB/s in startup phase). Skipping to next candidate...")
                    break

    # Drain any remaining lines
    while not out_q.empty():
        try:
            rem_line = out_q.get_nowait()
        except queue.Empty:
            break

    if aborted_slow:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=2)
            except Exception:
                pass
        sanitize_download_dir(download_dir, staging_dir)
        raise RuntimeError(abort_msg)

    if proc.returncode != 0:
        raise RuntimeError(f"aria2c download failed with exit code {proc.returncode}")

    # 2. Strict episode / video file resolution
    target_video = resolve_downloaded_video_file(
        download_dir=download_dir,
        season_num=season_num,
        episode_num=episode_num
    )
    file_size_mb = os.path.getsize(target_video) / (1024 * 1024)

    # 3. Integrity verification: check moov atom and container readability via ffprobe
    log("ARIA2", f"Verifying container integrity of {os.path.basename(target_video)} ({file_size_mb:.2f} MB)...")
    if not verify_video_integrity(target_video):
        raise RuntimeError(f"Downloaded file is corrupted or incomplete; aborting upload. ({target_video})")

    log("ARIA2", f"✅ Download verified intact: {os.path.basename(target_video)} ({file_size_mb:.2f} MB)")
    return target_video

def sanitize_subtitle_text(text: str) -> str:
    r"""
    Sanitize decoded subtitle text using a strict whitelist to purge all tofu boxes ([]),
    broken ligatures, and unsupported characters:
    1. Normalize Unicode via unicodedata.normalize('NFKC', text)
    2. Explicitly map Lam-Alif ligatures (\uFEF5 through \uFEFC) and decomposed forms to standard characters ('لا', 'لأ', 'لإ', 'لآ')
    3. Remove Tatweel/Kashida ('\u0640' and 'ـ') completely
    4. Strip all Tashkeel / Harakat ([\u064B-\u065F\u0670])
    5. Strip all brackets, braces, and quotes ([\(\)\[\]\{\}\<\>«»“"”‘’\'`\\])
    6. Apply STRICT WHITELIST regex:
       text = re.sub(r'[^\u0621-\u064A\u0660-\u0669a-zA-Z0-9\s\.\,\!\?\:\-\،\؟]', '', text)
    7. Collapse consecutive spaces.
    """
    if not text:
        return ""
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")

    # 1. Unicode NFKC normalization
    text = unicodedata.normalize("NFKC", text)

    # 2. Explicitly map Lam-Alif ligatures (\uFEF5 through \uFEFC) to standard characters
    lam_alif_map = {
        '\uFEF5': '\u0644\u0622',  # Isolated Lam with Alef with Madda -> لآ
        '\uFEF6': '\u0644\u0622',  # Final Lam with Alef with Madda -> لآ
        '\uFEF7': '\u0644\u0623',  # Isolated Lam with Alef with Hamza Above -> لأ
        '\uFEF8': '\u0644\u0623',  # Final Lam with Alef with Hamza Above -> لأ
        '\uFEF9': '\u0644\u0625',  # Isolated Lam with Alef with Hamza Below -> لإ
        '\uFEFA': '\u0644\u0625',  # Final Lam with Alef with Hamza Below -> لإ
        '\uFEFB': '\u0644\u0627',  # Isolated Lam with Alef -> لا
        '\uFEFC': '\u0644\u0627',  # Final Lam with Alef -> لا
    }
    for char, rep in lam_alif_map.items():
        text = text.replace(char, rep)

    # 3. Remove Tatweel/Kashida ('\u0640' and 'ـ') completely
    text = text.replace('\u0640', '').replace('ـ', '')

    # 4. Strip all Tashkeel / Harakat ([\u064B-\u065F\u0670])
    text = re.sub(r'[\u064B-\u065F\u0670]', '', text)

    # Strip HTML formatting tags first (e.g. <i>, <b>, <font...>)
    text = re.sub(r'<[^>]+>', '', text)

    # Preserve SRT timestamp arrows if whole subtitle content is passed
    has_arrows = "-->" in text
    if has_arrows:
        text = text.replace("-->", "SRTARROWTOKEN")

    # 5. Explicitly strip zero-width and BiDi control characters (\u200B-\u200F, \u202A-\u202E, \uFEFF)
    text = re.sub(r'[\u200B-\u200F\u202A-\u202E\uFEFF]', '', text)

    # 6. Strip all brackets, braces, and quotes ([\(\)\[\]\{\}\<\>«»“"”‘’\'`\\])
    text = re.sub(r'[\(\)\[\]\{\}\<\>«»“"”‘’\'`\\]', '', text)

    # 7. Apply STRICT WHITELIST regex:
    # Only Arabic letters, Arabic-Indic digits, ASCII digits, English letters, whitespace,
    # and standard punctuation (. , ! ? : - ، ؟)
    text = re.sub(r'[^\u0621-\u064A\u0660-\u0669a-zA-Z0-9\s\.\,\!\?\:\-\،\؟]', '', text)

    if has_arrows:
        text = text.replace("SRTARROWTOKEN", "-->")

    # 7. Collapse consecutive spaces and clean blank lines
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r' *\n *', '\n', text)

    return text.strip()



def decode_arabic_subtitle_bytes(raw_bytes: bytes) -> str:
    """
    Robust Arabic-aware subtitle decoder testing candidate encodings:
    ['utf-8', 'utf-8-sig', 'windows-1256', 'cp1256', 'iso-8859-6', 'latin1']
    Prioritizes strict multibyte UTF-8 / UTF-8-sig. For legacy 8-bit Arabic codepages,
    scores candidates by Arabic character density and penalizes mojibake/mismapped Latin accents.
    """
    if not raw_bytes:
        return ""

    raw_bytes = raw_bytes.replace(b"\x00", b"")

    # 1. Multi-byte UTF-8 strictly validated first
    for utf_enc in ['utf-8', 'utf-8-sig']:
        try:
            text = raw_bytes.decode(utf_enc)
            if re.search(r'[\u0600-\u06FF]', text):
                return text
        except (UnicodeDecodeError, LookupError):
            pass

    # 2. Legacy 8-bit Arabic codepages: evaluate and score candidates
    best_text = ""
    best_score = -999999

    def _score(t: str) -> int:
        ar_count = len(re.findall(r'[\u0600-\u06FF]', t))
        if ar_count == 0:
            return -1
        # Mis-decoded bytes from other codepages produce Latin accents (\u00C0-\u00FF) or replacement chars
        bad_latin = len(re.findall(r'[\u00C0-\u00FF]', t))
        replacements = t.count("\ufffd")
        return ar_count - (bad_latin * 3) - (replacements * 5)

    legacy_candidates = ['windows-1256', 'cp1256', 'iso-8859-6', 'latin1']
    for enc in legacy_candidates:
        try:
            candidate_text = raw_bytes.decode(enc)
            score = _score(candidate_text)
            if score > best_score:
                best_score = score
                best_text = candidate_text
        except (UnicodeDecodeError, LookupError):
            continue

    if best_score > 0 and best_text:
        return best_text

    # Fallback with error replacement if nothing matched cleanly
    for enc in ['windows-1256', 'cp1256', 'utf-8']:
        try:
            return raw_bytes.decode(enc, errors='replace')
        except Exception:
            pass
    return ""


def fix_arabic_mojibake(text: str) -> str:
    """
    Auto-repair Arabic text that suffered double-encoding or mojibake
    (e.g., CP1256 bytes decoded as CP1252 / Latin-1).
    """
    if not text:
        return text
    arabic_chars = len(re.findall(r'[\u0600-\u06FF]', text))
    total_alpha = len(re.findall(r'[A-Za-z\u0600-\u06FF]', text))

    # If already predominantly Arabic, return as-is
    if total_alpha > 0 and (arabic_chars / total_alpha) > 0.4:
        return text

    # Attempt to repair text that was decoded as Latin-1/cp1252 instead of CP1256
    for enc in ['cp1252', 'latin1', 'iso-8859-1']:
        try:
            raw = text.encode(enc)
            repaired = raw.decode('cp1256')
            repaired_arabic = len(re.findall(r'[\u0600-\u06FF]', repaired))
            if repaired_arabic > arabic_chars and repaired_arabic >= 20:
                return repaired
        except Exception:
            continue
    return text


def srt_ts_to_seconds(ts: str) -> float:
    """Parse SRT timestamp (HH:MM:SS,mmm or H:MM:SS.mm) to float seconds."""
    ts = ts.strip().replace(',', '.')
    parts = ts.split(':')
    h = int(parts[0])
    m = int(parts[1])
    s = float(parts[2])
    return h * 3600.0 + m * 60.0 + s


def seconds_to_srt_ts(seconds: float) -> str:
    """Convert float seconds to SRT timestamp HH:MM:SS,mmm."""
    seconds = max(0.0, float(seconds))
    total_ms = int(round(seconds * 1000.0))
    ms = total_ms % 1000
    total_sec = total_ms // 1000
    s = total_sec % 60
    total_min = total_sec // 60
    m = total_min % 60
    h = total_min // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def seconds_to_ass_ts(seconds: float) -> str:
    """Convert float seconds to ASS timestamp H:MM:SS.cc."""
    seconds = max(0.0, float(seconds))
    total_cs = int(round(seconds * 100.0))
    cs = total_cs % 100
    total_sec = total_cs // 100
    s = total_sec % 60
    total_min = total_sec // 60
    m = total_min % 60
    h = total_min // 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def clamp_subtitle_duration(start_sec: float, end_sec: float, text: str) -> float:
    """
    Clamp dialogue end time so subtitles never hang:
      max_duration = max(2.2, min(5.0, len(clean_text) * 0.08 + 1.2))
      if (end_time - start_time) > max_duration: end_time = start_time + max_duration
    Guarantees captions disappear naturally 2.2 - 5.0s after the actor finishes speaking
    instead of remaining frozen until the next dialogue.
    """
    clean_text = re.sub(r'<[^>]+>', '', text)
    clean_text = re.sub(r'\{[^}]+\}', '', clean_text).strip()
    max_duration = max(2.2, min(5.0, len(clean_text) * 0.08 + 1.2))
    if (end_sec - start_sec) > max_duration:
        return start_sec + max_duration
    return end_sec


def sanitize_srt_file(input_srt_path: str, output_srt_path: str = None, offset_seconds: float = 0.0) -> str:
    """
    Auto-detect and decode incoming SRT files across common encodings:
    ('utf-8', 'utf-8-sig', 'windows-1256', 'cp1256', 'iso-8859-6').
    Applies mojibake auto-repair, full bracket/tofu/bidi symbol purging,
    optional micro-timing offset adjustment (offset_seconds), and
    smart subtitle duration clamping (max_duration = max(2.2, min(5.0, L * 0.08 + 1.2))).
    Re-saves the sanitized file strictly in clean UTF-8 without BOM.
    """
    if not input_srt_path or not os.path.exists(input_srt_path):
        return None
    if not output_srt_path:
        output_srt_path = input_srt_path

    with open(input_srt_path, "rb") as f:
        raw_bytes = f.read()

    decoded = decode_arabic_subtitle_bytes(raw_bytes)
    repaired = fix_arabic_mojibake(decoded)
    raw_cleaned = repaired.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")

    time_pattern = re.compile(
        r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*(?:-->|->|—>|–>)\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})"
    )

    blocks = re.split(r'\n\s*\n', raw_cleaned.strip())
    new_blocks = []
    idx = 1

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

        start_sec = max(0.0, srt_ts_to_seconds(tm.group(1)) + offset_seconds)
        end_sec = max(0.0, srt_ts_to_seconds(tm.group(2)) + offset_seconds)

        cleaned_text_lines = [sanitize_subtitle_text(tl) for tl in lines[timing_idx + 1:]]
        cleaned_text_lines = [tl for tl in cleaned_text_lines if tl]
        if not cleaned_text_lines:
            continue

        full_dialogue = "\n".join(cleaned_text_lines)
        clamped_end = clamp_subtitle_duration(start_sec, end_sec, full_dialogue)

        start_str = seconds_to_srt_ts(start_sec)
        end_str = seconds_to_srt_ts(clamped_end)
        new_blocks.append(f"{idx}\n{start_str} --> {end_str}\n{full_dialogue}")
        idx += 1

    # Fallback Sequential Parser if blocks splitting yielded 0 entries
    if not new_blocks:
        lines = raw_cleaned.split('\n')
        current_start = None
        current_end = None
        current_text_parts = []

        def _append_seq_block():
            nonlocal idx
            if current_start and current_end and current_text_parts:
                start_sec = max(0.0, srt_ts_to_seconds(current_start) + offset_seconds)
                end_sec = max(0.0, srt_ts_to_seconds(current_end) + offset_seconds)
                full_dialogue = "\n".join(current_text_parts)
                clamped_end = clamp_subtitle_duration(start_sec, end_sec, full_dialogue)
                start_str = seconds_to_srt_ts(start_sec)
                end_str = seconds_to_srt_ts(clamped_end)
                new_blocks.append(f"{idx}\n{start_str} --> {end_str}\n{full_dialogue}")
                idx += 1

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue
            tm = time_pattern.search(line_str)
            if tm:
                _append_seq_block()
                current_start = tm.group(1)
                current_end = tm.group(2)
                current_text_parts = []
            elif current_start is not None:
                c_text = sanitize_subtitle_text(line_str)
                if c_text and not c_text.isdigit():
                    current_text_parts.append(c_text)
        _append_seq_block()

    if new_blocks:
        final_srt = "\n\n".join(new_blocks) + "\n"
    else:
        final_srt = sanitize_subtitle_text(raw_cleaned)

    with open(output_srt_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(final_srt)

    return output_srt_path


def parse_time_to_seconds(t_str: str) -> float:
    """Parse timestamp string (HH:MM:SS or MM:SS or seconds) into float seconds."""
    if not t_str:
        return 0.0
    t_str = str(t_str).strip()
    if ":" in t_str:
        parts = t_str.split(":")
        try:
            if len(parts) == 3:
                return float(parts[0]) * 3600.0 + float(parts[1]) * 60.0 + float(parts[2])
            elif len(parts) == 2:
                return float(parts[0]) * 60.0 + float(parts[1])
        except Exception:
            return 150.0
    try:
        return float(t_str)
    except Exception:
        return 150.0


def slice_srt_content_for_preview(srt_text: str, preview_start_sec: float, preview_duration_sec: float = 60.0) -> str:
    """
    Slice SRT subtitle entries to fit within a preview window [preview_start_sec, preview_start_sec + preview_duration_sec].
    Re-bases the timestamps so that preview_start_sec corresponds to 00:00:00,000.
    """
    if not srt_text:
        return ""
    preview_end_sec = preview_start_sec + preview_duration_sec
    time_pattern = re.compile(
        r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*(?:-->|->|—>|–>)\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})"
    )
    blocks = re.split(r'\n\s*\n', srt_text.strip())
    new_blocks = []
    idx = 1
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
        s_sec = srt_ts_to_seconds(tm.group(1))
        e_sec = srt_ts_to_seconds(tm.group(2))
        if e_sec >= preview_start_sec and s_sec <= preview_end_sec:
            clip_s = max(0.0, s_sec - preview_start_sec)
            clip_e = min(preview_duration_sec, e_sec - preview_start_sec)
            if clip_e > clip_s + 0.1:
                cleaned_dialogue = [sanitize_subtitle_text(tl) for tl in lines[timing_idx + 1:] if tl.strip()]
                cleaned_dialogue = [tl for tl in cleaned_dialogue if tl]
                if cleaned_dialogue:
                    dialogue = "\n".join(cleaned_dialogue)
                    start_str = seconds_to_srt_ts(clip_s)
                    end_str = seconds_to_srt_ts(clip_e)
                    new_blocks.append(f"{idx}\n{start_str} --> {end_str}\n{dialogue}")
                    idx += 1
    return "\n\n".join(new_blocks) + "\n" if new_blocks else ""


# Backwards compatibility alias
sanitize_subtitle_file = sanitize_srt_file



def decode_arabic_subtitle(raw_bytes: bytes) -> tuple:
    """
    Backwards-compatible wrapper returning (clean_text, detected_enc) using decode_arabic_subtitle_bytes,
    fix_arabic_mojibake, and sanitize_subtitle_text.
    """
    if not raw_bytes:
        return None, None

    raw_bytes = raw_bytes.replace(b"\x00", b"")
    for utf_enc in ['utf-8-sig', 'utf-8']:
        try:
            text = raw_bytes.decode(utf_enc)
            if re.search(r'[\u0600-\u06FF]', text):
                return sanitize_subtitle_text(fix_arabic_mojibake(text)), utf_enc
        except (UnicodeDecodeError, LookupError):
            pass

    def _score(t: str) -> int:
        ar_count = len(re.findall(r'[\u0600-\u06FF]', t))
        if ar_count == 0:
            return -1
        bad_latin = len(re.findall(r'[\u00C0-\u00FF]', t))
        replacements = t.count("\ufffd")
        return ar_count - (bad_latin * 3) - (replacements * 5)

    best_text = ""
    best_enc = None
    best_score = -999999

    for enc in ['windows-1256', 'cp1256', 'iso-8859-6', 'latin1']:
        try:
            candidate_text = raw_bytes.decode(enc)
            score = _score(candidate_text)
            if score > best_score:
                best_score = score
                best_text = candidate_text
                best_enc = enc
        except (UnicodeDecodeError, LookupError):
            continue

    if best_score > 0 and best_text:
        return sanitize_subtitle_text(fix_arabic_mojibake(best_text)), best_enc

    fallback = decode_arabic_subtitle_bytes(raw_bytes)
    if fallback:
        clean_text = sanitize_subtitle_text(fix_arabic_mojibake(fallback))
        if re.search(r'[\u0600-\u06FF]', clean_text):
            return clean_text, "windows-1256"

    return None, None


def read_subtitle_file_robustly(file_path: str) -> str:
    """
    Read subtitle file as binary bytes, decode using robust Arabic-aware decoder,
    apply fix_arabic_mojibake auto-repair, and purge bidi/tofu-box artifacts.
    """
    if not file_path or not os.path.exists(file_path):
        return ""

    with open(file_path, "rb") as f:
        raw_bytes = f.read()

    decoded = decode_arabic_subtitle_bytes(raw_bytes)
    repaired = fix_arabic_mojibake(decoded)
    return sanitize_subtitle_text(repaired)

# =============================================================================
# 4. ARABIC-ONLY SUBTITLES, AUDIO-SYNC & FFMPEG HARDSUBBING (BURN-IN)
# =============================================================================

def detect_release_type(text: str) -> str:
    """Detect release source format from video or subtitle filename/tag."""
    if not text:
        return "unknown"
    t = text.lower()
    bluray_tokens = ["bluray", "blu-ray", "bdrip", "brrip", "remux"]
    web_tokens = ["web-dl", "webrip", "web-rip", "web.", "web-", "web ", "amzn", "amazon", "netflix", "nf", "hmax", "dsnp", "apple", "itunes"]
    hdtv_tokens = ["hdtv", "pdtv", "dsr"]

    if any(tok in t for tok in bluray_tokens):
        return "bluray"
    if any(tok in t for tok in web_tokens):
        return "web"
    if any(tok in t for tok in hdtv_tokens):
        return "hdtv"
    return "unknown"


def score_release_match(candidate_text: str, source_release: str) -> int:
    """
    Score candidate subtitle against target video release source:
    - +100 if candidate filename matches exact release type (e.g. BluRay on BluRay, WEB on WEB)
    - +50 if candidate mentions 'YTS' or 'YIFY'
    - -80 penalty if video is 'BluRay' but candidate is 'WEB-DL' / 'WEBRip' (and vice versa)
    - +20 for matching resolution tag (1080p, 720p, etc.)
    """
    if not candidate_text:
        return 0
    c_lower = candidate_text.lower()
    s_lower = (source_release or "").lower()

    source_type = detect_release_type(s_lower)
    cand_type = detect_release_type(c_lower)

    score = 0

    # 1. Release type compatibility
    if source_type != "unknown" and cand_type != "unknown":
        if source_type == cand_type:
            score += 100
        elif (source_type == "bluray" and cand_type == "web") or (source_type == "web" and cand_type == "bluray"):
            score -= 80  # Severe penalty for BluRay <-> WEB-DL mismatch
        else:
            score -= 30
    elif source_type != "unknown" and cand_type == "unknown":
        score -= 10

    # 2. Candidate mentions YTS or YIFY
    if any(y in c_lower for y in ["yts", "yify"]):
        score += 50

    # 3. Matching resolution tag (1080p, 720p, 2160p, 4k)
    for res in ["1080p", "720p", "2160p", "4k"]:
        if res in s_lower and res in c_lower:
            score += 20
            break

    return score


def is_release_mismatch(candidate_text: str, source_release: str) -> bool:
    """Check if candidate subtitle format conflicts with video source format."""
    source_type = detect_release_type(source_release)
    cand_type = detect_release_type(candidate_text)
    if source_type in ["bluray", "web"] and cand_type in ["bluray", "web"]:
        return source_type != cand_type
    return False


def autonomous_fallback_sync(
    video_path: str,
    srt_path: str,
    reason: str = "Release Mismatch",
    max_offset_seconds: int = 120
) -> str:
    """
    Autonomous Subtitle Synchronization Engine:
    When a release mismatch occurs (e.g. WEB-DL subtitle on a BluRay rip),
    automatically executes headless audio alignment using `alass` (or `ffsubsync` fallback).
    Automatically corrects intro offsets (studio logos) and stretches/compresses framerate
    differences (23.976 <-> 24/25 fps) without manual offset inputs.
    """
    if not video_path or not srt_path or not os.path.exists(video_path) or not os.path.exists(srt_path):
        return srt_path

    log("AUTOSYNC", f"⚡ Autonomous Fallback Sync triggered ({reason}): Aligning '{os.path.basename(srt_path)}' to '{os.path.basename(video_path)}'...")

    synced_srt = os.path.splitext(srt_path)[0] + "_synced.srt"
    if os.path.exists(synced_srt):
        try: os.remove(synced_srt)
        except Exception: pass

    # 1. Locate or provision `alass` binary
    alass_bin = shutil.which("alass") or shutil.which("alass-cli")
    if not alass_bin:
        for possible_path in ["/usr/local/bin/alass", "/usr/bin/alass", "/content/alass", "./alass"]:
            if os.path.exists(possible_path) and os.access(possible_path, os.X_OK):
                alass_bin = possible_path
                break

    # Auto-provision standalone alass if running on Linux and missing
    if not alass_bin and sys.platform.startswith("linux"):
        try:
            target_bin = "/usr/local/bin/alass" if os.access("/usr/local/bin", os.W_OK) else "/tmp/alass"
            log("AUTOSYNC", f"Provisioning standalone alass binary to {target_bin}...")
            r = requests.get("https://github.com/kaegi/alass/releases/download/v2.0.0/alass-linux64", timeout=30)
            if r.status_code == 200 and len(r.content) > 100_000:
                with open(target_bin, "wb") as bf:
                    bf.write(r.content)
                os.chmod(target_bin, 0o755)
                alass_bin = target_bin
                log("AUTOSYNC", "✅ alass binary provisioned successfully.")
        except Exception as prov_err:
            log("AUTOSYNC", f"Notice provisioning alass: {prov_err}")

    if alass_bin:
        try:
            log("AUTOSYNC", f"Executing alass engine ({alass_bin}) in headless mode...")
            cmd = [alass_bin, video_path, srt_path, synced_srt]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if res.returncode == 0 and os.path.exists(synced_srt) and os.path.getsize(synced_srt) > 100:
                sanitize_srt_file(synced_srt, synced_srt)
                log("AUTOSYNC", f"✅ alass successfully corrected intro offsets and framerate ({os.path.getsize(synced_srt)} bytes) -> {os.path.basename(synced_srt)}")
                return synced_srt
            else:
                err_msg = res.stderr[:200] if res.stderr else "failed"
                log("AUTOSYNC", f"alass notice (code {res.returncode}): {err_msg}. Falling back to ffsubsync audio alignment...")
        except Exception as e:
            log("AUTOSYNC", f"alass exception: {e}; falling back to ffsubsync audio alignment...")

    # 2. Try `ffsubsync` as seamless audio-alignment fallback
    ffsubsync_bin = shutil.which("ffsubsync")
    base_cmd = [ffsubsync_bin] if ffsubsync_bin else [sys.executable, "-m", "ffsubsync"]
    try:
        log("AUTOSYNC", "Executing audio-based alignment via ffsubsync...")
        cmd = base_cmd + [
            video_path,
            "-i", srt_path,
            "-o", synced_srt,
            "--max-offset-seconds", str(max_offset_seconds)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if res.returncode == 0 and os.path.exists(synced_srt) and os.path.getsize(synced_srt) > 100:
            sanitize_srt_file(synced_srt, synced_srt)
            log("AUTOSYNC", f"✅ ffsubsync successfully synchronized subtitle -> {os.path.basename(synced_srt)}")
            return synced_srt
        else:
            err_msg = res.stderr[:200] if res.stderr else "none"
            log("AUTOSYNC", f"⚠️ ffsubsync notice (code {res.returncode}): {err_msg}. Retaining baseline subtitle.")
    except Exception as e:
        log("AUTOSYNC", f"⚠️ ffsubsync error: {e}. Retaining baseline subtitle.")

    return srt_path


sync_subtitles_with_audio = autonomous_fallback_sync


def search_and_download_yify_subtitles(
    imdb_id: str,
    download_dir: str = DOWNLOAD_DIR,
    season: int = None,
    episode: int = None,
    video_path: str = None,
    **kwargs
) -> str:
    """
    Smart Release-Aware Arabic Subtitle Retrieval & Synchronization Engine:
    1. Inspects the target video filename to detect the exact release source (e.g. BluRay, BRRip, WEB-DL, WEBRip, YTS).
    2. Scores candidate subtitles before downloading:
       + Score +100 if candidate matches exact release type (e.g. BluRay on BluRay).
       + Score +50 if candidate mentions 'YTS' or 'YIFY'.
       - Penalty -80 if video is 'BluRay' but candidate is 'WEB-DL' / 'WEBRip' (and vice versa).
       + Score +20 for matching resolution tag (1080p, 720p).
    3. Automatically sorts and picks the candidate with the highest release compatibility score.
    4. Autonomous Fallback Sync (alass): If best available subtitle has a release mismatch,
       automatically runs alass (or ffsubsync) in headless mode to correct intro offsets & framerate differences.
    """
    if not imdb_id:
        log("SUBS", "No IMDb ID available; skipping Arabic subtitle download.")
        return None

    # Handle parameter aliases
    output_dir = kwargs.get("output_dir", download_dir)
    season_val = season if season is not None else kwargs.get("season_num")
    episode_val = episode if episode is not None else kwargs.get("episode_num")

    # When season and episode are provided, route to TV episode subtitle engine
    if season_val is not None and episode_val is not None:
        try:
            s_num = int(season_val)
            e_num = int(episode_val)
            return download_subtitles_for_tv_episode(imdb_id, s_num, e_num, output_dir=output_dir, video_path=video_path, **kwargs)
        except (ValueError, TypeError) as err:
            log("SUBS", f"Warning converting season/episode: {err}; continuing with movie search.")

    subs_dir = os.path.join(output_dir, "subtitles")
    os.makedirs(subs_dir, exist_ok=True)

    # Inspect target video to detect release source
    target_video_file = (
        video_path or
        kwargs.get("video_path") or
        kwargs.get("raw_video_path") or
        kwargs.get("video_file") or
        kwargs.get("target_video")
    )
    if not target_video_file or not os.path.exists(target_video_file):
        if os.path.exists(output_dir):
            video_files = []
            for root, _, files in os.walk(output_dir):
                for f in files:
                    if f.lower().endswith((".mp4", ".mkv", ".avi", ".webm")) and not f.startswith("."):
                        fp = os.path.join(root, f)
                        try:
                            video_files.append((os.path.getmtime(fp), os.path.getsize(fp), fp))
                        except Exception:
                            pass
            if video_files:
                video_files.sort(key=lambda x: (x[1] > 10_000_000, x[0]), reverse=True)
                target_video_file = video_files[0][2]

    target_video_name = os.path.basename(target_video_file) if target_video_file else ""
    source_hint = str(kwargs.get("release_type") or kwargs.get("source_title") or kwargs.get("source_release") or "")
    effective_video_name = target_video_name or source_hint
    video_release_type = detect_release_type(effective_video_name)

    log("SUBS", f"Searching Arabic subtitles for IMDb ID '{imdb_id}' | Target Video: '{effective_video_name}' (Detected Release: '{video_release_type}')...")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }

    candidates = []
    seen_slugs = set()

    # 1. Try JSON endpoint first
    try:
        api_url = f"https://api.yifysubtitles.ch/subs/{imdb_id}"
        r = requests.get(api_url, headers=headers, timeout=6)
        if r.status_code == 200:
            data = r.json().get("subs", {}).get(imdb_id, {})
            arabic_subs = data.get("arabic", [])
            for s in arabic_subs:
                u = s.get("url")
                if not u:
                    continue
                cand_slug = u.rstrip("/").split("/")[-1]
                if cand_slug in seen_slugs:
                    continue
                seen_slugs.add(cand_slug)
                cand_text = s.get("release") or s.get("name") or cand_slug
                rating_val = s.get("rating", 0) or 0
                rel_score = score_release_match(cand_text, effective_video_name)
                candidates.append({
                    "url": u,
                    "slug": cand_slug,
                    "text": cand_text,
                    "rating": rating_val,
                    "score": rel_score
                })
            if candidates:
                log("SUBS", f"Found {len(candidates)} Arabic subtitle candidates via JSON API.")
    except Exception as e:
        log("SUBS", f"JSON API notice: {e}")

    # 2. Resilient fallback to HTML scraping across mirror domains
    if not candidates:
        mirrors = [
            f"https://yts-subs.com/movie-imdb/{imdb_id}",
            f"https://yifysubtitles.org/movie-imdb/{imdb_id}",
            f"https://yifysubtitles.ch/movie-imdb/{imdb_id}"
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
                        if lang_text == "arabic" or "arabic" in lang_text:
                            link = tr.find("a", href=True)
                            if link and "/subtitles/" in link["href"]:
                                sub_url = link["href"]
                                cand_slug = sub_url.rstrip("/").split("/")[-1]
                                if cand_slug in seen_slugs:
                                    continue
                                seen_slugs.add(cand_slug)

                                rating_val = 0
                                rating_cell = tr.find(class_="rating-cell")
                                if rating_cell:
                                    m_r = re.search(r'(-?\d+)', rating_cell.text)
                                    if m_r:
                                        try: rating_val = int(m_r.group(1))
                                        except Exception: pass

                                cand_text = f"{link.text.strip()} {tr.text.strip()} {cand_slug}"
                                rel_score = score_release_match(cand_text, effective_video_name)
                                candidates.append({
                                    "url": sub_url,
                                    "slug": cand_slug,
                                    "text": cand_text,
                                    "rating": rating_val,
                                    "score": rel_score
                                })
                    if candidates:
                        log("SUBS", f"Found {len(candidates)} Arabic subtitle candidates on mirror: {mirror_url}")
                        break
            except Exception:
                continue

    if not candidates:
        log("SUBS", f"No Arabic subtitles found for IMDb ID {imdb_id}.")
        return None

    # Score and sort candidates by release compatibility score and rating
    candidates.sort(key=lambda c: (c["score"], c["rating"]), reverse=True)
    top_cand = candidates[0]
    log("SUBS", f"Top candidate before download: '{top_cand['slug']}' (Score: {top_cand['score']}, Rating: {top_cand['rating']})")

    # 3. Candidate download & validation loop across mirrors
    zip_mirrors = [
        "https://subtitles.yts-subs.com",
        "https://yts-subs.com",
        "https://yifysubtitles.ch",
        "https://yifysubtitles.org"
    ]

    for sub_idx, cand in enumerate(candidates, start=1):
        slug = cand["slug"]
        sub_url = cand["url"]
        zip_bytes = None

        # Try direct CDN zip first (subtitles.yts-subs.com)
        try:
            cdn_url = f"https://subtitles.yts-subs.com/subtitles/{slug}.zip"
            zr = requests.get(cdn_url, headers=headers, timeout=12)
            if zr.status_code == 200 and len(zr.content) > 500 and not zr.content.strip().lower().startswith(b"<!doctype html"):
                zip_bytes = zr.content
        except Exception:
            pass

        # If CDN fails, iterate through mirrors
        if not zip_bytes:
            for zip_base in zip_mirrors:
                page_referer = f"{zip_base}/subtitles/{slug}"
                req_headers = {
                    "User-Agent": headers["User-Agent"],
                    "Referer": page_referer
                }
                # Try direct mirror zip URL
                for url_pattern in [f"{zip_base}/subtitle/{slug}.zip", f"{zip_base}/subtitles/{slug}.zip"]:
                    try:
                        zr = requests.get(url_pattern, headers=req_headers, timeout=12)
                        if zr.status_code == 200 and len(zr.content) > 500:
                            raw = zr.content.strip()
                            if not (raw.lower().startswith(b"<!doctype html") or raw.lower().startswith(b"<html")):
                                zip_bytes = zr.content
                                break
                    except Exception:
                        continue
                if zip_bytes:
                    break

                # Try scraping download button with base64 data-link from details page
                try:
                    detail_url = f"{zip_base}/subtitles/{slug}"
                    dr = requests.get(detail_url, headers=req_headers, timeout=10)
                    if dr.status_code == 200:
                        soup = BeautifulSoup(dr.text, "html.parser")
                        btn = soup.find(id="btn-download-subtitle") or soup.find("a", class_="download-subtitle")
                        if btn and btn.get("data-link"):
                            import base64
                            decoded_link = base64.b64decode(btn["data-link"]).decode("utf-8", errors="ignore")
                            if decoded_link.startswith("http"):
                                zr2 = requests.get(decoded_link, headers=req_headers, timeout=12)
                                if zr2.status_code == 200 and len(zr2.content) > 500:
                                    zip_bytes = zr2.content
                                    break
                except Exception:
                    continue

        if not zip_bytes:
            continue

        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                srt_files = [f for f in z.namelist() if f.lower().endswith(".srt") and not f.startswith("__MACOSX")]
                if not srt_files:
                    continue

                def _srt_sort_key(f_name):
                    lang_score = 10 if ("arabic" in f_name.lower() or "ara" in f_name.lower()) else 0
                    rel_score = score_release_match(f_name, effective_video_name)
                    return (rel_score + lang_score)

                sorted_files = sorted(srt_files, key=_srt_sort_key, reverse=True)
                for fname in sorted_files:
                    f_bytes = z.read(fname)
                    raw_text = decode_arabic_subtitle_bytes(f_bytes)
                    clean_text = sanitize_subtitle_text(fix_arabic_mojibake(raw_text))
                    ar_count = len(re.findall(r'[\u0600-\u06FF]', clean_text))
                    if ar_count >= 30:
                        out_srt = os.path.join(subs_dir, f"{imdb_id}_ara.srt")
                        with open(out_srt, "w", encoding="utf-8", newline="\n") as sf:
                            sf.write(clean_text)
                        sanitize_subtitle_file(out_srt, out_srt)

                        final_match_score = score_release_match(fname, effective_video_name)
                        has_mismatch = is_release_mismatch(fname, effective_video_name) or (final_match_score < 0)

                        if has_mismatch:
                            log("SUBS", f"⚠️ Candidate subtitle '{fname}' has release mismatch with video '{effective_video_name}' (Score: {final_match_score}).")
                            log("SUBS", "⚡ Triggering autonomous headless fallback sync (alass / audio alignment)...")
                            if target_video_file and os.path.exists(target_video_file):
                                out_srt = autonomous_fallback_sync(
                                    target_video_file,
                                    out_srt,
                                    reason=f"Release Mismatch ({fname} vs {os.path.basename(target_video_file)})"
                                )
                            else:
                                log("SUBS", "⚠️ Video file not available on local disk; retaining downloaded subtitle.")
                        else:
                            log("SUBS", f"✅ Best Arabic subtitle '{fname}' verified with perfect release compatibility (Score: {final_match_score}, {ar_count} Arabic chars) -> {os.path.basename(out_srt)}")

                        return out_srt
                    else:
                        log("SUBS", f"⚠️ Candidate subtitle {sub_idx} ({fname}) failed Arabic validation ({ar_count} Arabic chars), trying next...")
        except Exception as ze:
            log("SUBS", f"Notice unpacking candidate {sub_idx} ({slug}): {ze}")
            continue

    log("SUBS", f"Failed downloading or verifying Arabic subtitle for {imdb_id}.")
    return None


download_subtitles_for_imdb = search_and_download_yify_subtitles


def download_subtitles_for_tv_episode(
    imdb_id: str,
    season_num: int = None,
    episode_num: int = None,
    output_dir: str = DOWNLOAD_DIR,
    **kwargs
) -> str:
    """
    Search and download Arabic subtitles precisely targeted to the TV Show's Season and Episode.
    Uses OpenSubtitles v3 public series endpoint with candidate validation and fallback loop.
    Supports season/episode passed as positional or keyword arguments (season, season_num, episode, episode_num).
    Filters candidate release names/tags by S{season:02d}E{episode:02d}.
    """
    if not imdb_id:
        log("SUBS", "No IMDb ID available for TV episode subtitle search.")
        return None

    # Resolve aliases from kwargs if not passed directly
    if season_num is None:
        season_num = kwargs.get("season", kwargs.get("s"))
    if episode_num is None:
        episode_num = kwargs.get("episode", kwargs.get("e"))

    if season_num is None or episode_num is None:
        log("SUBS", f"Incomplete season/episode ({season_num}, {episode_num}); skipping TV subtitle download.")
        return None

    try:
        season_num = int(season_num)
        episode_num = int(episode_num)
    except (ValueError, TypeError):
        log("SUBS", f"Invalid season/episode integers ({season_num}, {episode_num}); skipping TV subtitle download.")
        return None

    subs_dir = os.path.join(kwargs.get("download_dir", output_dir), "subtitles")
    os.makedirs(subs_dir, exist_ok=True)

    episode_tag = f"S{season_num:02d}E{episode_num:02d}"
    episode_tag_alt = f"{season_num}x{episode_num:02d}"
    log("SUBS", f"Searching Arabic subtitles for TV Episode {imdb_id} {episode_tag}...")

    source_release = str(kwargs.get("release_type") or kwargs.get("source_title") or kwargs.get("source_release") or "")
    # 1. Primary: OpenSubtitles v3 series endpoint
    stremio_url = f"https://opensubtitles-v3.strem.io/subtitles/series/{imdb_id}:{season_num}:{episode_num}.json"
    try:
        r = requests.get(stremio_url, headers=HEADERS, timeout=12)
        if r.status_code == 200:
            subs = r.json().get("subtitles", [])
            ar_subs = [s for s in subs if s.get("lang") in ("ara", "ar")]
            if ar_subs:
                log("SUBS", f"Found {len(ar_subs)} Arabic subtitles on OpenSubtitles v3 endpoint. Validating candidates...")

                def _candidate_score(cand):
                    score = 0
                    text_meta = f"{cand.get('subtitleFileName', '')} {cand.get('movieReleaseName', '')} {cand.get('url', '')}".lower()
                    if episode_tag.lower() in text_meta or episode_tag_alt.lower() in text_meta:
                        score += 10
                    if cand.get("season") == season_num and cand.get("episode") == episode_num:
                        score += 20
                    score += score_release_match(text_meta, source_release)
                    return score

                sorted_ar_subs = sorted(ar_subs, key=_candidate_score, reverse=True)

                for idx, candidate in enumerate(sorted_ar_subs, start=1):
                    # Filter: if candidate specifies season/episode and they don't match, skip
                    cand_s = candidate.get("season")
                    cand_e = candidate.get("episode")
                    if cand_s is not None and cand_e is not None:
                        try:
                            if int(cand_s) != season_num or int(cand_e) != episode_num:
                                continue
                        except Exception:
                            pass

                    dl_url = candidate.get("url")
                    if not dl_url:
                        continue
                    try:
                        sub_resp = requests.get(dl_url, headers=HEADERS, timeout=12)
                        if sub_resp.status_code == 200 and len(sub_resp.content) > 100:
                            raw_text = decode_arabic_subtitle_bytes(sub_resp.content)
                            clean_text = sanitize_subtitle_text(fix_arabic_mojibake(raw_text))
                            arabic_count = len(re.findall(r'[\u0600-\u06FF]', clean_text))
                            if arabic_count >= 30:
                                out_srt = os.path.join(subs_dir, f"{imdb_id}_{episode_tag}_ara.srt")
                                with open(out_srt, "w", encoding="utf-8", newline="\n") as f:
                                    f.write(clean_text)
                                sanitize_subtitle_file(out_srt, out_srt)
                                cand_name = str(candidate.get('subtitleFileName') or candidate.get('movieReleaseName') or candidate.get('url') or '')
                                match_score = score_release_match(cand_name, source_release)
                                if is_release_mismatch(cand_name, source_release):
                                    log("SUBS", f"⚠️ Candidate TV subtitle '{cand_name}' has release mismatch with '{source_release}' (score: {match_score}). Flagged for autonomous fallback sync.")
                                    video_file = kwargs.get("video_path") or kwargs.get("raw_video_path")
                                    if video_file and os.path.exists(video_file):
                                        out_srt = autonomous_fallback_sync(video_file, out_srt, reason=f"TV Release Mismatch ({cand_name} vs {source_release})")
                                else:
                                    log("SUBS", f"✅ TV Subtitle candidate {idx}/{len(sorted_ar_subs)} verified ({arabic_count} Arabic chars, match score: {match_score}) and saved -> {os.path.basename(out_srt)}")
                                return out_srt
                            else:
                                log("SUBS", f"⚠️ Candidate subtitle {idx}/{len(sorted_ar_subs)} failed validation ({arabic_count} Arabic chars), trying next available subtitle...")
                    except Exception as ce:
                        log("SUBS", f"⚠️ Candidate subtitle {idx}/{len(sorted_ar_subs)} download error: {ce}, trying next available subtitle...")
                        continue
    except Exception as e:
        log("SUBS", f"OpenSubtitles v3 notice: {e}")

    # 2. Resilient fallback: Query mirror domains filtering by S{season:02d}E{episode:02d}
    mirrors = [
        f"https://yifysubtitles.ch/movie-imdb/{imdb_id}",
        f"https://yts-subs.com/movie-imdb/{imdb_id}",
        f"https://yifysubtitles.org/movie-imdb/{imdb_id}"
    ]
    mirror_candidates = []
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
    for mirror_url in mirrors:
        try:
            mr = requests.get(mirror_url, headers=headers, timeout=10)
            if mr.status_code == 200:
                soup = BeautifulSoup(mr.text, "html.parser")
                for tr in soup.find_all("tr"):
                    row_text = tr.text.lower()
                    if ("arabic" in row_text or "ara" in row_text) and (episode_tag.lower() in row_text or episode_tag_alt.lower() in row_text):
                        link = tr.find("a", href=True)
                        if link and "/subtitles/" in link["href"] and link["href"] not in mirror_candidates:
                            mirror_candidates.append(link["href"])
                if mirror_candidates:
                    break
        except Exception:
            continue

    if mirror_candidates:
        zip_mirrors = ["https://yifysubtitles.ch", "https://yts-subs.com", "https://yifysubtitles.org"]
        for sub_idx, sub_url in enumerate(mirror_candidates, start=1):
            slug = sub_url.rstrip("/").split("/")[-1]
            for zip_base in zip_mirrors:
                zip_url = f"{zip_base}/subtitle/{slug}.zip"
                try:
                    zr = requests.get(zip_url, headers={"User-Agent": headers["User-Agent"], "Referer": f"{zip_base}/subtitles/{slug}"}, timeout=15)
                    if zr.status_code != 200:
                        continue
                    with zipfile.ZipFile(io.BytesIO(zr.content)) as z:
                        srt_files = [f for f in z.namelist() if f.lower().endswith(".srt") and not f.startswith("__MACOSX")]
                        matched_srts = [f for f in srt_files if episode_tag.lower() in f.lower() or episode_tag_alt.lower() in f.lower()]
                        if not matched_srts:
                            matched_srts = srt_files
                        for fname in matched_srts:
                            f_bytes = z.read(fname)
                            raw_text = decode_arabic_subtitle_bytes(f_bytes)
                            clean_text = sanitize_subtitle_text(fix_arabic_mojibake(raw_text))
                            ar_count = len(re.findall(r'[\u0600-\u06FF]', clean_text))
                            if ar_count >= 30:
                                out_srt = os.path.join(subs_dir, f"{imdb_id}_{episode_tag}_ara.srt")
                                with open(out_srt, "w", encoding="utf-8", newline="\n") as sf:
                                    sf.write(clean_text)
                                sanitize_subtitle_file(out_srt, out_srt)
                                match_score = score_release_match(fname, source_release)
                                if is_release_mismatch(fname, source_release):
                                    log("SUBS", f"⚠️ Candidate TV mirror subtitle '{fname}' has release mismatch with '{source_release}' (score: {match_score}). Flagged for autonomous fallback sync.")
                                    video_file = kwargs.get("video_path") or kwargs.get("raw_video_path")
                                    if video_file and os.path.exists(video_file):
                                        out_srt = autonomous_fallback_sync(video_file, out_srt, reason=f"TV Mirror Mismatch ({fname} vs {source_release})")
                                else:
                                    log("SUBS", f"✅ TV Subtitle candidate from mirror verified ({ar_count} Arabic chars, match score: {match_score}) -> {os.path.basename(out_srt)}")
                                return out_srt
                except Exception:
                    continue

    log("SUBS", f"⚠️ No valid Arabic subtitles found for TV episode {imdb_id} {episode_tag}. Skipping subtitle download.")
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
        "Style: Default,Noto Sans Arabic,70,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "1,0,0,0,100,100,0,0,1,4.0,1.5,2,35,35,52,1"
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

def convert_srt_to_ass(
    srt_content_or_path: str,
    output_ass_path: str = None,
    offset_seconds: float = 0.0,
    **kwargs
) -> str:
    """
    Convert SRT subtitle content or file to ASS (Advanced SubStation Alpha) format with
    embedded Arabic styling on a 1080p virtual canvas. Bypasses FFmpeg's SRT demuxer
    (avformat_open_input) by producing a pre-formatted ASS file that libass reads directly via the 'subtitles' filter.
    Supports micro-timing offset adjustment via offset_seconds and ensures output .ass file is written cleanly to disk.
    Returns the validated path to the output .ass file.
    """
    if not srt_content_or_path:
        return ""

    try:
        offset_seconds = float(offset_seconds)
    except (ValueError, TypeError):
        offset_seconds = 0.0

    # 1. Resolve source subtitle text and source file
    srt_file_source = None
    if isinstance(srt_content_or_path, str) and len(srt_content_or_path) < 1024 and os.path.exists(srt_content_or_path) and os.path.isfile(srt_content_or_path):
        srt_file_source = srt_content_or_path
        try:
            with open(srt_content_or_path, "rb") as f:
                raw_bytes = f.read()
            srt_text = decode_arabic_subtitle_bytes(raw_bytes)
        except Exception:
            with open(srt_content_or_path, "r", encoding="utf-8", errors="replace") as f:
                srt_text = f.read()
    else:
        srt_text = str(srt_content_or_path)
        if "srt_path" in kwargs and kwargs["srt_path"] and os.path.exists(str(kwargs["srt_path"])):
            srt_file_source = kwargs["srt_path"]

    # 2. Resolve destination ASS file path
    if not output_ass_path:
        if srt_file_source:
            output_ass_path = os.path.splitext(srt_file_source)[0] + ".ass"
        elif "output_path" in kwargs and kwargs["output_path"]:
            output_ass_path = kwargs["output_path"]
        else:
            import tempfile
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".ass", delete=False) as tf:
                output_ass_path = tf.name

    # ── 0. Pre-clean: strip null bytes, BOMs, normalize newlines, purge bidi marks & tofu glyphs ──
    raw_text = srt_text.replace("\x00", "").lstrip("\ufeff\ufffe").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = sanitize_subtitle_text(raw_text).strip()
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
        "Style: Default,Noto Sans Arabic,70,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4.0,1.5,2,35,35,52,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ass_header = '\n'.join(header_lines) + '\n'

    # ── Permissive timestamp pattern (arrows: -->, ->, —>, –>; separators: comma or period) ──
    time_pattern = re.compile(
        r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*(?:-->|->|—>|–>)\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})"
    )

    def _clean_line(line: str) -> str:
        """Strip HTML tags and residual control characters from a subtitle line."""
        c = re.sub(r'<[^>]+>', '', line.strip())
        return sanitize_subtitle_text(c)

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

        start_sec = max(0.0, srt_ts_to_seconds(tm.group(1)) + offset_seconds)
        end_sec = max(0.0, srt_ts_to_seconds(tm.group(2)) + offset_seconds)

        text_parts = [_clean_line(tl) for tl in lines[timing_idx + 1:] if _clean_line(tl)]
        if not text_parts:
            continue

        text = '\\N'.join(text_parts)
        clamped_end = clamp_subtitle_duration(start_sec, end_sec, text)
        start_ass = seconds_to_ass_ts(start_sec)
        end_ass = seconds_to_ass_ts(clamped_end)
        dialogues.append(f"Dialogue: 0,{start_ass},{end_ass},Default,,0,0,0,,{text}")

    # ── Fallback Sequential Parser: if block splitting yielded 0 entries ──
    if not dialogues:
        lines = cleaned.split('\n')
        current_start = None
        current_end = None
        current_text_parts = []

        def _append_seq_dialogue():
            if current_start and current_end and current_text_parts:
                start_sec = max(0.0, srt_ts_to_seconds(current_start) + offset_seconds)
                end_sec = max(0.0, srt_ts_to_seconds(current_end) + offset_seconds)
                text = '\\N'.join(current_text_parts)
                clamped_end = clamp_subtitle_duration(start_sec, end_sec, text)
                start_ass = seconds_to_ass_ts(start_sec)
                end_ass = seconds_to_ass_ts(clamped_end)
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

    ass_content = ""
    if dialogues:
        ass_content = ass_header + '\n'.join(dialogues) + '\n'
    else:
        # ── Fallback Native FFmpeg Engine: if Python regex extracted 0 dialogues ──
        ffmpeg_bin = shutil.which("ffmpeg")
        if ffmpeg_bin:
            import tempfile
            temp_src = srt_file_source
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
                temp_ass = temp_src + ".ffmpeg.ass"
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
                            ass_content = apply_ass_style(raw_ass)
                except Exception:
                    pass
                finally:
                    if need_rm and temp_src and os.path.exists(temp_src):
                        try: os.remove(temp_src)
                        except Exception: pass
                    if os.path.exists(temp_ass):
                        try: os.remove(temp_ass)
                        except Exception: pass

    # Clean write to output_ass_path and return validated path
    if ass_content and "Dialogue:" in ass_content:
        out_dir = os.path.dirname(os.path.abspath(output_ass_path))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(output_ass_path, "w", encoding="utf-8", newline="\n") as out_f:
            out_f.write(ass_content)
        if os.path.exists(output_ass_path) and os.path.getsize(output_ass_path) > 0:
            return os.path.abspath(output_ass_path)

    return ""

_HW_ACCEL_CONFIG = None

def detect_hardware_acceleration(force_refresh: bool = False) -> dict:
    """
    Auto-Adaptive Universal Hardware Acceleration engine (Dynamic GPU/CPU switching):
    1. Checks if an NVIDIA GPU is present and FFmpeg supports 'h264_nvenc'.
    2. If NVENC is available:
       - Mode: 'nvenc'
       - 1080p Video Args: ["-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-preset", "p4", "-cq", "23", "-spatial-aq", "1", "-b:v", "3500k", "-maxrate", "4500k", "-bufsize", "7000k"]
       - 720p Downscale Args: ["-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-preset", "p4", "-cq", "24"]
       - Log: [ACCEL] 🚀 Active GPU detected! Utilizing NVENC hardware acceleration.
    3. If NO GPU / NVENC unavailable (Lightning AI, standard VPS, local CPU machine):
       - Mode: 'cpu'
       - 1080p Video Args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-threads", "0"]
       - 720p Downscale Args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "24", "-threads", "0"]
       - Note: Uses -threads 0 so FFmpeg dynamically uses all available CPU cores regardless of system specs.
       - Log: [ACCEL] ⚙️ CPU environment detected. Utilizing multi-threaded libx264 (all cores).
    Note: -pix_fmt yuv420p explicitly converts 10-bit sources (e.g. x265/HEVC 10-bit) into 8-bit YUV for universal NVENC/web compatibility.
    Caches the configuration for subsequent calls unless force_refresh=True.
    """
    global _HW_ACCEL_CONFIG
    if _HW_ACCEL_CONFIG is not None and not force_refresh:
        return _HW_ACCEL_CONFIG

    ffmpeg_bin = shutil.which("ffmpeg")
    has_nvenc = False

    if ffmpeg_bin:
        try:
            # 1. Fast query: check if h264_nvenc is compiled into FFmpeg
            enc_proc = subprocess.run(
                [ffmpeg_bin, "-encoders"],
                capture_output=True,
                text=True,
                timeout=6
            )
            if "h264_nvenc" in (enc_proc.stdout or ""):
                # 2. Hardware verification: run a minimal 0.1s null encode to verify GPU driver & silicon support
                test_cmd = [
                    ffmpeg_bin, "-y", "-nostdin",
                    "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
                    "-c:v", "h264_nvenc",
                    "-pix_fmt", "yuv420p",
                    "-f", "null", "-"
                ]
                test_proc = subprocess.run(
                    test_cmd,
                    capture_output=True,
                    text=True,
                    timeout=6
                )
                if test_proc.returncode == 0:
                    has_nvenc = True
        except Exception:
            has_nvenc = False

    if has_nvenc:
        log("ACCEL", "🚀 Active GPU detected! Utilizing NVENC hardware acceleration.")
        _HW_ACCEL_CONFIG = {
            "mode": "nvenc",
            "video_args_1080p": ["-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-preset", "p4", "-cq", "23", "-spatial-aq", "1", "-b:v", "3500k", "-maxrate", "4500k", "-bufsize", "7000k"],
            "video_args_720p": ["-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-preset", "p4", "-cq", "24"],
            "description": "NVIDIA NVENC Hardware Acceleration"
        }
    else:
        log("ACCEL", "⚙️ CPU environment detected. Utilizing multi-threaded libx264 (all cores).")
        _HW_ACCEL_CONFIG = {
            "mode": "cpu",
            "video_args_1080p": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-threads", "0"],
            "video_args_720p": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "24", "-threads", "0"],
            "description": "Multi-threaded CPU (libx264, all cores)"
        }

    return _HW_ACCEL_CONFIG

def burn_arabic_subtitles(video_path: str, srt_path: str, sub_offset_seconds: float = 0.0) -> str:
    """
    Burn Arabic subtitles directly into 1080p video frames (hardsubbing) using FFmpeg.
    Auto-detects and leverages NVIDIA NVENC hardware acceleration when a GPU is present,
    dynamically falling back to multi-threaded CPU libx264 (all cores) on CPU runtimes.
    Supports micro-timing offset adjustment via sub_offset_seconds.
    Maintains -y, -nostdin, and direct log redirection to prevent OS pipe deadlocks.
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

    # 1. Single-pass subtitle sanitization: decode, repair mojibake, sanitize, apply timing offset
    staging_dir = "/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp")
    os.makedirs(staging_dir, exist_ok=True)
    staged_clean_srt = os.path.join(staging_dir, "sub.srt")
    staged_sub_ass = os.path.join(staging_dir, "sub.ass")
    staged_input = os.path.join(staging_dir, "input_video.mp4")
    staged_output = os.path.join(staging_dir, "output_1080p.mp4")

    # Clean previous staging artifacts
    for p in [staged_clean_srt, staged_sub_ass, staged_input, staged_output]:
        if os.path.exists(p) or os.path.islink(p):
            try:
                os.remove(p)
            except Exception:
                pass

    try:
        # Copy raw subtitle to staging and sanitize ONCE via sanitize_srt_file
        # (handles binary decoding, mojibake repair, sanitize_subtitle_text, timing offset)
        import shutil as _shutil_copy
        _shutil_copy.copy2(srt_path, staged_clean_srt)
        sanitize_srt_file(staged_clean_srt, staged_clean_srt, offset_seconds=sub_offset_seconds)
    except Exception as e:
        log("HARDSUB", f"⚠️ Error during subtitle sanitization: {e}; falling back to raw video.")
        return video_path

    # Validate sanitized subtitle has enough Arabic content
    try:
        with open(staged_clean_srt, 'r', encoding='utf-8') as vf:
            staged_srt_text = vf.read()
        staged_ar_count = len(re.findall(r'[\u0600-\u06FF]', staged_srt_text))
        if staged_ar_count < 30:
            log("HARDSUB", f"⚠️ Subtitle '{srt_path}' contains fewer than 30 Arabic characters ({staged_ar_count}); using original video.")
            return video_path
        log("SUBS", f"ℹ️ Subtitle sanitized and verified ({staged_ar_count} Arabic characters).")
    except Exception as e:
        log("HARDSUB", f"⚠️ Error validating staged subtitle file: {e}; using original video.")
        return video_path

    # 2. Convert sanitized SRT to ASS with embedded Arabic font style
    # (eliminates dependency on libass force_style font lookup)
    use_ass = False
    try:
        ass_path = convert_srt_to_ass(staged_clean_srt, output_ass_path=staged_sub_ass, offset_seconds=0.0)
        if ass_path and os.path.exists(ass_path) and os.path.getsize(ass_path) > 0:
            staged_sub_ass = ass_path
            use_ass = True
            log("HARDSUB", f"✅ Converted SRT -> ASS with embedded Noto Sans Arabic style ({os.path.getsize(staged_sub_ass)} bytes).")
        else:
            log("HARDSUB", "⚠️ ASS file missing or 0 bytes; falling back to SRT with force_style.")
    except Exception as e:
        log("HARDSUB", f"⚠️ ASS conversion notice: {e}; falling back to SRT with force_style.")
        use_ass = False

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

    if os.path.exists(staged_output):
        try: os.remove(staged_output)
        except Exception: pass

    # Hardware acceleration detection & encoder argument resolution
    accel = detect_hardware_acceleration()
    v_args_1080p = accel["video_args_1080p"]

    fonts_dir = get_system_fonts_dir()
    fonts_dir_escaped = fonts_dir.replace("\\", "/").replace(":", r"\:")

    # Construct subtitle filter: prioritize ASS file, only falling back to SRT if ASS is missing or empty
    if use_ass and os.path.exists(staged_sub_ass) and os.path.getsize(staged_sub_ass) > 0:
        sub_filter_rel = f"subtitles='sub.ass':fontsdir='{fonts_dir_escaped}'"
    else:
        use_ass = False
        sub_style = "FontName=Noto Sans Arabic,FontSize=70,Bold=1,Outline=4.0,Shadow=1.5,MarginL=35,MarginR=35,MarginV=52,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Alignment=2"
        sub_filter_rel = f"subtitles='sub.srt':fontsdir='{fonts_dir_escaped}':force_style='{sub_style}'"

    # 4K Pre-scale Detection: If source is > 1080p (2160p/4K/UHD), prepend scale filter
    # before subtitle burn-in to avoid libass rendering on 8.3M-pixel frames (boosts NVENC 0.4x -> 2.5x)
    is_4k_source = False
    try:
        ffprobe_bin = shutil.which("ffprobe")
        if ffprobe_bin:
            probe_cmd = [ffprobe_bin, "-v", "error", "-select_streams", "v:0",
                         "-show_entries", "stream=height", "-of", "csv=p=0", video_abs_path]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=15)
            if probe_result.returncode == 0:
                source_height = int(probe_result.stdout.strip())
                if source_height > 1100:
                    is_4k_source = True
                    log("HARDSUB", f"4K/UHD source detected ({source_height}p). Pre-scaling to 1080p before subtitle rendering.")
    except Exception as e:
        log("HARDSUB", f"ffprobe height detection notice: {e}")
    # Filename-based fallback detection if ffprobe didn't detect
    if not is_4k_source:
        input_basename = os.path.basename(video_path).lower()
        if any(tag in input_basename for tag in ["2160p", "2160", "4k", "uhd"]):
            is_4k_source = True
            log("HARDSUB", "4K/UHD source detected (filename match). Pre-scaling to 1080p before subtitle rendering.")

    if is_4k_source:
        if use_ass:
            sub_filter_rel = f"scale=-2:1080,subtitles='sub.ass':fontsdir='{fonts_dir_escaped}'"
        else:
            sub_filter_rel = f"scale=-2:1080,subtitles='sub.srt':fontsdir='{fonts_dir_escaped}':force_style='{sub_style}'"

    ffmpeg_log = os.path.join(staging_dir, "ffmpeg_process.log")
    log("HARDSUB", f"Burning Arabic subtitles into 1080p frames ({accel['description']}): output_1080p.mp4 in {staging_dir}...")
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-i", ffmpeg_input,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", sub_filter_rel,
        *v_args_1080p,
        "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        "output_1080p.mp4"
    ]

    with open(ffmpeg_log, "w", encoding="utf-8") as lf:
        proc = subprocess.run(cmd, stdout=lf, stderr=lf, cwd=staging_dir, timeout=14400)
    # Parse FFmpeg log for libass font selection diagnostic
    try:
        with open(ffmpeg_log, "r", encoding="utf-8", errors="replace") as diag_f:
            ffmpeg_output = diag_f.read()
        for diag_line in ffmpeg_output.split('\n'):
            if 'fontselect:' in diag_line.lower() or 'font provider' in diag_line.lower():
                log("HARDSUB", f"libass font diagnostic: {diag_line.strip()}")
    except Exception:
        pass

    if proc.returncode != 0:
        err_snippet = ""
        try:
            with open(ffmpeg_log, "r", encoding="utf-8", errors="replace") as ef:
                err_snippet = "".join(ef.readlines()[-15:]).strip()
        except Exception:
            pass
        log("HARDSUB", f"Notice on relative subtitle filter ({proc.returncode}): {err_snippet}. Retrying with escaped absolute subtitle path...")
        if use_ass:
            sub_abs_escaped = os.path.abspath(staged_sub_ass).replace("\\", "/").replace(":", r"\:")
            if is_4k_source:
                sub_filter_abs = f"scale=-2:1080,subtitles='{sub_abs_escaped}':fontsdir='{fonts_dir_escaped}'"
            else:
                sub_filter_abs = f"subtitles='{sub_abs_escaped}':fontsdir='{fonts_dir_escaped}'"
        else:
            sub_abs_escaped = os.path.abspath(staged_clean_srt).replace("\\", "/").replace(":", r"\:")
            if is_4k_source:
                sub_filter_abs = f"scale=-2:1080,subtitles='{sub_abs_escaped}':fontsdir='{fonts_dir_escaped}':force_style='{sub_style}'"
            else:
                sub_filter_abs = f"subtitles='{sub_abs_escaped}':fontsdir='{fonts_dir_escaped}':force_style='{sub_style}'"
        cmd_abs = [
            "ffmpeg", "-y", "-nostdin",
            "-i", ffmpeg_input,
            "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", sub_filter_abs,
            *v_args_1080p,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2",
            "output_1080p.mp4"
        ]
        with open(ffmpeg_log, "a", encoding="utf-8") as lf:
            proc = subprocess.run(cmd_abs, stdout=lf, stderr=lf, cwd=staging_dir, timeout=14400)

        # Dynamic fallback: If NVENC failed, try multi-threaded CPU libx264 as safeguard
        if proc.returncode != 0 and accel["mode"] == "nvenc":
            log("HARDSUB", "⚠️ NVENC hardware encode failed; dynamically falling back to multi-threaded CPU libx264...")
            cpu_args_1080p = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-threads", "0"]
            cmd_cpu = [
                "ffmpeg", "-y", "-nostdin",
                "-i", ffmpeg_input,
                "-map", "0:v:0", "-map", "0:a:0?",
                "-vf", sub_filter_abs,
                *cpu_args_1080p,
                "-c:a", "aac", "-b:a", "192k", "-ac", "2",
                "output_1080p.mp4"
            ]
            with open(ffmpeg_log, "a", encoding="utf-8") as lf:
                proc = subprocess.run(cmd_cpu, stdout=lf, stderr=lf, cwd=staging_dir, timeout=14400)

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
    Directly downscales 1080p hardsubbed video to 720p using fast scaling.
    Dynamically applies GPU (NVENC p4, cq 24) or CPU (libx264 veryfast, crf 24, all cores) acceleration.
    """
    staging_dir = os.path.dirname(input_1080p_path) or ("/content/staging" if os.path.exists("/content") else os.path.abspath("./staging_temp"))
    os.makedirs(staging_dir, exist_ok=True)
    if not output_720p_path:
        output_720p_path = os.path.join(staging_dir, "output_720p.mp4")

    if os.path.exists(output_720p_path):
        try: os.remove(output_720p_path)
        except Exception: pass

    accel = detect_hardware_acceleration()
    v_args_720p = accel["video_args_720p"]

    ffmpeg_log = os.path.join(staging_dir, "ffmpeg_process.log")
    log("HARDSUB", f"Downscaling to 720p (scale=-2:720, {accel['description']}): {os.path.basename(input_1080p_path)} -> {os.path.basename(output_720p_path)}...")
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-i", input_1080p_path,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=-2:720",
        *v_args_720p,
        "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        output_720p_path
    ]
    with open(ffmpeg_log, "a", encoding="utf-8") as lf:
        proc = subprocess.run(cmd, stdout=lf, stderr=lf, timeout=14400)

    # Dynamic fallback: if NVENC failed, try multi-threaded CPU libx264
    if proc.returncode != 0 and accel["mode"] == "nvenc":
        log("HARDSUB", "⚠️ NVENC 720p downscaling failed; dynamically falling back to multi-threaded CPU libx264...")
        cpu_args_720p = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "24", "-threads", "0"]
        cmd_cpu = [
            "ffmpeg", "-y", "-nostdin",
            "-i", input_1080p_path,
            "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", "scale=-2:720",
            *cpu_args_720p,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2",
            output_720p_path
        ]
        with open(ffmpeg_log, "a", encoding="utf-8") as lf:
            proc = subprocess.run(cmd_cpu, stdout=lf, stderr=lf, timeout=14400)

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


def generate_60s_preview_sample(
    video_path: str,
    srt_path: str,
    preview_start_time: str = "00:02:30",
    sub_offset_seconds: float = 0.0,
    output_path: str = None
) -> str:
    """
    Generate a fast 60-second preview clip with burned-in Arabic subtitles:
    1. Extracts a 60-second video segment starting at preview_start_time.
    2. Slices the sanitized Arabic subtitles to match that 60-second window.
    3. Burns subtitles into preview_sample.mp4 in ~10 seconds.
    """
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg not found in PATH; cannot generate preview sample.")

    preview_dir = "/content/preview" if os.path.exists("/content") else os.path.abspath("./staging_temp/preview")
    os.makedirs(preview_dir, exist_ok=True)

    if not output_path:
        output_path = os.path.join(preview_dir, "preview_sample.mp4")

    preview_raw_clip = os.path.join(preview_dir, "clip_60s_raw.mp4")
    preview_sliced_srt = os.path.join(preview_dir, "preview_sub.srt")

    for p in [preview_raw_clip, preview_sliced_srt, output_path]:
        if os.path.exists(p):
            try: os.remove(p)
            except Exception: pass

    preview_start_sec = parse_time_to_seconds(preview_start_time)
    log("PREVIEW", f"🎬 Extracting 60s video clip at start time {preview_start_time} ({preview_start_sec}s)...")

    # Fast 60s clip extraction with ultrafast re-encode for keyframe accuracy
    extract_cmd = [
        ffmpeg_bin, "-y", "-nostdin",
        "-ss", str(preview_start_time),
        "-i", video_path,
        "-t", "60",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        preview_raw_clip
    ]
    res = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=90)
    if res.returncode != 0 or not os.path.exists(preview_raw_clip) or os.path.getsize(preview_raw_clip) == 0:
        raise RuntimeError(f"FFmpeg failed to extract 60s preview clip: {res.stderr[-300:] if res.stderr else 'unknown error'}")

    log("PREVIEW", f"✅ 60s raw clip extracted ({os.path.getsize(preview_raw_clip) / (1024*1024):.2f} MB)")

    # Slice subtitles for the 60s preview window
    has_subs = False
    preview_sub_file = preview_sliced_srt  # default to SRT
    if srt_path and os.path.exists(srt_path):
        # Single-pass sanitization: copy raw -> sanitize_srt_file once
        import shutil as _shutil_copy
        temp_clean = os.path.join(preview_dir, "temp_sub.srt")
        _shutil_copy.copy2(srt_path, temp_clean)
        sanitize_srt_file(temp_clean, temp_clean, offset_seconds=sub_offset_seconds)
        with open(temp_clean, "r", encoding="utf-8") as tf:
            full_clean = tf.read()
        try: os.remove(temp_clean)
        except Exception: pass

        sliced_srt = slice_srt_content_for_preview(full_clean, preview_start_sec, 60.0)
        if sliced_srt.strip():
            with open(preview_sliced_srt, "w", encoding="utf-8", newline="\n") as sf:
                sf.write(sliced_srt)
            has_subs = True
            log("PREVIEW", "✅ Sliced Arabic subtitles for 60s preview window.")

            # Convert sliced SRT to ASS for reliable font embedding
            try:
                preview_sub_ass = os.path.join(preview_dir, "preview_sub.ass")
                ass_path = convert_srt_to_ass(preview_sliced_srt, output_ass_path=preview_sub_ass, offset_seconds=0.0)
                if ass_path and os.path.exists(ass_path) and os.path.getsize(ass_path) > 0:
                    preview_sub_file = ass_path
                    log("PREVIEW", f"✅ Converted sliced SRT -> ASS with embedded Arabic font style ({os.path.getsize(ass_path)} bytes).")
                else:
                    log("PREVIEW", "⚠️ ASS output missing or 0 bytes; falling back to SRT with force_style.")
            except Exception as ass_err:
                log("PREVIEW", f"ASS conversion notice: {ass_err}; using SRT with force_style fallback.")
        else:
            log("PREVIEW", "⚠️ No subtitle dialogue entries fell within this 60s window.")

    # Burn subtitles into preview sample in ~10 seconds
    log("PREVIEW", "🔥 Burning subtitles into 60s preview sample...")
    fonts_dir = get_system_fonts_dir()
    fonts_dir_escaped = fonts_dir.replace('\\', '/').replace(':', r'\:')

    burn_cmd = [ffmpeg_bin, "-y", "-nostdin", "-i", preview_raw_clip]
    if has_subs and os.path.exists(preview_sub_file) and os.path.getsize(preview_sub_file) > 0:
        escaped_sub = preview_sub_file.replace('\\', '/').replace(':', r'\:')
        if preview_sub_file.endswith('.ass'):
            sub_filter = f"subtitles='{escaped_sub}':fontsdir='{fonts_dir_escaped}'"
        else:
            sub_style = "FontName=Noto Sans Arabic,FontSize=70,Bold=1,Outline=4.0,Shadow=1.5,MarginL=35,MarginR=35,MarginV=52,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Alignment=2"
            sub_filter = f"subtitles='{escaped_sub}':fontsdir='{fonts_dir_escaped}':force_style='{sub_style}'"
        burn_cmd.extend(["-vf", sub_filter])
    burn_cmd.extend([
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
        "-c:a", "copy",
        output_path
    ])

    burn_res = subprocess.run(burn_cmd, capture_output=True, text=True, timeout=90)
    # Parse libass font selection diagnostic from preview burn
    if burn_res.stderr:
        for diag_line in burn_res.stderr.split('\n'):
            if 'fontselect:' in diag_line.lower() or 'font provider' in diag_line.lower():
                log("PREVIEW", f"libass font diagnostic: {diag_line.strip()}")
    if burn_res.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RuntimeError(f"FFmpeg failed to burn subtitles into preview: {burn_res.stderr[-300:] if burn_res.stderr else 'unknown error'}")

    sample_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    log("PREVIEW", f"🎉 Preview sample generated successfully: {output_path} ({sample_size_mb:.2f} MB)")
    return output_path

# =============================================================================
# 5. STREAMING HOST UPLOAD (DOODSTREAM API) WITH RESILIENCE & RETRIES
# =============================================================================
# =============================================================================
# 5. MULTI-SERVER STREAMING HOST UPLOAD ENGINES (VIDMOLY, STREAMHG, STREAMTAPE, DOODSTREAM)
# =============================================================================

def upload_to_vidmoly(video_path: str, api_key: str = VIDMOLY_API_KEY, max_retries: int = 3) -> str:
    """
    Upload local video file to Vidmoly API and return clean embed URL: https://vidmoly.me/embed-{filecode}.html
    1. Requests upload server slot: GET https://vidmoly.me/api/upload/server?key={api_key} (fallback vidmoly.to)
    2. POST multipart video file to returned server URL.
    3. Extracts filecode and returns clean embed URL.
    Graceful handling: logs warning and returns None on failure.
    """
    if not api_key:
        log("VIDMOLY", "⚠️ VIDMOLY_API_KEY is not configured; skipping Vidmoly upload.")
        return None

    if not os.path.exists(video_path):
        log("VIDMOLY", f"⚠️ Video file does not exist: {video_path}")
        return None

    filename = os.path.basename(video_path)
    file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
    mirrors = ["https://vidmoly.me", "https://vidmoly.to"]

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            log("VIDMOLY", f"Requesting Vidmoly upload server (Attempt {attempt}/{max_retries})...")
            upload_url = None
            sess_id = None
            for mirror in mirrors:
                try:
                    srv_resp = requests.get(
                        f"{mirror}/api/upload/server",
                        params={"key": api_key},
                        headers=HEADERS,
                        timeout=15
                    )
                    if srv_resp.status_code == 200:
                        data = srv_resp.json()
                        if data.get("result"):
                            upload_url = data.get("result")
                            sess_id = data.get("sess_id")
                            break
                except Exception:
                    continue

            if not upload_url:
                raise RuntimeError("Failed to allocate Vidmoly upload server across active mirrors")

            log("VIDMOLY", f"Assigned server: {upload_url[:50]}... Uploading '{filename}' ({file_size_mb:.1f} MB)...")

            if HAS_TOOLBELT:
                with open(video_path, 'rb') as f:
                    encoder = MultipartEncoder(fields={
                        'sess_id': sess_id or '',
                        'key': api_key,
                        'api_key': api_key,
                        'file': (filename, f, 'video/mp4')
                    })
                    last_pct = [-1]
                    def progress(monitor):
                        pct = int((monitor.bytes_read / monitor.len) * 100)
                        if pct % 10 == 0 and pct != last_pct[0]:
                            last_pct[0] = pct
                            print(f"  [Vidmoly Progress] {pct}% ({monitor.bytes_read / (1024*1024):.1f} MB / {monitor.len / (1024*1024):.1f} MB)", flush=True)
                    monitor = MultipartEncoderMonitor(encoder, progress)
                    resp = requests.post(
                        upload_url,
                        data=monitor,
                        headers={'Content-Type': monitor.content_type, 'User-Agent': HEADERS["User-Agent"]},
                        timeout=600
                    )
            else:
                with open(video_path, 'rb') as f:
                    resp = requests.post(
                        upload_url,
                        files={'file': (filename, f, 'video/mp4')},
                        data={
                            'sess_id': sess_id or '',
                            'key': api_key,
                            'api_key': api_key
                        },
                        headers={'User-Agent': HEADERS["User-Agent"]},
                        timeout=600
                    )

            resp_text = resp.text

            # 1. Primary Vidmoly HTML Textarea Response Parser:
            # e.g. <textarea name="op">upload_result</textarea><textarea name="fn">{filecode}</textarea><textarea name="st">OK</textarea>
            match = re.search(r'<textarea\s+name=["\']fn["\']>([a-zA-Z0-9]+)</textarea>', resp_text, re.IGNORECASE)
            if not match:
                match = re.search(r'name=["\']fn["\']>([^<]+)<', resp_text)
            if match:
                filecode = match.group(1).strip()
                if filecode:
                    embed_url = f"https://vidmoly.me/embed-{filecode}.html"
                    log("VIDMOLY", f"✅ Upload successful! Embed: {embed_url}")
                    return embed_url

            # 2. JSON & Legacy Fallbacks
            filecode = None
            try:
                rj = resp.json()
                filecode = (
                    rj.get("files", [{}])[0].get("filecode")
                    or rj.get("result", [{}])[0].get("filecode")
                    or rj.get("filecode")
                    or rj.get("file_code")
                )
            except Exception:
                pass

            if not filecode:
                m = re.search(r'name=["\']file_code["\']>([^<]+)<', resp_text)
                if not m:
                    m = re.search(r'name=["\']filecode["\']>([^<]+)<', resp_text)
                if not m:
                    m = re.search(r'["\'](?:filecode|file_code)["\']\s*:\s*["\']([^"\']+)["\']', resp_text)
                if not m:
                    m = re.search(r'/embed-([a-zA-Z0-9]+)\.html', resp_text)
                if m:
                    filecode = m.group(1).strip()

            if not filecode:
                raise RuntimeError(f"Could not parse Vidmoly filecode from response: {resp_text[:300]}")

            embed_url = f"https://vidmoly.me/embed-{filecode}.html"
            log("VIDMOLY", f"✅ Upload successful! Embed: {embed_url}")
            return embed_url

        except Exception as e:
            last_error = e
            log("VIDMOLY", f"Upload attempt {attempt} notice: {e.__class__.__name__}: {e}")
            if attempt < max_retries:
                wait_sec = attempt * 5
                log("VIDMOLY", f"Waiting {wait_sec}s before retrying...")
                time.sleep(wait_sec)

    log("VIDMOLY", f"⚠️ Vidmoly upload failed after {max_retries} attempts: {last_error}")
    return None

def upload_to_streamhg(video_path: str, api_key: str = STREAMHG_API_KEY, max_retries: int = 3) -> str:
    """
    Upload local video file to StreamHG API and return clean embed URL: https://hgcloud.to/e/{filecode}
    1. Requests upload server slot: GET https://streamhgapi.com/api/upload/server?key={api_key} (fallback streamhg.com)
    2. POST multipart video file to returned server URL with file and key.
    3. Extracts filecode and returns clean embed URL.
    Graceful handling: logs warning and returns None on failure.
    """
    if not api_key:
        log("STREAMHG", "⚠️ STREAMHG_API_KEY is not configured; skipping StreamHG upload.")
        return None

    if not os.path.exists(video_path):
        log("STREAMHG", f"⚠️ Video file does not exist: {video_path}")
        return None

    filename = os.path.basename(video_path)
    file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
    mirrors = ["https://streamhgapi.com", "https://streamhg.com"]

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            log("STREAMHG", f"Requesting StreamHG upload server (Attempt {attempt}/{max_retries})...")
            upload_url = None
            for mirror in mirrors:
                try:
                    srv_resp = requests.get(
                        f"{mirror}/api/upload/server",
                        params={"key": api_key},
                        headers=HEADERS,
                        timeout=15
                    )
                    if srv_resp.status_code == 200:
                        data = srv_resp.json()
                        if data.get("result"):
                            upload_url = data["result"]
                            break
                except Exception:
                    continue

            if not upload_url:
                raise RuntimeError("Failed to allocate StreamHG upload server across active mirrors")

            log("STREAMHG", f"Assigned server: {upload_url[:50]}... Uploading '{filename}' ({file_size_mb:.1f} MB)...")

            if HAS_TOOLBELT:
                with open(video_path, 'rb') as f:
                    encoder = MultipartEncoder(fields={
                        'file': (filename, f, 'video/mp4'),
                        'key': api_key
                    })
                    last_pct = [-1]
                    def progress(monitor):
                        pct = int((monitor.bytes_read / monitor.len) * 100)
                        if pct % 10 == 0 and pct != last_pct[0]:
                            last_pct[0] = pct
                            print(f"  [StreamHG Progress] {pct}% ({monitor.bytes_read / (1024*1024):.1f} MB / {monitor.len / (1024*1024):.1f} MB)", flush=True)
                    monitor = MultipartEncoderMonitor(encoder, progress)
                    resp = requests.post(
                        upload_url,
                        data=monitor,
                        headers={'Content-Type': monitor.content_type, 'User-Agent': HEADERS["User-Agent"]},
                        timeout=7200
                    )
            else:
                with open(video_path, 'rb') as f:
                    resp = requests.post(
                        upload_url,
                        files={'file': (filename, f, 'video/mp4')},
                        data={'key': api_key},
                        headers={'User-Agent': HEADERS["User-Agent"]},
                        timeout=7200
                    )

            resp_text = resp.text
            filecode = None
            try:
                rj = resp.json()
                files = rj.get("files", [])
                if files and isinstance(files, list):
                    filecode = files[0].get("filecode") or files[0].get("file_code")
                if not filecode and rj.get("result"):
                    res_val = rj["result"]
                    if isinstance(res_val, list) and res_val:
                        filecode = res_val[0].get("filecode") or res_val[0].get("file_code")
                    elif isinstance(res_val, dict):
                        filecode = res_val.get("filecode") or res_val.get("file_code")
                if not filecode:
                    filecode = rj.get("filecode") or rj.get("file_code")
            except Exception:
                pass

            if not filecode:
                m = re.search(r'["\'](?:filecode|file_code)["\']\s*:\s*["\']([^"\']+)["\']', resp_text)
                if not m:
                    m = re.search(r'/e/([a-zA-Z0-9]+)', resp_text)
                if m:
                    filecode = m.group(1).strip()

            if not filecode:
                raise RuntimeError(f"Could not parse StreamHG filecode from response: {resp_text[:300]}")

            embed_url = f"https://hgcloud.to/e/{filecode}"
            log("STREAMHG", f"✅ Upload successful! Filecode: {filecode} -> {embed_url}")
            return embed_url

        except Exception as e:
            last_error = e
            log("STREAMHG", f"Upload attempt {attempt} notice: {e.__class__.__name__}: {e}")
            if attempt < max_retries:
                wait_sec = attempt * 5
                log("STREAMHG", f"Waiting {wait_sec}s before retrying...")
                time.sleep(wait_sec)

    log("STREAMHG", f"⚠️ StreamHG upload failed after {max_retries} attempts: {last_error}")
    return None

def upload_to_doodstream(video_path: str, api_key: str = DOODSTREAM_API_KEY, max_retries: int = 3) -> str:
    """
    Upload local video file to DoodStream API using chunked streaming.
    Includes retry loop and requests a fresh server URL on disconnect/timeout.
    """
    if not api_key:
        log("DOOD", "⚠️ DOODSTREAM_API_KEY is not configured; skipping DoodStream upload.")
        return None

    if not os.path.exists(video_path):
        log("DOOD", f"⚠️ Video file does not exist: {video_path}")
        return None

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
            log("DOOD", f"✅ Upload successful! File Code: {file_code} -> {embed_url}")
            return embed_url

        except Exception as e:
            last_error = e
            log("DOOD", f"Upload attempt {attempt} encountered error: {e.__class__.__name__}: {e}")
            if attempt < max_retries:
                wait_time = attempt * 7
                log("DOOD", f"Waiting {wait_time}s before allocating a fresh server and retrying...")
                time.sleep(wait_time)

    log("DOOD", f"⚠️ DoodStream upload failed after {max_retries} attempts: {last_error}")
    return None

def upload_to_streamtape(video_path: str, login: str = STREAMTAPE_LOGIN, key: str = STREAMTAPE_KEY, max_retries: int = 3) -> str:
    """
    Upload local video file to Streamtape API.
    1. Obtains upload server URL from https://api.streamtape.com/file/ul?login={login}&key={key}
    2. Uploads video via multipart form.
    3. Returns clean embed URL: https://streamtape.com/e/{file_id}
    """
    if not login or not key:
        log("STREAMTAPE", "⚠️ STREAMTAPE_LOGIN or STREAMTAPE_KEY is not configured; skipping Streamtape upload.")
        return None

    if not os.path.exists(video_path):
        log("STREAMTAPE", f"⚠️ Video file does not exist: {video_path}")
        return None

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
            log("STREAMTAPE", f"✅ Upload successful! File ID: {file_id} -> {embed_url}")
            return embed_url

        except Exception as e:
            last_error = e
            log("STREAMTAPE", f"Upload attempt {attempt} encountered error: {e.__class__.__name__}: {e}")
            if attempt < max_retries:
                wait_time = attempt * 5
                log("STREAMTAPE", f"Waiting {wait_time}s before retrying...")
                time.sleep(wait_time)

    log("STREAMTAPE", f"⚠️ Streamtape upload failed after {max_retries} attempts: {last_error}")
    return None

def generate_multi_server_player_html(active_servers: dict, fallback_url: str = "") -> str:
    """
    Generate a responsive, self-contained HTML/CSS/JS Multi-Server Player Switcher.
    Displays tab buttons for each active server, highlighting the active tab with smooth
    CSS transitions, and dynamic 16:9 iframe switching without page reload.
    """
    if not active_servers and fallback_url:
        active_servers = {"السيرفر الأساسي": fallback_url}

    if not active_servers:
        return ""

    server_items = list(active_servers.items())
    first_name, first_url = server_items[0]

    tab_buttons_html = []
    for idx, (s_name, s_url) in enumerate(server_items):
        is_first = (idx == 0)
        btn_style = (
            "background: #e11d48; color: #ffffff; border-color: #f43f5e;"
            if is_first else
            "background: #334155; color: #cbd5e1; border-color: #475569;"
        )
        label = s_name
        s_lower = s_name.lower()
        if "vidmoly" in s_lower:
            label = "سيرفر 1 - Vidmoly [سريع جداً 1080p]"
        elif "streamhg" in s_lower:
            label = "سيرفر 2 - StreamHG [خفيف 720p]"
        elif "streamtape" in s_lower:
            label = "سيرفر 3 - Streamtape [سرعة عالية]"
        elif "dood" in s_lower:
            label = "سيرفر 4 - Doodstream [جودة أصلية]"

        tab_buttons_html.append(
            f'<button type="button" class="server-tab-btn" data-url="{s_url}" '
            f'onclick="switchPlayerServer(this, \'{s_url}\')" '
            f'style="padding: 7px 15px; font-size: 0.82rem; font-weight: 600; border-radius: 8px; border: 1px solid; cursor: pointer; transition: all 0.25s ease; outline: none; margin: 3px; {btn_style}">'
            f'{label}'
            f'</button>'
        )

    tabs_joined = "\n        ".join(tab_buttons_html)

    vidmoly_val = active_servers.get("Vidmoly (1080p)") or active_servers.get("Vidmoly") or ""
    streamhg_val = active_servers.get("StreamHG (720p)") or active_servers.get("StreamHG") or ""
    streamtape_val = active_servers.get("Streamtape") or ""
    dood_val = active_servers.get("Doodstream") or ""

    return f"""<div class="egymax-player-wrapper" style="direction: rtl; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin-bottom: 2rem; background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);">
    <div class="player-servers-tabs" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px; background: #1e293b; border-bottom: 1px solid #334155;">
        <span style="display: inline-flex; align-items: center; color: #94a3b8; font-size: 0.85rem; font-weight: 600; margin-left: 8px;">
            📺 اختر السيرفر:
        </span>
        {tabs_joined}
    </div>
    <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; background: #000;">
        <iframe id="main-player-iframe" src="{first_url}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allowfullscreen="true" scrolling="no" frameborder="0"></iframe>
    </div>
</div>
<!-- SERVERS: vidmoly={vidmoly_val} streamhg={streamhg_val} streamtape={streamtape_val} dood={dood_val} -->
<script>
function switchPlayerServer(btn, streamUrl) {{
    var iframe = document.getElementById('main-player-iframe');
    if (iframe && streamUrl) {{
        iframe.src = streamUrl;
    }}
    var tabs = document.querySelectorAll('.server-tab-btn');
    for (var i = 0; i < tabs.length; i++) {{
        tabs[i].style.background = '#334155';
        tabs[i].style.color = '#cbd5e1';
        tabs[i].style.borderColor = '#475569';
    }}
    if (btn) {{
        btn.style.background = '#e11d48';
        btn.style.color = '#ffffff';
        btn.style.borderColor = '#f43f5e';
    }}
}}
</script>"""

def upload_by_quality(video_path: str, quality: str = "1080p") -> dict:
    """
    Quality Distribution Logic:
    - 1080p Quality: Uploaded to Vidmoly (Server 1) & Doodstream (Server 4)
    - 720p Quality:  Uploaded to StreamHG (Server 2) & Streamtape (Server 3)
    Returns: {"primary_embed": str, "vidmoly_embed": str, "streamhg_embed": str, "dood_embed": str, "streamtape_embed": str, "quality": str, "active_servers": dict}
    """
    q_norm = quality.lower().strip()
    active_servers = {}
    vidmoly_url = None
    streamhg_url = None
    streamtape_url = None
    dood_url = None

    if "720" in q_norm:
        log("UPLOAD", "Quality is 720p -> Routing upload to StreamHG (Server 2) & Streamtape (Server 3)...")
        try: streamhg_url = upload_to_streamhg(video_path)
        except Exception: streamhg_url = None
        try: streamtape_url = upload_to_streamtape(video_path)
        except Exception: streamtape_url = None
        if not streamhg_url and not streamtape_url:
            log("UPLOAD", "720p hosts unavailable; falling back to Vidmoly & Doodstream...")
            try: vidmoly_url = upload_to_vidmoly(video_path)
            except Exception: vidmoly_url = None
            try: dood_url = upload_to_doodstream(video_path)
            except Exception: dood_url = None
    else:
        log("UPLOAD", f"Quality is {quality} (1080p FHD) -> Routing upload to Vidmoly (Server 1) & Doodstream (Server 4)...")
        try: vidmoly_url = upload_to_vidmoly(video_path)
        except Exception: vidmoly_url = None
        try: dood_url = upload_to_doodstream(video_path)
        except Exception: dood_url = None
        if not vidmoly_url and not dood_url:
            log("UPLOAD", "1080p hosts unavailable; falling back to StreamHG & Streamtape...")
            try: streamhg_url = upload_to_streamhg(video_path)
            except Exception: streamhg_url = None
            try: streamtape_url = upload_to_streamtape(video_path)
            except Exception: streamtape_url = None

    if vidmoly_url: active_servers["Vidmoly (1080p)" if "1080" in quality else "Vidmoly"] = vidmoly_url
    if streamhg_url: active_servers["StreamHG (720p)" if "720" in quality else "StreamHG"] = streamhg_url
    if streamtape_url: active_servers["Streamtape"] = streamtape_url
    if dood_url: active_servers["Doodstream"] = dood_url

    primary = vidmoly_url or streamhg_url or dood_url or streamtape_url
    return {
        "primary_embed": primary,
        "vidmoly_embed": vidmoly_url,
        "streamhg_embed": streamhg_url,
        "dood_embed": dood_url,
        "streamtape_embed": streamtape_url,
        "active_servers": active_servers,
        "quality": quality,
    }

def upload_to_multi_servers(video_path_1080p: str, video_path_720p: str = None, quality: str = "both") -> dict:
    """
    Upload across all 4 streaming hosts (Vidmoly 1080p, StreamHG 720p, Streamtape, Doodstream)
    to enable responsive multi-server switching in the player.
    """
    v_1080 = video_path_1080p
    v_720 = video_path_720p or video_path_1080p

    log("UPLOAD", "Executing 4-Server Upload Matrix (Vidmoly, StreamHG, Streamtape, Doodstream)...")
    vidmoly_url = upload_to_vidmoly(v_1080)
    streamhg_url = upload_to_streamhg(v_720)
    streamtape_url = upload_to_streamtape(v_720)
    dood_url = upload_to_doodstream(v_1080)

    active_servers = {}
    if vidmoly_url: active_servers["Vidmoly (1080p)"] = vidmoly_url
    if streamhg_url: active_servers["StreamHG (720p)"] = streamhg_url
    if streamtape_url: active_servers["Streamtape"] = streamtape_url
    if dood_url: active_servers["Doodstream"] = dood_url

    primary = vidmoly_url or streamhg_url or dood_url or streamtape_url
    if not primary:
        raise RuntimeError("Failed to upload to any of the 4 configured streaming servers.")

    return {
        "primary_embed": primary,
        "vidmoly_embed": vidmoly_url,
        "streamhg_embed": streamhg_url,
        "dood_embed": dood_url,
        "streamtape_embed": streamtape_url,
        "active_servers": active_servers,
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
    "Movies": ("أفلام", "movies"),
    "Movie": ("أفلام", "movies"),
    "أفلام": ("أفلام", "movies"),
    "Series": ("مسلسلات", "series"),
    "مسلسلات": ("مسلسلات", "series"),
    "TV Show": ("مسلسلات", "series"),
    "TV Series": ("مسلسلات", "series")
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
        if c_name == ar_name.lower() or c_name == clean_genre.lower() or c_slug == en_slug.lower() or c_slug == clean_genre.lower():
            return cat["id"]

    # 2. Category not found: auto-create via POST /wp/v2/categories
    create_url = f"{wp_site_url}/wp-json/wp/v2/categories"
    create_desc = "قسم الأفلام" if en_slug == "movies" else ("قسم المسلسلات" if en_slug == "series" else f"أفلام ومسلسلات تصنيف {ar_name}")
    create_payload = {
        "name": ar_name,
        "slug": en_slug,
        "description": create_desc
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
    Strictly isolates Movies ('أفلام' / slug: 'movies') from TV Episodes ('مسلسلات' / slug: 'series').
    """
    if isinstance(genres_raw, str):
        raw_list = [g.strip() for g in genres_raw.split(",") if g.strip()]
    elif isinstance(genres_raw, list):
        raw_list = [g.get("name", g) if isinstance(g, dict) else str(g).strip() for g in genres_raw]
    else:
        raw_list = []

    category_ids = []

    if is_episode:
        # TV Episode: MUST assign category 'مسلسلات' (slug: series)
        # Strictly exclude any movie categories
        raw_list = [g for g in raw_list if str(g).lower() not in ("movies", "movie", "أفلام", "افلام", "film", "films")]
        series_cid = get_or_create_category("Series", wp_site_url, auth)
        if series_cid and series_cid not in category_ids:
            category_ids.append(series_cid)
    else:
        # Movie: MUST assign category 'أفلام' (slug: movies)
        # Strictly exclude any series categories
        raw_list = [g for g in raw_list if str(g).lower() not in ("series", "tv show", "tv series", "مسلسلات", "مسلسل")]
        movie_cid = get_or_create_category("Movies", wp_site_url, auth)
        if movie_cid and movie_cid not in category_ids:
            category_ids.append(movie_cid)

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
    vidmoly_embed: str = None,
    streamhg_embed: str = None,
    active_servers: dict = None,
    wp_site_url: str = WP_SITE_URL,
    username: str = WP_USERNAME,
    app_password: str = WP_APP_PASSWORD,
    is_episode: bool = False,
    episode_data: dict = None
) -> dict:
    """
    Publish movie or TV episode post with responsive multi-server tabbed player switcher,
    linked category IDs, and full metadata into Pantheon Headless WordPress CMS.
    Saves _stream_vidmoly, _stream_streamhg, _stream_streamtape, _stream_doodstream into post meta.
    """
    is_ep = is_episode or meta.get("is_episode") or (meta.get("type") == "tv_episode")
    ep_data = episode_data or {}

    if is_ep:
        show_name = ep_data.get("show_name") or meta.get("show_name") or meta.get("title", "Series")
        season_num = ep_data.get("season_number") or meta.get("season_number") or 1
        episode_num = ep_data.get("episode_number") or meta.get("episode_number") or 1
        ep_tag = ep_data.get("episode_tag") or meta.get("episode_tag") or f"S{int(season_num):02d}E{int(episode_num):02d}"

        show_slug = re.sub(r'[^a-zA-Z0-9]+', '-', show_name.lower()).strip('-')
        clean_slug = re.sub(r'[^a-zA-Z0-9]+', '-', f"{show_name}-{ep_tag}".lower()).strip('-')
        title = f"{show_name} {ep_tag}"
        log("WP", f"Publishing TV Episode post to Pantheon: '{title}'...")

        seo_intro_paragraph = meta.get("seo_description") or f"مشاهدة وتحميل مسلسل {meta.get('title_ar') or show_name} الموسم {season_num} الحلقة {episode_num} ({ep_tag}) مترجمة كاملة بجودة 1080p BluRay عالية أون لاين."
        story_paragraph = meta.get("overview_ar") or meta.get("overview") or f"تدور أحداث الحلقة {episode_num} من الموسم {season_num} لمسلسل {show_name} في إطار درامي مشوق ومثير."
    else:
        show_slug = ""
        season_num = 0
        episode_num = 0
        ep_tag = ""
        clean_slug = re.sub(r'[^a-zA-Z0-9]+', '-', meta['title'].lower()).strip('-')
        title = f"{meta['title']} ({meta['year']})"
        log("WP", f"Publishing movie post to Pantheon: '{title}'...")

        seo_intro_paragraph = meta.get("seo_description") or f"مشاهدة وتحميل فيلم {meta.get('title_ar', meta['title'])} ({meta['year']}) مترجم كامل بجودة 1080p BluRay عالية أون لاين."
        story_paragraph = meta.get("overview_ar") or meta.get("overview") or "تدور أحداث الفيلم في إطار مشوق ومثير مليء بالأحداث غير المتوقعة والمغامرات الشيقة."

    poster_to_upload = meta.get("poster_url") or meta.get("backdrop_url")
    media_id = upload_poster_to_pantheon(poster_to_upload, clean_slug, wp_site_url, username, app_password)
    if not media_id and meta.get("backdrop_url") and meta.get("backdrop_url") != poster_to_upload:
        log("WP", "⚠️ Primary poster upload failed; attempting fallback upload using backdrop_url...")
        media_id = upload_poster_to_pantheon(meta.get("backdrop_url"), clean_slug, wp_site_url, username, app_password)

    # Format and preserve IMDb rating strictly as a decimal string (e.g. '8.5')
    imdb_rating = format_imdb_rating(meta.get("imdb_rating") or meta.get("rating"))
    if not imdb_rating:
        imdb_rating = "7.5"

    vidmoly_clean = vidmoly_embed or (embed_url if "vidmoly" in str(embed_url).lower() else "")
    streamhg_clean = streamhg_embed or (embed_url if "streamhg" in str(embed_url).lower() else "")
    dood_clean = dood_embed or (embed_url if "dood" in str(embed_url).lower() else "")
    streamtape_clean = streamtape_embed or (embed_url if "streamtape" in str(embed_url).lower() else "")

    if not active_servers:
        active_servers = {}
        if vidmoly_clean: active_servers["Vidmoly (1080p)" if "1080" in quality else "Vidmoly"] = vidmoly_clean
        if streamhg_clean: active_servers["StreamHG (720p)" if "720" in quality else "StreamHG"] = streamhg_clean
        if streamtape_clean: active_servers["Streamtape"] = streamtape_clean
        if dood_clean: active_servers["Doodstream"] = dood_clean
        if not active_servers and embed_url:
            active_servers["السيرفر الأساسي"] = embed_url

    player_switcher_html = generate_multi_server_player_html(active_servers, fallback_url=embed_url)

    content = f"""
{player_switcher_html}

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
        "_stream_vidmoly": vidmoly_clean,
        "_stream_streamhg": streamhg_clean,
        "_stream_streamtape": streamtape_clean,
        "_stream_doodstream": dood_clean,
        "vidmoly_url": vidmoly_clean,
        "streamhg_url": streamhg_clean,
        "doodstream_url": dood_clean,
        "streamtape_url": streamtape_clean,
        "dood_embed": dood_clean,
        "streamtape_embed": streamtape_clean,
        "vidmoly_embed": vidmoly_clean,
        "streamhg_embed": streamhg_clean,
        "embed_url_1080p": vidmoly_clean or dood_clean or (embed_url if "1080" in quality else ""),
        "embed_url_720p": streamhg_clean or streamtape_clean or (embed_url if "720" in quality else ""),
        "video_year": str(meta.get("year", "2026")),
        "quality": quality,
        "poster_url": meta.get("poster_url") or meta.get("backdrop_url") or "",
        "backdrop_url": meta.get("backdrop_url") or meta.get("poster_url") or "",
        "genres": meta.get("genres", ""),
        "overview_ar": meta.get("overview_ar", ""),
        "cast": ", ".join(meta.get("cast", [])) if isinstance(meta.get("cast"), list) else str(meta.get("cast", "")),
        "title_ar": meta.get("title_ar", ""),
        "seo_description": seo_intro_paragraph,
        "type": "tv_episode" if is_ep else "movie",
        "show_slug": show_slug if is_ep else "",
        "series_slug": show_slug if is_ep else "",
        "show_title": (ep_data.get("show_name") or meta.get("show_name") or show_name) if is_ep else "",
        "series_name": (ep_data.get("show_name") or meta.get("show_name") or show_name) if is_ep else "",
        "season_number": int(season_num) if is_ep else "",
        "episode_number": int(episode_num) if is_ep else "",
        "episode_tag": ep_tag if is_ep else ""
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

# Aliases for compatibility across tools and caller workflows
publish_media_post = publish_movie_to_pantheon
create_wordpress_post = publish_movie_to_pantheon

# =============================================================================
# MASTER PIPELINE ORCHESTRATOR
# =============================================================================
def run_pipeline(
    movie_title: str,
    release_year: str = None,
    imdb_id: str = None,
    preferred_quality: str = "both",
    preview_mode: bool = False,
    preview_start_time: str = "00:02:30",
    sub_offset_seconds: float = 0.0
):
    """
    End-to-End Execution for Movies and TV Series Episodes:
    Detects Movie vs Episode -> TMDB / TV Metadata -> YTS (Movie) or EZTV (TV) Torrent
    -> aria2c (.mp4) -> Arabic .srt Download (OpenSubtitles v3 / Stremio)
    -> [PREVIEW MODE: 60s sample burn & inline player]
    -> FFmpeg 1080p Hardsubbing -> Subbed 720p Downscaling
    -> Multi-Server Upload (1080p to Doodstream, 720p to Streamtape)
    -> Pantheon Headless WP with doodstream_url & streamtape_url -> Immediate Cleanup
    """
    print("=" * 75)
    print("  EGYMAX CLOUD AUTOMATION PIPELINE (OPTIMIZED DUAL-QUALITY ENGINE)")
    if preview_mode:
        print(f"  ⚡ FAST 60S PREVIEW MODE ACTIVE (Start: {preview_start_time}, Offset: {sub_offset_seconds}s)")
    print("=" * 75)
    detect_hardware_acceleration()
    setup_environment()

    parsed = parse_media_item(movie_title)
    is_episode = parsed.get("is_episode", False)

    raw_video_path = None
    burned_1080p_path = None
    rendered_720p_path = None
    arabic_srt_path = None

    try:
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

            # 2. Fetch TV Torrent Source candidates
            target_imdb = meta.get("imdb_id") or target_imdb
            fetch_quality = "1080p" if preferred_quality in ("both", "multi", "all") else preferred_quality
            torrent_info = fetch_tv_torrent(parsed["show_name"], parsed["season_number"], parsed["episode_number"], target_imdb, fetch_quality)
            candidates = torrent_info.get("candidates") or [torrent_info]

            # 3. High-Speed aria2c Download with Candidate Fallback Loop (up to 6 tries)
            max_tries = min(6, len(candidates))
            target_candidate = candidates[0]
            for cand_idx in range(max_tries):
                candidate = candidates[cand_idx]
                download_source = candidate.get("torrent_url") or candidate.get("magnet_uri")
                cand_title = candidate.get("title", "Unknown")
                cand_seeds = candidate.get("seeds", 0)
                cand_file_idx = candidate.get("file_idx")
                log("PIPELINE", f"Attempting download candidate {cand_idx + 1}/{max_tries}: '{cand_title}' ({cand_seeds} seeds, source: {candidate.get('source', 'Unknown')})...")
                try:
                    raw_video_path = download_with_aria2(
                        download_source,
                        DOWNLOAD_DIR,
                        STAGING_DIR,
                        select_file=cand_file_idx,
                        season_num=parsed["season_number"],
                        episode_num=parsed["episode_number"],
                        is_season_pack=candidate.get("is_season_pack", False),
                        candidate_title=cand_title
                    )
                    if raw_video_path and os.path.exists(raw_video_path):
                        target_candidate = candidate
                        log("PIPELINE", f"✅ Successfully downloaded video candidate {cand_idx + 1}: {os.path.basename(raw_video_path)}")
                        break
                except Exception as e:
                    log("PIPELINE", f"⚠️ Torrent candidate {cand_idx + 1} failed or slow: {e}. Failing over to next candidate release...")
                    sanitize_download_dir(DOWNLOAD_DIR, STAGING_DIR)

            if not raw_video_path or not os.path.exists(raw_video_path):
                raise RuntimeError(f"All {max_tries} torrent candidates failed to download for TV episode '{parsed['show_name']} {parsed['episode_tag']}'.")

            # 4. Fetch Arabic Subtitles (.srt) targeting exact Season & Episode with source release prioritization
            source_title_info = target_candidate.get("title", "") if (isinstance(target_candidate, dict) and target_candidate.get("title")) else os.path.basename(raw_video_path)
            arabic_srt_path = download_subtitles_for_imdb(
                target_imdb, DOWNLOAD_DIR,
                season=parsed["season_number"],
                episode=parsed["episode_number"],
                source_title=source_title_info,
                release_type=source_title_info,
                video_path=raw_video_path
            )

            # Fast 60-Second Preview Mode Intercept
            if preview_mode:
                log("PREVIEW", f"⚡ PREVIEW_MODE is ON: Generating 60s sample at {preview_start_time} (offset={sub_offset_seconds}s)...")
                preview_sample_path = generate_60s_preview_sample(
                    raw_video_path,
                    arabic_srt_path,
                    preview_start_time=preview_start_time,
                    sub_offset_seconds=sub_offset_seconds
                )
                try:
                    import IPython.display as ipydisplay
                    import base64
                    with open(preview_sample_path, "rb") as vf:
                        video_b64 = base64.b64encode(vf.read()).decode("ascii")
                    html_code = f"""
                    <div style="margin: 20px 0; padding: 15px; background: #1a1a2e; border: 2px solid #e50914; border-radius: 10px; max-width: 760px;">
                        <h3 style="color: #fff; margin-top: 0; font-family: sans-serif;">🎬 60s Preview Sample ({preview_start_time} - {parsed['show_name']} {parsed['episode_tag']})</h3>
                        <p style="color: #bbb; font-size: 13px; font-family: sans-serif;">Verify subtitle sync, font rendering, and Arabic glyph shaping below before full render.</p>
                        <video width="720" height="405" controls autoplay style="border-radius: 8px; width: 100%; max-width: 720px;">
                            <source src="data:video/mp4;base64,{video_b64}" type="video/mp4">
                            Your browser does not support HTML5 video.
                        </video>
                    </div>
                    """
                    ipydisplay.display(ipydisplay.HTML(html_code))
                except Exception as e:
                    log("PREVIEW", f"Inline player notice: {e}")

                print("\n" + "=" * 75)
                print("  ⚡ 60-SECOND PREVIEW MODE COMPLETED!")
                print(f"  Sample File: {preview_sample_path}")
                print("  Multi-server uploading & publishing SKIPPED as requested.")
                print("  Review the sample above. Set PREVIEW_MODE = False when ready to produce!")
                print("=" * 75)
                return {"preview_mode": True, "preview_sample": preview_sample_path, "title": f"{parsed['show_name']} {parsed['episode_tag']}"}

            # 5. Burn Arabic Subtitles directly into 1080p video frames once
            burned_1080p_path = burn_arabic_subtitles(raw_video_path, arabic_srt_path, sub_offset_seconds=sub_offset_seconds)

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

            vidmoly_url = None
            streamhg_url = None
            streamtape_url = None
            dood_url = None
            active_servers = {}

            if preferred_quality in ("both", "multi", "all"):
                final_720p_filename = f"{clean_show}.{parsed['episode_tag']}.720p.Arabic.Hardsub.mp4"
                rendered_720p_path = os.path.join(file_dir, final_720p_filename)
                downscale_to_720p(burned_1080p_path, rendered_720p_path)

                # Server 1: Vidmoly (1080p HLS)
                log("UPLOAD", "Uploading 1080p Hardsub to Vidmoly (Server 1 - Primary 1080p HLS)...")
                try: vidmoly_url = upload_to_vidmoly(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Vidmoly error: {e}")

                # Server 2: StreamHG (720p Fast Adaptive)
                log("UPLOAD", "Uploading 720p Downscaled Hardsub to StreamHG (Server 2 - Fast 720p Adaptive)...")
                try: streamhg_url = upload_to_streamhg(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ StreamHG error: {e}")

                # Server 3: Streamtape (720p High Speed)
                log("UPLOAD", "Uploading 720p Downscaled Hardsub to Streamtape (Server 3 - High Speed)...")
                try: streamtape_url = upload_to_streamtape(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Streamtape error: {e}")

                # Server 4: Doodstream (1080p Extra / Monetization)
                log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 4 - Extra)...")
                try: dood_url = upload_to_doodstream(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Doodstream error: {e}")

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

                log("UPLOAD", "Uploading 720p Hardsub to Vidmoly (Server 1)...")
                try: vidmoly_url = upload_to_vidmoly(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Vidmoly error: {e}")
                log("UPLOAD", "Uploading 720p Hardsub to StreamHG (Server 2)...")
                try: streamhg_url = upload_to_streamhg(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ StreamHG error: {e}")
                log("UPLOAD", "Uploading 720p Hardsub to Streamtape (Server 3)...")
                try: streamtape_url = upload_to_streamtape(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Streamtape error: {e}")
                log("UPLOAD", "Uploading 720p Hardsub to Doodstream (Server 4)...")
                try: dood_url = upload_to_doodstream(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Doodstream error: {e}")
                active_quality = "720p"
            else:
                log("UPLOAD", "Uploading 1080p Hardsub to Vidmoly (Server 1)...")
                try: vidmoly_url = upload_to_vidmoly(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Vidmoly error: {e}")
                log("UPLOAD", "Uploading 1080p Hardsub to StreamHG (Server 2)...")
                try: streamhg_url = upload_to_streamhg(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ StreamHG error: {e}")
                log("UPLOAD", "Uploading 1080p Hardsub to Streamtape (Server 3)...")
                try: streamtape_url = upload_to_streamtape(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Streamtape error: {e}")
                log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 4)...")
                try: dood_url = upload_to_doodstream(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Doodstream error: {e}")
                active_quality = "1080p"

            if vidmoly_url:
                active_servers["Vidmoly (1080p)" if "1080" in active_quality else "Vidmoly"] = vidmoly_url
            if streamhg_url:
                active_servers["StreamHG (720p)" if "720" in active_quality else "StreamHG"] = streamhg_url
            if streamtape_url:
                active_servers["Streamtape"] = streamtape_url
            if dood_url:
                active_servers["Doodstream"] = dood_url

            primary_embed = vidmoly_url or streamhg_url or dood_url or streamtape_url
            if not primary_embed:
                raise RuntimeError("Failed to obtain embed URL from upload servers (Vidmoly, StreamHG, Doodstream, Streamtape all unavailable or failed).")

            # 6. Publish TV Episode post to Pantheon WordPress
            post_data = publish_movie_to_pantheon(
                meta,
                primary_embed,
                active_quality,
                dood_embed=dood_url,
                streamtape_embed=streamtape_url,
                vidmoly_embed=vidmoly_url,
                streamhg_embed=streamhg_url,
                active_servers=active_servers,
                is_episode=True,
                episode_data=parsed
            )

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

            # 4. Fetch Arabic Subtitles (.srt) with source release prioritization
            source_title_info = torrent_info.get("title", "") if isinstance(torrent_info, dict) else os.path.basename(raw_video_path)
            arabic_srt_path = download_subtitles_for_imdb(
                target_imdb, DOWNLOAD_DIR,
                source_title=source_title_info,
                release_type=source_title_info,
                video_path=raw_video_path
            )

            # Fast 60-Second Preview Mode Intercept
            if preview_mode:
                log("PREVIEW", f"⚡ PREVIEW_MODE is ON: Generating 60s sample at {preview_start_time} (offset={sub_offset_seconds}s)...")
                preview_sample_path = generate_60s_preview_sample(
                    raw_video_path,
                    arabic_srt_path,
                    preview_start_time=preview_start_time,
                    sub_offset_seconds=sub_offset_seconds
                )
                try:
                    import IPython.display as ipydisplay
                    import base64
                    with open(preview_sample_path, "rb") as vf:
                        video_b64 = base64.b64encode(vf.read()).decode("ascii")
                    movie_display_name = meta.get("title") or movie_title
                    html_code = f"""
                    <div style="margin: 20px 0; padding: 15px; background: #1a1a2e; border: 2px solid #e50914; border-radius: 10px; max-width: 760px;">
                        <h3 style="color: #fff; margin-top: 0; font-family: sans-serif;">🎬 60s Preview Sample ({preview_start_time} - {movie_display_name})</h3>
                        <p style="color: #bbb; font-size: 13px; font-family: sans-serif;">Verify subtitle sync, font rendering, and Arabic glyph shaping below before full render.</p>
                        <video width="720" height="405" controls autoplay style="border-radius: 8px; width: 100%; max-width: 720px;">
                            <source src="data:video/mp4;base64,{video_b64}" type="video/mp4">
                            Your browser does not support HTML5 video.
                        </video>
                    </div>
                    """
                    ipydisplay.display(ipydisplay.HTML(html_code))
                except Exception as e:
                    log("PREVIEW", f"Inline player notice: {e}")

                print("\n" + "=" * 75)
                print("  ⚡ 60-SECOND PREVIEW MODE COMPLETED!")
                print(f"  Sample File: {preview_sample_path}")
                print("  Multi-server uploading & publishing SKIPPED as requested.")
                print("  Review the sample above. Set PREVIEW_MODE = False when ready to produce!")
                print("=" * 75)
                return {"preview_mode": True, "preview_sample": preview_sample_path, "title": meta.get("title") or movie_title}

            # 5. Burn Arabic Subtitles directly into 1080p video frames once
            burned_1080p_path = burn_arabic_subtitles(raw_video_path, arabic_srt_path, sub_offset_seconds=sub_offset_seconds)

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

            vidmoly_url = None
            streamhg_url = None
            streamtape_url = None
            dood_url = None
            rendered_720p_path = None
            active_servers = {}

            # Subbed Downscaling (720p Generation) & Multi-Server Upload
            if preferred_quality in ("both", "multi", "all"):
                final_720p_filename = f"{clean_title}.{release_year_val}.720p.Arabic.Hardsub.mp4" if release_year_val else f"{clean_title}.720p.Arabic.Hardsub.mp4"
                rendered_720p_path = os.path.join(file_dir, final_720p_filename)
                downscale_to_720p(burned_1080p_path, rendered_720p_path)

                # Server 1: Vidmoly (1080p HLS)
                log("UPLOAD", "Uploading 1080p Hardsub to Vidmoly (Server 1 - Primary 1080p HLS)...")
                try: vidmoly_url = upload_to_vidmoly(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Vidmoly error: {e}")

                # Server 2: StreamHG (720p Fast Adaptive)
                log("UPLOAD", "Uploading 720p Downscaled Hardsub to StreamHG (Server 2 - Fast 720p Adaptive)...")
                try: streamhg_url = upload_to_streamhg(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ StreamHG error: {e}")

                # Server 3: Streamtape (720p High Speed)
                log("UPLOAD", "Uploading 720p Downscaled Hardsub to Streamtape (Server 3 - High Speed)...")
                try: streamtape_url = upload_to_streamtape(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Streamtape error: {e}")

                # Server 4: Doodstream (1080p Extra / Monetization)
                log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 4 - Extra)...")
                try: dood_url = upload_to_doodstream(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Doodstream error: {e}")

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

                log("UPLOAD", "Uploading 720p Hardsub to Vidmoly (Server 1)...")
                try: vidmoly_url = upload_to_vidmoly(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Vidmoly error: {e}")
                log("UPLOAD", "Uploading 720p Hardsub to StreamHG (Server 2)...")
                try: streamhg_url = upload_to_streamhg(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ StreamHG error: {e}")
                log("UPLOAD", "Uploading 720p Hardsub to Streamtape (Server 3)...")
                try: streamtape_url = upload_to_streamtape(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Streamtape error: {e}")
                log("UPLOAD", "Uploading 720p Hardsub to Doodstream (Server 4)...")
                try: dood_url = upload_to_doodstream(rendered_720p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Doodstream error: {e}")
                active_quality = "720p"
            else:
                log("UPLOAD", "Uploading 1080p Hardsub to Vidmoly (Server 1)...")
                try: vidmoly_url = upload_to_vidmoly(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Vidmoly error: {e}")
                log("UPLOAD", "Uploading 1080p Hardsub to StreamHG (Server 2)...")
                try: streamhg_url = upload_to_streamhg(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ StreamHG error: {e}")
                log("UPLOAD", "Uploading 1080p Hardsub to Streamtape (Server 3)...")
                try: streamtape_url = upload_to_streamtape(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Streamtape error: {e}")
                log("UPLOAD", "Uploading 1080p Hardsub to Doodstream (Server 4)...")
                try: dood_url = upload_to_doodstream(burned_1080p_path)
                except Exception as e: log("UPLOAD", f"⚠️ Doodstream error: {e}")
                active_quality = "1080p"

            if vidmoly_url:
                active_servers["Vidmoly (1080p)" if "1080" in active_quality else "Vidmoly"] = vidmoly_url
            if streamhg_url:
                active_servers["StreamHG (720p)" if "720" in active_quality else "StreamHG"] = streamhg_url
            if streamtape_url:
                active_servers["Streamtape"] = streamtape_url
            if dood_url:
                active_servers["Doodstream"] = dood_url

            primary_embed = vidmoly_url or streamhg_url or dood_url or streamtape_url
            if not primary_embed:
                raise RuntimeError("Failed to obtain embed URL from upload servers (Vidmoly, StreamHG, Doodstream, Streamtape all unavailable or failed).")

            # 6. Publish directly to Pantheon WordPress
            post_data = publish_movie_to_pantheon(
                meta,
                primary_embed,
                active_quality,
                dood_embed=dood_url,
                streamtape_embed=streamtape_url,
                vidmoly_embed=vidmoly_url,
                streamhg_embed=streamhg_url,
                active_servers=active_servers
            )

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
    finally:
        # 7. Guaranteed Ephemeral Disk Cleanup
        cleanup_targets = [raw_video_path, burned_1080p_path, rendered_720p_path, arabic_srt_path]
        for p in cleanup_targets:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                    log("CLEANUP", f"Purged temporary/staged file: {os.path.basename(p)}")
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
                    elif os.path.isdir(fp):
                        shutil.rmtree(fp, ignore_errors=True)
                except Exception:
                    pass

        # Purge download directory leftovers
        download_dir = "/content/download" if os.path.exists("/content") else os.path.abspath("./downloads")
        if os.path.exists(download_dir):
            for f in os.listdir(download_dir):
                fp = os.path.join(download_dir, f)
                try:
                    if os.path.islink(fp) or os.path.isfile(fp):
                        os.remove(fp)
                    elif os.path.isdir(fp):
                        shutil.rmtree(fp, ignore_errors=True)
                except Exception:
                    pass

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

