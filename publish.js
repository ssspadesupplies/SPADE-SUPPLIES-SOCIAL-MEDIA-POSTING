// publish.js — Spade Supplies Publishing Agent
// Triggered by push to approved_posts.json
// Posts to: Facebook, Instagram, LinkedIn (YouTube skipped — needs OAuth setup)

const fs = require('fs');

// ── CONFIG ────────────────────────────────────────────────────
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const LINKEDIN_ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
const LINKEDIN_AUTHOR_URN = process.env.LINKEDIN_AUTHOR_URN; // urn:li:person:XXXXX or urn:li:organization:XXXXX

// ── HELPERS ───────────────────────────────────────────────────
async function apiCall(url, method = 'GET', body = null, headers = {}) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── FACEBOOK ──────────────────────────────────────────────────
async function postToFacebook(post) {
  if (!META_PAGE_ACCESS_TOKEN || !META_PAGE_ID) {
    console.log('  ⏭  Facebook: credentials not configured, skipping');
    return null;
  }

  const caption = buildCaption(post);
  const url = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/feed`;

  const body = { message: caption, access_token: META_PAGE_ACCESS_TOKEN };

  // If image URL is available, post with photo
  if (post.generated_image_url) {
    const photoUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/photos`;
    const result = await apiCall(photoUrl, 'POST', {
      url: post.generated_image_url,
      caption,
      access_token: META_PAGE_ACCESS_TOKEN
    });
    console.log(`  ✅ Facebook photo post: ${result.id}`);
    return result.id;
  }

  const result = await apiCall(url, 'POST', body);
  console.log(`  ✅ Facebook text post: ${result.id}`);
  return result.id;
}

// ── INSTAGRAM ─────────────────────────────────────────────────
async function postToInstagram(post) {
  if (!META_PAGE_ACCESS_TOKEN || !INSTAGRAM_ACCOUNT_ID) {
    console.log('  ⏭  Instagram: credentials not configured, skipping');
    return null;
  }

  if (!post.generated_image_url) {
    console.log('  ⏭  Instagram: no image URL, skipping (image required)');
    return null;
  }

  const caption = buildCaption(post);

  // Step 1: Create media container
  const containerUrl = `https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media`;
  const container = await apiCall(containerUrl, 'POST', {
    image_url: post.generated_image_url,
    caption,
    access_token: META_PAGE_ACCESS_TOKEN
  });

  // Step 2: Wait for container to be ready
  await sleep(5000);

  // Step 3: Publish the container
  const publishUrl = `https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media_publish`;
  const result = await apiCall(publishUrl, 'POST', {
    creation_id: container.id,
    access_token: META_PAGE_ACCESS_TOKEN
  });

  console.log(`  ✅ Instagram post: ${result.id}`);
  return result.id;
}

// ── LINKEDIN ──────────────────────────────────────────────────
async function postToLinkedIn(post) {
  if (!LINKEDIN_ACCESS_TOKEN || !LINKEDIN_AUTHOR_URN) {
    console.log('  ⏭  LinkedIn: credentials not configured, skipping');
    return null;
  }

  const caption = buildCaption(post);

  const body = {
    author: LINKEDIN_AUTHOR_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: caption },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  const result = await apiCall(
    'https://api.linkedin.com/v2/ugcPosts',
    'POST',
    body,
    { Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}` }
  );

  const postId = result.id || result.headers?.['x-restli-id'];
  console.log(`  ✅ LinkedIn post: ${postId}`);
  return postId;
}

// ── YOUTUBE ───────────────────────────────────────────────────
async function postToYouTube(post) {
  // YouTube requires OAuth2 refresh token setup
  // Add YOUTUBE_REFRESH_TOKEN to GitHub Secrets and implement here
  console.log('  ⏭  YouTube: OAuth2 setup required — see README for instructions');
  return null;
}

// ── CAPTION BUILDER ───────────────────────────────────────────
function buildCaption(post) {
  const parts = [];
  if (post.hook) parts.push(post.hook);
  if (post.body) parts.push(post.body);
  if (post.cta) parts.push(post.cta);
  if (post.hashtags) {
    const tags = Array.isArray(post.hashtags)
      ? post.hashtags.join(' ')
      : post.hashtags;
    parts.push(tags);
  }
  return parts.filter(Boolean).join('\n\n');
}

// ── PLATFORM ROUTER ───────────────────────────────────────────
async function publishPost(post) {
  const platform = (post.platform || '').toLowerCase();
  console.log(`\n  📤 Publishing: "${post.topic}" → ${post.platform} (${post.language})`);

  try {
    if (platform === 'facebook') return await postToFacebook(post);
    if (platform === 'instagram') return await postToInstagram(post);
    if (platform === 'linkedin') return await postToLinkedIn(post);
    if (platform === 'youtube shorts') return await postToYouTube(post);
    console.log(`  ⏭  Unknown platform: ${post.platform}`);
    return null;
  } catch (err) {
    console.error(`  ❌ Failed: ${err.message}`);
    return { error: err.message };
  }
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Spade Supplies Publishing Agent');
  console.log(`⏰  ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`);

  // Read approved posts
  if (!fs.existsSync('approved_posts.json')) {
    console.log('📭 No approved_posts.json found — nothing to publish');
    process.exit(0);
  }

  const raw = fs.readFileSync('approved_posts.json', 'utf8');
  let approved;
  try {
    approved = JSON.parse(raw);
  } catch (err) {
    console.error('❌ Could not parse approved_posts.json:', err.message);
    process.exit(1);
  }

  if (!approved.posts || approved.posts.length === 0) {
    console.log('📭 No posts in approved_posts.json');
    process.exit(0);
  }

  // Read existing published log
  let published = { published_at: [], posts: [] };
  if (fs.existsSync('published_posts.json')) {
    try {
      published = JSON.parse(fs.readFileSync('published_posts.json', 'utf8'));
    } catch (e) {}
  }

  // Get already-published post IDs to avoid duplicates
  const publishedIds = new Set(published.posts.map(p => p.id));

  // Filter out already published
  const toPublish = approved.posts.filter(p => !publishedIds.has(p.id));
  console.log(`📋 ${toPublish.length} posts to publish (${approved.posts.length - toPublish.length} already published)\n`);

  if (toPublish.length === 0) {
    console.log('✅ All approved posts already published');
    process.exit(0);
  }

  // Publish each post with a small delay between calls
  const results = [];
  for (const post of toPublish) {
    const platformId = await publishPost(post);
    results.push({
      id: post.id,
      topic: post.topic,
      platform: post.platform,
      language: post.language,
      published_at: new Date().toISOString(),
      platform_post_id: platformId,
      status: platformId && !platformId.error ? 'published' : 'failed'
    });
    await sleep(2000); // 2 second delay between posts — respect rate limits
  }

  // Update published log
  published.posts = [...published.posts, ...results];
  published.last_run = new Date().toISOString();
  fs.writeFileSync('published_posts.json', JSON.stringify(published, null, 2));

  // Summary
  const succeeded = results.filter(r => r.status === 'published').length;
  const failed = results.filter(r => r.status === 'failed').length;
  console.log(`\n✅ Publishing complete`);
  console.log(`   ✓ ${succeeded} posts published`);
  if (failed > 0) console.log(`   ✗ ${failed} posts failed (check logs above)`);
  console.log('');
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
