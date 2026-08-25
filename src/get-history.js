(async()=>{const W=window;const JWT=/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const WIN=90,SEAM=2,MAX=40,GAP=1200,DAY=864e5;
// How many empty 90-day stretches in a row before we accept the record has ended.
// Four = a year of silence, so a gap shorter than that is stepped over, not stopped at.
const DRY_LIMIT=4;
var box,body;
const ui=()=>{const o=document.getElementById("fd-hist");if(o)o.remove();box=document.createElement("div");box.id="fd-hist";
box.setAttribute("style",'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(560px,92vw);max-height:74vh;overflow:auto;background:#0d1114;color:#e9eef2;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;padding:16px 18px;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);white-space:pre-wrap;word-break:break-word;user-select:text');
const x=document.createElement("button");x.textContent="close";x.setAttribute("style","float:right;margin:-4px -6px 8px 12px;background:#25303a;color:#e9eef2;border:0;border-radius:5px;padding:4px 10px;font:inherit;cursor:pointer");x.onclick=()=>box.remove();
box.appendChild(x);body=document.createElement("span");box.appendChild(body);document.body.appendChild(box)};
const lines=[];const say=t=>{lines.push(t);body.textContent=lines.join("\n");box.scrollTop=box.scrollHeight};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const cut=(t)=>{if(t.charCodeAt(0)===0xfeff)t=t.slice(1);const rows=[];let row=[],f="",q=false;
 for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c;continue}
  if(c==='"')q=true;else if(c===",")  {row.push(f);f=""}
  else if(c==="\r"){}else if(c==="\n"){row.push(f);rows.push(row);row=[];f=""}else f+=c}
 if(f.length||row.length){row.push(f);rows.push(row)}return rows};
const esc=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
ui();
try{
 const look=s=>{try{for(let i=0;i<s.length;i++){const m=(s.getItem(s.key(i))||"").match(JWT);if(m)return m[0]}}catch(e){}return null};
 const token=look(localStorage)||look(sessionStorage)||(document.cookie.match(JWT)||[])[0]||null;
 if(!token){say("Couldn't find your Clarity login on this page.");say("");say("Make sure you are on clarity.dexcom.com and can see your own");say("data, then click the bookmark again.");return}
 let pay={};try{pay=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")))}catch(e){}
 const subj=pay.subjectId||pay.subject_id;
 const first=pay.given_name||pay.firstName||"";
 const last=pay.family_name||pay.lastName||"";
 if(!subj){say("Found your login, but not your subject number.");say("");say("Copy this line and ask for help:");say("  "+Object.keys(pay).join(", "));return}
 const txt=(document.body.innerText||"");
 const units=(/mmol\/L/i.test(txt)&&!/mg\/dL/i.test(txt))?"mmol":"mgdl";
 // Clarity's timestamps carry no timezone, so the file is only readable if it also
 // says which zone it was recorded in. The browser knows this for certain; nothing
 // downstream does. Named zone, not an offset, so daylight-saving rules travel too.
 let tz="";try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}
 const now=new Date();
 say("Collecting your Clarity history.");
 say("Units "+(units==="mmol"?"mmol/L":"mg/dL")+", times "+(tz||"unknown zone")+".");
 say("This takes a few seconds per step.");
 say("");
 let anchor=new Date(now.getTime()),header=null,seen=new Set(),keep=[],meta=[],windows=0,dry=0,reason="";
 for(windows=1;windows<=MAX;windows++){
  const start=new Date(anchor.getTime()-WIN*DAY);
  let end=new Date(anchor.getTime()+SEAM*DAY);if(end>now)end=now;
  const a=ymd(start),b=ymd(end);
  const form=new URLSearchParams({locale:"en-US",units:units,dateInterval:a+"/"+b,accessToken:token,submitExport:"Export",firstName:first,lastName:last});
  const r=await fetch("/api/subject/"+subj+"/export",{method:"POST",credentials:"include",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  if(!r.ok){say("  "+a+" to "+b+" - Clarity said no (HTTP "+r.status+")");reason=r.status===401||r.status===403?"your Clarity login timed out partway - log in again and re-click":"Clarity refused that request";break}
  const rows=cut(await r.text());
  if(!header&&rows.length)header=rows[0];
  let got=0,oldest=null;
  for(let i=1;i<rows.length;i++){const row=rows[i];if(!row||row.length<3)continue;
   const ts=(row[1]||"").trim(),type=(row[2]||"").trim();
   const key=JSON.stringify(row.slice(1));
   if(!ts){if(!seen.has(key)){seen.add(key);meta.push(row)}continue}
   if(seen.has(key))continue;seen.add(key);keep.push(row);
   if(type==="EGV"){got++;if(!oldest||ts<oldest)oldest=ts}}
  // Anything older to move to? If a stretch brings back nothing new, that is NOT proof
  // the record has ended - a spell without a sensor looks exactly the same. So step back
  // a whole stretch and keep looking, and only call it the end after DRY_LIMIT empty ones
  // in a row. At 90 days each that is a full year of silence before we give up, which
  // steps straight over any realistic gap.
  const od=oldest?new Date(oldest):null;
  if(got>0&&od&&od<anchor){
   dry=0;anchor=od;
   say("  "+a+" to "+b+"   "+String(got).padStart(5)+" new readings");
  }else{
   dry++;anchor=start;
   say("  "+a+" to "+b+"       nothing here"+(dry<DRY_LIMIT?", looking further back":""));
   if(dry>=DRY_LIMIT){reason="that is as far back as your record goes";break}
  }
  await sleep(GAP)}
 if(!reason)reason="stopped at the "+MAX+"-step safety limit - click the bookmark again to keep going";
 const stamped=keep.filter(r=>(r[1]||"").trim()).sort((x,y)=>(x[1]<y[1]?-1:x[1]>y[1]?1:0));
 say("");
 if(!stamped.length){say("Nothing came back. This walk starts at today, so a record whose");say("newest reading is over "+WIN+" days old looks the same as an empty one.");return}
 const out=[header.map(esc).join(",")];let n=0;
 // Rides along as one more untimed metadata row, the same shape Clarity already uses
 // for FirstName / Device. Importers that don't know about it skip it as they always
 // have; the one that does reads the zone off it and converts correctly anywhere.
 const tzRow=new Array(header.length).fill("");tzRow[2]="Timezone";tzRow[3]=tz;
 [tzRow].concat(meta,stamped).forEach(row=>{const c=row.slice();c[0]=String(++n);out.push(c.map(esc).join(","))});
 const blob=new Blob([out.join("\r\n")+"\r\n"],{type:"text/csv"});
 const url=URL.createObjectURL(blob);const a=document.createElement("a");
 const fname="clarity-history-"+ymd(now)+(tz?"-"+tz.replace(/\//g,"-"):"")+".csv";
 a.href=url;a.download=fname;document.body.appendChild(a);a.click();
 setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},4000);
 const days=Math.round((new Date(stamped[stamped.length-1][1])-new Date(stamped[0][1]))/DAY);
 say("Done - "+reason+".");
 say("");
 say("  "+stamped.length+" rows, covering "+days+" days");
 say("  "+stamped[0][1].slice(0,10)+"  to  "+stamped[stamped.length-1][1].slice(0,10));
 say("");
 say("Saved to your Downloads folder as");
 say("  "+fname);
 if(!tz){say("");say("Your browser wouldn't tell me your timezone, so the file doesn't");say("record which one these times are on. They are your own local times.")}
}catch(e){say("");say("Something went wrong: "+(e&&e.message?e.message:e));say("");say("Copy that line and ask for help.")}
})()
