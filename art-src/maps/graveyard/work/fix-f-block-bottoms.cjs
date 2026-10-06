const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('D:/dev/telegram-game/node_modules/sharp');sharp.cache(false);sharp.concurrency(1);
(async()=>{
 const out=path.join(__dirname,'f-all-bottoms-review');fs.mkdirSync(out,{recursive:true});
 const base=path.join(__dirname,'f-chipped-bottom-review/map-f-full.png'),source=path.join(__dirname,'f-solid-masses-review/map-f-full.png');
 const a=await sharp(base).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(source).ensureAlpha().raw().toBuffer(),result=Buffer.from(a.data),diff=Buffer.from(a.data),W=a.info.width,H=a.info.height,mask=new Uint8Array(W*H);
 const strips=[[2048,804,384,28],[2816,1380,256,28]];
 for(const[x,y,w,h]of strips)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const p=yy*W+xx,i=p*4;mask[p]=1;for(let c=0;c<4;c++)result[i+c]=b[i+c];}
 let changed=0,outside=0;for(let p=0;p<W*H;p++){const i=p*4,different=[0,1,2,3].some(c=>a.data[i+c]!==result[i+c]);if(different){changed++;if(!mask[p])outside++;diff[i]=255;diff[i+1]=0;diff[i+2]=0;}else for(let c=0;c<3;c++)diff[i+c]=Math.round(a.data[i+c]*.45);diff[i+3]=255;}
 if(outside)throw Error('Change outside requested bottom edges');
 await sharp(result,{raw:a.info}).png().toFile(path.join(out,'map-f-full.png'));await sharp(diff,{raw:a.info}).png().toFile(path.join(out,'map-f-difference.png'));
 for(const[name,left,top,width,height]of[['map-f-upper-step.png',1984,576,576,320],['map-f-lower-step.png',2688,1088,384,320]])await sharp(result,{raw:a.info}).extract({left,top,width,height}).png().toFile(path.join(out,name));
 const report={baseline:base,source,strips,changedPixels:changed,changedOutsideTwoBottomEdges:outside,panelsColumnsIvyAndBridgesUnchanged:outside===0,rulesSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'APPROVED_RULES.txt'))).digest('hex')};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(report);
})();
