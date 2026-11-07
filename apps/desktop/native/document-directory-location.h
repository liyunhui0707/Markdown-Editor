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
