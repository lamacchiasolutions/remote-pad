"use strict";
const editor = window.RemotePadMapper.mount(document.getElementById("mapper"), {initial:location.hash.slice(1)});
window.addEventListener("pagehide", event => { if (!event.persisted) editor.destroy(); }, {once:true});
