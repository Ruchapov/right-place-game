const fs=require('fs'),path=require('path');let s=fs.readFileSync(path.join(__dirname,'assemble-f-strict-preview.cjs'),'utf8');
s=s.replace("'f-strict-review'","'a-final-review'").replace('map_F_sanctuary.txt','map_A_serpentine.txt');
s=s.replace('const placements=[],audit=[],parts={},platformOps=[],seams=[]','const placements=[],audit=[],parts={},platformOps=[],seams=[],bottomMasks=[],beltSources=[]');
const start=s.indexOf(' if((x>=32'),end=s.indexOf(' if(cells<=3)',start);
s=s.slice(0,start)+` if(heightCells===3){
  await section(x,y,cells,2);
  let cursor=0,i=0;while(cursor<pw){const length=[128,113,121,103,117,109,126][i%7],ww=Math.min(length,pw-cursor),id=i%2?'right':'left',top=52+(i*17)%62,left=id==='left'?27:73;
   let tile=await sharp(path.join(ASSETS,id+'.png')).extract({left,top,width:64,height:ww}).rotate(i%2?270:90).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   if(cursor)for(let yy=0;yy<64;yy++)for(let xx=0;xx<8;xx++)tile.data[(yy*ww+xx)*4+3]=Math.round(tile.data[(yy*ww+xx)*4+3]*xx/8);
   await place(await sharp(tile.data,{raw:tile.info}).png().toBuffer(),px+cursor,py+128);beltSources.push({id,left,top,width:64,height:ww,rotation:i%2?270:90,x:px+cursor});
   if(cursor+ww>=pw)break;cursor+=ww-8;i++;
  }
  return;
 }
`+s.slice(end);
const st=s.indexOf(' const prior='),en=s.indexOf(' // Derive connected',st);s=s.slice(0,st)+s.slice(en);
// Bottom pixels copied from approved reference; original alpha clips the backing.
s=s.replace("async function strip(id,width,height,worldX,worldY){",`async function strip(id,width,height,worldX,worldY){if(id==='bottom'){
 const edge=await sharp(H+'bridge_approved.png').extract({left:145,top:417,width:1240,height:68}).resize(620,34).png().toBuffer(),ops=[];
 for(let xx=0;xx<width;xx+=616){const ww=Math.min(620,width-xx);ops.push({input:await sharp(edge).extract({left:0,top:0,width:ww,height:34}).png().toBuffer(),left:xx,top:0});}
 const im=await blank(width,34).composite(ops).png().toBuffer();bottomMasks.push({input:im,x:worldX,y:worldY,width});return im;
 }`);
s=s.replace("strip('bottom',(end-x)*64,28,x*64,(y+1)*64-28),x*64,(y+1)*64-28","strip('bottom',(end-x)*64,34,x*64,(y+1)*64-34),x*64,(y+1)*64-34");
s=s.replace(" const platformBuffer=await blank(W,HEIGHT).composite(platformOps).png().toBuffer();await sharp(platformBuffer).toFile(path.join(OUT,'platforms-alpha.png'));\n const pixels=await sharp(platformBuffer).raw().toBuffer();",` let platformBuffer=await blank(W,HEIGHT).composite(platformOps).png().toBuffer();const pixels=await sharp(platformBuffer).ensureAlpha().raw().toBuffer();
 for(const b of bottomMasks){const d=await sharp(b.input).ensureAlpha().raw().toBuffer();for(let yy=0;yy<34;yy++)for(let xx=0;xx<b.width;xx++){let a=d[(yy*b.width+xx)*4+3];pixels[((b.y+yy)*W+b.x+xx)*4+3]=a<24?0:a>230?255:a;}}
 platformBuffer=await sharp(pixels,{raw:{width:W,height:HEIGHT,channels:4}}).png().toBuffer();await sharp(platformBuffer).toFile(path.join(OUT,'platforms-alpha.png'));
`);
s=s.replace("if(pixels[(y*W+xx)*4+3]!==255)bad++","if(!bottomMasks.some(b=>xx>=b.x&&xx<b.x+b.width&&y>=b.y+5)&&pixels[(y*W+xx)*4+3]!==255)bad++");
s=s.replace(' platformMode=false;await place(platformBuffer,0,0);',` platformMode=false;
 let sh=356,sy=1012,sp,contacts=[];
 for(let pass=0;pass<5;pass++){
  sp=await sharp(H+'column_support_approved.png').resize(246,sh).modulate({brightness:1.05,saturation:.8}).png().toBuffer();const sd=await sharp(sp).ensureAlpha().raw().toBuffer();contacts=[];
  for(let x=20;x<226;x++){let edge=-1,top=-1;for(let y=896;y<1024;y++)if(pixels[(y*W+2245+x)*4+3]>=200)edge=y;for(let y=0;y<60;y++)if(sd[(y*246+x)*4+3]>=200){top=y;break;}contacts.push({edge,top});}
  sy=Math.min(...contacts.map(c=>c.edge-c.top))-2;let bottom=0;for(let y=0;y<sh;y++)for(let x=20;x<226;x++)if(sd[(y*246+x)*4+3]>=200)bottom=y;const delta=1348-sy-bottom;if(Math.abs(delta)<=1)break;sh+=delta;
 }
 await place(sp,2245,sy);await place(platformBuffer,0,0);fs.writeFileSync(path.join(OUT,'support-contact.json'),JSON.stringify({x:2245,y:sy,height:sh,checked:contacts.length,gaps:contacts.filter(c=>sy+c.top>c.edge+1).length}));`);
s=s.replace("'map-f-audit.json'","'small-map-layout.json'");
s=s.replace('.resize(d.w,d.h)', '.resize(Math.round(d.w),Math.round(d.h))');
s=s.replace('),322,1151)', '),830,767)');
s=s.replaceAll('map-f-','map-a-');
const cropStart=s.indexOf(' await sharp(full).extract'),cropEnd=s.indexOf(' const geometryAudit',cropStart);
s=s.slice(0,cropStart)+` for(const[name,left]of[['left',0],['middle',1024],['right',2048]])await sharp(full).extract({left,top:1280,width:1024,height:256}).png().toFile(path.join(OUT,'foundation-'+name+'.png'));
 await sharp(full).extract({left:0,top:448,width:448,height:448}).png().toFile(path.join(OUT,'shelves-left.png'));
 fs.writeFileSync(path.join(OUT,'belt-provenance.json'),JSON.stringify(beltSources,null,2));
`+s.slice(cropEnd);
s=s.replace("const html='<!doctype", "const html='<!doctype");
fs.writeFileSync(path.join(__dirname,'assemble-a-preview.cjs'),s);
