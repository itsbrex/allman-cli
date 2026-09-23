// Embedded assets keep the viewer available in standalone compiled CLI builds.
export const activityScript = String.raw`
const $ = id => document.getElementById(id);
let source, snapshot = null, pending = null, paused = false, filter = 'all';
const labels = {running:'Running',finished:'Finished',failed:'Failed',interrupted:'Interrupted',quota:'Quota reached',processing:'Started',found:'Found',saved:'Saved',skipped:'Skipped',phase:'Stage'};
const quantity = (n, singular, plural = singular+'s') => n.toLocaleString()+' '+(n===1?singular:plural);
const time = value => new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const text = (id, value) => { $(id).textContent = value; };
function element(tag, className, value) { const el = document.createElement(tag); el.className = className; if (value !== undefined) el.textContent = value; return el; }
function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase(); }
function badge(status) { return element('span','badge '+status,labels[status] || status); }
function connection(value, kind) { text('connection-label',value); $('connection').className='connection '+kind; }
function connect() {
  if (source) source.close();
  connection('Connecting','connecting');
  const selected = $('run-select').value;
  source = new EventSource('/api/events'+(selected ? '?run='+encodeURIComponent(selected) : ''));
  source.onopen = () => connection('Connected','connected');
  source.onerror = () => { connection('Reconnecting','offline'); text('feed-note','Connection lost. Displaying last received activity; processing status may have changed.'); };
  source.addEventListener('unavailable', () => { connection('Feed unavailable','offline'); text('feed-note','Activity records are temporarily unavailable. Retrying automatically.'); });
  source.onmessage = event => {
    pending = JSON.parse(event.data);
    if (paused) { text('pause-view','Resume view · updates waiting'); return; }
    snapshot = pending; render();
  };
}
function render() {
  if (!snapshot) return;
  renderMetrics();
  const run = snapshot.run;
  text('profile-name',snapshot.label || 'Allman');
  const selected = $('run-select').value;
  $('run-select').replaceChildren(new Option('Follow latest run',''));
  for (const r of snapshot.runs) $('run-select').add(new Option(r.command+' · '+new Date(r.startedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · '+labels[r.status],r.id));
  $('run-select').value = selected;
  const state = run ? run.status : 'idle';
  text('run-state',run ? labels[state] : 'Ready');
  $('run-state').className='badge '+state;
  text('run-command',run ? 'allman '+run.command : 'No recorded runs yet');
  text('stage',run ? run.stage : 'Waiting for a command');
  text('stage-caption', run ? (state==='quota' ? 'Capacity returns '+(run.nextFreeAt ? new Date(run.nextFreeAt).toLocaleString() : 'after the quota window') : state==='running' ? 'Updates come directly from the running CLI.' : 'Recorded run. New activity appears when another command starts.') : 'Start a connection import, enrichment, or sync. This view will follow it here.');
  const last = run?.events.slice().reverse().find(e => e.person);
  const person = run?.current || last?.person;
  text('person-caption',run?.current ? 'PROCESSING NOW' : person ? (person.kind==='company' ? 'LATEST COMPANY' : 'LATEST PERSON') : 'CURRENT PERSON');
  text('person-name',person?.name || 'Ready when you are');
  text('person-detail',person ? [person.title,person.company,person.location].filter(Boolean).join(' · ') || 'Identity from the current processing run' : 'Real people appear as Allman processes them.');
  text('avatar',person ? initials(person.name) : 'a');
  text('person-id',person ? person.slug || person.id : 'No processing job started by this viewer');
  const counts = run?.counts || {found:0,saved:0,skipped:0,failed:0};
  for (const key of ['found','saved','skipped','failed']) text('count-'+key,counts[key].toLocaleString());
  const known = run && run.total !== null && run.total > 0;
  text('progress-label', known ? Math.min(run.phaseDone,run.total).toLocaleString()+' / '+run.total.toLocaleString()+' in this stage' : run ? 'Live event counts · no estimated total' : 'Waiting for activity');
  $('progress-fill').style.width = known ? Math.min(100,100*run.phaseDone/run.total)+'%' : '0%';
  $('progress-track').className = 'progress-track'+(!known && state==='running' ? ' indeterminate' : '');
  renderRows(); renderRuns(); renderElapsed();
}
function renderMetrics() {
  const m=snapshot.metrics;
  $('daily-panel').hidden=!m;
  if(!m)return;
  const number=value=>value.toLocaleString();
  text('today-date',m.date+' · '+m.timezone);
  text('today-people',number(m.today.people));
  text('today-companies',number(m.today.companies));
  text('today-enrich',number(m.today.enrichmentAttempts));
  text('today-company-attempts',number(m.today.companyAttempts));
  text('today-people-note',m.today.unlinkedSalesnav ? '+'+number(m.today.unlinkedSalesnav)+' Sales Navigator identities awaiting match' : 'Known identities, counted once');
  text('today-companies-note',number(m.inventory.referencedCompanies)+' employer IDs referenced in store');
  text('today-enrich-note',number(m.today.deep)+' distinct deep profiles saved today');
  text('today-work',quantity(m.today.saves,'recorded save')+' · '+quantity(m.today.repeatSaves,'repeat save')+' · '+quantity(m.today.skipped,'skip')+' · '+quantity(m.today.failed,'failed outcome'));
  text('today-requests',m.coverage.requestsSince ? quantity(m.today.requests,'HTTP read')+' recorded ('+number(m.today.salesnavRequests)+' Sales Navigator) · '+quantity(m.today.requestFailures,'failed response/network error') : 'HTTP request tracking starts with your next run; earlier request totals unavailable.');
  text('store-counts','Store: '+number(m.inventory.people)+' known people · '+number(m.inventory.firstDegree)+' first-degree records · '+number(m.inventory.salesnav)+' Sales Navigator records · '+number(m.inventory.companies)+' resolved companies');
  const seat=m.seat==='salesnav-credential' ? 'Sales Navigator credential stored' : m.seat==='no-salesnav-credential' ? 'No Sales Navigator credential stored' : 'Seat unknown: cookies unavailable';
  text('quota-seat',seat+' · subscription not checked live');
  const list=$('quota-list');list.replaceChildren();
  if(!m.quotas.length)list.append(element('p','provider-warning','Quota state unavailable. Check unreadable records before relying on remaining capacity.'));
  for(const q of m.quotas) {
    const card=element('div','quota-card '+q.level);
    const title=element('div','quota-heading');
    title.append(element('strong','',q.kind==='enrichment'?'Profile enrichment':'Company lookups'),element('span','badge '+(q.level==='ok'?'saved':'quota'),q.level==='blocked'?'Allman limit reached':q.level==='warning'?'Approaching limit':'Within local limit'));
    const meter=element('div','quota-track'); const fill=element('div','quota-fill');fill.style.width=Math.min(100,q.max>0?100*q.used/q.max:100)+'%';meter.append(fill);
    card.append(title,element('p','quota-value',number(q.used)+' / '+number(q.max)+' used · '+number(q.remaining)+' remaining'),meter,element('p','muted',q.label+' rolling window · '+(q.source==='override'?'Account override':'Allman default')+(q.nextFreeAt ? ' · next slot '+new Date(q.nextFreeAt).toLocaleString() : '')));
    list.append(card);
  }
  const caveats=['Today means local calendar day; quota bars use rolling windows.','Unique totals use stored timestamps and observed results. Re-fetches count again as attempts, not new people.'];
  if(m.coverage.activitySince)caveats.push('Run events recorded since '+new Date(m.coverage.activitySince).toLocaleString()+'.');
  if(m.coverage.requestsSince)caveats.push('HTTP reads tracked since '+new Date(m.coverage.requestsSince).toLocaleString()+'.');
  if(m.coverage.retainedQuotaAttempts)caveats.push(number(m.coverage.retainedQuotaAttempts)+(m.coverage.retainedQuotaAttempts===1?' attempt':' attempts')+' recovered from retained quota history.');
  caveats.push('Older/pruned history, browser traffic and realtime stream traffic are unavailable; daily totals may be incomplete. A deep fetch can make several HTTP reads, including retries. Skips use no quota; failed attempts do.');
  if(m.coverage.identityConflicts)caveats.push(number(m.coverage.identityConflicts)+' identity conflicts kept separate.');
  if(m.coverage.unreadable)caveats.push(number(m.coverage.unreadable)+' unreadable records: totals incomplete.');
  text('metrics-coverage',caveats.join(' '));
  $('provider-warning').hidden=m.today.rateLimited===0;
  text('provider-warning',quantity(m.today.rateLimited,'HTTP 429 response')+' recorded today. LinkedIn throttled these requests; a local allowance does not override that response.');
}
function renderRows() {
  const run = snapshot?.run;
  const query = $('search').value.toLowerCase().trim();
  const people = (run?.events || []).filter(e => e.person && e.status !== 'processing');
  const rows = people.filter(e => (filter==='all' || (filter==='issues' ? e.status==='failed' : e.status===filter)) && (!query || [e.person.name,e.person.company,e.person.title,e.person.slug,e.person.id,e.stage].join(' ').toLowerCase().includes(query))).reverse();
  const list = $('feed'); list.replaceChildren();
  for (const e of rows) {
    const row = element('tr','');
    const who = element('td','who'); const wrap = element('div','person-cell');
    wrap.append(element('span','mini-avatar',initials(e.person.name)));
    const detail = element('div','person-copy'); detail.append(element('strong','',e.person.name),element('span','muted',[e.person.title,e.person.company].filter(Boolean).join(' · ') || e.person.slug || e.person.id));
    wrap.append(detail); who.append(wrap); row.append(who);
    const stage = element('td','step-cell',e.stage); if(e.note) stage.append(element('span','row-note',e.note)); row.append(stage);
    const outcome = element('td',''); outcome.append(badge(e.status)); row.append(outcome,element('td','time',time(e.at))); list.append(row);
  }
  $('empty-feed').hidden = rows.length > 0;
  text('empty-title',people.length ? 'No matching activity' : 'Your next run starts here');
  text('empty-detail',people.length ? 'Try another name or outcome filter.' : 'This is a live observer. It never starts an import or opens a LinkedIn session.');
  text('row-count',rows.length.toLocaleString()+(rows.length===1?' event':' events'));
  text('feed-note',paused ? 'View paused. CLI processing continues.' : 'Latest 200 events per run. Full event journal stays on this machine. Counts include each processing step.');
}
function renderRuns() {
  const list = $('recent-runs'); list.replaceChildren();
  for (const run of (snapshot?.runs || []).slice(0,6)) {
    const button=element('button','run-item'+(run.id===snapshot.run?.id ? ' selected' : ''));
    button.type='button'; const top=element('span','run-item-top'); top.append(element('strong','',run.command),badge(run.status));
    button.append(top,element('span','muted',new Date(run.startedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})));
    button.addEventListener('click',()=>{$('run-select').value=run.id; connect();}); list.append(button);
  }
  if (!snapshot?.runs.length) list.append(element('p','muted','Completed and interrupted runs will stay available here.'));
}
function renderElapsed() {
  const run=snapshot?.run; if(!run){text('elapsed','—');return;}
  const end=run.finishedAt ? Date.parse(run.finishedAt) : run.status==='running' ? Date.now() : Date.parse(run.updatedAt);
  const seconds=Math.max(0,Math.floor((end-Date.parse(run.startedAt))/1000));
  text('elapsed',Math.floor(seconds/60)+'m '+String(seconds%60).padStart(2,'0')+'s');
  if(run.status==='running' && Date.now()-Date.parse(run.updatedAt)>30000) text('stage-caption','No recent worker heartbeat. Current processing status is uncertain.');
}
$('run-select').addEventListener('change',connect);
$('search').addEventListener('input',renderRows);
$('pause-view').addEventListener('click',()=>{paused=!paused; text('pause-view',paused?'Resume view':'Pause view'); $('pause-view').setAttribute('aria-pressed',String(paused)); if(!paused && pending){snapshot=pending;render();}else renderRows();});
for(const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click',()=>{filter=button.dataset.filter; for(const b of document.querySelectorAll('[data-filter]')) {b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));} renderRows();});
setInterval(renderElapsed,1000); connect();
`;

export const activityHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allman · Live activity</title>
<style>
:root{color-scheme:light;--ink:#182827;--muted:#63736e;--line:#dce4de;--paper:#f5f7f2;--green:#247456;--accent:#ccea77}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button,select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #448f70;outline-offset:3px}button{color:inherit}header{height:76px;background:#142d28;color:#f7faf1;display:flex;align-items:center;justify-content:space-between;padding:0 38px;gap:20px}.brand{display:flex;align-items:center;gap:12px;font-size:19px;font-weight:650;letter-spacing:-.5px}.mark{display:grid;place-items:center;width:32px;height:32px;border:1px solid #a9c17a;border-radius:9px;font:bold 25px Georgia,serif;color:var(--accent)}.header-right{display:flex;align-items:center;gap:20px}.connection{display:flex;align-items:center;gap:8px;color:#cad9d2;font-size:12px}.connection:before{content:"";width:7px;height:7px;border-radius:50%;background:#9eaaa5}.connection.connected:before{background:var(--accent)}.connection.offline:before{background:#ffc589}.profile{font-size:12px;border-left:1px solid #3b4c45;padding-left:20px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shell{max-width:1540px;margin:0 auto;padding:36px 38px 32px}.eyebrow{font-size:10px;letter-spacing:1.8px;font-weight:700;color:var(--muted);margin:0 0 10px}.title-row{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:28px}h1{font-size:34px;line-height:1.12;letter-spacing:-1.25px;font-weight:620;margin:0 0 10px}h2{font-size:15px;font-weight:650;letter-spacing:-.25px;margin:0}.subtitle{color:var(--muted);margin:0;line-height:1.6}.view-controls{display:flex;align-items:center;gap:9px}select,.quiet-button{border:1px solid #d4ded5;border-radius:8px;background:#fff;height:38px;padding:0 12px;font-size:12px}select{max-width:295px}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 262px;gap:22px}.main-column{min-width:0}.hero{border:1px solid var(--line);background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 3px #142d2803}.hero-top{display:flex;justify-content:space-between;gap:20px;padding:20px 24px 0}.run-label{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.badge{display:inline-flex;align-items:center;white-space:nowrap;font-size:10px;font-weight:600;padding:4px 8px;border-radius:5px;line-height:1.3;background:#eff2ed;color:#647066}.badge.running,.badge.processing{background:#e9f1c9;color:#40571c}.badge.saved,.badge.finished{background:#e8f3ec;color:#286c4e}.badge.found{background:#edf1f6;color:#53657c}.badge.failed,.badge.interrupted{background:#f9e9e2;color:#a05c3b}.badge.quota,.badge.skipped{background:#f4efdf;color:#89702e}.person-focus{display:flex;align-items:center;gap:19px;padding:24px}.avatar{flex:none;width:66px;height:66px;border-radius:18px;background:#eff4e6;border:1px solid #e0e9d2;display:grid;place-items:center;font-size:22px;font-weight:550;color:#4c634a}.person-meta{min-width:0}.person-caption{font-size:9px;font-weight:700;letter-spacing:1.6px;color:var(--green);margin-bottom:7px}.person-name{font-size:25px;font-weight:620;letter-spacing:-.65px;overflow-wrap:anywhere}.person-detail{color:var(--muted);font-size:12px;margin-top:7px;line-height:1.5}.person-id{color:#859088;font-size:10px;margin-top:7px;overflow-wrap:anywhere}.phase{background:#fafbf8;border-top:1px solid #edf0e9;padding:17px 24px 21px}.phase-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.phase-title{font-weight:600;font-size:12px}.elapsed{font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted)}.phase-caption{font-size:11px;color:var(--muted);margin:6px 0 17px;line-height:1.5}.progress-track{height:4px;background:#e7ede3;overflow:hidden;border-radius:3px}.progress-fill{height:100%;background:#6f9b4a;transition:width .3s}.progress-track.indeterminate .progress-fill{width:24%!important;animation:travel 2s ease-in-out infinite}.progress-label{font-size:10px;color:#7b877e;margin-top:9px}@keyframes travel{0%{transform:translateX(-100%)}100%{transform:translateX(520%)}}.stats{display:grid;grid-template-columns:repeat(4,1fr);margin:21px 0 28px;padding:0 4px}.stat{padding:1px 18px;border-left:1px solid var(--line)}.stat:first-child{padding-left:0;border:0}.stat-label{font-size:11px;color:var(--muted)}.stat-value{font-size:29px;letter-spacing:-1px;font-weight:550;margin-top:6px;font-variant-numeric:tabular-nums}.stat.saved .stat-value{color:#247456}.stat.failed .stat-value{color:#a26743}.feed-panel{border:1px solid var(--line);background:#fff;border-radius:12px;overflow:hidden}.feed-heading{display:flex;justify-content:space-between;align-items:center;padding:20px 21px 16px}.muted{color:var(--muted);font-size:11px;line-height:1.5}.feed-toolbar{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:0 20px 18px}.filters{display:flex;gap:3px}.filter{background:none;border:0;border-radius:6px;padding:7px 10px;font-size:11px;color:var(--muted)}.filter.active{background:#eaf0e4;color:#35583d;font-weight:600}.search{border:1px solid var(--line);border-radius:7px;background:#fcfdfb;padding:8px 10px;font-size:11px;width:210px;color:var(--ink)}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;table-layout:fixed}th{font-size:9px;text-transform:uppercase;letter-spacing:1.1px;color:#7a877d;padding:11px 20px;background:#fafbf8;font-weight:600;border-top:1px solid #e8ece5;border-bottom:1px solid #e8ece5}th:first-child{width:42%}th:nth-child(2){width:27%}th:nth-child(3){width:15%}th:nth-child(4){width:16%}td{padding:14px 20px;border-bottom:1px solid #eef1eb;vertical-align:middle;font-size:11px}.person-cell{display:flex;align-items:center;gap:10px}.mini-avatar{width:31px;height:31px;flex:none;border-radius:9px;background:#f0f3eb;display:grid;place-items:center;color:#73866a;font-size:10px;font-weight:600}.person-copy{min-width:0}.person-copy strong{display:block;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.person-copy .muted{display:block;font-size:10px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.step-cell{color:#576a60;line-height:1.5}.row-note{display:block;color:#8b7866;font-size:10px;margin-top:4px}.time{font:10px ui-monospace,SFMono-Regular,monospace;color:#79867b;white-space:nowrap}.empty{padding:43px 24px 50px;text-align:center}.empty[hidden]{display:none}.empty-glyph{width:39px;height:39px;display:grid;place-items:center;border:1px solid var(--line);border-radius:11px;margin:0 auto 15px;color:#7d9170;font-size:20px}.empty strong{font-size:13px}.empty p{color:var(--muted);font-size:12px;line-height:1.7;margin:9px auto 0;max-width:370px}.feed-foot{border-top:1px solid #eef1eb;padding:12px 20px;color:#7c897e;font-size:10px;line-height:1.6}.aside{padding:7px 0}.aside h2{margin-bottom:17px}.run-item{width:100%;text-align:left;background:transparent;border:1px solid transparent;border-bottom-color:#e1e7dc;padding:15px 10px;border-radius:8px}.run-item.selected{background:#edf2e6;border-color:#dbe4d2}.run-item-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.run-item-top strong{font-size:12px;font-weight:600}.notes{border-top:1px solid #dce4d5;margin-top:29px;padding:23px 10px;color:#74816f;font-size:11px;line-height:1.8}.notes strong{color:#4c664f;font-size:11px}.notes p{margin:7px 0 0}.footer{display:flex;justify-content:space-between;gap:15px;margin-top:26px;color:#82907e;font-size:10px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(min-width:1700px){.shell{padding-top:48px}.hero{margin-top:4px}}@media(max-width:1050px){.workspace{grid-template-columns:minmax(0,1fr)}.aside{display:none}header{padding:0 24px}.shell{padding:28px 24px}.title-row{align-items:start}.view-controls{flex-direction:column;align-items:end}}@media(max-width:640px){header{height:65px;padding:0 17px}.header-right{gap:12px}.profile{max-width:128px;padding-left:12px;font-size:10px}.brand{font-size:17px}.shell{padding:24px 15px}.title-row{display:block;margin-bottom:22px}h1{font-size:27px}.subtitle{font-size:12px}.view-controls{flex-direction:row;justify-content:space-between;margin-top:19px}select{max-width:220px;flex:1;min-width:0}.person-focus{padding:21px 17px;gap:13px}.person-name{font-size:21px}.avatar{width:53px;height:53px;border-radius:14px;font-size:18px}.hero-top{padding:17px 17px 0}.phase{padding:16px 17px}.phase-caption{font-size:10px}.stats{margin:22px 0}.stat{padding:1px 12px}.stat-value{font-size:25px}.feed-heading{padding:18px 15px 14px}.feed-toolbar{padding:0 15px 15px;display:block}.search{width:100%;margin-top:12px}.filters{justify-content:space-between}.filter{flex:1;padding:7px}.table-scroll table{min-width:620px}td,th{padding-left:15px;padding-right:15px}.footer{display:block;line-height:1.8}.footer span{display:block}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
.daily-panel{border:1px solid var(--line);border-radius:14px;background:#fff;padding:23px 24px;margin-bottom:26px}.daily-panel[hidden]{display:none}.daily-heading,.quota-heading{display:flex;justify-content:space-between;align-items:center;gap:14px}.daily-heading h2{font-size:17px}.daily-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;margin:23px 0 18px}.daily-stat{border-left:1px solid var(--line);padding-left:20px}.daily-stat:first-child{border:0;padding-left:0}.daily-label{color:var(--muted);font-size:11px}.daily-value{font-size:33px;letter-spacing:-1px;margin:6px 0;font-variant-numeric:tabular-nums}.daily-detail{font-size:10px;line-height:1.5;color:var(--muted)}.daily-work{font-size:11px;line-height:1.9;color:#52675c;margin:0}.quota-list{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:13px}.quota-card{background:#f8faf5;border:1px solid #e4eade;border-radius:9px;padding:14px 16px}.quota-card.warning,.quota-card.blocked{background:#fff8e9;border-color:#e6cea1}.quota-heading strong{font-size:11px}.quota-value{font-size:12px;font-variant-numeric:tabular-nums;margin:12px 0 10px}.quota-track{height:4px;border-radius:3px;background:#e4eade;overflow:hidden}.quota-fill{height:100%;background:#6f9b4a}.warning .quota-fill,.blocked .quota-fill{background:#b07a26}.quota-card .muted{margin:10px 0 0;font-size:10px}.quota-intro{margin-top:19px;display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:10px}.quota-disclaimer{font-size:10px;color:var(--muted);line-height:1.7;margin:13px 0 0}.quota-disclaimer a{color:var(--green)}.coverage{border-top:1px solid var(--line);margin-top:17px;padding-top:12px;font-size:10px;color:var(--muted);line-height:1.8}.coverage summary{cursor:pointer;color:#3d5a48}.coverage p{max-width:1050px}.provider-warning{background:#fff0e3;border:1px solid #e9ccad;color:#85532b;border-radius:7px;font-size:11px;padding:12px;margin-top:13px;line-height:1.6}@media(max-width:740px){.daily-panel{padding:19px 17px}.daily-grid{grid-template-columns:1fr 1fr;gap:20px}.daily-stat:nth-child(3){border:0;padding-left:0}.daily-heading,.quota-intro{align-items:start;flex-direction:column;gap:7px}.quota-list{grid-template-columns:1fr}.daily-value{font-size:29px}}
</style></head><body>
<header><div class="brand"><span class="mark" aria-hidden="true">a</span>allman <span style="font-size:12px;font-weight:400;color:#9faf9f;margin-left:12px">Activity</span></div><div class="header-right"><div id="connection" class="connection"><span id="connection-label" role="status">Connecting</span></div><div class="profile" id="profile-name">Local workspace</div></div></header>
<main class="shell"><div class="title-row"><div><p class="eyebrow">WORKSPACE / ACTIVITY</p><h1>Live contact processing</h1><p class="subtitle">People, progress and outcomes. As they happen.</p></div><div class="view-controls"><label class="sr-only" for="run-select">Select processing run</label><select id="run-select"><option value="">Follow latest run</option></select><button type="button" id="pause-view" class="quiet-button" aria-pressed="false">Pause view</button></div></div>
<section class="daily-panel" id="daily-panel" aria-label="Today's totals and limits" hidden>
<div class="daily-heading"><div><h2>Today across all runs</h2><p class="muted">Observed totals · historical request coverage incomplete</p></div><span class="muted" id="today-date"></span></div>
<div class="daily-grid">
<div class="daily-stat"><div class="daily-label">Unique people observed</div><div class="daily-value" id="today-people">—</div><div class="daily-detail" id="today-people-note"></div></div>
<div class="daily-stat"><div class="daily-label">Companies resolved</div><div class="daily-value" id="today-companies">—</div><div class="daily-detail" id="today-companies-note"></div></div>
<div class="daily-stat"><div class="daily-label">Profile fetch attempts</div><div class="daily-value" id="today-enrich">—</div><div class="daily-detail" id="today-enrich-note"></div></div>
<div class="daily-stat"><div class="daily-label">Company lookup attempts</div><div class="daily-value" id="today-company-attempts">—</div><div class="daily-detail">Quota charged, including failed attempts</div></div>
</div><p class="daily-work" id="today-work"></p><p class="daily-work" id="today-requests"></p>
<div class="quota-intro"><strong>Enforced by Allman · warning at 80%</strong><span id="quota-seat"></span></div><div class="quota-list" id="quota-list"></div>
<p class="quota-disclaimer">Local guardrails, not guaranteed LinkedIn allowances. Search and connection-list reads have no Allman volume quota; request totals track them separately. <a href="https://www.linkedin.com/help/linkedin/answer/a569331/data-security-limits-on-profile-views?lang=en" target="_blank" rel="noreferrer">LinkedIn does not publish exact remaining profile views.</a></p>
<p class="provider-warning" id="provider-warning" role="status" hidden></p><details class="coverage"><summary>Counting method, coverage and store totals</summary><p id="store-counts"></p><p id="metrics-coverage"></p></details>
</section>
<div class="workspace"><section class="main-column" aria-label="Processing activity"><div class="hero"><div class="hero-top"><span class="run-label" id="run-command">No recorded runs yet</span><span id="run-state" class="badge">Ready</span></div><div class="person-focus"><div class="avatar" id="avatar" aria-hidden="true">a</div><div class="person-meta"><div class="person-caption" id="person-caption">CURRENT PERSON</div><div class="person-name" id="person-name">Ready when you are</div><div class="person-detail" id="person-detail">Real people appear as Allman processes them.</div><div class="person-id" id="person-id">No processing job started by this viewer</div></div></div><div class="phase"><div class="phase-heading"><span class="phase-title" id="stage">Waiting for a command</span><span class="elapsed" id="elapsed">—</span></div><p class="phase-caption" id="stage-caption">Start a connection import, enrichment, or sync.</p><div class="progress-track" id="progress-track"><div class="progress-fill" id="progress-fill"></div></div><div class="progress-label" id="progress-label">Waiting for activity</div></div></div>
<div class="stats" aria-label="Run totals"><div class="stat"><div class="stat-label">Found</div><div class="stat-value" id="count-found">0</div></div><div class="stat saved"><div class="stat-label">Saved</div><div class="stat-value" id="count-saved">0</div></div><div class="stat"><div class="stat-label">Skipped</div><div class="stat-value" id="count-skipped">0</div></div><div class="stat failed"><div class="stat-label">Failed</div><div class="stat-value" id="count-failed">0</div></div></div>
<section class="feed-panel" aria-label="Contact event feed"><div class="feed-heading"><h2>Processing stream</h2><span class="muted" id="row-count">0 events</span></div><div class="feed-toolbar"><div class="filters" role="group" aria-label="Filter event outcomes"><button class="filter active" data-filter="all" aria-pressed="true">All activity</button><button class="filter" data-filter="saved" aria-pressed="false">Saved</button><button class="filter" data-filter="skipped" aria-pressed="false">Skipped</button><button class="filter" data-filter="issues" aria-pressed="false">Issues</button></div><label class="sr-only" for="search">Search people or companies</label><input id="search" class="search" type="search" placeholder="Search people or companies…"></div><div class="table-scroll"><table><thead><tr><th>Person / company</th><th>Step</th><th>Outcome</th><th>Time</th></tr></thead><tbody id="feed"></tbody></table></div><div class="empty" id="empty-feed"><div class="empty-glyph" aria-hidden="true">↗</div><strong id="empty-title">Your next run starts here</strong><p id="empty-detail">This is a live observer. It never starts an import or opens a LinkedIn session.</p></div><div class="feed-foot" id="feed-note">Latest 200 events per run. Full event journal stays on this machine.</div></section></section>
<aside class="aside"><h2>Recent runs</h2><div id="recent-runs"><p class="muted">Completed and interrupted runs will stay available here.</p></div><div class="notes"><strong>Local processing history</strong><p>This view follows CLI activity. Pausing the view only pauses its display.</p><p>Account selection, Shield protection and processing quotas stay with Allman.</p></div></aside></div><footer class="footer"><span>Local workspace · private activity history</span><span>Observer only · no messages or invitations sent</span></footer></main>
<script>${activityScript}</script></body></html>`;
