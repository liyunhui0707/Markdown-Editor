// One bounded coordinated transaction. All input is main-owned; no renderer IPC.
#import "document-save-io.h"

static void checkpoint(NSDictionary *request,NSString *step) {
#ifdef DOCUMENT_SAVE_TESTING
  if([request[@"testPoint"] isEqual:step]){
    printf("{\"testPoint\":\"%s\"}\n",step.UTF8String);fflush(stdout);
    if(getchar()!='!')refuse(@"test-interrupted");
  }
  if([request[@"testFault"] isEqual:step])refuse(@"injected-failure");
#else
  (void)request;(void)step;
#endif
}
static NSArray *prepareAssets(int dir,NSArray *assets) {
  if(![assets isKindOfClass:NSArray.class]||assets.count>DOCUMENT_MAX_IMAGES)refuse(@"invalid-assets");
  NSMutableArray *proofs=[NSMutableArray array],*decoded=[NSMutableArray array];NSMutableSet *seen=[NSMutableSet set];NSUInteger total=0;
  for(NSDictionary *a in assets){NSString *name=a[@"name"];NSData *bytes=[[NSData alloc] initWithBase64EncodedString:a[@"body"] options:0];
    if(!bytes||bytes.length>DOCUMENT_MAX_IMAGE_BYTES||![digest(bytes) isEqual:a[@"sha256"]]||[seen containsObject:name]||
       (![name isEqual:[NSString stringWithFormat:@"markdown-image-%@.png",a[@"sha256"]]]&&![name isEqual:[NSString stringWithFormat:@"markdown-image-%@.jpg",a[@"sha256"]]]))refuse(@"invalid-assets");
    total+=bytes.length;if(total>DOCUMENT_MAX_ATTACHMENT_BYTES)refuse(@"invalid-assets");
    [seen addObject:name];[decoded addObject:bytes];
  }
  for(NSUInteger i=0;i<assets.count;i++){NSDictionary *a=assets[i];NSString *name=a[@"name"];NSData *bytes=decoded[i];struct stat existing;int fd;
    if(fstatat(dir,name.fileSystemRepresentation,&existing,AT_SYMLINK_NOFOLLOW)==0)fd=openRegular(dir,name.fileSystemRepresentation,O_RDONLY);
    else if(errno==ENOENT)fd=createBytes(dir,name.fileSystemRepresentation,bytes);else refuse(@"asset-unavailable");
    @try{NSDictionary *before=identity(fd);if(([before[@"mode"] intValue]&0022)||![readBytesLimit(fd,DOCUMENT_MAX_IMAGE_BYTES) isEqual:bytes])refuse(@"asset-conflict");
      NSDictionary *meta=attributes(fd);if(fsync(fd)||![identity(fd) isEqual:before])refuse(@"asset-unverified");
      [proofs addObject:@{@"name":name,@"identity":before,@"sha256":digest(bytes),@"attributes":meta}];
    }@finally{close(fd);}
  }if(fsync(dir))refuse(@"asset-sync-uncertain");return proofs;
}
static void verifyAssets(int dir,NSArray *proofs){
 for(NSDictionary *a in proofs){int fd=openRegular(dir,[a[@"name"] fileSystemRepresentation],O_RDONLY);
  @try{struct stat named;if(fstatat(dir,[a[@"name"] fileSystemRepresentation],&named,AT_SYMLINK_NOFOLLOW)||named.st_ino!=strtoull([a[@"identity"][@"ino"] UTF8String],NULL,10)||named.st_dev!=[a[@"identity"][@"dev"] longLongValue])refuse(@"asset-changed");if(![identity(fd) isEqual:a[@"identity"]]||![digest(readBytesLimit(fd,DOCUMENT_MAX_IMAGE_BYTES)) isEqual:a[@"sha256"]]||![attributes(fd) isEqual:a[@"attributes"]]||![identity(fd) isEqual:a[@"identity"]])refuse(@"asset-changed");}@finally{close(fd);}
 }
}
static NSDictionary *transaction(NSDictionary *r) {
  __block BOOL exchanged=NO,attempted=NO;BOOL journalReady=NO;__block NSDictionary *receipt;
  __block int target=-1,recovery=-1,original=-1,candidate=-1;
  NSString *file=r[@"filePath"],*directory=[file stringByDeletingLastPathComponent],*name=[file lastPathComponent];
  NSString *root=r[@"recoveryPath"];
  @try {
    if(![file isKindOfClass:NSString.class]||![root isKindOfClass:NSString.class]||![file hasPrefix:@"/"]||![root hasPrefix:@"/"]||![name.pathExtension.lowercaseString isEqual:@"md"]||![r[@"ancestors"] isKindOfClass:NSArray.class])refuse(@"invalid-request");
    NSData *bytes=[[NSData alloc] initWithBase64EncodedString:r[@"body"] options:0];
    if(!bytes||bytes.length>DOCUMENT_MAX_BYTES||![digest(bytes) isEqual:r[@"sha256"]])refuse(@"invalid-body");
    recovery=open(root.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(recovery<0||!same(identity(recovery),r[@"recoveryIdentity"],posixKeys())||[identity(recovery)[@"mode"] intValue]!=0700)refuse(@"recovery-directory-changed");
    journalReady=YES;
    NSError *coordinationError=nil;
    NSFileCoordinator *coordinator=[[NSFileCoordinator alloc] initWithFilePresenter:nil];
    [coordinator coordinateWritingItemAtURL:[NSURL fileURLWithPath:file] options:NSFileCoordinatorWritingForReplacing error:&coordinationError byAccessor:^(NSURL *url){
      @try {
        if(![url.path isEqual:file])refuse(@"coordinated-path-changed");
        verifyAncestors(r[@"ancestors"]);
        target=open(directory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(target<0)refuse(@"directory-changed");
        if(!same(identity(target),[r[@"ancestors"] lastObject][@"identity"],posixKeys()))refuse(@"directory-changed");
        struct statfs disk;if(fstatfs(target,&disk)||strcmp(disk.f_fstypename,"apfs")||!(disk.f_flags&MNT_LOCAL)||![identity(target)[@"dev"] isEqual:identity(recovery)[@"dev"]])refuse(@"unsupported-filesystem");
        NSDictionary *baseline=namedState(target,name.fileSystemRepresentation);
        if(![baseline[@"identity"] isEqual:r[@"expectedIdentity"]]||![baseline[@"sha256"] isEqual:r[@"expectedSha256"]])refuse(@"external-change");
        if(([baseline[@"identity"][@"mode"] intValue]&0222)==0||([baseline[@"identity"][@"mode"] intValue]&0022))refuse(@"read-only");
        original=openRegular(target,name.fileSystemRepresentation,O_RDONLY);
        if(![identity(original) isEqual:baseline[@"identity"]])refuse(@"external-change");
        int copy=createBytes(recovery,"baseline.md",readBytes(original));close(copy);
        int draft=createBytes(recovery,"draft.md",bytes);close(draft);
        candidate=createBytes(recovery,"exchanged.md",bytes);
        // Preserve supported native metadata, never drop unknown attributes/ACL.
        if(fcopyfile(original,candidate,NULL,COPYFILE_METADATA)||fchmod(candidate,[baseline[@"identity"][@"mode"] intValue]))refuse(@"metadata-copy-failed");
        if(!same(identity(candidate),baseline[@"identity"],@[@"mode",@"uid",@"gid"])||![attributes(candidate) isEqual:baseline[@"attributes"]])refuse(@"metadata-copy-failed");
        if(fsync(candidate)||fsync(recovery))refuse(@"sync-failed");
        NSDictionary *prepared=identity(candidate);
        writeJSON(recovery,"prepared.json",@{@"version":@1,@"filePath":file,@"revision":r[@"revision"],@"expected":baseline,@"candidateIdentity":prepared,@"sha256":r[@"sha256"],@"state":@"prepared",@"assets":[r[@"assets"]?:@[] valueForKey:@"name"]});
        NSArray *assets=prepareAssets(target,r[@"assets"]?:@[]);
        checkpoint(r,@"prepared");
        verifyAncestors(r[@"ancestors"]);
        if(![namedState(target,name.fileSystemRepresentation) isEqual:baseline])refuse(@"external-change");
        if(![digest(readBytes(candidate)) isEqual:r[@"sha256"]]||![attributes(candidate) isEqual:baseline[@"attributes"]])refuse(@"candidate-changed");
        checkpoint(r,@"before-swap");
        attempted=YES;
        // A single-component exchange retains whatever occupied the target. It
        // is NOT an inode CAS. Never unlink the displaced object or auto-swap back.
        if(renameatx_np(recovery,"exchanged.md",target,name.fileSystemRepresentation,RENAME_SWAP|RENAME_NOFOLLOW_ANY))refuse(@"exchange-unconfirmed");
        exchanged=YES;checkpoint(r,@"after-swap");
        NSDictionary *displaced=namedState(recovery,"exchanged.md");
        if(!same(displaced[@"identity"],baseline[@"identity"],@[@"dev",@"ino",@"size",@"mtimeNs",@"mode",@"uid",@"gid"])||![displaced[@"sha256"] isEqual:baseline[@"sha256"]]||![displaced[@"attributes"] isEqual:baseline[@"attributes"]])refuse(@"conflict-after-exchange");
        NSDictionary *current=namedState(target,name.fileSystemRepresentation);
        if(!same(current[@"identity"],prepared,@[@"dev",@"ino",@"size",@"mtimeNs",@"mode",@"uid",@"gid"])||![current[@"sha256"] isEqual:r[@"sha256"]]||![current[@"attributes"] isEqual:baseline[@"attributes"]])refuse(@"target-changed-after-exchange");
        verifyAncestors(r[@"ancestors"]);verifyAssets(target,assets);checkpoint(r,@"sync");
        if(fsync(candidate)||fsync(original)||fsync(target)||fsync(recovery))refuse(@"durability-uncertain");
        // Immutable recovery copy of the verified displaced bytes. The exchanged
        // inode also remains, but another holder may continue writing through it.
        int previous=createBytes(recovery,"previous.md",readBytes(original));close(previous);
        if(![namedState(recovery,"exchanged.md") isEqual:displaced]||![namedState(target,name.fileSystemRepresentation) isEqual:current])refuse(@"post-verification-change");
        receipt=@{@"ok":@YES,@"state":@"saved-confirmed",@"committed":@YES,@"identity":current[@"identity"],@"sha256":r[@"sha256"],@"revision":r[@"revision"]};
        writeJSON(recovery,"confirmed.json",receipt);
      }@catch(NSException *e){
#ifdef DOCUMENT_SAVE_TESTING
 fprintf(stderr,"%s: %s\n",e.name.UTF8String,e.reason.UTF8String);
#endif
 receipt=@{@"ok":@NO,@"state":exchanged?@"save-unverified":attempted?@"save-outcome-unknown":@"not-saved",@"committed":exchanged?@YES:attempted?(id)NSNull.null:@NO,@"code":e.name};}
    }];
    if(coordinationError||!receipt)refuse(@"coordination-failed");
  }@catch(NSException *e){
#ifdef DOCUMENT_SAVE_TESTING
 fprintf(stderr,"%s: %s\n",e.name.UTF8String,e.reason.UTF8String);
#endif
 receipt=@{@"ok":@NO,@"state":exchanged?@"save-unverified":attempted?@"save-outcome-unknown":@"not-saved",@"committed":exchanged?@YES:attempted?(id)NSNull.null:@NO,@"code":e.name};}
  // Exclusive, append-only terminal record. A missing record is unresolved on restart.
  if(journalReady){@try{writeJSON(recovery,"outcome.json",receipt);}@catch(NSException *e){(void)e;receipt=@{@"ok":@NO,@"state":@"save-outcome-unknown",@"committed":attempted?(id)NSNull.null:@NO,@"code":@"journal-unconfirmed"};}}
  for(NSNumber *number in @[@(candidate),@(original),@(target),@(recovery)])if(number.intValue>=0)close(number.intValue);
  return receipt;
}
int main(int argc,const char **argv){@autoreleasepool {
  if(argc==3&&!strcmp(argv[1],"--inspect-directory")){
    NSDictionary *result=inspectDirectoryLocation([NSString stringWithUTF8String:argv[2]]);
    NSData *output=[NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
    fwrite(output.bytes,1,output.length,stdout);putchar('\n');return 0;
  }
  if(argc!=1)return 64;
  // Newline framed input leaves test-only checkpoint acknowledgements unread.
  NSMutableData *data=[NSMutableData data];int c;
  while((c=getchar())!='\n'&&c!=EOF){if(data.length>=DOCUMENT_MAX_REQUEST_BYTES)return 64;unsigned char b=c;[data appendBytes:&b length:1];}
  NSDictionary *request=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
  if(![request isKindOfClass:NSDictionary.class])return 64;
  NSMutableSet *keys=[NSMutableSet setWithArray:@[@"filePath",@"recoveryPath",@"recoveryIdentity",@"body",@"sha256",@"expectedIdentity",@"expectedSha256",@"ancestors",@"revision",@"assets"]];
#ifdef DOCUMENT_SAVE_TESTING
  [keys addObjectsFromArray:@[@"testPoint",@"testFault"]];
#endif
  for(id key in request)if(![keys containsObject:key])return 64;
  NSDictionary *result=transaction(request);NSData *output=[NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  fwrite(output.bytes,1,output.length,stdout);putchar('\n');return 0;
}}
