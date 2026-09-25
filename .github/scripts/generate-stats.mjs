// Generates the GitHub stats SVG cards in assets/stats/ from the GitHub GraphQL API.
// Run by .github/workflows/update-stats.yml. Local test: MOCK=1 node .github/scripts/generate-stats.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'Moustafa1997';
const OUT = 'assets/stats';

const QUERY = `query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date } }
      }
    }
  }
}`;

async function fetchUser() {
  if (process.env.MOCK) return JSON.parse(readFileSync(process.env.MOCK, 'utf8'));
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

// Readable on both GitHub light and dark themes.
const STYLE = `<style>
  .title { font: 600 18px 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; fill: #339933; }
  .label { font: 400 14px 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; fill: #57606a; }
  .value { font: 700 14px 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; fill: #24292f; }
  .big { font: 700 28px 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; fill: #24292f; }
  .small { font: 400 12px 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; fill: #57606a; }
  .card { fill: #ffffff; stroke: #d0d7de; }
  .grid { stroke: #d0d7de; }
  @media (prefers-color-scheme: dark) {
    .label, .small { fill: #8b949e; }
    .value, .big { fill: #e6edf3; }
    .card { fill: #0d1117; stroke: #30363d; }
    .grid { stroke: #30363d; }
  }
</style>`;

const card = (w, h, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
${STYLE}
<rect class="card" x="0.5" y="0.5" rx="8" width="${w - 1}" height="${h - 1}"/>
<text class="title" x="24" y="36">${esc(title)}</text>
${body}
</svg>
`;

function statsCard(u) {
  const c = u.contributionsCollection;
  const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
  const rows = [
    ['Total stars', stars],
    ['Commits (last year)', c.totalCommitContributions + c.restrictedContributionsCount],
    ['Pull requests (last year)', c.totalPullRequestContributions],
    ['Issues (last year)', c.totalIssueContributions],
    ['Public repositories', u.repositories.totalCount],
    ['Followers', u.followers.totalCount],
  ];
  const body = rows
    .map(([k, v], i) => {
      const y = 68 + i * 24;
      return `<g><text class="label" x="24" y="${y}">${esc(k)}</text><text class="value" x="376" y="${y}" text-anchor="end">${fmt(v)}</text></g>`;
    })
    .join('\n');
  return card(400, 205, `${USER}'s GitHub Stats`, body);
}

function languagesCard(u) {
  const totals = new Map();
  for (const r of u.repositories.nodes)
    for (const e of r.languages.edges) {
      const t = totals.get(e.node.name) || { size: 0, color: e.node.color || '#8b949e' };
      t.size += e.size;
      totals.set(e.node.name, t);
    }
  const langs = [...totals].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const sum = langs.reduce((a, [, t]) => a + t.size, 0) || 1;
  let x = 24;
  const barW = 352;
  const bar = langs
    .map(([, t]) => {
      const w = (t.size / sum) * barW;
      const r = `<rect x="${x.toFixed(2)}" y="52" width="${w.toFixed(2)}" height="8" fill="${t.color}"/>`;
      x += w;
      return r;
    })
    .join('');
  const items = langs
    .map(([name, t], i) => {
      const cx = 24 + (i % 2) * 176;
      const cy = 88 + Math.floor(i / 2) * 26;
      return `<g><circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${t.color}"/><text class="label" x="${cx + 16}" y="${cy}">${esc(name)} <tspan class="small">${((t.size / sum) * 100).toFixed(1)}%</tspan></text></g>`;
    })
    .join('\n');
  return card(400, 205, 'Most Used Languages', `<clipPath id="bar"><rect x="24" y="52" width="${barW}" height="8" rx="4"/></clipPath><g clip-path="url(#bar)">${bar}</g>\n${items}`);
}

function days(u) {
  return u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
}

function streakCard(u) {
  const d = days(u);
  let longest = 0, run = 0;
  for (const day of d) {
    run = day.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let i = d.length - 1;
  if (i >= 0 && d[i].contributionCount === 0) i--; // today may not have contributions yet
  let current = 0;
  for (; i >= 0 && d[i].contributionCount > 0; i--) current++;
  const total = u.contributionsCollection.contributionCalendar.totalContributions;
  const cols = [
    [fmt(total), 'Contributions', 'last year'],
    [String(current), 'Current streak', current === 1 ? 'day' : 'days'],
    [String(longest), 'Longest streak', 'last year'],
  ];
  const body = cols
    .map(([v, k, s], j) => {
      const cx = 120 + j * 240;
      return `<g><text class="big" x="${cx}" y="98" text-anchor="middle">${esc(v)}</text><text class="value" x="${cx}" y="126" text-anchor="middle">${esc(k)}</text><text class="small" x="${cx}" y="146" text-anchor="middle">${esc(s)}</text></g>`;
    })
    .join('\n');
  const dividers = `<line class="grid" x1="240" y1="64" x2="240" y2="150"/><line class="grid" x1="480" y1="64" x2="480" y2="150"/>`;
  return card(720, 175, 'Contribution Streak', dividers + '\n' + body);
}

function activityCard(u) {
  const d = days(u).slice(-31);
  const W = 960, H = 280, L = 56, R = 24, T = 60, B = 44;
  const max = Math.max(4, ...d.map((x) => x.contributionCount));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const px = (i) => L + (i / Math.max(1, d.length - 1)) * (W - L - R);
  const py = (v) => T + (1 - v / top) * (H - T - B);
  const pts = d.map((x, i) => [px(i), py(x.contributionCount)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = `${line}L${px(d.length - 1).toFixed(1)} ${py(0)}L${L} ${py(0)}Z`;
  const grid = [0, 1, 2, 3, 4]
    .map((k) => {
      const y = py(k * step);
      return `<line class="grid" x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke-dasharray="3 4"/><text class="small" x="${L - 10}" y="${y + 4}" text-anchor="end">${k * step}</text>`;
    })
    .join('\n');
  const labels = d
    .map((x, i) => (i % 5 === 0 || i === d.length - 1 ? `<text class="small" x="${px(i)}" y="${H - 18}" text-anchor="middle">${x.date.slice(5).replace('-', '/')}</text>` : ''))
    .join('');
  const dots = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#339933"/>`).join('');
  const body = `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3178C6" stop-opacity=".45"/><stop offset="1" stop-color="#3178C6" stop-opacity="0"/></linearGradient></defs>
${grid}
<path d="${area}" fill="url(#a)"/>
<path d="${line}" fill="none" stroke="#3178C6" stroke-width="3" stroke-linejoin="round"/>
<g>${dots}</g>
${labels}`;
  return card(W, H, 'Contributions — last 31 days', body);
}

const user = await fetchUser();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats.svg`, statsCard(user));
writeFileSync(`${OUT}/languages.svg`, languagesCard(user));
writeFileSync(`${OUT}/streak.svg`, streakCard(user));
writeFileSync(`${OUT}/activity.svg`, activityCard(user));
console.log('Stats cards written to', OUT);
