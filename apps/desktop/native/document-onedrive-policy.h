// A scoped OneDrive grant never changes ordinary local or other-provider policy.
static NSString *providerRole(NSString *path,NSString *root){
 NSString *home=NSHomeDirectory();
 if([path isEqual:[home stringByAppendingPathComponent:@"Library"]])return @"library";
 if([path isEqual:[home stringByAppendingPathComponent:@"Library/CloudStorage"]])return @"storage";
 if([path isEqual:root])return @"domain";
 if([path hasPrefix:[root stringByAppendingString:@"/"]])return @"child";
 return nil;
}
static NSDictionary *inspectOneDriveVolume(NSString *path){
 @try{
  NSString *base=[NSHomeDirectory() stringByAppendingPathComponent:@"Library/CloudStorage"],*prefix=[base stringByAppendingString:@"/"];
  if(![path hasPrefix:prefix]||![[path stringByResolvingSymlinksInPath] isEqual:path]||![path isEqual:[path stringByStandardizingPath]])refuse(@"invalid-onedrive-directory");
  NSString *name=[[path substringFromIndex:prefix.length] pathComponents].firstObject,*root=[base stringByAppendingPathComponent:name];
  if(![name hasPrefix:@"OneDrive-"]||name.length<=9)refuse(@"invalid-onedrive-directory");
  int fd=open(root.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)refuse(@"onedrive-domain-unavailable");
  @try{BOOL acl=NO;NSDictionary *attrs=scopedAttributes(fd,YES,&acl,0,@"domain");if(!acl||!attrs[@"com.apple.file-provider-domain-id"]||[identity(fd)[@"uid"] unsignedIntValue]!=getuid())refuse(@"onedrive-domain-unavailable");}@finally{close(fd);}
  oneDriveFiles=YES;return inspectLocalVolume(path);
 }@catch(NSException *e){return @{@"ok":@NO,@"code":e.name};}
}
static void verifyOneDriveGrant(NSDictionary *r){
 if(!r[@"oneDrive"])return;
 NSDictionary *proof=r[@"oneDrive"];if(![proof isKindOfClass:NSDictionary.class]||proof.count!=2)refuse(@"invalid-onedrive-grant");
 NSString *root=proof[@"root"],*home=NSHomeDirectory(),*base=[home stringByAppendingPathComponent:@"Library/CloudStorage"];
 if(![root isKindOfClass:NSString.class]||![[root stringByDeletingLastPathComponent] isEqual:base]||![root.lastPathComponent hasPrefix:@"OneDrive-"]||root.lastPathComponent.length<=9||![[root stringByResolvingSymlinksInPath] isEqual:root])refuse(@"invalid-onedrive-grant");
 NSString *directory=[r[@"filePath"] stringByDeletingLastPathComponent];
 if(![directory isEqual:root]&&![directory hasPrefix:[root stringByAppendingString:@"/"]])refuse(@"invalid-onedrive-grant");
 if(![directory isEqual:[directory stringByStandardizingPath]]||![[directory stringByResolvingSymlinksInPath] isEqual:directory])refuse(@"invalid-onedrive-grant");
 for(NSString *part in [[directory substringFromIndex:base.length+1] pathComponents])if([part hasPrefix:@"."]||[part.lowercaseString isEqual:@"secrets"])refuse(@"invalid-onedrive-grant");
 NSArray *ancestors=r[@"ancestors"];NSMutableArray *paths=[NSMutableArray arrayWithObject:home];NSString *p=home;
 for(NSString *part in [[directory substringFromIndex:home.length+1] pathComponents]){p=[p stringByAppendingPathComponent:part];[paths addObject:p];}
 if(![ancestors isKindOfClass:NSArray.class]||ancestors.count!=paths.count)refuse(@"invalid-onedrive-grant");
 NSDictionary *domain=nil;
 for(NSUInteger i=0;i<paths.count;i++){
  NSDictionary *a=ancestors[i];NSString *expected=providerRole(paths[i],root),*actual=a[@"oneDriveRole"];
  if(![a[@"path"] isEqual:paths[i]]||(expected?![expected isEqual:actual]:actual!=nil))refuse(@"invalid-onedrive-role");
  if([expected isEqual:@"domain"])domain=a;
 }
 if(!domain||![domain[@"metadata"][@"acl"] isKindOfClass:NSString.class]||![(NSString *)domain[@"metadata"][@"acl"] containsString:@"writeextattr"]||![domain[@"metadata"][@"xattrs"][@"com.apple.file-provider-domain-id"] isEqual:proof[@"domainSha256"]])refuse(@"invalid-onedrive-domain");
 struct stat local,provider;
 if(stat(home.fileSystemRepresentation,&local)||lstat(directory.fileSystemRepresentation,&provider)||local.st_dev!=provider.st_dev)refuse(@"unsupported-filesystem");
 oneDriveFiles=YES;verifyAncestors(ancestors);
}
static void coordinateDocumentWrite(NSDictionary *r,NSFileCoordinator *coordinator,NSError **error,void (^accessor)(NSURL *)){
 NSURL *target=[NSURL fileURLWithPath:r[@"filePath"]];
 if(!oneDriveFiles){[coordinator coordinateWritingItemAtURL:target options:NSFileCoordinatorWritingForReplacing error:error byAccessor:accessor];return;}
 NSMutableArray *urls=[NSMutableArray arrayWithObject:target];NSArray *assets=r[@"assets"]?:@[];
 if(![assets isKindOfClass:NSArray.class]||assets.count>DOCUMENT_MAX_IMAGES)refuse(@"invalid-assets");
 for(NSDictionary *asset in assets){
  if(![asset isKindOfClass:NSDictionary.class])refuse(@"invalid-assets");NSString *name=asset[@"name"];
  if(![name isKindOfClass:NSString.class]||[name rangeOfString:@"^markdown-image-[a-f0-9]{64}\\.(png|jpg)$" options:NSRegularExpressionSearch].location==NSNotFound)refuse(@"invalid-assets");
  [urls addObject:[NSURL fileURLWithPath:[target.path.stringByDeletingLastPathComponent stringByAppendingPathComponent:name]]];
 }
 // A directory grant alone does not recursively coordinate individual images.
 [coordinator prepareForReadingItemsAtURLs:@[] options:0 writingItemsAtURLs:urls options:NSFileCoordinatorWritingForReplacing error:error byAccessor:^(void (^finished)(void)){
  @try{accessor(target);}@finally{finished();}
 }];
}
