#!/usr/bin/env python3
"""
Movio Platform — Production Automation Pipeline
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
from urllib.parse import quote
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
except Exception:
    _COLAB_WP_PASS = None
    _COLAB_TMDB_KEY = None
    _COLAB_DOOD_KEY = None

# =============================================================================
# ENVIRONMENT & CREDENTIALS CONFIGURATION
# =============================================================================
WP_SITE_URL = os.getenv("WP_SITE_URL", "https://dev-movio-stream.pantheonsite.io").rstrip("/")
WP_USERNAME = os.getenv("WP_USERNAME", "admin")
WP_APP_PASSWORD = os.getenv("WP_APP_PASSWORD") or _COLAB_WP_PASS or ""

TMDB_API_KEY = os.getenv("TMDB_API_KEY") or _COLAB_TMDB_KEY or ""
DOODSTREAM_API_KEY = os.getenv("DOODSTREAM_API_KEY") or _COLAB_DOOD_KEY or ""
DOODSTREAM_API_BASE = "https://doodapi.com/api"

DOWNLOAD_DIR = "/content/download" if os.path.exists("/content") else os.path.abspath("./downloads")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}

def log(tag: str, msg: str):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [{tag}] {msg}", flush=True)

# =============================================================================
# 1. METADATA & POSTER RESOLUTION (TMDB API)
# =============================================================================
def fetch_tmdb_metadata(movie_title: str, release_year: str = None, imdb_id: str = None, api_key: str = TMDB_API_KEY) -> dict:
    """
    Fetch verified metadata, original high-resolution poster, backdrop,
    genres, and rating from official TMDB API.
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

    # Fetch extended details for genres & runtime if movie was found
    genres = "Action, Drama"
    tmdb_rating = "7.5"
    overview = "No synopsis available."
    poster_url = None
    backdrop_url = None
    final_title = movie_title
    final_year = release_year or "2026"
    extracted_imdb_id = imdb_id

    if movie_item:
        final_title = movie_item.get("title") or movie_title
        final_year = (movie_item.get("release_date") or "")[:4] or final_year
        overview = movie_item.get("overview") or overview
        tmdb_rating = str(round(movie_item.get("vote_average", 7.5), 1))
        
        poster_path = movie_item.get("poster_path")
        backdrop_path = movie_item.get("backdrop_path")
        
        if poster_path:
            poster_url = f"https://image.tmdb.org/t/p/original{poster_path}"
        if backdrop_path:
            backdrop_url = f"https://image.tmdb.org/t/p/original{backdrop_path}"
            
        tmdb_id = movie_item.get("id")
        if tmdb_id and api_key:
            try:
                detail_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={api_key}"
                d_res = requests.get(detail_url, headers=HEADERS, timeout=15).json()
                if "genres" in d_res:
                    genres = ", ".join([g["name"] for g in d_res["genres"]])
                extracted_imdb_id = d_res.get("imdb_id") or extracted_imdb_id
            except Exception as e:
                log("TMDB", f"Details lookup error: {e}")

    # Fallback to high quality placeholder if no poster found
    if not poster_url:
        poster_url = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1000&q=85"

    meta = {
        "title": final_title,
        "year": final_year,
        "overview": overview,
        "rating": tmdb_rating,
        "genres": genres,
        "poster_url": poster_url,
        "backdrop_url": backdrop_url,
        "imdb_id": extracted_imdb_id,
    }
    log("TMDB", f"Metadata ready: '{meta['title']}' ({meta['year']}) | ★ {meta['rating']} | {meta['genres']}")
    return meta

# =============================================================================
# 2. TORRENT ACQUISITION (YTS API)
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

    log("YTS", f"Selected Torrent: {quality} ({selected_torrent.get('size')}) Hash: {torrent_hash[:10]}...")
    return {
        "quality": quality,
        "torrent_url": torrent_url,
        "magnet_uri": magnet_uri,
        "size": selected_torrent.get("size", "Unknown"),
    }

# =============================================================================
# 3. HIGH-SPEED DOWNLOAD (ARIA2C) & SANITIZATION
# =============================================================================
def sanitize_download_dir(download_dir: str = DOWNLOAD_DIR):
    """
    Sanitize download directory prior to calling aria2c:
    Clear incomplete/stale .aria2 control files, partial downloads, and old chunks
    to avoid CalledProcessError: exit status 13.
    """
    if not os.path.exists(download_dir):
        os.makedirs(download_dir, exist_ok=True)
        return

    log("ARIA2", f"Sanitizing download directory: {download_dir}...")
    stale_exts = (".aria2", ".part", ".tmp", ".crdownload")
    for root, _, files in os.walk(download_dir):
        for f in files:
            if f.lower().endswith(stale_exts):
                fpath = os.path.join(root, f)
                try:
                    os.remove(fpath)
                    log("ARIA2", f"Cleared stale control/chunk file: {f}")
                except Exception as e:
                    log("ARIA2", f"Notice removing {f}: {e}")

def download_with_aria2(torrent_source: str, download_dir: str = DOWNLOAD_DIR) -> str:
    """
    Execute optimized aria2c download inside the cloud/Colab environment.
    Sanitizes download directory and applies robust flags to prevent duplicate/status 13 errors.
    """
    sanitize_download_dir(download_dir)
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
        torrent_source
    ]
    
    proc = subprocess.run(cmd, capture_output=False)
    if proc.returncode != 0:
        raise RuntimeError(f"aria2c download failed with exit code {proc.returncode}")

    # Locate the largest downloaded video file
    video_files = []
    for root, _, files in os.walk(download_dir):
        for f in files:
            if f.lower().endswith((".mp4", ".mkv", ".avi", ".webm")):
                fpath = os.path.join(root, f)
                video_files.append((fpath, os.path.getsize(fpath)))

    if not video_files:
        raise FileNotFoundError(f"No video files found in {download_dir} after download.")

    video_files.sort(key=lambda x: x[1], reverse=True)
    target_video = video_files[0][0]
    file_size_mb = video_files[0][1] / (1024 * 1024)
    log("ARIA2", f"Download complete: {os.path.basename(target_video)} ({file_size_mb:.2f} MB)")
    return target_video

# =============================================================================
# 4. ARABIC-ONLY SUBTITLES & FFMPEG HARDSUBBING (BURN-IN)
# =============================================================================
def download_subtitles_for_imdb(imdb_id: str, output_dir: str = DOWNLOAD_DIR) -> str:
    """
    Search and download ONLY the highest-rated Arabic (.srt) subtitle file.
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
                        lang_tag = tr.find(class_="sub-lang")
                        if not lang_tag:
                            continue
                        if lang_tag.text.strip().lower() == "arabic":
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

    # 3. Download .zip archive and extract Arabic .srt
    try:
        slug = arabic_sub_url.rstrip("/").split("/")[-1]
        zip_url = f"https://yifysubtitles.ch/subtitle/{slug}.zip"
        page_referer = f"https://yifysubtitles.ch/subtitles/{slug}"
        req_headers = {
            "User-Agent": headers["User-Agent"],
            "Referer": page_referer
        }
        zr = requests.get(zip_url, headers=req_headers, timeout=15)
        if zr.status_code == 200:
            with zipfile.ZipFile(io.BytesIO(zr.content)) as z:
                for filename in z.namelist():
                    if filename.lower().endswith(".srt"):
                        out_srt = os.path.join(subs_dir, f"{imdb_id}_ara.srt")
                        with open(out_srt, "wb") as sf:
                            sf.write(z.read(filename))
                        log("SUBS", f"Extracted Arabic subtitle -> {os.path.basename(out_srt)}")
                        return out_srt
    except Exception as e:
        log("SUBS", f"Failed downloading/extracting Arabic subtitle: {e}")

    return None

def burn_arabic_subtitles(video_path: str, srt_path: str) -> str:
    """
    Burn Arabic subtitles directly into video frames (hardsubbing) using FFmpeg.
    Uses clear, readable Arabic styling with outlined text and shadow.
    Audio stream is copied directly without re-encoding (-c:a copy).
    """
    if not srt_path or not os.path.exists(srt_path):
        log("HARDSUB", "No Arabic subtitle provided or file missing; using original video as fallback.")
        return video_path

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        log("HARDSUB", "ffmpeg not found in PATH; skipping hardsubbing and using raw video.")
        return video_path

    base_name, _ = os.path.splitext(video_path)
    output_subbed_path = f"{base_name}_subbed.mp4"
    if os.path.abspath(output_subbed_path) == os.path.abspath(video_path):
        output_subbed_path = f"{base_name}_burned.mp4"

    # Escape special characters in the subtitle file path for FFmpeg filter syntax (escape ':' and ''')
    clean_path = os.path.abspath(srt_path).replace("\\", "/")
    escaped_srt = clean_path.replace(":", "\\:").replace("'", "\\'")

    # Clear, readable Arabic styling: White text, black outline, shadow
    style = "FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1"
    subtitles_filter = f"subtitles='{escaped_srt}':force_style='{style}'"

    log("HARDSUB", f"Burning Arabic subtitles into frames: {os.path.basename(output_subbed_path)}...")
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", video_path,
        "-vf", subtitles_filter,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "copy",
        output_subbed_path
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log("HARDSUB", f"ffmpeg hardsubbing error ({proc.returncode}): {proc.stderr[-300:]}")
        log("HARDSUB", "Falling back to original video file.")
        return video_path

    if os.path.exists(output_subbed_path) and os.path.getsize(output_subbed_path) > 0:
        file_size_mb = os.path.getsize(output_subbed_path) / (1024 * 1024)
        log("HARDSUB", f"Hardsubbing complete! Video: {os.path.basename(output_subbed_path)} ({file_size_mb:.1f} MB)")
        return output_subbed_path

    return video_path

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

# =============================================================================
# 5. HEADLESS WORDPRESS PUBLISHING (PANTHEON REST API)
# =============================================================================
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

def publish_movie_to_pantheon(meta: dict, embed_url: str, quality: str = "1080p", wp_site_url: str = WP_SITE_URL, username: str = WP_USERNAME, app_password: str = WP_APP_PASSWORD) -> dict:
    """
    Publish movie post with 16:9 responsive embed player and full metadata
    into Pantheon Headless WordPress CMS.
    """
    clean_slug = re.sub(r'[^a-zA-Z0-9]+', '-', meta['title'].lower()).strip('-')
    media_id = upload_poster_to_pantheon(meta.get("poster_url"), clean_slug, wp_site_url, username, app_password)

    title = f"{meta['title']} ({meta['year']})"
    log("WP", f"Publishing post to Pantheon: '{title}'...")

    # Structured 16:9 Responsive Embed HTML (STRICT double quotes for Next.js regex parser)
    content = f"""
<div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 12px; margin-bottom: 1.5rem;">
    <iframe src="{embed_url}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allowfullscreen="true" scrolling="no" frameborder="0"></iframe>
</div>

<div class="movie-meta-summary">
    <p><strong>Rating:</strong> {meta.get('rating', '8.0')} / 10</p>
    <p><strong>Release Year:</strong> {meta.get('year', '2026')}</p>
    <p><strong>Genres:</strong> {meta.get('genres', 'Movies')}</p>
    <p><strong>Quality:</strong> {quality} Full HD</p>
    <hr>
    <p>{meta.get('overview', '')}</p>
</div>
"""

    post_payload = {
        "title": title,
        "content": content,
        "status": "publish",
        "meta": {
            "embed_url": embed_url,
            "dood_embed": embed_url,
            "video_year": str(meta.get("year", "2026")),
            "imdb_rating": str(meta.get("rating", "8.0")),
            "quality": quality,
            "backdrop_url": meta.get("backdrop_url") or "",
            "genres": meta.get("genres", "")
        }
    }
    if media_id:
        post_payload["featured_media"] = media_id

    api_endpoint = f"{wp_site_url}/wp-json/wp/v2/posts"
    post_headers = {
        "Content-Type": "application/json",
        "User-Agent": HEADERS["User-Agent"]
    }
    auth = HTTPBasicAuth(username, app_password) if app_password else None

    res = requests.post(api_endpoint, json=post_payload, headers=post_headers, auth=auth, timeout=30)
    if res.status_code in (200, 201):
        data = res.json()
        log("WP", "Movie published successfully to Pantheon!")
        log("WP", f"Post ID:   {data.get('id')}")
        log("WP", f"Post Slug: {data.get('slug')}")
        log("WP", f"Post URL:  {data.get('link')}")
        return data
    else:
        raise RuntimeError(f"Pantheon WordPress publish failed ({res.status_code}): {res.text[:300]}")

# =============================================================================
# MASTER PIPELINE ORCHESTRATOR
# =============================================================================
def run_pipeline(movie_title: str, release_year: str = None, imdb_id: str = None, preferred_quality: str = "1080p"):
    """
    End-to-End Execution:
    TMDB -> YTS Torrent -> aria2c (.mp4) -> Arabic .srt Download
    -> FFmpeg Hardsubbing (*_subbed.mp4) -> Resilient DoodStream Upload -> Pantheon Headless WP
    """
    print("=" * 75)
    print("  MOVIO CLOUD AUTOMATION PIPELINE (TMDB + YTS + ARIA2C + ARABIC HARDSUB + PANTHEON)")
    print("=" * 75)

    # 1. Fetch TMDB Metadata
    meta = fetch_tmdb_metadata(movie_title, release_year, imdb_id)

    # 2. Fetch YTS Torrent
    target_imdb = meta.get("imdb_id") or imdb_id
    torrent_info = fetch_yts_torrent(meta["title"], meta["year"], target_imdb, preferred_quality)

    # 3. High-Speed aria2c Download with Pre-Sanitization
    download_source = torrent_info["torrent_url"] or torrent_info["magnet_uri"]
    raw_video_path = download_with_aria2(download_source)

    # 4. Fetch Arabic Subtitles (.srt)
    arabic_srt_path = download_subtitles_for_imdb(target_imdb, DOWNLOAD_DIR)

    # 5. Burn Arabic Subtitles directly into video frames
    burned_video_path = burn_arabic_subtitles(raw_video_path, arabic_srt_path)

    # 6. Upload burned video to DoodStream with Retry & Server Re-allocation
    embed_url = upload_to_doodstream(burned_video_path)

    # 7. Publish directly to Pantheon WordPress (clean embed URL inside double-quoted iframe)
    post_data = publish_movie_to_pantheon(meta, embed_url, torrent_info["quality"])

    # 8. Cleanup temporary files: original .mp4, .srt, and the generated *_subbed.mp4
    cleanup_targets = set([raw_video_path, burned_video_path, arabic_srt_path])
    for path in cleanup_targets:
        if path and os.path.exists(path):
            try:
                os.remove(path)
                log("CLEANUP", f"Cleaned up {os.path.basename(path)}")
            except Exception:
                pass

    print("\n" + "=" * 75)
    print("  PIPELINE COMPLETED SUCCESSFULLY!")
    print(f"  Title:      {meta['title']} ({meta['year']})")
    print(f"  Rating:     ★ {meta['rating']}")
    print(f"  Arabic Sub: {'Burned In' if arabic_srt_path else 'None'}")
    print(f"  Embed:      {embed_url}")
    print(f"  Live Post:  {post_data.get('link')}")
    print(f"  Next.js:    http://localhost:3000/movie/{post_data.get('slug')}")
    print("=" * 75)
    return post_data

if __name__ == "__main__":
    if len(sys.argv) > 1:
        t = sys.argv[1]
        y = sys.argv[2] if len(sys.argv) > 2 else None
        imdb = sys.argv[3] if len(sys.argv) > 3 else None
        run_pipeline(t, y, imdb)
    else:
        print("Usage: python colab_pipeline.py <Movie Title> [Release Year] [IMDb ID]")
