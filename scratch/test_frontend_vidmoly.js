const assert = require('assert');

// Simulate the regex and functions from frontend/lib/api.js
function normalizeVidmolyUrl(url, preferredMirror = null) {
  if (!url || typeof url !== 'string') return url;
  const match = url.match(/(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.)?(vidmoly\.(?:me|to|net|org))\/(?:embed-)?([a-zA-Z0-9]+)(?:\.html)?/i);
  if (match && match[2]) {
    const origDomain = match[1].toLowerCase();
    const code = match[2];
    if (!['api', 'upload', 'dl', 'contact', 'faq'].includes(code.toLowerCase())) {
      const domain = preferredMirror || (origDomain.includes('vidmoly.to') ? 'vidmoly.to' : 'vidmoly.me');
      return `https://${domain}/embed-${code}.html`;
    }
  }
  return url;
}

function getVidmolyMirrorUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const normalized = normalizeVidmolyUrl(url);
  if (normalized.includes('vidmoly.me')) {
    return normalized.replace('vidmoly.me', 'vidmoly.to');
  } else if (normalized.includes('vidmoly.to')) {
    return normalized.replace('vidmoly.to', 'vidmoly.me');
  }
  return normalized;
}

console.log("=" .repeat(60));
console.log("TESTING FRONTEND VIDMOLY NORMALIZATION & MIRROR FALLBACK");
console.log("=" .repeat(60));

// Test 1: Direct code URL
const url1 = "https://vidmoly.me/abc123xyz";
const norm1 = normalizeVidmolyUrl(url1);
console.log(`Input: ${url1} -> Normalized: ${norm1}`);
assert.strictEqual(norm1, "https://vidmoly.me/embed-abc123xyz.html");

// Test 2: Already embed URL
const url2 = "https://vidmoly.me/embed-abc123xyz.html";
const norm2 = normalizeVidmolyUrl(url2);
console.log(`Input: ${url2} -> Normalized: ${norm2}`);
assert.strictEqual(norm2, "https://vidmoly.me/embed-abc123xyz.html");

// Test 3: .to mirror URL
const url3 = "https://vidmoly.to/abc123xyz.html";
const norm3 = normalizeVidmolyUrl(url3);
console.log(`Input: ${url3} -> Normalized: ${norm3}`);
assert.strictEqual(norm3, "https://vidmoly.to/embed-abc123xyz.html");

// Test 4: Mirror toggle
const mirror1 = getVidmolyMirrorUrl("https://vidmoly.me/embed-abc123xyz.html");
console.log(`Switch me -> to: ${mirror1}`);
assert.strictEqual(mirror1, "https://vidmoly.to/embed-abc123xyz.html");

const mirror2 = getVidmolyMirrorUrl("https://vidmoly.to/embed-abc123xyz.html");
console.log(`Switch to -> me: ${mirror2}`);
assert.strictEqual(mirror2, "https://vidmoly.me/embed-abc123xyz.html");

console.log("✅ ALL FRONTEND VIDMOLY TESTS PASSED!");
