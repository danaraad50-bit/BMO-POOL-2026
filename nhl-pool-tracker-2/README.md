# BMO2026 NHL Pool Tracker — 2026–27

A shareable, server-backed NHL pool tracker with:
- 19 participant rosters loaded from the supplied workbook.
- Server-side NHL stats API polling (regular season only).
- Configurable scoring in `data/config.json`.
- Daily 06:00 America/Toronto automatic snapshots, plus manual refresh.
- SQLite history for season-long trend charts.
- Standings, participant detail, and player ownership/stat views.
- Mobile-first hockey-themed UI.

## Scoring loaded from the supplied pool sheet

Forwards: G = 2, A = 1  
Defencemen: G = 2, A = 1  
Goalies: W = 2, SO = 2, OTL = 1  
Teams: W = 2, OTL = 1

The workbook also contains preseason/current-entry status fields. The tracker does **not** use those preseason totals for the regular-season scoring; it recalculates from the 2026–27 regular-season NHL stats API.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000

Set `PORT` if needed. SQLite is stored as `pool.db`.

## Deployment

The included Dockerfile works on Render, Railway, Fly.io, etc. Use a persistent disk/volume for `pool.db`; otherwise historical snapshots will be lost on redeploy.

Environment variables:
- `PORT` — default 3000
- `REFRESH_TOKEN` — optional secret for POST /api/refresh
- `NHL_API_BASE` — optional override, default `https://api.nhle.com/stats/rest/en`

If `REFRESH_TOKEN` is set, the refresh button sends it in `X-Refresh-Token`. For a public deployment, set this secret.

## NHL API

The server uses NHL stats REST endpoints:
- `/skater/summary`
- `/goalie/summary`
- `/team/summary`

with `seasonId=20262027` and `gameTypeId=2` (regular season). The adapter is intentionally tolerant of NHL field-name variations.

## Important roster data note

The supplied roster workbook uses some abbreviated/changed franchise codes and player names. The server includes an alias layer in `server.js` so common cases such as `NJ` → `NJD`, `SJ` → `SJS`, `TB` → `TBL`, `VGK` → `VGK`, etc. can be normalized. Player matching is name + franchise based. If the NHL API changes a player/team identifier, add an alias to `PLAYER_ALIASES` or `TEAM_ALIASES`.

## Changing scoring

Edit `data/config.json`, then restart the server. The scoring engine only awards configured categories. You can add `PIM`, `PPG`, `PPA`, etc. by adding them to the relevant position's scoring map, e.g.:

```json
"F": { "G": 2, "A": 1, "PPG": 0.5 }
```

Goalie and team categories work the same way.

## Trades / adds / drops

The supplied workbook is a draft snapshot. This version treats those rosters as locked for the regular season. If the pool later allows transactions, add dated roster events to `data/transactions.json` and apply them in the scoring layer before snapshots are saved.

## Tie-breakers

Configured order: total points, goals, assists, alphabetical. The UI displays tied ranks correctly. Change `tieBreakers` in `data/config.json` if the pool rules change.

## Update behavior

- Browser auto-refreshes displayed standings every 15 minutes.
- Server polls the NHL API every day at 06:00 America/Toronto and stores a snapshot.
- "Refresh now" can be used after a game night. It also stores a snapshot.
- The history chart uses server-stored snapshots, so all participants see the same history.
