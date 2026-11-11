// Turns data/games.json into team + goalie power rankings, week by week,
// and writes public/data.js for the web app.
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const W = config.weights;
const REG_MIN = 51; // MWHSL regulation: three 17-minute periods

const { games: allGames, scrapedAt } = require('./data/games.json');
const finals = allGames.filter((g) => g.final && g.goalies.length);

// ---------- helpers ----------
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
function zscores(values) {
  const m = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2))) || 1;
  return values.map((v) => (v - m) / sd);
}
function weekKey(date) {
  // Monday of that date's week; MWHSL plays Fri-Sun weekends (plus some Thursdays).
  const d = new Date(date + 'T12:00:00Z');
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 864e5).toISOString().slice(0, 10);
}
const goalieKey = (teamId, name) => `${teamId}:${name.toLowerCase()}`;

// Team list from every game on the schedule.
const teams = {};
for (const g of allGames)
  for (const t of [g.home, g.away]) if (t.id && !teams[t.id]) teams[t.id] = { id: t.id, abbr: t.abbr, name: t.name };

// ---------- core model on a set of final games ----------
function analyze(games) {
  const teamIds = Object.keys(teams);

  // Per-team results and per-side lines. Shootout winners get +1 on the
  // scoreboard; for strength purposes a shootout is a tie.
  const rec = Object.fromEntries(teamIds.map((id) => [id, { gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0, sf: 0, sa: 0, games: [] }]));
  const sides = []; // { team, opp, goals, shots }
  for (const g of games) {
    let hs = g.home.score, as = g.away.score;
    const shotsOn = (teamId) => sum(g.goalies.filter((x) => x.teamId === teamId), (x) => x.shots);
    const homeShots = shotsOn(g.away.id), awayShots = shotsOn(g.home.id);
    for (const [me, op, gf, ga, sf, sa] of [
      [g.home, g.away, hs, as, homeShots, awayShots],
      [g.away, g.home, as, hs, awayShots, homeShots],
    ]) {
      const r = rec[me.id];
      r.gp++; r.gf += gf; r.ga += ga; r.sf += sf; r.sa += sa;
      if (gf > ga) { r.w++; r.pts += 2; } else if (g.ot || g.so) { r.otl++; r.pts += 1; } else r.l++;
      r.games.push(g.id);
    }
    if (g.so) { if (hs > as) hs--; else as--; }
    sides.push({ team: g.home.id, opp: g.away.id, goals: hs, shots: homeShots });
    sides.push({ team: g.away.id, opp: g.home.id, goals: as, shots: awayShots });
  }

  // Team offense/defense: goals(A vs B) ≈ mu · off[A] · def[B], fit iteratively
  // with a prior of PRIOR games at league average. Goals are capped per game so
  // one 17-0 game doesn't define a team.
  const cap = (x) => Math.min(x, config.goalCapPerGame);
  const mu = mean(sides.map((s) => cap(s.goals))) || 3;
  const shotMu = mean(sides.map((s) => s.shots)) || 30;
  const P = config.teamPriorGames;
  const off = {}, def = {}, soff = {}, sdef = {};
  teamIds.forEach((id) => (off[id] = def[id] = soff[id] = sdef[id] = 1));
  for (let it = 0; it < 100; it++) {
    for (const id of teamIds) {
      const mine = sides.filter((s) => s.team === id), vs = sides.filter((s) => s.opp === id);
      off[id] = (sum(mine, (s) => cap(s.goals)) + P * mu) / (sum(mine, (s) => mu * def[s.opp]) + P * mu);
      def[id] = (sum(vs, (s) => cap(s.goals)) + P * mu) / (sum(vs, (s) => mu * off[s.team]) + P * mu);
      soff[id] = (sum(mine, (s) => s.shots) + P * shotMu) / (sum(mine, (s) => shotMu * sdef[s.opp]) + P * shotMu);
      sdef[id] = (sum(vs, (s) => s.shots) + P * shotMu) / (sum(vs, (s) => shotMu * soff[s.team]) + P * shotMu);
    }
  }

  const teamRows = teamIds.filter((id) => rec[id].gp > 0).map((id) => {
    const r = rec[id];
    const oppIds = sides.filter((s) => s.team === id).map((s) => s.opp);
    return {
      ...teams[id], ...r,
      ptsPct: r.pts / (2 * r.gp),
      offRating: mu * off[id], // goals/game vs an average defense
      defRating: mu * def[id], // goals allowed/game vs an average offense
      net: mu * (off[id] - def[id]),
      shotsForRating: shotMu * soff[id],
      shotsAgainstRating: shotMu * sdef[id],
      oppIds,
    };
  });
  const netById = Object.fromEntries(teamRows.map((t) => [t.id, t.net]));
  teamRows.forEach((t) => (t.sos = mean(t.oppIds.map((o) => netById[o]))));
  const zNet = zscores(teamRows.map((t) => t.net)), zPts = zscores(teamRows.map((t) => t.ptsPct));
  teamRows.forEach((t, i) => (t.score = 50 + 10 * (W.teamNet * zNet[i] + W.teamPoints * zPts[i])));
  teamRows.sort((a, b) => b.score - a.score).forEach((t, i) => { t.rank = i + 1; delete t.games; delete t.oppIds; });
  const teamById = Object.fromEntries(teamRows.map((t) => [t.id, t]));

  // ---------- goalies ----------
  // Every goalie appearance, with the opponent and result.
  const apps = [];
  for (const g of games) {
    for (const x of g.goalies) {
      if (x.min < 0.5) continue; // box-score noise: 0:00 goalies credited with a shot
      const home = x.teamId === g.home.id;
      const me = home ? g.home : g.away, op = home ? g.away : g.home;
      const starter = g.goalies.filter((y) => y.teamId === x.teamId).sort((a, b) => b.min - a.min)[0] === x;
      let decision = '';
      if (starter) decision = me.score > op.score ? 'W' : g.ot || g.so ? 'OTL' : 'L';
      apps.push({ key: goalieKey(x.teamId, x.name), name: x.name, teamId: x.teamId, opp: op.id, gameId: g.id, date: g.date,
        min: x.min, shots: x.shots, ga: x.ga, saves: x.shots - x.ga, decision, score: `${me.score}-${op.score}${g.so ? ' SO' : g.ot ? ' OT' : ''}`, home });
    }
  }

  // Joint fit: GA ≈ shots · lgSh · fin[shooting team] · gk[goalie].
  // fin = how well a team finishes its shots; gk = goalie's goals-allowed factor
  // (below 1 is good). Both shrunk toward league average.
  const lgSh = sum(apps, (a) => a.ga) / (sum(apps, (a) => a.shots) || 1);
  const lgSv = 1 - lgSh;
  const PF = config.finishingPriorShots * lgSh, PG = config.goaliePriorShots * lgSh;
  const fin = Object.fromEntries(teamIds.map((id) => [id, 1]));
  const keys = [...new Set(apps.map((a) => a.key))];
  const gk = Object.fromEntries(keys.map((k) => [k, 1]));
  for (let it = 0; it < 100; it++) {
    for (const id of teamIds) {
      const a = apps.filter((x) => x.opp === id);
      fin[id] = (sum(a, (x) => x.ga) + PF) / (sum(a, (x) => x.shots * lgSh * gk[x.key]) + PF);
    }
    for (const k of keys) {
      const a = apps.filter((x) => x.key === k);
      gk[k] = (sum(a, (x) => x.ga) + PG) / (sum(a, (x) => x.shots * lgSh * fin[x.opp]) + PG);
    }
  }
  for (const a of apps) {
    a.svPct = a.shots ? a.saves / a.shots : null;
    a.xga = a.shots * lgSh * fin[a.opp];
    a.gsax = a.xga - a.ga;
    a.oppRank = teamById[a.opp] ? teamById[a.opp].rank : null;
    a.oppAbbr = teams[a.opp].abbr;
    a.teamAbbr = teams[a.teamId].abbr;
  }

  const goalies = keys.map((k) => {
    const a = apps.filter((x) => x.key === k);
    const min = sum(a, (x) => x.min), shots = sum(a, (x) => x.shots), ga = sum(a, (x) => x.ga);
    const xga = sum(a, (x) => x.xga);
    const t = teams[a[0].teamId];
    const teamMin = sum(games.filter((g) => g.home.id === t.id || g.away.id === t.id),
      (g) => Math.max(REG_MIN, sum(g.goalies.filter((y) => y.teamId === t.id), (y) => y.min))) || 1;
    const gp = a.filter((x) => x.min >= 1).length;
    const gpEq = min / REG_MIN;
    return {
      key: k, name: a[0].name, teamId: t.id, teamAbbr: t.abbr, teamName: t.name,
      gp, min, shots, ga, saves: shots - ga,
      w: a.filter((x) => x.decision === 'W').length, l: a.filter((x) => x.decision === 'L').length, otl: a.filter((x) => x.decision === 'OTL').length,
      svPct: shots ? (shots - ga) / shots : null,
      gaa: min ? (ga / min) * REG_MIN : null,
      shotsPerGame: gpEq ? shots / gpEq : 0,
      xga, gsax: xga - ga,
      adjSvPct: shots ? 1 - lgSh * (ga / (xga || 1)) : null, // save % if every opponent finished like an average team
      ratingSv: 1 - lgSh * gk[k], // shrunk version used for ranking
      // GAA if the goalie faced a league-average number of shots: separates the
      // goalie from a defense that gives up a lot (or very few) shots.
      workloadGaa: shots ? (ga / shots) * shotMu : null,
      ratingWorkloadGaa: ((ga + config.goaliePriorShots * lgSh) / (shots + config.goaliePriorShots)) * shotMu,
      oppOffense: sum(a, (x) => x.min * (teamById[x.opp] ? teamById[x.opp].offRating : mu)) / (min || 1),
      oppNet: sum(a, (x) => x.min * (teamById[x.opp] ? teamById[x.opp].net : 0)) / (min || 1),
      teamMinutes: teamMin,
      share: min / teamMin,
      games: a.map((x) => x.gameId),
    };
  });
  for (const g of goalies) g.qualified = g.min >= Math.max(config.minMinutes, config.minShareOfTeamMinutes * g.teamMinutes);
  const q = goalies.filter((g) => g.qualified);
  const comp = {
    sv: zscores(q.map((g) => g.ratingSv)),
    gsax: zscores(q.map((g) => g.gsax)),
    gp: zscores(q.map((g) => -g.ratingWorkloadGaa)),
    sos: zscores(q.map((g) => g.oppOffense)),
  };
  q.forEach((g, i) => {
    g.components = { sv: comp.sv[i], gsax: comp.gsax[i], goals: comp.gp[i], sos: comp.sos[i] };
    g.score = 50 + 10 * (W.adjSave * comp.sv[i] + W.gsax * comp.gsax[i] + W.goals * comp.gp[i] + W.schedule * comp.sos[i]);
  });
  q.sort((a, b) => b.score - a.score).forEach((g, i) => (g.rank = i + 1));
  goalies.sort((a, b) => (a.rank || 999) - (b.rank || 999) || b.min - a.min);

  return { lg: { sv: lgSv, sh: lgSh, goalsPerGame: mu, shotsPerGame: shotMu, games: games.length }, teams: teamRows, goalies, apps };
}

// ---------- week-by-week snapshots ----------
const weekKeys = [...new Set(finals.map((g) => weekKey(g.date)))].sort();
const weeks = weekKeys.map((wk) => {
  const wGames = finals.filter((g) => weekKey(g.date) === wk);
  const dates = wGames.map((g) => g.date).sort();
  return { key: wk, from: dates[0], to: dates[dates.length - 1], games: wGames.length };
});

const snapshots = weeks.map((w) => analyze(finals.filter((g) => weekKey(g.date) <= w.key)));
const current = snapshots[snapshots.length - 1];

// Rank history per goalie / team across snapshots.
const goalieHistory = {}, teamHistory = {};
snapshots.forEach((s, i) => {
  for (const g of s.goalies) (goalieHistory[g.key] ||= Array(weeks.length).fill(null))[i] = g.rank ? { rank: g.rank, score: g.score } : null;
  for (const t of s.teams) (teamHistory[t.id] ||= Array(weeks.length).fill(null))[i] = { rank: t.rank, score: t.score };
});

// Each week's games measured with the full-season model (better opponent estimates).
const weekly = weeks.map((w) => {
  const a = current.apps.filter((x) => weekKey(x.date) === w.key);
  const byKey = {};
  for (const x of a) (byKey[x.key] ||= []).push(x);
  const rows = Object.values(byKey).map((list) => {
    const shots = sum(list, (x) => x.shots), ga = sum(list, (x) => x.ga), xga = sum(list, (x) => x.xga);
    return {
      key: list[0].key, name: list[0].name, teamAbbr: list[0].teamAbbr, gp: list.filter((x) => x.min >= 1).length,
      min: sum(list, (x) => x.min), shots, ga, saves: shots - ga, svPct: shots ? (shots - ga) / shots : null,
      xga, gsax: xga - ga, record: list.map((x) => x.decision).filter(Boolean).join(' '),
      games: list.map((x) => ({ date: x.date, opp: x.oppAbbr, oppRank: x.oppRank, home: x.home, score: x.score, decision: x.decision, shots: x.shots, ga: x.ga, saves: x.saves, gsax: x.gsax })),
    };
  }).filter((r) => r.min > 0).sort((a, b) => b.gsax - a.gsax);
  const games = finals.filter((g) => weekKey(g.date) === w.key).map((g) => ({ date: g.date, away: g.away.abbr, home: g.home.abbr, as: g.away.score, hs: g.home.score, ot: g.ot, so: g.so }));
  return { ...w, goalies: rows, games };
});

// Focus goalie match: site spells it "Brenden", so match by last name + team.
const [first, ...rest] = config.focusGoalie.split(' ');
const last = rest.join(' ').toLowerCase();
const focus = current.goalies.find((g) => g.name.toLowerCase().endsWith(' ' + last) && g.teamAbbr === config.focusTeam)
  || current.goalies.find((g) => g.name.toLowerCase().endsWith(' ' + last));

const schedule = allGames.filter((g) => !g.final).map((g) => ({ date: g.date, away: g.away.abbr, home: g.home.abbr }));

const out = {
  generatedAt: new Date().toISOString(), scrapedAt, season: config.season, weights: W, config,
  league: current.lg, weeks, weekly,
  // Full rankings as they stood after each week, for the "as of" picker.
  snapshots: snapshots.map((s) => ({
    goalies: s.goalies.filter((g) => g.rank).map((g) => ({ key: g.key, rank: g.rank, score: g.score, gp: g.gp, min: g.min, svPct: g.svPct, adjSvPct: g.adjSvPct, gsax: g.gsax, gaa: g.gaa, workloadGaa: g.workloadGaa, shotsPerGame: g.shotsPerGame, oppOffense: g.oppOffense, w: g.w, l: g.l, otl: g.otl })),
    teams: s.teams.map((t) => ({ id: t.id, rank: t.rank, score: t.score, w: t.w, l: t.l, otl: t.otl, gp: t.gp, pts: t.pts, ptsPct: t.ptsPct, gf: t.gf, ga: t.ga, offRating: t.offRating, defRating: t.defRating, net: t.net, sos: t.sos, sf: t.sf, sa: t.sa })),
  })),
  teams: current.teams.map((t) => ({ ...t, history: teamHistory[t.id] })),
  goalies: current.goalies.map((g) => ({ ...g, history: goalieHistory[g.key] || [] })),
  apps: current.apps,
  focusKey: focus ? focus.key : null,
  upcoming: schedule,
};
require('./publish')(out).then(() => {
  console.log(`Analyzed ${finals.length} games over ${weeks.length} weeks: ${out.teams.length} teams, ${out.goalies.filter((g) => g.rank).length} ranked goalies.`);
  if (focus) console.log(`${focus.name} (${focus.teamAbbr}): rank ${focus.rank || 'unranked'}, sv% ${focus.svPct?.toFixed(3)}, adj sv% ${focus.adjSvPct?.toFixed(3)}, GSAx ${focus.gsax.toFixed(1)}`);
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
