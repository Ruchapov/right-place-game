const sharp=require('D:/dev/telegram-game/node_modules/sharp');
sharp.cache(false);sharp.concurrency(1);
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ASSETS=path.join(__dirname,'f-surface-review'),OUT=path.join(__dirname,'a-final-review'),H='D:/dev/right-place-handoff/';fs.mkdirSync(OUT,{recursive:true});
const geometryPath='D:/dev/telegram-game/public/assets/maps/map_A_serpentine.txt';
const raw=fs.readFileSync(geometryPath),G=raw.toString('utf8').trim().split(/\r?\n/);
const W=G[0].length*64,HEIGHT=G.length*64;
const placements=[],audit=[],parts={},platformOps=[],seams=[],bottomMasks=[],beltSources=[];let platformMode=false;
const blank=(w,h,bg='#00000000')=>sharp({create:{width:w,height:h,channels:4,background:bg}});
async function place(input,x,y){x=Math.round(x);y=Math.round(y);const m=await sharp(input).metadata();const left=Math.max(0,-x),top=Math.max(0,-y),width=Math.min(m.width-left,W-Math.max(0,x)),height=Math.min(m.height-top,HEIGHT-Math.max(0,y));if(width<=0||height<=0)return;if(left||top||width!==m.width||height!==m.height)input=await sharp(input).extract({left,top,width,height}).png().toBuffer();(platformMode?platformOps:placements).push({input,left:Math.max(0,x),top:Math.max(0,y)});}
async function asset(id,width,height){return sharp(path.join(ASSETS,id+'.png')).trim({threshold:15}).resize(width,height,{fit:'fill',kernel:'lanczos3'}).png().toBuffer();}
// A strip is assembled once from overlapping centre portions; rounded ends occur only once.
async function strip(id,width,height,worldX,worldY){if(id==='bottom'){
 const edge=await sharp(H+'bridge_approved.png').extract({left:145,top:417,width:1240,height:68}).resize(620,34).png().toBuffer(),ops=[];
 for(let xx=0;xx<width;xx+=616){const ww=Math.min(620,width-xx);ops.push({input:await sharp(edge).extract({left:0,top:0,width:ww,height:34}).png().toBuffer(),left:xx,top:0});}
 const im=await blank(width,34).composite(ops).png().toBuffer();bottomMasks.push({input:im,x:worldX,y:worldY,width});return im;
 }const raw=await asset(id,192,height),pieces=[],cap=10,step=169;pieces.push({input:await sharp(raw).extract({left:0,top:0,width:cap+3,height}).png().toBuffer(),left:0,top:0});for(let x=cap;x<width-cap;x+=step){const ww=Math.min(172,width-cap-x+3);pieces.push({input:await sharp(raw).extract({left:10,top:0,width:ww,height}).png().toBuffer(),left:x,top:0});seams.push({kind:id+'-strip',x:worldX+x,y0:worldY,y1:worldY+height});}pieces.push({input:await sharp(raw).extract({left:182,top:0,width:cap,height}).png().toBuffer(),left:width-cap,top:0});seams.push({kind:id+'-end',x:worldX+width-cap,y0:worldY,y1:worldY+height});return blank(width,height).composite(pieces).png().toBuffer();}
async function opaque(input){const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true}),original=Buffer.from(data);for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*4;if(original[i+3]<32){let best=-1;for(let d=1;d<Math.max(info.width,info.height);d++){for(const[xx,yy]of[[x-d,y],[x+d,y],[x,y-d],[x,y+d]])if(xx>=0&&xx<info.width&&yy>=0&&yy<info.height&&original[(yy*info.width+xx)*4+3]>=128){best=(yy*info.width+xx)*4;break;}if(best>=0)break;}if(best>=0)for(let c=0;c<3;c++)data[i+c]=original[best+c];}data[i+3]=255;}return sharp(data,{raw:info}).png().toBuffer();}
async function tall(id,h){if(h===128)return parts[id];const src=parts[id],shaftStart=id==='column'?61:29,shaftH=id==='column'?17:62,head=id==='column'?73:29,foot=24;
 const ops=[{input:await sharp(src).extract({left:0,top:0,width:64,height:head}).png().toBuffer(),left:0,top:0}];
 for(let y=head;y<h-foot;y+=shaftH){let hh=Math.min(shaftH,h-foot-y);ops.push({input:await sharp(src).extract({left:0,top:shaftStart,width:64,height:hh}).png().toBuffer(),left:0,top:y});}
 ops.push({input:await sharp(src).extract({left:0,top:128-foot,width:64,height:foot}).png().toBuffer(),left:0,top:h-foot});return blank(64,h).composite(ops).png().toBuffer();
}
let motif=0;const motifs=['angel','cross','skull','mourner'];
async function section(x,y,cells,heightCells){
 const px=x*64,py=y*64,pw=cells*64,ph=heightCells*64;
 if(heightCells===3){
  await section(x,y,cells,2);
  let cursor=0,i=0;while(cursor<pw){const length=[128,113,121,103,117,109,126][i%7],ww=Math.min(length,pw-cursor),id=i%2?'right':'left',top=98+(i*3)%7,left=id==='left'?45:84;
   let tile=await sharp(path.join(ASSETS,id+'.png')).extract({left,top,width:30,height:ww}).rotate(i%2?270:90).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   if(cursor)for(let yy=0;yy<30;yy++)for(let xx=0;xx<8;xx++)tile.data[(yy*ww+xx)*4+3]=Math.round(tile.data[(yy*ww+xx)*4+3]*xx/8);
   await place(await sharp(tile.data,{raw:tile.info}).png().toBuffer(),px+cursor,py+128);beltSources.push({id,left,top,width:30,height:ww,rotation:i%2?270:90,x:px+cursor});
   if(cursor+ww>=pw)break;cursor+=ww-8;i++;
  }
  return;
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
 // Approved A background stack, identical resources, height, opacity and veil.
 for(const [name,opacity]of [['far',1],['mid',.55]]){
  let im=sharp(H+'bg_graveyard_'+name+'_approved.png').resize({height:1800});
  if(opacity!==1)im=im.ensureAlpha().linear([1,1,1,opacity],[0,0,0,0]);
  const b=await im.png().toBuffer(),m=await sharp(b).metadata();for(let x=0;x<W;x+=m.width)await place(b,x,0);
 }
 await place(await blank(W,HEIGHT,{r:24,g:22,b:30,alpha:.22}).png().toBuffer(),0,0);
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
 for(let y=0;y<G.length;y++)for(let x=0;x<G[y].length;x++)if(G[y][x]==='='&&G[y][x-1]!=='='){
  let end=x+1;while(G[y][end]==='=')end++;const ww=(end-x)*64;
  const shelf=await sharp(H+'bridge_approved.png').extract({left:454,top:677,width:630,height:210}).resize({width:ww}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=3;i<shelf.data.length;i+=4)if(shelf.data[i]<30)shelf.data[i]=0;
  await place(await sharp(shelf.data,{raw:shelf.info}).png().toBuffer(),x*64,y*64+6);
 }
 const exposed=(x,y)=>['#','='].includes(G[y]?.[x])&&G[y-1]?.[x]!=='#';
 for(let y=0;y<G.length;y++)for(let x=0;x<G[y].length;x++)if(exposed(x,y)&&(x===0||!exposed(x-1,y))){let end=x+1;while(exposed(end,y))end++;const ww=(end-x)*64;const top=await strip('cornice',ww,18,x*64,y*64);await place(await opaque(top),x*64,y*64);}
 // A single lower strip for each continuous bottom boundary of the masonry.
 for(let y=0;y<G.length;y++)for(let x=0;x<G[y].length;x++)if(G[y][x]==='#'&&G[y+1]?.[x]!=='#'&&(x===0||G[y][x-1]!=='#'||G[y+1]?.[x-1]==='#')){let end=x+1;while(G[y][end]==='#'&&G[y+1]?.[end]!=='#')end++;await place(await strip('bottom',(end-x)*64,34,x*64,(y+1)*64-34),x*64,(y+1)*64-34);}
 for(const a of audit)for(const b of audit)if(a.x+a.cells===b.x){const y0=Math.max(a.y,b.y)*64,y1=Math.min(a.y+a.heightCells,b.y+b.heightCells)*64;if(y1>y0)seams.push({kind:'section-contact',x:b.x*64,y0,y1});}
 let platformBuffer=await blank(W,HEIGHT).composite(platformOps).png().toBuffer();const pixels=await sharp(platformBuffer).ensureAlpha().raw().toBuffer();
 for(const b of bottomMasks){const d=await sharp(b.input).ensureAlpha().raw().toBuffer();for(let yy=0;yy<34;yy++)for(let xx=0;xx<b.width;xx++){let a=d[(yy*b.width+xx)*4+3];pixels[((b.y+yy)*W+b.x+xx)*4+3]=a<24?0:a>230?255:a;}}
 platformBuffer=await sharp(pixels,{raw:{width:W,height:HEIGHT,channels:4}}).png().toBuffer();await sharp(platformBuffer).toFile(path.join(OUT,'platforms-alpha.png'));
let gaps=0;for(const s of seams){let bad=0;for(let y=s.y0;y<s.y1;y++)for(let xx=s.x-2;xx<s.x+2;xx++)if(!bottomMasks.some(b=>xx>=b.x&&xx<b.x+b.width&&y>=b.y+5)&&pixels[(y*W+xx)*4+3]!==255)bad++;s.transparentPixels=bad;if(bad)gaps++;}
 const check={checkedSeams:seams.length,seamsWithGaps:gaps,criteria:'4px-wide contact band, alpha must equal 255; measured on isolated platform layer without background',seams};fs.writeFileSync(path.join(OUT,'seam-audit.json'),JSON.stringify(check,null,2));if(gaps)throw Error(JSON.stringify(check));
 platformMode=false;
 let sh=356,sy=1012,sp,contacts=[];
 for(let pass=0;pass<5;pass++){
  sp=await sharp(H+'column_support_approved.png').resize(246,sh).modulate({brightness:1.05,saturation:.8}).png().toBuffer();const sd=await sharp(sp).ensureAlpha().raw().toBuffer();contacts=[];
  for(let x=20;x<226;x++){let edge=-1,top=-1;for(let y=896;y<1024;y++)if(pixels[(y*W+2245+x)*4+3]>=200)edge=y;for(let y=0;y<60;y++)if(sd[(y*246+x)*4+3]>=200){top=y;break;}contacts.push({edge,top});}
  sy=Math.min(...contacts.map(c=>c.edge-c.top))-2;let bottom=0;for(let y=0;y<sh;y++)for(let x=20;x<226;x++)if(sd[(y*246+x)*4+3]>=200)bottom=y;const delta=1348-sy-bottom;if(Math.abs(delta)<=1)break;sh+=delta;
 }
 await place(sp,2245,sy);await place(platformBuffer,0,0);fs.writeFileSync(path.join(OUT,'support-contact.json'),JSON.stringify({x:2245,y:sy,height:sh,checked:contacts.length,gaps:contacts.filter(c=>sy+c.top>c.edge+1).length}));
 const D=JSON.parse(fs.readFileSync(path.join(__dirname,'small-map-layout.json'),'utf8')).decor;
 for(const d of D){let candle=['candle','candles'].includes(d.id);await place(await sharp(H+'decor_'+d.id+'.png').resize(Math.round(d.w),Math.round(d.h)).modulate({brightness:candle?.9:.76,saturation:candle?.72:.55}).png().toBuffer(),d.x,d.y);}
 await place(await sharp(H+'hero_preview.png').resize({height:140}).png().toBuffer(),830,767);
 const full=path.join(OUT,'map-a-full.png');await blank(W,HEIGHT,'#27272d').composite(placements).png().toFile(full);
 for(const[name,left]of[['left',0],['middle',1024],['right',2048]])await sharp(full).extract({left,top:1280,width:1024,height:256}).png().toFile(path.join(OUT,'foundation-'+name+'.png'));
 await sharp(full).extract({left:0,top:448,width:448,height:448}).png().toFile(path.join(OUT,'shelves-left.png'));
 fs.writeFileSync(path.join(OUT,'belt-provenance.json'),JSON.stringify(beltSources,null,2));
 const geometryAudit={source:geometryPath,sha256:crypto.createHash('sha256').update(raw).digest('hex'),width:W,height:HEIGHT,solidCells:seen.size,thinCells:G.join('').split('=').length-1,sections:audit,decorCount:D.length,geometryUnchanged:raw.equals(fs.readFileSync(geometryPath)),archesClipped:0};
 fs.writeFileSync(path.join(OUT,'map-audit.json'),JSON.stringify(geometryAudit,null,2));
 const html='<!doctype html><meta charset="utf-8"><title>F — проверка поверхности и модулей</title><style>body{margin:0;background:#27272d;color:#eee;font:16px system-ui}img{display:block;width:100%;height:auto}details{padding:16px}summary{cursor:pointer}</style><img src="map-a-full.png" alt="Вся карта F"><details open><summary>Правая часть</summary><img src="map-a-right.png"></details><details><summary>Детали и эталон</summary><img src="details-and-reference.png"></details>';
 fs.writeFileSync(path.join(OUT,'preview.html'),html);console.log(JSON.stringify(geometryAudit,null,2));
})();

