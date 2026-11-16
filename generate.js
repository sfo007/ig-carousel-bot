// Picks the next unposted topic, writes carousel copy with Gemini, renders slides to PNG.
// Run with MOCK=1 to skip the AI call and test the design locally.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// ---- Edit these ----
const HANDLE = '@salmanul.farisy_';
const NAME = 'Salmanul Farisy';
const SITE = 'salmanulfarisy.com';
const BRAND = { bg: '#0A0A0C', card: '#121214', line: '#232327', accent: '#74C0FF', text: '#EEEBE4', muted: '#8E8E95' };
const MODEL = 'gemini-2.5-flash';
const CTA_TEXT = 'DM "AUDIT" for a free quick review';
// --------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const topics = JSON.parse(fs.readFileSync('topics.json', 'utf8'));
const next = topics.find((t) => !t.posted);
if (!next) {
  console.error('No unposted topics left. Add more to topics.json');
  process.exit(1);
}
const topic = next.topic;
console.log('Topic:', topic);

async function writeContent() {
  if (process.env.MOCK) {
    return {
      slides: [
        { title: 'Your product page is leaking sales', body: 'Fix these 5 things first.' },
        { title: 'Show the price and CTA above the fold', body: 'Shoppers should not scroll to buy. Keep price, variant picker and add to cart visible on mobile.' },
        { title: 'Use real photos, not just renders', body: 'Add 5-7 images including lifestyle shots and one close-up. Compress them to stay fast.' },
        { title: 'Put reviews near the button', body: 'Social proof right beside add to cart beats a review section buried at the bottom.' },
        { title: 'Make shipping and returns obvious', body: 'State delivery time and return policy under the button to remove last-second doubt.' },
        { title: 'Speed up the page', body: 'Every extra second costs conversions. Lazy load below-fold images and remove unused apps.' },
        { title: 'Need help with your store?', body: CTA_TEXT },
      ],
      caption: 'Most Shopify stores do not have a traffic problem, they have a conversion problem.\n\nSave this and run through it on your own product page.\n\nWhich of these are you missing?',
      hashtags: ['shopify', 'cro', 'ecommerce', 'shopifydeveloper', 'conversionrate'],
    };
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const prompt = `You write Instagram carousel content for a freelance Shopify and WordPress developer who also does conversion rate optimisation (CRO).
Topic: "${topic}"
Audience: online store owners and marketers.

Return ONLY JSON in this shape:
{"slides":[{"title":"","body":""}],"caption":"","hashtags":[]}

Rules:
- Exactly 7 slides.
- Slide 1 is the hook: title max 9 words, body max 12 words.
- Slides 2-6: one specific, actionable tip each. Title max 7 words, body max 26 words. Concrete, no fluff, no emojis.
- Slide 7 is the call to action: title "Need help with your store?", body "${CTA_TEXT}".
- Caption: 2-3 short paragraphs, max 800 characters, ends with a question to drive comments. No hashtags in it.
- 8-10 relevant hashtags, lowercase, without the # symbol.
- Do not invent statistics.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
    }),
  });
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content: ' + JSON.stringify(data).slice(0, 500));
  const out = JSON.parse(text);
  if (!Array.isArray(out.slides) || out.slides.length < 3) throw new Error('Bad slide data from Gemini');
  return out;
}

const content = await writeContent();
const slides = content.slides.slice(0, 10); // Instagram max is 10
const total = slides.length;

const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const date = new Date().toISOString().slice(0, 10);
const dir = path.posix.join('posts', `${date}-${slug}`);
fs.mkdirSync(dir, { recursive: true });

const tpl = fs.readFileSync('template.html', 'utf8');
const bars = (i) => slides.map((_, j) => `<span class="bar${j === i ? ' on' : ''}"></span>`).join('');

// Bundle fonts into the page so rendering is identical everywhere (no network needed)
const fontFiles = [
  ['Syne', 700, 'syne'], ['Syne', 800, 'syne'],
  ['JetBrains Mono', 400, 'jetbrains-mono'], ['JetBrains Mono', 500, 'jetbrains-mono'],
  ['Inter', 400, 'inter'], ['Inter', 500, 'inter'],
];
const FONTS = fontFiles
  .map(([family, weight, pkg]) => {
    const b64 = fs.readFileSync(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  })
  .join('\n');

// Title with an accent-coloured full stop, like the site headings
const titleHtml = (t) => {
  const clean = String(t).trim();
  if (/[?!]$/.test(clean)) return esc(clean);
  return esc(clean.replace(/[.:\s]+$/, '')) + '<span class="dot">.</span>';
};

function render(slide, i) {
  const type = i === 0 ? 'cover' : i === total - 1 ? 'cta' : 'content';
  const label = type === 'cover' ? '/ New post' : type === 'cta' ? "/ Let's work together" : `/ Tip ${String(i).padStart(2, '0')}`;
  const map = {
    FONTS, BG: BRAND.bg, CARD: BRAND.card, LINE: BRAND.line, ACCENT: BRAND.accent, TEXT: BRAND.text, MUTED: BRAND.muted,
    NAME: esc(NAME), NUM: String(i + 1).padStart(2, '0'), TOTAL: String(total).padStart(2, '0'), TYPE: type,
    LABEL: esc(label),
    TITLE: titleHtml(slide.title), BODY: esc(slide.body),
    PILL: type === 'cta' ? `<span class="pill">Follow ${esc(HANDLE)}</span>` : '',
    SITE: type === 'cta' ? `<div class="site">${esc(SITE)}</div>` : '',
    BARS: bars(i),
    SWIPE: i < total - 1 ? 'Swipe →' : '',
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? map[k] : ''));
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (let i = 0; i < total; i++) {
  await page.setContent(render(slides[i], i), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(dir, `slide-${i + 1}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  console.log('Wrote', file);
}
await browser.close();

const tags = (content.hashtags || []).map((h) => '#' + String(h).replace(/[^a-zA-Z0-9_]/g, '')).filter((h) => h.length > 1);
const caption = `${content.caption.trim()}\n\n${tags.join(' ')}`.slice(0, 2100);
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ topic, caption, slides: total }, null, 2));
fs.writeFileSync('.latest', dir);
console.log('Done:', dir);
