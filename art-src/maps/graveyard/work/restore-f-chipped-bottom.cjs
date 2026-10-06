const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('D:/dev/telegram-game/node_modules/sharp');sharp.cache(false);sharp.concurrency(1);
const root=__dirname,out=path.join(root,'f-chipped-bottom-review'),base=path.join(root,'approved_v2/map-f-full.png'),source=path.join(root,'f-solid-masses-review/map-f-full.png');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const a=await sharp(base).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(source).ensureAlpha().raw().toBuffer(),result=Buffer.from(a.data),diff=Buffer.from(a.data),W=a.info.width,H=a.info.height,mask=new Uint8Array(W*H);
 const strips=[[64,414,1536,34],[640,926,1024,34],[0,1374,2816,34]];
 for(const[x,y,w,h]of strips)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const p=yy*W+xx,i=p*4;mask[p]=1;for(let c=0;c<4;c++)result[i+c]=b[i+c];}
 let changed=0,outside=0;for(let p=0;p<W*H;p++){const i=p*4,different=[0,1,2,3].some(c=>a.data[i+c]!==result[i+c]);if(different){changed++;if(!mask[p])outside++;diff[i]=255;diff[i+1]=0;diff[i+2]=0;}else for(let c=0;c<3;c++)diff[i+c]=Math.round(a.data[i+c]*.45);diff[i+3]=255;}
 let blockChanges=0;for(const[x,y,w,h]of[[2048,640,384,192],[2816,1152,256,256]])for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*W+xx)*4;if([0,1,2,3].some(c=>a.data[i+c]!==result[i+c]))blockChanges++;}
 const alpha=await sharp(path.join(root,'f-solid-masses-review/platforms-alpha.png')).ensureAlpha().raw().toBuffer();let transparentUnderContour=0,opaqueBelow=0;
 for(const[x,y,w,h]of strips)for(let xx=x;xx<x+w;xx++){let lowest=y-1;for(let yy=y;yy<y+h;yy++)if(alpha[(yy*W+xx)*4+3])lowest=yy;for(let yy=lowest+1;yy<y+h;yy++){transparentUnderContour++;if(alpha[(yy*W+xx)*4+3])opaqueBelow++;}}
 if(outside||blockChanges||opaqueBelow)throw Error('Scope/alpha check failed');
 await sharp(result,{raw:a.info}).png().toFile(path.join(out,'map-f-full.png'));await sharp(diff,{raw:a.info}).png().toFile(path.join(out,'map-f-difference.png'));
 await sharp(result,{raw:a.info}).extract({left:608,top:864,width:1088,height:192}).png().toFile(path.join(out,'map-f-middle-bottom.png'));
 const report={comparison:base,restoredFrom:source,strips,changedPixels:changed,changedOutsideBridgeBottoms:outside,rightBlockChangedPixels:blockChanges,transparentPixelsUnderContour:transparentUnderContour,opaquePixelsBelowContour:opaqueBelow,approvedV2Unchanged:true,rulesSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'APPROVED_RULES.txt'))).digest('hex')};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(report);
})();
