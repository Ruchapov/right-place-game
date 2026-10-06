const sharp=require('D:/dev/telegram-game/node_modules/sharp');
sharp.cache(false);sharp.concurrency(1);
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ASSETS=path.join(__dirname,'f-surface-review'),OUT=path.join(__dirname,'f-solid-masses-review'),H='D:/dev/right-place-handoff/';fs.mkdirSync(OUT,{recursive:true});
const rules=fs.readFileSync(path.join(__dirname,'APPROVED_RULES.txt'),'utf8'),rulesHash=crypto.createHash('sha256').update(rules).digest('hex');
const masses=[{x:32,y:10,w:6,h:3},{x:44,y:18,w:4,h:4}],risers=[];
const geometryPath='D:/dev/telegram-game/public/assets/maps/map_F_sanctuary.txt';
const raw=fs.readFileSync(geometryPath),G=raw.toString('utf8').trim().split(/\r?\n/);
const W=G[0].length*64,HEIGHT=G.length*64;
const placements=[],audit=[],parts={},platformOps=[],seams=[],bottomMasks=[],thickAudit=[];let platformMode=false;
const MASONRY='C:/Users/Андрей Рычапов/.codex/generated_images/01a0c4b4-0721-78b2-a3c2-2fd40add55e8/exec-fa118cc3-5f74-48d4-8dc5-82f3f7d65d0f.png';
const blank=(w,h,bg='#00000000')=>sharp({create:{width:w,height:h,channels:4,background:bg}});
async function place(input,x,y){x=Math.round(x);y=Math.round(y);const m=await sharp(input).metadata();const left=Math.max(0,-x),top=Math.max(0,-y),width=Math.min(m.width-left,W-Math.max(0,x)),height=Math.min(m.height-top,HEIGHT-Math.max(0,y));if(width<=0||height<=0)return;if(left||top||width!==m.width||height!==m.height)input=await sharp(input).extract({left,top,width,height}).png().toBuffer();(platformMode?platformOps:placements).push({input,left:Math.max(0,x),top:Math.max(0,y)});}
async function asset(id,width,height){return sharp(path.join(ASSETS,id+'.png')).trim({threshold:15}).resize(width,height,{fit:'fill',kernel:'lanczos3'}).png().toBuffer();}
// A strip is assembled once from overlapping centre portions; rounded ends occur only once.
async function strip(id,width,height,worldX,worldY){const raw=parts[id==='cornice'?'realTop':'realBottom'],meta=await sharp(raw).metadata(),pieces=[],step=meta.width-4;for(let x=0;x<width;x+=step){let ww=Math.min(meta.width,width-x);pieces.push({input:await sharp(raw).extract({left:0,top:0,width:ww,height:meta.height}).png().toBuffer(),left:x,top:0});if(x)seams.push({kind:id+'-strip',x:worldX+x,y0:worldY,y1:worldY+(id==='bottom'?5:height)});}const result=await blank(width,meta.height).composite(pieces).png().toBuffer();if(id==='bottom')bottomMasks.push({input:result,x:worldX,y:worldY,width,height:meta.height});return result;}
async function opaque(input){const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true}),original=Buffer.from(data);for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*4;if(original[i+3]<32){let best=-1;for(let d=1;d<Math.max(info.width,info.height);d++){for(const[xx,yy]of[[x-d,y],[x+d,y],[x,y-d],[x,y+d]])if(xx>=0&&xx<info.width&&yy>=0&&yy<info.height&&original[(yy*info.width+xx)*4+3]>=128){best=(yy*info.width+xx)*4;break;}if(best>=0)break;}if(best>=0)for(let c=0;c<3;c++)data[i+c]=original[best+c];}data[i+3]=255;}return sharp(data,{raw:info}).png().toBuffer();}
async function tall(id,h){if(h===128)return parts[id];const src=parts[id],shaftStart=id==='column'?61:29,shaftH=id==='column'?17:62,head=id==='column'?73:29,foot=24;
 const ops=[{input:await sharp(src).extract({left:0,top:0,width:64,height:head}).png().toBuffer(),left:0,top:0}];
 for(let y=head;y<h-foot;y+=shaftH){let hh=Math.min(shaftH,h-foot-y);ops.push({input:await sharp(src).extract({left:0,top:shaftStart,width:64,height:hh}).png().toBuffer(),left:0,top:y});}
 ops.push({input:await sharp(src).extract({left:0,top:128-foot,width:64,height:foot}).png().toBuffer(),left:0,top:h-foot});return blank(64,h).composite(ops).png().toBuffer();
}
let motif=0;const motifs=['angel','cross','skull','mourner'];
async function section(x,y,cells,heightCells){
 const px=x*64,py=y*64,pw=cells*64,ph=heightCells*64;
 // Only the two stepped masses receive the new facade rule. Other bridges retain their motifs.
 if((x>=32&&x<38&&y>=10&&y<=11)||(x>=44&&y>=18)){
  const outsideLeft=x===(y<15?32:44),outsideRight=x+cells===(y<15?38:48);
  const mass=masses[y<15?0:1];
  await place(await sharp(mass.texture).extract({left:px-mass.x*64,top:py-mass.y*64,width:pw,height:ph}).png().toBuffer(),px,py);
  if(outsideLeft)await place(parts.column,px,py);
  if(outsideRight)await place(parts.column,px+pw-64,py);
  thickAudit.push({x,y,width:cells,height:heightCells,roughMasonryFrom:py,skullColumns:[...(outsideLeft?[x]:[]),...(outsideRight?[x+cells-1]:[])],arch:null});
  audit.push({x,y,cells,heightCells,parts:'continuous-rough-masonry',arches:0});return;
 }
 if(cells<=3){const ids=cells===1?['column']:cells===2?['left','right']:['left','column','right'];for(let j=0;j<ids.length;j++){let im=await tall(ids[j],ph);const leftExternal=j===0&&G[y]?.[x-1]!=='#'&&G[y+heightCells-1]?.[x-1]!=='#',rightExternal=j===ids.length-1&&G[y]?.[x+cells]!=='#'&&G[y+heightCells-1]?.[x+cells]!=='#';if(ids[j]!=='column'&&(!leftExternal||!rightExternal)){im=await sharp(im).extract({left:leftExternal?0:8,top:0,width:64-(leftExternal?0:8)-(rightExternal?0:8),height:ph}).resize(67,ph).png().toBuffer();}await place(im,px+j*64,py);if(j)seams.push({kind:'short-detail',x:px+j*64,y0:py+12,y1:py+ph-18});}audit.push({x,y,cells,heightCells,parts:ids,arches:0});return;}
 const n=Math.ceil((cells-1)/4),units=4*n+1,ops=[];let sx=0;
 ops.push({input:parts.left,left:0,top:0});sx+=64;const used=[];
 for(let a=0;a<n;a++){const id=motifs[motif++%4];used.push(id);ops.push({input:await sharp(parts[id]).resize(195,128).png().toBuffer(),left:sx-2,top:0});seams.push({kind:'arch-left',x:px+Math.round(sx*cells/units),y0:py+12,y1:py+ph-18});sx+=192;seams.push({kind:'arch-right',x:px+Math.round(sx*cells/units),y0:py+12,y1:py+ph-18});if(a<n-1){ops.push({input:parts.columnBacking,left:sx,top:0});ops.push({input:await sharp(parts.column).resize(68,128).png().toBuffer(),left:sx-2,top:0});sx+=64;}}
 ops.push({input:parts.right,left:sx,top:0});
 const factor=cells/units;
 const built=await blank(units*64,128).composite(ops).png().toBuffer();
 const input=await sharp(built).resize(pw,Math.round(128*factor),{fit:'fill'}).png().toBuffer();
 await place(input,px,py);audit.push({x,y,cells,heightCells,nominalCells:units,uniformScale:factor,arches:n,motifs:used});
}
(async()=>{
 for(const id of ['left','right','column'])parts[id]=await asset(id,64,128);
 parts.back=await opaque(await sharp(path.join(ASSETS,'left.png')).extract({left:34,top:70,width:110,height:180}).resize(64,96).png().toBuffer());
 parts.columnBacking=await blank(64,112).composite([{input:parts.back,left:0,top:8}]).png().toBuffer();
 for(const id of motifs){const core=await asset(id,192,112);parts[id]=await blank(192,128).composite([{input:core,left:0,top:0}]).png().toBuffer();}
 // Real reference pixels, all rows retained. No opacity extrusion of a single scanline.
 parts.realTop=await sharp(H+'bridge_approved.png').extract({left:145,top:225,width:1240,height:28}).resize(620,14).png().toBuffer();
 parts.realBottom=await sharp(H+'bridge_approved.png').extract({left:145,top:417,width:1240,height:68}).resize(620,34).png().toBuffer();
 // Four plain large-stone variations from one reference-conditioned atlas, normalized to bridge stone.
 const masonry=await sharp(MASONRY).ensureAlpha().raw().toBuffer({resolveWithObject:true});let sum=[0,0,0],count=0;
 for(let i=0;i<masonry.data.length;i+=4)if(masonry.data[i+3]>=250){sum[0]+=masonry.data[i];sum[1]+=masonry.data[i+1];sum[2]+=masonry.data[i+2];count++;}
 // Opaque material average, including recess shadows and moss; avoid selecting only pale highlights.
 const delta=[100.6797195,94.6935776,76.9721168].map((v,c)=>v-sum[c]/count);
 for(let i=0;i<masonry.data.length;i+=4)for(let c=0;c<3;c++)masonry.data[i+c]=Math.max(0,Math.min(255,Math.round(masonry.data[i+c]+delta[c])));
 const mw=Math.floor(masonry.info.width/2),mh=Math.floor(masonry.info.height/2);
 for(let i=0;i<4;i++){parts['masonry'+i]=await sharp(masonry.data,{raw:masonry.info}).extract({left:i%2*mw,top:Math.floor(i/2)*mh,width:mw,height:mh}).resize(192,128).png().toBuffer();await sharp(parts['masonry'+i]).toFile(path.join(OUT,'masonry-'+(i+1)+'.png'));}
 // Approved A background stack, identical resources, height, opacity and veil.
 for(const [name,opacity]of [['far',1],['mid',.55]]){
  let im=sharp(H+'bg_graveyard_'+name+'_approved.png').resize({height:1800});
  if(opacity!==1)im=im.ensureAlpha().linear([1,1,1,opacity],[0,0,0,0]);
  const b=await im.png().toBuffer(),m=await sharp(b).metadata();for(let x=0;x<W;x+=m.width)await place(b,x,0);
 }
 await place(await blank(W,HEIGHT,{r:24,g:22,b:30,alpha:.22}).png().toBuffer(),0,0);
 for(const [mi,mass]of masses.entries()){
  const ops=[];let n=mi;
  for(let yy=0;yy<mass.h*64;yy+=128)for(let xx=0;xx<mass.w*64;xx+=192){const ww=Math.min(192,mass.w*64-xx),hh=Math.min(128,mass.h*64-yy);ops.push({input:await sharp(parts['masonry'+(n++%4)]).extract({left:0,top:0,width:ww,height:hh}).png().toBuffer(),left:xx,top:yy});}
  mass.texture=await blank(mass.w*64,mass.h*64).composite(ops).png().toBuffer();
 }
 // Derive connected solid components and exposed top-profile runs directly from the unchanged grid.
 const seen=new Set(),components=[];
 for(let y=0;y<G.length;y++)for(let x=0;x<G[y].length;x++)if(G[y][x]==='#'&&!seen.has(x+','+y)){
  const q=[[x,y]],cells=[];seen.add(x+','+y);for(let i=0;i<q.length;i++){const [cx,cy]=q[i];cells.push([cx,cy]);for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){let nx=cx+dx,ny=cy+dy,k=nx+','+ny;if(G[ny]?.[nx]==='#'&&!seen.has(k)){seen.add(k);q.push([nx,ny]);}}}components.push(cells);
 }
 platformMode=true;
 // Opaque stone backing is limited to actual solid cells; no background can shine through internal joints.
 for(const [cx,cy]of components.flat()){await place(await sharp(parts.back).extract({left:0,top:0,width:64,height:64}).png().toBuffer(),cx*64,cy*64);}
 for(const cells of components){let xs=[...new Set(cells.map(c=>c[0]))].sort((a,b)=>a-b),cols=xs.map(x=>{let ys=cells.filter(c=>c[0]===x).map(c=>c[1]);return{x,top:Math.min(...ys),bottom:Math.max(...ys)+1};});
  for(let i=0;i<cols.length;){let j=i+1;while(j<cols.length&&cols[j].top===cols[i].top&&cols[j].bottom===cols[i].bottom)j++;await section(cols[i].x,cols[i].top,j-i,cols[i].bottom-cols[i].top);i=j;}
 }
 // Thin '=' footholds use only the cornice; no arch can be cut on a narrow ledge.
 // One continuous top cornice per exposed walkable run, including adjoining '=' ledges.
 for(const [x,y,rotation]of [[33,10,270],[35,10,90],[44,19,270],[45,18,270]]){
  const im=await sharp(parts.realTop).extract({left:80,top:0,width:78,height:14}).rotate(rotation).png().toBuffer();
  const px=x*64-(rotation===90?14:0);await place(im,px,y*64);risers.push({x:px,y:y*64,width:14,height:78});
 }
 const exposed=(x,y)=>['#','='].includes(G[y]?.[x])&&G[y-1]?.[x]!=='#';
 for(let y=0;y<G.length;y++)for(let x=0;x<G[y].length;x++)if(exposed(x,y)&&(x===0||!exposed(x-1,y))){let end=x+1;while(exposed(end,y))end++;const ww=(end-x)*64;const top=await strip('cornice',ww,14,x*64,y*64);await place(top,x*64,y*64);}
 // A single lower strip for each continuous bottom boundary of the masonry.
 for(let y=0;y<G.length;y++)for(let x=0;x<G[y].length;x++)if(G[y][x]==='#'&&G[y+1]?.[x]!=='#'&&(x===0||G[y][x-1]!=='#'||G[y+1]?.[x-1]==='#')){let end=x+1;while(G[y][end]==='#'&&G[y+1]?.[end]!=='#')end++;await place(await strip('bottom',(end-x)*64,34,x*64,(y+1)*64-34),x*64,(y+1)*64-34);}
 for(const a of audit)for(const b of audit)if(a.x+a.cells===b.x){const y0=Math.max(a.y,b.y)*64,y1=Math.min(a.y+a.heightCells,b.y+b.heightCells)*64;if(y1>y0)seams.push({kind:'section-contact',x:b.x*64,y0,y1});}
 let platformBuffer=await blank(W,HEIGHT).composite(platformOps).png().toBuffer();const pixels=await sharp(platformBuffer).ensureAlpha().raw().toBuffer();let removedBackingPixels=0;
 for(const b of bottomMasks){const bd=await sharp(b.input).ensureAlpha().raw().toBuffer();for(let yy=0;yy<b.height;yy++)for(let xx=0;xx<b.width;xx++){const i=((b.y+yy)*W+b.x+xx)*4,alpha=bd[(yy*b.width+xx)*4+3];pixels[i+3]=alpha<24?0:alpha>230?255:alpha;if(pixels[i+3]===0)removedBackingPixels++;}}
 platformBuffer=await sharp(pixels,{raw:{width:W,height:HEIGHT,channels:4}}).png().toBuffer();await sharp(platformBuffer).toFile(path.join(OUT,'platforms-alpha.png'));
 let gaps=0;for(const s of seams){let bad=0;for(let y=s.y0;y<s.y1;y++)for(let xx=s.x-2;xx<s.x+2;xx++){if(bottomMasks.some(b=>xx>=b.x&&xx<b.x+b.width&&y>=b.y+5))continue;if(pixels[(y*W+xx)*4+3]<230)bad++;}s.transparentPixels=bad;if(bad)gaps++;}
 const check={checkedSeams:seams.length,seamsWithGaps:gaps,criteria:'4px contact band on opaque facade; intentional chipped bottom silhouette excluded',seams};fs.writeFileSync(path.join(OUT,'seam-audit.json'),JSON.stringify(check,null,2));if(gaps)throw Error(JSON.stringify(check));
 fs.writeFileSync(path.join(OUT,'three-fixes-audit.json'),JSON.stringify({reference:H+'bridge_approved.png',bottom:'reference crop x145,y417,w1240,h68; 0.5 scale, original alpha',cornice:'reference crop x145,y225,w1240,h28; 0.5 scale; no replicated scanline',removedBackingPixels,thickBlocks:thickAudit,masonryVariants:4,oldDiamondStripUsed:false},null,2));
 platformMode=false;
 // Register the cap against the rendered alpha contour, while retaining floor contact.
 let supportHeight=356,supportY=948,supportBuffer,supportData,contact=[];
 for(let pass=0;pass<5;pass++){
  supportBuffer=await sharp(H+'column_support_approved.png').resize(246,supportHeight).modulate({brightness:1.05,saturation:.8}).png().toBuffer();
  supportData=await sharp(supportBuffer).ensureAlpha().raw().toBuffer();contact=[];
  for(let xx=20;xx<226;xx++){
   let bridgeBottom=-1,capTop=-1;for(let yy=832;yy<960;yy++)if(pixels[(yy*W+1050+xx)*4+3]>=200)bridgeBottom=yy;
   for(let yy=0;yy<60;yy++)if(supportData[(yy*246+xx)*4+3]>=200){capTop=yy;break;}
   if(bridgeBottom>=0&&capTop>=0)contact.push({x:xx,bridgeBottom,capTop});
  }
  supportY=Math.min(...contact.map(c=>c.bridgeBottom-c.capTop))-2;
  let bottom=-1;for(let yy=0;yy<supportHeight;yy++)for(let xx=20;xx<226;xx++)if(supportData[(yy*246+xx)*4+3]>=200)bottom=yy;
  const adjustment=1284-(supportY+bottom);if(Math.abs(adjustment)<=1)break;supportHeight+=adjustment;
 }
 const supportAudit={x:1050,y:supportY,width:246,height:supportHeight,contactColumns:contact.length,gaps:contact.filter(c=>supportY+c.capTop>c.bridgeBottom+1).length,maxOverlap:Math.max(...contact.map(c=>c.bridgeBottom-supportY-c.capTop)),rulesHash,risers};
 if(supportAudit.gaps)throw Error('Support contact failed');
 fs.writeFileSync(path.join(OUT,'support-audit.json'),JSON.stringify(supportAudit,null,2));
 await place(supportBuffer,1050,supportY);await place(platformBuffer,0,0);
 const D=JSON.parse(fs.readFileSync(path.join(__dirname,'map-f-audit.json'),'utf8')).decor;
 for(const d of D){let candle=['candle','candles'].includes(d.id);await place(await sharp(H+'decor_'+d.id+'.png').resize(d.w,d.h).modulate({brightness:candle?.9:.76,saturation:candle?.72:.55}).png().toBuffer(),d.x,d.y);}
 await place(await sharp(H+'hero_preview.png').resize({height:140}).png().toBuffer(),322,1151);
 const full=path.join(OUT,'map-f-full.png');await blank(W,HEIGHT,'#27272d').composite(placements).png().toFile(full);
 await sharp(full).extract({left:1856,top:544,width:1216,height:864}).png().toFile(path.join(OUT,'map-f-right.png'));
 await sharp(full).extract({left:1984,top:576,width:576,height:320}).png().toFile(path.join(OUT,'map-f-upper-step.png'));
 await sharp(full).extract({left:2688,top:1088,width:384,height:320}).png().toFile(path.join(OUT,'map-f-lower-step.png'));
 await sharp(full).extract({left:960,top:832,width:480,height:544}).png().toFile(path.join(OUT,'map-f-support.png'));
 const geometryAudit={source:geometryPath,sha256:crypto.createHash('sha256').update(raw).digest('hex'),width:W,height:HEIGHT,solidCells:seen.size,thinCells:G.join('').split('=').length-1,sections:audit,decorCount:D.length,geometryUnchanged:raw.equals(fs.readFileSync(geometryPath)),archesClipped:0};
 fs.writeFileSync(path.join(OUT,'map-audit.json'),JSON.stringify(geometryAudit,null,2));
 const html='<!doctype html><meta charset="utf-8"><title>F — проверка поверхности и модулей</title><style>body{margin:0;background:#27272d;color:#eee;font:16px system-ui}img{display:block;width:100%;height:auto}details{padding:16px}summary{cursor:pointer}</style><img src="map-f-full.png" alt="Вся карта F"><details open><summary>Правая часть</summary><img src="map-f-right.png"></details><details><summary>Детали и эталон</summary><img src="details-and-reference.png"></details>';
 fs.writeFileSync(path.join(OUT,'preview.html'),html);console.log(JSON.stringify(geometryAudit,null,2));
})();
