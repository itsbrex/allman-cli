/** DOM controller for the local event table. No contact data is persisted in browser storage. */
export const activityTableControllerScript = String.raw`
const model=createActivityTableModel();
let preferences=model.defaults(), preferenceKey='', activeRunId=null, rows=[], filteredRows=[], page=1;
let filters={outcome:'all'}, selectedRows=new Set(), tableFingerprint='', draggedColumn=null;
function announce(message) { text('table-status',message); }
function savePreferences() {
  try { localStorage.setItem(preferenceKey,JSON.stringify(preferences)); }
  catch { announce('Browser storage unavailable. Layout changes last for this visit.'); }
}
function syncTable(run) {
  const key='allman.activity.table.v1.'+(snapshot.viewKey || snapshot.label);
  if(key!==preferenceKey) {
    preferenceKey=key;
    try { preferences=model.preferences(JSON.parse(localStorage.getItem(key))); }
    catch { preferences=model.defaults(); }
    $('density').value=preferences.density; $('page-size').value=String(preferences.pageSize);
    activeRunId=null; tableFingerprint=''; selectedRows.clear();
  }
  const runId=run?.id || '';
  const fingerprint=JSON.stringify([runId,run?.events || []]);
  if(fingerprint===tableFingerprint)return;
  tableFingerprint=fingerprint;
  if(activeRunId!==runId) {
    activeRunId=runId; page=1; selectedRows.clear(); filters.selectedOnly=false;
  }
  rows=model.project(runId,run?.events);
  const available=new Set(rows.map(row=>row.key));
  selectedRows=new Set([...selectedRows].filter(key=>available.has(key)));
  const stage=$('filter-stage'), previous=stage.value;
  stage.replaceChildren(new Option('All steps',''));
  for(const value of [...new Set(rows.map(row=>row.stage))].sort())stage.add(new Option(value,value));
  // Keep an active filter even if a live tail no longer contains that step.
  if(previous && ![...stage.options].some(option=>option.value===previous))stage.add(new Option(previous,previous));
  stage.value=previous;
  renderRows();
}
function visibleColumns() { return preferences.order.filter(key=>preferences.visible.includes(key)); }
function rememberFocus(container) {
  const active=document.activeElement;
  return container.contains(active)?active.dataset.focus:null;
}
function restoreFocus(container,key) {
  if(!key)return;
  const target=[...container.querySelectorAll('[data-focus]')].find(el=>el.dataset.focus===key);
  if(target)target.focus({preventScroll:true});
}
function renderRows() {
  const table=$('activity-table'), focus=rememberFocus(table);
  filteredRows=model.sort(model.filter(rows,filters,selectedRows),preferences.sort);
  const result=model.paginate(filteredRows,page,preferences.pageSize); page=result.page;
  const columns=visibleColumns().map(key=>model.columns.find(c=>c.key===key));
  text('column-count',String(columns.length));
  table.classList.toggle('compact',preferences.density==='compact');
  table.style.minWidth=(44+columns.reduce((sum,c)=>sum+c.width,0))+'px';
  const colgroup=$('table-columns');colgroup.replaceChildren();
  const selectionColumn=document.createElement('col');selectionColumn.style.width='44px';colgroup.append(selectionColumn);
  for(const column of columns) { const col=document.createElement('col');col.style.width=column.width+'px';colgroup.append(col); }
  const head=$('table-head');head.replaceChildren();
  const checkCell=element('th','select-cell');checkCell.scope='col';
  const all=document.createElement('input');all.type='checkbox';all.dataset.focus='select-filtered';
  all.setAttribute('aria-label','Select all filtered rows');all.disabled=!filteredRows.length;
  const selection=model.selectionState(filteredRows,selectedRows);all.checked=selection.checked;all.indeterminate=selection.indeterminate;
  all.addEventListener('change',()=>{
    for(const row of filteredRows) { if(all.checked)selectedRows.add(row.key);else selectedRows.delete(row.key); }
    renderRows();announce(quantity(selectedRows.size,'event')+' selected.');
  });
  checkCell.append(all);head.append(checkCell);
  for(const column of columns) {
    const cell=element('th','');cell.scope='col';
    const current=preferences.sort.key===column.key;
    cell.setAttribute('aria-sort',current?(preferences.sort.direction==='asc'?'ascending':'descending'):'none');
    const button=element('button','sort-button',column.label);button.type='button';button.dataset.focus='sort-'+column.key;
    button.setAttribute('aria-label','Sort by '+column.label);
    const arrow=element('span','sort-arrow',current?(preferences.sort.direction==='asc'?'↑':'↓'):'↕');arrow.setAttribute('aria-hidden','true');button.append(arrow);
    button.addEventListener('click',()=>{
      preferences.sort={key:column.key,direction:current && preferences.sort.direction==='asc'?'desc':'asc'};page=1;
      savePreferences();renderRows();announce('Sorted by '+column.label+', '+(preferences.sort.direction==='asc'?'ascending.':'descending.'));
    });
    cell.append(button);head.append(cell);
  }
  const feed=$('feed');feed.replaceChildren();
  for(const row of result.rows) {
    const tr=element('tr',selectedRows.has(row.key)?'selected':'');
    const td=element('td','select-cell'), checkbox=document.createElement('input');
    checkbox.type='checkbox';checkbox.checked=selectedRows.has(row.key);checkbox.dataset.focus='select-'+row.key;
    checkbox.setAttribute('aria-label','Select '+row.name+', '+(labels[row.status] || row.status)+', event '+row.sequence);
    checkbox.addEventListener('change',()=>{
      if(checkbox.checked)selectedRows.add(row.key);else selectedRows.delete(row.key);
      renderRows();announce(quantity(selectedRows.size,'event')+' selected.');
    });
    td.append(checkbox);tr.append(td);
    for(const column of columns) {
      const cell=element('td','');cell.title=String(row[column.key] || '');
      if(column.key==='name') {
        const wrap=element('div','person-cell'), avatar=element('span','mini-avatar',initials(row.name));avatar.setAttribute('aria-hidden','true');
        const copy=element('div','entity-copy');copy.append(element('strong','',row.name),element('span','',row.title || row.identity));
        wrap.append(avatar,copy);cell.append(wrap);
      } else if(column.key==='status')cell.append(badge(row.status));
      else if(column.key==='at') { cell.className='cell-time';cell.textContent=time(row.at);cell.title=new Date(row.at).toLocaleString(); }
      else { cell.className=column.key==='stage'?'cell-stage':column.key==='kind'?'cell-kind':'cell-muted';cell.textContent=row[column.key] || '—'; }
      tr.append(cell);
    }
    feed.append(tr);
  }
  restoreFocus(table,focus);
  $('empty-feed').hidden=filteredRows.length>0;
  text('empty-title',rows.length?'No matching activity':'Your next run starts here');
  text('empty-detail',rows.length?'Clear filters or change your search to see more events.':'Real people and companies appear here as Allman processes them.');
  text('row-count',quantity(filteredRows.length,'event')+(filteredRows.length!==rows.length?' / '+rows.length.toLocaleString()+' loaded':''));
  text('page-range',result.start+'–'+result.end+' of '+quantity(result.total,'event'));
  text('page-number','Page '+result.page+' of '+result.pages);
  $('previous-page').disabled=page<=1;$('next-page').disabled=page>=result.pages;
  const activeFilters=['query','kind','stage','company','location'].filter(key=>filters[key]).length+(filters.outcome==='all'?0:1)+(filters.selectedOnly?1:0);
  text('filter-count',String(activeFilters));$('filter-count').hidden=!activeFilters;
  $('clear-filters').disabled=!activeFilters;$('clear-quick-filters').hidden=!activeFilters;
  for(const button of document.querySelectorAll('[data-filter]')) {
    const value=button.dataset.filter;button.setAttribute('aria-pressed',String(value===filters.outcome));
    button.querySelector('.outcome-count').textContent=(value==='all'?rows.length:rows.filter(row=>row.status===value).length).toLocaleString();
  }
  $('selection-bar').hidden=!selectedRows.size && !filters.selectedOnly;
  text('selection-count',quantity(selectedRows.size,'event')+' selected');
  const hidden=selectedRows.size-model.selectionState(filteredRows,selectedRows).count;
  text('selection-meta',hidden?quantity(hidden,'selection')+' outside current filters':'Across all pages in this run');
  text('selected-only',filters.selectedOnly?'Show all rows':'Show selected');
  $('selected-only').setAttribute('aria-pressed',String(Boolean(filters.selectedOnly)));
  $('export-csv').disabled=!selectedRows.size && !filteredRows.length;
  text('export-csv',selectedRows.size?'Export selected ('+selectedRows.size+')':'Export CSV');
  $('export-csv').title=selectedRows.size?'Export selected events, including filtered-out selections':'Export all filtered events across pages';
  renderFeedNote();
}
function renderFeedNote() {
  text('feed-note',paused?'View paused. CLI processing continues.':'Latest 200 journal events per run; table shows person and company outcomes. Each processing step counts as an event.');
}
function changeFilters() {
  filters={...filters,query:$('search').value,kind:$('filter-kind').value,stage:$('filter-stage').value,company:$('filter-company').value,location:$('filter-location').value};
  page=1;renderRows();
}
function clearFilters() {
  filters={outcome:'all'};
  for(const id of ['search','filter-kind','filter-stage','filter-company','filter-location'])$(id).value='';
  page=1;renderRows();announce('All filters cleared.');
}
function renderColumns() {
  const list=$('column-list'), focus=rememberFocus(list);list.replaceChildren();
  for(const [index,key] of preferences.order.entries()) {
    const column=model.columns.find(c=>c.key===key), item=element('li','column-item');item.draggable=true;item.dataset.column=key;
    const grip=element('span','column-grip','⠿');grip.setAttribute('aria-hidden','true');
    const label=element('label',''), input=document.createElement('input');input.type='checkbox';input.checked=preferences.visible.includes(key);input.dataset.focus='column-'+key;
    input.disabled=input.checked && preferences.visible.length===1;
    input.addEventListener('change',()=>{
      preferences.visible=input.checked?[...preferences.visible,key]:preferences.visible.filter(c=>c!==key);
      savePreferences();renderRows();renderColumns();
    });
    label.append(input,document.createTextNode(column.label));item.append(grip,label);
    for(const direction of [-1,1]) {
      const button=element('button','button',direction<0?'↑':'↓');button.type='button';
      const verb=direction<0?'earlier':'later';button.setAttribute('aria-label','Move '+column.label+' '+verb);button.dataset.focus='move-'+key+'-'+verb;
      button.disabled=index+direction<0 || index+direction>=preferences.order.length;
      button.addEventListener('click',()=>{
        const before=preferences.order[index+(direction<0?-1:2)];preferences.order=model.move(preferences.order,key,before);
        savePreferences();renderColumns();renderRows();
        // At a boundary the move button becomes disabled; keep keyboard focus on this row.
        if(document.activeElement===document.body)list.querySelector('[data-focus="column-'+key+'"]').focus();
      });item.append(button);
    }
    item.addEventListener('dragstart',event=>{draggedColumn=key;item.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',key);});
    item.addEventListener('dragover',event=>{if(draggedColumn && draggedColumn!==key){event.preventDefault();event.dataTransfer.dropEffect='move';item.classList.add('drag-over');}});
    item.addEventListener('dragleave',()=>item.classList.remove('drag-over'));
    item.addEventListener('drop',event=>{event.preventDefault();if(!draggedColumn)return;preferences.order=model.move(preferences.order,draggedColumn,key);draggedColumn=null;savePreferences();renderColumns();renderRows();});
    item.addEventListener('dragend',()=>{draggedColumn=null;for(const row of list.children)row.classList.remove('dragging','drag-over');});
    list.append(item);
  }
  restoreFocus(list,focus);
  text('column-count',String(preferences.visible.length));
}
$('search').addEventListener('input',changeFilters);
for(const id of ['filter-company','filter-location'])$(id).addEventListener('input',changeFilters);
for(const id of ['filter-kind','filter-stage'])$(id).addEventListener('change',changeFilters);
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{filters.outcome=button.dataset.filter;page=1;renderRows();});
$('clear-filters').addEventListener('click',clearFilters);$('clear-quick-filters').addEventListener('click',clearFilters);
$('toggle-filters').addEventListener('click',()=>{const expanded=$('advanced-filters').hidden;$('advanced-filters').hidden=!expanded;$('toggle-filters').setAttribute('aria-expanded',String(expanded));});
$('selected-only').addEventListener('click',()=>{filters.selectedOnly=!filters.selectedOnly;page=1;renderRows();});
$('clear-selection').addEventListener('click',()=>{selectedRows.clear();filters.selectedOnly=false;renderRows();announce('Selection cleared.');});
$('density').addEventListener('change',()=>{preferences.density=$('density').value;savePreferences();renderRows();});
$('page-size').addEventListener('change',()=>{preferences.pageSize=Number($('page-size').value);page=1;savePreferences();renderRows();});
$('previous-page').addEventListener('click',()=>{page--;renderRows();});$('next-page').addEventListener('click',()=>{page++;renderRows();});
$('configure-columns').addEventListener('click',()=>{renderColumns();$('columns-dialog').showModal();});
for(const button of document.querySelectorAll('[data-close-columns]'))button.addEventListener('click',()=>$('columns-dialog').close());
$('reset-columns').addEventListener('click',()=>{const defaults=model.defaults();preferences.order=defaults.order;preferences.visible=defaults.visible;savePreferences();renderColumns();renderRows();});
$('export-csv').addEventListener('click',()=>{
  const exported=selectedRows.size?model.sort(rows.filter(row=>selectedRows.has(row.key)),preferences.sort):filteredRows;
  if(!exported.length)return;
  const url=URL.createObjectURL(new Blob(['\uFEFF',model.csv(exported,visibleColumns())],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='allman-events-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  announce('Exported '+quantity(exported.length,'event')+' with visible columns.');
});
`;
