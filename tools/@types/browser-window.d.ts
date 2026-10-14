/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Globals that browser.xhtml's scripts define on the browser window. A project
// with modules that run in that window names this file in its tsconfig
// `include`. Objects that a subscript defines declare only the members read
// from a checked module.

declare var AppConstants: typeof import("resource://gre/modules/AppConstants.sys.mjs").AppConstants;
declare var BrowserUIUtils: typeof import("resource:///modules/BrowserUIUtils.sys.mjs").BrowserUIUtils;
declare var BrowserWindowTracker: typeof import("resource:///modules/BrowserWindowTracker.sys.mjs").BrowserWindowTracker;
declare var ContextualIdentityService: typeof import("moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs").ContextualIdentityService;
declare var CustomizableUI: typeof import("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs").CustomizableUI;
declare var NewTabPagePreloading: typeof import("moz-src:///browser/components/tabbrowser/NewTabPagePreloading.sys.mjs").NewTabPagePreloading;
declare var PrivateBrowsingUtils: typeof import("resource://gre/modules/PrivateBrowsingUtils.sys.mjs").PrivateBrowsingUtils;
declare var SessionStore: typeof import("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs").SessionStore;
declare var XPCOMUtils: typeof import("resource://gre/modules/XPCOMUtils.sys.mjs").XPCOMUtils;

// The class and its instance, as a class declaration would provide them.
declare var Tabbrowser: typeof import("moz-src:///browser/components/tabbrowser/Tabbrowser.sys.mjs").Tabbrowser;
type Tabbrowser =
  import("moz-src:///browser/components/tabbrowser/Tabbrowser.sys.mjs").Tabbrowser;

declare var gBrowser: Tabbrowser;
declare var gMultiProcessBrowser: boolean;
declare var RTL_UI: boolean;

declare function isBlankPageURL(aURL: string): boolean;
declare function CreateContainerTabMenu(event: Event): void;

// browser-commands.js
declare var BrowserCommands: {
  openTab(options?: { event?: Event; url?: string }): void;
};

// browser-customtitlebar.js
declare var CustomTitlebar: {
  readonly enabled: boolean;
};

// browser-webrtc.js
declare var gSharedTabWarning: {
  willShowSharedTabWarning(
    tab: import("moz-src:///browser/components/tabbrowser/content/tab.mjs").MozTabbrowserTab
  ): boolean;
};

// browser.js
declare const DynamicShortcutTooltip: {
  nodeToTooltipMap: Record<string, string>;
  cache: Map<string, string>;
  getText(nodeId: string): string;
};

declare const gClickAndHoldListenersOnElement: {
  add(aElm: Element): void;
  remove(aButton: Element): void;
};

declare var FirefoxViewHandler: {
  tab:
    | import("moz-src:///browser/components/tabbrowser/content/tab.mjs").MozTabbrowserTab
    | null;
};
