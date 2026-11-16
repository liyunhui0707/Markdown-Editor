// Read-only Foundation location check, shared by capture and coordinated save.
static void verifyLocalDirectory(NSString *path) {
  if(![path isKindOfClass:NSString.class]||![path isAbsolutePath])refuse(@"invalid-directory");
  int fd=open(path.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(fd<0)refuse(@"directory-location-unavailable");
  @try {
    NSDictionary *before=identity(fd);
    NSURL *url=[NSURL fileURLWithPath:path isDirectory:YES];NSError *error=nil;id value=nil;
    if(![url getResourceValue:&value forKey:NSURLIsUbiquitousItemKey error:&error]||error||
       (value&&![value isKindOfClass:NSNumber.class]))refuse(@"directory-location-unavailable");
    // macOS returns no value for an ordinary local directory; a successful query
    // is required. ACL/xattr, filesystem and every ancestor remain checked too.
    if([value boolValue])refuse(@"cloud-directory");
    struct stat named;
    if(lstat(path.fileSystemRepresentation,&named)||!S_ISDIR(named.st_mode)||
       named.st_dev!=[before[@"dev"] longLongValue]||named.st_ino!=strtoull([before[@"ino"] UTF8String],NULL,10)||
       !same(identity(fd),before,posixKeys()))refuse(@"directory-changed");
  }@finally{close(fd);}
}
static NSDictionary *inspectDirectoryLocation(NSString *path) {
  @try{verifyLocalDirectory(path);return @{@"ok":@YES,@"ubiquitous":@NO};}
  @catch(NSException *e){return @{@"ok":@NO,@"code":e.name};}
}

// Separate from the existing two-key ubiquitous-item check.
static NSDictionary *localVolume(NSString *path) {
  int fd=open(path.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(fd<0)refuse(@"volume-unavailable");
  @try{NSDictionary *before=identity(fd);struct statfs disk;
    if(fstatfs(fd,&disk)||strcmp(disk.f_fstypename,"apfs")||!(disk.f_flags&MNT_LOCAL)||(disk.f_flags&MNT_RDONLY)||(disk.f_flags&MNT_IGNORE_OWNERSHIP))refuse(@"unsupported-filesystem");
    if(!oneDriveFiles)verifyLocalDirectory(path);NSError *error=nil;id uuid=nil;
    if(![[NSURL fileURLWithPath:path isDirectory:YES] getResourceValue:&uuid forKey:NSURLVolumeUUIDStringKey error:&error]||error||![uuid isKindOfClass:NSString.class]||![[NSUUID alloc] initWithUUIDString:uuid])refuse(@"volume-unavailable");
    struct stat named;if(lstat(path.fileSystemRepresentation,&named)||named.st_dev!=[before[@"dev"] longLongValue]||named.st_ino!=strtoull([before[@"ino"] UTF8String],NULL,10)||!same(identity(fd),before,posixKeys()))refuse(@"directory-changed");
    return @{@"filesystem":@"apfs",@"local":@YES,@"writable":@YES,@"ownership":@YES,@"uuid":uuid,@"dev":before[@"dev"],@"mount":[NSString stringWithUTF8String:disk.f_mntonname]};
  }@finally{close(fd);}
}
static NSDictionary *inspectLocalVolume(NSString *path){
  @try{NSMutableDictionary *proof=[localVolume(path) mutableCopy];proof[@"ok"]=@YES;return proof;}
  @catch(NSException *e){return @{@"ok":@NO,@"code":e.name};}
}
