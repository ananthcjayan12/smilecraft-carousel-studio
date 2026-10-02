export function imageOptions(provider, model) {
 if (provider === 'openai') return {key:'quality',label:'Image quality',values:['low','medium','high',...(['gpt-image-2.5-sunburst','gpt-image-2.5-flare'].includes(model)?['xhigh','max']:[]),'auto'],defaultValue:'high'};
 if (provider === 'gemini') return {key:'imageSize',label:'Image resolution',values:['gemini-2.5-flash-image','gemini-3.1-flash-lite-image'].includes(model)?['1K']:model==='gemini-3-pro-image'?['1K','2K','4K']:['512','1K','2K','4K'],defaultValue:['gemini-2.5-flash-image','gemini-3.1-flash-lite-image'].includes(model)?'1K':'2K'};
 return null;
}
export function normalizeImageOptions(choice) {
 const option=imageOptions(choice.provider,choice.model);
 if(!option)return {};
 const value=choice[option.key]||option.defaultValue;
 if(!option.values.includes(value))throw Object.assign(Error(`Unsupported ${option.label.toLowerCase()} for ${choice.model}.`),{status:400});
 return {[option.key]:value};
}
