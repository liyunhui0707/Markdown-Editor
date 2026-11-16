'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
// Exercise the actual shared native reader; the harness injects a ctime-only
// race at pread, without adding a fault hook to the production helper.
if(process.platform==='darwin')test('native provider reads check storage metadata first and retain raw within-read ctime proof',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-provider-read-'))),source=path.join(root,'probe.m'),binary=path.join(root,'probe'),file=path.join(root,'Synthetic.md');
 const header=path.resolve(__dirname,'../native/document-save-io.h');
 fs.writeFileSync(source,`#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
static int watched=-1;static BOOL mutate=NO;static NSUInteger reads=0;
static ssize_t observedRead(int fd,void *bytes,size_t length,off_t offset){
 ssize_t n=pread(fd,bytes,length,offset);if(fd==watched){reads++;if(mutate){mutate=NO;if(fchmod(fd,0400)||fchmod(fd,0600))abort();}}return n;
}
#define pread observedRead
#import ${JSON.stringify(header)}
#undef pread
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=3)return 64;watched=open(argv[1],O_RDWR|O_NOFOLLOW);if(watched<0)return 65;oneDriveFiles=YES;mutate=!strcmp(argv[2],"race");NSString *state=@"ok";
 @try{readBytesLimit(watched,1000);}@catch(NSException *e){state=e.name;}
 close(watched);NSData *json=[NSJSONSerialization dataWithJSONObject:@{@"state":state,@"readAttempts":@(reads)} options:0 error:NULL];fwrite(json.bytes,1,json.length,stdout);return 0;
}}
`,{flag:'wx',mode:0o600});
 const built=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-Wall','-Wextra','-Werror','-Wno-unused-function','-Wno-deprecated-declarations','-framework','Foundation','-o',binary,source],{encoding:'utf8',timeout:30000});
 assert.equal(built.status,0,built.stderr);fs.writeFileSync(file,'# Synthetic local bytes\n',{flag:'wx',mode:0o600});
 const run=mode=>{const r=spawnSync(binary,[file,mode],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 assert.deepEqual(run('plain'),{state:'ok',readAttempts:1});
 assert.deepEqual(run('race'),{state:'file-changed',readAttempts:1});
 const attrs=spawnSync('/usr/bin/xattr',['-w','com.example.synthetic-storage','unknown',file],{encoding:'utf8',timeout:5000});assert.equal(attrs.status,0,attrs.stderr);
 assert.deepEqual(run('plain'),{state:'unsupported-xattrs',readAttempts:0});
 assert.equal(fs.readFileSync(file,'utf8'),'# Synthetic local bytes\n');
 console.log('native-provider-read-evidence:'+root);
});
