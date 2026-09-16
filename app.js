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

const DAY_STATUSES={work:'Trabajo',rest:'Descanso',vacation:'Vacaciones',sick:'Baja',workshop:'Taller',other:'Otro'};

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

function collectDayForm(){
  const status=$('#dayStatus')?.value||'work';
  const values={};
  $$('[data-day-field]').forEach(i=>values[i.dataset.dayField]=status==='work'?num(i.value):0);
  const totalDay=status==='work'?num(values.pidetaxi)+num(values.uber)+num(values.freenow):0;
  return {id:uid(),date:$('#dayDate').value,status,total:totalDay,notes:$('#dayNotes').value.trim(),values,insuranceApplied:status==='work'&&($('#applyInsuranceToday')?$('#applyInsuranceToday').checked:true),createdAt:new Date().toISOString(),configSnapshot:{profile:state.config.profile,splitEnabled:state.config.splitEnabled,splitPct:state.config.splitPct,insuranceEnabled:state.config.insuranceEnabled,insuranceDaily:state.config.insuranceDaily,mileageEnabled:state.config.mileageEnabled,mileageRate:state.config.mileageRate},customLabels:Object.fromEntries(state.config.customConcepts.map(c=>[c.id,c.label]))};
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

function splitSideLabel(side){
  const pct=Math.max(0,Math.min(100,num(state.config.splitPct)));
  if(side==='driver') return pct===50?'50 % chofer':`${pct.toLocaleString('es-ES')} % chofer`;
  const bossPct=100-pct;
  return bossPct===50?'50 % jefe':`${bossPct.toLocaleString('es-ES')} % jefe`;
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
  $('#dayForm').reset();$('#dayDate').value=todayISO();if($('#dayStatus'))$('#dayStatus').value='work';$$('[data-day-field]').forEach(i=>i.value='0');const ins=$('#applyInsuranceToday');if(ins)ins.checked=true;applyDayStatusUI();
}

function recentRows(){return [...state.records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10)}
function renderRecent(){
  const rows=recentRows();const t=$('#recentTable');
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Todavía no hay jornadas guardadas.</td></tr></tbody>';return}
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Estado</th><th>Total día</th><th>${state.config.profile==='driver'?'Base reparto':'Base tras descuentos'}</th>${state.config.profile==='driver'?'<th>A percibir chofer</th><th>Liquidación jefe</th>':'<th>Resultado</th>'}<th></th></tr></thead><tbody>${rows.map(r=>{const c=calculateRecord(r);return `<tr><td>${r.date}</td><td>${dayStatusLabel(r)}</td><td>${money(c.gross)}</td><td>${money(c.adjusted)}</td>${state.config.profile==='driver'?`<td class="${c.driverNet<0?'negative':''}">${money(c.driverNet)}</td><td class="${c.bossLiquidation<0?'negative':''}">${money(c.bossLiquidation)}</td>`:`<td class="${c.ownerNet<0?'negative':''}">${money(c.ownerNet)}</td>`}<td class="row-actions"><button class="mini-btn" data-delete-record="${r.id}">Eliminar</button></td></tr>`}).join('')}</tbody>`;
  $$('[data-delete-record]').forEach(b=>b.onclick=async()=>{if(confirm('¿Eliminar esta jornada?')){state.records=state.records.filter(r=>r.id!==b.dataset.deleteRecord);await persist();renderRecent();refreshAnalysis();await autoSyncExcel()}});
}

function rangeRecords(){
  const from=$('#rangeFrom').value,to=$('#rangeTo').value;
  return [...state.records].filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)).sort((a,b)=>a.date.localeCompare(b.date));
}
function sumCalc(records,key){return records.reduce((s,r)=>s+calculateRecord(r)[key],0)}
function analysisStatusStats(records){const out={work:0,rest:0,vacation:0,sick:0,workshop:0,other:0};records.forEach(r=>{const k=r.status||'work';out[k]=(out[k]||0)+1});return out}
function refreshAnalysis(){
  activeAnalysis=rangeRecords();
  const n=activeAnalysis.length;
  const st=analysisStatusStats(activeAnalysis);
  const cards=[['Días con registro',String(n)],['Trabajados',String(st.work)],['Descanso',String(st.rest)],['Vacaciones',String(st.vacation)],['Baja',String(st.sick)],['Taller',String(st.workshop)],['Total día',money(sumCalc(activeAnalysis,'gross'))],['Total descuentos',money(sumCalc(activeAnalysis,'totalPlatformFees'))],[state.config.profile==='driver'?'Base reparto':'Base tras descuentos',money(sumCalc(activeAnalysis,'adjusted'))]];
  if(state.config.profile==='driver'){cards.push(['A percibir chofer',money(sumCalc(activeAnalysis,'driverNet'))],['Liquidación jefe',money(sumCalc(activeAnalysis,'bossLiquidation'))],['Seguro',money(sumCalc(activeAnalysis,'insurance'))]);}
  else cards.push(['Gastos empresa',money(sumCalc(activeAnalysis,'companyExpenses'))],['Resultado tras gastos',money(sumCalc(activeAnalysis,'ownerNet'))]);
  if(state.config.mileageEnabled||activeAnalysis.some(r=>num(r.values?.km)>0)){cards.push(['Kilómetros',activeAnalysis.reduce((s,r)=>s+calculateRecord(r).mileageKm,0).toLocaleString('es-ES',{maximumFractionDigits:1})+' km'],['Descuento km',money(sumCalc(activeAnalysis,'mileageCost'))]);}
  if(state.config.modules.uberCash||state.config.modules.freenowCash) cards.push(['Cash plataformas real',money(sumCalc(activeAnalysis,'platformRealCash'))]);
  $('#analysisCards').innerHTML=cards.map(([l,v])=>{const parsed=Number(String(v).replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.'))||0;return `<div class="kpi"><small>${l}</small><strong class="${parsed<0?'negative':''}">${v}</strong></div>`}).join('');
  $('#analysisCaption').textContent=n?`${n} días registrados entre ${activeAnalysis[0].date} y ${activeAnalysis[n-1].date}`:'Sin jornadas en el rango seleccionado';
  renderAnalysisTable(activeAnalysis);
  renderCashBreakdown();
}

function activeModuleColumns(records=state.records){
  const cols=[{key:'pidetaxi',label:'Cierre PideTaxi'}];
  const exportOrder=['uber','freenow','uberCash','freenowCash','card','cash','abonados','joinup','imbric','fuel','wash'];
  exportOrder.forEach(key=>{const m=MODULES.find(x=>x.key===key);if(m&&(state.config.modules[key]||records.some(r=>num(r.values?.[key])!==0)))cols.push({key:m.key,label:m.label})});
  if(state.config.modules.uberCash||records.some(r=>num(r.values?.uberCash)!==0||num(r.values?.uberCashTpv)!==0)) cols.push({key:'uberCashTpv',label:'Uber Cash TPV'});
  if(state.config.modules.freenowCash||records.some(r=>num(r.values?.freenowCash)!==0||num(r.values?.freenowCashTpv)!==0)) cols.push({key:'freenowCashTpv',label:'FreeNow Cash TPV'});
  const custom=new Map(state.config.customConcepts.map(c=>[c.id,c.label]));
  records.forEach(r=>Object.entries(r.customLabels||{}).forEach(([id,label])=>{if(!custom.has(id))custom.set(id,label)}));
  custom.forEach((label,id)=>{if(state.config.customConcepts.some(c=>c.id===id)||records.some(r=>num(r.values?.[`custom_${id}`])!==0))cols.push({key:`custom_${id}`,label})});
  return cols;
}
function cellMoney(v){return `<td class="${num(v)<0?'negative':''}">${money(v)}</td>`}
function renderAnalysisTable(rows){
  const cols=activeModuleColumns();const t=$('#analysisTable');
  if(!rows.length){t.innerHTML='<tbody><tr><td class="empty-state">Sin datos.</td></tr></tbody>';return}
  const calcHeads=state.config.profile==='driver'?['Base reparto','A percibir chofer','Liq. jefe']:['Base tras descuentos','Resultado'];
  const showMileage=state.config.mileageEnabled||rows.some(r=>num(r.values?.km)>0);
  const mileageHeads=showMileage?'<th>Km</th><th>Coste km</th>':'';
  const body=rows.map(r=>{const c=calculateRecord(r);return `<tr><td>${r.date}</td><td>${dayStatusLabel(r)}</td>${cellMoney(c.gross)}${cols.map(col=>cellMoney(r.values?.[col.key])).join('')}${showMileage?`<td>${c.mileageKm.toLocaleString('es-ES',{maximumFractionDigits:1})}</td>${cellMoney(c.mileageCost)}`:''}${state.config.profile==='driver'?`${cellMoney(c.adjusted)}${cellMoney(c.driverNet)}${cellMoney(c.bossLiquidation)}`:`${cellMoney(c.adjusted)}${cellMoney(c.ownerNet)}`}</tr>`}).join('');
  const totals=[];totals.push(sumCalc(rows,'gross'));cols.forEach(col=>totals.push(rows.reduce((s,r)=>s+num(r.values?.[col.key]),0)));if(showMileage){totals.push(rows.reduce((s,r)=>s+calculateRecord(r).mileageKm,0));totals.push(sumCalc(rows,'mileageCost'))}totals.push(sumCalc(rows,'adjusted'));if(state.config.profile==='driver'){totals.push(sumCalc(rows,'driverNet'),sumCalc(rows,'bossLiquidation'))}else totals.push(sumCalc(rows,'ownerNet'));
  let idx=0;const totalCells=[`<td>TOTAL</td>`,`<td>—</td>`,`<td class="${totals[idx]<0?'negative':''}">${money(totals[idx++])}</td>`];cols.forEach(()=>{const v=totals[idx++];totalCells.push(`<td class="${v<0?'negative':''}">${money(v)}</td>`)});if(showMileage){const km=totals[idx++],cost=totals[idx++];totalCells.push(`<td>${km.toLocaleString('es-ES',{maximumFractionDigits:1})}</td>`,`<td class="${cost<0?'negative':''}">${money(cost)}</td>`)}const base=totals[idx++];totalCells.push(`<td class="${base<0?'negative':''}">${money(base)}</td>`);while(idx<totals.length){const v=totals[idx++];totalCells.push(`<td class="${v<0?'negative':''}">${money(v)}</td>`)}
  t.innerHTML=`<thead><tr><th>Fecha</th><th>Estado</th><th>Total día</th>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}${mileageHeads}${calcHeads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr class="total-row">${totalCells.join('')}</tr></tfoot>`;
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
    const c=calculateRecord(r);const row={Fecha:r.date,Estado:dayStatusLabel(r),'Total día':c.gross};
    cols.forEach(col=>row[col.label]=num(r.values?.[col.key]));
    row['Descuento Imbric 12%']=c.imbricFee;row['Descuento JoinUp 10%']=c.joinupFee;row['Total descuentos']=c.totalPlatformFees;row['Base para reparto']=c.adjusted;
    row['Cash plataformas real']=c.platformRealCash;
    if(c.mileageKm||state.config.mileageEnabled){row['Kilómetros jornada']=c.mileageKm;row['Precio por km']=c.mileageRate;row['Descuento kilometraje']=c.mileageCost;}
    if(state.config.profile==='driver'){row[splitSideLabel('driver')]=c.driverBase;row['Aplicar seguro']=c.insuranceApplied?'Sí':'No';row['Seguro chofer']=c.insurance;row['A percibir chofer']=c.driverNet;row[splitSideLabel('boss')]=c.bossBase;row['Parte jefe + seguro']=c.bossWithInsurance;row['Liquidación jefe']=c.bossLiquidation}
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
    {Parámetro:'Reparto',Valor:state.config.profile==='driver'?'Sí, según porcentaje configurado':'No aplica (Titular)'},
    {Parámetro:'Porcentaje chofer',Valor:state.config.splitPct},
    {Parámetro:'Seguro activo',Valor:state.config.insuranceEnabled?'Sí':'No'},
    {Parámetro:'Seguro diario',Valor:state.config.insuranceDaily},
    {Parámetro:'Descuento por kilometraje activo',Valor:state.config.mileageEnabled?'Sí':'No'},
    {Parámetro:'Precio por km',Valor:state.config.mileageRate||0},
    {Parámetro:'Nómina de referencia en PDF',Valor:state.config.payrollPdfEnabled?'Sí':'No'},
    {Parámetro:'Importe nómina referencia',Valor:state.config.payrollAmount||0},
    {Parámetro:'Desglose de efectivo para jefe',Valor:state.config.cashBreakdownEnabled?'Sí':'No'},
    ...MODULES.map(m=>({Parámetro:`Columna ${m.label}`,Valor:state.config.modules[m.key]?'Activa':'Inactiva'})),
    ...state.config.customConcepts.map(c=>({Parámetro:'Concepto empresa',Valor:c.label}))
  ];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(cfg),'Configuración');
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
function updateExcelStatus(ok=false,pending=false){
  const el=$('#excelStatus');el.classList.toggle('ok',!!state.excelHandle&&!pending);
  el.textContent=!state.excelHandle?'Excel sin vincular':pending?'Excel pendiente de permiso':ok?'Excel actualizado':'Excel vinculado';
}

function getPdfLib(){if(!window.jspdf?.jsPDF)throw new Error('La librería PDF no está disponible. Abre la app con conexión una vez.');return window.jspdf.jsPDF}
async function imageDataUrl(url){try{const r=await fetch(url);const b=await r.blob();return await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b)})}catch(_e){return null}}
async function pdfHeader(doc,title,subtitle,landscapeMode=false){
  const w=doc.internal.pageSize.getWidth();doc.setFillColor(18,50,74);doc.roundedRect(10,9,w-20,27,4,4,'F');
  const logo=await imageDataUrl('logo-contabilidad-taxi.png');if(logo){try{doc.addImage(logo,'PNG',14,12,20,20)}catch(_e){}}
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Contabilidad Taxi',logo?38:15,20);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(220,234,243);doc.text(title,logo?38:15,27);doc.setFontSize(7.5);doc.text(subtitle,w-14,28,{align:'right'});doc.setTextColor(23,48,68);
}
function pdfMoneyCell(v,total=false){const value=num(v);return {content:money(value),styles:{halign:'right',fontStyle:total?'bold':'normal',textColor:value<0?(total?[255,138,128]:[198,40,40]):(total?[255,255,255]:[23,48,68]),fillColor:total?[18,50,74]:undefined}}}
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
async function createDetailPdf(){
  try{
    const rows=activeAnalysis.length?activeAnalysis:rangeRecords();if(!rows.length)return toast('No hay datos en el rango');const jsPDF=getPdfLib();const doc=new jsPDF({orientation:'landscape'});await pdfHeader(doc,'Detalle de jornadas · PDF detallado',`${rows[0].date} a ${rows[rows.length-1].date}`,true);
    const cols=activeModuleColumns();const showMileage=state.config.mileageEnabled||rows.some(r=>num(r.values?.km)>0);const head=['Fecha','Estado','Total día',...cols.map(c=>c.label),...(showMileage?['Km','Coste km']:[]),(state.config.profile==='driver'?'Base reparto':'Base tras descuentos'),...(state.config.profile==='driver'?['A percibir chofer','Liq. jefe']:['Resultado'])];
    const rawRows=rows.map(r=>{const c=calculateRecord(r);return [r.date,dayStatusLabel(r),c.gross,...cols.map(col=>num(r.values?.[col.key])),...(showMileage?[c.mileageKm,c.mileageCost]:[]),c.adjusted,...(state.config.profile==='driver'?[c.driverNet,c.bossLiquidation]:[c.ownerNet])]});
    const sums=head.map((_,i)=>i===0?'TOTAL':rawRows.reduce((acc,row)=>acc+(typeof row[i]==='number'?row[i]:0),0));
    const body=rawRows.map(row=>row.map((v,i)=>i<=1?String(v):(showMileage&&i===3+cols.length?String(num(v).toLocaleString('es-ES',{maximumFractionDigits:1})):pdfMoneyCell(v))));
    const totalRow=sums.map((v,i)=>i===0?{content:'TOTAL',styles:{fillColor:[18,50,74],textColor:[255,255,255],fontStyle:'bold'}}:i===1?{content:'—',styles:{fillColor:[18,50,74],textColor:[255,255,255],fontStyle:'bold'}}:(showMileage&&i===3+cols.length?{content:num(v).toLocaleString('es-ES',{maximumFractionDigits:1}),styles:{fillColor:[18,50,74],textColor:[255,255,255],fontStyle:'bold',halign:'right'}}:pdfMoneyCell(v,true)));body.push(totalRow);
    doc.autoTable({startY:41,head:[head],body,theme:'grid',styles:{fontSize:6.5,cellPadding:1.8,textColor:[23,48,68],lineColor:[202,217,227],lineWidth:.2},headStyles:{fillColor:[28,77,112],textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[245,249,252]},didParseCell:data=>{if(data.row.index===body.length-1){data.cell.styles.fillColor=[18,50,74];data.cell.styles.fontStyle='bold'}}});
    addPdfReferences(doc,doc.lastAutoTable.finalY+5,rows);doc.save(`Contabilidad_Taxi_detalle_${rows[0].date}_${rows[rows.length-1].date}.pdf`);
  }catch(e){alert(e.message)}
}
async function createSummaryPdf(){
  try{
    const rows=activeAnalysis.length?activeAnalysis:rangeRecords();if(!rows.length)return toast('No hay datos en el rango');const jsPDF=getPdfLib();const doc=new jsPDF();await pdfHeader(doc,'Acumulado del periodo',`${rows[0].date} a ${rows[rows.length-1].date} · ${rows.length} días registrados`);
    const st=analysisStatusStats(rows);doc.autoTable({startY:41,head:[['Trabajados','Descanso','Vacaciones','Baja','Taller','Otro']],body:[[st.work,st.rest,st.vacation,st.sick,st.workshop,st.other]],theme:'grid',headStyles:{fillColor:[28,77,112],textColor:[255,255,255]},styles:{fontSize:8,halign:'center',cellPadding:2.5}});
    const lines=[['Total día',sumCalc(rows,'gross')],['Descuento Imbric 12%',sumCalc(rows,'imbricFee')],['Descuento JoinUp 10%',sumCalc(rows,'joinupFee')],['Total descuentos',sumCalc(rows,'totalPlatformFees')],[state.config.profile==='driver'?'Base para reparto':'Base tras descuentos',sumCalc(rows,'adjusted')]];
    activeModuleColumns().forEach(col=>lines.push([col.label,rows.reduce((s,r)=>s+num(r.values?.[col.key]),0)]));
    if(state.config.mileageEnabled||rows.some(r=>num(r.values?.km)>0)) lines.push(['Descuento por kilometraje',sumCalc(rows,'mileageCost')]);
    if(state.config.profile==='driver'){lines.push([splitSideLabel('driver'),sumCalc(rows,'driverBase')],['Seguro chofer',sumCalc(rows,'insurance')],['A percibir chofer',sumCalc(rows,'driverNet')],[splitSideLabel('boss'),sumCalc(rows,'bossBase')],['Parte jefe + seguro',sumCalc(rows,'bossWithInsurance')],['Liquidación jefe',sumCalc(rows,'bossLiquidation')]);}
    else lines.push(['Gastos empresa',sumCalc(rows,'companyExpenses')],['Resultado tras gastos',sumCalc(rows,'ownerNet')]);
    if(state.config.modules.uberCash||state.config.modules.freenowCash) lines.push(['Cash plataformas real (informativo)',sumCalc(rows,'platformRealCash')]);
    doc.autoTable({startY:doc.lastAutoTable.finalY+5,head:[['Concepto','Total']],body:lines.map(([a,b])=>[a,pdfMoneyCell(b)]),theme:'grid',styles:{fontSize:8,cellPadding:2.7,textColor:[23,48,68],lineColor:[214,225,232]},headStyles:{fillColor:[28,77,112],textColor:[255,255,255]},alternateRowStyles:{fillColor:[247,250,252]},columnStyles:{1:{halign:'right'}}});addPdfReferences(doc,doc.lastAutoTable.finalY+5,rows);doc.save(`Contabilidad_Taxi_acumulado_${rows[0].date}_${rows[rows.length-1].date}.pdf`);
  }catch(e){alert(e.message)}
}

function backupJson(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),config:state.config,records:state.records,incomes:state.incomes},null,2)],{type:'application/json'});downloadBlob(blob,`Contabilidad_Taxi_backup_${todayISO()}.json`)}
async function restoreJson(file){
  try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.records))throw new Error('Copia no válida');if(!confirm('Esto sustituirá la configuración y los datos actuales. ¿Continuar?'))return;state.config={...defaultConfig(),...(data.config||{}),modules:{...defaultConfig().modules,...(data.config?.modules||{})}};state.records=data.records||[];state.incomes=data.incomes||[];await persist();applyAppearance();syncConfigForm();renderDayFields();renderRecent();renderIncomes();refreshAnalysis();toast('Copia restaurada')}catch(e){alert(`No se pudo restaurar: ${e.message}`)}
}

function setupEvents(){
  setupTabs();
  $('#todayBtn').onclick=()=>{$('#dayDate').value=todayISO()};
  $('#dayStatus').onchange=applyDayStatusUI;
  $('#clearDayBtn').onclick=clearDayForm;
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
    e.preventDefault();const fd=new FormData(e.target);state.config.profile=fd.get('profile')||'driver';state.config.splitEnabled=state.config.profile==='driver';state.config.splitPct=Math.max(0,Math.min(100,num($('#splitPct').value)));state.config.insuranceEnabled=$('#insuranceEnabled').checked;state.config.insuranceDaily=num($('#insuranceDaily').value);state.config.mileageEnabled=$('#mileageEnabled').checked;state.config.mileageRate=num($('#mileageRate').value);state.config.payrollPdfEnabled=$('#payrollPdfEnabled').checked;state.config.payrollAmount=num($('#payrollAmount').value);state.config.cashBreakdownEnabled=$('#cashBreakdownEnabled').checked;
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
  $('#finishSetup').onclick=async e=>{e.preventDefault();state.config.profile=$('#setupProfile').value;state.config.splitPct=Math.max(0,Math.min(100,num($('#setupSplitPct').value)));state.config.insuranceDaily=num($('#setupInsurance').value);state.config.insuranceEnabled=state.config.profile==='driver';state.config.splitEnabled=state.config.profile==='driver';state.config.configured=true;await persist();d.close();syncConfigForm();renderDayFields();updateLiveSummary();toast('Perfil creado. Revisa ahora las columnas activas.')};
}

async function init(){
  await loadState();applyAppearance();setupEvents();syncConfigForm();renderDayFields();renderRecent();renderIncomes();
  $('#dayDate').value=todayISO();$('#incomeDate').value=todayISO();const now=new Date();$('#rangeFrom').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;$('#rangeTo').value=todayISO();refreshAnalysis();updateLiveSummary();setupFirstRun();
  if('serviceWorker'in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

document.addEventListener('DOMContentLoaded',init);
