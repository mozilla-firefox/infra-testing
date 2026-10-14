/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsDeviceContextSpecX.h"

#import <Cocoa/Cocoa.h>
#include <CoreFoundation/CoreFoundation.h>
#include <unistd.h>
#include "mozilla/gfx/PrintPromise.h"

#include "mozilla/Logging.h"
#include "mozilla/Preferences.h"
#include "mozilla/RefPtr.h"
#include "mozilla/ScopeExit.h"
#include "mozilla/StaticPrefs_print.h"
#include "mozilla/gfx/PrintTargetCG.h"
#include "mozilla/gfx/PrintTargetSkPDF.h"
#include "mozilla/glean/PrintingMetrics.h"

#include "AppleUtils.h"
#include "nsCRT.h"
#include "nsCUPSShim.h"
#include "nsCocoaUtils.h"
#include "nsComponentManagerUtils.h"
#include "nsDirectoryServiceDefs.h"
#include "nsIFileStreams.h"
#include "nsILocalFileMac.h"
#include "nsIOutputStream.h"
#include "nsPaper.h"
#include "nsPrintSettingsX.h"
#include "nsPrinterListCUPS.h"
#include "nsQueryObject.h"
#include "prenv.h"

// This must be the last include:
#include "nsObjCExceptions.h"

using namespace mozilla;
using mozilla::gfx::IntSize;
using mozilla::gfx::PrintEndDocumentPromise;
using mozilla::gfx::PrintTarget;
using mozilla::gfx::PrintTargetCG;
using mozilla::gfx::PrintTargetSkPDF;

//----------------------------------------------------------------------
// nsDeviceContentSpecX

static bool IsPDFFileURL(CFURLRef aURL) {
  AutoCFTypeRef<CFStringRef> pathRef(
      CFURLCopyFileSystemPath(aURL, kCFURLPOSIXPathStyle));
  NSString* path = (NSString*)CFStringRef(pathRef);
  return [[path pathExtension] isEqualToString:@"pdf"];
}

nsDeviceContextSpecX::nsDeviceContextSpecX() = default;

nsDeviceContextSpecX::~nsDeviceContextSpecX() {
  NS_OBJC_BEGIN_TRY_IGNORE_BLOCK;

  if (mPrintSession) {
    ::PMRelease(mPrintSession);
  }
  if (mPageFormat) {
    ::PMRelease(mPageFormat);
  }
  if (mPMPrintSettings) {
    ::PMRelease(mPMPrintSettings);
  }

  NS_OBJC_END_TRY_IGNORE_BLOCK;
}

NS_IMPL_ISUPPORTS(nsDeviceContextSpecX, nsIDeviceContextSpec)

NS_IMETHODIMP nsDeviceContextSpecX::Init(nsIPrintSettings* aPS,
                                         bool aIsPrintPreview) {
  NS_OBJC_BEGIN_TRY_BLOCK_RETURN;

  RefPtr<nsPrintSettingsX> settings(do_QueryObject(aPS));
  if (!settings) {
    return NS_ERROR_NO_INTERFACE;
  }
  // Note: unlike other platforms, we don't set our base class's mPrintSettings
  // here since we don't need it currently (we do set mPMPrintSettings below).

  NSPrintInfo* printInfo = settings->CreateOrCopyPrintInfo();
  if (!printInfo) {
    return NS_ERROR_FAILURE;
  }
  if (aPS->GetOutputDestination() ==
      nsIPrintSettings::kOutputDestinationStream) {
    aPS->GetOutputStream(getter_AddRefs(mOutputStream));
    if (!mOutputStream) {
      return NS_ERROR_FAILURE;
    }
  }
  mPrintSession = static_cast<PMPrintSession>([printInfo PMPrintSession]);
  mPageFormat = static_cast<PMPageFormat>([printInfo PMPageFormat]);
  mPMPrintSettings = static_cast<PMPrintSettings>([printInfo PMPrintSettings]);
  MOZ_ASSERT(mPrintSession && mPageFormat && mPMPrintSettings);
  ::PMRetain(mPrintSession);
  ::PMRetain(mPageFormat);
  ::PMRetain(mPMPrintSettings);
  [printInfo release];

  if (mOutputStream || StaticPrefs::print_skpdf_all_destinations()) {
    mPrintViaSkPDF = true;
  } else {
    // Annoyingly, PMPrinterPrintWithFile does not pay attention to the
    // kPMDestination* value set in the PMPrintSession; it always sends the
    // PDF to the specified printer.  This means that if we create the PDF
    // using SkPDF then we need to manually handle user actions like "Open PDF
    // in Preview" and "Save as PDF...".
    // TODO: Currently we do not support using SkPDF for kPMDestinationFax or
    // kPMDestinationProcessPDF ("Add PDF to iBooks, etc.), and we only
    // support it for kPMDestinationFile if the destination file is a PDF.
    // XXX Could PMWorkflowSubmitPDFWithSettings/PMPrinterPrintWithProvider
    // help?
    OSStatus status = noErr;
    PMDestinationType destination;
    status = ::PMSessionGetDestinationType(mPrintSession, mPMPrintSettings,
                                           &destination);
    if (status == noErr) {
      if (destination == kPMDestinationPrinter ||
          destination == kPMDestinationPreview) {
        mPrintViaSkPDF = true;
      } else if (destination == kPMDestinationFile) {
        AutoCFTypeRef<CFURLRef> destURL(nullptr);
        status = ::PMSessionCopyDestinationLocation(
            mPrintSession, mPMPrintSettings, destURL.Receive());
        if (status == noErr && IsPDFFileURL(destURL)) {
          mPrintViaSkPDF = true;
        }
      }
    }
  }

  int16_t outputFormat = aPS->GetOutputFormat();

  if (outputFormat == nsIPrintSettings::kOutputFormatPDF) {
    // We don't actually currently support/use kOutputFormatPDF on mac, but
    // this is for completeness in case we add that (we probably need to in
    // order to support adding links into saved PDFs, for example).
    glean::printing::target_type
        .EnumGet(glean::printing::TargetTypeLabel::ePdfFile)
        .Add(1);
  } else {
    PMDestinationType destination;
    OSStatus status = ::PMSessionGetDestinationType(
        mPrintSession, mPMPrintSettings, &destination);
    if (status == noErr && (destination == kPMDestinationFile ||
                            destination == kPMDestinationPreview ||
                            destination == kPMDestinationProcessPDF)) {
      glean::printing::target_type
          .EnumGet(glean::printing::TargetTypeLabel::ePdfFile)
          .Add(1);
    } else {
      glean::printing::target_type
          .EnumGet(glean::printing::TargetTypeLabel::eUnknown)
          .Add(1);
    }
  }

  return NS_OK;

  NS_OBJC_END_TRY_BLOCK_RETURN(NS_ERROR_FAILURE);
}

NS_IMETHODIMP nsDeviceContextSpecX::BeginDocument(
    const nsAString& aTitle, const nsAString& aPrintToFileName,
    mozilla::dom::WindowContext*, int32_t aStartPage, int32_t aEndPage) {
  NS_OBJC_BEGIN_TRY_BLOCK_RETURN;

  nsAutoString adjustedTitle;
  PrintTarget::AdjustPrintJobNameForIPP(aTitle, adjustedTitle);
  if (!adjustedTitle.IsEmpty()) {
    AutoCFTypeRef<CFStringRef> jobName(::CFStringCreateWithCharacters(
        nullptr, reinterpret_cast<const UniChar*>(adjustedTitle.BeginReading()),
        adjustedTitle.Length()));
    if (jobName) {
      ::PMPrintSettingsSetJobName(mPMPrintSettings, jobName);
    }
  }
  return NS_OK;

  NS_OBJC_END_TRY_BLOCK_RETURN(NS_ERROR_FAILURE);
}

RefPtr<PrintEndDocumentPromise> nsDeviceContextSpecX::EndDocument() {
  return nsIDeviceContextSpec::EndDocumentPromiseFromResult(DoEndDocument(),
                                                            __func__);
}

nsresult nsDeviceContextSpecX::DoEndDocument() {
  NS_OBJC_BEGIN_TRY_BLOCK_RETURN;

  if (!mPrintViaSkPDF) {
    // PrintTargetCG deals with it.
    return NS_OK;
  }
  if (mOutputStream) {
    // Nothing to do. PrintTargetSkPDF will flush the stream.
    return NS_OK;
  }

  nsCOMPtr<nsILocalFileMac> tmpPDFFile = do_QueryInterface(mTempFile);
  if (!tmpPDFFile) {
    return NS_ERROR_FAILURE;
  }
  AutoCFTypeRef<CFURLRef> pdfURL(nullptr);
  // Note that the caller is responsible to release pdfURL according to
  // nsILocalFileMac.idl, even though we didn't follow the Core Foundation
  // naming conventions here (the method should've been called CopyCFURL).
  MOZ_TRY(tmpPDFFile->GetCFURL(pdfURL.Receive()));

  PMDestinationType destination;
  if (::PMSessionGetDestinationType(mPrintSession, mPMPrintSettings,
                                    &destination) != noErr) {
    return NS_ERROR_FAILURE;
  }

  OSStatus status = noErr;
  switch (destination) {
    case kPMDestinationPrinter: {
      PMPrinter currentPrinter = nullptr;
      status = ::PMSessionGetCurrentPrinter(mPrintSession, &currentPrinter);
      if (status != noErr) {
        return NS_ERROR_FAILURE;
      }
      CFStringRef mimeType = CFSTR("application/pdf");
      status = ::PMPrinterPrintWithFile(currentPrinter, mPMPrintSettings,
                                        mPageFormat, mimeType, pdfURL);
      break;
    }
    case kPMDestinationPreview: {
      // XXXjwatt Or should we use CocoaFileUtils::RevealFileInFinder(pdfURL);
      AutoCFTypeRef<CFStringRef> pdfPath(
          CFURLCopyFileSystemPath(pdfURL, kCFURLPOSIXPathStyle));
      NSString* path = (NSString*)CFStringRef(pdfPath);
      [NSWorkspace.sharedWorkspace openFile:path];
      break;
    }
    case kPMDestinationFile: {
      AutoCFTypeRef<CFURLRef> destURL(nullptr);
      status = ::PMSessionCopyDestinationLocation(
          mPrintSession, mPMPrintSettings, destURL.Receive());
      if (status != noErr) {
        return NS_ERROR_FAILURE;
      }
      if (!IsPDFFileURL(destURL)) {
        // E.g. "Save as PostScript...".
        return PrintPDFViaPrintSession(pdfURL);
      }
      AutoCFTypeRef<CFStringRef> sourcePathRef(
          CFURLCopyFileSystemPath(pdfURL, kCFURLPOSIXPathStyle));
      NSString* sourcePath = (NSString*)CFStringRef(sourcePathRef);
      NSFileManager* fileManager = [NSFileManager defaultManager];
      if ([fileManager fileExistsAtPath:sourcePath]) {
        NSURL* src = static_cast<NSURL*>(CFURLRef(pdfURL));
        NSURL* dest = static_cast<NSURL*>(CFURLRef(destURL));
        bool ok = [fileManager
            replaceItemAtURL:dest
               withItemAtURL:src
              backupItemName:nil
                     options:NSFileManagerItemReplacementUsingNewMetadataOnly
            resultingItemURL:nil
                       error:nil];
        if (!ok) {
          return NS_ERROR_FAILURE;
        }
      }
      break;
    }
    case kPMDestinationProcessPDF: {
      // PDF Services, like "Open in Books" or "Mail PDF". The destination
      // location is the workflow item.
      AutoCFTypeRef<CFURLRef> workflowURL(nullptr);
      status = ::PMSessionCopyDestinationLocation(
          mPrintSession, mPMPrintSettings, workflowURL.Receive());
      if (status != noErr || !workflowURL) {
        return NS_ERROR_FAILURE;
      }
      status = ::PMWorkflowSubmitPDFWithSettings(workflowURL, mPMPrintSettings,
                                                 pdfURL);
      break;
    }
    case kPMDestinationFax:
    default:
      return PrintPDFViaPrintSession(pdfURL);
  }

  return (status == noErr) ? NS_OK : NS_ERROR_FAILURE;

  NS_OBJC_END_TRY_BLOCK_RETURN(NS_ERROR_FAILURE);
}

nsresult nsDeviceContextSpecX::PrintPDFViaPrintSession(CFURLRef aPDFURL) {
  NS_OBJC_BEGIN_TRY_BLOCK_RETURN;

  AutoCFTypeRef<CGPDFDocumentRef> doc(CGPDFDocumentCreateWithURL(aPDFURL));
  if (!doc) {
    return NS_ERROR_FAILURE;
  }

  const size_t pageCount = CGPDFDocumentGetNumberOfPages(doc);
  ::PMSetFirstPage(mPMPrintSettings, 1, false);
  ::PMSetLastPage(mPMPrintSettings, UInt32(pageCount), false);

  if (::PMSessionBeginCGDocumentNoDialog(mPrintSession, mPMPrintSettings,
                                         mPageFormat) != noErr) {
    return NS_ERROR_ABORT;
  }

  auto endDocument =
      MakeScopeExit([&] { ::PMSessionEndDocumentNoDialog(mPrintSession); });

  for (size_t i = 1; i <= pageCount; ++i) {
    CGPDFPageRef page = CGPDFDocumentGetPage(doc, i);
    if (!page) {
      return NS_ERROR_FAILURE;
    }
    const CGRect mediaBox = CGPDFPageGetBoxRect(page, kCGPDFMediaBox);
    // Core Printing ignores per-page sheet sizes, so like PrintTargetCG we can
    // only switch orientation.
    if (StaticPrefs::
            print_save_as_pdf_use_page_rule_size_as_paper_size_enabled()) {
      ::PMSetOrientation(mPageFormat,
                         mediaBox.size.width < mediaBox.size.height
                             ? kPMPortrait
                             : kPMLandscape,
                         kPMUnlocked);
    }
    if (::PMSessionBeginPageNoDialog(mPrintSession, mPageFormat, nullptr) !=
        noErr) {
      return NS_ERROR_ABORT;
    }
    CGContextRef context = nullptr;
    ::PMSessionGetCGGraphicsContext(mPrintSession, &context);
    if (context) {
      CGContextDrawPDFPage(context, page);
    }
    if (::PMSessionEndPageNoDialog(mPrintSession) != noErr || !context) {
      return NS_ERROR_FAILURE;
    }
  }

  return NS_OK;

  NS_OBJC_END_TRY_BLOCK_RETURN(NS_ERROR_FAILURE);
}

void nsDeviceContextSpecX::GetPaperRect(double* aTop, double* aLeft,
                                        double* aBottom, double* aRight) {
  NS_OBJC_BEGIN_TRY_IGNORE_BLOCK;

  PMRect paperRect;
  ::PMGetAdjustedPaperRect(mPageFormat, &paperRect);

  *aTop = paperRect.top;
  *aLeft = paperRect.left;
  *aBottom = paperRect.bottom;
  *aRight = paperRect.right;

  NS_OBJC_END_TRY_IGNORE_BLOCK;
}

already_AddRefed<PrintTarget> nsDeviceContextSpecX::MakePrintTarget() {
  double top, left, bottom, right;
  GetPaperRect(&top, &left, &bottom, &right);
  const double width = right - left;
  const double height = bottom - top;
  IntSize size = IntSize::Ceil(width, height);
  if (!mPrintViaSkPDF) {
    return PrintTargetCG::CreateOrNull(mOutputStream, mPrintSession,
                                       mPageFormat, mPMPrintSettings, size);
  }
  auto stream = [&]() -> nsCOMPtr<nsIOutputStream> {
    if (mOutputStream) {
      return mOutputStream;
    }
    nsresult rv =
        NS_GetSpecialDirectory(NS_OS_TEMP_DIR, getter_AddRefs(mTempFile));
    NS_ENSURE_SUCCESS(rv, nullptr);
    // FIXME(emilio): We don't seem to remove this file anywhere, and also it
    // seems its name could collide, should we use a UUID or something, if we
    // need it to be named?
    nsAutoCString tempPath("tmp-printing.pdf");
    mTempFile->AppendNative(tempPath);
    rv = mTempFile->CreateUnique(nsIFile::NORMAL_FILE_TYPE, 0600);
    NS_ENSURE_SUCCESS(rv, nullptr);

    nsCOMPtr<nsIFileOutputStream> stream =
        do_CreateInstance("@mozilla.org/network/file-output-stream;1");
    if (NS_FAILED(stream->Init(mTempFile, -1, -1, 0))) {
      return nullptr;
    }
    return stream;
  }();
  return PrintTargetSkPDF::CreateOrNull(stream, size);
}
