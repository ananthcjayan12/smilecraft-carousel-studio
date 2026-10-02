// Quantize foreground pixels, excluding transparency and near-white backgrounds.
export function logoPalette(pixels) {
 const buckets=new Map();
 for(let i=0;i<pixels.length;i+=4){const [r,g,b,a]=pixels.slice(i,i+4);if(a<128||Math.min(r,g,b)>240)continue;
  const key=[r,g,b].map(v=>Math.floor(v/24)).join(',');const entry=buckets.get(key)||{n:0,r:0,g:0,b:0};entry.n++;entry.r+=r;entry.g+=g;entry.b+=b;buckets.set(key,entry);
 }
 const colours=[...buckets.values()].sort((a,b)=>b.n-a.n).map(e=>[e.r,e.g,e.b].map(v=>Math.round(v/e.n)));
 if(!colours.length)return null;
 const primary=colours.find(c=>Math.max(...c)-Math.min(...c)>35)||colours[0];
 const accent=colours.find(c=>Math.hypot(...c.map((v,i)=>v-primary[i]))>85)||primary;
 const hex=c=>'#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');
 return {primary:hex(primary),accent:hex(accent)};
}
export async function detectLogoColours(file){
 const bitmap=await createImageBitmap(file);
 try{const canvas=document.createElement('canvas');const scale=Math.min(1,160/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);return logoPalette(ctx.getImageData(0,0,canvas.width,canvas.height).data);}finally{bitmap.close();}
}
