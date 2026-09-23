/** Design tokens extracted from the user's BD Stack reference. System fonts only. */
export const bdStackTokens = `
:root{
  color-scheme:dark;
  --bg-0:#0a0a0b;--bg-1:#111113;--bg-2:#17171a;--bg-3:#1f1f23;
  --line:#2a2a30;--line-2:#35353d;
  --txt-1:#f4f2ec;--txt-2:#b6b3a9;--txt-3:#78756c;
  --accent:#e0a51f;--accent-soft:#3a2e0d;--accent-line:#6b520f;
  --ok:#8fbf6a;--ok-soft:#1c2a15;--wip:#5fb0c9;--wip-soft:#12262c;--crit:#d98b5f;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --serif:"Iowan Old Style",Georgia,"Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif;
  --radius-sm:7px;--radius-md:12px;--radius-lg:16px;
  --shadow:0 18px 40px rgba(0,0,0,.5);--ease:180ms ease;
}
`;

export const activityStyles = `${bdStackTokens}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:92px}body{margin:0;background:var(--bg-0);color:var(--txt-1);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(1200px 600px at 80% -10%,rgba(224,165,31,.06),transparent 60%),radial-gradient(900px 500px at 0% 30%,rgba(95,176,201,.04),transparent 55%);background-attachment:fixed}
button,input,select{font:inherit}button,select,summary{cursor:pointer}button,a,input,select,summary{touch-action:manipulation}button{color:var(--txt-1)}button:disabled{opacity:.35;cursor:not-allowed}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:4px}input[type=checkbox]{accent-color:var(--accent);width:15px;height:15px;cursor:pointer}a{color:var(--accent);text-decoration:none}a:hover{color:#f2bd45}h1,h2,h3,p{margin:0}[hidden]{display:none!important}
.wrap{max-width:1440px;margin:0 auto;padding:0 32px}
.mono{font-family:var(--mono)}
.muted{color:var(--txt-2);font-size:12px;line-height:1.6}
.kicker{font:10px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--txt-2)}
.masthead{display:flex;justify-content:space-between;align-items:center;padding-top:26px;gap:20px}
.brand{display:flex;gap:12px;align-items:center;font-size:18px;font-weight:600;letter-spacing:-.3px}
.brand-mark{width:31px;height:31px;border-radius:8px;border:1px solid var(--accent-line);color:var(--accent);display:grid;place-items:center;font:27px var(--serif)}
.header-right{display:flex;gap:22px;align-items:center}
.profile{font:11px var(--mono);color:var(--txt-2);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.connection{display:flex;align-items:center;gap:8px;font:10px var(--mono);text-transform:uppercase;letter-spacing:.05em}
.connection:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--txt-3)}
.connection.connected:before{background:var(--ok);box-shadow:0 0 9px #8fbf6a55}
.connection.offline{color:var(--crit)}
.connection.offline:before{background:var(--crit)}
.page-heading{padding:46px 0 34px;border-bottom:1px solid var(--line)}
.page-heading h1{font:500 clamp(34px,4.7vw,60px)/1.05 var(--serif);letter-spacing:-.015em;margin:13px 0 16px}
.page-heading h1 em{color:var(--accent)}
.lede{color:var(--txt-2);font-size:15px;max-width:760px}
.masthead-note{border-left:1px solid var(--accent-line);padding-left:13px;font:10px/1.8 var(--mono);color:var(--txt-2)}
.controls{position:sticky;top:0;z-index:30;background:rgba(10,10,11,.88);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.controls-inner{display:flex;justify-content:space-between;align-items:center;gap:20px;padding-top:12px;padding-bottom:12px}
.section-nav,.view-controls{display:flex;gap:8px;align-items:center}
.nav-link{font:10px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--txt-2);padding:8px 12px;border:1px solid transparent;border-radius:100px;white-space:nowrap}
.nav-link:hover{border-color:var(--accent-line);color:var(--accent)}
.nav-link span{color:var(--accent);margin-right:6px}
.button,select{height:36px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:var(--bg-2);color:var(--txt-1);padding:0 11px;font-size:11px}
.button{display:inline-flex;gap:7px;align-items:center;justify-content:center;white-space:nowrap;transition:background var(--ease),border-color var(--ease)}
.button:hover:not(:disabled){background:var(--bg-3);border-color:var(--accent-line)}
.button[aria-pressed=true],.button[aria-expanded=true]{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.button.primary{background:var(--accent);border-color:var(--accent);color:#1a1508;font-weight:600}
.button.primary:hover:not(:disabled){background:#f2bd45}
.button svg{width:13px;height:13px;flex:none}
#run-select{max-width:310px;min-width:180px;font-family:var(--mono);font-size:10px}
.content{padding-top:32px;padding-bottom:38px}
.section{margin-bottom:32px}
.section-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:19px}
.section-title{display:flex;gap:13px;align-items:baseline}
.section-number{font:11px var(--mono);color:var(--accent)}h2{font:500 29px var(--serif);letter-spacing:-.01em}
.date-label{font:10px var(--mono);color:var(--txt-2)}
.card{background:linear-gradient(180deg,var(--bg-1),var(--bg-0));border:1px solid var(--line);border-radius:var(--radius-lg);overflow:hidden}
.daily-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.daily-stat{padding:20px 21px;position:relative;min-height:146px;transition:border-color var(--ease),transform var(--ease)}
.daily-stat:hover{border-color:var(--accent-line);transform:translateY(-2px)}
.daily-stat:first-child{border-color:var(--accent-line)}
.daily-label{font:10px var(--mono);text-transform:uppercase;letter-spacing:.065em;color:var(--txt-2)}
.daily-value{font:44px/1.1 var(--serif);font-variant-numeric:lining-nums tabular-nums;margin:13px 0 9px}
.daily-stat:first-child .daily-value{color:var(--accent)}
.daily-detail{color:var(--txt-2);font-size:11px;line-height:1.6}
.daily-work{color:var(--txt-2);font:10px/1.85 var(--mono)}
.daily-ledger{padding:16px 0 0}
.quota-zone{margin-top:22px;padding:18px 20px;border:1px dashed var(--accent-line);border-radius:var(--radius-md);position:relative}
.quota-intro{display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--txt-2);font:10px var(--mono)}
.quota-intro strong{color:var(--accent);font-weight:400;text-transform:uppercase;letter-spacing:.1em}
.quota-list{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:19px}
.quota-card+ .quota-card{border-left:1px solid var(--line);padding-left:24px}
.quota-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}
.quota-heading strong{font-size:12px;font-weight:500}
.quota-value{color:var(--txt-2);font:11px var(--mono);margin:12px 0 9px}
.quota-track{height:5px;border-radius:3px;background:var(--line);overflow:hidden}
.quota-fill{height:100%;background:var(--ok)}
.warning .quota-fill,.blocked .quota-fill{background:var(--accent)}
.quota-card .muted{font:10px/1.6 var(--mono);margin-top:9px}
.quota-disclaimer{margin-top:15px;font-size:11px;color:var(--txt-2);line-height:1.75}
.quota-disclaimer a{border-bottom:1px solid var(--accent-line)}
.coverage{margin-top:16px;font-size:11px;color:var(--txt-2)}
.coverage summary{width:fit-content;color:var(--txt-2);font:10px/1.7 var(--mono)}
.coverage p{margin:10px 0;line-height:1.8;max-width:1100px}
.provider-warning{color:var(--crit);background:#271b13;border:1px solid #633e27;border-radius:8px;font-size:11px;padding:12px 15px;margin-top:14px;line-height:1.7}
.badge{font:9px/1.3 var(--mono);letter-spacing:.045em;text-transform:uppercase;display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:100px;white-space:nowrap;color:var(--txt-2);border:1px solid var(--line-2);background:var(--bg-2)}
.badge.saved,.badge.finished{color:var(--ok);background:var(--ok-soft);border-color:#33502099}
.badge.running,.badge.processing,.badge.found{color:var(--wip);background:var(--wip-soft);border-color:#1e454f99}
.badge.failed,.badge.interrupted{color:var(--crit);background:#271b13;border-color:#633e27}
.badge.quota,.badge.skipped{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line)}
.run-layout{display:grid;grid-template-columns:minmax(0,1fr) 275px;gap:18px}
.hero-top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px 0}
.run-label{font:10px var(--mono);color:var(--txt-2);overflow-wrap:anywhere}
.person-focus{display:flex;gap:17px;align-items:center;padding:24px 22px}
.avatar{width:54px;height:54px;flex:none;display:grid;place-items:center;border:1px solid var(--accent-line);background:var(--accent-soft);border-radius:12px;color:var(--accent);font:23px var(--serif)}
.person-meta{min-width:0}
.person-caption{font:9px var(--mono);letter-spacing:.14em;color:var(--accent);margin-bottom:7px}
.person-name{font:500 28px/1.2 var(--serif);overflow-wrap:anywhere}
.person-detail{color:var(--txt-2);font-size:12px;margin-top:7px;line-height:1.6}
.person-id{font:10px var(--mono);color:var(--txt-2);margin-top:7px;overflow-wrap:anywhere}
.phase{padding:16px 22px 19px;border-top:1px solid var(--line);background:var(--bg-1)}
.phase-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}
.phase-title{font-size:12px}
.elapsed{font:11px var(--mono);color:var(--txt-2)}
.phase-caption{font-size:11px;color:var(--txt-2);margin:7px 0 14px}
.progress-track{height:4px;border-radius:3px;background:var(--line);overflow:hidden}
.progress-fill{height:100%;background:var(--accent);transition:width .2s}
.progress-track.indeterminate .progress-fill{width:24%!important;animation:travel 2s ease-in-out infinite}
.progress-label{font:10px var(--mono);color:var(--txt-2);margin-top:9px}
@keyframes travel{from{transform:translateX(-100%)}to{transform:translateX(520%)}}
.run-stats{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line)}
.run-stat{padding:14px 22px;border-right:1px solid var(--line)}
.run-stat:last-child{border:0}
.run-stat .stat-label{font:9px var(--mono);color:var(--txt-2);text-transform:uppercase;letter-spacing:.08em}
.run-stat .stat-value{font:24px var(--serif);margin-top:5px}
.run-stat.saved .stat-value{color:var(--ok)}
.run-stat.failed .stat-value{color:var(--crit)}
.aside{padding:18px 16px;align-self:start}
.aside h3{font:10px var(--mono);letter-spacing:.12em;color:var(--txt-2);text-transform:uppercase;margin-bottom:13px}
.run-item{width:100%;padding:11px 10px;text-align:left;background:transparent;border:1px solid transparent;border-bottom-color:var(--line);border-radius:7px;color:var(--txt-2)}
.run-item.selected{border-color:var(--accent-line);background:#e0a51f08}
.run-item:hover{background:var(--bg-2)}
.run-item-top{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:5px}
.run-item-top strong{font:10px var(--mono);overflow-wrap:anywhere}
.run-item .muted{font:9px var(--mono)}
.aside-note{font:10px/1.8 var(--mono);color:var(--txt-2);margin:17px 7px 0}
.feed-panel{overflow:visible}
.feed-heading{padding:21px 22px 15px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.feed-heading h3{font:500 23px var(--serif)}
.row-count{font:10px var(--mono);color:var(--txt-2)}
.feed-toolbar{padding:0 22px 15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.search-wrap{position:relative;flex:1;min-width:210px}
.search-wrap svg{position:absolute;top:11px;left:11px;width:14px;height:14px;color:var(--txt-2)}
.search{width:100%;height:36px;padding:0 12px 0 34px;background:var(--bg-0);color:var(--txt-1);border:1px solid var(--line-2);border-radius:7px;font-size:12px}
.search::placeholder,.filter-input::placeholder{color:var(--txt-3)}
.control-count{font:9px var(--mono);background:var(--bg-0);border-radius:4px;padding:1px 4px}
.toolbar-end{display:flex;align-items:center;gap:8px}
.density-select{font-size:11px;max-width:125px}
.filter-row{display:flex;justify-content:space-between;gap:12px;padding:0 22px 16px;flex-wrap:wrap;align-items:center}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.filter{background:var(--bg-2);border:1px solid var(--line);border-radius:100px;padding:6px 11px;font:10px var(--mono);color:var(--txt-2);transition:all var(--ease)}
.filter:hover{color:var(--txt-1);border-color:var(--line-2)}
.filter[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#1a1508}
.filter[data-filter=failed][aria-pressed=true]{background:var(--crit);border-color:var(--crit)}
.filter .outcome-count{opacity:.7;margin-left:6px;font-size:9px}
.filter-hint{font:10px var(--mono);color:var(--txt-2)}
.advanced-filters{display:grid;grid-template-columns:130px 1fr 1fr 1fr auto;gap:12px;align-items:end;padding:17px 22px;background:var(--bg-2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.field label{display:block;font:9px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--txt-2);margin-bottom:7px}
.field input,.field select{width:100%;height:34px;min-width:0}
.filter-input{background:var(--bg-0);border:1px solid var(--line-2);border-radius:6px;padding:0 10px;color:var(--txt-1);font-size:11px}
.selection-bar{display:flex;align-items:center;gap:10px;padding:10px 22px;background:var(--accent-soft);border-top:1px solid var(--accent-line);font:10px var(--mono);flex-wrap:wrap}
.selection-bar strong{color:var(--accent);font-weight:500}
.selection-bar .selection-meta{color:var(--txt-2);margin-right:auto}
.selection-bar .button{height:28px;font-size:10px;background:transparent;border-color:var(--accent-line)}
.table-scroll{overflow:auto;max-height:610px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);overscroll-behavior:contain}table{border-collapse:separate;border-spacing:0;width:100%;text-align:left;table-layout:fixed}thead{position:sticky;top:0;z-index:3}th{padding:0 13px;height:42px;background:var(--bg-2);border-bottom:1px solid var(--line-2);font:9px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--txt-2);font-weight:400}th[aria-sort=ascending],th[aria-sort=descending]{color:var(--accent)}
.sort-button{width:100%;padding:0;display:flex;align-items:center;justify-content:space-between;gap:9px;background:none;border:0;color:inherit;height:42px;font:inherit;letter-spacing:inherit;text-transform:inherit;text-align:left}
.sort-arrow{font-size:13px;opacity:.5}th[aria-sort=ascending] .sort-arrow,th[aria-sort=descending] .sort-arrow{opacity:1}
.select-cell{width:44px;min-width:44px;padding:0 14px;position:sticky;left:0;z-index:2;background:var(--bg-1)}th.select-cell{background:var(--bg-2);z-index:4}td{padding:13px;border-bottom:1px solid var(--line);background:var(--bg-1);font-size:11px;line-height:1.55;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}tbody tr:hover td{background:var(--bg-2)}tbody tr.selected td{background:#211b0d}tbody tr.selected:hover td{background:#2a220d}tbody tr:last-child td{border-bottom:0}
.person-cell{display:flex;align-items:center;gap:10px}
.mini-avatar{display:grid;place-items:center;width:29px;height:29px;border:1px solid var(--line-2);border-radius:7px;flex:none;background:var(--bg-2);color:var(--txt-2);font:12px var(--serif)}
.entity-copy{min-width:0}
.entity-copy strong{display:block;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.entity-copy span{display:block;font:9px var(--mono);color:var(--txt-2);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cell-time{font:10px var(--mono);color:var(--txt-2)}
.cell-muted{color:var(--txt-2)}
.cell-kind{font:10px var(--mono);color:var(--txt-2)}
.cell-stage{color:var(--txt-2);white-space:normal}
.row-note{display:block;font-size:10px;color:var(--txt-2);margin-top:3px}
.compact td{padding-top:7px;padding-bottom:7px}
.compact .mini-avatar{width:25px;height:25px}
.compact .entity-copy span{display:none}
.table-footer{padding:12px 22px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;color:var(--txt-2);font:10px var(--mono)}
.pagination{display:flex;align-items:center;gap:9px}
.pagination select,.pagination button{height:29px;font-size:10px}
.pagination label{display:flex;gap:8px;align-items:center}
.feed-foot{border-top:1px solid var(--line);padding:12px 22px;font:10px/1.7 var(--mono);color:var(--txt-2)}
.empty{padding:44px 20px;text-align:center}
.empty strong{font:23px var(--serif)}
.empty p{margin:10px auto 0;color:var(--txt-2);font-size:12px;max-width:390px}
.empty-glyph{color:var(--accent);font:26px var(--serif);margin-bottom:12px}
.table-status{font:10px var(--mono);color:var(--accent);min-height:15px}
dialog{color:var(--txt-1);background:var(--bg-1);border:1px solid var(--line-2);border-radius:16px;padding:0;width:min(440px,calc(100vw - 28px));box-shadow:var(--shadow);max-height:85vh}dialog::backdrop{background:#0009;backdrop-filter:blur(3px)}
.dialog-heading{display:flex;justify-content:space-between;align-items:center;padding:22px 22px 10px}
.dialog-heading h2{font-size:29px}
.dialog-copy{color:var(--txt-2);font-size:12px;line-height:1.7;padding:0 22px 16px}
.column-list{padding:0 14px 10px;list-style:none;margin:0}
.column-item{display:flex;align-items:center;gap:9px;padding:10px 9px;border:1px solid transparent;border-bottom-color:var(--line);border-radius:7px;background:var(--bg-1)}
.column-item.dragging{opacity:.4}
.column-item.drag-over{border-color:var(--accent);background:var(--accent-soft)}
.column-grip{font:16px var(--mono);color:var(--txt-3);cursor:grab;user-select:none}
.column-item label{display:flex;align-items:center;gap:10px;flex:1;font-size:12px}
.column-item .button{width:28px;height:27px;padding:0;font:12px var(--mono)}
.dialog-foot{display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-top:1px solid var(--line);gap:10px}
.footer{display:flex;justify-content:space-between;gap:14px;padding-top:20px;border-top:1px solid var(--line);font:10px/1.8 var(--mono);color:var(--txt-2)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:1050px){.wrap{padding-left:24px;padding-right:24px}
.section-nav .nav-label{display:none}
.section-nav{gap:0}
.nav-link{padding:8px}
.run-layout{grid-template-columns:minmax(0,1fr) 230px}
.quota-intro{align-items:start;flex-direction:column;gap:9px}
.daily-grid{gap:10px}
.daily-stat{padding:18px 16px}
.advanced-filters{grid-template-columns:1fr 1fr}
.advanced-filters>.button{width:fit-content}
.feed-toolbar .search-wrap{min-width:240px}}
@media(max-width:740px){.wrap{padding-left:17px;padding-right:17px}
.masthead{padding-top:20px}
.masthead-note{display:none}
.header-right{gap:10px}
.profile{max-width:155px;font-size:9px}
.connection{font-size:9px}
.brand{font-size:16px}
.page-heading{padding-top:30px;padding-bottom:24px}
.page-heading h1{font-size:40px}
.lede{font-size:13px}
.controls-inner{gap:10px;flex-wrap:wrap}
.view-controls{flex:1;min-width:0;justify-content:flex-end}
#run-select{max-width:230px;min-width:0;flex:1;font-size:9px}
.section-nav{display:none}
.content{padding-top:25px}
.section-heading{align-items:start}
.section-title{gap:9px}h2{font-size:26px}
.date-label{max-width:170px;text-align:right;font-size:9px;line-height:1.8}
.daily-grid{grid-template-columns:1fr 1fr}
.daily-stat{min-height:150px}
.daily-value{font-size:38px}
.daily-label{font-size:9px;line-height:1.6}
.daily-detail{font-size:10px}
.quota-zone{padding:16px 14px}
.quota-list{grid-template-columns:1fr;gap:20px}
.quota-card+.quota-card{padding-left:0;border-left:0;border-top:1px solid var(--line);padding-top:17px}
.run-layout{grid-template-columns:1fr}
.aside{display:none}
.hero-top{padding:17px 17px 0}
.person-focus{padding:21px 17px}
.person-name{font-size:25px}
.person-detail{font-size:11px}
.phase{padding:15px 17px}
.run-stat{padding:13px 17px}
.feed-heading{padding:18px 15px 13px}
.feed-toolbar,.filter-row{padding-left:15px;padding-right:15px}
.feed-toolbar .search-wrap{flex-basis:100%;min-width:0}
.toolbar-end{margin-left:auto}
.density-select{max-width:110px}
.feed-toolbar>.button{padding:0 9px}
.filter{font-size:9px;padding:6px 9px}
.filter-hint{display:none}
.advanced-filters{padding:15px}
.selection-bar{padding:11px 15px}
.table-footer,.feed-foot{padding-left:15px;padding-right:15px}
.pagination{flex-wrap:wrap}
.footer{flex-direction:column}
.table-scroll{max-height:530px}
.section{margin-bottom:27px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}
*,*:before,*:after{animation:none!important;transition:none!important}
.daily-stat:hover{transform:none}}
`;
