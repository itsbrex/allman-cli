import { activityStyles } from "./design.js";
import { activityTableScript } from "./table.js";
import { activityTableControllerScript } from "./table-view.js";

// Embedded assets keep the viewer available in standalone compiled CLI builds.
export const activityScript =
  activityTableScript +
  String.raw`
const $ = id => document.getElementById(id);
let source, snapshot = null, pending = null, paused = false;
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
  source = new EventSource('/api/events'+(selected ? '?run='+encodeURIComponent(selected)+'&view='+encodeURIComponent(snapshot?.viewKey || '') : ''));
  source.onopen = () => connection('Connected','connected');
  source.onerror = () => { connection('Reconnecting','offline'); text('feed-note','Connection lost. Displaying last received activity; processing status may have changed.'); };
  source.addEventListener('unavailable', () => { connection('Feed unavailable','offline'); text('feed-note','Activity records are temporarily unavailable. Retrying automatically.'); });
  source.onmessage = event => {
    pending = JSON.parse(event.data);
    if (snapshot && pending.viewKey !== snapshot.viewKey) {
      source.close();
      document.querySelector('main').replaceChildren();
      text('profile-name','Switching profile…');
      location.reload();
      return;
    }
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
  syncTable(run); renderRuns(); renderElapsed();
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
` +
  activityTableControllerScript +
  `
$('run-select').addEventListener('change',connect);
$('pause-view').addEventListener('click',()=>{
  paused=!paused; text('pause-view',paused?'Resume view':'Pause view');
  $('pause-view').setAttribute('aria-pressed',String(paused));
  if(!paused && pending){snapshot=pending;render();}
  renderFeedNote();
});
setInterval(renderElapsed,1000); connect();
`;

export const activityHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Allman · Live activity</title>
<style>${activityStyles}</style>
</head>
<body>
<div class="wrap">
<header class="masthead">
  <div class="brand"><span class="brand-mark" aria-hidden="true">a</span> allman <span class="kicker">/ Activity</span></div>
  <div class="header-right"><div class="profile" id="profile-name">Local workspace</div><div id="connection" class="connection"><span id="connection-label" role="status">Connecting</span></div></div>
</header>
<div class="page-heading">
  <p class="kicker">Relationship workspace · Field notes</p>
  <h1 aria-label="Live contact processing">Live contact <em>processing.</em></h1>
  <p class="lede">Your network, taking shape. Follow each person, company, and step as it happens.</p>
</div>
</div>
<div class="controls"><div class="wrap controls-inner">
  <nav class="section-nav" aria-label="Dashboard sections">
    <a class="nav-link" href="#daily-panel"><span>01</span><span class="nav-label">Today</span></a>
    <a class="nav-link" href="#current-run"><span>02</span><span class="nav-label">Current run</span></a>
    <a class="nav-link" href="#events"><span>03</span><span class="nav-label">Event stream</span></a>
  </nav>
  <div class="view-controls"><label class="sr-only" for="run-select">Select processing run</label><select id="run-select"><option value="">Follow latest run</option></select><button type="button" id="pause-view" class="button" aria-pressed="false">Pause view</button></div>
</div></div>
<main class="wrap content">
<section class="section" id="daily-panel" aria-label="Today's totals and limits" hidden>
  <div class="section-heading"><div class="section-title"><span class="section-number">01</span><h2>Today across all runs</h2></div><span class="date-label" id="today-date"></span></div>
  <div class="daily-grid">
    <div class="card daily-stat"><div class="daily-label">Unique people observed</div><div class="daily-value" id="today-people">—</div><div class="daily-detail" id="today-people-note"></div></div>
    <div class="card daily-stat"><div class="daily-label">Companies resolved</div><div class="daily-value" id="today-companies">—</div><div class="daily-detail" id="today-companies-note"></div></div>
    <div class="card daily-stat"><div class="daily-label">Profile fetch attempts</div><div class="daily-value" id="today-enrich">—</div><div class="daily-detail" id="today-enrich-note"></div></div>
    <div class="card daily-stat"><div class="daily-label">Company lookup attempts</div><div class="daily-value" id="today-company-attempts">—</div><div class="daily-detail">Quota charged, including failed attempts</div></div>
  </div>
  <div class="daily-ledger"><p class="daily-work" id="today-work"></p><p class="daily-work" id="today-requests"></p></div>
  <div class="quota-zone">
    <div class="quota-intro"><strong>Local capacity · warning at 80%</strong><span id="quota-seat"></span></div>
    <div class="quota-list" id="quota-list"></div>
    <p class="quota-disclaimer">Enforced by Allman; not guaranteed LinkedIn allowances. Search and connection-list reads have no Allman volume quota; request totals track them separately. <a href="https://www.linkedin.com/help/linkedin/answer/a569331/data-security-limits-on-profile-views?lang=en" target="_blank" rel="noreferrer">About LinkedIn profile-view limits ↗</a></p>
  </div>
  <p class="provider-warning" id="provider-warning" role="status" hidden></p>
  <details class="coverage"><summary>Counting method, coverage and store totals</summary><p id="store-counts"></p><p id="metrics-coverage"></p></details>
</section>
<section class="section" id="current-run" aria-label="Processing activity">
  <div class="section-heading"><div class="section-title"><span class="section-number">02</span><h2>Current run</h2></div><span class="date-label">LIVE JOURNAL</span></div>
  <div class="run-layout">
    <div class="card hero">
      <div class="hero-top"><span class="run-label" id="run-command">No recorded runs yet</span><span id="run-state" class="badge">Ready</span></div>
      <div class="person-focus"><div class="avatar" id="avatar" aria-hidden="true">a</div><div class="person-meta"><div class="person-caption" id="person-caption">CURRENT PERSON</div><div class="person-name" id="person-name">Ready when you are</div><div class="person-detail" id="person-detail">Real people appear as Allman processes them.</div><div class="person-id" id="person-id">No processing job started by this viewer</div></div></div>
      <div class="phase"><div class="phase-heading"><span class="phase-title" id="stage">Waiting for a command</span><span class="elapsed" id="elapsed">—</span></div><p class="phase-caption" id="stage-caption">Start a connection import, enrichment, or sync.</p><div class="progress-track" id="progress-track"><div class="progress-fill" id="progress-fill"></div></div><div class="progress-label" id="progress-label">Waiting for activity</div></div>
      <div class="run-stats" aria-label="Run totals"><div class="run-stat"><div class="stat-label">Found</div><div class="stat-value" id="count-found">0</div></div><div class="run-stat saved"><div class="stat-label">Saved</div><div class="stat-value" id="count-saved">0</div></div><div class="run-stat"><div class="stat-label">Skipped</div><div class="stat-value" id="count-skipped">0</div></div><div class="run-stat failed"><div class="stat-label">Failed</div><div class="stat-value" id="count-failed">0</div></div></div>
    </div>
    <aside class="card aside" aria-label="Recent processing runs"><h3>Recent runs</h3><div id="recent-runs"><p class="muted">Completed and interrupted runs will stay available here.</p></div><p class="aside-note">Private, local history.<br>Pause view freezes this display; processing continues.</p></aside>
  </div>
</section>
<section class="section" id="events" aria-label="Contact event feed">
  <div class="section-heading"><div class="section-title"><span class="section-number">03</span><h2>Processing stream</h2></div><span class="date-label">EXPLORE YOUR ACTIVITY</span></div>
  <div class="card feed-panel">
    <div class="feed-heading"><h3>People &amp; companies</h3><span class="row-count" id="row-count">0 events</span></div>
    <div class="feed-toolbar">
      <div class="search-wrap"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><label class="sr-only" for="search">Search all event fields</label><input id="search" class="search" type="search" placeholder="Search names, companies, locations…" autocomplete="off"></div>
      <button type="button" id="toggle-filters" class="button" aria-expanded="false" aria-controls="advanced-filters"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 4h12M4 8h8M6 12h4"/></svg> Filters <span class="control-count" id="filter-count" hidden>0</span></button>
      <button type="button" id="configure-columns" class="button" aria-haspopup="dialog"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10M10 3v10"/></svg> Columns <span class="control-count" id="column-count">5</span></button>
      <div class="toolbar-end"><label class="sr-only" for="density">Row density</label><select id="density" class="density-select"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><button type="button" id="export-csv" class="button" disabled>Export CSV</button></div>
    </div>
    <div class="filter-row"><div class="filters" role="group" aria-label="Filter event outcomes">
      <button type="button" class="filter" data-filter="all" aria-pressed="true">All activity<span class="outcome-count">0</span></button>
      <button type="button" class="filter" data-filter="found" aria-pressed="false">Found<span class="outcome-count">0</span></button>
      <button type="button" class="filter" data-filter="saved" aria-pressed="false">Saved<span class="outcome-count">0</span></button>
      <button type="button" class="filter" data-filter="skipped" aria-pressed="false">Skipped<span class="outcome-count">0</span></button>
      <button type="button" class="filter" data-filter="failed" aria-pressed="false">Issues<span class="outcome-count">0</span></button>
    </div><button type="button" class="button" id="clear-quick-filters" hidden>Clear filters</button><span class="filter-hint">Search includes hidden columns</span></div>
    <div class="advanced-filters" id="advanced-filters" hidden>
      <div class="field"><label for="filter-kind">Entity type</label><select id="filter-kind"><option value="">All types</option><option>Person</option><option>Company</option></select></div>
      <div class="field"><label for="filter-stage">Processing step</label><select id="filter-stage"><option value="">All steps</option></select></div>
      <div class="field"><label for="filter-company">Company contains</label><input id="filter-company" class="filter-input" placeholder="e.g. Acme" autocomplete="off"></div>
      <div class="field"><label for="filter-location">Location contains</label><input id="filter-location" class="filter-input" placeholder="e.g. San Diego" autocomplete="off"></div>
      <button type="button" class="button" id="clear-filters" disabled>Reset all</button>
    </div>
    <div class="selection-bar" id="selection-bar" hidden><strong id="selection-count">0 events selected</strong><span class="selection-meta" id="selection-meta"></span><button type="button" class="button" id="selected-only" aria-pressed="false">Show selected</button><button type="button" class="button" id="clear-selection">Clear selection</button></div>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable event table"><table id="activity-table"><caption class="sr-only">Person and company processing events. Column headers sort; checkboxes select events across pages.</caption><colgroup id="table-columns"></colgroup><thead><tr id="table-head"></tr></thead><tbody id="feed"></tbody></table></div>
    <div class="empty" id="empty-feed"><div class="empty-glyph" aria-hidden="true">↗</div><strong id="empty-title">Your next run starts here</strong><p id="empty-detail">Real people and companies appear here as Allman processes them.</p></div>
    <div class="table-footer"><span id="page-range">0–0 of 0 events</span><div class="pagination"><label for="page-size">Rows <select id="page-size"><option>25</option><option>50</option><option>100</option><option>200</option></select></label><button type="button" class="button" id="previous-page" aria-label="Previous page" disabled>←</button><span id="page-number">Page 1 of 1</span><button type="button" class="button" id="next-page" aria-label="Next page" disabled>→</button></div></div>
    <div class="feed-foot"><p id="feed-note">Latest 200 journal events per run. Full event journal stays on this machine.</p><p id="table-status" class="table-status" role="status" aria-live="polite"></p></div>
  </div>
</section>
<footer class="footer"><span>Allman / Relationship workspace</span><span>Private local history · Observer only</span></footer>
</main>
<dialog id="columns-dialog" aria-labelledby="columns-title" aria-describedby="columns-description">
  <div class="dialog-heading"><h2 id="columns-title">Arrange your view</h2><button type="button" class="button" data-close-columns aria-label="Close column settings">×</button></div>
  <p class="dialog-copy" id="columns-description">Choose columns. Drag to reorder, or use the arrow buttons. At least one column stays visible. Layout saves for this workspace in this browser.</p>
  <ul class="column-list" id="column-list"></ul>
  <div class="dialog-foot"><button type="button" id="reset-columns" class="button">Reset columns</button><button type="button" class="button primary" data-close-columns>Done</button></div>
</dialog>
<script>${activityScript}</script>
</body></html>`;
