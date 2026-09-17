'use strict';

const APP_KEY='taxicuenta_pwa_v1';
const DB_NAME='taxicuenta_pwa_v1_db';
const DB_VERSION=1;
const STORE='kv';

const MODULES=[
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

const CASH_DENOMINATIONS=[
  {key:'100',value:100,label:'100 €'},
  {key:'50',value:50,label:'50 €'},
  {key:'20',value:20,label:'20 €'},
  {key:'10',value:10,label:'10 €'},
  {key:'5',value:5,label:'5 €'},
  {key:'2',value:2,label:'2 €'},
  {key:'1',value:1,label:'1 €'},
  {key:'0.50',value:.50,label:'0,50 €'},
  {key:'0.20',value:.20,label:'0,20 €'},
  {key:'0.10',value:.10,label:'0,10 €'},
  {key:'0.05',value:.05,label:'0,05 €'}
];

const INCOME_DENOMINATIONS=[
  {key:'100',value:100,label:'100 €',group:'bill'},
  {key:'50',value:50,label:'50 €',group:'bill'},
  {key:'20',value:20,label:'20 €',group:'bill'},
  {key:'10',value:10,label:'10 €',group:'bill'},
  {key:'5',value:5,label:'5 €',group:'bill'},
  {key:'2',value:2,label:'2 €',group:'coin'},
  {key:'1',value:1,label:'1 €',group:'coin'},
  {key:'0.50',value:.50,label:'0,50 €',group:'coin'},
  {key:'0.20',value:.20,label:'0,20 €',group:'coin'},
  {key:'0.10',value:.10,label:'0,10 €',group:'coin'},
  {key:'0.05',value:.05,label:'0,05 €',group:'coin'},
  {key:'0.02',value:.02,label:'0,02 €',group:'coin'},
  {key:'0.01',value:.01,label:'0,01 €',group:'coin'}
];

const DAY_STATUSES={work:'Trabajo',rest:'Descanso',pending:'Descanso provisional · Pendiente',vacation:'Vacaciones',sick:'Baja',workshop:'Taller',other:'Otro'};

const NOVELTY_V2_RELEASE='2026-09-17';
const NOVELTY_V2_DAYS=5;
const NOVELTY_V2_SECONDS=10;

const defaultConfig=()=>({
  configured:false,
  profile:'driver',
  splitEnabled:true,
  splitPct:50,
  insuranceEnabled:true,
  insuranceDaily:0,
  mileageEnabled:false,
  mileageRate:0,
  payrollPdfEnabled:false,
  payrollAmount:0,
  cashBreakdownEnabled:false,
  theme:localStorage.getItem('taxicuenta_theme')||'system',
  zoom:Number(localStorage.getItem('taxicuenta_zoom')||1),
  modules:{card:true,uber:false,uberCash:false,freenow:false,freenowCash:false,abonados:false,imbric:false,joinup:false,fuel:true,wash:true},
  customConcepts:[]
});

const defaultWorkerConfig=()=>({
  profile:'driver',
  splitEnabled:true,
  splitPct:50,
  insuranceEnabled:true,
  insuranceDaily:0,
  mileageEnabled:false,
  mileageRate:0,
  modules:{card:true,uber:false,uberCash:false,freenow:false,freenowCash:false,abonados:false,imbric:false,joinup:false,fuel:true,wash:true},
  customConcepts:[]
});
const defaultWorkerState=()=>({enabled:false,name:'Chofer',config:defaultWorkerConfig(),records:[],incomes:[]});

let state={config:defaultConfig(),records:[],incomes:[],worker:defaultWorkerState(),excelHandle:null};
let deferredInstallPrompt=null;
let activeAnalysis=[];
let analysisScope='primary';
let activeAnalysisContext={scope:'primary',rows:[],ownerRows:[],workerRows:[]};
let pendingWorkerDayImport=null;

const $=sel=>document.querySelector(sel);
const $$=sel=>[...document.querySelectorAll(sel)];
const money=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(n||0));
const num=v=>Number.parseFloat(v)||0;
const todayISO=()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
const uid=()=>`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const cloneJson=value=>JSON.parse(JSON.stringify(value));
function installId(){
  let id=localStorage.getItem('taxicuenta_install_id');
  if(!id){id=`inst_${uid()}`;localStorage.setItem('taxicuenta_install_id',id)}
  return id;
}
function safeFilePart(value){return String(value||'Chofer').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||'Chofer'}
function isoDateLabel(date){const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(date||'')}

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbGet(key){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbSet(key,val){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(val,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
async function persist(){await Promise.all([dbSet('config',state.config),dbSet('records',state.records),dbSet('incomes',state.incomes),dbSet('worker',state.worker)]).catch(console.error)}

async function loadState(){
  const [config,records,incomes,worker,handle]=await Promise.all([dbGet('config'),dbGet('records'),dbGet('incomes'),dbGet('worker'),dbGet('excelHandle')]).catch(()=>[]);
  if(config) state.config={...defaultConfig(),...config,modules:{...defaultConfig().modules,...(config.modules||{})},customConcepts:Array.isArray(config.customConcepts)?config.customConcepts:[]};
  if(Array.isArray(records)) state.records=records;
  if(Array.isArray(incomes)) state.incomes=incomes;
  if(worker){
    const base=defaultWorkerState(),wc=worker.config||{};
    state.worker={...base,...worker,name:worker.name||'Chofer',records:Array.isArray(worker.records)?worker.records:[],incomes:Array.isArray(worker.incomes)?worker.incomes:[],config:{...base.config,...wc,profile:'driver',splitEnabled:true,modules:{...base.config.modules,...(wc.modules||{})},customConcepts:Array.isArray(wc.customConcepts)?wc.customConcepts:[]}};
  }
  if(handle) state.excelHandle=handle;
}

function workerEffectiveConfig(){
  const base=defaultWorkerConfig(),wc=state.worker?.config||{};
  return {...base,...wc,profile:'driver',splitEnabled:true,modules:{...base.modules,...(wc.modules||{})},customConcepts:Array.isArray(wc.customConcepts)?wc.customConcepts:[]};
}
function workerFeatureActive(){return state.config.profile==='owner'&&!!state.worker?.enabled}
function contextConfig(kind='primary'){return kind==='worker'?workerEffectiveConfig():state.config}
function contextRecords(kind='primary'){return kind==='worker'?(state.worker?.records||[]):state.records}

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
    if(btn.dataset.tab==='ingresos') renderIncomes();
    if(btn.dataset.tab==='chofer'){renderWorkerDayFields();renderWorkerRecent();}
  }));
}

function renderModuleChoices(){
  $('#moduleChoices').innerHTML=MODULES.map(m=>`<label class="module-item"><input type="checkbox" data-module="${m.key}" ${state.config.modules[m.key]?'checked':''}><span>${m.label}</span></label>`).join('');
}

function renderWorkerModuleChoices(){
  const box=$('#workerModuleChoices');if(!box)return;const cfg=workerEffectiveConfig();
  box.innerHTML=MODULES.map(m=>`<label class="module-item"><input type="checkbox" data-worker-module="${m.key}" ${cfg.modules[m.key]?'checked':''}><span>${m.label}</span></label>`).join('');
}

function renderWorkerCustomConcepts(){
  const box=$('#workerCustomConceptList');if(!box)return;const cfg=workerEffectiveConfig();
  if(!cfg.customConcepts.length){box.innerHTML='<div class="empty-state">No hay conceptos personalizados para el chofer.</div>';return}
  box.innerHTML=cfg.customConcepts.map(c=>`<div class="custom-row"><input type="text" value="${esc(c.label)}" data-worker-custom-label="${c.id}" maxlength="50"><button type="button" class="mini-btn" data-remove-worker-custom="${c.id}">Eliminar</button></div>`).join('');
  $$('[data-remove-worker-custom]').forEach(b=>b.onclick=()=>{state.worker.config.customConcepts=workerEffectiveConfig().customConcepts.filter(c=>c.id!==b.dataset.removeWorkerCustom);renderWorkerCustomConcepts()});
}

function updateWorkerFeatureVisibility(profileValue=state.config.profile){
  const owner=profileValue==='owner';const section=$('#workerConfigSection');if(section)section.classList.toggle('hidden',!owner);
  const panel=$('#workerConfigPanel');if(panel)panel.classList.toggle('hidden',!(owner&&$('#workerEnabled')?.checked));
  const tab=$('#workerTabBtn');if(tab)tab.classList.toggle('hidden',!workerFeatureActive());
  const scope=$('#analysisScopeCard');if(scope)scope.classList.toggle('hidden',!workerFeatureActive());
  if(!workerFeatureActive()&&analysisScope!=='primary')analysisScope='primary';
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
  state.config.splitEnabled=state.config.profile==='driver';
  $('#splitEnabled').checked=state.config.profile==='driver';
  $('#splitPct').value=state.config.splitPct;
  $('#insuranceEnabled').checked=!!state.config.insuranceEnabled;
  $('#insuranceDaily').value=state.config.insuranceDaily;
  $('#mileageEnabled').checked=!!state.config.mileageEnabled;
  $('#mileageRate').value=state.config.mileageRate||0;
  $('#payrollPdfEnabled').checked=!!state.config.payrollPdfEnabled;
  $('#payrollAmount').value=state.config.payrollAmount||0;
  $('#cashBreakdownEnabled').checked=!!state.config.cashBreakdownEnabled;
  const wc=workerEffectiveConfig();
  if($('#workerEnabled'))$('#workerEnabled').checked=!!state.worker.enabled;
  if($('#workerName'))$('#workerName').value=state.worker.name||'Chofer';
  if($('#workerSplitPct'))$('#workerSplitPct').value=wc.splitPct;
  if($('#workerInsuranceEnabled'))$('#workerInsuranceEnabled').checked=!!wc.insuranceEnabled;
  if($('#workerInsuranceDaily'))$('#workerInsuranceDaily').value=wc.insuranceDaily;
  if($('#workerMileageEnabled'))$('#workerMileageEnabled').checked=!!wc.mileageEnabled;
  if($('#workerMileageRate'))$('#workerMileageRate').value=wc.mileageRate||0;
  renderModuleChoices();renderCustomConcepts();renderWorkerModuleChoices();renderWorkerCustomConcepts();updateProfileBadge();updateWorkerFeatureVisibility();updateExcelStatus();
  if($('#driverShareHint'))$('#driverShareHint').classList.toggle('hidden',state.config.profile!=='driver');
  if($('#driverStartTimeField'))$('#driverStartTimeField').classList.toggle('hidden',state.config.profile!=='driver');
  if(state.config.profile!=='driver')setAccountingDateNotice('#dayDateAutoNotice','','',false);
}

function updateProfileBadge(){
  $('#profileBadge').textContent=state.config.profile==='driver'?'Perfil: Chofer':workerFeatureActive()?`Perfil: Titular + ${state.worker.name||'Chofer'}`:'Perfil: Titular de licencia';
  const h=$('#workerHeading');if(h)h.textContent=`Jornada de ${state.worker.name||'Chofer'}`;
}

function dynamicFieldHtml(key,label){
  let extra='';
  if(key==='uberCash') extra='<small class="muted">Cash declarado por Uber.</small>';
  if(key==='freenowCash') extra='<small class="muted">Cash declarado por FreeNow.</small>';
  return `<label class="field"><span>${label}</span><div class="money-input"><input data-day-field="${key}" type="number" min="0" step="0.01" inputmode="decimal" value="0"><b>€</b></div>${extra}</label>`;
}

function workerDynamicFieldHtml(key,label){
  let extra='';
  if(key==='uberCash') extra='<small class="muted">Cash declarado por Uber.</small>';
  if(key==='freenowCash') extra='<small class="muted">Cash declarado por FreeNow.</small>';
  return `<label class="field"><span>${label}</span><div class="money-input"><input data-worker-day-field="${key}" type="number" min="0" step="0.01" inputmode="decimal" value="0"><b>€</b></div>${extra}</label>`;
}

function recordConfigSnapshot(cfg){
  return {profile:cfg.profile,splitEnabled:cfg.profile==='driver',splitPct:cfg.splitPct,insuranceEnabled:cfg.insuranceEnabled,insuranceDaily:cfg.insuranceDaily,mileageEnabled:cfg.mileageEnabled,mileageRate:cfg.mileageRate};
}

function renderDayFields(){
  let html='';
  MODULES.forEach(m=>{if(state.config.modules[m.key]) html+=dynamicFieldHtml(m.key,m.label)});
  if(state.config.modules.uberCash) html+=dynamicFieldHtml('uberCashTpv','Uber Cash cobrado por TPV');
  if(state.config.modules.freenowCash) html+=dynamicFieldHtml('freenowCashTpv','FreeNow Cash cobrado por TPV');
  if(state.config.mileageEnabled){
    html+=`<label class="field"><span>Kilómetros de la jornada</span><div class="money-input"><input data-day-field="km" type="number" min="0" step="0.1" inputmode="decimal" value="0"><b>km</b></div><small class="muted">Se aplican a ${money(state.config.mileageRate||0)} por km. El descuento afecta a la parte del jefe o al resultado del titular.</small></label>`;
  }
  $('#dynamicFields').innerHTML=html;
  $('#customDayFields').innerHTML=state.config.customConcepts.map(c=>dynamicFieldHtml(`custom_${c.id}`,c.label)).join('');
  const dayOptions=$('#dayOptions');
  dayOptions.innerHTML=(state.config.profile==='driver'&&state.config.insuranceEnabled)
    ? '<label class="day-option"><input id="applyInsuranceToday" type="checkbox" checked><span>Aplicar seguro hoy</span></label>'
    : '';
  const insuranceToggle=$('#applyInsuranceToday');if(insuranceToggle) insuranceToggle.onchange=updateLiveSummary;
  $$('[data-day-field]').forEach(i=>i.oninput=updateLiveSummary);
  renderCashBreakdown();
  applyDayStatusUI();
}

function renderWorkerDayFields(){
  if(!$('#workerDynamicFields'))return;const cfg=workerEffectiveConfig();let html='';
  MODULES.forEach(m=>{if(cfg.modules[m.key])html+=workerDynamicFieldHtml(m.key,m.label)});
  if(cfg.modules.uberCash)html+=workerDynamicFieldHtml('uberCashTpv','Uber Cash cobrado por TPV');
  if(cfg.modules.freenowCash)html+=workerDynamicFieldHtml('freenowCashTpv','FreeNow Cash cobrado por TPV');
  if(cfg.mileageEnabled)html+=`<label class="field"><span>Kilómetros de la jornada</span><div class="money-input"><input data-worker-day-field="km" type="number" min="0" step="0.1" inputmode="decimal" value="0"><b>km</b></div><small class="muted">Se aplican a ${money(cfg.mileageRate||0)} por km y se descuentan de la liquidación del titular.</small></label>`;
  $('#workerDynamicFields').innerHTML=html;
  $('#workerCustomDayFields').innerHTML=cfg.customConcepts.map(c=>workerDynamicFieldHtml(`custom_${c.id}`,c.label)).join('');
  $('#workerDayOptions').innerHTML=cfg.insuranceEnabled?'<label class="day-option"><input id="workerApplyInsuranceToday" type="checkbox" checked><span>Aplicar seguro hoy</span></label>':'';
  const ins=$('#workerApplyInsuranceToday');if(ins)ins.onchange=updateWorkerLiveSummary;
  $$('[data-worker-day-field]').forEach(i=>i.oninput=updateWorkerLiveSummary);
  applyWorkerDayStatusUI();
}

function collectWorkerDayForm(){
  const cfg=workerEffectiveConfig(),status=$('#workerDayStatus')?.value||'work',values={};
  $$('[data-worker-day-field]').forEach(i=>values[i.dataset.workerDayField]=status==='work'?num(i.value):0);
  const totalDay=status==='work'?num(values.pidetaxi)+num(values.uber)+num(values.freenow):0;
  return {id:uid(),date:$('#workerDayDate').value,startTime:$('#workerDayStartTime')?.value||'',status,total:totalDay,notes:$('#workerDayNotes').value.trim(),values,insuranceApplied:status==='work'&&($('#workerApplyInsuranceToday')?$('#workerApplyInsuranceToday').checked:true),createdAt:new Date().toISOString(),configSnapshot:recordConfigSnapshot(cfg),customLabels:Object.fromEntries(cfg.customConcepts.map(c=>[c.id,c.label]))};
}

function tempWorkerRecordFromForm(){
  const cfg=workerEffectiveConfig(),status=$('#workerDayStatus')?.value||'work';
  const values=Object.fromEntries($$('[data-worker-day-field]').map(i=>[i.dataset.workerDayField,status==='work'?num(i.value):0]));
  return {date:$('#workerDayDate')?.value||'',startTime:$('#workerDayStartTime')?.value||'',status,total:status==='work'?num(values.pidetaxi)+num(values.uber)+num(values.freenow):0,values,insuranceApplied:status==='work'&&($('#workerApplyInsuranceToday')?$('#workerApplyInsuranceToday').checked:true),configSnapshot:recordConfigSnapshot(cfg)};
}

function applyWorkerDayStatusUI(){
  if(!$('#workerDayStatus'))return;const status=$('#workerDayStatus').value||'work',work=status==='work';
  $('#workerDayForm')?.classList.toggle('nonwork-day',!work);
  $$('[data-worker-day-field]').forEach(i=>{i.disabled=!work;if(!work)i.value='0'});
  const ins=$('#workerApplyInsuranceToday');if(ins){ins.disabled=!work;if(!work)ins.checked=false;else if(!ins.checked)ins.checked=true}
  updateWorkerLiveSummary();
}

function updateWorkerLiveSummary(){
  if(!$('#workerLiveSummary'))return;const cfg=workerEffectiveConfig(),temp=tempWorkerRecordFromForm(),c=calculateRecord(temp);
  if($('#workerDayTotal'))$('#workerDayTotal').value=c.gross.toFixed(2);
  const pct=Math.max(0,Math.min(100,num(cfg.splitPct))),bossPct=100-pct;
  const items=[['Total día',money(c.gross),'primary'],['Descuentos JoinUp + Imbric',money(c.totalPlatformFees),''],['Base para reparto',money(c.adjusted),'primary'],[`${pct.toLocaleString('es-ES')} % chofer`,money(c.driverBase),''],['Seguro chofer',money(c.insurance),''],['A percibir chofer',money(c.driverNet),'good'],[`${bossPct.toLocaleString('es-ES')} % titular`,money(c.bossBase),''],['Parte titular + seguro',money(c.bossWithInsurance),'']];
  if(c.mileageCost)items.push(['Descuento kilometraje al titular',money(c.mileageCost),'']);
  items.push(['Liquidación del titular',money(c.bossLiquidation),'primary']);
  if(cfg.modules.uberCash||cfg.modules.freenowCash)items.push(['Cash plataformas real',money(c.platformRealCash),'']);
  $('#workerLiveSummary').innerHTML=items.map(([l,v,k])=>{const parsed=Number(String(v).replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.'))||0;return `<div class="calc-item ${k}"><small>${l}</small><strong class="${parsed<0?'negative':''}">${v}</strong></div>`}).join('');
}

function clearWorkerDayForm(){
  if(!$('#workerDayForm'))return;$('#workerDayForm').reset();resetAccountingDateAutomation('#workerDayDate','#workerDayStartTime','#workerDateAutoNotice');$('#workerDayStatus').value='work';$$('[data-worker-day-field]').forEach(i=>i.value='0');const ins=$('#workerApplyInsuranceToday');if(ins)ins.checked=true;applyWorkerDayStatusUI();
}

function renderWorkerRecent(){
  const t=$('#workerRecentTable');if(!t)return;const rows=[...(state.worker?.records||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10),cfg=workerEffectiveConfig();
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Todavía no hay jornadas del chofer guardadas.</td></tr></tbody>';return}
  const pct=Math.max(0,Math.min(100,num(cfg.splitPct)));
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Estado</th><th>Origen</th><th>Total día</th><th>Base reparto</th><th>A percibir chofer</th><th>Liquidación titular</th><th></th></tr></thead><tbody>${rows.map(r=>{const c=calculateRecord(r),origin=r.importMeta?'<span class="import-origin-badge">JSON recibido</span>':'Manual';return `<tr><td>${r.date}</td><td>${dayStatusLabel(r)}</td><td>${origin}</td><td>${money(c.gross)}</td><td>${money(c.adjusted)}</td><td class="${c.driverNet<0?'negative':''}">${money(c.driverNet)}</td><td class="${c.bossLiquidation<0?'negative':''}">${money(c.bossLiquidation)}</td><td class="row-actions"><button class="mini-btn" data-delete-worker-record="${r.id}">Eliminar</button></td></tr>`}).join('')}</tbody>`;
  $$('[data-delete-worker-record]').forEach(b=>b.onclick=async()=>{if(confirm('¿Eliminar esta jornada del chofer?')){state.worker.records=state.worker.records.filter(r=>r.id!==b.dataset.deleteWorkerRecord);await persist();renderWorkerRecent();refreshAnalysis();await autoSyncExcel()}});
}

function collectDayForm(){
  const status=$('#dayStatus')?.value||'work';
  const values={};
  $$('[data-day-field]').forEach(i=>values[i.dataset.dayField]=status==='work'?num(i.value):0);
  const totalDay=status==='work'?num(values.pidetaxi)+num(values.uber)+num(values.freenow):0;
  return {id:uid(),date:$('#dayDate').value,startTime:state.config.profile==='driver'?($('#dayStartTime')?.value||''):'',status,total:totalDay,notes:$('#dayNotes').value.trim(),values,insuranceApplied:status==='work'&&($('#applyInsuranceToday')?$('#applyInsuranceToday').checked:true),createdAt:new Date().toISOString(),configSnapshot:recordConfigSnapshot(state.config),customLabels:Object.fromEntries(state.config.customConcepts.map(c=>[c.id,c.label]))};
}

function calculateRecord(record){
  const v=record.values||{};
  const cfg=record.configSnapshot||state.config;
  const financialActive=(record.status||'work')==='work';
  const hasPideTaxi=Object.prototype.hasOwnProperty.call(v,'pidetaxi');
  const gross=financialActive?(hasPideTaxi ? num(v.pidetaxi)+num(v.uber)+num(v.freenow) : num(record.total)):0;
  const imbric=financialActive?num(v.imbric):0,joinup=financialActive?num(v.joinup):0;
  const imbricFee=imbric*.12;
  const joinupFee=joinup*.10;
  const totalPlatformFees=imbricFee+joinupFee;
  const imbricNet=imbric-imbricFee;
  const joinupNet=joinup-joinupFee;
  const adjusted=gross-totalPlatformFees;
  const customExpense=financialActive?Object.entries(v).filter(([k])=>k.startsWith('custom_')).reduce((s,[,value])=>s+num(value),0):0;
  const companyExpenses=financialActive?(num(v.fuel)+num(v.wash)+customExpense):0;
  const mileageKm=financialActive&&cfg.mileageEnabled?num(v.km):0;
  const mileageRate=cfg.mileageEnabled?num(cfg.mileageRate):0;
  const mileageCost=mileageKm*mileageRate;
  const cashDeclared=financialActive?(num(v.uberCash)+num(v.freenowCash)):0;
  const cashTpv=financialActive?(num(v.uberCashTpv)+num(v.freenowCashTpv)):0;
  const platformRealCash=Math.max(0,cashDeclared-cashTpv);
  const isDriver=cfg.profile==='driver';
  const pct=isDriver?Math.max(0,Math.min(100,num(cfg.splitPct))):0;
  const driverBase=isDriver?adjusted*pct/100:0;
  const bossBase=isDriver?adjusted-driverBase:0;
  const insuranceApplied=financialActive&&record.insuranceApplied!==false;
  const insurance=cfg.profile==='driver'&&cfg.insuranceEnabled&&insuranceApplied?num(cfg.insuranceDaily):0;
  const driverNet=driverBase-insurance;
  const bossWithInsurance=bossBase+insurance;
  const bossDeductions=financialActive?(num(v.card)+num(v.uber)+num(v.freenow)+num(v.abonados)+imbricNet+joinupNet+companyExpenses):0;
  const bossAdditions=cashDeclared;
  const bossLiquidation=bossWithInsurance-bossDeductions-mileageCost+bossAdditions;
  const ownerNet=adjusted-companyExpenses-mileageCost;
  return {gross,imbricFee,joinupFee,totalPlatformFees,imbricNet,joinupNet,adjusted,companyExpenses,mileageKm,mileageRate,mileageCost,cashDeclared,cashTpv,platformRealCash,driverBase,bossBase,insuranceApplied,insurance,driverNet,bossWithInsurance,bossDeductions,bossAdditions,bossLiquidation,ownerNet};
}

function tempRecordFromForm(){
  const status=$('#dayStatus')?.value||'work';
  const values=Object.fromEntries($$('[data-day-field]').map(i=>[i.dataset.dayField,status==='work'?num(i.value):0]));
  const totalDay=status==='work'?num(values.pidetaxi)+num(values.uber)+num(values.freenow):0;
  return {date:$('#dayDate').value,status,total:totalDay,values,insuranceApplied:status==='work'&&($('#applyInsuranceToday')?$('#applyInsuranceToday').checked:true)};
}
function dayStatusLabel(record){return DAY_STATUSES[record?.status||'work']||'Trabajo'}
function applyDayStatusUI(){
  const status=$('#dayStatus')?.value||'work',work=status==='work';
  $('#dayForm')?.classList.toggle('nonwork-day',!work);
  $$('[data-day-field]').forEach(i=>{i.disabled=!work;if(!work)i.value='0'});
  const ins=$('#applyInsuranceToday');if(ins){ins.disabled=!work;if(!work)ins.checked=false;else if(!ins.checked)ins.checked=true}
  updateLiveSummary();
}

function splitSideLabel(side,cfg=state.config,bossName='jefe'){
  const pct=Math.max(0,Math.min(100,num(cfg.splitPct)));
  if(side==='driver') return pct===50?'50 % chofer':`${pct.toLocaleString('es-ES')} % chofer`;
  const bossPct=100-pct;
  return `${bossPct.toLocaleString('es-ES')} % ${bossName}`;
}
function updateLiveSummary(){
  const temp=tempRecordFromForm();
  const c=calculateRecord(temp);
  $('#dayTotal').value=c.gross.toFixed(2);
  let items=[
    ['Total día',money(c.gross),'primary'],
    ['Descuentos JoinUp + Imbric',money(c.totalPlatformFees),''],
    [state.config.profile==='driver'?'Base para reparto':'Base tras descuentos',money(c.adjusted),'primary']
  ];
  if(state.config.profile==='driver'){
    items.push(
      [splitSideLabel('driver'),money(c.driverBase),''],
      ['Seguro chofer',money(c.insurance),''],
      ['A percibir chofer',money(c.driverNet),'good'],
      [splitSideLabel('boss'),money(c.bossBase),''],
      ['Parte jefe + seguro',money(c.bossWithInsurance),'']
    );
    if(c.mileageCost) items.push(['Descuento kilometraje al jefe',money(c.mileageCost),'']);
    items.push(['Liquidación jefe',money(c.bossLiquidation),'primary']);
  }else{
    items.push(['Gastos empresa',money(c.companyExpenses),'']);
    if(c.mileageCost) items.push(['Coste kilometraje',money(c.mileageCost),'']);
    items.push(['Resultado tras gastos',money(c.ownerNet),'good']);
  }
  if(state.config.modules.uberCash||state.config.modules.freenowCash) items.push(['Cash plataformas real',money(c.platformRealCash),'']);
  $('#liveSummary').innerHTML=items.map(([l,v,k])=>{const parsed=Number(String(v).replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.'))||0;return `<div class="calc-item ${k}"><small>${l}</small><strong class="${parsed<0?'negative':''}">${v}</strong></div>`}).join('');
}

function clearDayForm(){
  $('#dayForm').reset();resetAccountingDateAutomation('#dayDate','#dayStartTime','#dayDateAutoNotice');if($('#dayStatus'))$('#dayStatus').value='work';$$('[data-day-field]').forEach(i=>i.value='0');const ins=$('#applyInsuranceToday');if(ins)ins.checked=true;applyDayStatusUI();
}

function hasDayAmounts(values={}){
  return Object.entries(values).some(([key,value])=>key!=='km'&&Math.abs(num(value))>0.0001);
}
function localDateFromISO(iso){const [y,m,d]=String(iso||'').split('-').map(Number);return y&&m&&d?new Date(y,m-1,d,12,0,0):null}
function isoFromLocalDate(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function previousDayISO(iso=todayISO()){const d=localDateFromISO(iso);if(!d)return iso;d.setDate(d.getDate()-1);return isoFromLocalDate(d)}
function timeToMinutes(value){const m=/^(\d{1,2}):(\d{2})$/.exec(String(value||''));if(!m)return null;const h=Number(m[1]),min=Number(m[2]);return h>=0&&h<24&&min>=0&&min<60?h*60+min:null}
function accountingDateSuggestedByStart(startTime,now=new Date()){const start=timeToMinutes(startTime);if(start===null)return null;const current=now.getHours()*60+now.getMinutes();return start>current?previousDayISO(todayISO()):todayISO()}
function setAccountingDateNotice(noticeId,date,startTime,adjusted){const n=$(noticeId);if(!n)return;if(!adjusted){n.classList.add('hidden');n.innerHTML='';return}n.classList.remove('hidden');n.innerHTML=`<b>Fecha contable ajustada automáticamente.</b> La hora de inicio (${esc(startTime)}) indica que la jornada comenzó antes de medianoche. Se utilizará <b>${esc(isoDateLabel(date))}</b>. Puedes modificar la fecha manualmente si lo necesitas.`}
function applyStartTimeAccountingDate(startId,dateId,noticeId){const start=$(startId),date=$(dateId);if(!start||!date)return;const suggested=accountingDateSuggestedByStart(start.value);if(!suggested){setAccountingDateNotice(noticeId,'','',false);return}const today=todayISO(),auto=date.dataset.autoAccountingDate!=='0',current=date.value||today;if(auto&&(current===today||date.dataset.autoAccountingDate==='1')){const changed=current!==suggested;date.value=suggested;date.dataset.autoAccountingDate='1';setAccountingDateNotice(noticeId,suggested,start.value,suggested!==today||changed&&suggested===previousDayISO(today));}else if(current===suggested&&date.dataset.autoAccountingDate==='1'){setAccountingDateNotice(noticeId,suggested,start.value,suggested!==today)}else setAccountingDateNotice(noticeId,'','',false)}
function markAccountingDateManual(dateId,noticeId){const date=$(dateId);if(date)date.dataset.autoAccountingDate='0';setAccountingDateNotice(noticeId,'','',false)}
function resetAccountingDateAutomation(dateId,startId,noticeId){const date=$(dateId),start=$(startId);if(date){date.value=todayISO();date.dataset.autoAccountingDate='1'}if(start)start.value='';setAccountingDateNotice(noticeId,'','',false)}
function eachDateISO(from,to){
  const out=[],a=localDateFromISO(from),b=localDateFromISO(to);if(!a||!b||a>b)return out;
  for(const d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(isoFromLocalDate(d));
  return out;
}
function makePendingRecord(date,cfg=state.config){return {id:`pending_${date}`,date,status:'pending',total:0,notes:'Pendiente de concretar',values:{},insuranceApplied:false,virtualPending:true,configSnapshot:recordConfigSnapshot(cfg)}}
function effectiveAnalysisBoundsForRecords(records=state.records){
  const from=$('#rangeFrom')?.value||'',to=$('#rangeTo')?.value||'',today=todayISO();
  const saved=[...(records||[])].map(r=>r.date).filter(Boolean).sort();
  const start=from||(saved[0]||today);
  const requestedEnd=to||today;
  const end=requestedEnd>today?today:requestedEnd;
  return {start,end};
}
function combinedAnalysisBounds(){
  const all=[...state.records,...(state.worker?.records||[])];return effectiveAnalysisBoundsForRecords(all);
}
function recordsWithPendingGapsFor(records,from,to,cfg){
  if(!from||!to||from>to)return [];
  const byDate=new Map((records||[]).filter(r=>r.date>=from&&r.date<=to).map(r=>[r.date,r]));
  return eachDateISO(from,to).map(date=>byDate.get(date)||makePendingRecord(date,cfg));
}
function recordsWithPendingGaps(from,to){return recordsWithPendingGapsFor(state.records,from,to,state.config)}
function rangeRecordsFor(kind='primary'){const records=contextRecords(kind),cfg=contextConfig(kind),{start,end}=effectiveAnalysisBoundsForRecords(records);return recordsWithPendingGapsFor(records,start,end,cfg)}
function recentRows(){return [...state.records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10)}
function renderRecent(){
  const rows=recentRows();const t=$('#recentTable');
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Todavía no hay jornadas guardadas.</td></tr></tbody>';return}
  const canShareDay=state.config.profile==='driver';
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Estado</th><th>Total día</th><th>${state.config.profile==='driver'?'Base reparto':'Base tras descuentos'}</th>${state.config.profile==='driver'?'<th>A percibir chofer</th><th>Liquidación jefe</th>':'<th>Resultado</th>'}<th></th></tr></thead><tbody>${rows.map(r=>{const c=calculateRecord(r);return `<tr><td>${r.date}</td><td>${dayStatusLabel(r)}</td><td>${money(c.gross)}</td><td>${money(c.adjusted)}</td>${state.config.profile==='driver'?`<td class="${c.driverNet<0?'negative':''}">${money(c.driverNet)}</td><td class="${c.bossLiquidation<0?'negative':''}">${money(c.bossLiquidation)}</td>`:`<td class="${c.ownerNet<0?'negative':''}">${money(c.ownerNet)}</td>`}<td class="row-actions">${canShareDay?`<button class="mini-btn share-day-btn" data-share-record="${r.id}">Compartir</button>`:''}<button class="mini-btn" data-delete-record="${r.id}">Eliminar</button></td></tr>`}).join('')}</tbody>`;
  $$('[data-share-record]').forEach(b=>b.onclick=()=>{const record=state.records.find(r=>r.id===b.dataset.shareRecord);if(record)shareDriverDayRecord(record)});
  $$('[data-delete-record]').forEach(b=>b.onclick=async()=>{if(confirm('¿Eliminar esta jornada?')){state.records=state.records.filter(r=>r.id!==b.dataset.deleteRecord);await persist();renderRecent();refreshAnalysis();await autoSyncExcel()}});
}

function driverDayTransferPayload(record){
  const sourceRecord=cloneJson(record),cfg=state.config;
  return {
    type:'contabilidad-taxi-jornada-chofer',
    schemaVersion:2,
    displayVersion:'V2.0',
    generatedAt:new Date().toISOString(),
    accountingDate:sourceRecord.date,
    startTime:sourceRecord.startTime||'',
    sender:{role:'driver',name:'Chofer',installId:installId()},
    transferId:`${installId()}:${sourceRecord.id}`,
    sourceConfig:{modules:{...(cfg.modules||{})},customConcepts:cloneJson(cfg.customConcepts||[])},
    record:sourceRecord
  };
}

async function shareDriverDayRecord(record){
  if(state.config.profile!=='driver')return toast('Esta opción está disponible en perfil Chofer');
  if(!record?.date)return toast('No se ha encontrado la jornada');
  const payload=driverDayTransferPayload(record),json=JSON.stringify(payload,null,2),name=`CONTABILIDAD_TAXI_JORNADA_${safeFilePart(payload.sender.name)}_${isoDateLabel(record.date)}.json`;
  const file=new File([json],name,{type:'application/json'});
  if(navigator.share){
    let supported=true;
    try{if(navigator.canShare)supported=navigator.canShare({files:[file]})}catch(_e){supported=false}
    if(supported){
      try{
        await navigator.share({title:`Jornada ${isoDateLabel(record.date)}`,text:`Jornada contable ${isoDateLabel(record.date)}${record.startTime?` · Inicio ${record.startTime}`:''} · Contabilidad Taxi`,files:[file]});
        toast('Jornada preparada para compartir');return;
      }catch(e){if(e?.name==='AbortError')return;console.warn('Compartir archivo no disponible',e)}
    }
  }
  downloadBlob(file,name);toast('JSON de la jornada descargado para compartir');
}

function normalizeImportedWorkerRecord(data){
  if(!data||data.type!=='contabilidad-taxi-jornada-chofer'||!data.record)throw new Error('El archivo no es un JSON de jornada del chofer. Usa “Copia JSON / Restaurar JSON” para una copia completa.');
  const record=cloneJson(data.record),date=String(data.accountingDate||record.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('La jornada recibida no contiene una fecha contable válida.');
  record.date=date;
  record.startTime=String(data.startTime||record.startTime||'').trim();
  if(record.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(record.startTime))record.startTime='';
  if(!record.values||typeof record.values!=='object'||Array.isArray(record.values))record.values={};
  if(!DAY_STATUSES[record.status])record.status='work';
  record.total=record.status==='work'?num(record.values.pidetaxi)+num(record.values.uber)+num(record.values.freenow):0;
  record.configSnapshot={...recordConfigSnapshot(workerEffectiveConfig()),...(record.configSnapshot||{}),profile:'driver',splitEnabled:true};
  record.customLabels=record.customLabels&&typeof record.customLabels==='object'?record.customLabels:{};
  return record;
}

function workerImportPreviewHtml(data,record){
  const c=calculateRecord(record),v=record.values||{},sender=data.sender?.name||'Chofer',pct=Math.max(0,Math.min(100,num(record.configSnapshot?.splitPct)));
  const rows=[
    ['Remitente',esc(sender)],['Fecha contable',esc(record.date)],['Hora de inicio',esc(record.startTime||'No indicada')],['Estado',esc(DAY_STATUSES[record.status]||record.status)],
    ['Total día',money(c.gross)],['Cierre PideTaxi',money(v.pidetaxi)],['Uber',money(v.uber)],['FreeNow',money(v.freenow)],['Tarjeta / TPV',money(v.card)],
    [`Reparto chofer`,`${pct.toLocaleString('es-ES')} %`],['Seguro aplicado',money(c.insurance)],['A percibir chofer',money(c.driverNet)],['Liquidación titular',money(c.bossLiquidation)]
  ];
  return `<div class="worker-import-grid">${rows.map(([l,val])=>`<div><small>${l}</small><strong>${val}</strong></div>`).join('')}</div>${record.notes?`<div class="worker-import-note"><small>Notas de la jornada</small><p>${esc(record.notes)}</p></div>`:''}`;
}

async function previewWorkerDayImport(file){
  try{
    const data=JSON.parse(await file.text());
    if(Array.isArray(data?.records)&&!data?.type)throw new Error('Has seleccionado una copia JSON completa. Para una copia completa utiliza “Restaurar JSON” en Configuración.');
    const record=normalizeImportedWorkerRecord(data);
    pendingWorkerDayImport={data,record};
    $('#workerImportSummary').innerHTML=workerImportPreviewHtml(data,record);
    const existing=state.worker.records.find(r=>r.date===record.date),warn=$('#workerImportWarning');
    if(existing){warn.classList.remove('hidden');warn.innerHTML=`<b>Ya existe una jornada del chofer con fecha ${esc(record.date)}.</b> Si confirmas, será sustituida por la jornada recibida.`}
    else{warn.classList.add('hidden');warn.innerHTML=''}
    const dlg=$('#workerImportDialog');if(dlg?.showModal)dlg.showModal();
  }catch(e){pendingWorkerDayImport=null;alert(e.message||'No se pudo leer la jornada recibida.')}finally{if($('#workerDayImportInput'))$('#workerDayImportInput').value=''}
}

async function commitWorkerDayImport(){
  if(!pendingWorkerDayImport)return;
  if(!workerFeatureActive())return alert('Activa primero “Gestionar también un chofer” en Configuración.');
  const {data}=pendingWorkerDayImport,record=cloneJson(pendingWorkerDayImport.record),existingIndex=state.worker.records.findIndex(r=>r.date===record.date),existing=existingIndex>=0?state.worker.records[existingIndex]:null;
  const sourceRecordId=String(data.record?.id||''),transferId=String(data.transferId||`${data.sender?.installId||'externo'}:${sourceRecordId||record.date}`);
  record.id=existing?.id||uid();record.createdAt=existing?.createdAt||record.createdAt||new Date().toISOString();
  record.importMeta={type:'jornada-chofer-json',transferId,sourceRecordId,sourceInstallId:data.sender?.installId||'',sourceDriverName:data.sender?.name||'Chofer',generatedAt:data.generatedAt||'',importedAt:new Date().toISOString()};
  if(existingIndex>=0)state.worker.records.splice(existingIndex,1,record);else state.worker.records.push(record);
  await persist();renderWorkerRecent();refreshAnalysis();await autoSyncExcel();
  pendingWorkerDayImport=null;$('#workerImportDialog')?.close();toast(existing?'Jornada recibida actualizada':'Jornada recibida incorporada');
}

function rangeRecords(){return rangeRecordsFor('primary')}
function sumCalc(records,key){return records.reduce((s,r)=>s+calculateRecord(r)[key],0)}
function analysisStatusStats(records){
  const out={work:0,rest:0,pending:0,vacation:0,sick:0,workshop:0,other:0};
  records.forEach(r=>{const k=r.status||'work';out[k]=(out[k]||0)+1});
  out.restIncludingPending=out.rest+out.pending;return out;
}
function analysisModuleTotal(rows,key){return rows.reduce((s,r)=>s+num(r.values?.[key]),0)}
function analysisModuleVisible(rows,key,cfg=state.config){return !!cfg.modules?.[key]||rows.some(r=>Math.abs(num(r.values?.[key]))>.0001)}
function analysisSummaryLines(rows,cfg=state.config,kind='primary'){
  const lines=[];
  const add=(label,value,tone='',key='')=>lines.push({label,value:num(value),tone,key});
  add('Total día',sumCalc(rows,'gross'),'total','gross');
  add('Cierre PideTaxi',analysisModuleTotal(rows,'pidetaxi'),'pidetaxi','pidetaxi');
  if(analysisModuleVisible(rows,'abonados',cfg)) add('Abonados',analysisModuleTotal(rows,'abonados'),'','abonados');
  if(analysisModuleVisible(rows,'uber',cfg)) add('Uber',analysisModuleTotal(rows,'uber'),'uber','uber');
  if(analysisModuleVisible(rows,'uberCash',cfg)) add('Uber Cash',analysisModuleTotal(rows,'uberCash'),'','uberCash');
  if(analysisModuleVisible(rows,'freenow',cfg)) add('FreeNow',analysisModuleTotal(rows,'freenow'),'freenow','freenow');
  if(analysisModuleVisible(rows,'freenowCash',cfg)) add('FreeNow Cash',analysisModuleTotal(rows,'freenowCash'),'','freenowCash');
  const hasJoin=analysisModuleVisible(rows,'joinup',cfg),hasImbric=analysisModuleVisible(rows,'imbric',cfg),hasBusiness=analysisModuleVisible(rows,'abonados',cfg)||hasJoin||hasImbric;
  if(hasJoin){add('JoinUp bruto',analysisModuleTotal(rows,'joinup'),'','joinup');add('Comisión JoinUp 10 %',sumCalc(rows,'joinupFee'),'','joinupFee')}
  if(hasImbric){add('Imbric bruto',analysisModuleTotal(rows,'imbric'),'','imbric');add('Comisión Imbric 12 %',sumCalc(rows,'imbricFee'),'','imbricFee')}
  if(hasBusiness){const businessNet=rows.reduce((s,r)=>{const c=calculateRecord(r);return s+num(r.values?.abonados)+c.joinupNet+c.imbricNet},0);add('Total abonados neto',businessNet,'','businessNet')}
  if(hasJoin||hasImbric)add('Total comisiones',sumCalc(rows,'totalPlatformFees'),'','fees');
  add(cfg.profile==='driver'?'Base para reparto':'Base tras descuentos',sumCalc(rows,'adjusted'),'','adjusted');
  if(cfg.profile==='driver'){
    const bossWord=kind==='worker'?'titular':'jefe';
    add(splitSideLabel('driver',cfg),sumCalc(rows,'driverBase'),'','driverBase');
    if(cfg.insuranceEnabled||sumCalc(rows,'insurance')) add('Seguro chofer',sumCalc(rows,'insurance'),'','insurance');
    if(analysisModuleVisible(rows,'card',cfg)) add('Tarjeta / TPV',analysisModuleTotal(rows,'card'),'card','card');
    if(analysisModuleVisible(rows,'fuel',cfg)) add('Gasolina',analysisModuleTotal(rows,'fuel'),'','fuel');
    if(analysisModuleVisible(rows,'wash',cfg)) add('Lavado',analysisModuleTotal(rows,'wash'),'','wash');
    (cfg.customConcepts||[]).forEach(c=>{const v=analysisModuleTotal(rows,`custom_${c.id}`);if(Math.abs(v)>.0001)add(c.label,v,'',`custom_${c.id}`)});
    if(cfg.mileageEnabled||rows.some(r=>num(r.values?.km)>0)) add('Descuento por kilometraje',sumCalc(rows,'mileageCost'),'','mileage');
    add(kind==='worker'?'Liquidación titular':'Liquidación jefe',sumCalc(rows,'bossLiquidation'),'boss','bossLiquidation');
    add(`Parte ${bossWord} + seguro`,sumCalc(rows,'bossWithInsurance'),'','bossWithInsurance');
    add('A percibir chofer',sumCalc(rows,'driverNet'),'remain','driverNet');
  }else{
    if(analysisModuleVisible(rows,'card',cfg)) add('Tarjeta / TPV',analysisModuleTotal(rows,'card'),'card','card');
    if(analysisModuleVisible(rows,'fuel',cfg)) add('Gasolina',analysisModuleTotal(rows,'fuel'),'','fuel');
    if(analysisModuleVisible(rows,'wash',cfg)) add('Lavado',analysisModuleTotal(rows,'wash'),'','wash');
    (cfg.customConcepts||[]).forEach(c=>{const v=analysisModuleTotal(rows,`custom_${c.id}`);if(Math.abs(v)>.0001)add(c.label,v,'',`custom_${c.id}`)});
    if(cfg.mileageEnabled||rows.some(r=>num(r.values?.km)>0)) add('Coste por kilometraje',sumCalc(rows,'mileageCost'),'','mileage');
    add('Resultado tras gastos',sumCalc(rows,'ownerNet'),'remain','ownerNet');
  }
  if(cfg.modules.uberCash||cfg.modules.freenowCash||rows.some(r=>num(r.values?.uberCash)||num(r.values?.freenowCash))) add('Cash plataformas real (informativo)',sumCalc(rows,'platformRealCash'),'','realCash');
  return lines;
}

function renderAnalysisCloudSummary(rows,stats,cfg=state.config,kind='primary'){
  const workdays=Math.max(0,stats.work||0),lines=analysisSummaryLines(rows,cfg,kind);
  const rowHtml=(line,value)=>`<div class="analysis-money-row ${line.tone?`tone-${line.tone}`:''}"><span>${esc(line.label)}</span><strong class="${num(value)<0?'negative':''}">${money(value)}</strong></div>`;
  const totals=$('#analysisTotalsList'),avgs=$('#analysisAveragesList');
  if(totals)totals.innerHTML=lines.map(line=>rowHtml(line,line.value)).join('');
  if(avgs)avgs.innerHTML=lines.map(line=>rowHtml(line,workdays?line.value/workdays:0)).join('');
  const badge=$('#analysisWorkdayBadge');if(badge)badge.textContent=`${workdays} día${workdays===1?'':'s'} trabajado${workdays===1?'':'s'}`;
  const liq=$('#analysisLiquidationCard'),grid=$('#analysisLiquidationGrid');
  if(liq&&grid){
    const visible=cfg.profile==='driver';liq.classList.toggle('hidden',!visible);
    if(visible){
      const boss=sumCalc(rows,'bossLiquidation'),driver=sumCalc(rows,'driverNet');
      const isMainDriver=kind==='primary'&&state.config.profile==='driver';
      const payroll=isMainDriver&&state.config.payrollPdfEnabled?num(state.config.payrollAmount):0,reference=payroll+boss;
      const cells=[
        ...(isMainDriver&&state.config.payrollPdfEnabled?[['Nómina de referencia',payroll,'editable']]:[]),
        [kind==='worker'?'Liquidación titular del período':'Liquidación jefe del período',boss,'boss'],
        ...(isMainDriver&&state.config.payrollPdfEnabled?[['A percibir según referencia',reference,'reference']]:[]),
        ['A percibir chofer',driver,'driver'],
        ...(kind==='worker'?[['Seguro percibido por el titular',sumCalc(rows,'insurance'),'insurance']]:[])
      ];
      grid.innerHTML=cells.map(([label,value,tone])=>`<div class="analysis-liquidation-item ${tone}"><small>${label}</small><strong class="${value<0?'negative':''}">${money(value)}</strong>${tone==='reference'?'<em>Nómina + liquidación jefe</em>':''}</div>`).join('');
    }
  }
  const opts=$('#pdfDriverOptions');if(opts)opts.classList.toggle('hidden',cfg.profile!=='driver');
}

function combinedReportLines(ownerRows,workerRows){
  const wcfg=workerEffectiveConfig(),lines=[];
  const add=(label,owner,worker,tone='')=>lines.push({label,owner:num(owner),worker:num(worker),total:num(owner)+num(worker),tone});
  const field=(rows,key)=>analysisModuleTotal(rows,key),calc=(rows,key)=>sumCalc(rows,key);
  const visible=key=>analysisModuleVisible(ownerRows,key,state.config)||analysisModuleVisible(workerRows,key,wcfg);
  add('Total facturación',calc(ownerRows,'gross'),calc(workerRows,'gross'),'total');
  add('Cierre PideTaxi',field(ownerRows,'pidetaxi'),field(workerRows,'pidetaxi'),'pidetaxi');
  if(visible('uber'))add('Uber',field(ownerRows,'uber'),field(workerRows,'uber'),'uber');
  if(visible('uberCash'))add('Uber Cash',field(ownerRows,'uberCash'),field(workerRows,'uberCash'));
  if(visible('freenow'))add('FreeNow',field(ownerRows,'freenow'),field(workerRows,'freenow'),'freenow');
  if(visible('freenowCash'))add('FreeNow Cash',field(ownerRows,'freenowCash'),field(workerRows,'freenowCash'));
  if(visible('card'))add('Tarjeta / TPV · esperado en banco',field(ownerRows,'card'),field(workerRows,'card'),'card');
  if(visible('abonados'))add('Abonados',field(ownerRows,'abonados'),field(workerRows,'abonados'));
  if(visible('joinup'))add('JoinUp bruto',field(ownerRows,'joinup'),field(workerRows,'joinup'));
  if(visible('imbric'))add('Imbric bruto',field(ownerRows,'imbric'),field(workerRows,'imbric'));
  if(visible('joinup')||visible('imbric'))add('Comisiones JoinUp + Imbric',calc(ownerRows,'totalPlatformFees'),calc(workerRows,'totalPlatformFees'));
  if(visible('fuel'))add('Gasolina',field(ownerRows,'fuel'),field(workerRows,'fuel'));
  if(visible('wash'))add('Lavado',field(ownerRows,'wash'),field(workerRows,'wash'));
  const otherOwner=ownerRows.reduce((s,r)=>s+Object.entries(r.values||{}).filter(([k])=>k.startsWith('custom_')).reduce((a,[,v])=>a+num(v),0),0);
  const otherWorker=workerRows.reduce((s,r)=>s+Object.entries(r.values||{}).filter(([k])=>k.startsWith('custom_')).reduce((a,[,v])=>a+num(v),0),0);
  if(Math.abs(otherOwner)+Math.abs(otherWorker)>.0001)add('Otros gastos / conceptos',otherOwner,otherWorker);
  if(state.config.mileageEnabled||wcfg.mileageEnabled||ownerRows.some(r=>num(r.values?.km))||workerRows.some(r=>num(r.values?.km)))add('Coste por kilometraje',calc(ownerRows,'mileageCost'),calc(workerRows,'mileageCost'));
  if(visible('uberCash')||visible('freenowCash'))add('Cash plataformas real · informativo',calc(ownerRows,'platformRealCash'),calc(workerRows,'platformRealCash'));
  return lines;
}

function renderCombinedAnalysis(ownerRows,workerRows){
  const table=$('#combinedSummaryTable'),grid=$('#combinedControlGrid'),lines=combinedReportLines(ownerRows,workerRows);
  const row=(l)=>`<tr class="${l.tone?`tone-${l.tone}`:''}"><td>${esc(l.label)}</td><td class="${l.owner<0?'negative':''}">${money(l.owner)}</td><td class="${l.worker<0?'negative':''}">${money(l.worker)}</td><td class="${l.total<0?'negative':''}">${money(l.total)}</td></tr>`;
  table.innerHTML=`<thead><tr><th>Concepto</th><th>Titular</th><th>${esc(state.worker.name||'Chofer')}</th><th>Total combinado</th></tr></thead><tbody>${lines.map(row).join('')}</tbody>`;
  const grossOwner=sumCalc(ownerRows,'gross'),grossWorker=sumCalc(workerRows,'gross'),tpv=analysisModuleTotal(ownerRows,'card')+analysisModuleTotal(workerRows,'card'),insurance=sumCalc(workerRows,'insurance'),driverNet=sumCalc(workerRows,'driverNet'),workerLiq=sumCalc(workerRows,'bossLiquidation'),ownerResult=sumCalc(ownerRows,'ownerNet');
  const controls=[
    ['Facturación total del taxi',grossOwner+grossWorker,'total','Titular + chofer'],
    ['Facturación titular',grossOwner,'','Sus propias jornadas'],
    [`Facturación ${state.worker.name||'chofer'}`,grossWorker,'driver','Jornadas del asalariado'],
    ['TPV esperado en cuenta bancaria',tpv,'bank','Cobros registrados como Tarjeta / TPV'],
    ['Seguro percibido del chofer',insurance,'insurance','Referencia interna; no duplica facturación'],
    ['A percibir chofer',driverNet,'driver','Referencia laboral del período'],
    ['Liquidación del chofer al titular',workerLiq,'boss','Resultado de la liquidación de sus jornadas'],
    ['Resultado del titular · sus jornadas',ownerResult,'reference','Resultado tras gastos del titular']
  ];
  grid.innerHTML=controls.map(([label,value,tone,note])=>`<div class="analysis-liquidation-item ${tone}"><small>${esc(label)}</small><strong class="${value<0?'negative':''}">${money(value)}</strong><em>${esc(note)}</em></div>`).join('');
  const os=analysisStatusStats(ownerRows),ws=analysisStatusStats(workerRows),turns=os.work+ws.work;
  $('#combinedTurnsBadge').textContent=`${turns} turno${turns===1?'':'s'} trabajado${turns===1?'':'s'}`;
}

function setAnalysisScopeButtons(){
  $$('[data-analysis-scope]').forEach(b=>b.classList.toggle('active',b.dataset.analysisScope===analysisScope));
}

function renderSinglePendingNotice(rows,label=''){const pending=rows.filter(r=>r.status==='pending'),notice=$('#analysisPendingNotice');if(!notice)return;if(pending.length){const sample=pending.slice(0,8).map(r=>r.date.split('-').reverse().join('/')).join(', '),more=pending.length>8?` y ${pending.length-8} más`:'';notice.innerHTML=`<b>${pending.length} día${pending.length===1?'':'s'} pendiente${pending.length===1?'':'s'} de concretar${label?` en ${esc(label)}`:''}.</b> Se considera${pending.length===1?'':'n'} provisionalmente descanso hasta confirmar su estado. ${sample}${more}.`;notice.classList.remove('hidden')}else notice.classList.add('hidden')}

function refreshAnalysis(){
  const combinedEnabled=workerFeatureActive();if(!combinedEnabled)analysisScope='primary';
  setAnalysisScopeButtons();$('#analysisScopeCard')?.classList.toggle('hidden',!combinedEnabled);
  const cloud=$('#analysisCloudSummaryCard'),combinedCard=$('#analysisCombinedSummaryCard'),cash=$('#cashBreakdownCard'),liq=$('#analysisLiquidationCard');
  if(combinedEnabled&&analysisScope==='combined'){
    const {start,end}=combinedAnalysisBounds(),ownerRows=recordsWithPendingGapsFor(state.records,start,end,state.config),workerRows=recordsWithPendingGapsFor(state.worker.records,start,end,workerEffectiveConfig());
    activeAnalysis=[];activeAnalysisContext={scope:'combined',rows:[],ownerRows,workerRows};
    const os=analysisStatusStats(ownerRows),ws=analysisStatusStats(workerRows),days=eachDateISO(start,end).length;
    const cards=[['Días calendario',String(days)],['Jornadas titular',String(os.work)],['Jornadas chofer',String(ws.work)],['Turnos trabajados',String(os.work+ws.work)]];
    if(os.pending||ws.pending)cards.push(['Pendientes',String(os.pending+ws.pending)]);
    $('#analysisCards').innerHTML=cards.map(([l,v])=>`<div class="kpi"><small>${l}</small><strong>${v}</strong></div>`).join('');
    $('#analysisCaption').textContent=days?`Actividad combinada entre ${start} y ${end}`:'Sin jornadas en el rango seleccionado';
    const notice=$('#analysisPendingNotice');if(os.pending||ws.pending){notice.innerHTML=`<b>Datos pendientes de concretar.</b> Titular: ${os.pending}. ${esc(state.worker.name||'Chofer')}: ${ws.pending}. Se mantienen como descansos provisionales hasta confirmar cada jornada.`;notice.classList.remove('hidden')}else notice.classList.add('hidden');
    cloud.classList.add('hidden');combinedCard.classList.remove('hidden');liq.classList.add('hidden');cash.classList.add('hidden');
    renderCombinedAnalysis(ownerRows,workerRows);renderCombinedDetailTable(ownerRows,workerRows);$('#pdfDriverOptions')?.classList.remove('hidden');return;
  }
  const kind=combinedEnabled&&analysisScope==='worker'?'worker':'primary',cfg=contextConfig(kind),rows=rangeRecordsFor(kind);activeAnalysis=rows;activeAnalysisContext={scope:kind,rows,ownerRows:kind==='primary'?rows:[],workerRows:kind==='worker'?rows:[]};
  const n=rows.length,st=analysisStatusStats(rows),restTotal=st.rest+st.pending,cards=[['Días con fecha',String(n)],['Días trabajados',String(st.work)],['Días descanso',String(restTotal)]];
  if(st.pending)cards.push(['Pendientes',String(st.pending)]);if(st.vacation)cards.push(['Vacaciones',String(st.vacation)]);if(st.sick)cards.push(['Baja',String(st.sick)]);if(st.workshop)cards.push(['Taller',String(st.workshop)]);if(st.other)cards.push(['Otro',String(st.other)]);
  $('#analysisCards').innerHTML=cards.map(([l,v])=>`<div class="kpi"><small>${l}</small><strong>${v}</strong></div>`).join('');
  $('#analysisCaption').textContent=n?`${kind==='worker'?esc(state.worker.name||'Chofer'):'Contabilidad principal'} · ${n} días entre ${rows[0].date} y ${rows[n-1].date}`:'Sin jornadas en el rango seleccionado';
  renderSinglePendingNotice(rows,kind==='worker'?(state.worker.name||'chofer'):'');
  cloud.classList.remove('hidden');combinedCard.classList.add('hidden');renderAnalysisCloudSummary(rows,st,cfg,kind);renderAnalysisTable(rows,cfg,kind);
  if(kind==='primary')renderCashBreakdown();else cash.classList.add('hidden');
}

function activeModuleColumns(records=state.records,cfg=state.config){
  const cols=[{key:'pidetaxi',label:'Cierre PideTaxi'}],exportOrder=['uber','freenow','uberCash','freenowCash','card','abonados','joinup','imbric','fuel','wash'];
  exportOrder.forEach(key=>{const m=MODULES.find(x=>x.key===key);if(m&&(cfg.modules?.[key]||records.some(r=>num(r.values?.[key])!==0)))cols.push({key:m.key,label:m.label})});
  if(cfg.modules?.uberCash||records.some(r=>num(r.values?.uberCash)!==0||num(r.values?.uberCashTpv)!==0))cols.push({key:'uberCashTpv',label:'Uber Cash TPV'});
  if(cfg.modules?.freenowCash||records.some(r=>num(r.values?.freenowCash)!==0||num(r.values?.freenowCashTpv)!==0))cols.push({key:'freenowCashTpv',label:'FreeNow Cash TPV'});
  const custom=new Map((cfg.customConcepts||[]).map(c=>[c.id,c.label]));records.forEach(r=>Object.entries(r.customLabels||{}).forEach(([id,label])=>{if(!custom.has(id))custom.set(id,label)}));
  custom.forEach((label,id)=>{if((cfg.customConcepts||[]).some(c=>c.id===id)||records.some(r=>num(r.values?.[`custom_${id}`])!==0))cols.push({key:`custom_${id}`,label})});return cols;
}
function cellMoney(v){return `<td class="${num(v)<0?'negative':''}">${money(v)}</td>`}
function renderAnalysisTable(rows,cfg=state.config,kind='primary'){
  const cols=activeModuleColumns(rows.filter(r=>!r.virtualPending),cfg),t=$('#analysisTable');if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Sin datos.</td></tr></tbody>';return}
  const calcHeads=cfg.profile==='driver'?['Base reparto','A percibir chofer',kind==='worker'?'Liq. titular':'Liq. jefe']:['Base tras descuentos','Resultado'];
  const showMileage=cfg.mileageEnabled||rows.some(r=>num(r.values?.km)>0),mileageHeads=showMileage?'<th>Km</th><th>Coste km</th>':'';
  const body=rows.map(r=>{const c=calculateRecord(r);return `<tr class="${r.status==='pending'?'pending-row':''}"><td>${r.date}</td><td>${dayStatusLabel(r)}</td>${cellMoney(c.gross)}${cols.map(col=>cellMoney(r.values?.[col.key])).join('')}${showMileage?`<td>${c.mileageKm.toLocaleString('es-ES',{maximumFractionDigits:1})}</td>${cellMoney(c.mileageCost)}`:''}${cfg.profile==='driver'?`${cellMoney(c.adjusted)}${cellMoney(c.driverNet)}${cellMoney(c.bossLiquidation)}`:`${cellMoney(c.adjusted)}${cellMoney(c.ownerNet)}`}</tr>`}).join('');
  const totals=[];totals.push(sumCalc(rows,'gross'));cols.forEach(col=>totals.push(rows.reduce((s,r)=>s+num(r.values?.[col.key]),0)));if(showMileage){totals.push(rows.reduce((s,r)=>s+calculateRecord(r).mileageKm,0),sumCalc(rows,'mileageCost'))}totals.push(sumCalc(rows,'adjusted'));if(cfg.profile==='driver')totals.push(sumCalc(rows,'driverNet'),sumCalc(rows,'bossLiquidation'));else totals.push(sumCalc(rows,'ownerNet'));
  let idx=0,totalCells=['<td>TOTAL</td>','<td>—</td>',`<td class="${totals[idx]<0?'negative':''}">${money(totals[idx++])}</td>`];cols.forEach(()=>{const v=totals[idx++];totalCells.push(`<td class="${v<0?'negative':''}">${money(v)}</td>`)});if(showMileage){const km=totals[idx++],cost=totals[idx++];totalCells.push(`<td>${km.toLocaleString('es-ES',{maximumFractionDigits:1})}</td>`,`<td class="${cost<0?'negative':''}">${money(cost)}</td>`)}const base=totals[idx++];totalCells.push(`<td class="${base<0?'negative':''}">${money(base)}</td>`);while(idx<totals.length){const v=totals[idx++];totalCells.push(`<td class="${v<0?'negative':''}">${money(v)}</td>`)}
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Estado</th><th>Total día</th>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}${mileageHeads}${calcHeads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr class="total-row">${totalCells.join('')}</tr></tfoot>`;
}

function renderCombinedDetailTable(ownerRows,workerRows){
  const t=$('#analysisTable'),cfgW=workerEffectiveConfig(),keys=['pidetaxi','uber','freenow','card','abonados','joinup','imbric','fuel','wash'],labels={pidetaxi:'PideTaxi',uber:'Uber',freenow:'FreeNow',card:'TPV',abonados:'Abonados',joinup:'JoinUp',imbric:'Imbric',fuel:'Gasolina',wash:'Lavado'};
  const visibleKeys=keys.filter(k=>analysisModuleVisible(ownerRows,k,state.config)||analysisModuleVisible(workerRows,k,cfgW));
  const items=[...ownerRows.map(r=>({origin:'Titular',kind:'owner',r})),...workerRows.map(r=>({origin:state.worker.name||'Chofer',kind:'worker',r}))].sort((a,b)=>a.r.date.localeCompare(b.r.date)||a.origin.localeCompare(b.origin));
  const body=items.map(x=>{const c=calculateRecord(x.r);return `<tr class="${x.r.status==='pending'?'pending-row':''}"><td>${x.origin}</td><td>${x.r.date}</td><td>${dayStatusLabel(x.r)}</td>${cellMoney(c.gross)}${visibleKeys.map(k=>cellMoney(x.r.values?.[k])).join('')}${x.kind==='owner'?`${cellMoney(c.ownerNet)}<td>—</td><td>—</td>`:`<td>—</td>${cellMoney(c.driverNet)}${cellMoney(c.bossLiquidation)}`}</tr>`}).join('');
  t.innerHTML=`<thead><tr><th>Origen</th><th>Fecha</th><th>Estado</th><th>Total día</th>${visibleKeys.map(k=>`<th>${labels[k]}</th>`).join('')}<th>Resultado titular</th><th>A percibir chofer</th><th>Liq. titular</th></tr></thead><tbody>${body}</tbody>`;
}

function incomeReferenceForDate(date){
  if(state.config.profile!=='driver'||!date) return 0;
  const record=state.records.find(r=>r.date===date);
  if(!record) return 0;
  return num(calculateRecord(record).driverNet);
}
function incomeReferenceForRange(from='',to=''){
  if(state.config.profile!=='driver') return 0;
  return state.records.filter(r=>r.date&&(!from||r.date>=from)&&(!to||r.date<=to))
    .reduce((sum,r)=>sum+num(calculateRecord(r).driverNet),0);
}
function incomeDenomTotal(denoms={}){
  return INCOME_DENOMINATIONS.reduce((sum,d)=>sum+Math.max(0,Math.trunc(num(denoms[d.key])))*d.value,0);
}
function normalizeIncomeRecord(i){
  if(i&&i.denoms) return i;
  // Compatibilidad con la antigua pestaña de ingresos independientes.
  return {id:i?.id||uid(),date:i?.date||'',denoms:{},total:num(i?.amount),legacyAmount:num(i?.amount),note:[i?.concept,i?.note].filter(Boolean).join(' · '),createdAt:i?.createdAt||new Date().toISOString()};
}
function renderIncomeDenominations(){
  const item=d=>`<label class="income-denomination-item"><span>${d.label}</span><input type="number" min="0" step="1" inputmode="numeric" value="0" data-income-denom="${d.key}"><small data-income-subtotal="${d.key}">0,00 €</small></label>`;
  $('#incomeBills').innerHTML=INCOME_DENOMINATIONS.filter(d=>d.group==='bill').map(item).join('');
  $('#incomeCoins').innerHTML=INCOME_DENOMINATIONS.filter(d=>d.group==='coin').map(item).join('');
  $$('[data-income-denom]').forEach(input=>input.addEventListener('input',renderIncomeDaySummary));
}
function incomeFormDenoms(){
  const denoms={};
  $$('[data-income-denom]').forEach(i=>denoms[i.dataset.incomeDenom]=Math.max(0,Math.trunc(num(i.value))));
  return denoms;
}
function renderIncomeDaySummary(){
  const denoms=incomeFormDenoms();
  INCOME_DENOMINATIONS.forEach(d=>{const el=$(`[data-income-subtotal="${d.key}"]`);if(el)el.textContent=money((denoms[d.key]||0)*d.value)});
  const total=incomeDenomTotal(denoms),target=incomeReferenceForDate($('#incomeDate')?.value||'');
  const owed=target-total;
  $('#incomeTarget').textContent=money(target);
  $('#incomeCountedTotal').textContent=money(total);
  $('#incomePaidTotal').textContent=money(total);
  $('#incomeOwed').textContent=money(owed);
  $('#incomeOwed').classList.toggle('negative',owed< -0.005);
}
function clearIncomeForm(keepDate=true){
  $$('[data-income-denom]').forEach(i=>i.value=0);
  $('#incomeNote').value='';
  if(!keepDate)$('#incomeDate').value=todayISO();
  renderIncomeDaySummary();
}
function loadIncomeForDate(date){
  clearIncomeForm(true);
  const found=state.incomes.map(normalizeIncomeRecord).find(i=>i.date===date);
  if(found){
    $$('[data-income-denom]').forEach(i=>i.value=Math.max(0,Math.trunc(num(found.denoms?.[i.dataset.incomeDenom]))));
    $('#incomeNote').value=found.note||'';
  }
  renderIncomeDaySummary();
}
function incomeRangeRecords(){
  const from=$('#incomeRangeFrom')?.value||'',to=$('#incomeRangeTo')?.value||'';
  return state.incomes.map(normalizeIncomeRecord).filter(i=>i.date&&(!from||i.date>=from)&&(!to||i.date<=to)).sort((a,b)=>a.date.localeCompare(b.date));
}
function incomeRecordFigures(i){
  const total=i.denoms&&Object.keys(i.denoms).length?incomeDenomTotal(i.denoms):num(i.legacyAmount||i.total);
  const target=incomeReferenceForDate(i.date);
  return {total,target,owed:target-total};
}
function renderIncomePeriodSummary(rows){
  const totals=Object.fromEntries(INCOME_DENOMINATIONS.map(d=>[d.key,0]));
  rows.forEach(i=>INCOME_DENOMINATIONS.forEach(d=>totals[d.key]+=Math.max(0,Math.trunc(num(i.denoms?.[d.key])))));
  const grand=rows.reduce((s,i)=>s+incomeRecordFigures(i).total,0);
  const from=$('#incomeRangeFrom')?.value||'',to=$('#incomeRangeTo')?.value||'';
  const target=incomeReferenceForRange(from,to);
  const owed=target-grand;
  const denomRows=INCOME_DENOMINATIONS.filter(d=>totals[d.key]>0).map(d=>`<tr><td>${d.label}</td><td>${totals[d.key]}</td><td>${money(totals[d.key]*d.value)}</td></tr>`).join('');
  $('#incomePeriodSummary').innerHTML=`<div class="income-kpis"><div><small>Días con ingreso</small><strong>${rows.length}</strong></div><div><small>Total ingresado</small><strong>${money(grand)}</strong></div><div><small>Referencia A percibir chofer</small><strong>${money(target)}</strong></div><div><small>Pendiente por percibir</small><strong class="${owed< -0.005?'negative':''}">${money(owed)}</strong></div></div><div class="table-wrap income-denom-summary"><table><thead><tr><th>Denominación</th><th>Unidades</th><th>Importe</th></tr></thead><tbody>${denomRows||'<tr><td colspan="3" class="empty-state">Sin denominaciones en el periodo.</td></tr>'}</tbody><tfoot><tr class="total-row"><td>TOTAL</td><td>—</td><td>${money(grand)}</td></tr></tfoot></table></div>`;
}
function renderIncomes(){
  const rows=incomeRangeRecords();const t=$('#incomeTable');
  renderIncomePeriodSummary(rows);
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">No hay ingresos guardados en este periodo.</td></tr></tbody>';return}
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Detalle</th><th>Ingresado</th><th>A percibir chofer</th><th>Pendiente</th><th>Observación</th><th></th></tr></thead><tbody>${rows.slice().reverse().map(i=>{const f=incomeRecordFigures(i);const detail=INCOME_DENOMINATIONS.filter(d=>num(i.denoms?.[d.key])>0).map(d=>`${Math.trunc(num(i.denoms[d.key]))}×${d.label}`).join(' · ')||(i.legacyAmount?'Importe legado':'—');return `<tr><td>${i.date}</td><td>${detail}</td><td>${money(f.total)}</td><td>${money(f.target)}</td><td class="${f.owed< -0.005?'negative':''}">${money(f.owed)}</td><td>${esc(i.note||'')}</td><td class="row-actions"><button class="mini-btn" data-load-income="${i.date}">Cargar</button><button class="mini-btn" data-del-income="${i.id}">Eliminar</button></td></tr>`}).join('')}</tbody>`;
  $$('[data-load-income]').forEach(b=>b.onclick=()=>{$('#incomeDate').value=b.dataset.loadIncome;loadIncomeForDate(b.dataset.loadIncome);window.scrollTo({top:$('#incomeForm').offsetTop-120,behavior:'smooth'})});
  $$('[data-del-income]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Eliminar este ingreso guardado?'))return;state.incomes=state.incomes.filter(i=>i.id!==b.dataset.delIncome);await persist();renderIncomes();await autoSyncExcel()});
}

function excelRows(records=state.records,cfg=state.config,kind='primary'){
  const cols=activeModuleColumns(records,cfg),savedDates=(records||[]).map(r=>r.date).filter(Boolean).sort();
  const rows=savedDates.length?recordsWithPendingGapsFor(records,savedDates[0],todayISO(),cfg):[];
  return rows.map(r=>{
    const c=calculateRecord(r),row={Fecha:r.date,'Hora inicio':r.startTime||'',Estado:dayStatusLabel(r),Concretado:r.status==='pending'?'No':'Sí','Total día':c.gross};
    if(kind==='worker'){row['Origen jornada']=r.importMeta?'Importada JSON':'Introducida por titular';row['ID intercambio']=r.importMeta?.transferId||''}
    cols.forEach(col=>row[col.label]=num(r.values?.[col.key]));
    row['Descuento Imbric 12%']=c.imbricFee;row['Descuento JoinUp 10%']=c.joinupFee;row['Total descuentos']=c.totalPlatformFees;row[cfg.profile==='driver'?'Base para reparto':'Base tras descuentos']=c.adjusted;row['Cash plataformas real']=c.platformRealCash;
    if(c.mileageKm||cfg.mileageEnabled){row['Kilómetros jornada']=c.mileageKm;row['Precio por km']=c.mileageRate;row[cfg.profile==='driver'?'Descuento kilometraje':'Coste kilometraje']=c.mileageCost}
    if(cfg.profile==='driver'){
      const bossWord=kind==='worker'?'titular':'jefe';row[splitSideLabel('driver',cfg)]=c.driverBase;row['Aplicar seguro']=c.insuranceApplied?'Sí':'No';row['Seguro chofer']=c.insurance;row['A percibir chofer']=c.driverNet;row[splitSideLabel('boss',cfg,bossWord)]=c.bossBase;row[`Parte ${bossWord} + seguro`]=c.bossWithInsurance;row[kind==='worker'?'Liquidación titular':'Liquidación jefe']=c.bossLiquidation;
    }else row['Resultado tras gastos']=c.ownerNet;
    row['Notas']=r.notes||'';return row;
  });
}

function configRows(cfg=state.config,kind='primary'){
  const driver=cfg.profile==='driver',boss=kind==='worker'?'Titular':'Jefe';return [
    {Parámetro:'Perfil',Valor:driver?'Chofer':'Titular'},
    ...(kind==='worker'?[{Parámetro:'Nombre / referencia',Valor:state.worker.name||'Chofer'}]:[]),
    {Parámetro:'Reparto',Valor:driver?'Sí, según porcentaje configurado':'No aplica (Titular)'},
    {Parámetro:'Porcentaje chofer',Valor:cfg.splitPct},{Parámetro:'Seguro activo',Valor:cfg.insuranceEnabled?'Sí':'No'},{Parámetro:'Seguro diario',Valor:cfg.insuranceDaily},
    {Parámetro:'Descuento por kilometraje activo',Valor:cfg.mileageEnabled?'Sí':'No'},{Parámetro:'Precio por km',Valor:cfg.mileageRate||0},
    ...(kind==='primary'?[{Parámetro:'Nómina de referencia en PDF',Valor:state.config.payrollPdfEnabled?'Sí':'No'},{Parámetro:'Importe nómina referencia',Valor:state.config.payrollAmount||0},{Parámetro:'Desglose de efectivo para jefe',Valor:state.config.cashBreakdownEnabled?'Sí':'No'}]:[]),
    ...MODULES.map(m=>({Parámetro:`Columna ${m.label}`,Valor:cfg.modules?.[m.key]?'Activa':'Inactiva'})),...(cfg.customConcepts||[]).map(c=>({Parámetro:'Concepto empresa',Valor:c.label}))
  ];
}

function combinedExcelSummaryRows(){
  if(!workerFeatureActive())return[];const all=[...state.records,...state.worker.records],dates=all.map(r=>r.date).filter(Boolean).sort();if(!dates.length)return[];
  const start=dates[0],end=todayISO(),ownerRows=recordsWithPendingGapsFor(state.records,start,end,state.config),workerRows=recordsWithPendingGapsFor(state.worker.records,start,end,workerEffectiveConfig()),lines=combinedReportLines(ownerRows,workerRows);
  const out=lines.map(l=>({Tipo:'Actividad combinada',Concepto:l.label,Titular:l.owner,Chofer:l.worker,'Total combinado':l.total}));
  const grossOwner=sumCalc(ownerRows,'gross'),grossWorker=sumCalc(workerRows,'gross'),tpv=analysisModuleTotal(ownerRows,'card')+analysisModuleTotal(workerRows,'card'),insurance=sumCalc(workerRows,'insurance'),driverNet=sumCalc(workerRows,'driverNet'),liq=sumCalc(workerRows,'bossLiquidation'),ownerResult=sumCalc(ownerRows,'ownerNet');
  [['Facturación total del taxi',grossOwner+grossWorker],['Facturación titular',grossOwner],[`Facturación ${state.worker.name||'Chofer'}`,grossWorker],['TPV esperado en cuenta bancaria',tpv],['Seguro percibido del chofer',insurance],['A percibir chofer',driverNet],['Liquidación del chofer al titular',liq],['Resultado titular · sus jornadas',ownerResult]].forEach(([label,value])=>out.push({Tipo:'Control del titular',Concepto:label,Titular:'',Chofer:'','Total combinado':value}));
  return out;
}

function buildWorkbook(){
  if(!window.XLSX) throw new Error('La librería Excel no está disponible. Abre la app con conexión una vez para cargarla.');
  const wb=XLSX.utils.book_new(),dayRows=excelRows(state.records,state.config,'primary'),ws=XLSX.utils.json_to_sheet(dayRows.length?dayRows:[{Info:'Sin jornadas todavía'}]);ws['!freeze']={xSplit:0,ySplit:1};XLSX.utils.book_append_sheet(wb,ws,'Jornadas');
  if(workerFeatureActive()){
    const wc=workerEffectiveConfig(),workerRows=excelRows(state.worker.records,wc,'worker'),wws=XLSX.utils.json_to_sheet(workerRows.length?workerRows:[{Info:'Sin jornadas del chofer todavía'}]);wws['!freeze']={xSplit:0,ySplit:1};XLSX.utils.book_append_sheet(wb,wws,'Jornadas_Chofer');
  }
  const incomeRows=state.incomes.map(normalizeIncomeRecord).sort((a,b)=>a.date.localeCompare(b.date)).map(i=>{const f=incomeRecordFigures(i),row={Fecha:i.date};INCOME_DENOMINATIONS.forEach(d=>{const q=Math.max(0,Math.trunc(num(i.denoms?.[d.key])));row[`Unid. ${d.label}`]=q;row[`Importe ${d.label}`]=q*d.value});row['Total ingresado']=f.total;row['Referencia A percibir chofer']=f.target;row['Pendiente por percibir']=f.owed;row['Observación']=i.note||'';return row});
  const inc=XLSX.utils.json_to_sheet(incomeRows.length?incomeRows:[{Info:'Sin ingresos guardados'}]);inc['!freeze']={xSplit:0,ySplit:1};XLSX.utils.book_append_sheet(wb,inc,'Ingresos');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(configRows(state.config,'primary')),'Configuración');
  if(workerFeatureActive()){
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(configRows(workerEffectiveConfig(),'worker')),'Configuración_Chofer');
    const combined=combinedExcelSummaryRows();const cs=XLSX.utils.json_to_sheet(combined.length?combined:[{Info:'Sin datos combinados'}]);cs['!freeze']={xSplit:0,ySplit:1};XLSX.utils.book_append_sheet(wb,cs,'Resumen_Combinado');
  }
  return wb;
}

async function workbookBytes(){return XLSX.write(buildWorkbook(),{bookType:'xlsx',type:'array',compression:true})}
async function downloadExcel(){
  try{const bytes=await workbookBytes();const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});downloadBlob(blob,`Contabilidad_Taxi_${todayISO()}.xlsx`);toast('Excel generado')}catch(e){alert(e.message)}
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}

async function linkExcel(){
  if(!window.showSaveFilePicker){await downloadExcel();toast('Tu navegador descargó el Excel. No permite vincularlo directamente.');return}
  try{
    const handle=await window.showSaveFilePicker({suggestedName:'Contabilidad_Taxi.xlsx',types:[{description:'Libro de Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});
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
function updateExcelStatus(ok=false,pending=false,outdated=false){
  const el=$('#excelStatus');
  el.classList.toggle('ok',!!state.excelHandle&&!pending&&!outdated);
  el.textContent=!state.excelHandle
    ? 'Excel sin vincular'
    : outdated
      ? 'Excel pendiente de sincronizar'
      : pending
        ? 'Excel pendiente de permiso'
        : ok
          ? 'Excel actualizado'
          : 'Excel vinculado';
}

function getPdfLib(){if(!window.jspdf?.jsPDF)throw new Error('La librería PDF no está disponible. Abre la app con conexión una vez.');return window.jspdf.jsPDF}
async function imageDataUrl(url){try{const r=await fetch(url);const b=await r.blob();return await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b)})}catch(_e){return null}}
async function pdfHeader(doc,title,subtitle,landscapeMode=false){
  const w=doc.internal.pageSize.getWidth();doc.setFillColor(18,50,74);doc.roundedRect(10,9,w-20,27,4,4,'F');
  const logo=await imageDataUrl('logo-contabilidad-taxi.png');if(logo){try{doc.addImage(logo,'PNG',14,12,20,20)}catch(_e){}}
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Contabilidad Taxi',logo?38:15,20);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(220,234,243);doc.text(title,logo?38:15,27);doc.setFontSize(7.5);doc.text(subtitle,w-14,28,{align:'right'});doc.setTextColor(23,48,68);
}
function pdfMoneyCell(v,total=false){const value=num(v);return {content:money(value),styles:{halign:'right',fontStyle:total?'bold':'normal',textColor:value<0?(total?[255,138,128]:[198,40,40]):(total?[255,255,255]:[23,48,68]),fillColor:total?[18,50,74]:undefined}}}
function pdfStatusFill(record){
  const status=record?.status||(record?.virtualPending?'pending':'work');
  return {
    work:[228,246,234],       // verde claro · Trabajo
    rest:[255,238,214],       // naranja claro · Descanso
    pending:[255,246,230],    // naranja muy claro · Descanso provisional
    workshop:[255,226,226],   // rojizo claro · Taller
    sick:[226,239,255],       // azul claro · Baja
    vacation:[239,229,255],   // púrpura claro · Vacaciones
    other:[240,243,246]       // gris suave · Otro
  }[status]||[255,255,255];
}
function cashCounts(){const out={};$$('[data-cash-denom]').forEach(i=>out[i.dataset.cashDenom]=Math.max(0,parseInt(i.value||'0',10)||0));return out}
function cashPreparedTotal(){const c=cashCounts();return CASH_DENOMINATIONS.reduce((s,d)=>s+(c[d.key]||0)*d.value,0)}
function currentBossTarget(){if(state.config.profile!=='driver')return 0;const rows=activeAnalysis.length?activeAnalysis:rangeRecords();return Math.max(0,sumCalc(rows,'bossLiquidation'))}
function renderCashBreakdown(){
  const card=$('#cashBreakdownCard');if(!card)return;const visible=state.config.profile==='driver'&&state.config.cashBreakdownEnabled;card.classList.toggle('hidden',!visible);if(!visible)return;
  const box=$('#cashDenominations');if(!box.dataset.ready){box.innerHTML=CASH_DENOMINATIONS.map(d=>`<div class="denomination-item"><label>${d.label}</label><input type="number" min="0" step="1" value="0" inputmode="numeric" data-cash-denom="${d.key}"></div>`).join('');$$('[data-cash-denom]').forEach(i=>i.oninput=updateCashBreakdownSummary);box.dataset.ready='1'}updateCashBreakdownSummary();
}
function updateCashBreakdownSummary(){const target=currentBossTarget(),prepared=cashPreparedTotal(),diff=prepared-target;$('#cashTargetAmount').textContent=money(target);$('#cashPreparedTotal').textContent=money(prepared);$('#cashPreparedDiff').textContent=money(diff);$('#cashPreparedDiff').classList.toggle('negative',Math.abs(diff)>.009)}
function pdfReferenceLines(rows){const lines=[];if(state.config.payrollPdfEnabled)lines.push(['Nómina de referencia',num(state.config.payrollAmount)]);return lines}
function addPdfReferences(doc,startY,rows){let y=startY;const refs=pdfReferenceLines(rows);if(refs.length){doc.autoTable({startY:y,head:[['Referencia de cierre','Importe']],body:refs.map(([l,v])=>[l,pdfMoneyCell(v)]),theme:'grid',headStyles:{fillColor:[28,77,112],textColor:[255,255,255]},styles:{fontSize:8,cellPadding:2.5},columnStyles:{1:{halign:'right'}}});y=doc.lastAutoTable.finalY+5}
  if(state.config.profile==='driver'&&state.config.cashBreakdownEnabled){const prepared=cashPreparedTotal(),target=currentBossTarget();if(prepared>0){const counts=cashCounts();const active=CASH_DENOMINATIONS.filter(d=>(counts[d.key]||0)>0);const head=active.map(d=>d.label);const qty=active.map(d=>String(counts[d.key]||0));const subt=active.map(d=>money((counts[d.key]||0)*d.value));doc.autoTable({startY:y,head:[head],body:[qty,subt],theme:'grid',headStyles:{fillColor:[28,77,112]},styles:{fontSize:7,halign:'center',cellPadding:2}});y=doc.lastAutoTable.finalY+3;const diff=prepared-target;doc.autoTable({startY:y,body:[['Objetivo liquidación jefe',pdfMoneyCell(target)],['Efectivo preparado',pdfMoneyCell(prepared)],['Diferencia',pdfMoneyCell(diff)]],theme:'grid',styles:{fontSize:8,cellPadding:2.5},columnStyles:{1:{halign:'right'}}});y=doc.lastAutoTable.finalY+5}}
  return y;
}
function pdfToneFill(tone){
  return {total:[232,241,255],pidetaxi:[255,245,217],uber:[241,234,255],freenow:[229,248,246],card:[227,248,251],boss:[255,240,227],remain:[228,248,241]}[tone]||null;
}
function addSummaryReferenceBlock(doc,startY,rows){
  let y=startY;
  if(state.config.profile!=='driver')return y;
  const includeRef=$('#pdfIncludeLiquidationRef')?.checked!==false;
  if(!includeRef)return y;
  const boss=sumCalc(rows,'bossLiquidation'),payroll=state.config.payrollPdfEnabled?num(state.config.payrollAmount):0,reference=payroll+boss;
  const data=[];
  if(state.config.payrollPdfEnabled)data.push(['Nómina de referencia',pdfMoneyCell(payroll)]);
  data.push(['Liquidación jefe del período',pdfMoneyCell(boss)]);
  if(state.config.payrollPdfEnabled)data.push(['A percibir según referencia',pdfMoneyCell(reference)]);
  doc.autoTable({startY:y,head:[['REFERENCIA DE LIQUIDACIÓN','IMPORTE']],body:data,theme:'grid',styles:{fontSize:7.7,cellPadding:2.1,textColor:[23,48,68],lineColor:[202,217,227]},headStyles:{fillColor:[18,50,74],textColor:[255,255,255]},columnStyles:{1:{halign:'right'}},didParseCell:data=>{if(data.section==='body'&&data.column.index===1&&String(data.cell.raw?.content||'').includes('-'))data.cell.styles.textColor=[198,40,40]}});
  y=doc.lastAutoTable.finalY+3;
  if(state.config.cashBreakdownEnabled){
    const prepared=cashPreparedTotal(),target=Math.max(0,boss);
    if(prepared>0){
      const counts=cashCounts(),active=CASH_DENOMINATIONS.filter(d=>(counts[d.key]||0)>0);
      if(active.length){doc.autoTable({startY:y,head:[active.map(d=>d.label)],body:[active.map(d=>String(counts[d.key]||0)),active.map(d=>money((counts[d.key]||0)*d.value))],theme:'grid',headStyles:{fillColor:[28,77,112],textColor:[255,255,255]},styles:{fontSize:6.6,halign:'center',cellPadding:1.5}});y=doc.lastAutoTable.finalY+2;}
      doc.autoTable({startY:y,body:[['Objetivo liquidación jefe',pdfMoneyCell(target)],['Efectivo preparado',pdfMoneyCell(prepared)],['Diferencia',pdfMoneyCell(prepared-target)]],theme:'grid',styles:{fontSize:7.3,cellPadding:1.8},columnStyles:{1:{halign:'right'}}});y=doc.lastAutoTable.finalY+3;
    }
  }
  return y;
}

function addWorkerReferenceBlock(doc,startY,rows){
  if($('#pdfIncludeLiquidationRef')?.checked===false)return startY;const data=[['Seguro percibido por el titular',pdfMoneyCell(sumCalc(rows,'insurance'))],['Liquidación titular del período',pdfMoneyCell(sumCalc(rows,'bossLiquidation'))]];
  if($('#pdfIncludeDriverNet')?.checked!==false)data.push(['A percibir chofer',pdfMoneyCell(sumCalc(rows,'driverNet'))]);
  doc.autoTable({startY,head:[['REFERENCIA DEL CHOFER','IMPORTE']],body:data,theme:'grid',styles:{fontSize:7.7,cellPadding:2.1,textColor:[23,48,68],lineColor:[202,217,227]},headStyles:{fillColor:[18,50,74],textColor:[255,255,255]},columnStyles:{1:{halign:'right'}}});return doc.lastAutoTable.finalY+3;
}

function addCombinedControlPdf(doc,startY,ownerRows,workerRows){
  if($('#pdfIncludeLiquidationRef')?.checked===false)return startY;const includeDriver=$('#pdfIncludeDriverNet')?.checked!==false;
  const grossOwner=sumCalc(ownerRows,'gross'),grossWorker=sumCalc(workerRows,'gross'),tpv=analysisModuleTotal(ownerRows,'card')+analysisModuleTotal(workerRows,'card'),insurance=sumCalc(workerRows,'insurance'),driverNet=sumCalc(workerRows,'driverNet'),liq=sumCalc(workerRows,'bossLiquidation'),ownerResult=sumCalc(ownerRows,'ownerNet');
  const data=[['Facturación total del taxi',pdfMoneyCell(grossOwner+grossWorker)],['TPV esperado en cuenta bancaria',pdfMoneyCell(tpv)],['Seguro percibido del chofer',pdfMoneyCell(insurance)],...(includeDriver?[['A percibir chofer',pdfMoneyCell(driverNet)]]:[]),['Liquidación del chofer al titular',pdfMoneyCell(liq)],['Resultado titular · sus jornadas',pdfMoneyCell(ownerResult)]];
  doc.autoTable({startY,head:[['CONTROL DEL TITULAR','IMPORTE']],body:data,theme:'grid',styles:{fontSize:7.5,cellPadding:2,textColor:[23,48,68],lineColor:[202,217,227]},headStyles:{fillColor:[18,50,74],textColor:[255,255,255]},columnStyles:{1:{halign:'right'}}});return doc.lastAutoTable.finalY+3;
}

async function createDetailPdf(){
  try{
    const jsPDF=getPdfLib();
    if(activeAnalysisContext.scope==='combined'){
      const {ownerRows,workerRows}=activeAnalysisContext;if(!ownerRows.length&&!workerRows.length)return toast('No hay datos en el rango');const all=[...ownerRows,...workerRows].sort((a,b)=>a.date.localeCompare(b.date)),doc=new jsPDF({orientation:'landscape'});await pdfHeader(doc,'Detalle combinado · Titular + Chofer',`${all[0].date} a ${all[all.length-1].date}`,true);
      const head=['Origen','Fecha','Estado','Total día','PideTaxi','Uber','FreeNow','TPV','Seguro','A percibir chofer','Liq. titular','Resultado titular'];
      const detailRows=[...ownerRows.map(r=>({origin:'Titular',kind:'owner',r})),...workerRows.map(r=>({origin:state.worker.name||'Chofer',kind:'worker',r}))].sort((a,b)=>a.r.date.localeCompare(b.r.date)||a.origin.localeCompare(b.origin));
      const raw=detailRows.map(x=>{const c=calculateRecord(x.r),v=x.r.values||{};return [x.origin,x.r.date,dayStatusLabel(x.r),c.gross,num(v.pidetaxi),num(v.uber),num(v.freenow),num(v.card),x.kind==='worker'?c.insurance:0,x.kind==='worker'?c.driverNet:0,x.kind==='worker'?c.bossLiquidation:0,x.kind==='owner'?c.ownerNet:0]});
      const body=raw.map(row=>row.map((v,i)=>i<3?String(v):pdfMoneyCell(v)));doc.autoTable({startY:41,head:[head],body,theme:'grid',styles:{fontSize:5.8,cellPadding:1.5,textColor:[23,48,68],lineColor:[202,217,227],lineWidth:.18},headStyles:{fillColor:[28,77,112],textColor:[255,255,255],fontStyle:'bold'},didParseCell:data=>{if(data.section!=='body')return;const fill=pdfStatusFill(detailRows[data.row.index]?.r);if(fill)data.cell.styles.fillColor=fill;}});addCombinedControlPdf(doc,doc.lastAutoTable.finalY+4,ownerRows,workerRows);doc.save(`Contabilidad_Taxi_detalle_combinado_${all[0].date}_${all[all.length-1].date}.pdf`);return;
    }
    const kind=activeAnalysisContext.scope==='worker'?'worker':'primary',cfg=contextConfig(kind),rows=activeAnalysis.length?activeAnalysis:rangeRecordsFor(kind);if(!rows.length)return toast('No hay datos en el rango');const doc=new jsPDF({orientation:'landscape'});await pdfHeader(doc,kind==='worker'?`Detalle de jornadas · ${state.worker.name||'Chofer'}`:'Detalle de jornadas · PDF detallado',`${rows[0].date} a ${rows[rows.length-1].date}`,true);
    const cols=activeModuleColumns(rows.filter(r=>!r.virtualPending),cfg),showMileage=cfg.mileageEnabled||rows.some(r=>num(r.values?.km)>0),head=['Fecha','Estado','Total día',...cols.map(c=>c.label),...(showMileage?['Km','Coste km']:[]),(cfg.profile==='driver'?'Base reparto':'Base tras descuentos'),...(cfg.profile==='driver'?['A percibir chofer',kind==='worker'?'Liq. titular':'Liq. jefe']:['Resultado'])];
    const rawRows=rows.map(r=>{const c=calculateRecord(r);return [r.date,dayStatusLabel(r),c.gross,...cols.map(col=>num(r.values?.[col.key])),...(showMileage?[c.mileageKm,c.mileageCost]:[]),c.adjusted,...(cfg.profile==='driver'?[c.driverNet,c.bossLiquidation]:[c.ownerNet])]});
    const sums=head.map((_,i)=>i===0?'TOTAL':rawRows.reduce((acc,row)=>acc+(typeof row[i]==='number'?row[i]:0),0)),body=rawRows.map(row=>row.map((v,i)=>i<=1?String(v):(showMileage&&i===3+cols.length?String(num(v).toLocaleString('es-ES',{maximumFractionDigits:1})):pdfMoneyCell(v))));
    const totalRow=sums.map((v,i)=>i===0?{content:'TOTAL',styles:{fillColor:[18,50,74],textColor:[255,255,255],fontStyle:'bold'}}:i===1?{content:'—',styles:{fillColor:[18,50,74],textColor:[255,255,255],fontStyle:'bold'}}:(showMileage&&i===3+cols.length?{content:num(v).toLocaleString('es-ES',{maximumFractionDigits:1}),styles:{fillColor:[18,50,74],textColor:[255,255,255],fontStyle:'bold',halign:'right'}}:pdfMoneyCell(v,true)));body.push(totalRow);
    doc.autoTable({startY:41,head:[head],body,theme:'grid',styles:{fontSize:6.5,cellPadding:1.8,textColor:[23,48,68],lineColor:[202,217,227],lineWidth:.2},headStyles:{fillColor:[28,77,112],textColor:[255,255,255],fontStyle:'bold'},didParseCell:data=>{if(data.section!=='body')return;if(data.row.index===body.length-1){data.cell.styles.fillColor=[18,50,74];data.cell.styles.fontStyle='bold';return}const fill=pdfStatusFill(rows[data.row.index]);if(fill)data.cell.styles.fillColor=fill;}});
    if(kind==='worker')addWorkerReferenceBlock(doc,doc.lastAutoTable.finalY+5,rows);else addPdfReferences(doc,doc.lastAutoTable.finalY+5,rows);doc.save(`Contabilidad_Taxi_detalle_${kind==='worker'?'chofer_':''}${rows[0].date}_${rows[rows.length-1].date}.pdf`);
  }catch(e){alert(e.message)}
}

async function createSummaryPdf(){
  try{
    const jsPDF=getPdfLib();
    if(activeAnalysisContext.scope==='combined'){
      const {ownerRows,workerRows}=activeAnalysisContext;if(!ownerRows.length&&!workerRows.length)return toast('No hay datos en el rango');const all=[...ownerRows,...workerRows].sort((a,b)=>a.date.localeCompare(b.date)),doc=new jsPDF();await pdfHeader(doc,'Acumulado combinado · Titular + Chofer',`${all[0].date} a ${all[all.length-1].date}`);const os=analysisStatusStats(ownerRows),ws=analysisStatusStats(workerRows);
      doc.autoTable({startY:39,body:[[{content:`Jornadas titular\n${os.work}`,styles:{fillColor:[234,243,251],textColor:[40,118,183],fontStyle:'bold'}},{content:`Jornadas chofer\n${ws.work}`,styles:{fillColor:[234,248,241],textColor:[32,134,95],fontStyle:'bold'}},{content:`Turnos trabajados\n${os.work+ws.work}`,styles:{fillColor:[255,244,232],textColor:[184,109,30],fontStyle:'bold'}}]],theme:'grid',styles:{fontSize:8.2,halign:'center',valign:'middle',cellPadding:2.2,lineColor:[202,217,227]}});
      const lines=combinedReportLines(ownerRows,workerRows),body=lines.map(l=>[l.label,pdfMoneyCell(l.owner),pdfMoneyCell(l.worker),pdfMoneyCell(l.total)]);doc.autoTable({startY:doc.lastAutoTable.finalY+3,head:[['CONCEPTO','TITULAR',String(state.worker.name||'CHOFER').toUpperCase(),'TOTAL COMBINADO']],body,theme:'grid',styles:{fontSize:6.8,cellPadding:1.65,textColor:[23,48,68],lineColor:[202,217,227],lineWidth:.18},headStyles:{fillColor:[28,77,112],textColor:[255,255,255],fontStyle:'bold'},columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}},didParseCell:data=>{if(data.section!=='body')return;const l=lines[data.row.index];if(!l)return;const fill=pdfToneFill(l.tone);if(fill)data.cell.styles.fillColor=fill;if(data.column.index>0&&num([l.owner,l.worker,l.total][data.column.index-1])<0)data.cell.styles.textColor=[198,40,40];if(l.tone)data.cell.styles.fontStyle='bold'}});
      let y=addCombinedControlPdf(doc,doc.lastAutoTable.finalY+3,ownerRows,workerRows);if(os.pending||ws.pending){doc.setFontSize(6.7);doc.setTextColor(184,109,30);doc.text(`Pendientes de concretar · Titular: ${os.pending} · ${state.worker.name||'Chofer'}: ${ws.pending}.`,12,Math.min(y+2,286))}doc.save(`Contabilidad_Taxi_acumulado_combinado_${all[0].date}_${all[all.length-1].date}.pdf`);return;
    }
    const kind=activeAnalysisContext.scope==='worker'?'worker':'primary',cfg=contextConfig(kind),rows=activeAnalysis.length?activeAnalysis:rangeRecordsFor(kind);if(!rows.length)return toast('No hay datos en el rango');const doc=new jsPDF();await pdfHeader(doc,kind==='worker'?`Acumulado · ${state.worker.name||'Chofer'}`:'Acumulado del periodo',`${rows[0].date} a ${rows[rows.length-1].date}`);const st=analysisStatusStats(rows),workdays=Math.max(0,st.work||0),restDays=st.rest+st.pending;
    doc.autoTable({startY:39,body:[[{content:`Días con fecha\n${rows.length}`,styles:{fillColor:[234,243,251],textColor:[40,118,183],fontStyle:'bold'}},{content:`Días trabajados\n${st.work}`,styles:{fillColor:[234,248,241],textColor:[32,134,95],fontStyle:'bold'}},{content:`Días descanso\n${restDays}`,styles:{fillColor:[255,244,232],textColor:[184,109,30],fontStyle:'bold'}}]],theme:'grid',styles:{fontSize:8.2,halign:'center',valign:'middle',cellPadding:2.2,lineColor:[202,217,227]}});
    let lines=analysisSummaryLines(rows,cfg,kind);if(cfg.profile==='driver'&&$('#pdfIncludeDriverNet')?.checked===false)lines=lines.filter(l=>l.key!=='driverNet');const body=lines.map(line=>[line.label,pdfMoneyCell(line.value),pdfMoneyCell(workdays?line.value/workdays:0)]);
    doc.autoTable({startY:doc.lastAutoTable.finalY+3,head:[['CONCEPTO','TOTAL DEL PERIODO','MEDIA / DÍA TRABAJADO']],body,theme:'grid',styles:{fontSize:7.2,cellPadding:1.75,textColor:[23,48,68],lineColor:[202,217,227],lineWidth:.18},headStyles:{fillColor:[28,77,112],textColor:[255,255,255],fontStyle:'bold',cellPadding:2},columnStyles:{1:{halign:'right'},2:{halign:'right'}},didParseCell:data=>{if(data.section!=='body')return;const line=lines[data.row.index];if(!line)return;const fill=pdfToneFill(line.tone);if(fill)data.cell.styles.fillColor=fill;if(data.column.index>0&&line.value<0)data.cell.styles.textColor=[198,40,40];if(line.tone)data.cell.styles.fontStyle='bold'}});
    let y=doc.lastAutoTable.finalY+3;y=kind==='worker'?addWorkerReferenceBlock(doc,y,rows):addSummaryReferenceBlock(doc,y,rows);if(st.pending){doc.setFontSize(6.7);doc.setTextColor(184,109,30);doc.text(`${st.pending} día${st.pending===1?'':'s'} pendiente${st.pending===1?'':'s'} de concretar se considera${st.pending===1?'':'n'} descanso provisional.`,12,Math.min(y+2,286))}doc.save(`Contabilidad_Taxi_acumulado_${kind==='worker'?'chofer_':''}${rows[0].date}_${rows[rows.length-1].date}.pdf`);
  }catch(e){alert(e.message)}
}

function backupJson(){const blob=new Blob([JSON.stringify({version:2,displayVersion:'V2.0',exportedAt:new Date().toISOString(),config:state.config,records:state.records,incomes:state.incomes,worker:state.worker},null,2)],{type:'application/json'});downloadBlob(blob,`Contabilidad_Taxi_backup_${todayISO()}.json`)}
async function restoreJson(file){
  try{
    const data=JSON.parse(await file.text());
    if(!data||!Array.isArray(data.records)) throw new Error('Copia no válida');
    if(!confirm('Esto sustituirá la configuración y los datos actuales de esta instalación. ¿Continuar?')) return;

    state.config={...defaultConfig(),...(data.config||{}),modules:{...defaultConfig().modules,...(data.config?.modules||{})},customConcepts:Array.isArray(data.config?.customConcepts)?data.config.customConcepts:[]};
    state.records=data.records||[];
    state.incomes=data.incomes||[];
    const baseWorker=defaultWorkerState(),rawWorker=data.worker||null,wc=rawWorker?.config||{};
    state.worker=rawWorker?{...baseWorker,...rawWorker,name:rawWorker.name||'Chofer',records:Array.isArray(rawWorker.records)?rawWorker.records:[],incomes:Array.isArray(rawWorker.incomes)?rawWorker.incomes:[],config:{...baseWorker.config,...wc,profile:'driver',splitEnabled:true,modules:{...baseWorker.config.modules,...(wc.modules||{})},customConcepts:Array.isArray(wc.customConcepts)?wc.customConcepts:[]}}:baseWorker;
    await persist();

    applyAppearance();
    syncConfigForm();
    renderDayFields();
    renderWorkerDayFields();
    renderRecent();
    renderWorkerRecent();
    renderIncomes();
    if(workerFeatureActive())analysisScope='combined';
    refreshAnalysis();

    if(state.excelHandle){
      updateExcelStatus(false,false,true);
      const syncNow=confirm('Copia JSON restaurada correctamente.\n\nEste dispositivo tiene un Excel vinculado. ¿Quieres actualizarlo ahora con los datos restaurados?');
      if(syncNow){
        try{
          await writeExcelHandle(state.excelHandle,true);
          updateExcelStatus(true);
          toast('Copia restaurada y Excel actualizado');
        }catch(syncError){
          updateExcelStatus(false,true);
          alert(`La copia se ha restaurado, pero no se pudo actualizar el Excel vinculado: ${syncError.message}\n\nPuedes intentarlo después con “Sincronizar ahora”.`);
        }
      }else{
        updateExcelStatus(false,false,true);
        toast('Copia restaurada · Excel pendiente de sincronizar');
      }
    }else{
      updateExcelStatus();
      toast('Copia restaurada');
    }
  }catch(e){
    alert(`No se pudo restaurar: ${e.message}`);
  }finally{
    const input=$('#restoreBackupInput');
    if(input) input.value='';
  }
}

function setHeaderCollapsed(collapsed){const h=$('#appHeader');if(!h)return;h.classList.toggle('header-collapsed',!!collapsed);const b=$('#headerToggleBtn');if(b){b.textContent=collapsed?'☰':'⌃';b.title=collapsed?'Mostrar cabecera':'Ocultar cabecera';b.setAttribute('aria-expanded',String(!collapsed))}}
function noveltyV2Active(){const release=localDateFromISO(NOVELTY_V2_RELEASE),now=localDateFromISO(todayISO());if(!release||!now)return false;const diff=Math.floor((now-release)/(24*60*60*1000));return diff>=0&&diff<NOVELTY_V2_DAYS}
function setupVersionNotice(){
  const notice=$('#versionNotice'),close=$('#versionNoticeClose'),toggle=$('#headerToggleBtn');if(toggle)toggle.onclick=()=>setHeaderCollapsed(!$('#appHeader')?.classList.contains('header-collapsed'));
  if(!notice)return;if(!noveltyV2Active()){notice.classList.add('hidden');return}notice.classList.remove('hidden');setHeaderCollapsed(false);
  let timer=setTimeout(()=>{notice.classList.add('hidden');setHeaderCollapsed(true)},NOVELTY_V2_SECONDS*1000);
  if(close)close.onclick=()=>{clearTimeout(timer);notice.classList.add('hidden');setHeaderCollapsed(true)};
}

function setupEvents(){
  setupTabs();
  $('#todayBtn').onclick=()=>{resetAccountingDateAutomation('#dayDate','#dayStartTime','#dayDateAutoNotice')};
  $('#dayStartTime')?.addEventListener('input',()=>{if(state.config.profile==='driver')applyStartTimeAccountingDate('#dayStartTime','#dayDate','#dayDateAutoNotice')});
  $('#dayDate')?.addEventListener('change',()=>markAccountingDateManual('#dayDate','#dayDateAutoNotice'));
  $('#dayStatus').onchange=applyDayStatusUI;
  $('#clearDayBtn').onclick=clearDayForm;
  $('#dayForm').addEventListener('submit',async e=>{
    e.preventDefault();const r=collectDayForm();if(!r.date)return;if(r.total<0)return;
    if(r.status==='work'&&!hasDayAmounts(r.values)){r.status='pending';r.notes=r.notes||'Pendiente de concretar';r.insuranceApplied=false;}
    const existing=state.records.findIndex(x=>x.date===r.date);
    if(existing>=0&&!confirm('Ya existe una jornada con esa fecha. ¿Sustituirla?'))return;
    if(existing>=0){r.id=state.records[existing].id;r.createdAt=state.records[existing].createdAt;state.records.splice(existing,1,r)}else state.records.push(r);
    await persist();renderRecent();refreshAnalysis();await autoSyncExcel();toast('Jornada guardada');clearDayForm();
  });
  $('#workerTodayBtn').onclick=()=>{resetAccountingDateAutomation('#workerDayDate','#workerDayStartTime','#workerDateAutoNotice')};
  $('#workerDayStartTime')?.addEventListener('input',()=>applyStartTimeAccountingDate('#workerDayStartTime','#workerDayDate','#workerDateAutoNotice'));
  $('#workerDayDate')?.addEventListener('change',()=>markAccountingDateManual('#workerDayDate','#workerDateAutoNotice'));
  $('#workerDayStatus').onchange=applyWorkerDayStatusUI;$('#workerClearDayBtn').onclick=clearWorkerDayForm;
  $('#workerDayForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!workerFeatureActive())return toast('Activa la contabilidad del chofer en Configuración');const r=collectWorkerDayForm();if(!r.date)return;if(r.status==='work'&&!hasDayAmounts(r.values)){r.status='pending';r.notes=r.notes||'Pendiente de concretar';r.insuranceApplied=false}
    const existing=state.worker.records.findIndex(x=>x.date===r.date);if(existing>=0&&!confirm('Ya existe una jornada del chofer con esa fecha. ¿Sustituirla?'))return;if(existing>=0){r.id=state.worker.records[existing].id;r.createdAt=state.worker.records[existing].createdAt;state.worker.records.splice(existing,1,r)}else state.worker.records.push(r);
    await persist();renderWorkerRecent();refreshAnalysis();await autoSyncExcel();toast('Jornada del chofer guardada');clearWorkerDayForm();
  });
  $('#workerDayImportInput').onchange=e=>e.target.files?.[0]&&previewWorkerDayImport(e.target.files[0]);
  $('#confirmWorkerImport').onclick=async e=>{e.preventDefault();await commitWorkerDayImport()};
  $('#cancelWorkerImport').onclick=()=>{pendingWorkerDayImport=null};
  $('#workerImportDialog')?.addEventListener('close',()=>{pendingWorkerDayImport=null});
  $('#incomeForm').addEventListener('submit',async e=>{e.preventDefault();const date=$('#incomeDate').value;if(!date)return;const denoms=incomeFormDenoms();const total=incomeDenomTotal(denoms);const target=incomeReferenceForDate(date);const record={id:uid(),date,denoms,total,targetAtSave:target,owedAtSave:target-total,note:$('#incomeNote').value.trim(),createdAt:new Date().toISOString()};const existing=state.incomes.findIndex(i=>i.date===date);if(existing>=0&&!confirm('Ya hay un ingreso guardado para esa fecha. ¿Sustituirlo?'))return;if(existing>=0){record.id=state.incomes[existing].id;record.createdAt=state.incomes[existing].createdAt||record.createdAt;state.incomes.splice(existing,1,record)}else state.incomes.push(record);await persist();renderIncomes();await autoSyncExcel();toast('Ingreso guardado')});
  $('#incomeDate').addEventListener('change',e=>loadIncomeForDate(e.target.value));
  $('#clearIncomeBtn').onclick=()=>clearIncomeForm(true);
  $('#applyIncomeRange').onclick=renderIncomes;
  $$('[data-income-range]').forEach(b=>b.onclick=()=>{const now=new Date();if(b.dataset.incomeRange==='month'){const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');$('#incomeRangeFrom').value=`${y}-${m}-01`;$('#incomeRangeTo').value=todayISO()}else{$('#incomeRangeFrom').value='';$('#incomeRangeTo').value=''}renderIncomes()});
  $$('[data-analysis-scope]').forEach(b=>b.onclick=()=>{analysisScope=b.dataset.analysisScope;refreshAnalysis()});
  $('#applyRange').onclick=refreshAnalysis;
  $$('.chip[data-range]').forEach(b=>b.onclick=()=>{const now=new Date();if(b.dataset.range==='month'){const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');$('#rangeFrom').value=`${y}-${m}-01`;$('#rangeTo').value=todayISO()}else if(b.dataset.range==='year'){$('#rangeFrom').value=`${now.getFullYear()}-01-01`;$('#rangeTo').value=todayISO()}else{$('#rangeFrom').value='';$('#rangeTo').value=''}refreshAnalysis()});
  $('#pdfDetailBtn').onclick=createDetailPdf;$('#pdfSummaryBtn').onclick=createSummaryPdf;$('#exportExcelBtn').onclick=downloadExcel;
  $('#linkExcelBtn').onclick=linkExcel;$('#syncExcelBtn').onclick=manualSyncExcel;$('#downloadBackupBtn').onclick=backupJson;$('#restoreBackupInput').onchange=e=>e.target.files[0]&&restoreJson(e.target.files[0]);
  $('#addCustomConcept').onclick=()=>{state.config.customConcepts.push({id:uid(),label:`Otro concepto ${state.config.customConcepts.length+1}`});renderCustomConcepts()};
  $('#addWorkerCustomConcept').onclick=()=>{const cfg=workerEffectiveConfig();cfg.customConcepts.push({id:uid(),label:`Otro concepto ${cfg.customConcepts.length+1}`});state.worker.config=cfg;renderWorkerCustomConcepts()};
  $('#workerEnabled').onchange=()=>updateWorkerFeatureVisibility(document.querySelector('input[name=profile]:checked')?.value||state.config.profile);
  $$('input[name=profile]').forEach(r=>r.onchange=()=>updateWorkerFeatureVisibility(r.value));
  $('#configForm').addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.target);state.config.profile=fd.get('profile')||'driver';state.config.splitEnabled=state.config.profile==='driver';state.config.splitPct=Math.max(0,Math.min(100,num($('#splitPct').value)));state.config.insuranceEnabled=$('#insuranceEnabled').checked;state.config.insuranceDaily=num($('#insuranceDaily').value);state.config.mileageEnabled=$('#mileageEnabled').checked;state.config.mileageRate=num($('#mileageRate').value);state.config.payrollPdfEnabled=$('#payrollPdfEnabled').checked;state.config.payrollAmount=num($('#payrollAmount').value);state.config.cashBreakdownEnabled=$('#cashBreakdownEnabled').checked;
    $$('[data-module]').forEach(i=>state.config.modules[i.dataset.module]=i.checked);$$('[data-custom-label]').forEach(i=>{const c=state.config.customConcepts.find(x=>x.id===i.dataset.customLabel);if(c)c.label=i.value.trim()||'Concepto'});
    state.worker.enabled=state.config.profile==='owner'&&!!$('#workerEnabled').checked;state.worker.name=$('#workerName').value.trim()||'Chofer';const wc=workerEffectiveConfig();wc.splitPct=Math.max(0,Math.min(100,num($('#workerSplitPct').value)));wc.insuranceEnabled=$('#workerInsuranceEnabled').checked;wc.insuranceDaily=num($('#workerInsuranceDaily').value);wc.mileageEnabled=$('#workerMileageEnabled').checked;wc.mileageRate=num($('#workerMileageRate').value);$$('[data-worker-module]').forEach(i=>wc.modules[i.dataset.workerModule]=i.checked);$$('[data-worker-custom-label]').forEach(i=>{const c=wc.customConcepts.find(x=>x.id===i.dataset.workerCustomLabel);if(c)c.label=i.value.trim()||'Concepto'});state.worker.config=wc;
    state.config.configured=true;if(workerFeatureActive())analysisScope='combined';else analysisScope='primary';await persist();syncConfigForm();renderDayFields();renderWorkerDayFields();renderRecent();renderWorkerRecent();refreshAnalysis();updateLiveSummary();updateWorkerLiveSummary();await autoSyncExcel();toast('Configuración guardada');
  });
  $$('[data-theme-choice]').forEach(b=>b.onclick=async()=>{state.config.theme=b.dataset.themeChoice;applyAppearance();await persist()});
  $('#zoomOut').onclick=async()=>{state.config.zoom=Math.max(.8,Math.round(((state.config.zoom||1)-.1)*10)/10);applyAppearance();await persist()};
  $('#zoomIn').onclick=async()=>{state.config.zoom=Math.min(1.5,Math.round(((state.config.zoom||1)+.1)*10)/10);applyAppearance();await persist()};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').classList.remove('hidden')});
  $('#installBtn').onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('#installBtn').classList.add('hidden')};
}

function setupFirstRun(){
  const d=$('#setupDialog');if(!state.config.configured&&d.showModal)d.showModal();
  $('#finishSetup').onclick=async e=>{e.preventDefault();state.config.profile=$('#setupProfile').value;state.config.splitPct=Math.max(0,Math.min(100,num($('#setupSplitPct').value)));state.config.insuranceDaily=num($('#setupInsurance').value);state.config.insuranceEnabled=state.config.profile==='driver';state.config.splitEnabled=state.config.profile==='driver';state.config.configured=true;await persist();d.close();syncConfigForm();renderDayFields();updateLiveSummary();toast('Perfil creado. Revisa ahora las columnas activas.')};
}

async function init(){
  await loadState();applyAppearance();renderIncomeDenominations();setupEvents();syncConfigForm();renderDayFields();renderWorkerDayFields();renderRecent();renderWorkerRecent();
  resetAccountingDateAutomation('#dayDate','#dayStartTime','#dayDateAutoNotice');resetAccountingDateAutomation('#workerDayDate','#workerDayStartTime','#workerDateAutoNotice');$('#incomeDate').value=todayISO();const now=new Date();const monthStart=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;$('#rangeFrom').value=monthStart;$('#rangeTo').value=todayISO();$('#incomeRangeFrom').value=monthStart;$('#incomeRangeTo').value=todayISO();loadIncomeForDate(todayISO());renderIncomes();if(workerFeatureActive())analysisScope='combined';refreshAnalysis();updateLiveSummary();updateWorkerLiveSummary();setupVersionNotice();setupFirstRun();
  if('serviceWorker'in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

document.addEventListener('DOMContentLoaded',init);
