"use strict";
if (window.RemotePadController.ps5) document.querySelector(".test-link").href = "bench.html?console=ps5";
const editor = window.RemotePadMapper.mount(document.getElementById("mapper"), {initial:location.hash.slice(1)});
window.addEventListener("pagehide", event => { if (!event.persisted) editor.destroy(); }, {once:true});
