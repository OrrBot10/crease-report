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

// Game IDs listed on one schedule day page.
async function gameIdsForDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const url = `${BASE}/schedule/day/league_instance/${config.leagueInstance}/${y}/${m}/${d}?subseason=${config.subseason}`;
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
  const start = new Date(config.seasonStart + 'T12:00:00Z');
  const end = new Date(Math.min(new Date(config.seasonEnd + 'T12:00:00Z'), Date.now() + 864e5));
  const days = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 864e5)) days.push(isoDate(d));

  console.log(`Scanning ${days.length} schedule days...`);
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
  games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
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
