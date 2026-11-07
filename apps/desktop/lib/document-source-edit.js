'use strict';
// Explicit raw-source edits only. No rich projection, serialization or file authority.
const {MAX_SOURCE_UNITS: LIMIT}=require('./document-capacity');
const valid=s=>typeof s==='string'&&s.length<=LIMIT&&!s.includes('\0')&&s.isWellFormed();
const splits=(s,n)=>n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]);
function sourceChange(source,change) {
 const {from,to,insert}=change||{};
 if(!valid(source)||!valid(insert)||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>source.length
     ||splits(source,from)||splits(source,to)||source.length-(to-from)+insert.length>LIMIT) return {ok:false,code:'invalid-source-edit'};
 return {ok:true,source:source.slice(0,from)+insert+source.slice(to),change:{from,to,insert},
  inverse:{from,to:from+insert.length,insert:source.slice(from,to)}};
}
function sourceDifference(before,after) {
 if(!valid(before)||!valid(after))return {ok:false,code:'invalid-source-edit'};
 let from=0,to=before.length,end=after.length;
 while(from<to&&from<end&&before[from]===after[from])from++;
 while(to>from&&end>from&&before[to-1]===after[end-1]){to--;end--;}
 if(splits(before,from)||splits(after,from))from--;
 if(splits(before,to)||splits(after,end)){to++;end++;}
 return sourceChange(before,{from,to,insert:after.slice(from,end)});
}
module.exports={sourceChange,sourceDifference};
