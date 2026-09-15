#!/usr/bin/env python3
"""
Google Colab Media Automation Pipeline
======================================
Automated Pipeline for Google Colab:
1. High-speed downloading via aria2c (Magnet / Direct Link)
2. Metadata scraping (TMDb / OMDb / YTS / Fallbacks)
3. Direct streaming upload to Doodstream
4. WordPress REST API post & media publishing to InfinityFree Headless CMS
"""

import os
import sys
import re
import json
import time
import requests
import subprocess
from urllib.parse import urlparse
from requests.auth import HTTPBasicAuth

# Try importing requests_toolbelt for progress-tracked uploads
try:
    from requests_toolbelt import MultipartEncoder, MultipartEncoderMonitor
    HAS_TOOLBELT = True
except ImportError:
    HAS_TOOLBELT = False

# =============================================================================
# DEFAULT CONFIGURATION (Override via env vars or function arguments)
# =============================================================================
DOODSTREAM_API_KEY = os.getenv("DOODSTREAM_API_KEY", "578084xvwvf2mt7is4dgrb")
DOODSTREAM_API_BASE = "https://doodapi.com/api"

WP_SITE_URL = os.getenv("WP_SITE_URL", "https://your-site.infinityfreeapp.com").rstrip("/")
WP_USERNAME = os.getenv("WP_USERNAME", "admin")
WP_APP_PASSWORD = os.getenv("WP_APP_PASSWORD", "")
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")

DOWNLOAD_DIR = "/content/downloads" if os.path.exists("/content") else "./downloads"

# Standard headers to prevent 403 Forbidden on free hosts
COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}

def log(tag, msg):
    print(f"[{tag}] {msg}", flush=True)

def setup_environment():
    """Install system packages and create download directories in Colab."""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    if os.path.exists("/content"):
        log("SETUP", "Setting up Google Colab environment...")
        subprocess.run(["apt-get", "update", "-qq"])
        subprocess.run(["apt-get", "install", "-y", "-qq", "aria2", "ffmpeg"])
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "requests-toolbelt", "beautifulsoup4"])
        log("SETUP", "Colab environment ready.")

def clean_movie_title(raw_name):
    """Clean release tags and technical terms to extract title and year."""
    clean = re.sub(r'\[.*?\]|\(.*?\)', '', raw_name)
    clean = re.sub(r'\b(1080p|720p|480p|2160p|4k|bluray|web-dl|webrip|hdrip|x264|x265|hevc|aac|egydead|yts|yify)\b', '', clean, flags=re.IGNORECASE)
    clean = clean.replace('.', ' ').replace('_', ' ').strip()
    
    year_match = re.search(r'\b(19\d\d|20\d\d)\b', clean)
    year = year_match.group(1) if year_match else None
    if year:
        clean = re.sub(r'\b' + year + r'\b', '', clean).strip()
    return clean.strip(), year

def fetch_metadata(title, year=None):
    """Fetch movie metadata and poster from TMDb, OMDb, or YTS."""
    log("META", f"Searching metadata for '{title}' (Year: {year or 'Any'})...")
    
    # 1. Try TMDb if API key is provided
    if TMDB_API_KEY:
        try:
            tmdb_url = f"https://api.themoviedb.org/3/search/movie?api_key={TMDB_API_KEY}&query={requests.utils.quote(title)}"
            if year:
                tmdb_url += f"&year={year}"
            res = requests.get(tmdb_url, headers=COMMON_HEADERS, timeout=15).json()
            if res.get("results"):
                m = res["results"][0]
                poster_path = m.get("poster_path")
                cover = f"https://image.tmdb.org/t/p/w780{poster_path}" if poster_path else None
                return {
                    "title": m.get("title", title),
                    "year": m.get("release_date", "")[:4] or year or "2026",
                    "summary": m.get("overview") or "No synopsis available.",
                    "rating": str(round(m.get("vote_average", 7.5), 1)),
                    "genres": "Action, Adventure",
                    "cover_url": cover
                }
        except Exception as e:
            log("META", f"TMDb error: {e}")

    # 2. Try YTS API mirror
    try:
        yts_url = f"https://yts.mx/api/v2/list_movies.json?query_term={requests.utils.quote(title)}"
        resp = requests.get(yts_url, headers=COMMON_HEADERS, timeout=15).json()
        if resp.get("status") == "ok" and resp.get("data", {}).get("movie_count", 0) > 0:
            movies = resp["data"]["movies"]
            target = movies[0]
            if year:
                for m in movies:
                    if str(m.get("year")) == str(year):
                        target = m
                        break
            return {
                "title": target.get("title", title),
                "year": str(target.get("year", year or "2026")),
                "summary": target.get("summary") or "No synopsis available.",
                "rating": str(target.get("rating", "7.0")),
                "genres": ", ".join(target.get("genres", ["Cinema"])),
                "cover_url": target.get("large_cover_image") or target.get("medium_cover_image")
            }
    except Exception as e:
        log("META", f"YTS fallback error: {e}")

    # 3. Default fallback
    return {
        "title": title,
        "year": year or "2026",
        "summary": f"Watch {title} online in high definition with English/Arabic subtitles.",
        "rating": "7.5",
        "genres": "Action, Drama",
        "cover_url": "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80"
    }

def download_video(url_or_magnet, output_dir=DOWNLOAD_DIR):
    """Download movie file using aria2c."""
    os.makedirs(output_dir, exist_ok=True)
    log("ARIA2", f"Starting aria2c download: {url_or_magnet[:80]}...")
    
    cmd = [
        "aria2c",
        f"--dir={output_dir}",
        "--max-connection-per-server=8",
        "--split=8",
        "--summary-interval=10",
        "--seed-time=0",
        url_or_magnet
    ]
    subprocess.run(cmd, check=True)
    
    # Locate largest downloaded video file
    video_files = []
    for root, _, files in os.walk(output_dir):
        for f in files:
            if f.lower().endswith(('.mp4', '.mkv', '.avi', '.webm')):
                full_path = os.path.join(root, f)
                video_files.append((full_path, os.path.getsize(full_path)))
                
    if not video_files:
        raise FileNotFoundError(f"No video files found in {output_dir} after download.")
        
    video_files.sort(key=lambda x: x[1], reverse=True)
    largest_video = video_files[0][0]
    log("ARIA2", f"Download complete: {largest_video} ({video_files[0][1] / (1024*1024):.1f} MB)")
    return largest_video

def upload_to_doodstream(video_path, api_key=DOODSTREAM_API_KEY):
    """Upload video to Doodstream and return the embed URL."""
    log("DOOD", "Fetching Doodstream upload server...")
    srv_resp = requests.get(f"{DOODSTREAM_API_BASE}/upload/server", params={"key": api_key}, timeout=30).json()
    if srv_resp.get("status") != 200:
        raise RuntimeError(f"Doodstream server fetch failed: {srv_resp}")
    upload_url = srv_resp["result"]
    
    filename = os.path.basename(video_path)
    file_size = os.path.getsize(video_path)
    log("DOOD", f"Uploading '{filename}' ({file_size / (1024*1024):.1f} MB)...")
    
    if HAS_TOOLBELT:
        with open(video_path, 'rb') as f:
            encoder = MultipartEncoder(fields={'api_key': api_key, 'file': (filename, f, 'video/mp4')})
            last_pct = [-1]
            def progress_callback(monitor):
                pct = int((monitor.bytes_read / monitor.len) * 100)
                if pct % 10 == 0 and pct != last_pct[0]:
                    last_pct[0] = pct
                    print(f"[{pct}%] {monitor.bytes_read / (1024*1024):.1f} MB / {monitor.len / (1024*1024):.1f} MB", flush=True)
            monitor = MultipartEncoderMonitor(encoder, progress_callback)
            resp = requests.post(upload_url, data=monitor, headers={'Content-Type': monitor.content_type}, timeout=7200).json()
    else:
        with open(video_path, 'rb') as f:
            resp = requests.post(upload_url, data={'api_key': api_key}, files={'file': (filename, f, 'video/mp4')}, timeout=7200).json()
            
    if resp.get("status") != 200:
        raise RuntimeError(f"Doodstream upload failed: {resp}")
        
    res = resp["result"]
    file_code = res[0]["filecode"] if isinstance(res, list) else res.get("filecode")
    embed_url = f"https://dood.to/e/{file_code}"
    log("DOOD", f"✅ Upload successful! Embed: {embed_url}")
    return embed_url

def upload_poster_to_wordpress(cover_url, wp_site_url=WP_SITE_URL, username=WP_USERNAME, app_password=WP_APP_PASSWORD):
    """Download cover image and upload to WordPress Media Library."""
    if not cover_url:
        return None
    log("WP", f"Downloading cover: {cover_url}...")
    img_resp = requests.get(cover_url, headers=COMMON_HEADERS, timeout=30)
    if img_resp.status_code != 200:
        log("WP", "Warning: Could not download cover image.")
        return None
        
    filename = "poster_" + str(int(time.time())) + ".jpg"
    api_url = f"{wp_site_url}/wp-json/wp/v2/media"
    headers = {
        "Content-Disposition": f"attachment; filename={filename}",
        "Content-Type": "image/jpeg",
        "User-Agent": COMMON_HEADERS["User-Agent"]
    }
    auth = HTTPBasicAuth(username, app_password) if app_password else None
    
    log("WP", f"Uploading poster to WordPress ({api_url})...")
    res = requests.post(api_url, headers=headers, data=img_resp.content, auth=auth, timeout=30)
    if res.status_code in (200, 201):
        media_id = res.json().get("id")
        log("WP", f"✅ Poster uploaded. Media ID: {media_id}")
        return media_id
    else:
        log("WP", f"Warning: Media upload failed ({res.status_code}): {res.text[:150]}")
        return None

def publish_movie_to_wordpress(meta, embed_url, media_id=None, wp_site_url=WP_SITE_URL, username=WP_USERNAME, app_password=WP_APP_PASSWORD):
    """Publish the movie post with embedded player and metadata to WordPress."""
    title = f"{meta['title']} ({meta['year']})"
    log("WP", f"Publishing movie to WordPress: {title}...")
    
    content = f"""
    <p><strong>Rating:</strong> {meta.get('rating', 'N/A')} / 10</p>
    <p><strong>Genres:</strong> {meta.get('genres', 'Movies')}</p>
    <hr>
    <p>{meta.get('summary', '')}</p>
    <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%;">
        <iframe src="{embed_url}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" frameborder="0" allowfullscreen scrolling="no"></iframe>
    </div>
    """
    
    post_data = {
        "title": title,
        "content": content,
        "status": "publish",
        "meta": {
            "video_year": str(meta.get("year", "2026")),
            "imdb_rating": str(meta.get("rating", "7.5")),
            "dood_embed": embed_url
        }
    }
    if media_id:
        post_data["featured_media"] = media_id
        
    api_url = f"{wp_site_url}/wp-json/wp/v2/posts"
    headers = {"Content-Type": "application/json", "User-Agent": COMMON_HEADERS["User-Agent"]}
    auth = HTTPBasicAuth(username, app_password) if app_password else None
    
    res = requests.post(api_url, json=post_data, headers=headers, auth=auth, timeout=30)
    if res.status_code in (200, 201):
        data = res.json()
        log("WP", f"🎉 Movie published successfully!")
        log("WP", f"Post ID: {data.get('id')}")
        log("WP", f"WordPress URL: {data.get('link')}")
        return data
    else:
        raise RuntimeError(f"WordPress publish failed ({res.status_code}): {res.text[:300]}")

def run_pipeline(movie_source, custom_title=None, custom_year=None):
    """
    Execute full pipeline for a movie link or local video file.
    movie_source: Magnet URI, HTTP/FTP URL, or local file path
    """
    print("=" * 70)
    print("  🚀 CLOUD MEDIA AUTOMATION PIPELINE (COLAB)")
    print("=" * 70)
    
    # 1. Determine Title & Year
    if os.path.exists(movie_source):
        video_path = movie_source
        extracted_title, extracted_year = clean_movie_title(os.path.basename(video_path))
    else:
        video_path = download_video(movie_source)
        extracted_title, extracted_year = clean_movie_title(os.path.basename(video_path))
        
    title = custom_title or extracted_title
    year = custom_year or extracted_year or "2026"
    
    # 2. Fetch Metadata & Poster
    meta = fetch_metadata(title, year)
    
    # 3. Upload to Doodstream
    embed_url = upload_to_doodstream(video_path)
    
    # 4. Upload Poster to WordPress
    media_id = upload_poster_to_wordpress(meta.get("cover_url"))
    
    # 5. Publish Post to WordPress
    post_info = publish_movie_to_wordpress(meta, embed_url, media_id)
    
    print("\n" + "=" * 70)
    print("  ✅ PIPELINE RUN FINISHED SUCCESSFULLY!")
    print(f"  Title:     {title} ({year})")
    print(f"  Embed:     {embed_url}")
    print(f"  Post Link: {post_info.get('link')}")
    print("=" * 70)
    return post_info

if __name__ == "__main__":
    if len(sys.argv) > 1:
        source = sys.argv[1]
        t = sys.argv[2] if len(sys.argv) > 2 else None
        y = sys.argv[3] if len(sys.argv) > 3 else None
        run_pipeline(source, t, y)
    else:
        print("Usage: python colab_pipeline.py <magnet_or_url_or_filepath> [Title] [Year]")
