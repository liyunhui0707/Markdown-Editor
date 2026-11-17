'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
// Simulate different opaque provenance per inode through the public xattr read
// boundary. Never fabricate/remove provenance on a user's file or add app hooks.
if(process.platform==='darwin'&&process.env.DOCUMENT_NATIVE_SAVE_TEST_BINARY)test('native replacement accepts distinct per-inode provenance but pins each object and all other metadata',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-provenance-save-'))),source=path.join(root,'driver.m'),binary=path.join(root,'driver');
 fs.writeFileSync(source,`#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <unistd.h>
#include <errno.h>
static ino_t originalInode;static const char *marker;static BOOL mutateOriginal;
static ssize_t fixtureList(int fd,char *buffer,size_t capacity,int options){
 struct stat st;if(fstat(fd,&st)||!S_ISREG(st.st_mode))return flistxattr(fd,buffer,capacity,options);
 ssize_t n=flistxattr(fd,NULL,0,options);if(n<0||n>65536)return -1;NSMutableData *names=[NSMutableData dataWithLength:n];if(flistxattr(fd,names.mutableBytes,n,options)!=n)return -1;
 BOOL found=NO;const char *p=names.bytes;for(ssize_t i=0;i<n;i+=strlen(p+i)+1)if(!strcmp(p+i,"com.apple.provenance"))found=YES;
 if(!found)[names appendBytes:"com.apple.provenance" length:sizeof("com.apple.provenance")];if(!buffer)return names.length;if(capacity<names.length){errno=ERANGE;return -1;}memcpy(buffer,names.bytes,names.length);return names.length;
}
static ssize_t fixtureGet(int fd,const char *name,void *buffer,size_t capacity,u_int32_t position,int options){
 if(strcmp(name,"com.apple.provenance"))return fgetxattr(fd,name,buffer,capacity,position,options);
 struct stat st;if(fstat(fd,&st)||!S_ISREG(st.st_mode))return fgetxattr(fd,name,buffer,capacity,position,options);
 if(!buffer)return 11;if(capacity<11){errno=ERANGE;return -1;}BOOL changed=access(marker,F_OK)==0;memset(buffer,st.st_ino==originalInode?(changed&&mutateOriginal?0x44:0x11):(changed&&!mutateOriginal?0x33:0x22),11);return 11;
}
#define flistxattr fixtureList
#define fgetxattr fixtureGet
#define main nativeMain
#import ${JSON.stringify(path.resolve(__dirname,'../native/document-save.m'))}
#undef main
int main(int argc,const char **argv){if(argc!=4)return 64;struct stat st;if(stat(argv[1],&st))return 65;originalInode=st.st_ino;marker=argv[2];mutateOriginal=!strcmp(argv[3],"post-exchange-original-provenance");return nativeMain(1,argv);}
`,{flag:'wx',mode:0o600});
 const built=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-DDOCUMENT_SAVE_TESTING','-framework','Foundation','-o',binary,source],{encoding:'utf8',timeout:30000});assert.equal(built.status,0,built.stderr);
 const metadata=p=>{const s=fs.statSync(p,{bigint:true});return {dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),mode:Number(s.mode&0o7777n),uid:Number(s.uid),gid:Number(s.gid)};},hash=b=>createHash('sha256').update(b).digest('hex');
 for(const mode of ['normal','provenance-change','other-metadata-change','unknown-attribute','post-exchange-provenance','post-exchange-original-provenance']){
  const dir=path.join(root,mode),recovery=path.join(dir,'recovery'),file=path.join(dir,'Source.md'),marker=path.join(dir,'changed');fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(recovery,{mode:0o700});const before=Buffer.from('\ufeff# Synthetic\r\nBefore.\r\n'),after=Buffer.from('\ufeff# Synthetic\r\nAfter.\r\n');fs.writeFileSync(file,before,{flag:'wx',mode:0o644});
  assert.equal(spawnSync('/usr/bin/xattr',['-wx','com.apple.lastuseddate#PS','01000000000000000000000000000000',file]).status,0);
  if(mode==='unknown-attribute')assert.equal(spawnSync('/usr/bin/xattr',['-w','synthetic.unknown','retained',file]).status,0);
  const request={filePath:file,recoveryPath:recovery,recoveryIdentity:metadata(recovery),body:after.toString('base64'),sha256:hash(after),expectedIdentity:metadata(file),expectedSha256:hash(before),ancestors:[{path:dir,identity:metadata(dir),metadata:require('../lib/document-save-policy').inspectMacMetadata(dir,{newFileDirectory:true})}],revision:1,...(['provenance-change','other-metadata-change'].includes(mode)?{testPoint:'prepared'}:mode.startsWith('post-exchange')?{testPoint:'after-swap'}:{})};
  const result=await new Promise((resolve,reject)=>{const child=spawn(binary,[file,marker,mode],{stdio:['pipe','pipe','pipe']});let pending='',receipt,failure;const timer=setTimeout(()=>{failure=Error('native timeout');child.kill('SIGKILL');},15000);child.on('error',e=>failure=e);child.stdin.on('error',()=>{});child.stderr.resume();child.stdout.on('data',b=>{try{pending+=b;let i;while((i=pending.indexOf('\n'))>=0){const v=JSON.parse(pending.slice(0,i));pending=pending.slice(i+1);if(v.testPoint){if(mode.includes('provenance'))fs.writeFileSync(marker,'synthetic');else assert.equal(spawnSync('/usr/bin/xattr',['-wx','com.apple.lastuseddate#PS','02000000000000000000000000000000',path.join(recovery,'exchanged.md')]).status,0);child.stdin.write('!');}else receipt=v;}}catch(e){failure=e;child.kill('SIGKILL');}});child.once('close',code=>{clearTimeout(timer);if(failure||code!==0||!receipt)reject(failure||Error('native exit '+code));else resolve(receipt);});child.stdin.write(JSON.stringify(request)+'\n');});
  assert.equal(result.ok,mode==='normal',JSON.stringify({mode,result}));const committed=mode==='normal'||mode.startsWith('post-exchange');assert.equal(result.committed,committed);assert.deepEqual(fs.readFileSync(file),committed?after:before);assert.equal(metadata(file).mode,0o644);
  if(mode==='normal'){assert.deepEqual(fs.readFileSync(path.join(recovery,'previous.md')),before);assert.equal(spawnSync('/usr/bin/xattr',['-px','com.apple.lastuseddate#PS',file],{encoding:'utf8'}).stdout.replace(/\s/g,''),'01000000000000000000000000000000');}
  else assert.equal(result.code,mode==='unknown-attribute'?'unsupported-xattrs':mode==='post-exchange-original-provenance'?'conflict-after-exchange':mode==='post-exchange-provenance'?'target-changed-after-exchange':'candidate-changed');
 }
 console.log('native-provenance-evidence:'+root);
});
