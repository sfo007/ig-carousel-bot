// Publishes the latest generated folder as an Instagram carousel via the Graph API.
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.IG_TOKEN;
const IG_ID = process.env.IG_USER_ID;
const REPO = process.env.GITHUB_REPOSITORY; // e.g. you/ig-carousel-bot
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const G = 'https://graph.facebook.com/v21.0';

if (!TOKEN || !IG_ID || !REPO) throw new Error('Missing IG_TOKEN, IG_USER_ID or GITHUB_REPOSITORY');

const dir = fs.readFileSync('.latest', 'utf8').trim();
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const files = fs
  .readdirSync(dir)
  .filter((f) => /^slide-\d+\.png$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, params = {}) {
  const url = new URL(`${G}/${p}`);
  const opts = { method };
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', TOKEN);
  } else {
    opts.body = new URLSearchParams({ ...params, access_token: TOKEN });
  }
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${p}: ${JSON.stringify(j.error || j)}`);
  return j;
}

async function waitForUrl(url) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url);
    if (r.ok) return;
    await sleep(8000);
  }
  throw new Error('Image not reachable (is the repo public and pushed?): ' + url);
}

const urls = files.map((f) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${dir}/${f}`);

if (process.env.DRY_RUN === 'true') {
  console.log('DRY RUN. Would publish:\n', urls.join('\n'), '\n\nCaption:\n', meta.caption);
  process.exit(0);
}

for (const u of urls) await waitForUrl(u);

const children = [];
for (const image_url of urls) {
  const { id } = await call('POST', `${IG_ID}/media`, { image_url, is_carousel_item: 'true' });
  children.push(id);
  console.log('Child container', id);
}

const { id: carouselId } = await call('POST', `${IG_ID}/media`, {
  media_type: 'CAROUSEL',
  children: children.join(','),
  caption: meta.caption,
});
console.log('Carousel container', carouselId);

for (let i = 0; i < 20; i++) {
  const { status_code } = await call('GET', carouselId, { fields: 'status_code' });
  console.log('Status:', status_code);
  if (status_code === 'FINISHED') break;
  if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error('Container status ' + status_code);
  await sleep(5000);
}

const { id: mediaId } = await call('POST', `${IG_ID}/media_publish`, { creation_id: carouselId });
console.log('Published media', mediaId);

// Mark the topic as posted
const topics = JSON.parse(fs.readFileSync('topics.json', 'utf8'));
const t = topics.find((x) => x.topic === meta.topic);
if (t) {
  t.posted = true;
  t.postedAt = new Date().toISOString();
  t.mediaId = mediaId;
  fs.writeFileSync('topics.json', JSON.stringify(topics, null, 2) + '\n');
}
