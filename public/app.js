/* global DATA */
const D = window.DATA;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- formatting ----------
const pct = (v) => (v == null ? '–' : v.toFixed(3).replace(/^0/, ''));
const f1 = (v) => (v == null ? '–' : v.toFixed(1));
const f2 = (v) => (v == null ? '–' : v.toFixed(2));
const signed = (v, d = 1) => { if (v == null) return '–'; const t = Math.abs(v).toFixed(d); return +t === 0 ? (0).toFixed(d) : (v > 0 ? '+' : '−') + t; };
const sgnCls = (v) => (v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}`; };
function weekLabel(w) {
  if (!w) return '';
  const [, m1, d1] = w.from.split('-').map(Number), [, m2, d2] = w.to.split('-').map(Number);
  if (w.from === w.to) return md(w.from);
  return m1 === m2 ? `${MON[m1 - 1]} ${d1}–${d2}` : `${md(w.from)} – ${md(w.to)}`;
}
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

const goalieByKey = Object.fromEntries(D.goalies.map((g) => [g.key, g]));
const teamById = Object.fromEntries(D.teams.map((t) => [t.id, t]));
const focus = goalieByKey[D.focusKey];
const firstName = D.config.focusGoalie.split(' ')[0];

// ---------- state ----------
const state = { week: D.weeks.length - 1, tab: 'goalies', open: new Set(), sortG: { k: 'rank', dir: 1 }, sortT: { k: 'rank', dir: 1 } };
try { const t = localStorage.getItem('crease-tab'); if (t) state.tab = t; } catch (e) { /* storage unavailable */ }

function movement(curRank, prevRank) {
  if (curRank == null) return '<span class="mv flat"></span>';
  if (prevRank == null) return '<span class="mv new">NEW</span>';
  const d = prevRank - curRank;
  if (d > 0) return `<span class="mv up" title="Up ${d} from last week">▲${d}</span>`;
  if (d < 0) return `<span class="mv down" title="Down ${-d} from last week">▼${-d}</span>`;
  return '<span class="mv flat" title="No change">–</span>';
}

// Goalie appearances up to and including the selected week.
const weekEnd = (i) => D.weeks[i].to;
const appsFor = (key, i) => D.apps.filter((a) => a.key === key && a.date <= weekEnd(i)).sort((a, b) => a.date.localeCompare(b.date));

// ---------- tooltip ----------
const tip = $('#tip');
function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
function moveTip(e) {
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px'; tip.style.top = e.clientY + 14 + 'px';
}
function hideTip() { tip.hidden = true; }
document.addEventListener('mousemove', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(e, t.dataset.tip); else if (!tip.hidden) hideTip(); });

// ---------- header + spotlight ----------
function renderHeader() {
  $('#season').textContent = D.season;
  const sel = $('#week');
  sel.innerHTML = D.weeks.map((w, i) => `<option value="${i}">Week ${i + 1} · ${weekLabel(w)}</option>`).join('');
  sel.value = state.week;
  sel.onchange = () => { state.week = +sel.value; state.open.clear(); render(); };
  if (focus) $('#focusTab').textContent = firstName;
  $('#foot').innerHTML = `Data from the MWHSL site (mwhshl.sportngin.com), scraped ${new Date(D.scrapedAt).toLocaleString()}. ${D.league.games} league games so far. Run <code>npm run update</code> after each weekend.`;
}

function rankAmong(key, field, snap, higherIsBetter = true) {
  const list = snap.goalies.filter((g) => g[field] != null).sort((a, b) => (higherIsBetter ? b[field] - a[field] : a[field] - b[field]));
  const i = list.findIndex((g) => g.key === key);
  return i < 0 ? null : { rank: i + 1, of: list.length };
}

function renderSpotlight() {
  const el = $('#spotlight');
  if (!focus) { el.hidden = true; return; }
  const snap = D.snapshots[state.week], prev = D.snapshots[state.week - 1];
  const s = snap.goalies.find((g) => g.key === focus.key);
  const p = prev && prev.goalies.find((g) => g.key === focus.key);
  const shotsR = rankAmong(focus.key, 'shotsPerGame', snap);
  const r = (x) => (x ? `${ord(x.rank)} of ${x.of}` : '');
  el.innerHTML = `
    <div class="who">${D.config.focusPhoto ? `<img src="${esc(D.config.focusPhoto)}" alt="">` : ''}<div><b>${esc(D.config.focusGoalie)}</b><span>${esc(focus.teamName)} · #${s ? s.rank : '–'} of ${snap.goalies.length} ranked goalies</span></div></div>
    <div class="kpi"><span class="l">Power rank</span><span class="v">${s ? '#' + s.rank : '–'}</span><span class="r">${movement(s && s.rank, p && p.rank)} ${p ? 'vs last week' : ''}</span></div>
    <div class="kpi"><span class="l">Save %</span><span class="v">${pct(s && s.svPct)}</span><span class="r">${r(rankAmong(focus.key, 'svPct', snap))}</span></div>
    <div class="kpi"><span class="l">Adj save %</span><span class="v">${pct(s && s.adjSvPct)}</span><span class="r">${r(rankAmong(focus.key, 'adjSvPct', snap))}</span></div>
    <div class="kpi"><span class="l">Saved above exp.</span><span class="v ${sgnCls(s && s.gsax)}">${signed(s && s.gsax)}</span><span class="r">${r(rankAmong(focus.key, 'gsax', snap))}</span></div>
    <div class="kpi"><span class="l">Shots faced / game</span><span class="v">${f1(s && s.shotsPerGame)}</span><span class="r">${r(shotsR)}</span></div>`;
  el.onclick = () => setTab('focus');
}

// ---------- goalie rankings ----------
const gCols = [
  ['rank', 'Rk', 'Power rank'], ['mv', '', 'Change since previous week'], ['name', 'Goalie', ''], ['team', 'Team', ''],
  ['gp', 'GP', 'Games played'], ['rec', 'W-L-OTL', 'Decisions'], ['svPct', 'SV%', 'Raw save percentage'],
  ['adjSvPct', 'Adj SV%', 'Save % if every opponent finished its shots like an average team'],
  ['gsax', 'GSAx', 'Goals saved above expected: goals an average goalie would allow on these shots from these opponents, minus actual goals allowed'],
  ['gaa', 'GAA', 'Goals against per 51 minutes'], ['workloadGaa', 'Wkld GAA', 'GAA if the goalie faced a league-average number of shots. Takes the defense in front of the goalie out of GAA'], ['shotsPerGame', 'Shots/GP', 'Shots faced per 51 minutes'],
  ['oppStrength', 'Opp Str', 'Strength of the teams faced: half their scoring, half their team power score (including quality of wins). 50 = average opponent'],
  ['score', 'Power score', '50 = average ranked goalie; 10 points = one standard deviation'],
];
function goalieRows(i) {
  const prev = D.snapshots[i - 1];
  return D.snapshots[i].goalies.map((s) => {
    const g = goalieByKey[s.key];
    const p = prev && prev.goalies.find((x) => x.key === s.key);
    return { ...s, name: g.name, team: g.teamAbbr, teamName: g.teamName, prevRank: p ? p.rank : null, rec: `${s.w}-${s.l}-${s.otl}` };
  });
}
function sortRows(rows, sort, lowerBetter = []) {
  const { k, dir } = sort;
  return rows.slice().sort((a, b) => {
    const va = a[k], vb = b[k];
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * ((va ?? -1e9) - (vb ?? -1e9));
  });
}
function gameLog(apps) {
  if (!apps.length) return '<p class="note">No games yet.</p>';
  return `<table class="sub-tbl"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th>Opp rank</th><th class="l">Result</th><th>Min</th><th>Shots</th><th>Saves</th><th>GA</th><th>SV%</th><th>xGA</th><th>GSAx</th></tr></thead><tbody>
    ${apps.map((a) => `<tr><td class="l">${md(a.date)}</td><td class="l">${a.home ? 'vs' : '@'} ${esc(a.oppAbbr)}</td><td>${a.oppRank ? '#' + a.oppRank : '–'}</td>
      <td class="l">${a.decision ? `<b>${a.decision}</b> ` : '<span class="team">relief</span> '}${a.score}</td><td>${Math.round(a.min)}</td><td>${a.shots}</td><td>${a.saves}</td><td>${a.ga}</td>
      <td>${pct(a.svPct)}</td><td>${f1(a.xga)}</td><td class="${sgnCls(a.gsax)}">${signed(a.gsax)}</td></tr>`).join('')}
    </tbody></table>`;
}
function renderGoalies() {
  const i = state.week;
  const rows = sortRows(goalieRows(i), state.sortG);
  const maxScore = Math.max(...rows.map((r) => r.score)), minScore = Math.min(...rows.map((r) => r.score));
  const unranked = i === D.weeks.length - 1 ? D.goalies.filter((g) => !g.rank && g.gp > 0) : [];
  $('#tab-goalies').innerHTML = `
    <h2>Goalie power rankings · through ${weekLabel(D.weeks[i])}</h2>
    <p class="note">Ranked mostly on save % adjusted for the shooters faced, plus goals saved above expected, goals allowed versus what each opponent usually scores, and schedule strength. Click a goalie for their game log; click a header to sort.</p>
    <div class="tbl-wrap"><table id="gt"><thead><tr>${gCols.map(([k, l, t]) => `<th class="${['name', 'team'].includes(k) ? 'l ' : ''}${k !== 'mv' ? 'sortable' : ''} ${state.sortG.k === k ? 'sorted' : ''}" data-k="${k}" ${t ? `data-tip="${esc(t)}"` : ''}>${l}${state.sortG.k === k ? (state.sortG.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => {
      const w = 8 + (92 * (r.score - minScore)) / (maxScore - minScore || 1);
      const open = state.open.has(r.key);
      return `<tr class="row ${r.key === D.focusKey ? 'focus' : ''}" data-key="${esc(r.key)}">
        <td class="rank">${r.rank}</td><td>${movement(r.rank, r.prevRank)}</td><td class="l name">${esc(r.name)}</td><td class="l team" title="${esc(r.teamName)}">${esc(r.team)}</td>
        <td>${r.gp}</td><td>${r.rec}</td><td>${pct(r.svPct)}</td><td>${pct(r.adjSvPct)}</td><td class="${sgnCls(r.gsax)}">${signed(r.gsax)}</td>
        <td>${f2(r.gaa)}</td><td>${f2(r.workloadGaa)}</td><td>${f1(r.shotsPerGame)}</td><td>${f1(r.oppStrength)}</td>
        <td class="score-cell"><span class="bar" style="width:${w.toFixed(0)}px"></span>${f1(r.score)}</td></tr>
        ${open ? `<tr class="detail"><td colspan="${gCols.length}">${gameLog(appsFor(r.key, i))}</td></tr>` : ''}`;
    }).join('')}</tbody></table></div>
    ${unranked.length ? `<h3>Not enough minutes to rank yet</h3><p class="note">A goalie needs ${D.config.minMinutes}+ minutes and at least ${Math.round(D.config.minShareOfTeamMinutes * 100)}% of their team's minutes.</p>
      <div class="tbl-wrap"><table><thead><tr><th class="l">Goalie</th><th class="l">Team</th><th>GP</th><th>Min</th><th>Shots</th><th>GA</th><th>SV%</th><th>GSAx</th></tr></thead><tbody>
      ${unranked.map((g) => `<tr><td class="l name">${esc(g.name)}</td><td class="l team">${esc(g.teamAbbr)}</td><td>${g.gp}</td><td>${Math.round(g.min)}</td><td>${g.shots}</td><td>${g.ga}</td><td>${pct(g.svPct)}</td><td class="${sgnCls(g.gsax)}">${signed(g.gsax)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  $('#gt thead').onclick = (e) => {
    const th = e.target.closest('th.sortable'); if (!th) return;
    const k = th.dataset.k === 'team' ? 'team' : th.dataset.k;
    const lowFirst = ['rank', 'gaa', 'workloadGaa', 'name', 'team'].includes(k);
    state.sortG = state.sortG.k === k ? { k, dir: -state.sortG.dir } : { k, dir: lowFirst ? 1 : -1 };
    renderGoalies();
  };
  $('#gt tbody').onclick = (e) => {
    const tr = e.target.closest('tr.row'); if (!tr) return;
    const k = tr.dataset.key; state.open.has(k) ? state.open.delete(k) : state.open.add(k); renderGoalies();
  };
}

// ---------- weekend ----------
function renderWeekend() {
  const w = D.weekly[state.week];
  const top = w.goalies.slice(0, 3);
  const gameLine = (g) => `${g.home ? 'vs' : '@'} ${esc(g.opp)}${g.oppRank ? ` (#${g.oppRank})` : ''}: ${g.saves}/${g.shots}${g.decision ? ', ' + g.decision : ''}`;
  $('#tab-weekend').innerHTML = `
    <h2>Week ${state.week + 1} · ${weekLabel(w)}</h2>
    <p class="note">Every goalie who played this week, best first by goals saved above expected (GSAx). Opponent ranks are from the latest team rankings.</p>
    <div class="stars">${top.map((g, i) => `<div class="star"><div class="n">${['1st', '2nd', '3rd'][i]} star of the week</div><b>${esc(g.name)} <span class="team">${esc(g.teamAbbr)}</span></b>
      <div class="big ${sgnCls(g.gsax)}">${signed(g.gsax)} GSAx</div><div class="line">${g.saves} saves on ${g.shots} shots (${pct(g.svPct)})</div>
      <div class="line">${g.games.map(gameLine).join('<br>')}</div></div>`).join('')}</div>
    <div class="tbl-wrap"><table><thead><tr><th>#</th><th class="l">Goalie</th><th class="l">Team</th><th class="l">Games</th><th>GP</th><th>Shots</th><th>Saves</th><th>GA</th><th>SV%</th><th data-tip="Goals an average goalie would allow on these shots from these opponents">xGA</th><th>GSAx</th></tr></thead>
    <tbody>${w.goalies.map((g, i) => `<tr class="${g.key === D.focusKey ? 'focus' : ''}"><td class="rank">${i + 1}</td><td class="l name">${esc(g.name)}</td><td class="l team">${esc(g.teamAbbr)}</td>
      <td class="l">${g.games.map((x) => `${x.home ? 'vs' : '@'} ${esc(x.opp)} <span class="team">${x.decision || '–'} ${x.score}</span>`).join('<br>')}</td>
      <td>${g.gp}</td><td>${g.shots}</td><td>${g.saves}</td><td>${g.ga}</td><td>${pct(g.svPct)}</td><td>${f1(g.xga)}</td><td class="${sgnCls(g.gsax)}"><b>${signed(g.gsax)}</b></td></tr>`).join('')}</tbody></table></div>
    <h3>Scores</h3>
    <div class="scores">${w.games.map((g) => {
      const aw = g.as > g.hs;
      return `<div class="score"><div class="d">${md(g.date)}${g.so ? ' · SO' : g.ot ? ' · OT' : ''}</div><div class="${aw ? 'w' : ''}">${esc(g.away)} ${g.as}</div><div class="${aw ? '' : 'w'}">${esc(g.home)} ${g.hs}</div></div>`;
    }).join('')}</div>
    ${state.week === D.weeks.length - 1 && D.upcoming.length ? `<h3>Coming up</h3><div class="scores">${upcomingGames().map((g) => `<div class="score"><div class="d">${md(g.date)}</div><div>${esc(g.away)} @ ${esc(g.home)}</div></div>`).join('')}</div>` : ''}`;
}
function upcomingGames() {
  const next = D.upcoming[0] && D.upcoming[0].date;
  if (!next) return [];
  const limit = new Date(new Date(next + 'T12:00:00Z').getTime() + 3 * 864e5).toISOString().slice(0, 10);
  return D.upcoming.filter((g) => g.date <= limit);
}

// ---------- teams ----------
const tCols = [
  ['rank', 'Rk', ''], ['mv', '', ''], ['name', 'Team', ''], ['rec', 'W-L-OTL', 'OTL includes shootout losses'], ['ptsPct', 'Win%', 'Win percentage, with overtime and shootout losses counting as half a win (same as points %)'],
  ['gfpg', 'GF/GP', ''], ['gapg', 'GA/GP', ''], ['sfpg', 'SF/GP', 'Shots for per game'], ['sapg', 'SA/GP', 'Shots against per game'],
  ['net', 'Adj Goal Diff', 'Goals per game better (or worse) than an average team, adjusted for opponent strength. Blowouts capped'],
  ['krach', 'Results', 'Results rating: wins are worth more the stronger the team beaten. 1.00 = average; 2.00 = results like a team twice as strong'],
  ['vsTopPct', 'vs Top', 'Record against the top third of the league (by current rank)'], ['bestWinRank', 'Best win', 'Highest-ranked team beaten'],
  ['oppPtsPct', 'Opp Win%', "Opponents' win % in their other games (OT/SO losses count as half a win)"], ['sos', 'SOS', 'Strength of schedule: average Adj Goal Diff of opponents faced'], ['score', 'Power score', ''],
];
function renderTeams() {
  const i = state.week, prev = D.snapshots[i - 1];
  const rows = sortRows(D.snapshots[i].teams.map((t) => {
    const base = teamById[t.id], p = prev && prev.teams.find((x) => x.id === t.id);
    return { ...t, name: base.name, abbr: base.abbr, prevRank: p ? p.rank : null, rec: `${t.w}-${t.l}-${t.otl}`, vsTopPct: t.vsTop.w * 2 + t.vsTop.otl - (t.vsTop.l + t.vsTop.otl) * 0.01, bestWinRank: t.bestWin ? -t.bestWin.rank : -99, gfpg: t.gf / t.gp, gapg: t.ga / t.gp, sfpg: t.sf / t.gp, sapg: t.sa / t.gp };
  }), state.sortT);
  $('#tab-teams').innerHTML = `
    <h2>Team power rankings · through ${weekLabel(D.weeks[i])}</h2>
    <p class="note">Ratings are schedule-adjusted: beating a strong team counts more than beating a weak one, and goals per game are capped at ${D.config.goalCapPerGame} so one blowout can't define a team. Power score is ${Math.round(D.weights.teamResults * 100)}% results rating (quality of wins), ${Math.round(D.weights.teamPoints * 100)}% win %, and ${Math.round(D.weights.teamNet * 100)}% adjusted goal differential. "vs Top" is the record against the top ${D.teams[0] ? D.teams[0].topN : 5}. These ratings also set the opponent strength used for goalies.</p>
    <div class="tbl-wrap"><table id="tt"><thead><tr>${tCols.map(([k, l, t]) => `<th class="${k === 'name' ? 'l ' : ''}${k !== 'mv' ? 'sortable' : ''} ${state.sortT.k === k ? 'sorted' : ''}" data-k="${k}" ${t ? `data-tip="${esc(t)}"` : ''}>${l}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((t) => `<tr class="${t.abbr === D.config.focusTeam ? 'focus' : ''}"><td class="rank">${t.rank}</td><td>${movement(t.rank, t.prevRank)}</td><td class="l name">${esc(t.name)} <span class="team">${esc(t.abbr)}</span></td>
      <td>${t.rec}</td><td>${pct(t.ptsPct)}</td><td>${f2(t.gfpg)}</td><td>${f2(t.gapg)}</td><td>${f1(t.sfpg)}</td><td>${f1(t.sapg)}</td>
      <td class="${sgnCls(t.net)}">${signed(t.net, 2)}</td><td>${f2(t.krach)}</td><td>${t.vsTop.w}-${t.vsTop.l}-${t.vsTop.otl}</td><td class="l">${t.bestWin ? `${esc(t.bestWin.abbr)} <span class="team">#${t.bestWin.rank}</span>` : '<span class="team">–</span>'}</td>
      <td>${pct(t.oppPtsPct)}</td><td class="${sgnCls(t.sos)}">${signed(t.sos, 2)}</td><td>${f1(t.score)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#tt thead').onclick = (e) => {
    const th = e.target.closest('th.sortable'); if (!th) return;
    const k = th.dataset.k, lowFirst = ['rank', 'name', 'gapg', 'sapg'].includes(k);
    state.sortT = state.sortT.k === k ? { k, dir: -state.sortT.dir } : { k, dir: lowFirst ? 1 : -1 };
    renderTeams();
  };
}

// ---------- focus goalie ----------
function rankLine(values, i) {
  // Single-series line of power rank by week, rank 1 at top.
  const W = 520, H = 200, L = 34, R = 14, T = 14, B = 28;
  const n = values.length, maxRank = Math.max(...D.snapshots.map((s) => s.goalies.length));
  const x = (j) => L + (n === 1 ? (W - L - R) / 2 : (j * (W - L - R)) / (n - 1));
  const y = (r) => T + ((r - 1) * (H - T - B)) / (maxRank - 1 || 1);
  const ticks = [1, 5, 10, 15, 20, 25, 30].filter((t) => t <= maxRank);
  const pts = values.map((v, j) => (v ? [x(j), y(v.rank), v, j] : null)).filter(Boolean);
  const path = pts.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Power rank by week">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">#${t}</text>`).join('')}
    ${values.map((v, j) => `<text x="${x(j)}" y="${H - 8}" text-anchor="middle">Wk ${j + 1}</text>`).join('')}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${pts.map(([px, py, v, j]) => `<circle cx="${px}" cy="${py}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
      <text x="${px}" y="${py < T + 16 ? py + 20 : py - 10}" text-anchor="middle" style="fill:var(--text);font-weight:600">#${v.rank}</text>
      <circle cx="${px}" cy="${py}" r="16" fill="transparent" data-tip="Week ${j + 1} (${esc(weekLabel(D.weeks[j]))})<br>Rank #${v.rank} · score ${f1(v.score)}"/>`).join('')}
  </svg>`;
}
function gsaxBars(apps) {
  // Diverging bars: GSAx per game around zero.
  const W = 520, H = 200, L = 34, R = 10, T = 12, B = 34;
  const n = apps.length, m = Math.max(2, ...apps.map((a) => Math.abs(a.gsax)));
  const lim = Math.ceil(m);
  const y = (v) => T + ((lim - v) * (H - T - B)) / (2 * lim);
  const bw = Math.min(46, ((W - L - R) / n) * 0.6);
  const cx = (j) => L + ((j + 0.5) * (W - L - R)) / n;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals saved above expected by game">
    ${[-lim, 0, lim].map((t) => `<line class="${t === 0 ? 'axis0' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t > 0 ? '+' : ''}${t}</text>`).join('')}
    ${apps.map((a, j) => {
      const top = Math.min(y(0), y(a.gsax)), h = Math.max(1, Math.abs(y(a.gsax) - y(0)));
      const pos = a.gsax >= 0;
      // 4px rounded end on the data side only, square at the zero line.
      const x0 = cx(j) - bw / 2, r = Math.min(4, h);
      const d = pos
        ? `M${x0},${y(0)}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${y(0)}Z`
        : `M${x0},${y(0)}V${top + h - r}Q${x0},${top + h} ${x0 + r},${top + h}H${x0 + bw - r}Q${x0 + bw},${top + h} ${x0 + bw},${top + h - r}V${y(0)}Z`;
      return `<path d="${d}" fill="${pos ? 'var(--accent)' : 'var(--neg)'}"/>
        <text x="${cx(j)}" y="${H - 20}" text-anchor="middle">${a.home ? 'vs' : '@'} ${esc(a.oppAbbr)}</text><text x="${cx(j)}" y="${H - 7}" text-anchor="middle">${md(a.date)}</text>
        <rect x="${cx(j) - (W - L - R) / n / 2}" y="${T}" width="${(W - L - R) / n}" height="${H - T - B}" fill="transparent"
          data-tip="${esc(md(a.date))} ${a.home ? 'vs' : '@'} ${esc(a.oppAbbr)} (${a.decision || 'relief'} ${a.score})<br>${a.saves} saves on ${a.shots} · expected GA ${f1(a.xga)}, allowed ${a.ga}<br><b>${signed(a.gsax)} GSAx</b>"/>`;
    }).join('')}
  </svg>`;
}
function workloadScatter(snap, focusKey) {
  // GAA (y) against shots faced per game (x); the line is a league-average goalie.
  const W = 520, H = 260, L = 34, R = 14, T = 12, B = 32;
  const pts = snap.goalies.filter((g) => g.gaa != null);
  const xMax = Math.ceil((Math.max(...pts.map((g) => g.shotsPerGame)) + 4) / 10) * 10;
  const yMax = Math.ceil(Math.max(...pts.map((g) => g.gaa)) + 1);
  const x = (v) => L + (v * (W - L - R)) / xMax, y = (v) => H - B - (v * (H - T - B)) / yMax;
  const xt = []; for (let v = 0; v <= xMax; v += 10) xt.push(v);
  const yt = []; const step = yMax > 10 ? 4 : 2; for (let v = 0; v <= yMax; v += step) yt.push(v);
  const lineEnd = Math.min(xMax, yMax / D.league.sh);
  const dots = pts.slice().sort((a, b) => (a.key === focusKey) - (b.key === focusKey));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals against per game versus shots faced per game">
    ${yt.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${xt.map((v) => `<text x="${x(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`).join('')}
    <text x="${W - R}" y="${H - 4}" text-anchor="end">shots faced per game →</text>
    <text x="${L + 4}" y="${T + 8}">GAA ↑</text>
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(lineEnd)}" y2="${y(lineEnd * D.league.sh)}" stroke="var(--text-2)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${x(lineEnd)}" y="${y(lineEnd * D.league.sh) - 8}" text-anchor="end">league-avg goalie</text>
    ${dots.map((g) => {
      const me = g.key === focusKey, gl = goalieByKey[g.key];
      return `<circle cx="${x(g.shotsPerGame)}" cy="${y(g.gaa)}" r="${me ? 7 : 5}" fill="${me ? 'var(--accent)' : 'var(--muted)'}" fill-opacity="${me ? 1 : 0.55}" stroke="var(--surface)" stroke-width="2"/>
        ${me ? `<text x="${x(g.shotsPerGame)}" y="${y(g.gaa) + 22}" text-anchor="middle" style="fill:var(--text);font-weight:600">${esc(gl.name.split(' ')[0])}</text>` : ''}
        <circle cx="${x(g.shotsPerGame)}" cy="${y(g.gaa)}" r="11" fill="transparent" data-tip="<b>${esc(gl.name)}</b> ${esc(gl.teamAbbr)}<br>${f1(g.shotsPerGame)} shots/game · ${f2(g.gaa)} GAA<br>At avg workload: ${f2(g.workloadGaa)} GAA"/>`;
    }).join('')}
  </svg>`;
}
function renderFocus() {
  const el = $('#tab-focus');
  if (!focus) { el.innerHTML = `<p class="empty">Couldn't find ${esc(D.config.focusGoalie)} in the box scores yet.</p>`; return; }
  const i = state.week, snap = D.snapshots[i];
  const s = snap.goalies.find((g) => g.key === focus.key);
  const apps = appsFor(focus.key, i);
  const shots = apps.reduce((t, a) => t + a.shots, 0), ga = apps.reduce((t, a) => t + a.ga, 0), xga = apps.reduce((t, a) => t + a.xga, 0);
  const gp = apps.filter((a) => a.min >= 1).length;
  const rk = (f, hi = true) => { const r = rankAmong(focus.key, f, snap, hi); return r ? `${ord(r.rank)} of ${r.of}` : 'unranked'; };
  const lgShots = D.league.shotsPerGame;
  const best = apps.slice().sort((a, b) => b.gsax - a.gsax)[0];
  const teamRow = teamById[focus.teamId];
  const next = D.upcoming.filter((g) => g.home === focus.teamAbbr || g.away === focus.teamAbbr).slice(0, 4);
  const tiles = [
    ['Power rank', s ? `#${s.rank}` : '–', `of ${snap.goalies.length} ranked`],
    ['Save %', pct(s && s.svPct), rk('svPct')],
    ['Adjusted save %', pct(s && s.adjSvPct), rk('adjSvPct')],
    ['Goals saved above exp.', signed(s && s.gsax), rk('gsax')],
    ['Shots faced / game', f1(s && s.shotsPerGame), `${rk('shotsPerGame')} · lg avg ${f1(lgShots)}`],
    ['Opponent strength', f1(s && s.oppStrength), `${rk('oppStrength')} toughest`],
    ['GAA', f2(s && s.gaa), rk('gaa', false)],
    ['GAA at avg workload', f2(s && s.workloadGaa), rk('workloadGaa', false)],
    ['Record', s ? `${s.w}-${s.l}-${s.otl}` : '–', `${esc(teamRow ? teamRow.abbr : '')} is ${teamRow ? `#${teamRow.rank} of ${D.teams.length}` : ''} in team rankings`],
  ];
  el.innerHTML = `
    <div class="hero">
      ${D.config.focusPhoto ? `<img class="photo" src="${esc(D.config.focusPhoto)}" alt="${esc(D.config.focusGoalie)}">` : ''}
      <div>
        <h2>${esc(D.config.focusGoalie)}</h2>
        <div class="meta">Goalie · ${esc(focus.teamName)} · through ${weekLabel(D.weeks[i])}</div>
        <div class="bigrank">${s ? '#' + s.rank : '–'}<small>of ${snap.goalies.length} ranked goalies</small></div>
      </div>
      ${D.config.teamLogo ? `<img class="logo" src="${esc(D.config.teamLogo)}" alt="${esc(focus.teamName)} logo">` : ''}
    </div>
    ${focus.name !== D.config.focusGoalie ? `<p class="note">The league site lists him as “${esc(focus.name)}”.</p>` : ''}
    <div class="tiles">${tiles.map(([l, v, r]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="r">${r}</div></div>`).join('')}</div>
    <div class="story">
      ${gp ? `<p><b>Workload:</b> ${gp} games, ${shots} shots faced, or ${f1(s ? s.shotsPerGame : shots / gp)} a game. The league average is ${f1(lgShots)}.</p>
      ${s ? `<p><b>Goals against vs workload:</b> a ${f2(s.gaa)} GAA (${rk('gaa', false)}) while facing ${f1(s.shotsPerGame)} shots a game. At the league-average ${f1(lgShots)} shots, that's a <b>${f2(s.workloadGaa)}</b> GAA (${rk('workloadGaa', false)}).</p>` : ''}
      <p><b>Versus expected:</b> a league-average goalie facing those same shots from those same opponents would have allowed about <b>${f1(xga)}</b> goals. ${firstName} allowed <b>${ga}</b>, which is <b class="${sgnCls(xga - ga)}">${signed(xga - ga)}</b> goals saved above expected.</p>
      ${best ? `<p><b>Best game:</b> ${md(best.date)} ${best.home ? 'vs' : '@'} ${esc(best.oppAbbr)}, ${best.saves} saves on ${best.shots} shots (${signed(best.gsax)} GSAx${best.decision ? ', ' + best.decision + ' ' + best.score : ''}).</p>` : ''}` : '<p>No games yet this season.</p>'}
    </div>
    <div class="charts">
      <div class="chart"><h4>Power rank by week</h4><p>Up is better. Hover a point for details.</p>${rankLine(focus.history.slice(0, i + 1))}</div>
      <div class="chart"><h4>Goals against vs workload</h4><p>Every ranked goalie. Below the line = fewer goals than an average goalie would allow on that many shots.</p>${workloadScatter(snap, focus.key)}</div>
      <div class="chart"><h4>Goals saved above expected, by game</h4><p>Blue: saved more than an average goalie would. Orange: fewer.</p>${apps.length ? gsaxBars(apps) : '<p class="empty">No games yet.</p>'}</div>
    </div>
    <h3>Game log</h3>
    <div class="tbl-wrap">${gameLog(apps)}</div>
    ${next.length ? `<h3>Next up for ${esc(focus.teamAbbr)}</h3><div class="scores">${next.map((g) => {
      const opp = g.home === focus.teamAbbr ? g.away : g.home, oppT = D.teams.find((t) => t.abbr === opp);
      return `<div class="score"><div class="d">${md(g.date)}</div><div>${g.home === focus.teamAbbr ? 'vs' : '@'} <b>${esc(opp)}</b>${oppT ? ` <span class="team">#${oppT.rank}, ${oppT.w}-${oppT.l}-${oppT.otl}</span>` : ''}</div></div>`;
    }).join('')}</div>` : ''}`;
}

// ---------- how it works ----------
function renderHow() {
  const w = D.weights, p = (x) => Math.round(x * 100) + '%';
  $('#tab-how').innerHTML = `<div class="how">
    <h2>How the rankings work</h2>
    <h3>1. Team strength</h3>
    <p>Each team gets an <b>offense</b> rating and a <b>defense</b> rating from every league result, adjusted for the opponents. Scoring 5 on a strong defense counts for more than scoring 5 on a weak one. Goals are capped at ${D.config.goalCapPerGame} a game, and every team starts with ${D.config.teamPriorGames} games of league-average "ballast" so early weeks don't swing wildly. Adjusted goal differential (Adj Goal Diff) = offense − defense: how many goals a game better than an average team.</p>
    <p>Each team also gets a <b>results rating</b> (the KRACH method used in college hockey). Every win is worth more the stronger the team beaten, and all teams are solved together, so beating a team that has beaten good teams counts the most. Going 6-0 against weak teams earns less than 4-1 against strong ones. Overtime and shootout games split the credit ${Math.round(D.config.overtimeWinShare * 100)}/${Math.round((1 - D.config.overtimeWinShare) * 100)}, and every team starts with ${D.config.resultsPriorGames} virtual ties against an average team so an early unbeaten record doesn't run away.</p>
    <p><b>Team power score</b> = ${p(w.teamResults)} results rating + ${p(w.teamPoints)} win % (OT/SO losses count as half a win) + ${p(w.teamNet)} adjusted goal differential. Record still carries the most weight, but now it's measured by whom you beat.</p>
    <h3>2. Expected goals against, for every goalie in every game</h3>
    <p>The league-wide shooting % is ${pct(D.league.sh)} (an average save % of ${pct(D.league.sv)}). Some teams finish their chances better than others, so each team gets a <b>finishing factor</b>, estimated jointly with the goalies they shot on so a team isn't credited just for facing weak goalies. Expected goals against (xGA) = shots faced × league shooting % × the opponent's finishing factor.</p>
    <ul>
      <li><b>GSAx</b> (goals saved above expected) = xGA − actual goals allowed. +5 means 5 fewer goals than an average goalie would give up on the same shots from the same teams.</li>
      <li><b>Adjusted SV%</b> = the goalie's save % if every opponent finished like an average team.</li>
    </ul>
    <h3>3. Goalie power score</h3>
    <ul>
      <li><b>${p(w.adjSave)}: adjusted save %</b>, pulled toward league average by ${D.config.goaliePriorShots} shots of ballast so a goalie with 2 games can't top the list on luck.</li>
      <li><b>${p(w.gsax)}: total GSAx</b>, which rewards doing it over a big workload.</li>
      <li><b>${p(w.goals)}: goals against, adjusted for workload.</b> Raw GAA mostly reflects the defense: a goalie facing 45 shots a night will give up more than one facing 15. So GAA is restated as if every goalie faced the league-average ${f1(D.league.shotsPerGame)} shots a game ("Wkld GAA"). Unlike adjusted save %, this one doesn't adjust for opponent quality.</li>
      <li><b>${p(w.schedule)}: schedule strength</b>, the average strength of the teams faced. Each opponent counts ${p(w.oppOffense)} for how well it scores and ${p(1 - w.oppOffense)} for its team power score (including quality of wins).</li>
    </ul>
    <p>Each part is converted to a standard score among ranked goalies, then weighted. 50 is an average ranked goalie; each 10 points is one standard deviation. To be ranked, a goalie needs ${D.config.minMinutes}+ minutes and ${p(D.config.minShareOfTeamMinutes)} of the team's minutes.</p>
    <h3>4. Weekly movement</h3>
    <p>Early in the season nobody knows yet which teams are truly good, so nothing is locked in. Every update re-rates <b>every game played so far</b> using the latest team ratings. If an opponent from October turns out to be strong, every goalie who faced them gets more credit for that game, retroactively: their expected goals, adjusted save %, GSAx, and schedule strength all shift.</p>
    <p>The "Rankings as of" picker shows the rankings as they stood at the end of each week (using what was known then), and the ▲▼ arrows compare against the previous week. Game logs, the weekend tab, and opponent ranks always use the latest ratings.</p>
    <h3>Tuning it</h3>
    <p>All the weights and ballast amounts are in <code>config.json</code>. Change them, then run <code>npm run analyze</code> and refresh.</p>
    <h3>Limits</h3>
    <p>Box scores record shots on goal, not shot quality, so a goalie behind a team that gives up lots of breakaways looks a bit worse than they really are. Early in the season every number is noisy, and it settles as games pile up.</p>
  </div>`;
}

// ---------- tabs ----------
function setTab(t) {
  state.tab = t;
  try { localStorage.setItem('crease-tab', t); } catch (e) { /* ignore */ }
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + t));
  window.scrollTo({ top: 0 });
}
document.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };

function render() {
  renderSpotlight(); renderGoalies(); renderWeekend(); renderTeams(); renderFocus(); renderHow();
}
renderHeader();
render();
setTab(state.tab);
