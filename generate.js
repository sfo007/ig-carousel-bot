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
// Tried in order; the first one that works is used (set GEMINI_MODEL to force one)
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean);
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
        { title: 'Your product page is leaking sales', body: 'Fix these 5 things first.', visual: { type: 'flow', steps: ['Visitor', 'Product page', 'Cart', 'Sale'] } },
        { title: 'Keep the buy button above the fold', body: 'Shoppers should not scroll to buy. Keep price, variants and add to cart visible on mobile.', visual: { type: 'code', file: 'sections/main-product.liquid', lines: ['<div class="product-buy sticky-top">', '  {{ product.price | money }}', '  {% render \'variant-picker\' %}', '  <button type="submit">Add to cart</button>', '</div>'] } },
        { title: 'Use real photos, not just renders', body: 'Add 5-7 images including lifestyle shots and one close-up. Compress them to stay fast.', visual: { type: 'checklist', items: ['Lifestyle shots', 'One close-up detail', 'Size and scale photo', 'Compressed WebP'] } },
        { title: 'Put reviews near the button', body: 'Social proof right beside add to cart beats a review section buried at the bottom.', visual: { type: 'code', file: 'sections/main-product.liquid', lines: ['{% render \'star-rating\', product: product %}', '<button type="submit">Add to cart</button>'] } },
        { title: 'Make shipping and returns obvious', body: 'State delivery time and return policy under the button to remove last-second doubt.', visual: { type: 'checklist', items: ['Delivery time', 'Free returns window', 'Secure checkout badge'] } },
        { title: 'Speed up the page', body: 'Every extra second costs conversions. Lazy load below-fold images and remove unused apps.', visual: { type: 'code', file: 'snippets/product-image.liquid', lines: ['{{ image | image_url: width: 800 | image_tag:', "   loading: 'lazy', sizes: '(min-width: 750px) 50vw, 100vw' }}"] } },
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
{"slides":[{"title":"","body":"","visual":null}],"caption":"","hashtags":[]}

Each slide except the last has a "visual", one of:
{"type":"code","file":"sections/main-product.liquid","lines":["..."]}  - a short, correct, realistic snippet (2-5 lines, max 44 characters per line) that illustrates the tip. Use real Shopify Liquid, HTML, CSS or WordPress PHP only. Never invent functions, settings or APIs.
{"type":"checklist","items":["..."]}  - 3-4 items, max 26 characters each.
{"type":"flow","steps":["..."]}  - 3-4 steps, max 14 characters each (e.g. a funnel or process).
Use "code" when the tip can be shown in code. Otherwise use "checklist". Use "flow" for the hook slide. The last slide has "visual": null.

Rules:
- Exactly 7 slides.
- Slide 1 is the hook: title max 9 words, body max 12 words.
- Slides 2-6: one specific, actionable tip each. Title max 7 words, body max 26 words. Concrete, no fluff, no emojis.
- Slide 7 is the call to action: title "Need help with your store?", body "${CTA_TEXT}".
- Caption: 2-3 short paragraphs, max 800 characters, ends with a question to drive comments. No hashtags in it.
- 8-10 relevant hashtags, lowercase, without the # symbol.
- Do not invent statistics.`;

  let text, lastErr;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  outer: for (const model of MODELS) {
    // Retry temporary errors (503 high demand, 429 rate limit, timeouts) with a growing wait
    for (let attempt = 1; attempt <= 5; attempt++) {
      let data, status = 0;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
          }),
          signal: AbortSignal.timeout(90000),
        });
        status = res.status;
        data = await res.json();
      } catch (e) {
        data = { error: { message: String(e) } };
      }
      text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) { console.log(`Model used: ${model} (attempt ${attempt})`); break outer; }
      lastErr = `${model}: ${JSON.stringify(data).slice(0, 300)}`;
      const temporary = status === 503 || status === 429 || status === 500 || status === 0;
      console.warn(`Attempt ${attempt} failed ->`, lastErr);
      if (!temporary) break; // 404 etc: move on to the next model
      await sleep(attempt * 20000);
    }
  }
  if (!text) throw new Error('Gemini returned no content. Last error: ' + lastErr);
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

// Small topic visuals (code window, checklist, funnel flow)
const highlight = (line) =>
  esc(line)
    .replace(/(\{\{.*?\}\}|\{%.*?%\})/g, '<span class="acc">$1</span>')
    .replace(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g, '<span class="tag">$1</span>');

function visualHtml(v) {
  if (!v || typeof v !== 'object') return '';
  if (v.type === 'code' && Array.isArray(v.lines) && v.lines.length) {
    const lines = v.lines.slice(0, 5).map((l, n) => `<div class="ln"><b>${String(n + 1).padStart(2, '0')}</b><span>${highlight(String(l).slice(0, 48))}</span></div>`).join('');
    return `<div class="vis win"><div class="win-h"><i></i><i></i><i></i><span>${esc(String(v.file || 'snippet').slice(0, 40))}</span></div><div class="win-b">${lines}</div></div>`;
  }
  if (v.type === 'checklist' && Array.isArray(v.items) && v.items.length) {
    const items = v.items.slice(0, 4).map((t) => `<div><span class="tick">✓</span>${esc(String(t).slice(0, 34))}</div>`).join('');
    return `<div class="vis chk">${items}</div>`;
  }
  if (v.type === 'flow' && Array.isArray(v.steps) && v.steps.length > 1) {
    const st = v.steps.slice(0, 4);
    const items = st.map((t, n) => `<span class="step${n === st.length - 1 ? ' last' : ''}">${esc(String(t).slice(0, 18))}</span>`).join('<span class="arr">→</span>');
    return `<div class="vis flow">${items}</div>`;
  }
  return '';
}

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
    VISUAL: type === 'cta'
      ? `<div class="vis"><div class="chips-l">Builds on</div><div class="flow"><span class="step">Shopify</span><span class="step">WordPress</span><span class="step">Webflow</span></div></div>`
      : visualHtml(slide.visual),
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
