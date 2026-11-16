// Picks the next unposted topic, writes carousel copy with Gemini, renders slides to PNG.
// Run with MOCK=1 to skip the AI call and test the design locally.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// ---- Edit these ----
const HANDLE = '@salmanul.farisy_';
const BRAND = { bg: '#0B1020', card: '#121A33', accent: '#7CFFB2', text: '#F4F6FF', muted: '#9AA4C7' };
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
const dots = (i) => slides.map((_, j) => `<span class="dot${j === i ? ' on' : ''}"></span>`).join('');

function render(slide, i) {
  const type = i === 0 ? 'cover' : i === total - 1 ? 'cta' : 'content';
  const map = {
    BG: BRAND.bg, CARD: BRAND.card, ACCENT: BRAND.accent, TEXT: BRAND.text, MUTED: BRAND.muted,
    HANDLE: esc(HANDLE), NUM: i + 1, TOTAL: total, TYPE: type,
    NUMBER_BLOCK: type === 'content' ? `<div class="num">${String(i).padStart(2, '0')}</div>` : '',
    TITLE: esc(slide.title), BODY: esc(slide.body),
    PILL: type === 'cta' ? `<span class="pill">Follow ${esc(HANDLE)}</span>` : '',
    DOTS: dots(i),
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
