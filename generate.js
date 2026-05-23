// generate.js — Spade Supplies Content Agent
// Runs every Monday via GitHub Actions
// Step 1: Claude Sonnet generates 35 posts
// Step 2: Claude Haiku QA checks every post
// Step 3: Writes clean JSON to posts.json

const fs = require('fs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not set in GitHub Secrets');
  process.exit(1);
}

// ── WEEK CONTEXT ──────────────────────────────────────────────
const now = new Date();
const weekLabel = now.toLocaleDateString('en-IN', {
  day: 'numeric', month: 'long', year: 'numeric'
});
const month = now.toLocaleString('en-IN', { month: 'long' });

// Seasonal context based on month
const seasonalContext = {
  'March': 'Summer approaching — push fans, cooling, earthing safety',
  'April': 'Peak summer — Atomberg BLDC fans, surge protectors, energy saving',
  'May': 'Peak summer Tamil Nadu — fans, wiring safety, LED lighting',
  'June': 'Monsoon starting Kerala — plumbing safety, pipe quality, waterproofing',
  'July': 'Monsoon peak Kerala — pipe quality, water damage prevention',
  'August': 'Monsoon winding down — post-monsoon checks, repairs',
  'September': 'Post-monsoon repairs — earthing checks, distribution boards',
  'October': 'Diwali season — home upgrades, lighting, smart switches',
  'November': 'Post-Diwali — home automation, energy efficiency',
  'December': 'Year-end — home projects, contractor focus',
  'January': 'Pongal new builds — complete electrical checklists, wiring',
  'February': 'New home season — automation, premium brands'
}[month] || 'General home electrical and plumbing safety';

// ── SYSTEM PROMPTS ────────────────────────────────────────────

const GENERATION_PROMPT = `You are a social media content creator for Spade Supplies, a trusted electrical, plumbing, and home automation supplier based in Tamil Nadu and Kerala, India. Established 1959.

BRAND VOICE: Friendly, practical, trustworthy. Simple for homeowners, credible for professionals. Never use engineering jargon. Always end with a CTA.

CRITICAL LANGUAGE RULES:
- When writing Tamil posts: use ONLY Tamil script. Zero mixing with Hindi, Bengali, or any other script.
- When writing Malayalam posts: use ONLY Malayalam script. Zero mixing.
- LinkedIn and Instagram: English only
- Facebook and YouTube Shorts: generate in English AND Tamil AND Malayalam

USPs: 100% Genuine Products | 65+ Years in Business | Same-day dispatch Tamil Nadu & Kerala | 50+ trusted brands | Free brand consultation

CTA: WhatsApp 7204406785 | spadesupplies.com

KEY BRANDS:
- Wires & Cables: Finolex, Polycab, Anchor, Etira, RR, Kundan
- Switchgear: Schneider, Legrand, Anchor, LK
- Fans: Atomberg, Havells, Crompton, GM, Gold Medal
- Lighting: Philips, Luker, Crompton
- Plumbing: Jaquar, Astral, Supreme, Watertec, Essco, Ashirwad
- Automation: Lutron (wired), Schneider (wireless)
- Earthing: Legreen
- Conduits: BEC, Precision, Anchor, Vasvi

POST STRUCTURE: Hook → Use Case → Brand → CTA

PLATFORM RULES:
- LinkedIn: Professional tone, under 150 words, B2B hashtags
- Instagram: Punchy, under 80 words, 5-8 hashtags, English only
- Facebook: Conversational, under 100 words, local TN/Kerala feel
- YouTube Shorts: 30-second natural spoken voiceover script only

CONTENT PILLARS: 35% Education, 30% Product/Brand, 25% Use Case, 10% Promotion
Do not repeat the same pillar twice in a row on the same platform.

SELF-CHECK before finalising each post:
- Never include specific ₹ price figures
- CTA WhatsApp number must always be 7204406785
- Instagram under 80 words, LinkedIn under 150, Facebook under 100
- Tamil posts: Tamil script ONLY
- Malayalam posts: Malayalam script ONLY
- No invented specifications or unverifiable statistics

After generating all posts, add QA fields to each:
- "qa_score": 0-100 (start 100, deduct 15 per issue found)
- "qa_flags": array of specific issues (empty array if none)
- "qa_pass": true if score >= 75

WEEKLY SCHEDULE TO GENERATE:
MONDAY: LinkedIn (EN) + Instagram (EN) + Facebook (EN + Tamil + Malayalam)
TUESDAY: Instagram (EN) + Facebook (EN + Tamil + Malayalam)
WEDNESDAY: LinkedIn (EN) + YouTube Shorts (EN + Tamil + Malayalam)
THURSDAY: Instagram (EN) + Facebook (EN + Tamil + Malayalam)
FRIDAY: LinkedIn (EN)
SATURDAY: Instagram (EN) + Facebook (EN + Tamil + Malayalam) + YouTube Shorts (EN + Tamil + Malayalam)

OUTPUT: Return ONLY a valid JSON array. No markdown. No backticks. No preamble. Start with [ and end with ].
Each object must have: topic, pillar, platform, language, day, hook, body, cta, hashtags, image_prompt, video_prompt, voiceover_script, qa_score, qa_flags, qa_pass`;

const QA_PROMPT = `You are a quality assurance agent for Spade Supplies social media content.

Review the JSON array provided and return an improved version with these fixes applied:

1. LANGUAGE PURITY — If any Tamil post contains non-Tamil script characters (Hindi/Bengali/other), rewrite the entire post in pure Tamil. Same for Malayalam.
2. PRICE MENTIONS — Remove any specific ₹ amounts. Replace with general language like "saves significantly" or "cost-effective".
3. CTA CHECK — Verify every post ends with WhatsApp 7204406785 or spadesupplies.com.
4. WORD COUNT — Trim Instagram posts over 80 words. Trim LinkedIn posts over 150 words. Trim Facebook posts over 100 words.
5. UPDATE QA FIELDS — Recalculate qa_score, qa_flags, qa_pass after fixes.

Return the complete fixed JSON array only. No markdown. No backticks. Start with [ and end with ].`;

// ── CLAUDE API CALL ───────────────────────────────────────────
async function callClaude(model, systemPrompt, userMessage, maxTokens = 16000) {
  console.log(`  → Calling ${model} (max ${maxTokens} tokens)...`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = await response.json();

  if (data.stop_reason === 'max_tokens') {
    console.warn('  ⚠️  Hit max_tokens limit — response may be truncated');
  }

  // Extract text from content array
  const text = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  console.log(`  ✓ ${data.usage.input_tokens} input + ${data.usage.output_tokens} output tokens`);
  return text;
}

// ── PARSE JSON SAFELY ─────────────────────────────────────────
function parseJSON(text) {
  // Strip markdown fences if present
  let clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Find JSON array boundaries
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('No JSON array found in response');
  }
  clean = clean.substring(start, end + 1);

  return JSON.parse(clean);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Spade Supplies Content Generation');
  console.log(`📅 Week of ${weekLabel}`);
  console.log(`🌤  Seasonal focus: ${seasonalContext}\n`);

  const contentBriefing = `Generate the full week of social media content for Spade Supplies.

Week: ${weekLabel}
Seasonal focus: ${seasonalContext}

Generate posts for all platforms and days as specified. Rotate topics — do not repeat the same brand or product category on consecutive days. Mix educational, product, use case, and promotional content as per the pillar ratios.`;

  // ── STEP 1: Generate with Sonnet ──
  console.log('STEP 1: Generating posts with Claude Sonnet 4.6...');
  let rawText;
  try {
    rawText = await callClaude(
      'claude-sonnet-4-20250514',
      GENERATION_PROMPT,
      contentBriefing,
      16000
    );
  } catch (err) {
    console.error('❌ Generation failed:', err.message);
    process.exit(1);
  }

  // ── STEP 2: QA check with Haiku ──
  console.log('\nSTEP 2: Running QA check with Claude Haiku 4.5...');
  let qaText;
  try {
    qaText = await callClaude(
      'claude-haiku-4-5-20251001',
      QA_PROMPT,
      rawText,
      16000
    );
  } catch (err) {
    console.warn('⚠️  QA check failed, using raw generation:', err.message);
    qaText = rawText; // Fall back to raw if QA fails
  }

  // ── STEP 3: Parse and save ──
  console.log('\nSTEP 3: Parsing and saving posts...');
  let posts;
  try {
    posts = parseJSON(qaText);
  } catch (err) {
    console.warn('⚠️  QA parse failed, trying raw output...');
    try {
      posts = parseJSON(rawText);
    } catch (err2) {
      console.error('❌ Could not parse JSON:', err2.message);
      console.error('Raw output:', qaText.substring(0, 500));
      process.exit(1);
    }
  }

  // Add metadata
  const output = {
    generated_at: new Date().toISOString(),
    week_label: weekLabel,
    seasonal_focus: seasonalContext,
    total_posts: posts.length,
    posts: posts.map((p, i) => ({ id: i + 1, ...p }))
  };

  fs.writeFileSync('posts.json', JSON.stringify(output, null, 2));

  // Summary
  const flagged = posts.filter(p => p.qa_flags && p.qa_flags.length > 0).length;
  console.log(`\n✅ Done!`);
  console.log(`   📝 ${posts.length} posts generated`);
  console.log(`   ⚠️  ${flagged} posts flagged for review`);
  console.log(`   📂 Written to posts.json`);
  console.log(`   🔗 Dashboard will update automatically via Vercel\n`);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
