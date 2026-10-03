import {buildV1StylePrompt} from '../../cloudflare/prompts.mjs';
export const STYLE_REFERENCES = ['clinical-white','deep-teal-premium','premium-charcoal'];
export function stylePrompt(clinic,reference,{notes='',revising=false}={}){
 return baseStylePrompt(clinic,reference)+(revising?'\nOne additional supplied board (not one of the three design-system boards and not the logo) is this clinic’s current version of the style. Revise it rather than starting over: keep what works and apply the requested changes.':'')+(notes?`\nRequested changes from the clinic (apply these, but never break the rules above): ${notes}`:'');
}
function baseStylePrompt(clinic,reference){
 const prompt=buildV1StylePrompt({design:{kind:'Smilecraft10 editorial dental reference systems'},brand:{...clinic.brand,name:clinic.name},businessType:'Dental clinic',language:clinic.profile.language||'English',languageNotes:'Use every selected language with its native script. Pair refined display headings with readable supporting fonts; preserve bilingual hierarchy.',direction:`Lead with ${reference}, adapted to the clinic colours and tone: ${clinic.profile.tone||'warm, clear, reassuring'}.`});
 return prompt.replace('Do not copy its dental subject matter, sample wording, people, icons, logo, or clinic identity.','Do not copy its sample wording, people, logo, or clinic identity. Use clinically plausible dental visuals.').replace('and visibly different from a dental clinic.','and match this dental clinic’s identity.')+'\nUse all three supplied Smilecraft10 design-system boards (clinical-white, deep-teal-premium, premium-charcoal) for typography, hierarchy, rhythm and image treatment. Produce a distinct direction led by the selected reference. Use only neutral placeholder labels in every selected language; no fabricated claims. Reserve usable space on the fifth panel for a CTA and clinic contact details.';
}
export {artworkPrompt as framePrompt} from './content-prompts.mjs';
