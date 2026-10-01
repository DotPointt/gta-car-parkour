/**
 * Level generator check:  npm run levels -- [count] [--plan N]
 *  - generates levels 1..count exactly like the game does;
 *  - fails on duplicated signatures, broken structure, NaNs or track below the city skyline;
 *  - prints one line per level and catalog usage statistics.
 * `--plan N` prints the full JSON plan of level N (useful to debug or hand-edit a level).
 */
import { MIN_TRACK_ALTITUDE } from '../src/core/constants';
import { LevelLibrary, difficultyLabel, layoutAll, obstacleTitles } from '../src/levels/generator';
import { CATALOG, OBSTACLES } from '../src/levels/catalog';

const args = process.argv.slice(2);
const planIdx = args.indexOf('--plan');
const lib = new LevelLibrary();

if (args.includes('--catalog')) {
  console.log('| type | title | kind | from difficulty | summary |\n|---|---|---|---|---|');
  for (const d of CATALOG) console.log(`| \`${d.type}\` | ${d.title || '—'} | ${d.kind} | ${d.minDifficulty} | ${d.summary} |`);
  process.exit(0);
}

if (planIdx >= 0) {
  const n = Number(args[planIdx + 1] ?? 1);
  console.log(JSON.stringify(lib.get(n), null, 2));
  process.exit(0);
}

const count = Number(args[0] ?? 60);
const t0 = performance.now();
const seen = new Map<string, number>();
const usage = new Map<string, number>();
const errors: string[] = [];

for (let i = 1; i <= count; i++) {
  const p = lib.get(i);
  const fail = (msg: string) => errors.push(`level ${i}: ${msg}`);
  if (seen.has(p.signature)) fail(`same signature as level ${seen.get(p.signature)}`);
  seen.set(p.signature, i);
  if (p.segments[0]?.type !== 'start') fail('does not begin with start');
  if (p.segments[p.segments.length - 1]?.type !== 'finish') fail('does not end with finish');

  const layouts = layoutAll(p.segments);
  let minY = Infinity;
  let maxY = -Infinity;
  let length = 0;
  for (const l of layouts) {
    for (let k = 0; k < l.path.length; k++) {
      const q = l.path[k];
      if (!Number.isFinite(q.x + q.y + q.z)) fail('NaN in layout');
      minY = Math.min(minY, q.y + p.startAltitude);
      maxY = Math.max(maxY, q.y + p.startAltitude);
      if (k > 0) length += q.distanceTo(l.path[k - 1]);
    }
  }
  if (minY < MIN_TRACK_ALTITUDE - 0.5) fail(`track goes down to ${minY.toFixed(0)} m`);
  const titles = obstacleTitles(p);
  for (const t of titles) usage.set(t, (usage.get(t) ?? 0) + 1);
  console.log(
    `${String(i).padStart(4)}  ${difficultyLabel(p.difficulty).padEnd(8)} d=${p.difficulty.toFixed(2)}  ` +
      `${Math.round(length)} m  alt ${Math.round(minY)}–${Math.round(maxY)}  ${p.name.padEnd(22)} ${titles.join(' > ')}`,
  );
}

const ms = performance.now() - t0;
console.log(`\n${count} levels in ${ms.toFixed(0)} ms (${(ms / count).toFixed(1)} ms/level), ${seen.size} unique signatures`);
console.log('obstacle usage:', [...usage.entries()].map(([k, v]) => `${k} ${v}`).join(', '));
const unused = OBSTACLES.filter((o) => !usage.has(o.title)).map((o) => o.type);
if (unused.length && count >= 30) errors.push(`never used: ${unused.join(', ')}`);
if (errors.length) {
  console.error('\nFAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK');
