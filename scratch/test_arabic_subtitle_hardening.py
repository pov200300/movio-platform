#!/usr/bin/env python3
"""
Test Suite: Arabic Subtitle Sizing & Encoding Hardening
Validates:
1. Subtitle text sanitizer (strips bidi marks, zero-width chars, BOM, replacement glyphs).
2. Subtitle file sanitizer across utf-8, utf-8-sig, windows-1256, cp1256, and iso-8859-6.
3. Subtitle styling constants (FontSize=24, Outline=1.4, Shadow=0.8, MarginV=28, Bold=1).
4. Codebase synchronization across colab_pipeline.py, create_colab_notebook.py, and media_worker_pipeline.ipynb.
"""
import os
import sys
import tempfile
import json
import re

# Add scripts directory to path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

from colab_pipeline import (
    sanitize_subtitle_text,
    sanitize_subtitle_file,
    decode_arabic_subtitle_bytes,
    fix_arabic_mojibake,
    apply_ass_style,
    convert_srt_to_ass
)

def test_sanitize_subtitle_text():
    print("[TEST 1] Testing sanitize_subtitle_text...")
    # Test bidi characters, zero-width, BOM, tofu replacement glyph \ufffd
    dirty_text = (
        "\ufeff\u200e1\n"
        "00:00:01,000 --> 00:00:04,000\n"
        "\u202bمرحبا \u200bبك \u200cفي \u200dالعالم \ufffd!\u202c\u200f\r\n"
        "\n"
        "2\r"
        "00:00:05,000 --> 00:00:08,000\r"
        "\u061cهذا \u2066نص\u2069 \u2067تجريبي\u2068\ufffe\0\n"
    )
    sanitized = sanitize_subtitle_text(dirty_text)
    
    # Assertions
    forbidden_chars = [
        '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
        '\u200b', '\u200c', '\u200d', '\ufeff', '\ufffd', '\u061c',
        '\u2066', '\u2067', '\u2068', '\u2069', '\ufffe', '\x00', '\r'
    ]
    for ch in forbidden_chars:
        assert ch not in sanitized, f"Forbidden character {ascii(ch)} found in sanitized text!"
        
    assert "مرحبا بك في العالم !" in sanitized
    assert "هذا نص تجريبي" in sanitized
    print("  ✅ sanitize_subtitle_text stripped all forbidden unicode marks and normalized text.")

def test_sanitize_subtitle_file_encodings():
    print("[TEST 2] Testing sanitize_subtitle_file across multiple encodings...")
    sample_arabic_srt = (
        "1\n"
        "00:01:20,000 --> 00:01:23,000\n"
        "\u200eمشاهدة وتحميل أقوى الأفلام بجودة عالية\ufffd\n"
        "\n"
        "2\n"
        "00:01:25,000 --> 00:01:28,000\n"
        "الترجمة العربية الاحترافية الكاملة\n"
    )
    
    encodings_to_test = [
        ("utf-8", sample_arabic_srt.encode("utf-8")),
        ("utf-8-sig", sample_arabic_srt.encode("utf-8-sig")),
        ("windows-1256", sample_arabic_srt.replace("\u200e", "").replace("\ufffd", "").encode("windows-1256")),
        ("cp1256", sample_arabic_srt.replace("\u200e", "").replace("\ufffd", "").encode("cp1256")),
        ("iso-8859-6", sample_arabic_srt.replace("\u200e", "").replace("\ufffd", "").encode("iso-8859-6"))
    ]
    
    with tempfile.TemporaryDirectory() as td:
        for enc_name, raw_bytes in encodings_to_test:
            in_file = os.path.join(td, f"test_{enc_name}.srt")
            out_file = os.path.join(td, f"out_{enc_name}.srt")
            with open(in_file, "wb") as f:
                f.write(raw_bytes)
                
            res = sanitize_subtitle_file(in_file, out_file)
            assert res == out_file, f"sanitize_subtitle_file failed for {enc_name}"
            assert os.path.exists(out_file), f"Output file does not exist for {enc_name}"
            
            with open(out_file, "rb") as rf:
                out_bytes = rf.read()
                
            # Verify no UTF-8 BOM
            assert not out_bytes.startswith(b"\xef\xbb\xbf"), f"BOM found in output for {enc_name}"
            # Verify valid UTF-8
            out_text = out_bytes.decode("utf-8")
            assert "مشاهدة وتحميل" in out_text or "الترجمة العربية" in out_text, f"Arabic content corrupted for {enc_name}"
            assert "\ufffd" not in out_text, f"Tofu replacement \ufffd found in output for {enc_name}"
            assert "\u200e" not in out_text, f"Bidi mark \u200e found in output for {enc_name}"
            print(f"  ✅ Encoding {enc_name:12s} successfully detected, decoded, cleaned, and saved as clean UTF-8.")

def test_ass_styling_proportions():
    print("[TEST 3] Testing ASS styling proportions (FontSize=24, Outline=1.4, Shadow=0.8, MarginV=28)...")
    sample_srt = (
        "1\n"
        "00:00:10,000 --> 00:00:15,000\n"
        "أهلاً بالعالم العربي\n"
    )
    ass_content = convert_srt_to_ass(sample_srt)
    
    assert "Noto Sans Arabic" in ass_content
    assert ",24," in ass_content, "FontSize 24 not found in convert_srt_to_ass output"
    assert ",1.4,0.8," in ass_content, "Outline 1.4 and Shadow 0.8 not found in convert_srt_to_ass"
    assert ",28,1" in ass_content, "MarginV 28 not found in convert_srt_to_ass"
    assert "80" not in ass_content.split("Style: Default")[1].split("\n")[0], "Old FontSize 80 still present in Style"
    
    # Test apply_ass_style
    raw_old_ass = "[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nStyle: Default,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2.6,1.0,2,20,20,20,1\n"
    updated_ass = apply_ass_style(raw_old_ass)
    assert "Noto Sans Arabic,24," in updated_ass
    assert ",1.4,0.8," in updated_ass
    assert ",28,1" in updated_ass
    print("  ✅ convert_srt_to_ass and apply_ass_style generate proportional Netflix-style 24pt Arabic captions.")

def test_codebase_synchronization():
    print("[TEST 4] Testing codebase synchronization across pipeline, builder, and notebook...")
    
    files_to_check = [
        os.path.join(REPO_ROOT, "scripts", "colab_pipeline.py"),
        os.path.join(REPO_ROOT, "scripts", "create_colab_notebook.py"),
        os.path.join(REPO_ROOT, "notebooks", "media_worker_pipeline.ipynb")
    ]
    
    for fpath in files_to_check:
        fname = os.path.basename(fpath)
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()
            
        # 1. Check FontSize=24
        assert "FontSize=24" in content or ",24," in content, f"FontSize=24 missing in {fname}"
        assert "Outline=1.4" in content or ",1.4," in content, f"Outline=1.4 missing in {fname}"
        assert "Shadow=0.8" in content or ",0.8," in content, f"Shadow=0.8 missing in {fname}"
        assert "MarginV=28" in content or ",28,1" in content, f"MarginV=28 missing in {fname}"
        assert "Noto Sans Arabic" in content, f"Noto Sans Arabic missing in {fname}"
        assert "sanitize_subtitle_text" in content, f"sanitize_subtitle_text missing in {fname}"
        assert "sanitize_subtitle_file" in content, f"sanitize_subtitle_file missing in {fname}"
        
        # 2. Verify no old oversized constants remain in subtitle styles
        assert "FontSize=80" not in content, f"Stale FontSize=80 found in {fname}"
        assert "Outline=2.6" not in content, f"Stale Outline=2.6 found in {fname}"
        
        # 3. Verify architecture requirements
        assert "scale=-2:1080" in content, f"4K pre-scaling missing in {fname}"
        assert "-c:a" in content and "192k" in content, f"AAC stereo transcode missing in {fname}"
        assert "14400" in content, f"14400s watchdog timeout missing in {fname}"
        
        print(f"  ✅ {fname} passed all verification checks.")

if __name__ == "__main__":
    test_sanitize_subtitle_text()
    test_sanitize_subtitle_file_encodings()
    test_ass_styling_proportions()
    test_codebase_synchronization()
    print("\n🎉 ALL ARABIC SUBTITLE HARDENING TESTS PASSED SUCCESSFULLY!")
