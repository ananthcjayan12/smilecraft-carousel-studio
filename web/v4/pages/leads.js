import {api} from '../api.js';
import {title,esc,attr} from '../ui.js';
import {go,toast} from '../app.js';
let leads=[],statuses=[];
const when=iso=>new Date(iso).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
const source=l=>[l.utmSource,l.utmMedium,l.utmCampaign,l.utmContent].filter(Boolean).join(' · ')||'Direct';
// A cell starting with = + - @ would run as a formula when the CSV is opened in a spreadsheet.
const csvCell=value=>{const text=String(value??''),safe=/^[=+\-@\t\r]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`};
const current=()=>location.hash.slice(1)||'/leads';
function card(l){return `<article class="panel lead-card"><div class="lead-head"><div><h2>${esc(l.clinic)}</h2><p class="muted">${esc(l.name)} · ${esc(when(l.createdAt))}</p></div><label class="field lead-status">Status<select data-change="lead-status" data-id="${attr(l.id)}">${statuses.map(s=>`<option ${s===l.status?'selected':''}>${esc(s)}</option>`).join('')}</select></label></div><dl class="lead-facts"><div><dt>Email</dt><dd><a href="mailto:${attr(l.email)}">${esc(l.email)}</a></dd></div><div><dt>Instagram</dt><dd><a href="https://www.instagram.com/${attr(l.instagram.slice(1))}/" target="_blank" rel="noopener noreferrer">${esc(l.instagram)} ↗</a></dd></div><div><dt>Source</dt><dd>${esc(source(l))}</dd></div></dl><form class="lead-notes" data-form="lead-notes"><input type="hidden" name="id" value="${attr(l.id)}"><label class="field">Notes<textarea name="notes" rows="2" placeholder="Follow-up, delivery date…">${esc(l.notes)}</textarea></label><button class="btn small" type="submit">Save notes</button></form></article>`}

export async function render(state,params){if(!state.me?.isAdmin)return '<div class="panel"><h1>Administrator access required</h1><a class="btn" href="#/settings">Open your settings</a></div>';
 ({leads,statuses}=await api('/api/admin/leads',{cache:false}));
 const filter=params.get('status')||'all',shown=filter==='all'?leads:leads.filter(l=>l.status===filter),count=s=>s==='all'?leads.length:leads.filter(l=>l.status===s).length;
 return `${title('STUDIO ADMINISTRATION','Free carousel leads.','Clinics that asked for a free sample carousel, newest first.',`<button class="btn" data-action="export-leads" ${leads.length?'':'disabled'}>Download CSV</button>`)}<div class="tabs leads-filter" role="group" aria-label="Lead status">${['all',...statuses].map(s=>`<button type="button" class="${filter===s?'active':''}" aria-pressed="${filter===s}" data-action="lead-filter" data-status="${attr(s)}">${esc(s==='all'?'All':s)}<span>${count(s)}</span></button>`).join('')}</div>${shown.length?`<div class="lead-list">${shown.map(card).join('')}</div>`:`<section class="panel"><h2>${leads.length?'No leads with this status.':'No requests yet.'}</h2><p class="muted">${leads.length?'Choose another status above.':'Requests from the free-carousel page appear here.'}</p></section>`}`}

export async function action(name,el){if(name==='lead-filter'){const s=el.dataset.status;go(s==='all'?'/leads':`/leads?status=${encodeURIComponent(s)}`)}
 if(name==='export-leads'){const columns=[['Submitted at','createdAt'],['Name','name'],['Clinic name','clinic'],['Email','email'],['Instagram','instagram'],['UTM source','utmSource'],['UTM medium','utmMedium'],['UTM campaign','utmCampaign'],['UTM content','utmContent'],['Status','status'],['Notes','notes']];
  const csv=[columns.map(([label])=>csvCell(label)),...leads.map(l=>columns.map(([,key])=>csvCell(l[key])))].map(row=>row.join(',')).join('\r\n'),link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=`srshti-leads-${new Date().toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}}
export async function change(name,el){if(name!=='lead-status')return;await api(`/api/admin/leads/${encodeURIComponent(el.dataset.id)}`,{method:'PATCH',body:{status:el.value}});toast(`Lead marked “${el.value}”.`);el.blur();go(current())}
export async function submit(name,data,state,form){if(name!=='lead-notes')return;await api(`/api/admin/leads/${encodeURIComponent(data.get('id'))}`,{method:'PATCH',body:{notes:data.get('notes')}});delete form.dataset.dirty;toast('Notes saved.');go(current())}
