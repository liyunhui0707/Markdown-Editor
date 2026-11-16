// Exclusive creation only: a failure never overwrites/removes an existing target.
static NSDictionary *createOneDriveCopy(NSDictionary *r){
 __block BOOL fileCreated=NO,assetsAttempted=NO;__block NSDictionary *receipt=nil;
 __block int directory=-1,file=-1;NSString *target=r[@"filePath"],*name=nil;
 @try{
  if(!r[@"oneDrive"]||![target isKindOfClass:NSString.class])refuse(@"invalid-create-request");name=target.lastPathComponent;
  if(![name.pathExtension.lowercaseString isEqual:@"md"]||[name hasPrefix:@"."])refuse(@"invalid-create-request");
  NSData *bytes=[[NSData alloc] initWithBase64EncodedString:r[@"body"] options:0];
  if(!bytes||bytes.length>DOCUMENT_MAX_BYTES||![digest(bytes) isEqual:r[@"sha256"]])refuse(@"invalid-body");
  verifyOneDriveGrant(r);NSError *error=nil;NSFileCoordinator *coordinator=[[NSFileCoordinator alloc] initWithFilePresenter:nil];
  coordinateDocumentWrite(r,coordinator,&error,^(NSURL *url){
   @try{
    if(![url.path isEqual:target])refuse(@"coordinated-path-changed");verifyAncestors(r[@"ancestors"]);
    directory=open(target.stringByDeletingLastPathComponent.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(directory<0||!same(identity(directory),[r[@"ancestors"] lastObject][@"identity"],posixKeys()))refuse(@"directory-changed");
    if(![localVolume(target.stringByDeletingLastPathComponent) isEqual:r[@"volume"]])refuse(@"unsupported-filesystem");
    struct stat exists;if(!fstatat(directory,name.fileSystemRepresentation,&exists,AT_SYMLINK_NOFOLLOW))refuse(@"target-exists");if(errno!=ENOENT)refuse(@"file-unavailable");
    assetsAttempted=[r[@"assets"] count]>0;NSArray *assets=prepareAssets(directory,r[@"assets"]?:@[]);checkpoint(r,@"create-before-file");
    file=openat(directory,name.fileSystemRepresentation,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(file<0)refuse(errno==EEXIST?@"target-exists":@"create-unconfirmed");fileCreated=YES;
    NSUInteger offset=0;while(offset<bytes.length){ssize_t n=write(file,(const char *)bytes.bytes+offset,bytes.length-offset);if(n<=0)refuse(@"write-failed");offset+=n;}
    if(fsync(file)||fsync(directory))refuse(@"durability-uncertain");
    NSDictionary *written=namedState(directory,name.fileSystemRepresentation);
    if(![written[@"sha256"] isEqual:r[@"sha256"]]||!same(written[@"identity"],identity(file),@[@"dev",@"ino",@"size",@"mtimeNs",@"mode",@"uid",@"gid"]))refuse(@"created-file-changed");
    verifyAssets(directory,assets);verifyAncestors(r[@"ancestors"]);
    receipt=@{@"ok":@YES,@"created":@YES,@"state":@"created-confirmed",@"filePath":target,@"sha256":r[@"sha256"],@"byteLength":@(bytes.length)};
   }@catch(NSException *e){receipt=@{@"ok":@NO,@"created":fileCreated?@YES:assetsAttempted?(id)NSNull.null:@NO,@"state":fileCreated?@"created-unverified":assetsAttempted?@"create-outcome-unknown":[e.name isEqual:@"target-exists"]?@"target-exists":@"not-created",@"code":e.name};}
  });
  if(error||!receipt)refuse(@"coordination-failed");
 }@catch(NSException *e){receipt=@{@"ok":@NO,@"created":fileCreated?@YES:assetsAttempted?(id)NSNull.null:@NO,@"state":fileCreated?@"created-unverified":assetsAttempted?@"create-outcome-unknown":@"not-created",@"code":e.name};}
 if(file>=0)close(file);if(directory>=0)close(directory);return receipt;
}
