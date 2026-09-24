import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'carousel-import-'));process.env.STORAGE_ROOT=root;
const store=await import(`../server/store.mjs?template=${Date.now()}`);
const importer=await import(`../server/template-import.mjs?template=${Date.now()}`);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3xkAAAAASUVORK5CYII=','base64');
function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1}return(c^0xffffffff)>>>0}
function zip(entries){const locals=[],central=[];let offset=0;for(const[name,data]of entries){const n=Buffer.from(name),raw=Buffer.from(data),packed=deflateRawSync(raw),crc=crc32(raw),lh=Buffer.alloc(30+n.length);lh.writeUInt32LE(0x04034b50);lh.writeUInt16LE(20,4);lh.writeUInt16LE(8,8);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(packed.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(n.length,26);n.copy(lh,30);locals.push(lh,packed);const cd=Buffer.alloc(46+n.length);cd.writeUInt32LE(0x02014b50);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(8,10);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(packed.length,20);cd.writeUInt32LE(raw.length,24);cd.writeUInt16LE(n.length,28);cd.writeUInt32LE(offset,42);n.copy(cd,46);central.push(cd);offset+=lh.length+packed.length}const c=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(c.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,c,end])}
const client=store.createClient({name:'Import Salon',businessPackId:'salon'});

test('identical DEFLATE template import is idempotent',async()=>{const bytes=zip(Array.from({length:5},(_,i)=>[`${i+1}.png`,png]));const staged=await importer.stageTemplateImport({clientId:client.id,businessPackId:'salon',scope:'client',bytes});assert.equal(staged.preview.unresolved,false);const first=await importer.installTemplateImport(staged.id);assert.equal(first.idempotent,false);const staged2=await importer.stageTemplateImport({clientId:client.id,businessPackId:'salon',scope:'client',bytes});const second=await importer.installTemplateImport(staged2.id);assert.equal(second.idempotent,true);assert.ok(store.listTemplates(client.id,'salon').some(t=>t.packId==='salon-import'))});

test('portable project import remaps artwork and logo assets',async()=>{const project=store.createProject(client.id,{topic:'Portable'}),art=`data:image/png;base64,${png.toString('base64')}`,portable={project:{...project,slides:project.slides.map((s,i)=>({...s,approved:true,artworkReviewed:i===0}))},embeddedAssets:{artworks:Object.fromEntries(project.slides.map(s=>[s.id,art])),logo:art}};const imported=await store.importPortableProject(client.id,portable);assert.notEqual(imported.id,project.id);assert.ok(imported.slides.every(s=>s.artworkAssetId));assert.ok(imported.contextSnapshot.brand.logoAssetId);assert.equal(imported.slides[0].artworkReviewed,true)});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
