import {imageFormat,openaiImageSize} from '../../web/image-formats.js';

export const artworkRatio=type=>type==='story'?'9:16':type==='post'?'1:1':'4:5';
export function requireArtworkRatio({width,height},ratio){
 const format=imageFormat(ratio);
 // Permit only pixel rounding, never a different canvas shape.
 if(!width||!height||Math.abs(width-height*format.width/format.height)>1)
  throw Object.assign(Error(`The image provider returned ${width||'?'} × ${height||'?'} artwork. This content requires ${ratio}. Regenerate using a model that supports this format.`),{status:502});
}
export function artworkApiSize(model,ratio){
 const size=openaiImageSize(model,ratio),[width,height]=size.split('x').map(Number);
 try{requireArtworkRatio({width,height},ratio);}catch{
  throw Object.assign(Error(`The selected model ${model} cannot generate ${ratio} artwork. Choose an image model that supports this content format.`),{status:409});
 }
 return size;
}
