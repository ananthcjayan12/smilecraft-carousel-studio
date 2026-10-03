import {buildV1StylePrompt} from '../../cloudflare/prompts.mjs';
import {LOGO_ADAPT} from './content-prompts.mjs';
export const STYLE_REFERENCES = ['clinical-white','deep-teal-premium','premium-charcoal'];
export function stylePrompt(clinic,reference,{notes='',revising=false}={}){
 return baseStylePrompt(clinic,reference)+(revising?'\nOne additional supplied board (not one of the three design-system boards and not the logo) is this clinic’s current version of the style. Revise it rather than starting over: keep what works and apply the requested changes.':'')+(notes?`\nRequested changes from the clinic (apply these, but never break the rules above): ${notes}`:'');
}
// "Malayalam + English", "Hindi, English", "English" → ['Malayalam','English'] …
export const styleLanguages=value=>[...new Set(String(value||'English').split(/\s*(?:\+|,|&|\/|\band\b)\s*/i).map(v=>v.trim()).filter(Boolean))];
// The reference boards are Malayalam + English samples; without explicit rules the model copies a
// bilingual layout and invents a second language (e.g. Chinese) for English-only clinics.
export function styleLanguageRules(value){
 const languages=styleLanguages(value),list=languages.join(' and ');
 const only=languages.length===1?`Write every word on the board in ${list} only. Do not add a second language or any translated line under headings, and never use any other script (no Chinese, Hindi, Arabic or other characters).`:`Use exactly these languages: ${list}, each in its own native script. Do not add any other language or script.`;
 return `${only} The Malayalam text on the reference boards is sample content from another clinic: copy its layout ideas, never its language.`;
}
const LOGO_RULES=`${LOGO_ADAPT} Use one consistent logo position on every panel and in the board header.`;
function baseStylePrompt(clinic,reference){
 const prompt=buildV1StylePrompt({design:{kind:'Smilecraft10 editorial dental reference systems'},brand:{...clinic.brand,name:clinic.name},businessType:'Dental clinic',language:styleLanguages(clinic.profile.language).join(' + '),languageNotes:styleLanguageRules(clinic.profile.language),direction:`Lead with ${reference}, adapted to the clinic colours and tone: ${clinic.profile.tone||'warm, clear, reassuring'}.`});
 return prompt.replace('Do not copy its dental subject matter, sample wording, people, icons, logo, or clinic identity.','Do not copy its sample wording, language, people, logo, or clinic identity. Use clinically plausible dental visuals.').replace('Use the exact supplied logo consistently and tastefully when present.',LOGO_RULES).replace('and visibly different from a dental clinic.','and match this dental clinic’s identity.')+`\nUse all three supplied Smilecraft10 design-system boards (clinical-white, deep-teal-premium, premium-charcoal) for typography, hierarchy, rhythm and image treatment. Produce a distinct direction led by the selected reference. Use only neutral placeholder labels in ${styleLanguages(clinic.profile.language).join(' and ')}; no fabricated claims. Reserve usable space on the fifth panel for a CTA and clinic contact details.`;
}
export {artworkPrompt as framePrompt} from './content-prompts.mjs';
