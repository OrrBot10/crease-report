# Crease Report

Goalie and team power rankings for the Midwest High School Hockey League (MWHSL) varsity season. The rankings adjust for the strength of the teams each goalie faced. Data comes from the league's box scores at mwhshl.sportngin.com.

## Use it

Requires Node.js 18+.

```bash
npm install
npm run update   # pull new box scores + recompute rankings (run after each weekend)
npm start        # open http://localhost:5173
```

You can also just double-click `public/index.html`. It works without the server.

## Password

The site is password protected. `npm run analyze` encrypts all the rankings data (and the spotlight photo) with the password, and the page decrypts it in the browser. The password never goes in the repo:

- **Locally:** put it in a `.site-password` file (git ignores it).
- **On GitHub:** set it as a repository secret named `SITE_PASSWORD` (**Settings → Secrets and variables → Actions → New repository secret**).

To change the password, update both and run the workflow. Everyone then uses the new one. The code and the raw league box scores (`data/games.json`) are visible in the public repo, but the box scores are public on the league site anyway.

## Automatic updates

`.github/workflows/update.yml` runs on GitHub's servers every morning and late Friday, Saturday, and Sunday nights. Each run scrapes, recomputes the rankings, commits the new data, and publishes `public/` to GitHub Pages. One-time setup after pushing: add the `SITE_PASSWORD` secret, then go to **Settings → Pages** and set **Source** to **GitHub Actions**. To force a refresh, go to **Actions → Update rankings → Run workflow**. If a run fails (for example, if the league site starts blocking GitHub's servers), GitHub emails you.

## Files

- `scrape.js` – walks the season schedule day by day and parses every final box score: score, OT/SO, and each goalie's minutes, shots, and GA. Finished games are cached in `cache/`, so re-runs are fast.
- `analyze.js` – team ratings, goalie expected goals, power scores, and week-by-week snapshots. Writes `public/data.js`.
- `config.json` – season IDs, the goalie to spotlight, and all the ranking weights. Edit it, run `npm run analyze`, then refresh.
- `public/` – the web app (plain HTML/CSS/JS, no build step).

The "How it works" tab in the app explains the math.

## New season

Find the new season's league page on the MWHSL site. Copy the `league_instance` number and `subseason` number from its schedule URL into `config.json`, along with the new dates.
