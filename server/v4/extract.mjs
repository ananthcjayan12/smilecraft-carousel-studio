export function publicUrl(value){
 let url;try{url=new URL(value)}catch{throw Object.assign(Error('Use a public HTTPS clinic website.'),{status:400})}
 const h=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!h.includes('.')||/^(?:\d+\.)|[:\[\]]/.test(h)||/(^|\.)(localhost|local|internal|test|invalid|example|lan|home|onion)$/.test(h))throw Object.assign(new Error('Use a public HTTPS clinic website.'),{status:400});
 return url;
}
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
export async function publicFetch(value,fetcher=fetch){
 let url=publicUrl(value);
 for(let i=0;i<4;i++){const r=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'text/html,image/png,image/jpeg,image/webp','User-Agent':'SrshtiClinicSetup/4.0'}});
  if(r.status>=300&&r.status<400){url=publicUrl(new URL(r.headers.get('location'),url).href);continue;}
  if(!r.ok)throw Error(`Clinic website could not be read (${r.status}).`);
  const reader=r.body.getReader(),parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw Error('Clinic website response is too large.');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return {bytes,mime:r.headers.get('content-type')||'',url:url.href};
 }
 throw Error('Clinic website redirected too many times.');
}
export function extractCandidates(html,url){
 const meta=name=>decode([...html.matchAll(/<meta\b[^>]*>/gi)].find(m=>new RegExp(`(?:name|property)=["']${name}["']`,'i').test(m[0]))?.[0].match(/content=["']([^"']*)/i)?.[1]);
 const title=decode(html.match(/<title[^>]*>([^<]+)/i)?.[1]||'').split(/[|–]/)[0].trim();
 const text=decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' '));
 let data={};for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const obj=JSON.parse(m[1]);const candidates=Array.isArray(obj)?obj:obj['@graph']||[obj];data=candidates.find(v=>/Dentist|MedicalClinic|LocalBusiness/.test(String(v['@type'])))||data;}catch{}}
 const address=typeof data.address==='object'?['streetAddress','addressLocality','addressRegion'].map(k=>data.address[k]).filter(Boolean).join(', '):String(data.address||'');
 const services=['General dentistry','Teeth whitening','Gum care','Children’s dentistry','Dental implants','Orthodontics'].filter((s,i)=>new RegExp(['dent|oral','whiten','gum|periodont','child|pediatric|paediatric','implant','orthodont|braces|aligner'][i],'i').test(text));
 const logo=data.logo?.url||data.logo||meta('og:image')||html.match(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)/i)?.[1];
 const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:decode(m[1]),label:m[2].replace(/<[^>]*>/g,' ')}));
 let whatsapp='',bookingUrl=url;
 for(const link of links){
  try{const target=new URL(link.href,url);if(/^(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)$/.test(target.hostname)){const phone=target.hostname==='wa.me'?target.pathname.slice(1):target.searchParams.get('phone');if(/^\+?[\d ()-]{7,20}$/.test(phone||''))whatsapp=phone;}
   if(/book|appointment/i.test(link.label)||/calendly|booking|appointments/i.test(target.href))bookingUrl=publicUrl(target.href).href;
  }catch{}
 }
 let logoUrl='';try{logoUrl=publicUrl(new URL(logo,url).href).href;}catch{}
 return {name:String(data.name||meta('og:site_name')||title).slice(0,100),location:address.slice(0,200),address:address.slice(0,500),whatsapp,website:url,phone:String(data.telephone||text.match(/\+\d[\d ()-]{7,18}/)?.[0]||'').slice(0,50),services,bookingUrl,tone:'Friendly, clear and reassuring',primary:/^#[0-9a-f]{6}$/i.test(meta('theme-color'))?meta('theme-color'):'#5b5bd6',accent:'#8bd5cf',logoUrl,facts:[{text:'Website and contact details were imported from the clinic website.',status:'imported',source:url}]};
}
