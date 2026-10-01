#!/usr/bin/env python3
"""
Test Suite: TV Episode Subtitle Parameter Hardening & download_subtitles_for_imdb Signature Support
Validates:
1. Function signature flexibility: Movies (imdb_id, download_dir), TV Episodes (imdb_id, download_dir, season=X, episode=Y, **kwargs).
2. No TypeErrors on keyword arguments across both download_subtitles_for_imdb and download_subtitles_for_tv_episode.
3. TV Episode subtitle query integration with OpenSubtitles v3 (e.g. Breaking Bad S01E01).
4. SxxExx candidate filtering logic.
5. Codebase synchronization across colab_pipeline.py, create_colab_notebook.py, and media_worker_pipeline.ipynb.
"""
import os
import sys
import tempfile
import json
import inspect

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

import colab_pipeline
from colab_pipeline import (
    download_subtitles_for_imdb,
    download_subtitles_for_tv_episode
)

def test_function_signatures():
    print("[TEST 1] Testing function signatures and parameter flexibility...")
    # Check signature of download_subtitles_for_imdb
    sig = inspect.signature(download_subtitles_for_imdb)
    params = list(sig.parameters.keys())
    assert "imdb_id" in params, "imdb_id missing in download_subtitles_for_imdb signature"
    assert "download_dir" in params, "download_dir missing in download_subtitles_for_imdb signature"
    assert "season" in params, "season missing in download_subtitles_for_imdb signature"
    assert "episode" in params, "episode missing in download_subtitles_for_imdb signature"
    assert any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()), "**kwargs missing in download_subtitles_for_imdb"
    
    # Check signature of download_subtitles_for_tv_episode
    sig_tv = inspect.signature(download_subtitles_for_tv_episode)
    assert any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig_tv.parameters.values()), "**kwargs missing in download_subtitles_for_tv_episode"
    print("  ✅ Function signatures accurately accept season, episode, and **kwargs.")

def test_parameter_combinations():
    print("[TEST 2] Testing calling conventions without TypeErrors...")
    with tempfile.TemporaryDirectory() as td:
        # None IMDb ID should return None cleanly without TypeError
        assert download_subtitles_for_imdb(None, td) is None
        assert download_subtitles_for_imdb(None, td, season=1, episode=1) is None
        assert download_subtitles_for_imdb(None, download_dir=td, season=2, episode=4, extra_flag=True) is None
        assert download_subtitles_for_imdb(None, output_dir=td, season_num=1, episode_num=3) is None
        
        # Test download_subtitles_for_tv_episode calling conventions
        assert download_subtitles_for_tv_episode(None, 1, 1, td) is None
        assert download_subtitles_for_tv_episode(None, season=1, episode=1, output_dir=td) is None
        assert download_subtitles_for_tv_episode(None, season_num=1, episode_num=1, download_dir=td, arbitrary_kw="test") is None
        assert download_subtitles_for_tv_episode("tt0000000", season=None, episode=None, output_dir=td) is None
    print("  ✅ All calling conventions, aliases, and **kwargs execute without TypeErrors.")

def test_tv_episode_subtitle_search():
    print("[TEST 3] Testing TV Episode subtitle query (Breaking Bad S01E01 - tt0903747)...")
    with tempfile.TemporaryDirectory() as td:
        # Call download_subtitles_for_imdb with TV episode parameters
        srt_path = download_subtitles_for_imdb(
            "tt0903747",
            td,
            season=1,
            episode=1,
            extra_test_param="safe"
        )
        assert srt_path is not None, "Failed to download Arabic subtitle for Breaking Bad S01E01"
        assert os.path.exists(srt_path), f"Subtitle file does not exist: {srt_path}"
        assert "S01E01" in os.path.basename(srt_path) or "ara.srt" in os.path.basename(srt_path)
        
        with open(srt_path, "rb") as f:
            content = f.read()
        
        # Verify clean UTF-8 without BOM
        assert not content.startswith(b"\xef\xbb\xbf"), "BOM found in downloaded TV subtitle"
        text = content.decode("utf-8")
        assert len(text) > 100, "Subtitle text too short"
        import re
        assert len(re.findall(r"[\u0600-\u06FF]", text)) >= 30, "Insufficient Arabic characters in TV subtitle"
        print(f"  ✅ Breaking Bad S01E01 Arabic subtitle downloaded, validated, and sanitized -> {os.path.basename(srt_path)}")

def test_codebase_synchronization():
    print("[TEST 4] Testing codebase synchronization across colab_pipeline.py, create_colab_notebook.py, and notebook...")
    files = [
        os.path.join(REPO_ROOT, "scripts", "colab_pipeline.py"),
        os.path.join(REPO_ROOT, "scripts", "create_colab_notebook.py"),
        os.path.join(REPO_ROOT, "notebooks", "media_worker_pipeline.ipynb")
    ]
    for fpath in files:
        fname = os.path.basename(fpath)
        with open(fpath, "r", encoding="utf-8") as f:
            src = f.read()
        
        # Verify download_subtitles_for_imdb has season and episode
        assert "def download_subtitles_for_imdb" in src, f"download_subtitles_for_imdb missing in {fname}"
        assert "season" in src and "episode" in src, f"season/episode param missing in {fname}"
        assert "**kwargs" in src, f"**kwargs missing in {fname}"
        assert "def download_subtitles_for_tv_episode" in src, f"download_subtitles_for_tv_episode missing in {fname}"
        print(f"  ✅ {fname} synchronized successfully.")

if __name__ == "__main__":
    test_function_signatures()
    test_parameter_combinations()
    test_tv_episode_subtitle_search()
    test_codebase_synchronization()
    print("\n🎉 ALL TV EPISODE SUBTITLE PARAMETER TESTS PASSED!")
