#import "document-capacity.h"
// Shared by the bounded Foundation helper; no paths or data go to logs.
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/xattr.h>
#include <sys/acl.h>
#include <copyfile.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <uuid/uuid.h>

static void refuse(NSString *code) { @throw [NSException exceptionWithName:code reason:nil userInfo:nil]; }
static NSString *digest(NSData *data) {
  unsigned char out[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(data.bytes, (CC_LONG)data.length, out);
  NSMutableString *s=[NSMutableString string]; for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[s appendFormat:@"%02x",out[i]]; return s;
}
static NSDictionary *identity(int fd) {
  struct stat s;if(fstat(fd,&s))refuse(@"stat-failed");
  return @{@"dev":[NSString stringWithFormat:@"%llu",(unsigned long long)s.st_dev],
    @"ino":[NSString stringWithFormat:@"%llu",s.st_ino], @"size":[NSString stringWithFormat:@"%lld",s.st_size],
    @"mtimeNs":[NSString stringWithFormat:@"%lld",(long long)s.st_mtimespec.tv_sec*1000000000+s.st_mtimespec.tv_nsec],
    @"ctimeNs":[NSString stringWithFormat:@"%lld",(long long)s.st_ctimespec.tv_sec*1000000000+s.st_ctimespec.tv_nsec],
    @"mode":@(s.st_mode&07777),@"uid":@(s.st_uid),@"gid":@(s.st_gid)};
}
static BOOL same(NSDictionary *a, NSDictionary *b, NSArray *keys) {
  for(NSString *key in keys)if(![a[key] isEqual:b[key]])return NO;return YES;
}
static NSArray *posixKeys(void){return @[@"dev",@"ino",@"mode",@"uid",@"gid"];}
#import "document-directory-location.h"
static NSData *readBytesLimit(int fd, size_t limit) {
  struct stat s;if(fstat(fd,&s)||!S_ISREG(s.st_mode)||s.st_nlink!=1||(unsigned long long)s.st_size>limit||s.st_size<0)refuse(@"unsupported-file");
  NSMutableData *d=[NSMutableData dataWithLength:(NSUInteger)s.st_size];size_t offset=0;
  while(offset<d.length){ssize_t n=pread(fd,(char *)d.mutableBytes+offset,d.length-offset,offset);if(n<=0)refuse(@"read-failed");offset+=n;}
  return d;
}
static NSData *readBytes(int fd) {return readBytesLimit(fd,DOCUMENT_MAX_BYTES);}
static NSDictionary *nativeAttributes(int fd, BOOL directory, BOOL *hasACL) {
  struct stat s;if(fstat(fd,&s)||s.st_flags)refuse(@"unsupported-flags");
  // On macOS a valid fd with no extended ACL returns ENOENT. Other failures refuse.
  errno=0;acl_t acl=acl_get_fd_np(fd,ACL_TYPE_EXTENDED);
  if(!acl&&errno!=ENOENT)refuse(@"metadata-unavailable");
  if(hasACL)*hasACL=NO;
  if(acl){@try{acl_entry_t entry;int has=acl_get_entry(acl,ACL_FIRST_ENTRY,&entry);
    if(has==0){
      if(!directory)refuse(@"unsupported-acl");
      acl_tag_t tag;acl_permset_mask_t mask;acl_flagset_t flags;
      if(acl_get_tag_type(entry,&tag)||tag!=ACL_EXTENDED_DENY||acl_get_permset_mask_np(entry,&mask)||mask!=ACL_DELETE||acl_get_flagset_np(entry,&flags))refuse(@"unsupported-acl");
      for(NSNumber *flag in @[@(ACL_ENTRY_INHERITED),@(ACL_ENTRY_FILE_INHERIT),@(ACL_ENTRY_DIRECTORY_INHERIT),@(ACL_ENTRY_LIMIT_INHERIT),@(ACL_ENTRY_ONLY_INHERIT)])if(acl_get_flag_np(flags,flag.intValue)!=0)refuse(@"unsupported-acl");
      void *qualifier=acl_get_qualifier(entry);if(!qualifier)refuse(@"unsupported-acl");
      char text[37];uuid_unparse_upper(qualifier,text);acl_free(qualifier);
      if(strcmp(text,"ABCDEFAB-CDEF-ABCD-EFAB-CDEF0000000C")||acl_get_entry(acl,ACL_NEXT_ENTRY,&entry)==0)refuse(@"unsupported-acl");
      if(hasACL)*hasACL=YES;
    }else if(errno!=EINVAL&&errno!=ENOENT)refuse(@"metadata-unavailable");
  }@finally{acl_free(acl);}}

  ssize_t size=flistxattr(fd,NULL,0,0);if(size<0||size>4096)refuse(@"unsupported-xattrs");
  NSMutableData *names=[NSMutableData dataWithLength:(NSUInteger)size];
  if(flistxattr(fd,names.mutableBytes,names.length,0)!=size)refuse(@"metadata-changed");
  NSMutableDictionary *attrs=[NSMutableDictionary dictionary];
  const char *p=names.bytes;size_t offset=0;
  while(offset<(size_t)size){size_t n=strnlen(p+offset,size-offset);if(n==size-offset)refuse(@"unsupported-xattrs");
    NSString *name=[[NSString alloc] initWithBytes:p+offset length:n encoding:NSUTF8StringEncoding];
    if(![@[@"com.apple.provenance",@"com.apple.macl",@"com.apple.lastuseddate#PS"] containsObject:name]||(directory&&[name isEqual:@"com.apple.lastuseddate#PS"]))refuse(@"unsupported-xattrs");
    ssize_t count=fgetxattr(fd,p+offset,NULL,0,0,0);if(count<0||count>65536)refuse(@"unsupported-xattrs");
    NSMutableData *value=[NSMutableData dataWithLength:count];if(fgetxattr(fd,p+offset,value.mutableBytes,count,0,0)!=count)refuse(@"metadata-changed");
    attrs[name]=digest(value);offset+=n+1;
  }return attrs;
}
static NSDictionary *attributes(int fd){return nativeAttributes(fd,NO,NULL);}
static int openRegular(int dir, const char *name, int flags) {
  int fd=openat(dir,name,flags|O_NOFOLLOW|O_NONBLOCK);if(fd<0)refuse(@"file-unavailable");
  struct stat s;
  if(fstat(fd,&s)||!S_ISREG(s.st_mode)||s.st_nlink!=1||s.st_uid!=getuid()||(s.st_mode&07000)) {close(fd);refuse(@"unsupported-file");}
  return fd;
}
static int createBytes(int dir,const char *name,NSData *data) {
  int fd=openat(dir,name,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW,0600);if(fd<0)refuse(@"recovery-create-failed");
  @try {size_t offset=0;while(offset<data.length){ssize_t n=write(fd,(const char *)data.bytes+offset,data.length-offset);if(n<=0)refuse(@"write-failed");offset+=n;}
    if(fsync(fd))refuse(@"sync-failed");if(![readBytesLimit(fd,DOCUMENT_MAX_IMAGE_BYTES) isEqual:data])refuse(@"recovery-verification-failed");
  }@catch(NSException *e){close(fd);@throw e;}return fd;
}
static void writeJSON(int dir,const char *name,NSDictionary *object) {
  NSData *data=[NSJSONSerialization dataWithJSONObject:object options:0 error:NULL];if(!data)refuse(@"invalid-record");
  int fd=createBytes(dir,name,data);close(fd);if(fsync(dir))refuse(@"sync-failed");
}
static void verifyAncestors(NSArray *ancestors) {
  for(NSDictionary *a in ancestors){NSString *p=a[@"path"];
    if(![p isKindOfClass:NSString.class]||![p hasPrefix:@"/"])refuse(@"invalid-directory");
    int fd=open(p.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)refuse(@"directory-changed");
    BOOL match=NO;
    @try {match=same(identity(fd),a[@"identity"],posixKeys());BOOL acl=NO;NSDictionary *attrs=nativeAttributes(fd,YES,&acl);
      if(a[@"location"]){
        if(![a[@"location"] isEqual:@{@"ubiquitous":@NO}])refuse(@"invalid-directory-location");
        verifyLocalDirectory(p);
      }
      if(a[@"metadata"]){if(![attrs isEqual:a[@"metadata"][@"xattrs"]]||acl!=[a[@"metadata"][@"acl"] isKindOfClass:NSString.class])refuse(@"directory-metadata-changed");}
      else if(acl||attrs.count)refuse(@"directory-metadata-changed");
    }@finally{close(fd);}
    if(!match)refuse(@"directory-changed");
  }
}
static NSDictionary *namedState(int dir,const char *name) {
  int fd=openRegular(dir,name,O_RDONLY);NSDictionary *result;
  @try {NSDictionary *before=identity(fd);NSData *bytes=readBytes(fd);NSDictionary *meta=attributes(fd);
    NSDictionary *after=identity(fd);struct stat named;if(fstatat(dir,name,&named,AT_SYMLINK_NOFOLLOW)||named.st_ino!=strtoull([after[@"ino"] UTF8String],NULL,10)||named.st_dev!=[after[@"dev"] longLongValue]||![before isEqual:after])refuse(@"file-changed");
    result=@{@"identity":after,@"sha256":digest(bytes),@"attributes":meta};
  }@finally {close(fd);}return result;
}
