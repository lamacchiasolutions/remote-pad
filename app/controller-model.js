(() => {
  "use strict";
  if (window.RemotePadModel) return;

  const TAU = Math.PI * 2;
  const lime = "#c2ef8e";
  const controls = {
    lt: ["Left trigger", -1.40, -1.44, -.17, .39, .15],
    rt: ["Right trigger", 1.40, -1.44, -.17, .39, .15],
    lb: ["Left bumper", -1.42, -1.17, .16, .47, .13],
    rb: ["Right bumper", 1.42, -1.17, .16, .47, .13],
    ls: ["Left stick", -1.42, -.38, .54, .41, .42],
    rs: ["Right stick", .66, .33, .54, .39, .40],
    a: ["A", 1.43, -.01, .45, .17, .17],
    b: ["B", 1.79, -.36, .45, .17, .17],
    x: ["X", 1.07, -.36, .45, .17, .17],
    y: ["Y", 1.43, -.71, .45, .17, .17],
    view: ["View", -.33, -.34, .42, .155, .135],
    menu: ["Menu", .33, -.34, .42, .155, .135],
    guide: ["Guide", 0, -.84, .43, .20, .20],
    up: ["D-pad up", -.66, .066, .43, .15, .135],
    down: ["D-pad down", -.66, .594, .43, .15, .135],
    left: ["D-pad left", -.924, .33, .43, .135, .15],
    right: ["D-pad right", -.396, .33, .43, .135, .15]
  };
  const front = { yaw: -.065, pitch: .28 };
  const shoulders = { yaw: 0, pitch: 1.04 };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const directionMap = {
    lxLeft: "ls", lxRight: "ls", lyUp: "ls", lyDown: "ls",
    rxLeft: "rs", rxRight: "rs", ryUp: "rs", ryDown: "rs"
  };

  function circle(rx, ry = rx, count = 40) {
    return Array.from({ length: count }, (_, i) => {
      const angle = TAU * i / count;
      return [rx * Math.cos(angle), ry * Math.sin(angle)];
    });
  }

  function roundedRect(w, h, r) {
    const points = [];
    for (let corner = 0; corner < 4; corner++) {
      const x = corner === 0 || corner === 3 ? w / 2 - r : r - w / 2;
      const y = corner < 2 ? h / 2 - r : r - h / 2;
      for (let i = 0; i <= 5; i++) {
        const a = (corner + i / 5) * Math.PI / 2;
        points.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
      }
    }
    return points;
  }

  function shellOutline() {
    const half = [[0, -1.18]];
    function curve(x1, y1, x2, y2, x3, y3) {
      const [x0, y0] = half[half.length - 1];
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, s = 1 - t;
        half.push([
          s**3*x0 + 3*s*s*t*x1 + 3*s*t*t*x2 + t**3*x3,
          s**3*y0 + 3*s*s*t*y1 + 3*s*t*t*y2 + t**3*y3
        ]);
      }
    }
    curve(-.45, -1.18, -.85, -1.29, -1.52, -1.28);
    curve(-1.90, -1.30, -2.13, -1.11, -2.24, -.78);
    curve(-2.40, -.32, -2.61, .66, -2.58, 1.15);
    curve(-2.57, 1.55, -2.44, 1.77, -2.22, 1.75);
    curve(-1.90, 1.76, -1.67, 1.14, -1.39, .90);
    curve(-1.09, .79, -.64, .94, 0, .92);
    const opposite = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
    return half.concat(opposite).reverse();
  }

  // A loft connects closed contours in model space. Each surface keeps its
  // outward normal for lighting and visibility as the camera moves.
  function loft(x, y, contour, layers, color, id) {
    const rings = layers.map(([z, scale]) => contour.map(([u, v]) => [x+u*scale, y+v*scale, z]));
    const faces = [];
    for (let j = 1; j < rings.length; j++) {
      const lower = rings[j-1], upper = rings[j];
      for (let i = 0; i < upper.length; i++) {
        const k = (i + 1) % upper.length;
        const a = lower[i], b = lower[k], c = upper[k];
        const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
        const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
        const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
        const length = Math.hypot(nx,ny,nz);
        if (length < 1e-9) continue;
        faces.push({points:[a,b,c,upper[i]], normal:[nx/length,ny/length,nz/length]});
      }
    }
    return { x, y, faces, top:rings[rings.length-1], color, id };
  }

  const shell = loft(0, 0, shellOutline(), [
    [-.55,.91], [-.47,.965], [-.27,1], [-.045,1.014], [.085,1.008],
    [.18,.987], [.245,.960], [.27,.934]
  ], [95,112,101]);
  const backKeys = [], upperKeys = [], faceParts = [];
  const disc = (x,y,r,layers,color,id) => loft(x,y,circle(r),layers,color,id);
  const insert = [25,34,30], graphite = [56,67,60], keyTop = [53,65,58];
  function tiltShoulder(part, y0, z0, angle) {
    const c=Math.cos(angle), s=Math.sin(angle);
    const tilt=([x,y,z])=>[x, y0+(y-y0)*c-(z-z0)*s, z0+(y-y0)*s+(z-z0)*c];
    part.top=part.top.map(tilt);
    for(const face of part.faces) {
      face.points=face.points.map(tilt);
      const [x,y,z]=face.normal;
      face.normal=[x,y*c-z*s,y*s+z*c];
    }
    part.angle=angle;
    return part;
  }
  for (const id of ["lt","rt","lb","rb"]) {
    const [,x,y,z] = controls[id], trigger = id.endsWith("t");
    const group = trigger ? backKeys : upperKeys;
    const part=loft(x,y,roundedRect(trigger ? .98 : 1.11,trigger ? .42 : .26,.11),
      [[z-.17,.82],[z-.14,.96],[z-.055,1],[z,.94]], trigger ? [56,70,64] : [75,89,80], id);
    group.push(tiltShoulder(part,y,z,trigger ? .78 : .47));
  }
  for (const id of ["ls","rs"]) {
    const [,x,y] = controls[id];
    faceParts.push(disc(x,y,.456,[[.274,1],[.292,.99],[.310,.92]],insert));
    faceParts.push(disc(x,y,.305,[[.309,.86],[.41,.72],[.445,.89]],graphite));
    faceParts.push(disc(x,y,.374,[[.405,.75],[.440,.99],[.491,1],[.532,.94],[.552,.83]],keyTop,id));
  }
  for (const id of ["a","b","x","y"]) {
    const [,x,y] = controls[id];
    faceParts.push(disc(x,y,.191,[[.272,1],[.287,.98]],insert));
    faceParts.push(disc(x,y,.160,[[.282,.98],[.346,1],[.420,.91],[.436,.77]],[42,52,47],id));
  }
  for (const id of ["view","menu","guide"]) {
    const [,x,y] = controls[id], guide = id === "guide";
    const outline = guide ? circle(.196) : roundedRect(.296,.205,.086);
    faceParts.push(loft(x,y,outline,[[.273,1.13],[.29,1.10]],insert));
    faceParts.push(loft(x,y,outline,[[.282,1.02],[.345,.97],[.392,.86]],guide ? [148,166,153] : [58,71,63],id));
  }
  const dpad = [-.66,.33];
  faceParts.push(disc(...dpad,.459,[[.272,1],[.296,.97],[.315,.92]],insert));
  faceParts.push(loft(...dpad,circle(.393,.393,8),[[.302,1],[.370,1],[.405,.90]],[65,77,71]));

  function tint(base, factor) {
    return "rgb("+base.map(v => Math.round(clamp(v*factor,0,255))).join(",")+")";
  }

  const styles = `
    :host{display:block;min-width:0;color:#c5d0c5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box}
    .stage{position:relative;width:100%;aspect-ratio:1.82;min-height:150px;overflow:hidden;isolation:isolate;touch-action:none;cursor:grab;border-radius:11px;
      background:radial-gradient(ellipse at 48% 39%,#314039 0%,#233028 49%,#1c261f 100%)}
    .stage:active{cursor:grabbing} canvas{display:block;width:100%;height:100%}
    .spot{display:block;position:absolute;transform:translate(-50%,-50%);border:0;padding:0;background:transparent;border-radius:50%;cursor:pointer;touch-action:none;color:transparent;-webkit-tap-highlight-color:transparent}
    .spot:focus-visible{outline:2px solid #c2ef8e;outline-offset:2px}
    .footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 1px 2px}
    .tip{font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#a9b9ac}
    .views{display:flex;gap:2px;border:1px solid #4a5a4d;border-radius:7px;padding:2px;background:#1a241d}
    .view{font:550 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#bac7ba;background:transparent;cursor:pointer;border:0;border-radius:5px;padding:5px 8px}
    .view:hover,.view:focus-visible{background:#35463a;color:#f2f7ee}.view[aria-pressed=true]{color:#d9efc8;background:#37483a}
    .view:focus-visible{outline:2px solid #c2ef8e}
  `;

  function mount(container, {onSelect} = {}) {
    const doc = container.ownerDocument;
    const el = (tag, cls) => { const n=doc.createElement(tag); if(cls)n.className=cls; return n; };
    const host = el("div"), root = host.attachShadow({mode:"open"});
    container.append(host);
    try {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(styles); root.adoptedStyleSheets = [sheet];
    } catch { const style=el("style"); style.textContent=styles; root.append(style); }
    const stage=el("div","stage"), canvas=el("canvas"), footer=el("div","footer");
    const tip=el("span","tip"), views=el("div","views");
    stage.setAttribute("role","group"); stage.setAttribute("aria-label","3D controller. Choose a control to edit its mapping.");
    canvas.setAttribute("aria-hidden","true"); tip.textContent="Drag to rotate";
    stage.append(canvas); footer.append(tip,views); root.append(stage,footer);
    const ctx=canvas.getContext("2d");
    const buttons=new Map(), presets=new Map();
    let yaw=front.yaw, pitch=front.pitch, selected="", hover="", raf=0, drag, moved=false, destroyed=false;
    let width=1, height=1, scale=1, sy,cy,sp,cp;

    function project(x,y,z) {
      const u=x*cy+z*sy, v=z*cy-x*sy;
      const depth=v*cp-y*sp, perspective=12/(12-depth);
      return [width/2+scale*u*perspective,height*.50+scale*(y*cp+v*sp)*perspective,depth];
    }

    function polygon(points,fill,edge=false) {
      ctx.beginPath();
      points.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
      ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
      if (edge) { ctx.strokeStyle=fill; ctx.lineWidth=.55; ctx.stroke(); }
    }
    function line(points,color,weight) {
      ctx.beginPath();
      points.forEach(([x,y,z],i)=>{const p=project(x,y,z); i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]);});
      ctx.lineCap="round"; ctx.lineJoin="round"; ctx.lineWidth=weight*scale; ctx.strokeStyle=color; ctx.stroke();
    }
    function localPath(points,x,y,z) { return points.map(([u,v])=>[x+u,y+v,z]); }
    function ring(x,y,z,r,color,weight) { const pts=circle(r); line(localPath([...pts,pts[0]],x,y,z),color,weight); }
    function active(id) { return id && (id === (directionMap[selected] || selected) || id === hover); }
    function material(part) {
      const colored=active(part.id);
      const base=colored ? [136,166,112] : part.color;
      for (const face of part.faces) {
        const [nx,ny,nz]=face.normal;
        const depth=(nz*cy-nx*sy)*cp-ny*sp;
        if(depth <= -.0001) continue;
        const light=.54+.34*Math.max(0,-.52*nx-.60*ny+.65*nz)+.12*Math.max(0,depth);
        polygon(face.points.map(p=>project(...p)),tint(base,light),true);
      }
      const pts=part.top.map(p=>project(...p));
      const ys=pts.map(p=>p[1]), y0=Math.min(...ys), y1=Math.max(...ys);
      const grad=ctx.createLinearGradient(0,y0,0,Math.max(y0+.01,y1));
      grad.addColorStop(0,tint(base,1.12)); grad.addColorStop(1,tint(base,.72));
      polygon(pts,grad);
      if(colored) {
        ctx.strokeStyle=lime; ctx.lineWidth=1.25; ctx.stroke();
      }
    }
    function textAt(str,x,y,z,size,color,weight=650,tilt=0) {
      const p=project(x,y,z), ax=project(x+.1,y,z), ay=project(x,y+.1*Math.cos(tilt),z+.1*Math.sin(tilt));
      ctx.save();
      ctx.transform((ax[0]-p[0])/(scale*.1),(ax[1]-p[1])/(scale*.1),
        (ay[0]-p[0])/(scale*.1),(ay[1]-p[1])/(scale*.1),p[0],p[1]);
      ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle=color;
      ctx.font=weight+" "+size*scale+"px -apple-system,BlinkMacSystemFont,Arial,sans-serif";
      ctx.fillText(str,0,0); ctx.restore();
    }
    function shellDetails() {
      for(const sign of [-1,1]) {
        const seam=[[2.04,-.85],[2.04,-.57],[2.00,-.29],[1.92,.04],[1.77,.39],[1.60,.68],[1.50,.83]];
        line(seam.map(([x,y])=>[x*sign,y,.273]),"#38483e",.011);
        line(seam.map(([x,y])=>[(x+.018)*sign,y,.274]),"#748373",.006);
      }
      // Soft contact shadows place the controls on the front plate.
      for(const [x,y,r] of [[-1.42,-.38,.51],[.66,.33,.51],[-.66,.33,.46]]) {
        const p=project(x+.025,y+.07,.277);
        ctx.save(); ctx.translate(p[0],p[1]); ctx.scale(scale*r,scale*r*Math.max(.45,cp));
        const shade=ctx.createRadialGradient(0,0,.52,0,0,1);
        shade.addColorStop(0,"#0a120db0");shade.addColorStop(1,"#0a120d00");
        ctx.fillStyle=shade;ctx.fillRect(-1,-1,2,2);ctx.restore();
      }
    }
    function faceDetails() {
      for (const id of ["ls","rs"]) {
        const [,x,y]=controls[id];
        ring(x,y,.556,.282,"#242e29",.014); ring(x,y,.557,.249,"#718173",.009);
        for(let j=0;j<24;j++) {
          const a=TAU*j/24, u=Math.cos(a), v=Math.sin(a);
          line([[x+.319*u,y+.319*v,.539],[x+.346*u,y+.346*v,.519]],"#94a094",.008);
        }
        textAt(id.toUpperCase(),x,y,.558,.12,active(id)?"#e8ffda":"#a8b5a8");
      }
      const colors={a:"#92dc83",b:"#f39085",x:"#83baf1",y:"#efd574"};
      for(const id of ["a","b","x","y"]) {
        const [,x,y]=controls[id]; textAt(id.toUpperCase(),x,y+.003,.443,.185,active(id)?"#233024":colors[id],730);
      }
      const [dx,dy]=dpad;
      for (const [id,u,v] of [["up",0,-1],["right",1,0],["down",0,1],["left",-1,0]]) {
        const right=[-v,u];
        const transform=(s,t,z)=>[dx+s*u+t*right[0],dy+s*v+t*right[1],z];
        const verts=[[.082,-.084,.413],[.29,-.125,.428],[.37,-.08,.438],[.37,.08,.438],[.29,.125,.428],[.082,.084,.413]];
        polygon(verts.map(p=>project(...transform(...p))),active(id)?"#bbdf99":(id==="up" || id==="left")?"#718075":"#58665d");
        line([[.237,-.046,.439],[.281,0,.439],[.237,.046,.439]].map(p=>transform(...p)),active(id)?"#273421":"#bdc9bc",.018);
      }
      const view=controls.view, menu=controls.menu;
      const icon=(points,control,color,w)=>line(localPath(points,control[1],control[2],.405),color,w);
      icon([[-.059,.017],[-.076,.017],[-.076,-.047],[-.002,-.047],[-.002,-.031]],view,"#e6ece3",.013);
      icon([[-.038,-.017],[.067,-.017],[.067,.049],[-.038,.049],[-.038,-.017]],view,"#e6ece3",.014);
      for(const y of [-.041,0,.041]) icon([[-.062,y],[.062,y]],menu,"#e6ece3",.014);
      const [,gx,gy]=controls.guide;
      line(localPath([[-.105,-.094],[-.056,-.080],[.016,-.018],[.098,.104]],gx,gy,.401),"#27372c",.032);
      line(localPath([[.100,-.096],[.047,-.069],[-.022,.008],[-.095,.104]],gx,gy,.401),"#27372c",.032);
    }
    function shoulderLabel(part) {
      const [,x,y,z]=controls[part.id];
      textAt(part.id.toUpperCase(),x,y,z+.010,.124,active(part.id)?"#203021":"#d2ddd2",650,part.angle);
    }
    function draw() {
      raf=0;
      if(destroyed) return;
      const rect=stage.getBoundingClientRect();
      if(!rect.width || !rect.height || !ctx) return;
      width=rect.width; height=rect.height;
      const dpr=Math.min(2,window.devicePixelRatio || 1);
      const bw=Math.round(width*dpr), bh=Math.round(height*dpr);
      if(canvas.width!==bw || canvas.height!==bh) { canvas.width=bw; canvas.height=bh; }
      ctx.setTransform(bw/width,0,0,bh/height,0,0); ctx.clearRect(0,0,width,height);
      scale=Math.min(width/5.85,height/3.90);
      sy=Math.sin(yaw); cy=Math.cos(yaw); sp=Math.sin(pitch); cp=Math.cos(pitch);
      ctx.save(); ctx.translate(width*.5,height*.80); ctx.scale(scale*2.52,scale*.39);
      const shadow=ctx.createRadialGradient(0,0,.02,0,0,1); shadow.addColorStop(0,"#0b100ccc"); shadow.addColorStop(1,"#0b100c00");
      ctx.fillStyle=shadow; ctx.fillRect(-1,-1,2,2); ctx.restore();
      material(shell); shellDetails();
      backKeys.forEach(part=>{material(part);shoulderLabel(part);});
      upperKeys.forEach(part=>{material(part);shoulderLabel(part);});
      faceParts.forEach(material); faceDetails();
      for(const [id,button] of buttons) {
        const [,x,y,z,rx,ry]=controls[id], p=project(x,y,z), a=project(x+rx,y,z), b=project(x,y+ry,z);
        button.style.left=p[0]+"px"; button.style.top=p[1]+"px";
        button.style.width=Math.max(14,Math.hypot(a[0]-p[0],a[1]-p[1])*2)+"px";
        button.style.height=Math.max(12,Math.hypot(b[0]-p[0],b[1]-p[1])*2)+"px";
        button.setAttribute("aria-pressed",String((directionMap[selected] || selected)===id));
      }
      for (const [view,button] of presets) {
        button.setAttribute("aria-pressed",String(Math.abs(view.yaw-yaw)<.005 && Math.abs(view.pitch-pitch)<.005));
      }
    }
    function redraw() { if(!raf && !destroyed) raf=requestAnimationFrame(draw); }
    function select(id) { selected=id || ""; redraw(); }
    for (const [id,[name]] of Object.entries(controls)) {
      const button=el("button","spot");
      button.type="button"; button.setAttribute("aria-label",name); button.title=name;
      button.addEventListener("click",event=>{
        if(moved && event.detail) return;
        select(id); onSelect?.(id);
      });
      const enter=()=>{if(!drag) {hover=id; redraw();}};
      const leave=()=>{if(hover===id){hover="";redraw();}};
      button.addEventListener("pointerenter",enter); button.addEventListener("pointerleave",leave);
      button.addEventListener("focus",enter); button.addEventListener("blur",leave);
      stage.append(button); buttons.set(id,button);
    }
    for(const [name,view] of [["Front",front],["Shoulders",shoulders]]) {
      const button=el("button","view"); button.type="button"; button.textContent=name;
      button.setAttribute("aria-label",name+" view");
      button.addEventListener("click",()=>{yaw=view.yaw; pitch=view.pitch; hover=""; redraw();});
      views.append(button); presets.set(view,button);
    }
    stage.addEventListener("pointerdown",event=>{
      if(!event.isPrimary || event.button!==0) return;
      moved=false; drag={id:event.pointerId,x:event.clientX,y:event.clientY,yaw,pitch};
    });
    stage.addEventListener("pointermove",event=>{
      if(!drag || drag.id!==event.pointerId) return;
      const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
      if(!moved && Math.hypot(dx,dy)<4) return;
      if(!moved) stage.setPointerCapture(event.pointerId);
      moved=true; hover="";
      yaw=clamp(drag.yaw+dx*.009,-1.03,1.03); pitch=clamp(drag.pitch+dy*.009,-.24,1.24);
      redraw();
    });
    const endDrag=event=>{if(drag?.id===event.pointerId) drag=undefined;};
    stage.addEventListener("pointerup",endDrag); stage.addEventListener("pointercancel",endDrag);
    stage.addEventListener("lostpointercapture",endDrag);
    stage.addEventListener("pointerleave",event=>{if(!moved)endDrag(event);});
    const observer=new ResizeObserver(redraw); observer.observe(stage); redraw();
    return {select,destroy(){destroyed=true; cancelAnimationFrame(raf); observer.disconnect(); host.remove();}};
  }

  window.RemotePadModel=Object.freeze({mount});
})();
