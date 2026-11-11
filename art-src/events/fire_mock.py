import numpy as np
from PIL import Image, ImageDraw
rng=np.random.default_rng(3)
def vnoise(shape_res, seed):
    r=np.random.default_rng(seed); return r.random(shape_res)
# periodic value noise via tiled grid, sample with bilinear
G=[np.random.default_rng(s).random((64,64)) for s in range(4)]
def samp(g,x,y):
    n=g.shape[0]; x0=np.floor(x).astype(int); y0=np.floor(y).astype(int)
    fx=x-x0; fy=y-y0; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy)
    a=g[y0%n,x0%n];b=g[y0%n,(x0+1)%n];c=g[(y0+1)%n,x0%n];d=g[(y0+1)%n,(x0+1)%n]
    return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy
def fire(W,H,t,period,orb=False,wid=0.42):
    ys,xs=np.mgrid[0:H,0:W].astype(float)
    u=xs/W-0.5; v=1-ys/H  # v=0 bottom
    n=0;amp=0.5;f=1
    for o in range(4):
        sp=64/period*(o+1)  # scroll speed so loops (integer cells per period)
        n+=amp*samp(G[o],u*6*f+3,(v*5*f)-t*sp*(1 if o%2==0 else 1))
        amp*=0.5;f*=2
    # shape: teardrop narrowing upward
    width=wid*(1-v)**0.7+0.02
    if orb: width=wid*np.sqrt(np.clip(v*(1-v)*4,0,1))*(1-v)**0.3+0.01
    shape=1-np.abs(u)/width
    shape=np.clip(shape,0,1)
    heat=shape*(1.25-v*1.1)+ (n-0.5)*1.1 - v*0.35
    heat=np.clip(heat,0,1.2)
    # ramp
    a=np.clip((heat-0.18)/0.25,0,1)
    if orb: a=a*np.clip(v/0.12,0,1)
    r=np.clip(heat*2.2,0,1); g=np.clip((heat-0.3)*1.8,0,1); b=np.clip((heat-0.75)*2.5,0,1)
    col=np.dstack([255*r,255*(0.35*r+0.65*g),255*b,255*a]).astype(np.uint8)
    return Image.fromarray(col,'RGBA')
S=2
def glow(R,c,amax):
    ys,xs=np.mgrid[0:2*R,0:2*R]; d=np.sqrt((xs-R)**2+(ys-R)**2)/R
    a=np.clip(1-d,0,1)**2*amax
    return Image.fromarray(np.dstack([np.full_like(a,c[0]),np.full_like(a,c[1]),np.full_like(a,c[2]),a]).astype(np.uint8),'RGBA')
bz=Image.open('/mnt/project-files/new-events/art/Brazier.png')
BH=100; bw=round(bz.width*BH/bz.height); bzs=bz.resize((bw*S,BH*S),Image.LANCZOS)
hero=Image.open('/home/user/ruchapov/right-place-game/public/assets/sprites/hero/idle.png').crop((0,0,394,296))
heros=hero.resize((round(394*140/296*S),round(140*S)),Image.LANCZOS)
W,H=560*S,280*S; floor=230*S; rim=round(9/260*BH*S)
P=24; frames=[]
for i in range(P):
    t=i/P*P
    big=fire(int(bw*0.85*S),int(115*S),i,P,wid=0.5)
    small=fire(int(30*S),int(46*S),i+7,P,orb=True,wid=0.5)
    im=Image.new('RGBA',(W,H),(28,26,32,255)); d=ImageDraw.Draw(im)
    d.rectangle((0,floor,W,H),fill=(55,50,48,255))
    x0=40*S; by=floor-bzs.height
    # glow
    gl=Image.new('RGBA',(W,H),(0,0,0,0)); gd=ImageDraw.Draw(gl)
    im.alpha_composite(glow(160*S,(255,140,40),70),(x0+bzs.width//2-160*S,by-40*S-160*S+60*S))
    im.alpha_composite(bzs,(x0,by))
    im.alpha_composite(big,(x0+(bzs.width-big.width)//2, by+rim+6*S-big.height))
    hx=230*S; hy=floor-heros.height+11*S
    im.alpha_composite(heros,(hx,hy))
    fy=hy-10*S-small.height+int(3*S*np.sin(i/P*2*np.pi))
    cx=hx+heros.width//2-6*S
    im.alpha_composite(glow(60*S,(255,140,40),60),(cx-60*S,fy+small.height//2-60*S))
    im.alpha_composite(small,(cx-small.width//2, fy))
    im.alpha_composite(bzs,(400*S,by))
    frames.append(im.convert('RGB'))
frames[0].save('/mnt/project-files/new-events/art/fire_shader_preview.gif',save_all=True,append_images=frames[1:],duration=50,loop=0)
frames[5].save('f5.png')
