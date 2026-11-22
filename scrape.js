// Scrapes every varsity game of the season from the MWHSL SportsEngine site
// into data/games.json. Finished games are cached in cache/ so re-runs only
// fetch new days and new results.
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const config = require('./config.json');

const BASE = 'https://mwhshl.sportngin.com';
const CACHE = path.join(__dirname, 'cache');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (goalie-rankings personal use)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      await sleep(250); // be polite to the league site
      return html;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dayUrl(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${BASE}/schedule/day/league_instance/${config.leagueInstance}/${y}/${m}/${d}?subseason=${config.subseason}`;
}

// Every game day of the season, from the calendar links on a schedule page.
async function seasonGameDays() {
  const html = await get(dayUrl(isoDate(new Date())), null);
  const days = new Set();
  for (const m of html.matchAll(new RegExp(`league_instance/${config.leagueInstance}/(\\d+)/(\\d+)/(\\d+)`, 'g')))
    days.add(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  return [...days].sort();
}

// Games not played yet, straight from a schedule day page (no need to open each game).
async function scheduledGames(date) {
  const $ = cheerio.load(await get(dayUrl(date), null));
  const games = [];
  $('tr').has('a[href*="game/show"]').each((i, tr) => {
    const teams = $(tr).find('a.teamName');
    if (teams.length < 2) return;
    const link = $(tr).find('a[href*="game/show"]').first();
    const team = (a) => ({ id: teamIdFromHref($(a).attr('href')), abbr: $(a).text().trim(), name: $(a).text().trim() });
    games.push({
      id: /game\/show\/(\d+)/.exec(link.attr('href'))[1], date, venue: $(tr).find('.scheduleListTeam').eq(2).text().trim(),
      time: link.text().trim(), status: 'Scheduled', away: team(teams[0]), home: team(teams[1]), final: false,
    });
  });
  return games;
}

// Game IDs listed on one schedule day page.
async function gameIdsForDay(date) {
  const url = dayUrl(date);
  // Days more than 3 days old won't change, so cache them.
  const old = (Date.now() - new Date(date + 'T12:00:00Z')) / 864e5 > 3;
  const file = path.join(CACHE, `day-${date}.html`);
  const html = await get(url, old ? file : null);
  if (old && !fs.existsSync(file)) fs.writeFileSync(file, html);
  const ids = new Set();
  for (const m of html.matchAll(/game\/show\/(\d+)/g)) ids.add(m[1]);
  return [...ids];
}

function num(s) {
  const n = parseFloat(String(s).trim());
  return Number.isFinite(n) ? n : 0;
}

function minutes(s) {
  const [m, sec] = String(s).trim().split(':').map(Number);
  return (m || 0) + (sec || 0) / 60;
}

function teamIdFromHref(href) {
  const m = /page\/show\/(\d+)/.exec(href || '');
  return m ? m[1] : null;
}

// Team totals, skater points and the goal list from a finished box score.
// "away"/"home" follow the header order, which every box table shares.
function parseBox($, away, home, periods) {
  const table = (label) => $('table.line_score_v2').filter((i, t) => $(t).find('thead th').first().text().trim() === label).first();
  const rows = (label) => table(label).find('tbody tr').map((i, tr) => [$(tr).find('td').slice(1).map((j, td) => $(td).text().trim()).get()]).get();
  const pair = (label, f) => { const r = rows(label); return r.length === 2 ? { away: f(r[0]), home: f(r[1]) } : null; };
  const nums = (r) => r.map(num);
  const ints = (re) => (r) => { const m = re.exec(r[0] || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
  const box = {
    periods,
    goals: pair('SCORING', (r) => nums(r).slice(0, -1)),
    shots: pair('SHOTS', (r) => nums(r)), // by period, then total
    pp: pair('POWER PLAYS', ints(/(\d+)\s+for\s+(\d+)/)), // [goals, chances]
    pim: pair('PENALTIES', ints(/(\d+)\s+minutes\s+on\s+(\d+)/)), // [minutes, infractions]
    scoring: [], skaters: [],
  };
  let period = '';
  $('ul.scoring_summary').first().children('li').each((i, li) => {
    if ($(li).hasClass('interval_row')) { period = $(li).find('span').first().text().trim(); return; }
    if (!$(li).hasClass('scoring_info')) return;
    const team = $(li).find('.team_name').text().trim();
    const details = $(li).find('.play_details');
    const names = details.find('.playerLink').map((j, a) => $(a).text().trim()).get();
    box.scoring.push({
      period, clock: $(li).find('.game_clock').text().trim(), side: team === away.name ? 'away' : team === home.name ? 'home' : null,
      scorer: names[0] || null, strength: (/\((even strength|power play|short handed|empty net|penalty shot)\)/i.exec(details.text()) || [])[1] || '',
    });
  });
  $('h3.teamHeadline').each((i, h3) => {
    if (!/Skaters$/i.test($(h3).text().trim())) return;
    const teamId = teamIdFromHref($(h3).find('a').attr('href'));
    $(h3).nextAll('table').first().find('tbody tr').each((j, tr) => {
      const td = $(tr).find('td');
      if (td.length < 7) return;
      box.skaters.push({ teamId, name: $(td[1]).text().trim().replace(/\s+/g, ' '), number: $(td[0]).text().trim(), g: num($(td[2]).text()), a: num($(td[3]).text()), pim: num($(td[6]).text()) });
    });
  });
  return box;
}

function parseGame(id, html) {
  const $ = cheerio.load(html);
  const status = $('.game-header-center .status').first().text().trim();
  const dateText = $('.game_info_bar_v2 .date').first().text().trim();
  const venue = $('.game_info_bar_v2 .location').first().text().trim();
  const awayA = $('.game-header .team-crest.away');
  const homeA = $('.game-header .team-crest.home');
  const away = { id: teamIdFromHref(awayA.attr('href')), abbr: awayA.find('.team-abbrev').text().trim() };
  const home = { id: teamIdFromHref(homeA.attr('href')), abbr: homeA.find('.team-abbrev').text().trim() };
  const names = $('.game-header a.team-name');
  away.name = $(names[0]).text().trim();
  home.name = $(names[1]).text().trim();

  const game = { id, date: isoDate(new Date(dateText + ' 12:00 UTC')), venue, status, away, home, final: /final/i.test(status) };
  if (!game.final) return game;

  away.score = num($('.game-header-center .scores .away').text());
  home.score = num($('.game-header-center .scores .home').text());

  // Line score columns past the 3rd period mean OT / shootout.
  const periods = $('table.line_score_v2').first().find('thead th')
    .map((i, el) => $(el).text().trim())
    .get()
    .filter((t) => t && t !== 'T');
  game.periods = periods;
  game.ot = periods.some((p) => /OT/i.test(p) || /^\d+$/.test(p) && Number(p) > 3);
  game.so = periods.some((p) => /SO/i.test(p)) || /SO|shootout/i.test(status);

  game.box = parseBox($, away, home, periods);

  game.goalies = [];
  $('h3.teamHeadline').each((i, h3) => {
    const title = $(h3).text().trim();
    if (!/Goalies$/i.test(title)) return;
    const teamId = teamIdFromHref($(h3).find('a').attr('href'));
    const table = $(h3).nextAll('table').first();
    table.find('tbody tr').each((j, tr) => {
      const td = $(tr).find('td');
      if (td.length < 7) return;
      const link = $(td[1]).find('a');
      const g = {
        teamId,
        playerId: (/roster_players\/(\d+)/.exec(link.attr('href') || '') || [])[1] || null,
        name: $(td[1]).text().trim().replace(/\s+/g, ' '),
        number: $(td[0]).text().trim(),
        min: minutes($(td[2]).text()),
        shots: num($(td[3]).text()),
        ga: num($(td[4]).text()),
        saves: num($(td[5]).text()),
      };
      if (g.min > 0 || g.shots > 0) game.goalies.push(g);
    });
  });
  return game;
}

async function main() {
  const gameDays = (await seasonGameDays()).filter((d) => d >= config.seasonStart && d <= config.seasonEnd);
  if (!gameDays.length) throw new Error('No game days found on the schedule page. Has the site layout changed?');
  const cutoff = isoDate(new Date(Date.now() + 864e5));
  const days = gameDays.filter((d) => d <= cutoff), future = gameDays.filter((d) => d > cutoff);

  console.log(`Scanning ${days.length} played days and ${future.length} upcoming days...`);
  const ids = new Set();
  for (let i = 0; i < days.length; i += 6) {
    const batch = await Promise.all(days.slice(i, i + 6).map(gameIdsForDay));
    batch.flat().forEach((id) => ids.add(id));
  }
  console.log(`Found ${ids.size} games. Loading box scores...`);

  const games = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 6) {
    const batch = await Promise.all(
      list.slice(i, i + 6).map(async (id) => {
        const file = path.join(CACHE, `game-${id}.html`);
        const html = await get(`${BASE}/game/show/${id}?subseason=${config.subseason}`, file);
        const game = parseGame(id, html);
        // Only cache finished games with goalie lines; others may still change.
        if (game.final && game.goalies.length && !fs.existsSync(file)) fs.writeFileSync(file, html);
        return game;
      })
    );
    games.push(...batch);
  }
  const seen = new Set(games.map((g) => g.id));
  for (let i = 0; i < future.length; i += 6) {
    const batch = await Promise.all(future.slice(i, i + 6).map(scheduledGames));
    for (const g of batch.flat()) if (!seen.has(g.id)) { seen.add(g.id); games.push(g); }
  }
  games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // Skater names and goal scorers go in a git-ignored file: the site's data is
  // encrypted, but games.json sits in a public repo.
  const details = {};
  for (const g of games) if (g.box) { details[g.id] = { scoring: g.box.scoring, skaters: g.box.skaters }; delete g.box.scoring; delete g.box.skaters; }
  fs.writeFileSync(path.join(DATA, 'box-details.json'), JSON.stringify(details));
  const finals = games.filter((g) => g.final);
  fs.writeFileSync(path.join(DATA, 'games.json'), JSON.stringify({ scrapedAt: new Date().toISOString(), games }, null, 1));
  console.log(`Saved ${games.length} games (${finals.length} final) to data/games.json`);
  const noGoalies = finals.filter((g) => !g.goalies.length);
  if (noGoalies.length) console.log(`Note: ${noGoalies.length} final games have no goalie box score yet: ${noGoalies.map((g) => g.id).join(', ')}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
module.exports = { parseGame };
