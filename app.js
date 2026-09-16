'use strict';

const APP_KEY='taxicuenta_pwa_v1';
const DB_NAME='taxicuenta_pwa_v1_db';
const DB_VERSION=1;
const STORE='kv';

const MODULES=[
  {key:'cash',label:'Efectivo'},
  {key:'card',label:'Tarjeta / TPV'},
  {key:'uber',label:'Uber'},
  {key:'uberCash',label:'Uber Cash'},
  {key:'freenow',label:'FreeNow'},
  {key:'freenowCash',label:'FreeNow Cash'},
  {key:'abonados',label:'Abonados'},
  {key:'imbric',label:'Imbric'},
  {key:'joinup',label:'JoinUp'},
  {key:'fuel',label:'Gasolina'},
  {key:'wash',label:'Lavado'}
];

const defaultConfig=()=>({
  configured:false,
  profile:'driver',
  splitEnabled:true,
  splitPct:50,
  insuranceEnabled:true,
  insuranceDaily:0,
  theme:localStorage.getItem('taxicuenta_theme')||'system',
  zoom:Number(localStorage.getItem('taxicuenta_zoom')||1),
  modules:{cash:true,card:true,uber:false,uberCash:false,freenow:false,freenowCash:false,abonados:false,imbric:false,joinup:false,fuel:true,wash:true},
  customConcepts:[]
});

let state={config:defaultConfig(),records:[],incomes:[],excelHandle:null};
let deferredInstallPrompt=null;
let activeAnalysis=[];

const $=sel=>document.querySelector(sel);
const $$=sel=>[...document.querySelectorAll(sel)];
const money=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(n||0));
const num=v=>Number.parseFloat(v)||0;
const todayISO=()=>new Date().toISOString().slice(0,10);
const uid=()=>`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbGet(key){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbSet(key,val){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(val,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
async function persist(){await Promise.all([dbSet('config',state.config),dbSet('records',state.records),dbSet('incomes',state.incomes)]).catch(console.error)}

async function loadState(){
  const [config,records,incomes,handle]=await Promise.all([dbGet('config'),dbGet('records'),dbGet('incomes'),dbGet('excelHandle')]).catch(()=>[]);
  if(config) state.config={...defaultConfig(),...config,modules:{...defaultConfig().modules,...(config.modules||{})}};
  if(Array.isArray(records)) state.records=records;
  if(Array.isArray(incomes)) state.incomes=incomes;
  if(handle) state.excelHandle=handle;
}

function applyAppearance(){
  document.documentElement.dataset.theme=state.config.theme||'system';
  document.documentElement.style.setProperty('--ui-scale',state.config.zoom||1);
  localStorage.setItem('taxicuenta_theme',state.config.theme||'system');
  localStorage.setItem('taxicuenta_zoom',String(state.config.zoom||1));
  $('#zoomValue').textContent=`${Math.round((state.config.zoom||1)*100)}%`;
}

function setupTabs(){
  $$('.tab').forEach(btn=>btn.addEventListener('click',()=>{
    $$('.tab').forEach(b=>b.classList.toggle('active',b===btn));
    $$('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${btn.dataset.tab}`));
    if(btn.dataset.tab==='analisis') refreshAnalysis();
  }));
}

function renderModuleChoices(){
  $('#moduleChoices').innerHTML=MODULES.map(m=>`<label class="module-item"><input type="checkbox" data-module="${m.key}" ${state.config.modules[m.key]?'checked':''}><span>${m.label}</span></label>`).join('');
}

function renderCustomConcepts(){
  const box=$('#customConceptList');
  if(!state.config.customConcepts.length){box.innerHTML='<div class="empty-state">No hay conceptos personalizados.</div>';return}
  box.innerHTML=state.config.customConcepts.map(c=>`<div class="custom-row"><input type="text" value="${esc(c.label)}" data-custom-label="${c.id}" maxlength="50"><button type="button" class="mini-btn" data-remove-custom="${c.id}">Eliminar</button></div>`).join('');
  $$('[data-remove-custom]').forEach(b=>b.onclick=()=>{state.config.customConcepts=state.config.customConcepts.filter(c=>c.id!==b.dataset.removeCustom);renderCustomConcepts()});
}

function syncConfigForm(){
  const f=$('#configForm');
  f.elements.profile.forEach(r=>r.checked=r.value===state.config.profile);
  $('#splitEnabled').checked=!!state.config.splitEnabled;
  $('#splitPct').value=state.config.splitPct;
  $('#insuranceEnabled').checked=!!state.config.insuranceEnabled;
  $('#insuranceDaily').value=state.config.insuranceDaily;
  renderModuleChoices();renderCustomConcepts();updateProfileBadge();updateExcelStatus();
}

function updateProfileBadge(){
  $('#profileBadge').textContent=state.config.profile==='driver'?'Perfil: Chofer':'Perfil: Titular de licencia';
}

function dynamicFieldHtml(key,label){
  let extra='';
  if(key==='uberCash') extra='<small class="muted">Cash declarado por Uber.</small>';
  if(key==='freenowCash') extra='<small class="muted">Cash declarado por FreeNow.</small>';
  return `<label class="field"><span>${label}</span><div class="money-input"><input data-day-field="${key}" type="number" min="0" step="0.01" inputmode="decimal" value="0"><b>€</b></div>${extra}</label>`;
}

function renderDayFields(){
  let html='';
  MODULES.forEach(m=>{if(state.config.modules[m.key]) html+=dynamicFieldHtml(m.key,m.label)});
  if(state.config.modules.uberCash) html+=dynamicFieldHtml('uberCashTpv','Uber Cash cobrado por TPV');
  if(state.config.modules.freenowCash) html+=dynamicFieldHtml('freenowCashTpv','FreeNow Cash cobrado por TPV');
  $('#dynamicFields').innerHTML=html;
  $('#customDayFields').innerHTML=state.config.customConcepts.map(c=>dynamicFieldHtml(`custom_${c.id}`,c.label)).join('');
  $$('[data-day-field]').forEach(i=>i.addEventListener('input',updateLiveSummary));
}

function collectDayForm(){
  const values={};
  $$('[data-day-field]').forEach(i=>values[i.dataset.dayField]=num(i.value));
  return {id:uid(),date:$('#dayDate').value,total:num($('#dayTotal').value),notes:$('#dayNotes').value.trim(),values,createdAt:new Date().toISOString(),configSnapshot:{profile:state.config.profile,splitEnabled:state.config.splitEnabled,splitPct:state.config.splitPct,insuranceEnabled:state.config.insuranceEnabled,insuranceDaily:state.config.insuranceDaily},customLabels:Object.fromEntries(state.config.customConcepts.map(c=>[c.id,c.label]))};
}

function calculateRecord(record){
  const v=record.values||{};
  const cfg=record.configSnapshot||state.config;
  const gross=num(record.total);
  const imbric=num(v.imbric),joinup=num(v.joinup);
  const imbricFee=imbric*.12;
  const joinupFee=joinup*.10;
  const imbricNet=imbric-imbricFee;
  const joinupNet=joinup-joinupFee;
  const adjusted=gross-imbricFee-joinupFee;
  const customExpense=Object.entries(v).filter(([k])=>k.startsWith('custom_')).reduce((s,[,value])=>s+num(value),0);
  const companyExpenses=num(v.fuel)+num(v.wash)+customExpense;
  const cashDeclared=num(v.uberCash)+num(v.freenowCash);
  const cashTpv=num(v.uberCashTpv)+num(v.freenowCashTpv);
  const platformRealCash=Math.max(0,cashDeclared-cashTpv);
  const pct=cfg.splitEnabled?Math.max(0,Math.min(100,num(cfg.splitPct))):0;
  const driverBase=cfg.profile==='driver'&&cfg.splitEnabled?adjusted*pct/100:0;
  const bossBase=cfg.profile==='driver'&&cfg.splitEnabled?adjusted-driverBase:0;
  const insurance=cfg.profile==='driver'&&cfg.insuranceEnabled?num(cfg.insuranceDaily):0;
  const driverNet=driverBase-insurance;
  const bossDeductions=num(v.card)+num(v.uber)+num(v.freenow)+num(v.abonados)+imbricNet+joinupNet+companyExpenses;
  const bossAdditions=cashDeclared;
  const bossLiquidation=bossBase-bossDeductions+bossAdditions;
  const ownerNet=adjusted-companyExpenses;
  return {gross,imbricFee,joinupFee,imbricNet,joinupNet,adjusted,companyExpenses,cashDeclared,cashTpv,platformRealCash,driverBase,bossBase,insurance,driverNet,bossDeductions,bossAdditions,bossLiquidation,ownerNet};
}

function tempRecordFromForm(){return {date:$('#dayDate').value,total:num($('#dayTotal').value),values:Object.fromEntries($$('[data-day-field]').map(i=>[i.dataset.dayField,num(i.value)]))}}
function updateLiveSummary(){
  const c=calculateRecord(tempRecordFromForm());
  let items=[['Total ajustado',money(c.adjusted),'primary']];
  if(state.config.profile==='driver'&&state.config.splitEnabled){
    items.push(['Parte chofer',money(c.driverBase),''],['Seguro chofer',money(c.insurance),''],['Neto chofer',money(c.driverNet),'good'],['Parte jefe base',money(c.bossBase),''],['Liquidación jefe',money(c.bossLiquidation),'primary']);
  }else{
    items.push(['Gastos empresa',money(c.companyExpenses),''],['Resultado tras gastos',money(c.ownerNet),'good']);
  }
  if(state.config.modules.uberCash||state.config.modules.freenowCash) items.push(['Cash plataformas real',money(c.platformRealCash),'']);
  $('#liveSummary').innerHTML=items.map(([l,v,k])=>`<div class="calc-item ${k}"><small>${l}</small><strong>${v}</strong></div>`).join('');
}

function clearDayForm(){
  $('#dayForm').reset();$('#dayDate').value=todayISO();$('#dayTotal').value='';$$('[data-day-field]').forEach(i=>i.value='0');updateLiveSummary();
}

function recentRows(){return [...state.records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10)}
function renderRecent(){
  const rows=recentRows();const t=$('#recentTable');
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Todavía no hay jornadas guardadas.</td></tr></tbody>';return}
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Total</th><th>Ajustado</th>${state.config.profile==='driver'&&state.config.splitEnabled?'<th>Neto chofer</th><th>Liquidación jefe</th>':'<th>Resultado</th>'}<th></th></tr></thead><tbody>${rows.map(r=>{const c=calculateRecord(r);return `<tr><td>${r.date}</td><td>${money(c.gross)}</td><td>${money(c.adjusted)}</td>${state.config.profile==='driver'&&state.config.splitEnabled?`<td>${money(c.driverNet)}</td><td>${money(c.bossLiquidation)}</td>`:`<td>${money(c.ownerNet)}</td>`}<td class="row-actions"><button class="mini-btn" data-delete-record="${r.id}">Eliminar</button></td></tr>`}).join('')}</tbody>`;
  $$('[data-delete-record]').forEach(b=>b.onclick=async()=>{if(confirm('¿Eliminar esta jornada?')){state.records=state.records.filter(r=>r.id!==b.dataset.deleteRecord);await persist();renderRecent();refreshAnalysis();await autoSyncExcel()}});
}

function rangeRecords(){
  const from=$('#rangeFrom').value,to=$('#rangeTo').value;
  return [...state.records].filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)).sort((a,b)=>a.date.localeCompare(b.date));
}
function sumCalc(records,key){return records.reduce((s,r)=>s+calculateRecord(r)[key],0)}
function refreshAnalysis(){
  activeAnalysis=rangeRecords();
  const n=activeAnalysis.length;
  const cards=[['Jornadas',String(n)],['Recaudación',money(sumCalc(activeAnalysis,'gross'))],['Total ajustado',money(sumCalc(activeAnalysis,'adjusted'))]];
  if(state.config.profile==='driver'&&state.config.splitEnabled){cards.push(['Neto chofer',money(sumCalc(activeAnalysis,'driverNet'))],['Liquidación jefe',money(sumCalc(activeAnalysis,'bossLiquidation'))],['Seguro',money(sumCalc(activeAnalysis,'insurance'))]);}
  else cards.push(['Gastos empresa',money(sumCalc(activeAnalysis,'companyExpenses'))],['Resultado tras gastos',money(sumCalc(activeAnalysis,'ownerNet'))]);
  if(state.config.modules.uberCash||state.config.modules.freenowCash) cards.push(['Cash plataformas real',money(sumCalc(activeAnalysis,'platformRealCash'))]);
  $('#analysisCards').innerHTML=cards.map(([l,v])=>`<div class="kpi"><small>${l}</small><strong>${v}</strong></div>`).join('');
  $('#analysisCaption').textContent=n?`${n} jornadas entre ${activeAnalysis[0].date} y ${activeAnalysis[n-1].date}`:'Sin jornadas en el rango seleccionado';
  renderAnalysisTable(activeAnalysis);
}

function activeModuleColumns(records=state.records){
  const cols=[];
  MODULES.forEach(m=>{if(state.config.modules[m.key]||records.some(r=>num(r.values?.[m.key])!==0))cols.push({key:m.key,label:m.label})});
  if(state.config.modules.uberCash||records.some(r=>num(r.values?.uberCash)!==0||num(r.values?.uberCashTpv)!==0)) cols.push({key:'uberCashTpv',label:'Uber Cash TPV'});
  if(state.config.modules.freenowCash||records.some(r=>num(r.values?.freenowCash)!==0||num(r.values?.freenowCashTpv)!==0)) cols.push({key:'freenowCashTpv',label:'FreeNow Cash TPV'});
  const custom=new Map(state.config.customConcepts.map(c=>[c.id,c.label]));
  records.forEach(r=>Object.entries(r.customLabels||{}).forEach(([id,label])=>{if(!custom.has(id))custom.set(id,label)}));
  custom.forEach((label,id)=>{if(state.config.customConcepts.some(c=>c.id===id)||records.some(r=>num(r.values?.[`custom_${id}`])!==0))cols.push({key:`custom_${id}`,label})});
  return cols;
}
function renderAnalysisTable(rows){
  const cols=activeModuleColumns();const t=$('#analysisTable');
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Sin datos.</td></tr></tbody>';return}
  const calcHeads=state.config.profile==='driver'&&state.config.splitEnabled?['Ajustado','Neto chofer','Liq. jefe']:['Ajustado','Resultado'];
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Total</th>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}${calcHeads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const c=calculateRecord(r);return `<tr><td>${r.date}</td><td>${money(c.gross)}</td>${cols.map(col=>`<td>${money(r.values?.[col.key])}</td>`).join('')}${state.config.profile==='driver'&&state.config.splitEnabled?`<td>${money(c.adjusted)}</td><td>${money(c.driverNet)}</td><td>${money(c.bossLiquidation)}</td>`:`<td>${money(c.adjusted)}</td><td>${money(c.ownerNet)}</td>`}</tr>`}).join('')}</tbody>`;
}

function renderIncomes(){
  const rows=[...state.incomes].sort((a,b)=>b.date.localeCompare(a.date));const t=$('#incomeTable');
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">No hay ingresos independientes.</td></tr></tbody>';return}
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th>Observación</th><th></th></tr></thead><tbody>${rows.map(i=>`<tr><td>${i.date}</td><td>${esc(i.concept)}</td><td>${money(i.amount)}</td><td>${esc(i.note||'')}</td><td class="row-actions"><button class="mini-btn" data-del-income="${i.id}">Eliminar</button></td></tr>`).join('')}</tbody>`;
  $$('[data-del-income]').forEach(b=>b.onclick=async()=>{state.incomes=state.incomes.filter(i=>i.id!==b.dataset.delIncome);await persist();renderIncomes();await autoSyncExcel()});
}

function excelRows(){
  const cols=activeModuleColumns();
  return state.records.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>{
    const c=calculateRecord(r);const row={Fecha:r.date,'Recaudación total':c.gross};
    cols.forEach(col=>row[col.label]=num(r.values?.[col.key]));
    row['Descuento Imbric 12%']=c.imbricFee;row['Descuento JoinUp 10%']=c.joinupFee;row['Total ajustado']=c.adjusted;
    row['Cash plataformas real']=c.platformRealCash;
    if(state.config.profile==='driver'&&state.config.splitEnabled){row['Parte chofer']=c.driverBase;row['Seguro chofer']=c.insurance;row['Neto chofer']=c.driverNet;row['Parte jefe base']=c.bossBase;row['Liquidación jefe']=c.bossLiquidation}
    else row['Resultado tras gastos']=c.ownerNet;
    row['Notas']=r.notes||'';return row;
  });
}

function buildWorkbook(){
  if(!window.XLSX) throw new Error('La librería Excel no está disponible. Abre la app con conexión una vez para cargarla.');
  const wb=XLSX.utils.book_new();
  const dayRows=excelRows();
  const ws=XLSX.utils.json_to_sheet(dayRows.length?dayRows:[{Info:'Sin jornadas todavía'}]);
  ws['!freeze']={xSplit:0,ySplit:1};XLSX.utils.book_append_sheet(wb,ws,'Jornadas');
  const inc=XLSX.utils.json_to_sheet(state.incomes.map(i=>({Fecha:i.date,Concepto:i.concept,Importe:i.amount,Observación:i.note||''})).length?state.incomes.map(i=>({Fecha:i.date,Concepto:i.concept,Importe:i.amount,Observación:i.note||''})):[{Info:'Sin ingresos independientes'}]);
  XLSX.utils.book_append_sheet(wb,inc,'Ingresos');
  const cfg=[
    {Parámetro:'Perfil',Valor:state.config.profile==='driver'?'Chofer':'Titular'},
    {Parámetro:'Reparto activo',Valor:state.config.splitEnabled?'Sí':'No'},
    {Parámetro:'Porcentaje chofer',Valor:state.config.splitPct},
    {Parámetro:'Seguro activo',Valor:state.config.insuranceEnabled?'Sí':'No'},
    {Parámetro:'Seguro diario',Valor:state.config.insuranceDaily},
    ...MODULES.map(m=>({Parámetro:`Columna ${m.label}`,Valor:state.config.modules[m.key]?'Activa':'Inactiva'})),
    ...state.config.customConcepts.map(c=>({Parámetro:'Concepto empresa',Valor:c.label}))
  ];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(cfg),'Configuración');
  return wb;
}

async function workbookBytes(){return XLSX.write(buildWorkbook(),{bookType:'xlsx',type:'array',compression:true})}
async function downloadExcel(){
  try{const bytes=await workbookBytes();const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});downloadBlob(blob,`TaxiCuenta_${todayISO()}.xlsx`);toast('Excel generado')}catch(e){alert(e.message)}
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}

async function linkExcel(){
  if(!window.showSaveFilePicker){await downloadExcel();toast('Tu navegador descargó el Excel. No permite vincularlo directamente.');return}
  try{
    const handle=await window.showSaveFilePicker({suggestedName:'TaxiCuenta.xlsx',types:[{description:'Libro de Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});
    state.excelHandle=handle;await dbSet('excelHandle',handle);await writeExcelHandle(handle,true);updateExcelStatus();toast('Excel creado y vinculado');
  }catch(e){if(e.name!=='AbortError')alert(`No se pudo vincular el Excel: ${e.message}`)}
}
async function ensureHandlePermission(handle,request=false){
  if(!handle) return false;const opts={mode:'readwrite'};if((await handle.queryPermission(opts))==='granted')return true;if(request&&(await handle.requestPermission(opts))==='granted')return true;return false;
}
async function writeExcelHandle(handle,requestPermission=false){
  if(!await ensureHandlePermission(handle,requestPermission)) throw new Error('El navegador necesita permiso para escribir en el Excel. Usa “Sincronizar ahora”.');
  const bytes=await workbookBytes();const writable=await handle.createWritable();await writable.write(bytes);await writable.close();
}
async function autoSyncExcel(){
  if(!state.excelHandle){updateExcelStatus();return}
  try{if(await ensureHandlePermission(state.excelHandle,false)){await writeExcelHandle(state.excelHandle,false);updateExcelStatus(true)}else updateExcelStatus(false,true)}catch(e){console.warn(e);updateExcelStatus(false,true)}
}
async function manualSyncExcel(){
  if(!state.excelHandle){await linkExcel();return}
  try{await writeExcelHandle(state.excelHandle,true);updateExcelStatus(true);toast('Excel sincronizado')}catch(e){alert(e.message);updateExcelStatus(false,true)}
}
function updateExcelStatus(ok=false,pending=false){
  const el=$('#excelStatus');el.classList.toggle('ok',!!state.excelHandle&&!pending);
  el.textContent=!state.excelHandle?'Excel sin vincular':pending?'Excel pendiente de permiso':ok?'Excel actualizado':'Excel vinculado';
}

function getPdfLib(){if(!window.jspdf?.jsPDF)throw new Error('La librería PDF no está disponible. Abre la app con conexión una vez.');return window.jspdf.jsPDF}
function pdfHeader(doc,title,subtitle){doc.setFontSize(18);doc.text('TaxiCuenta',14,16);doc.setFontSize(12);doc.text(title,14,24);doc.setFontSize(9);doc.text(subtitle,14,30);doc.setDrawColor(200);doc.line(14,34,196,34)}
function createDetailPdf(){
  try{
    const rows=activeAnalysis.length?activeAnalysis:rangeRecords();if(!rows.length)return toast('No hay datos en el rango');const jsPDF=getPdfLib();const doc=new jsPDF({orientation:'landscape'});pdfHeader(doc,'PDF detallado',`${rows[0].date} a ${rows[rows.length-1].date}`);
    const cols=activeModuleColumns();const head=['Fecha','Total',...cols.map(c=>c.label),'Ajustado',...(state.config.profile==='driver'&&state.config.splitEnabled?['Neto chofer','Liq. jefe']:['Resultado'])];
    const body=rows.map(r=>{const c=calculateRecord(r);return [r.date,c.gross.toFixed(2),...cols.map(col=>num(r.values?.[col.key]).toFixed(2)),c.adjusted.toFixed(2),...(state.config.profile==='driver'&&state.config.splitEnabled?[c.driverNet.toFixed(2),c.bossLiquidation.toFixed(2)]:[c.ownerNet.toFixed(2)])]});
    doc.autoTable({startY:39,head:[head],body,styles:{fontSize:7,cellPadding:2},headStyles:{fillColor:[35,45,65]}});doc.save(`TaxiCuenta_detalle_${rows[0].date}_${rows[rows.length-1].date}.pdf`);
  }catch(e){alert(e.message)}
}
function createSummaryPdf(){
  try{
    const rows=activeAnalysis.length?activeAnalysis:rangeRecords();if(!rows.length)return toast('No hay datos en el rango');const jsPDF=getPdfLib();const doc=new jsPDF();pdfHeader(doc,'PDF acumulado',`${rows[0].date} a ${rows[rows.length-1].date} · ${rows.length} jornadas`);
    const lines=[['Recaudación total',sumCalc(rows,'gross')],['Descuento Imbric 12%',sumCalc(rows,'imbricFee')],['Descuento JoinUp 10%',sumCalc(rows,'joinupFee')],['Total ajustado',sumCalc(rows,'adjusted')]];
    activeModuleColumns().forEach(col=>lines.push([col.label,rows.reduce((s,r)=>s+num(r.values?.[col.key]),0)]));
    if(state.config.profile==='driver'&&state.config.splitEnabled){lines.push(['Parte chofer',sumCalc(rows,'driverBase')],['Seguro chofer',sumCalc(rows,'insurance')],['Neto chofer',sumCalc(rows,'driverNet')],['Parte jefe base',sumCalc(rows,'bossBase')],['Liquidación jefe',sumCalc(rows,'bossLiquidation')]);}
    else lines.push(['Gastos empresa',sumCalc(rows,'companyExpenses')],['Resultado tras gastos',sumCalc(rows,'ownerNet')]);
    if(state.config.modules.uberCash||state.config.modules.freenowCash) lines.push(['Cash plataformas real (informativo)',sumCalc(rows,'platformRealCash')]);
    doc.autoTable({startY:39,head:[['Concepto','Total']],body:lines.map(([a,b])=>[a,money(b)]),columnStyles:{1:{halign:'right'}},headStyles:{fillColor:[35,45,65]}});doc.save(`TaxiCuenta_acumulado_${rows[0].date}_${rows[rows.length-1].date}.pdf`);
  }catch(e){alert(e.message)}
}

function backupJson(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),config:state.config,records:state.records,incomes:state.incomes},null,2)],{type:'application/json'});downloadBlob(blob,`TaxiCuenta_backup_${todayISO()}.json`)}
async function restoreJson(file){
  try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.records))throw new Error('Copia no válida');if(!confirm('Esto sustituirá la configuración y los datos actuales. ¿Continuar?'))return;state.config={...defaultConfig(),...(data.config||{}),modules:{...defaultConfig().modules,...(data.config?.modules||{})}};state.records=data.records||[];state.incomes=data.incomes||[];await persist();applyAppearance();syncConfigForm();renderDayFields();renderRecent();renderIncomes();refreshAnalysis();toast('Copia restaurada')}catch(e){alert(`No se pudo restaurar: ${e.message}`)}
}

function setupEvents(){
  setupTabs();
  $('#todayBtn').onclick=()=>{$('#dayDate').value=todayISO()};
  $('#clearDayBtn').onclick=clearDayForm;
  $('#dayTotal').addEventListener('input',updateLiveSummary);
  $('#dayForm').addEventListener('submit',async e=>{
    e.preventDefault();const r=collectDayForm();if(!r.date)return;if(r.total<0)return;const existing=state.records.findIndex(x=>x.date===r.date);
    if(existing>=0&&!confirm('Ya existe una jornada con esa fecha. ¿Sustituirla?'))return;
    if(existing>=0){r.id=state.records[existing].id;r.createdAt=state.records[existing].createdAt;state.records.splice(existing,1,r)}else state.records.push(r);
    await persist();renderRecent();refreshAnalysis();await autoSyncExcel();toast('Jornada guardada');clearDayForm();
  });
  $('#incomeForm').addEventListener('submit',async e=>{e.preventDefault();state.incomes.push({id:uid(),date:$('#incomeDate').value,concept:$('#incomeConcept').value.trim(),amount:num($('#incomeAmount').value),note:$('#incomeNote').value.trim()});await persist();e.target.reset();$('#incomeDate').value=todayISO();renderIncomes();await autoSyncExcel();toast('Ingreso añadido')});
  $('#applyRange').onclick=refreshAnalysis;
  $$('.chip[data-range]').forEach(b=>b.onclick=()=>{const now=new Date();if(b.dataset.range==='month'){const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');$('#rangeFrom').value=`${y}-${m}-01`;$('#rangeTo').value=todayISO()}else if(b.dataset.range==='year'){$('#rangeFrom').value=`${now.getFullYear()}-01-01`;$('#rangeTo').value=todayISO()}else{$('#rangeFrom').value='';$('#rangeTo').value=''}refreshAnalysis()});
  $('#pdfDetailBtn').onclick=createDetailPdf;$('#pdfSummaryBtn').onclick=createSummaryPdf;$('#exportExcelBtn').onclick=downloadExcel;
  $('#linkExcelBtn').onclick=linkExcel;$('#syncExcelBtn').onclick=manualSyncExcel;$('#downloadBackupBtn').onclick=backupJson;$('#restoreBackupInput').onchange=e=>e.target.files[0]&&restoreJson(e.target.files[0]);
  $('#addCustomConcept').onclick=()=>{state.config.customConcepts.push({id:uid(),label:`Otro concepto ${state.config.customConcepts.length+1}`});renderCustomConcepts()};
  $('#configForm').addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.target);state.config.profile=fd.get('profile')||'driver';state.config.splitEnabled=$('#splitEnabled').checked;state.config.splitPct=num($('#splitPct').value);state.config.insuranceEnabled=$('#insuranceEnabled').checked;state.config.insuranceDaily=num($('#insuranceDaily').value);
    $$('[data-module]').forEach(i=>state.config.modules[i.dataset.module]=i.checked);
    $$('[data-custom-label]').forEach(i=>{const c=state.config.customConcepts.find(x=>x.id===i.dataset.customLabel);if(c)c.label=i.value.trim()||'Concepto'});
    state.config.configured=true;await persist();syncConfigForm();renderDayFields();renderRecent();refreshAnalysis();updateLiveSummary();await autoSyncExcel();toast('Configuración guardada');
  });
  $$('[data-theme-choice]').forEach(b=>b.onclick=async()=>{state.config.theme=b.dataset.themeChoice;applyAppearance();await persist()});
  $('#zoomOut').onclick=async()=>{state.config.zoom=Math.max(.8,Math.round(((state.config.zoom||1)-.1)*10)/10);applyAppearance();await persist()};
  $('#zoomIn').onclick=async()=>{state.config.zoom=Math.min(1.5,Math.round(((state.config.zoom||1)+.1)*10)/10);applyAppearance();await persist()};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').classList.remove('hidden')});
  $('#installBtn').onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('#installBtn').classList.add('hidden')};
}

function setupFirstRun(){
  const d=$('#setupDialog');if(!state.config.configured&&d.showModal)d.showModal();
  $('#finishSetup').onclick=async e=>{e.preventDefault();state.config.profile=$('#setupProfile').value;state.config.insuranceDaily=num($('#setupInsurance').value);state.config.insuranceEnabled=state.config.profile==='driver';state.config.splitEnabled=state.config.profile==='driver';state.config.configured=true;await persist();d.close();syncConfigForm();renderDayFields();updateLiveSummary();toast('Perfil creado. Revisa ahora las columnas activas.')};
}

async function init(){
  await loadState();applyAppearance();setupEvents();syncConfigForm();renderDayFields();renderRecent();renderIncomes();
  $('#dayDate').value=todayISO();$('#incomeDate').value=todayISO();const now=new Date();$('#rangeFrom').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;$('#rangeTo').value=todayISO();refreshAnalysis();updateLiveSummary();setupFirstRun();
  if('serviceWorker'in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

document.addEventListener('DOMContentLoaded',init);
