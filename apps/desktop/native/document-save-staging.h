// Durable exchange material on the selected target volume. Local recovery stays
// independently readable; no automatic deletion, adoption or rollback.
static void privateDirectory(int fd) {
  struct stat s;if(fstat(fd,&s)||!S_ISDIR(s.st_mode)||s.st_uid!=getuid()||(s.st_mode&07777)!=0700)refuse(@"staging-unavailable");
  BOOL acl=NO;nativeAttributes(fd,YES,&acl);if(acl)refuse(@"staging-unavailable");
}
static void markerMatches(int dir,NSData *wanted) {
  int fd=openRegular(dir,"owner.json",O_RDONLY);
  @try{NSDictionary *before=identity(fd);attributes(fd);if(![readBytesLimit(fd,65536) isEqual:wanted]||![before isEqual:identity(fd)])refuse(@"staging-owner-changed");}
  @finally{close(fd);}
}
static void namedDirectory(int parent,NSString *name,int fd,NSDictionary *expected) {
  struct stat s;if(fstatat(parent,name.fileSystemRepresentation,&s,AT_SYMLINK_NOFOLLOW)||!S_ISDIR(s.st_mode)||s.st_dev!=[expected[@"dev"] longLongValue]||s.st_ino!=strtoull([expected[@"ino"] UTF8String],NULL,10)||!same(identity(fd),expected,posixKeys()))refuse(@"staging-changed");privateDirectory(fd);
}
static NSDictionary *prepareStaging(NSDictionary *r,int target,int recovery,int *stageRoot,int *swap) {
  NSString *local=[r[@"recoveryPath"] stringByDeletingLastPathComponent],*record=[r[@"recoveryPath"] lastPathComponent];
  if(![[NSUUID alloc] initWithUUIDString:record])refuse(@"invalid-staging-record");
  NSString *rootName=[@".markdown-recovery-" stringByAppendingString:[digest([local dataUsingEncoding:NSUTF8StringEncoding]) substringToIndex:24]];
  NSString *preparing=[rootName stringByAppendingFormat:@".prepare-%@",record];
  NSString *parent=[r[@"filePath"] stringByDeletingLastPathComponent],*stagePath=[[parent stringByAppendingPathComponent:rootName] stringByAppendingPathComponent:record];
  NSDictionary *owner=@{@"version":@1,@"localRecoveryRoot":local,@"uid":@(getuid())};
  // Stable, canonical bytes permit bounded verification without trusting directory contents.
  NSData *marker=[NSJSONSerialization dataWithJSONObject:owner options:NSJSONWritingSortedKeys error:NULL];
  writeJSON(recovery,"stage-plan.json",@{@"version":@1,@"path":stagePath,@"preparingPath":[parent stringByAppendingPathComponent:preparing],@"volume":r[@"volume"],@"owner":owner});
  struct stat existing;
  if(fstatat(target,rootName.fileSystemRepresentation,&existing,AT_SYMLINK_NOFOLLOW)){
    if(errno!=ENOENT)refuse(@"staging-unavailable");
    if(mkdirat(target,preparing.fileSystemRepresentation,0700))refuse(@"staging-create-failed");
    int init=openat(target,preparing.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(init<0)refuse(@"staging-create-failed");
    @try{privateDirectory(init);int ownerFD=createBytes(init,"owner.json",marker);close(ownerFD);if(fsync(init)||fsync(target))refuse(@"staging-sync-uncertain");
      // Publish a fully initialized namespace. A racing or interrupted preparing
      // directory remains named in the local plan; never remove unknown material.
      if(renameatx_np(target,preparing.fileSystemRepresentation,target,rootName.fileSystemRepresentation,RENAME_EXCL|RENAME_NOFOLLOW_ANY)&&errno!=EEXIST)refuse(@"staging-publish-failed");
    }@finally{close(init);}
  }
  *stageRoot=openat(target,rootName.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(*stageRoot<0)refuse(@"staging-unavailable");privateDirectory(*stageRoot);if(![identity(*stageRoot)[@"dev"] isEqual:identity(target)[@"dev"]])refuse(@"staging-volume-changed");markerMatches(*stageRoot,marker);
  if(mkdirat(*stageRoot,record.fileSystemRepresentation,0700))refuse(@"staging-create-failed");
  *swap=openat(*stageRoot,record.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(*swap<0)refuse(@"staging-unavailable");privateDirectory(*swap);
  if(![identity(*swap)[@"dev"] isEqual:identity(target)[@"dev"]])refuse(@"staging-volume-changed");
  NSDictionary *proof=@{@"version":@1,@"path":stagePath,@"rootName":rootName,@"record":record,@"rootIdentity":identity(*stageRoot),@"identity":identity(*swap),@"volume":r[@"volume"],@"owner":owner};
  namedDirectory(target,rootName,*stageRoot,proof[@"rootIdentity"]);namedDirectory(*stageRoot,record,*swap,proof[@"identity"]);
  if(fsync(*swap)||fsync(*stageRoot)||fsync(target))refuse(@"staging-sync-uncertain");writeJSON(recovery,"staging.json",proof);return proof;
}
static void verifyStaging(NSDictionary *r,NSDictionary *proof,int target,int stageRoot,int swap) {
  if(!proof)return;
  if(![localVolume([r[@"filePath"] stringByDeletingLastPathComponent]) isEqual:r[@"volume"]])refuse(@"staging-volume-changed");
  NSData *marker=[NSJSONSerialization dataWithJSONObject:proof[@"owner"] options:NSJSONWritingSortedKeys error:NULL];
  namedDirectory(target,proof[@"rootName"],stageRoot,proof[@"rootIdentity"]);markerMatches(stageRoot,marker);namedDirectory(stageRoot,proof[@"record"],swap,proof[@"identity"]);
}
