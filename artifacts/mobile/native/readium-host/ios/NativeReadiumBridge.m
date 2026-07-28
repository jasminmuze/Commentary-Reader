//
//  NativeReadiumBridge.m
//  Objective-C bridge declarations for the Swift module and view manager.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE (NativeReadiumHost, RCTEventEmitter)

RCT_EXTERN_METHOD(submitPreferences:(NSInteger)libraryId
                  settingsJson:(NSString *)settingsJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(goToLocator:(NSInteger)libraryId
                  locatorJson:(NSString *)locatorJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(goToHref:(NSInteger)libraryId
                  href:(NSString *)href
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(applyDecorations:(NSInteger)libraryId
                  group:(NSString *)group
                  decorationsJson:(NSString *)decorationsJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearSelection:(NSInteger)libraryId)

RCT_EXTERN_METHOD(findQuoteLocators:(NSInteger)libraryId
                  requestsJson:(NSString *)requestsJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE (NativeReadiumViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(libraryId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(filePath, NSString)
RCT_EXPORT_VIEW_PROPERTY(locatorJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(settingsJson, NSString)

@end
