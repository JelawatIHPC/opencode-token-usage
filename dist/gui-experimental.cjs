"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const t=require("solid-js/web"),h=require("solid-js"),L=require("@opencode/plugin/gui"),de=["monthly","weekly","daily","collapsed","yearly"],ge=new Intl.NumberFormat("en-US");function P(e){return ge.format(Math.max(0,Math.round(e)))}function D(e){return`$${Math.max(0,e).toFixed(2)}`}const B=[[1e9,"B"],[1e6,"M"],[1e3,"K"]];function Y(e){return e.includes(".")?e.replace(/\.?0+$/,""):e}function R(e){const n=Math.max(0,e);if(!Number.isFinite(n)||n===0)return"0";if(n<1)return n.toFixed(2);if(n<=1e3)return Y(n.toPrecision(4));for(let o=0;o<B.length;o++){const[a,i]=B[o];if(n<a)continue;const u=Y((n/a).toPrecision(4));if(o>0&&Number(u)>=1e3){const[p,f]=B[o-1];return`${Y((n/p).toPrecision(4))} ${f}`}return`${u} ${i}`}return`${Y((n/1e9).toPrecision(4))} B`}function H(e){return e.toString().padStart(2,"0")}function Z(e){return`${e.getFullYear()}-${H(e.getMonth()+1)}-${H(e.getDate())}`}function w(e,n=new Date){if(e==="daily"){const a=new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime();return{label:Z(n),start:a}}if(e==="weekly"){const a=new Date(n.getFullYear(),n.getMonth(),n.getDate());return a.setDate(a.getDate()-(n.getDay()+6)%7),{label:Z(a),start:a.getTime()}}if(e==="yearly"){const a=new Date(n.getFullYear(),0,1).getTime();return{label:`${n.getFullYear()}`,start:a}}const o=new Date(n.getFullYear(),n.getMonth(),1).getTime();return{label:`${n.getFullYear()}-${H(n.getMonth()+1)}`,start:o}}function M(e,n){return e==="monthly"?`Monthly tokens ${n}`:e==="weekly"?`Weekly tokens ${n}`:e==="daily"?`Daily tokens ${n}`:`Yearly tokens ${n}`}function fe(e){const n=e.indexOf("/");return n<0?"":e.slice(0,n)}function he(e,n){const o=n[0],a=o===void 0?"":n.length>1?`${o.id} +${n.length-1}`:o.id;return[fe(e),a].filter(i=>i!=="")}function V(e){return(e.split("/").pop()??e).split("-").map(o=>o.length>0?o[0].toUpperCase()+o.slice(1):o).join(" ")}function ye(e){let n=5381;for(let o=0;o<e.length;o++)n=(n<<5)+n+e.charCodeAt(o)>>>0;return n}function G(e){return Math.max(0,Math.min(255,Math.round(e))).toString(16).padStart(2,"0")}const be=.58,X=.45;function j(e,n=be){const o=ye("1048"+e)%360,i=(1-Math.abs(2*n-1))*.45,u=i*(1-Math.abs(o/60%2-1)),p=n-i/2;let f=0,d=0,v=0;return o<60?(f=i,d=u):o<120?(f=u,d=i):o<180?(d=i,v=u):o<240?(d=u,v=i):o<300?(f=u,v=i):(f=i,v=u),`#${G((f+p)*255)}${G((d+p)*255)}${G((v+p)*255)}`}function xe(e){const n=e.input+e.output+e.cached;return[{value:P(n),label:"total"},{value:P(e.input),label:"input"},{value:P(e.output),label:"output"},{value:P(e.cached),label:"cached"},{value:D(e.cost),label:"spent"}]}function ve(e){return de.includes(e)?e:"monthly"}var $e=t.template("<div class=mt-status data-component=monthly-tokens-status><div class=mt-status-right><span class=mt-status-period> · "),_e=t.template("<span class=mt-status-note>"),Q=t.template("<span class=mt-status-sep>"),ke=t.template("<span class=mt-status-total> tokens · "),Ce=t.template("<span class=mt-status-model><span class=mt-status-dot></span><span class=mt-status-name></span><span class=mt-status-num> tokens · "),Se=t.template("<div class=mt-panel><div class=mt-top><span class=mt-title></span></div><div class=mt-range><span class=mt-range-label>Period"),we=t.template("<div class=mt-error>Usage unavailable: "),Me=t.template("<span>Loading usage…"),De=t.template("<div class=mt-loading>"),Ee=t.template("<span class=mt-note>No usage data yet."),Ie=t.template("<div class=mt-metrics>"),Te=t.template("<div class=mt-section><div class=mt-section-title>Top models</div><div class=mt-models>"),Ae=t.template("<div class=mt-metric><span class=mt-value></span><span class=mt-label>"),Le=t.template("<div class=mt-model><div class=mt-model-name></div><div class=mt-model-row><div class=mt-tags></div><div class=mt-nums><span class=mt-num> tokens</span><span class=mt-num>"),Re=t.template("<span class=mt-tag>");const ze=7,Fe=6e4,Ne="monthly",Oe="usage",ee="usage",se="monthly-tokens.range",te="monthly-tokens.cache",oe={monthly:"Monthly",weekly:"Weekly",daily:"Daily",yearly:"Yearly"},Pe=["monthly","weekly","daily","yearly"].map(e=>({value:e,label:oe[e]}));function Ye(){try{const e=ve(localStorage.getItem(se));return e==="collapsed"?"monthly":e}catch{return"monthly"}}function je(e){try{localStorage.setItem(se,e)}catch{}}function ne(e){return e.input+e.output+e.cached}function Ue(e,n){const o=new Map;for(const a of e.models){const i=a.tokens.input+a.tokens.output+a.tokens.reasoning+a.tokens.cache.read+a.tokens.cache.write,u=a.model.id;let p=o.get(u);p||(p={tokens:0,cost:0,providers:new Map},o.set(u,p)),p.tokens+=i,p.cost+=a.cost;const f=a.model.providerID;f!==""&&p.providers.set(f,(p.providers.get(f)??0)+i)}return{label:n,totals:{input:e.tokens.input,output:e.tokens.output+e.tokens.reasoning,cached:e.tokens.cache.read+e.tokens.cache.write,cost:e.cost},models:[...o.entries()].map(([a,i])=>({modelID:a,tokens:i.tokens,cost:i.cost,providers:[...i.providers.entries()].map(([u,p])=>({id:u,tokens:p})).sort((u,p)=>p.tokens-u.tokens)})).sort((a,i)=>i.tokens-a.tokens).slice(0,ze)}}const Be=`
.mt-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow-y: auto;
  padding: 12px 14px 18px;
  color: inherit;
  font-size: 12px;
  line-height: 1.4;
}
.mt-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mt-title {
  font-size: 13px;
  font-weight: 600;
}
.mt-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}
.mt-metric {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.mt-value {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.mt-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.55;
  text-transform: uppercase;
}
.mt-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mt-section-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
}
.mt-models {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mt-model {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
.mt-model:first-child {
  padding-top: 0;
  border-top: none;
}
.mt-model-name {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mt-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.mt-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.mt-tag {
  max-width: 100%;
  overflow: hidden;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 10px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mt-nums {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.mt-num {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.mt-note {
  font-size: 11px;
  opacity: 0.6;
}
.mt-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.7;
}
.mt-error {
  font-size: 11px;
  color: #d9534f;
  overflow-wrap: anywhere;
}
.mt-range {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mt-range-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.55;
  text-transform: uppercase;
}
.mt-select {
  min-width: 124px;
}
.mt-status {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.22);
  background: rgba(128, 128, 128, 0.06);
  color: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  overflow: hidden;
}
.mt-status-period {
  flex: none;
  font-weight: 600;
  opacity: 0.7;
}
.mt-status-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.mt-status-total {
  flex: none;
  opacity: 0.85;
}
.mt-status-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: currentColor;
  opacity: 0.18;
}
.mt-status-model {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mt-status-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
}
.mt-status-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
}
.mt-status-num {
  flex: none;
}
.mt-status-note {
  flex: none;
  opacity: 0.55;
}
`,Ge=L.Plugin.define({setup(e){const n=new Set(["monthly","yearly"]),o=8,a=new Map,i=s=>`${s}|${w(s).label}`,u=s=>{const l=s;return typeof l=="object"&&l!==null&&typeof l.label=="string"&&typeof l.totals=="object"&&Array.isArray(l.models)};try{const s=localStorage.getItem(te);if(s!==null){const l=JSON.parse(s);for(const[y,m]of Object.entries(l))typeof m?.at=="number"&&u(m.snapshot)&&a.set(y,{snapshot:m.snapshot,at:m.at})}}catch{}const p=()=>{try{const s=[...a.entries()].sort((l,y)=>y[1].at-l[1].at).slice(0,o);localStorage.setItem(te,JSON.stringify(Object.fromEntries(s)))}catch{}},f=s=>{if(n.has(s))return a.get(i(s))?.snapshot},[d,v]=h.createSignal(Ye()),[$,K]=h.createSignal(f(d())),[E,q]=h.createSignal(!1),[I,J]=h.createSignal();let z=0;const T=async()=>{const s=++z,l=d(),{label:y,start:m}=w(l);q(!0),J(void 0);try{const c=await e.client.experimental.session.stats({from:m,to:Date.now(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,tools:"none"});if(e.signal.aborted||s!==z)return;const g=Ue(c,y);K(g),n.has(l)&&(a.set(i(l),{snapshot:g,at:Date.now()}),p())}catch(c){if(e.signal.aborted||s!==z)return;J(c instanceof Error?c.message:String(c))}finally{!e.signal.aborted&&s===z&&q(!1)}},ae=s=>{s!==d()&&(v(s),je(s),K(f(s)),T())};T();const le=setInterval(()=>{T()},Fe);h.onCleanup(()=>clearInterval(le));const re=()=>{const s=e.sessions.current();if(s){e.layout.open(`${e.id}:${ee}`,s);return}e.dialogs.open(l=>t.createComponent(e.ui.Dialog,{get title(){return M(d(),$()?.label??w(d()).label)},description:"Usage across every session on this server.",size:"large",get footer(){return[t.createComponent(e.ui.Button,{variant:"ghost",icon:"refresh",get busy(){return E()},onClick:()=>{T()},children:"Refresh"}),t.createComponent(e.ui.Button,{variant:"contrast",get onClick(){return l.close},children:"Close"})]},get children(){return t.createComponent(W,{})}}))},ie={id:Oe,title:"Token usage"};e.add(L.Panel,{id:"usage",region:"side",width:360,list:s=>s.open.includes(ee)?[ie]:[],render:()=>t.createComponent(W,{})}),e.add(L.TitlebarItem,()=>{const s=$(),l=I(),y=d(),m=s?.label??w(y).label,c=l!==void 0&&s===void 0;return{id:Ne,label:s?`Tokens ${R(ne(s.totals))} · ${D(s.totals.cost)}`:c?"Tokens unavailable":"Tokens",title:s?M(y,s.label):c?`Token usage unavailable: ${l}`:`Loading ${M(y,m)}`,icon:c?"circle-exclamation":"status",busy:E()&&s===void 0,run:re}}),e.add(L.Slot,{at:"window.bottom",order:0,render:()=>t.createComponent(ce,{})}),e.add(L.Style,Be);function ce(){const s=()=>d(),l=()=>$()?.label??w(s()).label,y=()=>{const m=$();return m?M(s(),m.label):I()?`Token usage unavailable: ${I()}`:`Loading ${M(s(),l())}`};return(()=>{var m=$e(),c=m.firstChild,g=c.firstChild,k=g.firstChild;return t.insert(g,()=>oe[s()],k),t.insert(g,l,null),t.insert(c,t.createComponent(h.Show,{get when(){return $()},keyed:!0,get fallback(){return(()=>{var b=_e();return t.insert(b,(()=>{var r=t.memo(()=>!!I());return()=>r()?"Usage unavailable":E()?"Loading usage…":"No usage data yet."})()),b})()},children:b=>[Q(),(()=>{var r=ke(),x=r.firstChild;return t.insert(r,()=>R(ne(b.totals)),x),t.insert(r,()=>D(b.totals.cost),null),r})(),t.createComponent(h.Show,{get when(){return b.models[0]},keyed:!0,children:r=>{const x=V(r.modelID),F=j(r.modelID),N=j(r.modelID,X);return[Q(),(()=>{var _=Ce(),O=_.firstChild,C=O.nextSibling,S=C.nextSibling,A=S.firstChild;return t.setStyleProperty(O,"background",F),t.setStyleProperty(C,"color",F),t.insert(C,x),t.setStyleProperty(S,"color",N),t.insert(S,()=>R(r.tokens),A),t.insert(S,()=>D(r.cost),null),t.effect(()=>t.setAttribute(_,"title",`${x}: ${R(r.tokens)} tokens · ${D(r.cost)}`)),_})()]}})]}),null),t.effect(()=>t.setAttribute(m,"title",y())),m})()}function W(){return(()=>{var s=Se(),l=s.firstChild,y=l.firstChild,m=l.nextSibling;return m.firstChild,t.insert(y,()=>M(d(),$()?.label??w(d()).label)),t.insert(l,t.createComponent(e.ui.IconButton,{icon:"refresh",label:"Refresh token usage",size:"small",get busy(){return E()},onClick:()=>{T()}}),null),t.insert(m,t.createComponent(e.ui.Select,{class:"mt-select",label:"Usage period",options:Pe,get value(){return d()},onChange:ae}),null),t.insert(s,t.createComponent(h.Show,{get when(){return I()},children:c=>(()=>{var g=we();return g.firstChild,t.insert(g,c,null),g})()}),null),t.insert(s,t.createComponent(h.Show,{get when(){return $()},get fallback(){return(()=>{var c=De();return t.insert(c,t.createComponent(h.Show,{get when(){return E()},get fallback(){return Ee()},get children(){return[t.createComponent(e.ui.Loader,{size:"small"}),Me()]}})),c})()},children:c=>[(()=>{var g=Ie();return t.insert(g,t.createComponent(h.For,{get each(){return xe(c().totals)},children:k=>(()=>{var b=Ae(),r=b.firstChild,x=r.nextSibling;return t.insert(r,()=>k.value),t.insert(x,()=>k.label),b})()})),g})(),t.createComponent(h.Show,{get when(){return c().models.length>0},get children(){var g=Te(),k=g.firstChild,b=k.nextSibling;return t.insert(b,t.createComponent(h.For,{get each(){return c().models},children:r=>{const x=j(r.modelID),F=j(r.modelID,X);return(()=>{var N=Le(),_=N.firstChild,O=_.nextSibling,C=O.firstChild,S=C.nextSibling,A=S.firstChild,pe=A.firstChild,ue=A.nextSibling;return t.setStyleProperty(_,"color",x),t.insert(_,()=>V(r.modelID)),t.insert(C,t.createComponent(h.For,{get each(){return he(r.modelID,r.providers)},children:me=>(()=>{var U=Re();return t.setStyleProperty(U,"color",F),t.insert(U,me),U})()})),t.insert(A,()=>R(r.tokens),pe),t.insert(ue,()=>D(r.cost)),N})()}})),g}})]}),null),s})()}}});exports.default=Ge;
