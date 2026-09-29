let state={standings:[],history:[]};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function get(url){const r=await fetch(url);if(!r.ok)throw new Error(await r.text());return r.json();}
function fmt(n){return Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});}
function fmtDate(x){return x?new Date(x).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—";}
function movement(m){return m>0?`<span class="up">▲ ${m}</span>`:m<0?`<span class="down">▼ ${Math.abs(m)}</span>`:`<span class="flat">•</span>`;}
function renderStandings(){
 const rows=state.standings;
 $("#participantCount").textContent=rows.length;
 if(!rows.length){$("#standings").innerHTML='<div class="error">No snapshot yet. Click refresh after the server can reach the NHL API.</div>';return;}
 $("#standings").innerHTML=`<table class="standings"><thead><tr><th>Rank</th><th>Pool</th><th>Movement</th><th>Players</th><th style="text-align:right">Points</th></tr></thead><tbody>
 ${rows.map(x=>`<tr data-team="${esc(x.poolName)}"><td class="rank">${x.rank}</td><td><span class="name">${esc(x.name)}</span><span class="sub">${esc(x.fullName||"")}</span></td><td class="move">${movement(x.movement)}</td><td>${x.players.length}</td><td class="points">${fmt(x.points)}</td></tr>`).join("")}
 </tbody></table>`;
 document.querySelectorAll("#standings tbody tr").forEach(tr=>tr.onclick=()=>showTeam(tr.dataset.team));
}
function allPlayers(){
 const map=new Map();
 for(const t of state.standings) for(const p of t.players){
   const k=`${p.name}|${p.team}|${p.position}`;
   if(!map.has(k)) map.set(k,{...p,owners:[]});
   map.get(k).owners.push(t.name);
 }
 return [...map.values()];
}
function renderPlayers(q=""){
 const list=allPlayers().filter(p=>`${p.name} ${p.team}`.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));
 $("#playerResults").innerHTML=list.slice(0,100).map(p=>`<div class="card player-card" data-key="${esc(p.name+"|"+p.team+"|"+p.position)}"><div class="pname">${esc(p.name)}</div><span class="tag">${esc(p.team)}</span><span class="tag">${esc(p.position)}</span><span class="tag">${fmt(p.points)} pts</span><div class="sub">${p.owners.map(esc).join(", ")}</div></div>`).join("")||'<div class="card note">No drafted players match that search.</div>';
 document.querySelectorAll(".player-card").forEach(el=>el.onclick=()=>{const p=allPlayers().find(x=>x.name+"|"+x.team+"|"+x.position===el.dataset.key);if(p)showPlayer(p)});
}
function showTeam(name){
 const t=state.standings.find(x=>x.poolName===name); if(!t)return;
 $("#modalContent").innerHTML=`<h2>${esc(t.name)}</h2><div class="meta">${esc(t.fullName||"")} • Rank ${t.rank} • ${fmt(t.points)} points</div>
 <div class="detail-grid"><div class="metric"><small>Goals</small><b>${fmt(t.goals)}</b></div><div class="metric"><small>Assists</small><b>${fmt(t.assists)}</b></div><div class="metric"><small>Roster</small><b>${t.players.length}</b></div></div>
 <table class="roster"><thead><tr><th>Player</th><th>Pos</th><th>Season stats</th><th>Pool pts</th></tr></thead><tbody>
 ${t.players.map(p=>`<tr><td>${esc(p.name)}<div class="sub">${esc(p.team)}${p.injured?' • injury flag':''}</div></td><td>${esc(p.position)}</td><td><div class="statline">${Object.entries(p.stats).filter(([k])=>["GP","G","A","PTS","W","SO","OTL"].includes(k)).map(([k,v])=>`<span>${k} ${fmt(v)}</span>`).join("")}</div></td><td>${fmt(p.points)}</td></tr>`).join("")}
 </tbody></table>`;
 $("#modal").classList.remove("hidden");
}
function showPlayer(p){
 const owners=p.owners?.length?p.owners:[];
 $("#modalContent").innerHTML=`<h2>${esc(p.name)}</h2><div class="meta">${esc(p.team)} • ${esc(p.position)} • ${p.found===false?"NHL API match pending":""}</div>
 <div class="detail-grid"><div class="metric"><small>Pool points</small><b>${fmt(p.points)}</b></div><div class="metric"><small>Owners</small><b>${owners.length}</b></div><div class="metric"><small>Games</small><b>${fmt(p.stats.GP)}</b></div></div>
 <div class="statline">${Object.entries(p.stats).map(([k,v])=>`<span>${esc(k)} ${fmt(v)}</span>`).join("")}</div>
 <div class="note" style="margin-top:18px"><b>Pool owner:</b> ${owners.map(esc).join(", ")||"—"}</div>`;
 $("#modal").classList.remove("hidden");
}
function renderHistory(){
 const h=state.history;if(!h.length){$("#chart").innerHTML="";$("#historyMeta").textContent="No snapshots yet";$("#chartLegend").innerHTML="";return;}
 $("#historyMeta").textContent=`${h.length} snapshot${h.length===1?"":"s"} • ${fmtDate(h[0].capturedAt)} to ${fmtDate(h[h.length-1].capturedAt)}`;
 const teams=[...new Map(h.flatMap(s=>s.standings).map(x=>[x.poolName,x.name])).entries()].map(([poolName,name])=>({poolName,name}));
 const W=1000,H=460,pad={l:55,r:25,t:20,b:40};
 const max=Math.max(1,...h.flatMap(s=>s.standings.map(x=>x.points)));
 const x=i=>pad.l+(i/(Math.max(1,h.length-1)))*(W-pad.l-pad.r);
 const y=v=>H-pad.b-(v/max)*(H-pad.t-pad.b);
 const grid=[0,.25,.5,.75,1].map(q=>{const yy=y(max*q);return `<line x1="${pad.l}" x2="${W-pad.r}" y1="${yy}" y2="${yy}" stroke="#1d3246"/><text x="${pad.l-8}" y="${yy+4}" fill="#63798e" font-size="10" text-anchor="end">${Math.round(max*q)}</text>`}).join("");
 const colors=["#6fa8dc","#e5a55d","#77c89b","#c58ad9","#e77d8b","#8ec6c8","#d7cf78","#a9a9e8","#d68bb1","#7cc4e8","#b8c76a","#d3a177","#82a4d8","#c18e8e","#84c9a8","#d0a7d7","#9ebcce","#d6b27d","#a2b6d0"];
 let paths="";
 teams.forEach((t,ti)=>{
   const vals=h.map(s=>{const row=s.standings.find(x=>x.poolName===t.poolName);return row?.points||0;});
   const d=vals.map((v,i)=>(i?"L":"M")+x(i)+" "+y(v)).join(" ");
   paths+=`<path d="${d}" fill="none" stroke="${colors[ti%colors.length]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
 });
 $("#chart").innerHTML=grid+paths;
 $("#chartLegend").innerHTML=teams.map((t,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>${esc(t.name)}</span>`).join("");
}
async function load(){
 try{
  const [s,h]=await Promise.all([get("/api/standings"),get("/api/history")]);
  state={...s,history:h};
  $("#lastUpdated").textContent=s.updatedAt?`Updated ${fmtDate(s.updatedAt)}`:"No live snapshot";
  renderStandings();renderPlayers($("#playerSearch").value);renderHistory();
 }catch(e){console.error(e);$("#standings").innerHTML=`<div class="error">Could not load tracker data.<br>${esc(e.message)}</div>`}
}
async function refresh(){
 const b=$("#refresh");b.classList.add("busy");b.disabled=true;
 try{await fetch("/api/refresh",{method:"POST",headers:{"Content-Type":"application/json"}});await load();}
 catch(e){alert("Refresh failed. Check the server log / NHL API availability.");}
 finally{b.classList.remove("busy");b.disabled=false;}
}
document.querySelectorAll(".nav").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));btn.classList.add("active");document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$("#view-"+btn.dataset.view).classList.add("active");});
$("#refresh").onclick=refresh;$("#playerSearch").oninput=e=>renderPlayers(e.target.value);
$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");$("#modal").onclick=e=>{if(e.target.id==="modal")$("#modal").classList.add("hidden")};
load();setInterval(load,15*60*1000);
