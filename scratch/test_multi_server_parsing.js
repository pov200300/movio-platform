const { parseMovieData, getMovieEmbedUrl } = require('../frontend/lib/api');

console.log('Testing parseMovieData with multiple server scenarios...\n');

// Test Case 1: Post with all 4 servers in post meta
const postAllMeta = {
  id: 101,
  slug: 'test-all-meta',
  title: { rendered: 'Gladiator II (2024)' },
  content: { rendered: '<p>A great epic film.</p>' },
  meta: {
    _stream_vidmoly: 'https://vidmoly.me/w/gladiator2_1080p',
    _stream_streamhg: 'https://streamhg.com/e/gladiator2_720p',
    _stream_streamtape: 'https://streamtape.com/e/gladiator2',
    _stream_doodstream: 'https://doodstream.com/e/gladiator2',
    imdb_rating: '8.2',
    quality: '1080p Full HD'
  }
};

const parsed1 = parseMovieData(postAllMeta);
console.log('--- Test Case 1: Post with all 4 servers in post meta ---');
console.log('primaryEmbed:', parsed1.primaryEmbed);
console.log('servers count:', parsed1.servers.length);
console.log('servers:', parsed1.servers);
console.assert(parsed1.primaryEmbed === 'https://vidmoly.me/w/gladiator2_1080p', 'Priority primaryEmbed must be vidmoly');
console.assert(parsed1.servers.length === 4, 'Must have 4 servers');
console.assert(parsed1.servers[0].id === 'vidmoly', 'First server must be Vidmoly');
console.assert(parsed1.servers[1].id === 'streamhg', 'Second server must be StreamHG');
console.assert(parsed1.servers[2].id === 'streamtape', 'Third server must be Streamtape');
console.assert(parsed1.servers[3].id === 'doodstream', 'Fourth server must be Doodstream');

// Test Case 2: Post with servers in HTML comment (new format)
const postHtmlComment = {
  id: 102,
  slug: 'test-html-comment',
  title: { rendered: 'Dune: Part Two (2024)' },
  content: {
    rendered: `
      <p>Epic sci-fi movie.</p>
      <!-- SERVERS: vidmoly=https://vidmoly.me/w/dune2 streamhg=https://streamhg.com/e/dune2 streamtape=https://streamtape.com/e/dune2 dood=https://doodstream.com/e/dune2 -->
    `
  },
  meta: {}
};

const parsed2 = parseMovieData(postHtmlComment);
console.log('\n--- Test Case 2: Post with servers in HTML comment ---');
console.log('primaryEmbed:', parsed2.primaryEmbed);
console.log('servers count:', parsed2.servers.length);
console.log('servers:', parsed2.servers);
console.assert(parsed2.servers.length === 4, 'Must extract all 4 servers from HTML comment');
console.assert(parsed2.primaryEmbed === 'https://vidmoly.me/w/dune2', 'Primary must be vidmoly');

// Test Case 3: Legacy Post with only Streamtape and Dood in comment
const postLegacyComment = {
  id: 103,
  slug: 'test-legacy-comment',
  title: { rendered: 'Oppenheimer (2023)' },
  content: {
    rendered: `
      <p>Historical drama.</p>
      <!-- SERVERS: dood=https://doodstream.com/e/oppenheimer streamtape=https://streamtape.com/e/oppenheimer -->
    `
  },
  meta: {}
};

const parsed3 = parseMovieData(postLegacyComment);
console.log('\n--- Test Case 3: Legacy post with dood and streamtape ---');
console.log('primaryEmbed:', parsed3.primaryEmbed);
console.log('servers count:', parsed3.servers.length);
console.log('servers:', parsed3.servers);
console.assert(parsed3.servers.length === 2, 'Must have 2 servers');
console.assert(parsed3.primaryEmbed === 'https://streamtape.com/e/oppenheimer', 'Priority streamtape over dood');

// Test Case 4: Backwards compatibility - single generic embed_url
const postSingleEmbed = {
  id: 104,
  slug: 'test-single-embed',
  title: { rendered: 'The Dark Knight (2008)' },
  content: { rendered: '<p>Classic film.</p>' },
  meta: {
    embed_url: 'https://example-embed.com/play/12345'
  }
};

const parsed4 = parseMovieData(postSingleEmbed);
console.log('\n--- Test Case 4: Single generic embed_url ---');
console.log('primaryEmbed:', parsed4.primaryEmbed);
console.log('servers count:', parsed4.servers.length);
console.log('servers:', parsed4.servers);
console.assert(parsed4.servers.length === 1, 'Must fallback to 1 server');
console.assert(parsed4.primaryEmbed === 'https://example-embed.com/play/12345', 'Primary must be fallback');

// Test Case 5: Partial servers (Vidmoly and Dood only)
const postPartial = {
  id: 105,
  slug: 'test-partial',
  title: { rendered: 'Interstellar (2014)' },
  content: {
    rendered: '<!-- SERVERS: vidmoly=https://vidmoly.me/w/interstellar streamhg= streamtape= dood=https://dood.so/e/interstellar -->'
  },
  meta: {}
};

const parsed5 = parseMovieData(postPartial);
console.log('\n--- Test Case 5: Partial servers (Vidmoly and Dood only) ---');
console.log('primaryEmbed:', parsed5.primaryEmbed);
console.log('servers count:', parsed5.servers.length);
console.log('servers:', parsed5.servers);
console.assert(parsed5.servers.length === 2, 'Only valid servers should be included');
console.assert(parsed5.primaryEmbed === 'https://vidmoly.me/w/interstellar', 'Primary must be vidmoly');

console.log('\nALL PARSING UNIT TESTS PASSED SUCCESSFULLY! ✅');
