import {api} from './api.js';
import {refreshClinic,go,toast} from './app.js';
export function styleUploadForm(){return `<form data-form="upload-style" class="panel spaced"><h3>Already have a style you love?</h3><p>Upload an existing post, carousel design or brand board to guide your clinic’s content.</p><div class="two-col spaced"><label class="field">Style name<input name="styleName" maxlength="100" placeholder="My clinic’s style" required></label><label class="field">Style image<input name="styleImage" type="file" accept="image/png,image/jpeg,image/webp" required><small>PNG, JPEG or WebP · up to 10 MB</small></label></div><button class="btn primary" type="submit">Upload custom style</button></form>`;}
export async function uploadStyle(data,state){
 const file=data.get('styleImage'),name=String(data.get('styleName')||'').trim();
 if(!name)throw Error('Give your style a name.');
 if(!file?.size||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10_000_000)throw Error('Choose a PNG, JPEG or WebP style image under 10 MB.');
 await api(`/clinics/${state.clinic.id}/styles/upload?name=${encodeURIComponent(name)}`,{method:'POST',body:file,raw:true});
 await refreshClinic();const form=document.querySelector('[data-form=upload-style]');if(form){form.reset();delete form.dataset.dirty;}go(location.hash.startsWith('#/brand')?'/brand':'/setup?step=styles');
 toast('Custom style uploaded. Choose it as a primary or supporting style.');
}
