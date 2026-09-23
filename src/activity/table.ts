/** Shared by the embedded browser and VM-based regression tests; no runtime dependencies. */
export const activityTableScript = String.raw`
function createActivityTableModel() {
  const columns = [
    {key:'name',label:'Person / company',width:250},
    {key:'kind',label:'Type',width:105},
    {key:'title',label:'Title',width:240},
    {key:'company',label:'Company',width:210},
    {key:'location',label:'Location',width:190},
    {key:'stage',label:'Processing step',width:185},
    {key:'status',label:'Outcome',width:120},
    {key:'at',label:'Time',width:160},
    {key:'note',label:'Details',width:280},
    {key:'identity',label:'Identity',width:240}
  ];
  const keys=columns.map(c=>c.key);
  const defaults=()=>({order:keys.slice(),visible:['name','company','stage','status','at'],sort:{key:'at',direction:'desc'},density:'comfortable',pageSize:25});
  function preferences(value) {
    const base=defaults();
    if(!value || typeof value!=='object')return base;
    const order=Array.isArray(value.order)?[...new Set(value.order.filter(k=>keys.includes(k)))]:[];
    const visible=Array.isArray(value.visible)?[...new Set(value.visible.filter(k=>keys.includes(k)))]:base.visible;
    return {
      order:[...order,...keys.filter(k=>!order.includes(k))],
      visible:visible.length?visible:base.visible,
      sort:{key:keys.includes(value.sort?.key)?value.sort.key:'at',direction:value.sort?.direction==='asc'?'asc':'desc'},
      density:value.density==='compact'?'compact':'comfortable',
      pageSize:[25,50,100,200].includes(value.pageSize)?value.pageSize:25
    };
  }
  function project(runId,events) {
    const rows=new Map();
    for(const e of events||[]) {
      if(!e.person || !['found','saved','skipped','failed'].includes(e.status))continue;
      const p=e.person;
      const row={key:runId+':'+e.sequence,sequence:e.sequence,name:p.name||p.id,kind:p.kind==='company'?'Company':'Person',title:p.title||'',company:p.company||'',location:p.location||'',stage:e.stage||'',status:e.status,at:e.at,note:e.note||'',identity:p.slug||p.id};
      rows.set(row.key,row);
    }
    return [...rows.values()];
  }
  const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  function filter(rows,filters={},selected=new Set()) {
    const terms=fold(filters.query).trim().split(/\s+/).filter(Boolean);
    return rows.filter(row=>
      (!filters.outcome || filters.outcome==='all' || row.status===filters.outcome) &&
      (!filters.kind || row.kind===filters.kind) &&
      (!filters.stage || row.stage===filters.stage) &&
      (!filters.company || fold(row.company).includes(fold(filters.company))) &&
      (!filters.location || fold(row.location).includes(fold(filters.location))) &&
      (!filters.selectedOnly || selected.has(row.key)) &&
      terms.every(term=>keys.some(key=>fold(row[key]).includes(term)))
    );
  }
  function sort(rows,order) {
    const key=keys.includes(order?.key)?order.key:'at',direction=order?.direction==='asc'?1:-1;
    const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
    return rows.slice().sort((a,b)=>{
      const left=key==='at'?Date.parse(a.at):a[key],right=key==='at'?Date.parse(b.at):b[key];
      const emptyLeft=left==='' || left==null || (key==='at'&&!Number.isFinite(left));
      const emptyRight=right==='' || right==null || (key==='at'&&!Number.isFinite(right));
      if(emptyLeft!==emptyRight)return emptyLeft?1:-1;
      const result=emptyLeft?0:key==='at'?left-right:collator.compare(left,right);
      return result*direction || a.sequence-b.sequence;
    });
  }
  function paginate(rows,page,pageSize) {
    const size=[25,50,100,200].includes(pageSize)?pageSize:25;
    const pages=Math.max(1,Math.ceil(rows.length/size));
    const current=Math.max(1,Math.min(pages,Number.isSafeInteger(page)?page:1));
    const start=(current-1)*size;
    return {rows:rows.slice(start,start+size),page:current,pages,start:rows.length?start+1:0,end:Math.min(start+size,rows.length),total:rows.length};
  }
  function move(order,key,before) {
    if(!keys.includes(key) || key===before)return order.slice();
    const result=order.filter(k=>k!==key);
    const target=result.indexOf(before);
    result.splice(target<0?result.length:target,0,key);
    return result;
  }
  function selectionState(rows,selected) {
    const count=rows.filter(r=>selected.has(r.key)).length;
    return {checked:rows.length>0&&count===rows.length,indeterminate:count>0&&count<rows.length,count};
  }
  function csv(rows,visible) {
    // Formula-like values stay text in spreadsheets. Quote commas, quotes and line breaks.
    const escape=value=>{
      let text=String(value??'');
      if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;
      return '"'+text.replace(/"/g,'""')+'"';
    };
    const cols=visible.map(key=>columns.find(c=>c.key===key)).filter(Boolean);
    return [cols.map(c=>escape(c.label)).join(','),...rows.map(row=>cols.map(c=>escape(row[c.key])).join(','))].join('\r\n');
  }
  return {columns,defaults,preferences,project,filter,sort,paginate,move,selectionState,csv};
}
`;
