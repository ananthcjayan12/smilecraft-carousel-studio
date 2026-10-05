export function imageOptions(provider, model, catalog) {
 if (provider === 'codex') {
  const levels=(catalog?.writingModels||[]).filter(([id])=>id.startsWith(model+'::')).map(([id])=>id.split('::')[1]);
  return levels.length?{key:'reasoningEffort',label:'Reasoning effort',values:['default',...levels],defaultValue:'default'}:null;
 }
 if (provider === 'openai') return {key:'quality',label:'Image quality',values:['low','medium','high',...(['gpt-image-2.5-sunburst','gpt-image-2.5-flare'].includes(model)?['xhigh','max']:[]),'auto'],defaultValue:'high'};
 if (provider === 'gemini') return {key:'imageSize',label:'Image resolution',values:['gemini-2.5-flash-image','gemini-3.1-flash-lite-image'].includes(model)?['1K']:model==='gemini-3-pro-image'?['1K','2K','4K']:['512','1K','2K','4K'],defaultValue:['gemini-2.5-flash-image','gemini-3.1-flash-lite-image'].includes(model)?'1K':'2K'};
 return null;
}
export function normalizeImageOptions(choice, catalog) {
 const option=imageOptions(choice.provider,choice.model,catalog);
 if(!option){
  if(choice.provider==='codex'&&choice.reasoningEffort&&choice.reasoningEffort!=='default')throw Object.assign(Error(`Unsupported reasoning effort for ${choice.model}.`),{status:400});
  return {};
 }
 const value=choice[option.key]||option.defaultValue;
 if(!option.values.includes(value))throw Object.assign(Error(`Unsupported ${option.label.toLowerCase()} for ${choice.model}.`),{status:400});
 return {[option.key]:value};
}

export function codexImageModelArgs(model, reasoningEffort) {
 if(reasoningEffort && reasoningEffort!=='default' && !['none','low','medium','high','xhigh','max','ultra'].includes(reasoningEffort))throw Error('Unsupported reasoning effort.');
 return [...(model && model!=='imagegen'?['--model',model]:[]),...(reasoningEffort&&reasoningEffort!=='default'?['-c',`model_reasoning_effort="${reasoningEffort}"`]:[])];
}
