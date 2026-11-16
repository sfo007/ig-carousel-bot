// Flags duplicate or near-duplicate topics in topics.json.  Run: node check-topics.js
import fs from 'node:fs';

const STOP = new Set('a an the and or of to for in on with how why what is are your you can it its that this be as at by from vs not do does more'.split(' '));
const tokens = (t) => new Set((t.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => {
  const A = tokens(a), B = tokens(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
};

const topics = JSON.parse(fs.readFileSync('topics.json', 'utf8')).map((t) => t.topic);
let found = 0;
for (let i = 0; i < topics.length; i++) {
  for (let j = i + 1; j < topics.length; j++) {
    const s = jaccard(topics[i], topics[j]);
    if (s >= 0.5) {
      found++;
      console.warn(`Possible duplicate (${s.toFixed(2)}):\n  - ${topics[i]}\n  - ${topics[j]}`);
    }
  }
}
console.log(found ? `${found} possible duplicate pair(s) found` : `No duplicates found in ${topics.length} topics`);
