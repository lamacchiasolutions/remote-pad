(() => {
  "use strict";
  if (window.RemotePadMapper) return;
  const groups = [
    ["Face buttons", [["a","A button"],["b","B button"],["x","X button"],["y","Y button"]]],
    ["Shoulders", [["lb","Left bumper (LB)"],["rb","Right bumper (RB)"],["lt","Left trigger (LT)"],["rt","Right trigger (RT)"]]],
    ["Left stick", [["ls","Left stick click"],["lyUp","Left stick up"],["lyDown","Left stick down"],["lxLeft","Left stick left"],["lxRight","Left stick right"]]],
    ["Right stick", [["rs","Right stick click"],["ryUp","Right stick up"],["ryDown","Right stick down"],["rxLeft","Right stick left"],["rxRight","Right stick right"]]],
    ["D-pad", [["up","D-pad up"],["down","D-pad down"],["left","D-pad left"],["right","D-pad right"]]],
    ["Center", [["view","View"],["menu","Menu"],["guide","Xbox Guide"]]]
  ];
  const titles = Object.fromEntries(groups.flatMap(([,entries]) => entries));
  const names = {
    Mouse0:"Left click",Mouse1:"Middle click",Mouse2:"Right click",Mouse3:"Mouse back",Mouse4:"Mouse forward",
    MouseMoveUp:"Mouse up",MouseMoveDown:"Mouse down",MouseMoveLeft:"Mouse left",MouseMoveRight:"Mouse right",
    ShiftLeft:"Left Shift",ShiftRight:"Right Shift",AltLeft:"Left Option",AltRight:"Right Option",
    ControlLeft:"Left Control",ControlRight:"Right Control",Space:"Space",Backquote:"`",Minus:"−",Equal:"=",
    BracketLeft:"[",BracketRight:"]",Backslash:"\\",Semicolon:";",Quote:"'",Comma:",",Period:".",Slash:"/",
    ArrowUp:"↑",ArrowDown:"↓",ArrowLeft:"←",ArrowRight:"→"
  };
  const pretty = code => names[code] || code.replace(/^Key([A-Z])$/,"$1").replace(/^Digit(\d)$/,"$1")
    .replace(/^Numpad/,"Keypad ").replace(/([a-z])([A-Z])/g,"$1 $2");
  const style = `
    :host {all:initial;display:block;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#eef2e8;color-scheme:dark}
    *,*::before,*::after {box-sizing:border-box} [hidden]{display:none!important} h2,h3,p{margin:0}
    .grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(252px,1fr);gap:14px;align-items:stretch}
    .surface,.inspector{background:#1c2520;border:1px solid #3a483e;border-radius:14px;min-width:0}
    .surface{display:flex;flex-direction:column;overflow:hidden}.top{display:flex;justify-content:space-between;align-items:center;padding:16px 18px 0}
    h2{font-size:19px;letter-spacing:-.035em;font-weight:640} .visual{display:block;width:100%;height:clamp(270px,34vw,368px);flex:1;min-height:270px}
    .inspector{padding:18px;display:flex;flex-direction:column;align-items:stretch}
    .field,.caption{display:block;color:#b6c8b4;font:600 10px/1.5 ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.09em}
    select,button{font:inherit;color:inherit} select{margin:7px 0 15px;padding:8px 9px;width:100%;border:1px solid #667966;border-radius:7px;background:#2b392f;font-weight:560;font-size:14px}
    button{background:#2b3930;border:1px solid #526552;padding:7px 10px;border-radius:7px;cursor:pointer;font:550 12px/18px -apple-system,BlinkMacSystemFont,Arial,sans-serif}
    button:disabled{opacity:.55;cursor:wait}button:hover{background:#35483a}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #c2ef8e;outline-offset:3px}
    .primary{background:#c2ef8e;color:#172415;border-color:#c2ef8e}.primary:hover{background:#d4ffa6}
    .row,.chips,.segments{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .segments{margin:-4px 0 16px}.segments button{min-width:32px;padding:4px 8px}.segments .selected{color:#d6efbf;background:#364b38;border-color:#96ad84}
    .chips{margin:7px 0 13px}.chip{display:inline-flex;align-items:center;gap:8px;border:1px solid #647961;border-radius:6px;background:#2d3c30;padding:2px 4px 2px 9px;min-height:30px;font:600 12px/18px ui-monospace,Menlo,monospace}
    .chip button{background:transparent;border:0;color:#bbceba;padding:2px 6px;font-size:14px}
    .empty,.hint,.status{color:#b4c2b3;font-size:12px;line-height:1.5}
    .status{min-height:18px;margin-top:12px;color:#cee7bc}
    .capture,.confirm{margin-top:12px;border:1px solid #7b946e;background:#26372a;padding:12px;border-radius:8px}
    .capture p,.confirm p{margin:0 0 8px}.capture .hint{margin-top:8px}.capture:focus{outline:2px solid #c2ef8e;outline-offset:2px}
    .gesture{margin-top:13px}.gesture summary{cursor:pointer;font-size:12px;color:#c1d6b7}.gesture .row{margin:8px 0}.gesture button{padding:4px 8px}
    .footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px}.footer button{background:transparent;color:#c8d7c4;border-color:#46574a}
    .confirm .row{margin-top:8px}.restore{margin-top:12px}
    @media(max-width:760px){.grid{grid-template-columns:minmax(0,1.13fr) minmax(230px,1fr);gap:10px}.inspector{padding:14px}.visual{min-height:240px}}
    @media(max-width:580px){.grid{grid-template-columns:1fr}.visual{min-height:210px;height:215px}.footer{align-items:start}}
  `;

  function mount(container, { initial = "a" } = {}) {
    const element = (tag, text, cls) => {
      const el = document.createElement(tag);
      if (text !== undefined && text !== null) el.textContent = text;
      if (cls) el.className = cls;
      return el;
    };
    const button = (text, fn, cls) => {
      const el = element("button",text,cls); el.type = "button"; el.addEventListener("click",fn); return el;
    };
    const host = element("div");
    container.append(host);
    const shadow = host.attachShadow({mode:"open"});
    try { const css = new CSSStyleSheet(); css.replaceSync(style); shadow.adoptedStyleSheets = [css]; }
    catch { shadow.append(element("style",style)); }
    const grid = element("div",null,"grid");
    const surface = element("section",null,"surface");
    const top = element("div",null,"top"); top.append(element("h2","Controller"));
    const visual = element("div",null,"visual");
    surface.append(top,visual);
    const pane = element("section",null,"inspector");
    const selectLabel = element("label","Selected control","field");
    const select = element("select"); select.id="pad-target"; selectLabel.htmlFor=select.id;
    for (const [name,entries] of groups) {
      const group = element("optgroup"); group.label=name;
      for (const [id,title] of entries) { const option = element("option",title); option.value=id; group.append(option); }
      select.append(group);
    }
    const segments = element("div",null,"segments");
    const cap = element("span","Assigned inputs","caption");
    const chips = element("div",null,"chips");
    const actions = element("div",null,"row");
    const edit = button("Replace input",() => listen(false),"primary");
    const add = button("Add another",() => listen(true));
    actions.append(edit,add);
    const gesture = element("details",null,"gesture");
    const gestureSummary=element("summary","Assign mouse movement");
    const gestureRow=element("div",null,"row");
    gesture.append(gestureSummary,gestureRow);
    for (const dir of ["Up","Down","Left","Right"]) {
      gestureRow.append(button("Mouse "+dir.toLowerCase(),() => propose("MouseMove"+dir, listening?.append ?? false)));
    }
    const record = element("div",null,"capture"); record.tabIndex=0; record.hidden=true;
    const instructions=element("p","Press a key, or click inside this box with the mouse button you want.");
    record.append(instructions, element("div","Esc cancels. Command shortcuts stay with macOS.","hint"));
    record.setAttribute("aria-label","Waiting for a key or mouse button");
    const cancelRecord=button("Cancel",() => cancel()); cancelRecord.hidden=true;
    const confirm=element("div",null,"confirm");confirm.hidden=true;
    const message=element("p",null,"status");message.setAttribute("role","status");message.setAttribute("aria-live","polite");
    pane.append(selectLabel, select, segments, cap, chips, actions, gesture, record, cancelRecord, confirm, message);
    grid.append(surface,pane);
    const footer = element("div",null,"footer");
    const hint=element("p","Select a part on the model or choose it from the list.","hint");
    const revert=button("Restore defaults",restorePrompt);footer.append(hint,revert);
    const restore=element("div",null,"confirm restore");restore.hidden=true;
    shadow.append(grid,footer,restore);

    const api=window.RemotePadController;
    const store=window.RemotePadBindings;
    let selected=Object.hasOwn(titles,initial)?initial:"a";
    let listening=null;
    let ready=false;
    let busy=false;
    let destroyed=false;
    const model=window.RemotePadModel.mount(visual,{onSelect:choose});
    function cancel() {
      listening=null; record.hidden=cancelRecord.hidden=confirm.hidden=restore.hidden=true;
      actions.hidden=false;gesture.hidden=false;
    }
    function choose(id) {
      if (!Object.hasOwn(titles,id)) return;
      selected=id; cancel(); message.textContent=""; gesture.open=false; render();
    }
    function render() {
      const layout=api.getBindings();
      const codes=layout[selected];
      select.value=selected;
      model.select(selected);
      segments.replaceChildren();
      const stick=groups.find(([name,entries])=>name.endsWith("stick") && entries.some(([id])=>id===selected));
      segments.hidden=!stick;
      if(stick) {
        const captions=["Click","↑","↓","←","→"];
        stick[1].forEach(([id,title],index)=>{
          const b=button(captions[index],()=>choose(id),id===selected?"selected":undefined);
          b.setAttribute("aria-label",title); b.setAttribute("aria-pressed",String(id===selected)); segments.append(b);
        });
      }
      chips.replaceChildren();
      if(!codes.length) chips.append(element("span","Unassigned","empty"));
      for(const code of codes){
        const chip=element("span",pretty(code),"chip");
        const remove=button("×",async()=>{
          if(busy) return;
          const layout=api.getBindings();layout[selected]=layout[selected].filter(c=>c!==code);
          await persist(layout, "Removed "+pretty(code)+".");
        });
        remove.setAttribute("aria-label","Remove "+pretty(code)); remove.disabled=!ready||busy;
        chip.append(remove); chips.append(chip);
      }
      edit.textContent=codes.length>1?"Replace inputs":codes.length?"Replace input":"Assign input";
      add.hidden=!codes.length;
      for(const item of [edit,add,revert,select,...gestureRow.children]) item.disabled=!ready||busy;
    }
    async function persist(layout, success) {
      if(busy || !ready) return;
      cancel();busy=true;render();
      try { await store.save(layout); if(!destroyed) message.textContent=success; }
      catch(error){if(!destroyed) message.textContent=error.message || "Could not save this layout.";}
      finally {busy=false;if(!destroyed)render();}
    }
    function listen(append) {
      if(!ready||busy) return;
      cancel(); listening={append}; actions.hidden=true;
      record.hidden=cancelRecord.hidden=false;message.textContent="";record.focus();
    }
    function propose(code, append) {
      if(!ready||busy) return;
      const target=selected;
      cancel();gesture.open=false;
      const layout=api.getBindings();
      const others=Object.keys(layout).filter(id=>id!==target && layout[id].includes(code));
      function apply(move) {
        // Fetch the latest profile again if another player tab saved while this prompt was open.
        const next=api.getBindings();
        if(move) for(const id of Object.keys(next)) if(id!==target) next[id]=next[id].filter(value=>value!==code);
        next[target]=append ? [...new Set([...next[target],code])] : [code];
        return persist(next,"Saved "+pretty(code)+" to "+titles[target]+".");
      }
      if(!others.length) { apply(false); return; }
      confirm.replaceChildren(element("p",pretty(code)+" also controls "+others.map(id=>titles[id]).join(", ")+"."));
      const choices=element("div",null,"row");
      choices.append(button("Move here",()=>apply(true),"primary"),button("Use for both",()=>apply(false)),button("Cancel",cancel));
      confirm.append(choices);confirm.hidden=false;
    }
    function restorePrompt() {
      cancel();restore.replaceChildren(element("p","Replace your entire layout with the default controls?"));
      const row=element("div",null,"row");
      row.append(button("Restore defaults",()=>persist(api.getDefaultBindings(),"Default layout restored."),"primary"),button("Keep my layout", cancel));
      restore.append(row);restore.hidden=false;row.lastElementChild.focus();
    }
    function key(event) {
      if(listening===null) return;
      if(event.metaKey || event.code.startsWith("Meta")) {message.textContent="Choose a key outside a Command shortcut.";return;}
      event.preventDefault();event.stopImmediatePropagation();
      if(event.repeat||event.isComposing) return;
      if(event.code==="Escape"){cancel();edit.focus();return;}
      if(!event.code || event.code==="Unidentified"){message.textContent="macOS did not identify that key. Try another.";return;}
      propose(event.code,listening.append);
    }
    record.addEventListener("pointerdown",e=>{
      if(listening===null||e.pointerType!=="mouse"||e.button<0||e.button>4)return;
      e.preventDefault();e.stopPropagation();propose("Mouse"+e.button,listening.append);
    });
    for (const type of ["contextmenu","auxclick"]) shadow.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();});
    window.addEventListener("keydown",key,true);
    select.addEventListener("change",()=>choose(select.value));
    function leave() { if(listening!==null) cancel(); }
    window.addEventListener("blur",leave);
    window.addEventListener("remotepadbindingschange",render);
    function initialize() {
      store.load().then(()=>{
        if(destroyed)return;
        ready=true;message.textContent="";render();
      }).catch(error=>{
        if(destroyed)return;
        message.textContent=error.message+" ";
        message.append(button("Retry", initialize));
      });
    }
    render();initialize();
    return { destroy() { destroyed=true;window.removeEventListener("keydown",key,true);window.removeEventListener("blur",leave);
      window.removeEventListener("remotepadbindingschange",render);model.destroy();host.remove(); } };
  }
  window.RemotePadMapper=Object.freeze({ mount, pretty });
})();
