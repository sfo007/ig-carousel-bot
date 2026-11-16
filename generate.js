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
const next = process.env.TOPIC_INDEX ? topics[Number(process.env.TOPIC_INDEX)] : topics.find((t) => !t.posted);
if (!next) {
  console.error('No unposted topics left. Add more to topics.json');
  process.exit(1);
}
const topic = next.topic;
console.log('Topic:', topic);

async function writeContent() {
  // Prewritten content in topics.json is used as-is (no AI call needed)
  if (next.content) return next.content;
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

Each slide except the last has a "visual" that a NON-TECHNICAL store owner understands at a glance. Never use code. Choose one:
{"type":"flow","steps":["..."]}  - 3-4 steps, max 12 characters each. Use for the hook slide.
{"type":"page","highlight":"button|reviews|price|shipping|sticky|thumb","note":"short label"}  - a mock product page with one part highlighted.
{"type":"compare","left":{"label":"Before","button":"optional button text","text":"short text"},"right":{"label":"After","button":"optional","text":"short text"}}
{"type":"badges","items":[{"icon":"lock|return|truck|card|chat|star","label":"max 22 chars"}]}  - 3 items.
{"type":"gallery","items":[{"icon":"image|zoom|ruler|user","label":"max 16 chars"}]}  - 4 items.
{"type":"speed","before":{"label":"max 20 chars","text":"Slow"},"after":{"label":"max 20 chars","text":"Fast"}}
{"type":"toggles","items":[{"label":"max 28 chars","on":true}]}  - 3-4 items; on=false means switch it off or remove it.
{"type":"checklist","items":["..."]}  - 3-4 items, max 26 characters each.
Pick the visual that best shows the tip and vary them across slides. The last slide has "visual": null.

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
    for (let attempt = 1; attempt <= 3; attempt++) {
      let data, status = 0;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
          }),
          signal: AbortSignal.timeout(45000),
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


// ---- Non-technical visual mockups (no code needed to understand them) ----
const ICONS = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.5A8 8 0 1 1 21 12z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m8 12 2 2M11 9l2 2M14 6l2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
};
const icon = (name, size = 40) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.star}</svg>`;
const clip = (t, n) => esc(String(t ?? '').slice(0, n));

function pageHtml(v) {
  const h = String(v.highlight || 'button');
  const on = (k) => (h === k ? ' hl' : '');
  const btnHl = h === 'button' || h === 'thumb' ? ' hl' : '';
  const note = v.note ? `<span class="chip">${clip(v.note, 26)}</span>` : '';
  const reviews = `<div class="pg-stars${on('reviews')}">★★★★★ <small>Verified reviews</small></div>`;
  return `<div class="vis page">
    <div class="pg-h"><i></i><i></i><i></i><span>yourstore.com</span></div>
    <div class="pg-b${h === 'sticky' ? ' st' : ''}">
      <div class="pg-img">${icon('bag', 84)}</div>
      <div class="pg-info">
        <div class="pg-line"></div>
        <div class="pg-price${on('price')}">$29</div>
        ${reviews}
        <div class="pg-btn${btnHl}">Add to cart${h === 'thumb' ? '<span class="tap"></span>' : ''}</div>
        <div class="pg-note${on('shipping')}">Delivery and returns info</div>
      </div>
    </div>
    ${h === 'sticky' ? '<div class="pg-sticky hl">Add to cart</div>' : ''}
    ${note ? `<div class="pg-chip">${note}</div>` : ''}
  </div>`;
}

function compareHtml(v) {
  const card = (c, good) => `<div class="cmp-card${good ? ' good' : ''}">
      <div class="cmp-l">${clip(c?.label, 22)}</div>
      ${c?.button ? `<div class="cmp-btn${good ? ' good' : ''}">${clip(c.button, 26)}</div>` : ''}
      ${c?.text ? `<div class="cmp-t">${clip(c.text, 60)}</div>` : ''}
    </div>`;
  return `<div class="vis cmp">${card(v.left, false)}<span class="cmp-mid">${clip(v.link || '→', 2)}</span>${card(v.right, true)}</div>`;
}

function badgesHtml(v) {
  const items = v.items.slice(0, 3).map((b) => `<div class="bdg"><span>${icon(b.icon, 44)}</span><b>${clip(b.label, 22)}</b></div>`).join('');
  return `<div class="vis bdgs">${items}</div>`;
}

function galleryHtml(v) {
  const items = v.items.slice(0, 4).map((b) => `<div class="tile"><span>${icon(b.icon, 56)}</span><b>${clip(b.label, 18)}</b></div>`).join('');
  return `<div class="vis gal">${items}</div>`;
}

function speedHtml(v) {
  const row = (r, slow) => `<div class="spd-r"><span class="spd-l">${clip(r?.label, 22)}</span><div class="spd-t"><div class="spd-f${slow ? ' slow' : ''}"></div></div><b class="spd-x">${clip(r?.text, 8)}</b></div>`;
  return `<div class="vis spd"><div class="spd-title">Page load time</div>${row(v.before, true)}${row(v.after, false)}</div>`;
}

function togglesHtml(v) {
  const rows = v.items.slice(0, 4).map((r) => `<div class="tg"><span>${clip(r.label, 30)}</span><i class="sw${r.on ? ' on' : ''}"><u></u></i></div>`).join('');
  return `<div class="vis tgs">${rows}</div>`;
}

function visualHtml(v) {
  if (!v || typeof v !== 'object') return '';
  if (v.type === 'page') return pageHtml(v);
  if (v.type === 'compare' && v.left && v.right) return compareHtml(v);
  if (v.type === 'badges' && Array.isArray(v.items) && v.items.length) return badgesHtml(v);
  if (v.type === 'gallery' && Array.isArray(v.items) && v.items.length) return galleryHtml(v);
  if (v.type === 'speed' && v.before && v.after) return speedHtml(v);
  if (v.type === 'toggles' && Array.isArray(v.items) && v.items.length) return togglesHtml(v);
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
