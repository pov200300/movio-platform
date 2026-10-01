import sys
import os
import re

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.abspath("scripts"))
from colab_pipeline import (
    sanitize_subtitle_text,
    clamp_subtitle_duration,
    sanitize_srt_file,
    slice_srt_content_for_preview,
    parse_time_to_seconds,
)

print("=" * 60)
print("TEST 1: STRICT ARABIC CHARACTER WHITELIST")
print("=" * 60)

# 1. Ligatures and decomposed Lam-Alif
test_ligatures = "ع\uFEFBقة ومار\uFEFB وأحمد \uFEF7 \uFEF9"
cleaned_lig = sanitize_subtitle_text(test_ligatures)
assert "علاقة" in cleaned_lig
assert "ومارلا" in cleaned_lig
print("  - Ligatures converted to standard Arabic letters: PASS")

# 2. Tatweel / Kashida
test_tatweel = "مــــرحـــبـــاً"
cleaned_tatweel = sanitize_subtitle_text(test_tatweel)
assert "ـ" not in cleaned_tatweel and "\u0640" not in cleaned_tatweel
print("  - Tatweel stripped completely: PASS")

# 3. Tashkeel / Harakat (Fatha, Damma, Kasra, Sukun, Shadda, etc.)
test_tashkeel = "السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللهِ"
cleaned_tashkeel = sanitize_subtitle_text(test_tashkeel)
assert cleaned_tashkeel == "السلام عليكم ورحمة الله"
print("  - Tashkeel stripped completely: PASS")

# 4. Brackets, braces, quotes, emojis, tofu chars
test_noise = "«(مرحبا)» [بكم] {يا أصدقاء} \"مارلا\" 'أحمد' 🎬 \u200b\u200f \ufffd"
cleaned_noise = sanitize_subtitle_text(test_noise)
assert cleaned_noise == "مرحبا بكم يا أصدقاء مارلا أحمد"
print("  - Brackets, quotes, emojis, control codes purged: PASS")

# 5. Punctuation whitelisted: . , ! ? : - ، ؟
test_punct = "نعم، هل أنت بخير؟ - بالتأكيد! 100% لا: 50."
cleaned_punct = sanitize_subtitle_text(test_punct)
assert "%" not in cleaned_punct
assert "،" in cleaned_punct and "؟" in cleaned_punct and "!" in cleaned_punct
print("  - Strict regex whitelist enforced: PASS")

print("✅ TEST 1 PASSED: Strict Whitelist works accurately!")

print("\n" + "=" * 60)
print("TEST 2: SMART DURATION CLAMPING")
print("=" * 60)
# Short text (len 4): max(2.2, min(5.0, 4*0.08 + 1.2)) = max(2.2, 1.52) = 2.2s
t_short = "أهلاً"
c_end_short = clamp_subtitle_duration(10.0, 20.0, t_short)
expected_short = 10.0 + 2.2
assert abs(c_end_short - expected_short) < 1e-4

# Long text (len 60): max(2.2, min(5.0, 60*0.08 + 1.2)) = max(2.2, min(5.0, 6.0)) = 5.0s
t_long = "هذه جملة طويلة جداً تحتوي على العديد من الكلمات للتأكد من حساب الحد الأقصى للمدة"
c_end_long = clamp_subtitle_duration(10.0, 20.0, t_long)
expected_long = 10.0 + 5.0
assert abs(c_end_long - expected_long) < 1e-4

print("✅ TEST 2 PASSED: Clamping formula strictly adheres to specifications!")

print("\n" + "=" * 60)
print("TEST 3: SUBTITLE OFFSET CONTROL")
print("=" * 60)
sample_srt = "1\n00:01:00,000 --> 00:01:03,000\nمرحبا بكم\n\n2\n00:01:05,000 --> 00:01:08,000\nإلى اللقاء\n"
test_srt_in = "scratch/temp_offset_in.srt"
test_srt_out = "scratch/temp_offset_out.srt"
with open(test_srt_in, "w", encoding="utf-8") as f:
    f.write(sample_srt)

# Apply +1.5s offset
sanitize_srt_file(test_srt_in, test_srt_out, offset_seconds=1.5)
with open(test_srt_out, "r", encoding="utf-8") as f:
    offset_content = f.read()

assert "00:01:01,500" in offset_content
assert "00:01:06,500" in offset_content
print("✅ TEST 3 PASSED: Subtitle micro-offset works correctly!")

print("\n" + "=" * 60)
print("TEST 4: PREVIEW SLICING (60s Window)")
print("=" * 60)
preview_srt_src = (
    "1\n00:01:30,000 --> 00:01:32,000\nحوار قديم قبل النافذة\n\n"
    "2\n00:02:25,000 --> 00:02:35,000\nحوار يتقاطع مع البداية\n\n"
    "3\n00:02:40,000 --> 00:02:45,000\nحوار داخل النافذة تماماً\n\n"
    "4\n00:03:25,000 --> 00:03:35,000\nحوار يتقاطع مع النهاية\n\n"
    "5\n00:04:00,000 --> 00:04:05,000\nحوار بعد انتهاء النافذة\n"
)
sliced = slice_srt_content_for_preview(preview_srt_src, 150.0, 60.0)
assert "حوار قديم" not in sliced
assert "حوار بعد انتهاء" not in sliced
assert "حوار يتقاطع مع البداية" in sliced
assert "حوار داخل النافذة تماماً" in sliced
assert "حوار يتقاطع مع النهاية" in sliced
assert "00:00:10,000" in sliced

print("✅ TEST 4 PASSED: 60s preview window correctly isolates and rebases dialogues!")

print("\nALL BACKEND & PIPELINE TESTS COMPLETED SUCCESSFULLY!")
