import express from "express";
import cron from "node-cron";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "data/config.json")));
const rosters = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rosters.json")));
const participants = JSON.parse(fs.readFileSync(path.join(__dirname, "data/participants.json")));
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.NHL_API_BASE || "https://api.nhle.com/stats/rest/en";

const TEAM_ALIASES = {
  NJ:"NJD", NJD:"NJD", SJ:"SJS", SJS:"SJS", TB:"TBL", TBL:"TBL",
  VGK:"VGK", MTL:"MTL", TOR:"TOR", EDM:"EDM", COL:"COL", DAL:"DAL",
  MIN:"MIN", CAR:"CAR", CHI:"CHI", DET:"DET", ANA:"ANA", NYI:"NYI",
  NYR:"NYR", BOS:"BOS", BUF:"BUF", FLA:"FLA", LAK:"LAK", NSH:"NSH",
  OTT:"OTT", PIT:"PIT", STL:"STL", WSH:"WSH", UTA:"UTA", VAN:"VAN",
  SEA:"SEA", CBJ:"CBJ", WPG:"WPG", CGY:"CGY", PHI:"PHI"
};
const PLAYER_ALIASES = {
  "Hughes, Jack|NJ":"Hughes, Jack|NJD",
  "Evangelista, Luke|NJ":"Evangelista, Luke|NJD",
  "Mantha, Anthony|NJ":"Mantha, Anthony|NJD",
  "SJ":"SJS"
};

const db = new Database(path.join(__dirname, "pool.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at ON snapshots(captured_at);
`);

function normName(v) {
  let s = String(v || "").trim().toLowerCase().replace(/[.'’]/g,"").replace(/\s+/g," ");
  if (s.includes(",")) {
    const [last, first] = s.split(",").map(x=>x.trim());
    s = `${first} ${last}`.trim();
  }
  return s;
}
function canonicalTeam(t) { return TEAM_ALIASES[String(t || "").toUpperCase()] || String(t || "").toUpperCase(); }
function canonicalPlayerKey(name, team) {
  const raw = `${name}|${team}`;
  return PLAYER_ALIASES[raw] || `${name}|${canonicalTeam(team)}`;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent":"BMO2026-NHL-Pool-Tracker/1.0" } });
  if (!r.ok) throw new Error(`NHL API ${r.status} for ${url}`);
  return r.json();
}
function cayenne(seasonId, gameTypeId) {
  return encodeURIComponent(`seasonId=${seasonId} and gameTypeId=${gameTypeId}`);
}

async function fetchSummary(kind) {
  const url = `${API_BASE}/${kind}/summary?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${cayenne(config.seasonId, config.gameTypeId)}`;
  const data = await fetchJSON(url);
  return data.data || [];
}
async function fetchAllStats() {
  const [skaters, goalies, teams] = await Promise.all([
    fetchSummary("skater"),
    fetchSummary("goalie"),
    fetchSummary("team")
  ]);
  return { skaters, goalies, teams };
}

function indexStats(stats) {
  const sk = new Map(), go = new Map(), te = new Map();
  for (const r of stats.skaters) {
    const key = `${normName(r.skaterFullName || r.playerFullName || r.fullName || r.name)}|${canonicalTeam(r.teamAbbrev || r.team || r.teamAbbreviation)}`;
    sk.set(key, r);
  }
  for (const r of stats.goalies) {
    const key = `${normName(r.goalieFullName || r.playerFullName || r.fullName || r.name)}|${canonicalTeam(r.teamAbbrev || r.team || r.teamAbbreviation)}`;
    go.set(key, r);
  }
  for (const r of stats.teams) {
    const key = canonicalTeam(r.teamAbbrev || r.team || r.teamAbbreviation);
    te.set(key, r);
  }
  return { sk, go, te };
}

function statValue(row, cat) {
  const aliases = {
    GP:["gamesPlayed","gp"], G:["goals","g"], A:["assists","a"], PTS:["points","pts"],
    plusMinus:["plusMinus","plusMinusRating"], PIM:["penaltyMinutes","pim"],
    PPG:["powerPlayGoals","ppGoals"], PPA:["powerPlayAssists","ppAssists"],
    PPP:["powerPlayPoints","ppPoints"], SHG:["shorthandedGoals","shGoals"],
    SHA:["shorthandedAssists","shAssists"], SHP:["shPoints","shorthandedPoints"],
    W:["wins","w"], L:["losses","l"], OTL:["otLosses","otl"],
    SO:["shutouts","so"], SV:["saves","sv"], GA:["goalsAgainst","ga"],
    GAA:["goalsAgainstAverage","gaa"], SVPct:["savePct","savePercentage"],
    GF:["goalsFor","gf"]
  };
  for (const k of (aliases[cat] || [cat])) if (row && row[k] !== undefined && row[k] !== null) return num(row[k]);
  return 0;
}
function pointsFor(row, position) {
  const rules = config.scoring[position] || {};
  return Object.entries(rules).reduce((sum,[cat,mult]) => sum + statValue(row,cat)*num(mult), 0);
}

function buildState(stats) {
  const ix = indexStats(stats);
  const playerRows = [];
  const standings = [];
  for (const p of participants) {
    const roster = rosters[p.poolName] || [];
    let total = 0, goals = 0, assists = 0;
    const players = roster.map(sel => {
      const pos = sel.position;
      let row = null, matchType = "";
      if (pos === "G") {
        const key = `${normName(sel.name)}|${canonicalTeam(sel.team)}`;
        row = ix.go.get(key);
        matchType = "goalie";
      } else if (pos === "T") {
        row = ix.te.get(canonicalTeam(sel.team));
        matchType = "team";
      } else {
        const key = `${normName(sel.name)}|${canonicalTeam(sel.team)}`;
        row = ix.sk.get(key);
        matchType = "skater";
      }
      // fallback: exact normalized player name, useful when team code changed
      if (!row && pos !== "T") {
        const map = matchType === "goalie" ? ix.go : ix.sk;
        for (const [k,v] of map.entries()) {
          if (k.split("|")[0] === normName(sel.name)) { row=v; break; }
        }
      }
      const scoringPoints = pointsFor(row || {}, pos);
      const statsOut = {};
      for (const cat of (config.categories[matchType] || [])) statsOut[cat] = statValue(row || {},cat);
      total += scoringPoints;
      goals += statsOut.G || 0;
      assists += statsOut.A || 0;
      return {
        round: sel.round, name: sel.name, team: sel.team, position: pos,
        injured: !!sel.injured, suspended: !!sel.suspended,
        points: scoringPoints, stats: statsOut, found: !!row
      };
    });
    standings.push({ poolName:p.poolName, name:p.name, fullName:p.fullName, points:total, goals, assists, players });
  }
  standings.sort((a,b)=> b.points-a.points || b.goals-a.goals || b.assists-a.assists || a.name.localeCompare(b.name));
  let lastPoints = null, rank = 0;
  standings.forEach((x,i)=>{ if (lastPoints !== x.points) rank=i+1; x.rank=rank; lastPoints=x.points; });
  const previous = db.prepare("SELECT data_json FROM snapshots ORDER BY id DESC LIMIT 1").get();
  if (previous) {
    try {
      const old = JSON.parse(previous.data_json);
      const oldMap = new Map(old.standings.map(x=>[x.poolName,x.rank]));
      for (const x of standings) x.movement = (oldMap.has(x.poolName) ? oldMap.get(x.poolName)-x.rank : 0);
    } catch { for (const x of standings) x.movement=0; }
  } else for (const x of standings) x.movement=0;
  return {
    updatedAt:new Date().toISOString(),
    seasonId:config.seasonId,
    scoring:config.scoring,
    standings,
    playerIndex: buildPlayerIndex(standings)
  };
}
function buildPlayerIndex(standings) {
  const m = new Map();
  for (const team of standings) for (const p of team.players) {
    const key = canonicalPlayerKey(p.name,p.team);
    if (!m.has(key)) m.set(key,[]);
    m.get(key).push({owner:team.name, poolName:team.poolName, points:p.points, position:p.position});
  }
  return Object.fromEntries([...m.entries()].map(([k,v])=>[k,v]));
}

async function refresh(reason="manual") {
  const stats = await fetchAllStats();
  const state = buildState(stats);
  const captured = new Date().toISOString();
  state.updatedAt = captured;
  db.prepare("INSERT INTO snapshots(captured_at,data_json) VALUES (?,?)").run(captured, JSON.stringify(state));
  return state;
}

app.get("/api/config", (req,res)=>res.json({leagueName:config.leagueName,seasonId:config.seasonId,updateSchedule:config.updateSchedule,timezone:config.timezone,scoring:config.scoring}));
app.get("/api/standings", (req,res)=>{
  const row=db.prepare("SELECT data_json FROM snapshots ORDER BY id DESC LIMIT 1").get();
  if (!row) return res.json({updatedAt:null,standings:[]});
  res.json(JSON.parse(row.data_json));
});
app.get("/api/history", (req,res)=>{
  const rows=db.prepare("SELECT captured_at,data_json FROM snapshots ORDER BY captured_at ASC").all();
  const history=rows.map(r=>{
    const d=JSON.parse(r.data_json);
    return {capturedAt:r.captured_at, standings:d.standings.map(x=>({poolName:x.poolName,name:x.name,points:x.points,rank:x.rank}))};
  });
  res.json(history);
});
app.post("/api/refresh", async (req,res)=>{
  const token=process.env.REFRESH_TOKEN;
  if (token && req.get("X-Refresh-Token") !== token) return res.status(401).json({error:"Unauthorized"});
  try { res.json(await refresh("manual")); }
  catch(e) { console.error(e); res.status(502).json({error:e.message}); }
});

app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"public/index.html")));

cron.schedule(config.updateSchedule, async ()=>{
  try { await refresh("scheduled"); console.log("Scheduled NHL refresh complete"); }
  catch(e) { console.error("Scheduled NHL refresh failed:",e.message); }
}, { timezone:config.timezone });

app.listen(PORT, async ()=>{
  console.log(`BMO2026 pool tracker listening on ${PORT}`);
  const existing=db.prepare("SELECT id FROM snapshots LIMIT 1").get();
  if (!existing) {
    try { await refresh("startup"); console.log("Initial NHL snapshot saved"); }
    catch(e) { console.error("Initial NHL snapshot unavailable:",e.message); }
  }
});
