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
// Image models read transparent pixels as black, which erases dark lettering (e.g. a black monogram).
// Returns the solid backdrop a transparent logo should be flattened onto, or null when it is already opaque.
export function logoBackdrop(pixels){
 let transparent=0,total=0,light=0,opaque=0;
 for(let i=0;i<pixels.length;i+=4){total++;const a=pixels[i+3];if(a<250)transparent++;if(a<128)continue;opaque++;const [r,g,b]=[pixels[i],pixels[i+1],pixels[i+2]];if((0.2126*r+0.7152*g+0.0722*b)/255>0.72)light++;}
 if(!total||transparent/total<0.01)return null;
 return opaque&&light/opaque>0.6?'#1f2329':'#ffffff';
}
export async function prepareLogo(file){
 const bitmap=await createImageBitmap(file);
 try{const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const backdrop=logoBackdrop(ctx.getImageData(0,0,canvas.width,canvas.height).data);if(!backdrop)return file;
  ctx.globalCompositeOperation='destination-over';ctx.fillStyle=backdrop;ctx.fillRect(0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return blob&&blob.size<=2_000_000?new File([blob],'logo.png',{type:'image/png'}):file;
 }finally{bitmap.close();}
}
