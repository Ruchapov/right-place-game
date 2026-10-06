const fs=require('fs'),path=require('path'),sharp=require('D:/dev/telegram-game/node_modules/sharp');sharp.cache(false);sharp.concurrency(1);
(async()=>{
 const root=__dirname,out=path.join(root,'a-panel-foundation-review');fs.mkdirSync(out,{recursive:true});
 const basePath=path.join(root,'a-transparent-height-review/map-a-full.png'),base=await sharp(basePath).ensureAlpha().raw().toBuffer(),old=await sharp(path.join(root,'a-final-review/map-a-full.png')).ensureAlpha().raw().toBuffer(),W=3072,H=1536;
 const panel=fs.readFileSync(path.join(root,'f-panel-wall-study/approved-panel.png')),head=fs.readFileSync(path.join(root,'f-panel-wall-study/approved-skull-column.png')),rail=fs.readFileSync(path.join(root,'f-panel-wall-study/approved-rail.png')),ops=[];
 for(let x=0;x<W;x+=124){const w=Math.min(128,W-x);ops.push({input:await sharp(panel).extract({left:0,top:0,width:w,height:64}).png().toBuffer(),left:x,top:0});}
 for(const x of[0,W-60])ops.push({input:await sharp(head).extract({left:0,top:0,width:60,height:64}).png().toBuffer(),left:x,top:0});
 for(let x=0;x<W;x+=124)ops.push({input:await sharp(rail).extract({left:0,top:0,width:Math.min(128,W-x),height:8}).png().toBuffer(),left:x,top:0});
 const body=await sharp({create:{width:W,height:64,channels:4,background:'#6a6455'}}).composite(ops).raw().toBuffer(),result=Buffer.from(base);
 // Restore the existing frieze beneath the temporary chipped silhouette. No new arch render.
 old.copy(result,1438*W*4,1438*W*4,1472*W*4);body.copy(result,1472*W*4);
 const diff=Buffer.from(base);let changed=0,outside=0;for(let i=0;i<base.length;i+=4){if([0,1,2,3].some(c=>result[i+c]!==base[i+c])){changed++;if(i<1438*W*4)outside++;diff[i]=255;diff[i+1]=0;diff[i+2]=0;}else for(let c=0;c<3;c++)diff[i+c]=Math.round(base[i+c]*.45);diff[i+3]=255;}
 if(outside)throw Error('Unexpected changes');
 await sharp(result,{raw:{width:W,height:H,channels:4}}).png().toFile(path.join(out,'map-a-full.png'));await sharp(diff,{raw:{width:W,height:H,channels:4}}).png().toFile(path.join(out,'map-a-difference.png'));
 await sharp(result,{raw:{width:W,height:H,channels:4}}).extract({left:1024,top:1280,width:1024,height:256}).png().toFile(path.join(out,'foundation-close.png'));
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({baseline:basePath,changedPixels:changed,changedOutsideFoundation:outside,externalSkullColumns:2,bottomEdge:false,mapFileModified:false},null,2));console.log({changed,outside});
})();
