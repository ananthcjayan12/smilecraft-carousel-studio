import {landing} from '../marketing.js';
import {mountDemo,handleMarketingAction} from '../marketing-motion.js';
export function render(state){return landing(state)}
export function mounted(){mountDemo();if(['#features','#how','#faq','#pricing','#marketing-main'].includes(location.hash))document.getElementById(location.hash.slice(1))?.scrollIntoView()}
export function action(name,el){handleMarketingAction(name,el)}
