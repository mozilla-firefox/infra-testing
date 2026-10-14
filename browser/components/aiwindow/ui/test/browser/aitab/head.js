/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  AIWindowAccountAuth:
    "moz-src:///browser/components/aiwindow/ui/modules/AIWindowAccountAuth.sys.mjs",
  AIWindowTestUtils: "resource://testing-common/AIWindowTestUtils.sys.mjs",
  sinon: "resource://testing-common/Sinon.sys.mjs",
});

AIWindowTestUtils.init(this, window);

/**
 * Stubs AIWindowAccountAuth.ensureAIWindowAccess to skip sign-in flow
 * Call the returned restore function to clean up the stub
 *
 * @returns {Function} restore function to clean up the stub
 */
function skipSignIn() {
  const stub = sinon
    .stub(AIWindowAccountAuth, "ensureAIWindowAccess")
    .resolves(true);
  return () => stub.restore();
}

/**
 * Pin a deterministic lastAccessed order. Writes _lastAccessed directly to dodge
 * the getter's Infinity-for-selected-tab (which falls back to Date.now() and ties).
 *
 * @param {MozTabbrowserTab[]} tabsOldestFirst
 */
function pinLastAccessed(tabsOldestFirst) {
  tabsOldestFirst.forEach((tab, index) => {
    tab._lastAccessed = index + 1;
  });
}
