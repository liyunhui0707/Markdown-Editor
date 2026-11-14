'use strict';
const zlib=require('node:zlib');
function syntheticPNG(seed=0, large=false) {
  const width=large?768:48,height=large?512:24;
  const crc = bytes => { let c=0xffffffff; for (const v of bytes) { c^=v; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; };
  const chunk = (type,data) => { const body=Buffer.concat([Buffer.from(type),data]), b=Buffer.alloc(data.length+12); b.writeUInt32BE(data.length); body.copy(b,4); b.writeUInt32BE(crc(body),b.length-4); return b; };
  const header=Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  const pixels=Buffer.alloc(height*(width*3+1));let state=seed+1; for(let y=0;y<height;y++) for(let x=0;x<width*3;x++) {state=(Math.imul(state,1664525)+1013904223)>>>0;pixels[y*(width*3+1)+1+x]=state>>>24;}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

module.exports={syntheticPNG};
