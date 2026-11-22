/* global D, $, esc, pct, f1, f2, signed, sgnCls, md, ord, weekLabel, weekEnd, state, teamById, phoneQuery, chartWidth, rankLine, movement */
// Team pages: the Jr Storm tab and the next-opponent tab. Team stats are added
// up here from each game's box score so they follow the "Rankings as of" week.

const teamByAbbr = (abbr) => D.teams.find((t) => t.abbr === abbr);
const ourTeam = () => teamByAbbr(D.config.focusTeam);
const rec = (r) => `${r.w}-${r.l}-${r.otl}`;

// ---------- schedule ----------
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Games still to come, by the viewer's date, so postponed games don't linger.
const upcomingFrom = () => D.upcoming.filter((g) => g.date >= todayIso());
const upcomingFor = (id) => upcomingFrom().filter((g) => g.homeId === id || g.awayId === id);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso) => `${DOW[new Date(iso + 'T12:00:00').getDay()]} ${md(iso)}`;
const oppOf = (g, id) => (g.homeId === id ? g.awayId : g.homeId);
const shortTime = (t) => (t || '').replace(/\s+[A-Z]{2,4}$/, '');

// ---------- team stats ----------
function teamStats(id, i) {
  const blank = () => ({ w: 0, l: 0, otl: 0 });
  const s = { gp: 0, gf: 0, ga: 0, rgf: 0, rga: 0, sf: 0, sa: 0, ppg: 0, ppo: 0, ppga: 0, pko: 0, pim: 0, pimGames: 0, pf: [0, 0, 0], pa: [0, 0, 0], psf: [0, 0, 0], psa: [0, 0, 0],
    won: [0, 1, 2].map(() => ({ w: 0, l: 0, t: 0 })), after: [0, 1].map(() => ({ lead: blank(), tie: blank(), trail: blank() })),
    all: blank(), home: blank(), away: blank(), first: blank(), trail: blank(), oneGoal: blank(), games: [], scorers: {} };
  for (const g of D.games) {
    if (g.date > weekEnd(i) || (g.homeId !== id && g.awayId !== id)) continue;
    const me = g.homeId === id ? 'home' : 'away', op = me === 'home' ? 'away' : 'home';
    const gf = g.score[me], ga = g.score[op], b = g.box;
    const res = gf > ga ? 'w' : g.ot || g.so ? 'otl' : 'l';
    s.gp++; s.gf += gf; s.ga += ga;
    s.rgf += gf - (g.so && gf > ga ? 1 : 0); s.rga += ga - (g.so && ga > gf ? 1 : 0); // shootout winner isn't a real goal
    s.all[res]++; s[me][res]++;
    if (Math.abs(gf - ga) === 1) s.oneGoal[res]++;
    if (b.shots) { s.sf += b.shots[me]; s.sa += b.shots[op]; }
    if (b.pp) { if (b.pp[me]) { s.ppg += b.pp[me][0]; s.ppo += b.pp[me][1]; } if (b.pp[op]) { s.ppga += b.pp[op][0]; s.pko += b.pp[op][1]; } }
    if (b.pim && b.pim[me]) { s.pim += b.pim[me][0]; s.pimGames++; }
    if (b.goals) for (let p = 0, diff = 0; p < 3; p++) {
      const f = b.goals[me][p] || 0, a = b.goals[op][p] || 0;
      s.pf[p] += f; s.pa[p] += a;
      s.won[p][f > a ? 'w' : f < a ? 'l' : 't']++;
      diff += f - a;
      if (p < 2) s.after[p][diff > 0 ? 'lead' : diff < 0 ? 'trail' : 'tie'][res]++;
    }
    if (b.shotsBy) for (let p = 0; p < 3; p++) { s.psf[p] += b.shotsBy[me][p] || 0; s.psa[p] += b.shotsBy[op][p] || 0; }
    const firstGoal = b.scoring.find((x) => x.side);
    if (firstGoal) s[firstGoal.side === me ? 'first' : 'trail'][res]++;
    for (const x of b.points) if (x.teamId === id) {
      const p = (s.scorers[x.number + x.name] ||= { name: x.name, number: x.number, g: 0, a: 0, ppg: 0 });
      p.g += x.g; p.a += x.a;
    }
    for (const x of b.scoring) if (x.side === me && x.strength === 'power play') {
      const p = Object.values(s.scorers).find((y) => y.name === x.scorer);
      if (p) p.ppg++;
    }
    s.games.push({ date: g.date, home: me === 'home', opp: oppOf(g, id), gf, ga, res, tag: g.so ? ' SO' : g.ot ? ' OT' : '', sf: b.shots && b.shots[me], sa: b.shots && b.shots[op], pp: b.pp && b.pp[me], firstGoal: firstGoal ? firstGoal.side === me : null });
  }
  return s;
}

// One row per team with every number the team pages compare, for one week.
const metricCache = {};
function leagueMetrics(i) {
  return (metricCache[i] ||= D.snapshots[i].teams.map((t) => {
    const s = teamStats(t.id, i), per = (x) => x / s.gp;
    return {
      id: t.id, s, snap: t,
      winPct: t.ptsPct, net: t.net, krach: t.krach, sos: t.sos,
      gfpg: per(s.gf), gapg: per(s.ga), sfpg: per(s.sf), sapg: per(s.sa),
      shotShare: s.sf / (s.sf + s.sa || 1), shPct: s.rgf / (s.sf || 1), svPct: 1 - s.rga / (s.sa || 1),
      ppPct: s.ppo ? s.ppg / s.ppo : null, pkPct: s.pko ? 1 - s.ppga / s.pko : null, pimpg: s.pimGames ? s.pim / s.pimGames : null,
      p1: per(s.pf[0] - s.pa[0]), p2: per(s.pf[1] - s.pa[1]), p3: per(s.pf[2] - s.pa[2]),
      ...Object.assign({}, ...[0, 1, 2].map((p) => ({
        ['gf' + p]: per(s.pf[p]), ['ga' + p]: per(s.pa[p]), ['gd' + p]: per(s.pf[p] - s.pa[p]), ['sf' + p]: per(s.psf[p]), ['sa' + p]: per(s.psa[p]),
        ['ss' + p]: s.psf[p] / (s.psf[p] + s.psa[p] || 1), ['sh' + p]: s.pf[p] / (s.psf[p] || 1), ['sv' + p]: 1 - s.pa[p] / (s.psa[p] || 1),
      }))),
    };
  }));
}
const pc1 = (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%');
const s2 = (v) => signed(v, 2);
// key, label, format, higher is better, what it means
// Wrapped because this file loads before app.js defines the formatters.
const fPct = (v) => pct(v), fOne = (v) => f1(v), fTwo = (v) => f2(v);
const METRICS = [
  ['winPct', 'Win %', fPct, true, 'OT and shootout losses count as half a win'],
  ['gfpg', 'Goals for / game', fTwo, true, ''],
  ['gapg', 'Goals against / game', fTwo, false, ''],
  ['net', 'Adj goal diff', s2, true, 'Goals per game better than an average team, adjusted for opponents'],
  ['sfpg', 'Shots for / game', fOne, true, ''],
  ['sapg', 'Shots against / game', fOne, false, ''],
  ['shotShare', 'Share of shots', pc1, true, 'Of all shots in their games, how many were theirs'],
  ['shPct', 'Shooting %', pc1, true, 'Goals per shot on goal'],
  ['svPct', 'Team save %', fPct, true, 'All goalies, including empty-net goals'],
  ['ppPct', 'Power play %', pc1, true, ''],
  ['pkPct', 'Penalty kill %', pc1, true, ''],
  ['pimpg', 'Penalty minutes / game', fOne, false, ''],
  ['p1', '1st period goal diff', s2, true, 'Per game'],
  ['p2', '2nd period goal diff', s2, true, 'Per game'],
  ['p3', '3rd period goal diff', s2, true, 'Per game'],
  ['sos', 'Schedule strength', s2, true, 'Average Adj goal diff of opponents faced: higher is a tougher schedule'],
];
const metric = (key) => METRICS.find((m) => m[0] === key);
function teamRank(rows, id, key, hi) {
  const me = rows.find((r) => r.id === id);
  if (!me || me[key] == null) return null;
  const vals = rows.map((r) => r[key]).filter((v) => v != null);
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  const rank = 1 + vals.filter((v) => !eq(v, me[key]) && (hi ? v > me[key] : v < me[key])).length;
  return { rank, of: vals.length, tied: vals.filter((v) => eq(v, me[key])).length > 1, text: (vals.filter((v) => eq(v, me[key])).length > 1 ? 'T-' : '') + ord(rank) };
}
const rankText = (r) => (r ? `${r.text} of ${r.of}` : '–');

// ---------- shared pieces ----------
const tilesHtml = (tiles) => `<div class="tiles">${tiles.map(([l, v, r]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="r">${r}</div></div>`).join('')}</div>`;

// Each stat as a strip of 15 dots (worst on the left, best on the right).
// marks: [{ id, cls }] teams to highlight, in order.
function leagueStrips(rows, marks, keys) {
  const abbr = (id) => esc(teamById[id].abbr);
  return `<div class="strips">
    <div class="strip-key">${marks.map((m) => `<span><i class="dot ${m.cls}"></i>${abbr(m.id)}</span>`).join('')}<span><i class="dot"></i>Other teams</span><span><i class="avg"></i>League average</span><span class="dirs">worse ← → better</span></div>
    ${keys.map((k) => {
      const [key, label, fmt, hi, note] = metric(k);
      const vals = rows.map((r) => r[key]).filter((v) => v != null);
      const lo = Math.min(...vals), up = Math.max(...vals), avg = vals.reduce((a, v) => a + v, 0) / vals.length;
      const x = (v) => { const f = up === lo ? 0.5 : (v - lo) / (up - lo); return (100 * (hi ? f : 1 - f)).toFixed(1); };
      const side = (m) => { const r = rows.find((y) => y.id === m.id); return `<span class="val ${m.cls}"><b>${fmt(r[key])}</b> <em>${(teamRank(rows, m.id, key, hi) || { text: '–' }).text}</em></span>`; };
      const isMark = (r) => marks.find((m) => m.id === r.id);
      const dots = rows.filter((r) => r[key] != null).sort((a, b) => !!isMark(a) - !!isMark(b));
      return `<div class="strip"><div class="strip-top ${marks.length > 1 ? 'two' : ''}">${marks.length > 1 ? side(marks[0]) : ''}<span class="lab" ${note ? `data-tip="${esc(note)}"` : ''}>${label}</span>${side(marks[marks.length - 1])}</div>
        <div class="track"><i class="avg" style="left:${x(avg)}%" data-tip="League average: ${fmt(avg)}"></i>${dots.map((r) => `<i class="dot ${(isMark(r) || { cls: '' }).cls}" style="left:${x(r[key])}%" data-tip="<b>${esc(teamById[r.id].name)}</b> ${fmt(r[key])} (${teamRank(rows, r.id, key, hi).text})"></i>`).join('')}</div></div>`;
    }).join('')}</div>`;
}

// Goals for and against by period, per game.
function periodChart(s) {
  const W = chartWidth(), H = 190, L = 30, R = 8, T = 18, B = 24;
  const gf = s.pf.map((v) => v / s.gp), ga = s.pa.map((v) => v / s.gp);
  const max = Math.max(1, Math.ceil(Math.max(...gf, ...ga)));
  const y = (v) => T + (1 - v / max) * (H - T - B), band = (W - L - R) / 3, bw = Math.min(44, band * 0.3);
  const ticks = []; for (let v = 0; v <= max; v += max > 4 ? 2 : 1) ticks.push(v);
  const bar = (cx, v, fill, name, p) => {
    const h = y(0) - y(v), r = Math.min(4, h), x0 = cx - bw / 2;
    return `<path d="M${x0},${y(0)}V${y(v) + r}Q${x0},${y(v)} ${x0 + r},${y(v)}H${x0 + bw - r}Q${x0 + bw},${y(v)} ${x0 + bw},${y(v) + r}V${y(0)}Z" fill="${fill}" data-tip="${name}, ${['1st', '2nd', '3rd'][p]} period: <b>${f2(v)}</b> a game"/>
      <text x="${cx}" y="${y(v) - 5}" text-anchor="middle" style="fill:var(--text)">${f1(v)}</text>`;
  };
  return `<div class="legend"><span><i style="background:var(--accent)"></i>Goals for</span><span><i style="background:var(--neg)"></i>Goals against</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals for and against per game by period">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    ${[0, 1, 2].map((p) => { const c = L + band * (p + 0.5); return bar(c - bw / 2 - 1, gf[p], 'var(--accent)', 'Goals for', p) + bar(c + bw / 2 + 1, ga[p], 'var(--neg)', 'Goals against', p) + `<text x="${c}" y="${H - 6}" text-anchor="middle">${['1st', '2nd', '3rd'][p]}</text>`; }).join('')}
  </svg>`;
}

// Period by period: each stat with its league rank, best period marked, plus
// how games turn out from each intermission.
const PERIOD_ROWS = [
  ['gf', 'Goals for', f2x, true], ['ga', 'Goals against', f2x, false], ['gd', 'Goal diff', (v) => s2(v), true],
  ['sf', 'Shots for', f1x, true], ['sa', 'Shots against', f1x, false], ['ss', 'Share of shots', (v) => pc1(v), true],
  ['sh', 'Shooting %', (v) => pc1(v), true], ['sv', 'Save %', (v) => pct(v), true],
];
function f2x(v) { return f2(v); }
function f1x(v) { return f1(v); }
function periodSection(rows, id) {
  const me = rows.find((r) => r.id === id), s = me.s, P = ['1st', '2nd', '3rd'];
  const order = [0, 1, 2].sort((a, b) => me['gd' + b] - me['gd' + a]);
  const cell = ([key, , fmt, hi], p) => {
    const vals = [0, 1, 2].map((q) => me[key + q]), best = hi ? Math.max(...vals) : Math.min(...vals);
    const isBest = Math.abs(vals[p] - best) < 1e-9 && vals.some((v) => Math.abs(v - best) > 1e-9);
    return `<td class="${isBest ? 'best' : ''} ${key === 'gd' ? sgnCls(vals[p]) : ''}"><b>${fmt(vals[p])}</b><em>${teamRank(rows, id, key + p, hi).text}</em></td>`;
  };
  const wl = (r) => `${r.w}-${r.l}-${r.t}`;
  const games = (r) => r.w + r.l + r.otl;
  const after = (p) => ['lead', 'tie', 'trail'].map((k) => `<td><b>${games(s.after[p][k]) ? rec(s.after[p][k]) : '–'}</b></td>`).join('');
  return `<h3>Period by period</h3>
    <div class="period-cards">${[0, 1, 2].map((p) => `<div class="tile ${p === order[0] ? 'hi' : p === order[2] ? 'lo' : ''}"><div class="l">${P[p]} period${p === order[0] ? ' · best' : p === order[2] ? ' · worst' : ''}</div>
      <div class="v">${s.pf[p]}–${s.pa[p]}</div><div class="r">${s2(me['gd' + p])} a game<br>${teamRank(rows, id, 'gd' + p, true).text} of ${rows.length}</div></div>`).join('')}</div>
    <p class="note">Season goals for–against in each period. Best and worst are by goal difference.</p>
    <div class="charts">
      ${card('Every stat by period', 'Per game, with league rank. Shaded is their best period for that stat.', `<table class="mini periods"><thead><tr><th class="l"></th>${P.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>
        ${PERIOD_ROWS.map((r) => `<tr><td class="l">${r[1]}</td>${[0, 1, 2].map((p) => cell(r, p)).join('')}</tr>`).join('')}
        <tr><td class="l">Periods W-L-T</td>${[0, 1, 2].map((p) => `<td><b>${wl(s.won[p])}</b></td>`).join('')}</tr></tbody></table>`)}
      <div class="stack">${card('Goals by period', 'Per game.', periodChart(s))}
      ${card('Record from each intermission', 'Final record (W-L-OTL) when leading, tied, or trailing.', `<table class="mini periods"><thead><tr><th class="l"></th><th>Leading</th><th>Tied</th><th>Trailing</th></tr></thead><tbody>
        <tr><td class="l">After the 1st</td>${after(0)}</tr><tr><td class="l">After the 2nd</td>${after(1)}</tr></tbody></table>`)}</div>
    </div>`;
}

function scorersTable(s, n) {
  const list = Object.values(s.scorers).filter((p) => p.g + p.a > 0).sort((a, b) => b.g + b.a - (a.g + a.a) || b.g - a.g).slice(0, n);
  if (!list.length) return '<p class="empty">No points recorded yet.</p>';
  return `<table class="mini"><thead><tr><th class="l">Player</th><th>G</th><th>A</th><th>Pts</th><th data-tip="Power play goals">PPG</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td class="l"><span class="team">#${esc(p.number)}</span> ${esc(p.name)}</td><td>${p.g}</td><td>${p.a}</td><td><b>${p.g + p.a}</b></td><td>${p.ppg}</td></tr>`).join('')}</tbody></table>`;
}

function resultsTable(list, rankOf) {
  if (!list.length) return '<p class="empty">No games yet.</p>';
  return `<table class="mini"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="l">Result</th><th>Shots</th><th data-tip="Power play goals / chances">PP</th></tr></thead><tbody>
    ${list.slice().reverse().map((g) => `<tr><td class="l">${md(g.date)}</td><td class="l">${g.home ? 'vs' : '@'} ${esc(teamById[g.opp].abbr)} <span class="team">#${rankOf(g.opp)}</span></td>
      <td class="l"><b class="${g.res === 'w' ? 'pos' : 'neg'}">${g.res === 'w' ? 'W' : g.res === 'otl' ? 'OTL' : 'L'}</b> ${g.gf}-${g.ga}${g.tag}</td><td>${g.sf ?? '–'}-${g.sa ?? '–'}</td><td>${g.pp ? g.pp.join('/') : '–'}</td></tr>`).join('')}</tbody></table>`;
}
const card = (title, sub, body) => `<div class="chart"><h4>${title}</h4>${sub ? `<p>${sub}</p>` : ''}${body}</div>`;
const scheduleCards = (games, id) => `<div class="scores">${games.map((g) => {
  const o = teamById[oppOf(g, id)];
  return `<div class="score"><div class="d">${dayLabel(g.date)}${g.time ? ' · ' + esc(shortTime(g.time)) : ''}</div><div>${g.homeId === id ? 'vs' : '@'} <b>${esc(o ? o.name : '')}</b> ${o ? `<span class="team">#${o.rank}, ${rec(o)}</span>` : ''}</div></div>`;
}).join('')}</div>`;
const listOr = (a) => (a.length > 1 ? a.slice(0, -1).join('; ') + '; and ' + a[a.length - 1] : a[0]);

// Best and worst league ranks, in words. Overall results and penalties are left out
// because the pages cover them on their own lines.
function strengths(rows, id) {
  const skip = ['winPct', 'net', 'sos', 'pimpg'];
  const all = METRICS.filter((m) => !skip.includes(m[0])).map(([key, label, fmt, hi]) => ({ label, r: teamRank(rows, id, key, hi), v: fmt(rows.find((x) => x.id === id)[key]) })).filter((x) => x.r);
  const say = (x) => `${x.label.toLowerCase()} (${x.v}, ${x.r.text})`;
  const third = Math.ceil(rows.length / 3);
  return {
    good: all.filter((x) => x.r.rank <= third).sort((a, b) => a.r.rank - b.r.rank).slice(0, 3).map(say),
    bad: all.filter((x) => x.r.rank > rows.length - third).sort((a, b) => b.r.rank - a.r.rank).slice(0, 3).map(say),
  };
}
function formLine(s) {
  const last = s.games.slice(-5);
  const r = { w: 0, l: 0, otl: 0 };
  last.forEach((g) => r[g.res]++);
  return `${rec(r)} in the last ${last.length}`;
}
function periodLine(s) {
  const d = s.pf.map((v, p) => [(v - s.pa[p]) / s.gp, ['1st', '2nd', '3rd'][p]]).sort((a, b) => b[0] - a[0]);
  return `best period is the ${d[0][1]} (${s2(d[0][0])} goals a game), worst is the ${d[2][1]} (${s2(d[2][0])})`;
}

// ---------- Jr Storm tab ----------
function renderStorm() {
  const i = state.week, team = ourTeam(), el = $('#tab-storm');
  const rows = leagueMetrics(i), me = team && rows.find((r) => r.id === team.id);
  if (!me) { el.innerHTML = '<p class="empty">No games yet.</p>'; return; }
  const s = me.s, t = me.snap, prev = D.snapshots[i - 1] && D.snapshots[i - 1].teams.find((x) => x.id === team.id);
  const rk = (k) => rankText(teamRank(rows, team.id, k, metric(k)[3]));
  const tile = (k) => [metric(k)[1], metric(k)[2](me[k]), rk(k)];
  const { good, bad } = strengths(rows, team.id);
  const rankOf = (id) => (D.snapshots[i].teams.find((x) => x.id === id) || teamById[id]).rank;
  const next = upcomingFor(team.id).slice(0, 4);
  el.innerHTML = `
    <div class="hero">
      ${D.config.teamLogo ? `<img class="crest" src="${esc(D.config.teamLogo)}" alt="">` : ''}
      <div><h2>${esc(D.config.focusTeamName || team.name)}</h2>
        <div class="meta">${rec(t)} · through ${weekLabel(D.weeks[i])}</div>
        <div class="bigrank">#${t.rank}<small>of ${rows.length} teams ${movement(t.rank, prev && prev.rank)}</small></div></div>
    </div>
    ${tilesHtml([tile('gfpg'), tile('gapg'), tile('sfpg'), tile('sapg'), tile('shPct'), tile('svPct'), tile('ppPct'), tile('pkPct')])}
    <div class="story">
      <p><b>Form:</b> ${formLine(s)}. Home ${rec(s.home)}, road ${rec(s.away)}, one-goal games ${rec(s.oneGoal)}.</p>
      ${good.length ? `<p><b>Top third of the league:</b> ${listOr(good)}.</p>` : ''}
      ${bad.length ? `<p><b>Bottom third:</b> ${listOr(bad)}.</p>` : ''}
      <p><b>Scoring first:</b> ${rec(s.first)} when they score first, ${rec(s.trail)} when they don't.</p>
      <p><b>Schedule:</b> ${teamRank(rows, team.id, 'sos', true).text} toughest of ${rows.length} so far. Opponents have won ${pct(t.oppPtsPct)} of their other games.</p>
    </div>
    ${periodSection(rows, team.id)}
    <h3>Where the Storm stand vs the league</h3>
    ${leagueStrips(rows, [{ id: team.id, cls: 'us' }], METRICS.map((m) => m[0]))}
    <div class="charts">
      ${card('Power rank by week', 'Up is better. Tap or hover a point for details.', rankLine(team.history.slice(0, i + 1), D.teams.length))}
      ${card('Top scorers', '', scorersTable(s, 10))}
      ${card('Results', 'Newest first. Shots are for-against.', resultsTable(s.games, rankOf))}
    </div>
    ${next.length ? `<h3>Coming up</h3>${scheduleCards(next, team.id)}` : ''}`;
}

// ---------- next opponent tab ----------
// Opens on whoever the Storm play next; the menu can switch to any team.
function renderOpponent() {
  const el = $('#tab-opp'), us = ourTeam();
  if (!us) { el.innerHTML = '<p class="empty">No games yet.</p>'; return; }
  const i = D.weeks.length - 1; // scouting always uses the latest numbers
  const ours = upcomingFor(us.id);
  const meetings = (id) => ours.filter((g) => oppOf(g, us.id) === id);
  const order = [...new Set(ours.map((g) => oppOf(g, us.id)))].filter((id) => teamById[id]);
  const rest = D.teams.filter((t) => t.id !== us.id && !order.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name)).map((t) => t.id);
  const id = state.opp && state.opp !== us.id && teamById[state.opp] ? state.opp : order[0] || rest[0];
  const opt = (x) => `<option value="${x}" ${x === id ? 'selected' : ''}>${esc(teamById[x].name)}${meetings(x).length ? ` · ${md(meetings(x)[0].date)}` : ''}</option>`;
  const picker = `<label class="opp-pick">Opponent <select id="oppsel">
    ${order.length ? `<optgroup label="Next up">${opt(order[0])}</optgroup>` : ''}
    ${order.length > 1 ? `<optgroup label="Later on the schedule">${order.slice(1).map(opt).join('')}</optgroup>` : ''}
    ${rest.length ? `<optgroup label="No games left against">${rest.map(opt).join('')}</optgroup>` : ''}</select></label>`;

  const rows = leagueMetrics(i), me = rows.find((r) => r.id === id), we = rows.find((r) => r.id === us.id);
  const opp = teamById[id];
  if (!me || !we) { el.innerHTML = picker + '<p class="empty">No games yet.</p>'; bindOpp(); return; }
  const s = me.s, t = me.snap, games = meetings(id), lg = D.league;
  const { good, bad } = strengths(rows, id);
  const rk = (k) => rankText(teamRank(rows, id, k, metric(k)[3]));
  const rankOf = (x) => teamById[x].rank;
  const h2h = we.s.games.filter((g) => g.opp === id);
  const list = Object.values(s.scorers).sort((a, b) => b.g + b.a - (a.g + a.a) || b.g - a.g), top = list[0];
  const goalies = D.goalies.filter((g) => g.teamId === id && g.gp > 0).sort((a, b) => b.min - a.min);
  // Projection from the same ratings that drive the power rankings.
  const goals = (a, b) => (a.offRating * b.defRating) / lg.goalsPerGame;
  const shots = (a, b) => (a.shotsForRating * b.shotsAgainstRating) / lg.shotsPerGame;
  const when = games.map((g) => `<b>${dayLabel(g.date)}</b>${g.time ? ', ' + esc(shortTime(g.time)) : ''} ${g.homeId === us.id ? 'at home' : 'on the road'}${g.venue ? ` <span class="venue">(${esc(g.venue)})</span>` : ''}`);
  el.innerHTML = `
    ${picker}
    <div class="hero">
      <div class="bigrank side">#${t.rank}<small>of ${rows.length}</small></div>
      <div><h2>${esc(opp.name)}</h2>
        <div class="meta">${rec(t)} · power score ${f1(t.score)} · ${formLine(s)}</div>
        <div class="meta">${when.length ? when.slice(0, 2).join('<br>') : 'No games left against the Storm this season'}${when.length > 2 ? `<br>and ${when.length - 2} more later` : ''}</div></div>
    </div>
    <div class="story">
      <p><b>Strongest at:</b> ${good.length ? listOr(good) : 'nothing in the top third of the league'}.</p>
      <p><b>Weakest at:</b> ${bad.length ? listOr(bad) : 'nothing in the bottom third of the league'}.</p>
      ${top ? `<p><b>Player to watch:</b> #${esc(top.number)} ${esc(top.name)}, ${top.g} goals and ${top.a} assists. In on ${Math.round((100 * (top.g + top.a)) / (s.rgf || 1))}% of their goals.</p>` : ''}
      <p><b>Scoring first:</b> ${rec(s.first)} when they do, ${rec(s.trail)} when they don't. By period, their ${periodLine(s)}.</p>
      <p><b>Special teams:</b> their power play is ${pc1(me.ppPct)} (${rk('ppPct')}) against our ${pc1(we.pkPct)} penalty kill. Our power play is ${pc1(we.ppPct)} against their ${pc1(me.pkPct)} kill (${rk('pkPct')}). They take ${f1(me.pimpg)} penalty minutes a game (league average ${f1(rows.reduce((x, r) => x + (r.pimpg || 0), 0) / rows.length)}).</p>
      <p><b>Home / road:</b> ${rec(s.home)} at home, ${rec(s.away)} on the road.</p>
    </div>
    ${tilesHtml([
      ['Projected goals', `${f1(goals(we.snap, t))} – ${f1(goals(t, we.snap))}`, `${esc(us.abbr)} – ${esc(opp.abbr)}, a rough estimate`],
      ['Projected shots', `${Math.round(shots(we.snap, t))} – ${Math.round(shots(t, we.snap))}`, `${esc(us.abbr)} – ${esc(opp.abbr)}`],
      ['Their win %', pct(me.winPct), rk('winPct')],
      ['Their schedule', s2(me.sos), `${teamRank(rows, id, 'sos', true).text} toughest of ${rows.length}`],
    ])}
    <h3>Storm vs ${esc(opp.name)}</h3>
    ${leagueStrips(rows, [{ id: us.id, cls: 'us' }, { id, cls: 'them' }], METRICS.map((m) => m[0]))}
    <div class="charts">
      ${card('Their goalies', 'Share is the portion of team minutes played.', goalies.length ? `<table class="mini"><thead><tr><th class="l">Goalie</th><th data-tip="Goalie power rank">Rank</th><th>Share</th><th>SV%</th><th>Adj</th><th data-tip="Goals saved above expected, per game">GSAx/GP</th></tr></thead><tbody>${goalies.map((g) => `<tr><td class="l">${esc(g.name)}</td><td>${g.rank ? '#' + g.rank : '–'}</td><td>${Math.round(g.share * 100)}%</td><td>${pct(g.svPct)}</td><td>${pct(g.adjSvPct)}</td><td class="${sgnCls(g.gsaxPerGame)}">${s2(g.gsaxPerGame)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No goalie stats yet.</p>')}
      ${card('Their top scorers', '', scorersTable(s, 8))}
      ${card('Their goals by period', 'Per game.', periodChart(s))}
      ${h2h.length ? card('Storm vs them this season', 'Shots are Storm first.', resultsTable(h2h, rankOf)) : ''}
      ${card('Their results', 'Newest first. Shots are for-against.', resultsTable(s.games, rankOf))}
    </div>`;
  bindOpp();
}
function bindOpp() {
  $('#oppsel').onchange = (e) => { state.opp = e.target.value; renderOpponent(); };
}
