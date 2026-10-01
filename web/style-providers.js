import { IMAGE_MODELS } from './provider-models.js';
export function styleModels(provider, devices = []) {
  if (!['codex','antigravity'].includes(provider)) return IMAGE_MODELS[provider] || [];
  return [...new Map(devices.filter(d=>d.online && d.capabilities?.[provider]?.ready).flatMap(d=>d.capabilities[provider].imageModels || []).map(m=>[m.id,[m.id,m.label || m.id]])).values()];
}
export function styleProviders(status, enabled, devices) {
  const result=Object.entries(status.imageProviders || {}).filter(([id,value])=>!['codex','antigravity'].includes(id) && value.available);
  if(enabled) for(const id of ['codex','antigravity']) if(styleModels(id,devices).length) result.push([id,{available:true,label:`${id==='codex'?'Codex':'Antigravity'} on your computer`}]);
  return result;
}
