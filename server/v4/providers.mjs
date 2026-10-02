import {readFileSync} from 'node:fs';
import {writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectCli,inspectCliAsync} from '../cli-tools.mjs';
import {availableAgyModels} from '../text-providers.mjs';
import {IMAGE_MODELS,WRITING_MODELS} from '../../web/provider-models.js';

const fail=message=>Object.assign(Error(message),{status:409});
const STALE_MS=60000;
const safeModelId=value=>/^[a-z0-9][a-z0-9._:/-]{0,99}$/i.test(value);
// Saved before agy agent models were selectable; those ids name the image tool's model, not an agy model.
const legacyAgyImageModel=value=>/-image$/.test(value);
export function createLocalProviders({storageRoot,env=process.env,inspect=inspectCli,inspectAsync,listAgyModels}){
 const file=join(storageRoot,'local-generation.json');
 inspectAsync??=inspect===inspectCli?inspectCliAsync:async(...args)=>inspect(...args);
 listAgyModels??=async bin=>(await availableAgyModels(bin,{cwd:tmpdir(),timeoutMs:30000})).map(m=>[m.id,m.label]);
 let saved={};try{saved=JSON.parse(readFileSync(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw Error(`Cannot read local generation settings: ${error.message}`)}
 // Until `agy models` answers (it takes several seconds), offer the known agy models and accept any well-formed id.
 let agyModels=null,agyLoading=null,checkedAt=0,refreshing=null;
 function build(codex,agy){
  if(codex.installed)env.CODEX_BIN=codex.binary;
  if(agy.installed)env.AGY_BIN=agy.binary;
  return {
   codex:{label:'Codex CLI',available:codex.installed&&codex.authenticated,detail:!codex.installed?'Install Codex CLI.':!codex.authenticated?'Run codex login, then refresh.':codex.version,models:IMAGE_MODELS.codex},
   antigravity:{label:'Antigravity CLI (agy)',available:agy.installed,detail:agy.installed?`${agy.version} · ${agyModels?'The selected agy model directs native image generation.':'Loading agy models…'}`:'Install and sign in to the agy CLI, then refresh.',models:agyModels||WRITING_MODELS.antigravity,modelsLoaded:Boolean(agyModels)},
   claude:{label:'Claude API',available:Boolean(env.ANTHROPIC_API_KEY),detail:env.ANTHROPIC_API_KEY?'Server key configured.':'Set ANTHROPIC_API_KEY in .env.',models:[],writingModels:WRITING_MODELS.claude},
   openai:{label:'OpenAI API',available:Boolean(env.OPENAI_API_KEY),detail:env.OPENAI_API_KEY?'Server key configured.':'Set OPENAI_API_KEY in .env.',models:IMAGE_MODELS.openai},
   gemini:{label:'Gemini API',available:Boolean(env.GEMINI_API_KEY),detail:env.GEMINI_API_KEY?'Server key configured.':'Set GEMINI_API_KEY in .env.',models:IMAGE_MODELS.gemini},
  };
 }
 let tools={codex:inspect('codex','CODEX_BIN',{authArgs:['login','status']}),agy:inspect('agy','AGY_BIN')};
 let cached=build(tools.codex,tools.agy);checkedAt=Date.now();
 function loadAgyModels(force=false){
  if(!tools.agy.installed||agyLoading||(agyModels&&!force))return agyLoading;
  agyLoading=listAgyModels(tools.agy.binary).then(models=>{if(models.length)agyModels=models;}).catch(()=>{}).finally(()=>{agyLoading=null;cached=build(tools.codex,tools.agy);});
  return agyLoading;
 }
 function refresh(){
  refreshing??=Promise.all([inspectAsync('codex','CODEX_BIN',{authArgs:['login','status']}),inspectAsync('agy','AGY_BIN')]).then(([codex,agy])=>{tools={codex,agy};cached=build(codex,agy);checkedAt=Date.now();}).finally(()=>{refreshing=null;});
  return refreshing;
 }
 loadAgyModels();
 const initial=saved.provider||env.SRSHTI_LOCAL_PROVIDER||Object.keys(cached).find(p=>cached[p].available&&cached[p].models.length)||'codex';
 let model=saved.model||env.SRSHTI_LOCAL_IMAGE_MODEL||'';
 if(initial==='antigravity'&&legacyAgyImageModel(model))model='';
 let selection={provider:initial,model:model||cached[initial]?.models?.[0]?.[0]||''};
 function requireReady(value=selection){
  const entry=cached[value.provider];if(!entry)throw fail('Choose a supported local image provider in Settings.');
  if(!entry.available)throw fail(`${entry.label} is unavailable. ${entry.detail} Open Settings to refresh or choose a provider.`);
  const listed=entry.models.some(([id])=>id===value.model);
  if(!listed&&!(value.provider==='antigravity'&&!entry.modelsLoaded&&safeModelId(value.model)))throw fail('Choose a supported image model in Settings.');
  return {...value};
 }
 return {
  selected:()=>({...selection}),requireReady,
  // Answers from cache so Settings opens instantly; an explicit refresh re-checks the CLIs and agy models.
  async status({refresh:force=false}={}){
   if(force)await Promise.all([refresh(),loadAgyModels(true)]);
   else if(Date.now()-checkedAt>STALE_MS)void refresh().catch(()=>{});
   return {selection:{...selection},providers:Object.fromEntries(Object.entries(cached).map(([id,p])=>[id,{...p,writingModels:id==='antigravity'?p.models:WRITING_MODELS[id]||[]}]))};
  },
  async save(input){
   const next={provider:String(input.provider||''),model:String(input.model||'')};
   if(cached[next.provider]&&!cached[next.provider].available)await refresh();
   requireReady(next);
   const temporary=`${file}.${crypto.randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600});await rename(temporary,file);selection=next;
   return {selection:{...selection},providers:Object.fromEntries(Object.entries(cached).map(([id,p])=>[id,{...p,writingModels:id==='antigravity'?p.models:WRITING_MODELS[id]||[]}]))};
  },
 };
}
