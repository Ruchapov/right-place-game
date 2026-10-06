const sharp=require('D:/dev/telegram-game/node_modules/sharp');sharp.cache(false);sharp.concurrency(1);
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'f-solid-masses-review'),read=n=>JSON.parse(fs.readFileSync(path.join(root,n)));
(async()=>{
 const p=await sharp(path.join(root,'platforms-alpha.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true}),W=p.info.width;
 const old=await sharp(path.join(__dirname,'f-three-fixes-review/map-f-full.png')).ensureAlpha().raw().toBuffer(),now=await sharp(path.join(root,'map-f-full.png')).ensureAlpha().raw().toBuffer();
 const allowed=[[2048,640,384,192],[2816,1152,256,256],[1050,920,246,390]];
 let outsideChanges=0;for(let y=0;y<p.info.height;y++)for(let x=0;x<W;x++){if(allowed.some(([a,b,w,h])=>x>=a&&x<a+w&&y>=b&&y<b+h))continue;const i=(y*W+x)*4;if([0,1,2,3].some(c=>old[i+c]!==now[i+c]))outsideChanges++;}
 const support=read('support-audit.json'),s=read('seam-audit.json'),m=read('map-audit.json'),a=read('three-fixes-audit.json');
 let belowChecked=0,belowOpaque=0;for(const[x0,x1,y]of[[64,1600,448],[640,1664,960],[2048,2432,832]])for(let yy=y;yy<y+8;yy++)for(let x=x0;x<x1;x++){belowChecked++;if(p.data[(yy*W+x)*4+3])belowOpaque++;}
 let riserGaps=0;for(const r of support.risers)for(let y=r.y;y<r.y+r.height;y++){let opaque=0;for(let x=r.x;x<r.x+r.width;x++)if(p.data[(y*W+x)*4+3]>=230)opaque++;if(!opaque)riserGaps++;}
 const badColumns=a.thickBlocks.flatMap(b=>b.skullColumns.filter(x=>!(b.y<15?[32,37]:[44,47]).includes(x)));
 const noMassArches=a.thickBlocks.every(b=>b.arch===null),rulesHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'APPROVED_RULES.txt'))).digest('hex');
 const result={rulesHash,checkedSeams:s.checkedSeams,seamsWithGaps:s.seamsWithGaps,supportContactColumns:support.contactColumns,supportGaps:support.gaps,riserCount:support.risers.length,riserRowsWithGaps:riserGaps,noMassArches,interiorSkullColumns:badColumns.length,belowChecked,belowOpaque,changedPixelsOutsideRequestedAreas:outsideChanges,geometryUnchanged:m.geometryUnchanged,decorCount:m.decorCount,visualReview:'Full image and all three closeups opened and inspected; textures and previous chipped bottom retained.'};
 result.passed=!outsideChanges&&!riserGaps&&!belowOpaque&&!badColumns.length&&noMassArches&&!s.seamsWithGaps&&!support.gaps&&m.geometryUnchanged&&rulesHash===support.rulesHash;
 fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
})();
