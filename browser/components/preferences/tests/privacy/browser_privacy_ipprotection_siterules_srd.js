/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */

// This file tests the Firefox VPN site rules sub-pane. The sub-pane only
// exists in the settings redesign, so this test is registered in
// browser-srd.toml only.

"use strict";

const FEATURE_PREF = "browser.ipProtection.enabled";
const SITE_EXCEPTIONS_FEATURE_PREF =
  "browser.ipProtection.features.siteExceptions";
const SITE_INCLUSIONS_FEATURE_PREF =
  "browser.ipProtection.features.siteInclusions";
const ENTITLEMENT_CACHE_PREF = "browser.ipProtection.entitlementCache";
const IPPROTECTION_CACHE_DISABLED_PREF = "browser.ipProtection.cacheDisabled";
const IPPROTECTION_ADDED_PREF = "browser.ipProtection.added";
const IPPROTECTION_STATE_CACHE_PREF = "browser.ipProtection.stateCache";
const IPP_VPN_PERMISSION = "ipp-vpn";

add_setup(async function ippSiteRulesSetup() {
  await SpecialPowers.pushPrefEnv({
    set: [
      [IPPROTECTION_CACHE_DISABLED_PREF, true],
      [FEATURE_PREF, true],
      [SITE_EXCEPTIONS_FEATURE_PREF, true],
      [SITE_INCLUSIONS_FEATURE_PREF, true],
      [ENTITLEMENT_CACHE_PREF, '{"some":"data"}'],
    ],
  });

  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(IPPROTECTION_ADDED_PREF);
    Services.prefs.clearUserPref(IPPROTECTION_STATE_CACHE_PREF);
    Services.perms.removeByType(IPP_VPN_PERMISSION);
  });
});

function setSiteRule(website, capability) {
  Services.perms.addFromPrincipal(
    Services.scriptSecurityManager.createContentPrincipalFromOrigin(website),
    IPP_VPN_PERMISSION,
    capability
  );
}

function capabilityFor(origin) {
  return Services.perms
    .getAllByTypes([IPP_VPN_PERMISSION])
    .find(perm => perm.principal.origin == origin)?.capability;
}

function storedRules() {
  return Services.perms
    .getAllByTypes([IPP_VPN_PERMISSION])
    .map(perm => perm.principal.origin)
    .sort();
}

/**
 * Opens the site rules sub-pane and runs a task against its list element,
 * starting from a store with no rules in it.
 */
async function withSiteRulesList(task) {
  Services.perms.removeByType(IPP_VPN_PERMISSION);
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: "about:preferences#vpnSiteRules" },
    async function (browser) {
      await task(await getSiteRulesList(browser), browser);
    }
  );
  Services.perms.removeByType(IPP_VPN_PERMISSION);
}

async function getSiteRulesList(browser) {
  let doc = browser.contentDocument;
  let list = await BrowserTestUtils.waitForMutationCondition(
    doc,
    { childList: true, subtree: true },
    () => doc.querySelector("vpn-site-rules-list"),
    { msg: "Site rules list is rendered" }
  );
  await list.updateComplete;
  return list;
}

/**
 * Waits for the list to settle on the expected origins, in render order.
 */
async function awaitRows(list, expectedOrigins) {
  await BrowserTestUtils.waitForMutationCondition(
    list,
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-origin"],
    },
    () => {
      let rows = [...list.querySelectorAll(".vpn-site-rule")];
      return (
        rows.length == expectedOrigins.length &&
        rows.every((row, i) => row.dataset.origin == expectedOrigins[i])
      );
    },
    { msg: `List shows ${JSON.stringify(expectedOrigins)}` }
  );
  await list.updateComplete;
  return [...list.querySelectorAll(".vpn-site-rule")];
}

// Test the site rules section replaces the site exceptions section when the
// site inclusions feature is on.
add_task(async function test_site_rules_replaces_site_exceptions() {
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: "about:preferences#privacy" },
    async function (browser) {
      let settingGroup = browser.contentDocument.querySelector(
        `setting-group[groupid="ipprotection"]`
      );

      is_element_hidden(
        settingGroup?.querySelector("#ipProtectionExceptions"),
        "Site exceptions group is hidden"
      );

      let siteRulesButton = settingGroup?.querySelector(
        "#ipProtectionSiteRules"
      );
      is_element_visible(siteRulesButton, "Site rules button is shown");
      is(
        siteRulesButton.getAttribute("data-l10n-id"),
        "ip-protection-site-rules-button-1",
        "Site rules button uses the site rules string"
      );
    }
  );
});

// Test clicking the site rules button opens the vpnSiteRules sub-pane.
add_task(async function test_site_rules_opens_sub_pane() {
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: "about:preferences#privacy" },
    async function (browser) {
      let doc = browser.contentDocument;
      let win = browser.contentWindow;

      let siteRulesButton = doc.querySelector(
        `setting-group[groupid="ipprotection"] #ipProtectionSiteRules`
      );
      is_element_visible(siteRulesButton, "Site rules button is shown");

      let paneLoaded = waitForPaneChange("vpnSiteRules", win);
      siteRulesButton.scrollIntoView();
      EventUtils.synthesizeMouseAtCenter(siteRulesButton, {}, win);
      await paneLoaded;

      is(doc.location.hash, "#vpnSiteRules", "Hash is the sub-pane");
      is_element_visible(
        doc.querySelector(`setting-pane[data-category="paneVpnSiteRules"]`),
        "Site rules sub-pane is shown"
      );
    }
  );
});

// Test the sub-pane can be linked to directly, e.g. from the VPN panel.
add_task(async function test_site_rules_sub_pane_direct_link() {
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: "about:preferences#privacy-vpnsiterules" },
    async function (browser) {
      let doc = browser.contentDocument;
      let getPane = () =>
        doc.querySelector(`setting-pane[data-category="paneVpnSiteRules"]`);

      await BrowserTestUtils.waitForMutationCondition(
        doc,
        {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["hidden"],
        },
        () => getPane() && !getPane().hidden,
        { msg: "Navigated to the site rules sub-pane" }
      );

      is(
        doc.location.hash,
        "#vpnSiteRules",
        "Legacy hash resolves to sub-pane"
      );
      is_element_visible(getPane(), "Site rules sub-pane is shown");
    }
  );
});

// Test the empty state stands in for the list when no site has a rule.
add_task(async function test_site_rules_list_empty() {
  await withSiteRulesList(async list => {
    is_element_visible(list.emptyStateEl, "Empty state is shown");
    is_element_visible(
      list.emptyIllustrationEl,
      "Empty state has an illustration"
    );
    is_element_visible(list.addButtonEl, "Set rule button is shown");
    ok(!list.listEl, "No rules are listed");
    ok(!list.deleteAllButtonEl, "Delete all rules button is not shown");
  });
});

// Test each stored rule gets a row, sorted by origin and labelled with the
// rule the permission holds.
add_task(async function test_site_rules_list_rows() {
  setSiteRule(
    "https://zebra.example.com",
    Ci.nsIPermissionManager.ALLOW_ACTION
  );
  setSiteRule("https://ant.example.com", Ci.nsIPermissionManager.DENY_ACTION);

  await BrowserTestUtils.withNewTab(
    { gBrowser, url: "about:preferences#vpnSiteRules" },
    async function (browser) {
      let list = await getSiteRulesList(browser);
      let rows = await awaitRows(list, [
        "https://ant.example.com",
        "https://zebra.example.com",
      ]);

      ok(!list.emptyStateEl, "Empty state is not shown");
      is_element_visible(list.deleteAllButtonEl, "Delete all rules is shown");

      is(rows[0].label, "https://ant.example.com", "Row is labelled by origin");
      is(
        rows[0].querySelector("[slot=description]").dataset.l10nId,
        "ip-protection-site-rules-rule-excluded",
        "A DENY rule reads as the VPN being off"
      );
      is(
        rows[1].querySelector("[slot=description]").dataset.l10nId,
        "ip-protection-site-rules-rule-included",
        "An ALLOW rule reads as the VPN being on"
      );

      for (let row of rows) {
        ok(row.querySelector(".vpn-site-rule-edit"), "Row has an edit button");
        ok(
          row.querySelector(".vpn-site-rule-delete"),
          "Row has a delete button"
        );
      }
    }
  );

  Services.perms.removeByType(IPP_VPN_PERMISSION);
});

// Test a rule set elsewhere, e.g. from the VPN panel, reaches an open list.
add_task(async function test_site_rules_list_updates_live() {
  await withSiteRulesList(async list => {
    setSiteRule(
      "https://added.example.com",
      Ci.nsIPermissionManager.ALLOW_ACTION
    );
    await awaitRows(list, ["https://added.example.com"]);
    ok(!list.emptyStateEl, "Empty state is replaced by the new rule");
  });
});

/**
 * Stores two rules, clicks the delete all button, and runs a task once the
 * confirmation dialog is showing.
 */
async function withDeleteAllRulesDialog(task) {
  await withSiteRulesList(async (list, browser) => {
    setSiteRule(
      "https://one.example.com",
      Ci.nsIPermissionManager.ALLOW_ACTION
    );
    setSiteRule("https://two.example.com", Ci.nsIPermissionManager.DENY_ACTION);
    await awaitRows(list, [
      "https://one.example.com",
      "https://two.example.com",
    ]);

    list.deleteAllButtonEl.scrollIntoView();
    EventUtils.synthesizeMouseAtCenter(
      list.deleteAllButtonEl,
      {},
      browser.contentWindow
    );
    await BrowserTestUtils.waitForMutationCondition(
      list.deleteDialogEl,
      { attributes: true, attributeFilter: ["open"] },
      () => list.deleteDialogEl.open,
      { msg: "Delete all confirmation is shown" }
    );

    await task(list, browser);
  });
}

// Test the delete all button asks for confirmation, then clears every rule and
// brings the empty state back.
add_task(async function test_site_rules_list_delete_all() {
  await withDeleteAllRulesDialog(async list => {
    Assert.deepEqual(
      list.ownerDocument.l10n.getAttributes(list.deleteMessageEl),
      { id: "ip-protection-delete-all-site-rules-message", args: null },
      "Message asks to delete all website rules"
    );
    is(
      list.deleteConfirmButtonEl.dataset.l10nId,
      "ip-protection-delete-all-site-rules-confirm",
      "Primary button is labelled Delete all rules"
    );
    is(
      list.deleteConfirmButtonEl.type,
      "primary",
      "Delete all rules is the primary button"
    );
    Assert.deepEqual(
      storedRules(),
      ["https://one.example.com", "https://two.example.com"],
      "Nothing is deleted before the user confirms"
    );

    await clickDeleteDialogButton(list, list.deleteConfirmButtonEl);

    await awaitRows(list, []);
    Assert.deepEqual(storedRules(), [], "Every rule is gone from the store");
    is_element_visible(list.emptyStateEl, "Empty state is shown again");
  });
});

// Test cancelling the delete all confirmation keeps every rule.
add_task(async function test_site_rules_list_delete_all_cancel() {
  await withDeleteAllRulesDialog(async list => {
    await clickDeleteDialogButton(list, list.deleteCancelButtonEl);

    Assert.deepEqual(
      storedRules(),
      ["https://one.example.com", "https://two.example.com"],
      "Cancelling keeps every rule"
    );
    await awaitRows(list, [
      "https://one.example.com",
      "https://two.example.com",
    ]);
  });
});

const SITE_RULE_DIALOG_URL =
  "chrome://browser/content/preferences/dialogs/vpnSiteRule.xhtml";

/**
 * Clicks the list's Set rule button and resolves once its dialog has loaded.
 */
async function openSetRuleDialog(list, browser) {
  let dialogPromise = promiseLoadSubDialog(SITE_RULE_DIALOG_URL);
  list.addButtonEl.scrollIntoView();
  EventUtils.synthesizeMouseAtCenter(
    list.addButtonEl,
    {},
    browser.contentWindow
  );
  return getRuleDialogElements(await dialogPromise);
}

function getRuleDialogElements(dialogWin) {
  let doc = dialogWin.document;
  return {
    dialogWin,
    doc,
    websiteInput: doc.getElementById("vpnSiteRuleWebsite"),
    statusSelect: doc.getElementById("vpnSiteRuleStatus"),
    errorEl: doc.getElementById("vpnSiteRuleError"),
    saveErrorEl: doc.getElementById("vpnSiteRuleSaveError"),
    acceptButton: doc.querySelector("dialog").getButton("accept"),
    cancelButton: doc.querySelector("dialog").getButton("cancel"),
  };
}

function typeWebsite(dialogWin, input, value) {
  input.value = value;
  SpecialPowers.dispatchEvent(
    dialogWin,
    input,
    new dialogWin.InputEvent("input", { data: value, bubbles: true })
  );
}

/**
 * Opens the set rule dialog, runs a task against it, and closes it if the task
 * left it open.
 */
async function withSetRuleDialog(task) {
  await withSiteRulesList(async (list, browser) => {
    let dialog = await openSetRuleDialog(list, browser);
    await task(dialog, list, browser);
    if (browser.contentWindow.gSubDialog._dialogs.length) {
      let closed = BrowserTestUtils.waitForEvent(
        browser.contentWindow.gSubDialog._dialogStack,
        "dialogclose"
      );
      dialog.cancelButton.click();
      await closed;
    }
  });
}

// Test the dialog offers a website field and a VPN status dropdown, and that
// it cannot be accepted until a website has been typed.
add_task(async function test_set_rule_dialog_contents() {
  await withSetRuleDialog(async dialog => {
    let { doc, websiteInput, statusSelect, acceptButton } = dialog;

    is(
      doc.getElementById("vpnSiteRuleIntro").dataset.l10nId,
      "ip-protection-site-rule-intro",
      "Body opens with the instructions"
    );
    is_element_visible(
      doc.getElementById("vpnSiteRuleIntro"),
      "Instructions are shown when setting a rule"
    );
    is(
      websiteInput.dataset.l10nId,
      "ip-protection-site-rule-website-field",
      "Website field is labelled"
    );
    is(
      statusSelect.dataset.l10nId,
      "ip-protection-site-rule-status-field",
      "VPN status field is labelled"
    );

    Assert.deepEqual(
      [...statusSelect.querySelectorAll("moz-option")].map(
        option => option.value
      ),
      ["on", "off"],
      "Status offers always on and always off"
    );
    is(statusSelect.value, "on", "Always on is preselected");
    ok(acceptButton.disabled, "Set is disabled until a website is typed");

    typeWebsite(dialog.dialogWin, websiteInput, "acme.com");
    ok(!acceptButton.disabled, "Typing a website enables Set");

    typeWebsite(dialog.dialogWin, websiteInput, "   ");
    ok(acceptButton.disabled, "A blank website disables Set again");
  });
});

// Test accepting with Always on stores an ALLOW permission for the https
// origin of a scheme-less website, and lists it.
add_task(async function test_set_rule_dialog_saves_inclusion() {
  await withSetRuleDialog(async (dialog, list, browser) => {
    typeWebsite(dialog.dialogWin, dialog.websiteInput, "acme.com");

    let closed = BrowserTestUtils.waitForEvent(
      browser.contentWindow.gSubDialog._dialogStack,
      "dialogclose"
    );
    dialog.acceptButton.click();
    await closed;

    is(
      capabilityFor("https://acme.com"),
      Ci.nsIPermissionManager.ALLOW_ACTION,
      "Always on stores an inclusion for the https origin"
    );
    await awaitRows(list, ["https://acme.com"]);
  });
});

// Test accepting with Always off stores a DENY permission for the https origin.
add_task(async function test_set_rule_dialog_saves_exclusion() {
  await withSetRuleDialog(async (dialog, list, browser) => {
    typeWebsite(dialog.dialogWin, dialog.websiteInput, "acme.com");
    dialog.statusSelect.value = "off";

    let closed = BrowserTestUtils.waitForEvent(
      browser.contentWindow.gSubDialog._dialogStack,
      "dialogclose"
    );
    dialog.acceptButton.click();
    await closed;

    is(
      capabilityFor("https://acme.com"),
      Ci.nsIPermissionManager.DENY_ACTION,
      "Always off stores an exclusion for the https origin"
    );
    await awaitRows(list, ["https://acme.com"]);
  });
});

// Test a pasted https URL is reduced to its origin.
add_task(async function test_set_rule_dialog_accepts_pasted_url() {
  await withSetRuleDialog(async (dialog, list, browser) => {
    typeWebsite(
      dialog.dialogWin,
      dialog.websiteInput,
      "https://acme.com/pricing?plan=pro"
    );

    let closed = BrowserTestUtils.waitForEvent(
      browser.contentWindow.gSubDialog._dialogStack,
      "dialogclose"
    );
    dialog.acceptButton.click();
    await closed;

    await awaitRows(list, ["https://acme.com"]);
  });
});

// Test an http website is converted to its https origin.
add_task(async function test_set_rule_dialog_converts_http_to_https() {
  await withSetRuleDialog(async (dialog, list, browser) => {
    // eslint-disable-next-line sdl/no-insecure-url
    typeWebsite(dialog.dialogWin, dialog.websiteInput, "http://acme.com/page");

    let closed = BrowserTestUtils.waitForEvent(
      browser.contentWindow.gSubDialog._dialogStack,
      "dialogclose"
    );
    dialog.acceptButton.click();
    await closed;

    Assert.deepEqual(
      storedRules(),
      ["https://acme.com"],
      "Only the https origin is stored"
    );
    await awaitRows(list, ["https://acme.com"]);
  });
});

// Test cancelling dismisses the dialog without storing anything.
add_task(async function test_set_rule_dialog_cancel() {
  await withSetRuleDialog(async (dialog, list, browser) => {
    typeWebsite(dialog.dialogWin, dialog.websiteInput, "acme.com");

    let closed = BrowserTestUtils.waitForEvent(
      browser.contentWindow.gSubDialog._dialogStack,
      "dialogclose"
    );
    dialog.cancelButton.click();
    await closed;

    Assert.deepEqual(storedRules(), [], "Cancelling stores no rule");
    is_element_visible(list.emptyStateEl, "List is still empty");
  });
});

// Test an entry that cannot be a website keeps the dialog open and reports it.
add_task(async function test_set_rule_dialog_invalid_website() {
  await withSetRuleDialog(async dialog => {
    let { dialogWin, websiteInput, errorEl, acceptButton } = dialog;

    let submit = value => {
      typeWebsite(dialogWin, websiteInput, value);
      is(
        errorEl.getAttribute("data-l10n-id"),
        null,
        "Typing clears the previous error"
      );
      acceptButton.click();
      return errorEl.getAttribute("data-l10n-id");
    };

    is(
      submit("not a website"),
      "ip-protection-site-rule-invalid-error",
      "A value that is not an address is reported"
    );
    ok(websiteInput.hasAttribute("invalid"), "Website field is marked invalid");
    is(
      websiteInput.inputEl.getAttribute("aria-invalid"),
      "true",
      "Website input is marked aria-invalid"
    );
    ok(
      websiteInput.inputEl.ariaDescribedByElements.includes(errorEl),
      "Website input is described by the error"
    );

    is(
      submit("file:///tmp/index.html"),
      "ip-protection-site-rule-invalid-error",
      "A URL that is neither http nor https is reported"
    );
    is(
      submit("https://*.acme.com"),
      "ip-protection-site-rule-invalid-error",
      "A wildcard host is reported"
    );

    Assert.deepEqual(storedRules(), [], "Nothing was stored");

    typeWebsite(dialogWin, websiteInput, "acme.com");
    ok(
      !websiteInput.hasAttribute("invalid"),
      "Typing clears the invalid state"
    );
    ok(
      !websiteInput.inputEl.hasAttribute("aria-invalid"),
      "Typing clears aria-invalid"
    );
    is(
      websiteInput.inputEl.getAttribute("aria-describedby"),
      "description",
      "Typing restores the input's own description"
    );
  });
});

// Test a website that already has a rule keeps the dialog open and reports it,
// rather than silently replacing the rule.
add_task(async function test_set_rule_dialog_duplicate_website() {
  await withSiteRulesList(async (list, browser) => {
    setSiteRule("https://acme.com", Ci.nsIPermissionManager.ALLOW_ACTION);
    await awaitRows(list, ["https://acme.com"]);

    let dialog = await openSetRuleDialog(list, browser);
    typeWebsite(dialog.dialogWin, dialog.websiteInput, "acme.com");
    dialog.acceptButton.click();

    is(
      dialog.errorEl.getAttribute("data-l10n-id"),
      "ip-protection-site-rule-duplicate-error",
      "A website that already has a rule is reported"
    );
    ok(
      dialog.websiteInput.hasAttribute("invalid"),
      "Website field is marked invalid"
    );

    let closed = BrowserTestUtils.waitForEvent(
      browser.contentWindow.gSubDialog._dialogStack,
      "dialogclose"
    );
    dialog.cancelButton.click();
    await closed;
  });
});

// Test a rule that cannot be written reports a retryable error at the top of
// the dialog and leaves the dialog open.
add_task(async function test_set_rule_dialog_save_error() {
  const { IPPPermissionRules } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/ipprotection/IPPSiteRuleManager.sys.mjs"
  );
  IPPPermissionRules.setRule = () => {
    throw new Error("Cannot save");
  };

  try {
    await withSetRuleDialog(async dialog => {
      ok(dialog.saveErrorEl.hidden, "Dialog opens with no save error");

      typeWebsite(dialog.dialogWin, dialog.websiteInput, "acme.com");
      dialog.acceptButton.click();

      ok(!dialog.saveErrorEl.hidden, "A failed save is reported");
      is(
        dialog.saveErrorEl.getAttribute("type"),
        "error",
        "The report is an error message bar"
      );
      is(
        dialog.saveErrorEl.dataset.l10nId,
        "ip-protection-site-rule-save-error",
        "The report offers to try again"
      );
      is(
        dialog.errorEl.getAttribute("data-l10n-id"),
        null,
        "The website field is not blamed"
      );
      Assert.deepEqual(storedRules(), [], "Nothing was stored");

      typeWebsite(dialog.dialogWin, dialog.websiteInput, "acme.co");
      ok(dialog.saveErrorEl.hidden, "Typing clears the save error");
    });
  } finally {
    delete IPPPermissionRules.setRule;
  }
});

/**
 * Clicks the edit button on the row for an origin and resolves once its dialog
 * has loaded.
 */
async function openEditRuleDialog(list, browser, origin) {
  let row = list.querySelector(`.vpn-site-rule[data-origin="${origin}"]`);
  let editButton = row.querySelector(".vpn-site-rule-edit");
  let dialogPromise = promiseLoadSubDialog(SITE_RULE_DIALOG_URL);
  editButton.scrollIntoView();
  EventUtils.synthesizeMouseAtCenter(editButton, {}, browser.contentWindow);
  return getRuleDialogElements(await dialogPromise);
}

/**
 * Stores a rule, opens the edit dialog for it, runs a task against the dialog,
 * and closes it if the task left it open.
 */
async function withEditRuleDialog(origin, capability, task) {
  await withSiteRulesList(async (list, browser) => {
    setSiteRule(origin, capability);
    await awaitRows(list, [origin]);

    let dialog = await openEditRuleDialog(list, browser, origin);
    await task(dialog, list, browser);
    if (browser.contentWindow.gSubDialog._dialogs.length) {
      let closed = BrowserTestUtils.waitForEvent(
        browser.contentWindow.gSubDialog._dialogStack,
        "dialogclose"
      );
      dialog.cancelButton.click();
      await closed;
    }
  });
}

async function acceptRuleDialog(dialog, browser) {
  let closed = BrowserTestUtils.waitForEvent(
    browser.contentWindow.gSubDialog._dialogStack,
    "dialogclose"
  );
  dialog.acceptButton.click();
  await closed;
}

// Test the edit dialog is titled and labelled for editing, and opens prefilled
// with the rule it was opened for.
add_task(async function test_edit_rule_dialog_prefilled_inclusion() {
  await withEditRuleDialog(
    "https://acme.com",
    Ci.nsIPermissionManager.ALLOW_ACTION,
    async dialog => {
      let { doc, websiteInput, statusSelect, acceptButton } = dialog;

      is(
        doc.documentElement.getAttribute("data-l10n-id"),
        "ip-protection-edit-site-rule-window",
        "Window uses the edit title"
      );
      is(
        doc.querySelector("dialog").getAttribute("data-l10n-id"),
        "ip-protection-edit-site-rule-dialog",
        "Dialog uses the Save button label"
      );
      let [saveMessage] = await doc.l10n.formatMessages([
        "ip-protection-edit-site-rule-dialog",
      ]);
      let saveLabel = saveMessage.attributes.find(
        attr => attr.name == "buttonlabelaccept"
      ).value;
      await BrowserTestUtils.waitForMutationCondition(
        acceptButton,
        { attributes: true, attributeFilter: ["label"] },
        () => acceptButton.label == saveLabel,
        { msg: "Primary button reads Save" }
      );
      is_element_hidden(
        doc.getElementById("vpnSiteRuleIntro"),
        "Intro is hidden when editing"
      );
      is(websiteInput.value, "https://acme.com", "Website is prefilled");
      is(statusSelect.value, "on", "An inclusion prefills Always on");
      ok(!acceptButton.disabled, "Save is enabled straight away");
    }
  );
});

// Test saving without changes keeps the rule as it was, rather than reporting
// the website as a duplicate of itself.
add_task(async function test_edit_rule_dialog_save_unchanged() {
  await withEditRuleDialog(
    "https://acme.com",
    Ci.nsIPermissionManager.ALLOW_ACTION,
    async (dialog, list, browser) => {
      await acceptRuleDialog(dialog, browser);

      Assert.deepEqual(
        storedRules(),
        ["https://acme.com"],
        "The rule is still stored"
      );
      is(
        capabilityFor("https://acme.com"),
        Ci.nsIPermissionManager.ALLOW_ACTION,
        "The rule is unchanged"
      );
    }
  );
});

// Test changing only the VPN status replaces the rule for the same website.
add_task(async function test_edit_rule_dialog_save_status() {
  await withEditRuleDialog(
    "https://acme.com",
    Ci.nsIPermissionManager.ALLOW_ACTION,
    async (dialog, list, browser) => {
      dialog.statusSelect.value = "off";
      await acceptRuleDialog(dialog, browser);

      Assert.deepEqual(
        storedRules(),
        ["https://acme.com"],
        "The website still has one rule"
      );
      is(
        capabilityFor("https://acme.com"),
        Ci.nsIPermissionManager.DENY_ACTION,
        "The rule now turns the VPN off"
      );
      await BrowserTestUtils.waitForMutationCondition(
        list,
        {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-l10n-id"],
        },
        () =>
          list.querySelector(".vpn-site-rule [slot=description]")?.dataset
            .l10nId == "ip-protection-site-rules-rule-excluded",
        { msg: "The row reads as the VPN being off" }
      );
    }
  );
});

// Test changing the website deletes the old website's rule and stores the new
// one with the chosen status.
add_task(async function test_edit_rule_dialog_save_website() {
  await withEditRuleDialog(
    "https://acme.com",
    Ci.nsIPermissionManager.ALLOW_ACTION,
    async (dialog, list, browser) => {
      typeWebsite(dialog.dialogWin, dialog.websiteInput, "example.org");
      dialog.statusSelect.value = "off";
      await acceptRuleDialog(dialog, browser);

      Assert.deepEqual(
        storedRules(),
        ["https://example.org"],
        "The old website's rule is replaced by the new one"
      );
      is(
        capabilityFor("https://example.org"),
        Ci.nsIPermissionManager.DENY_ACTION,
        "The new rule has the chosen status"
      );
      await awaitRows(list, ["https://example.org"]);
    }
  );
});

// Test changing the website to one that already has a rule replaces that rule
// instead of reporting a duplicate.
add_task(async function test_edit_rule_dialog_save_onto_existing_rule() {
  await withSiteRulesList(async (list, browser) => {
    setSiteRule("https://acme.com", Ci.nsIPermissionManager.ALLOW_ACTION);
    setSiteRule("https://example.org", Ci.nsIPermissionManager.ALLOW_ACTION);
    await awaitRows(list, ["https://acme.com", "https://example.org"]);

    let dialog = await openEditRuleDialog(list, browser, "https://acme.com");
    typeWebsite(dialog.dialogWin, dialog.websiteInput, "example.org");
    dialog.statusSelect.value = "off";
    await acceptRuleDialog(dialog, browser);

    Assert.deepEqual(
      storedRules(),
      ["https://example.org"],
      "Only the new website's rule is left"
    );
    is(
      capabilityFor("https://example.org"),
      Ci.nsIPermissionManager.DENY_ACTION,
      "The edited rule replaced the existing one"
    );
  });
});

/**
 * Stores two rules, clicks the delete button on the first, and runs a task
 * once the confirmation dialog is showing.
 */
async function withDeleteRuleDialog(task) {
  await withSiteRulesList(async (list, browser) => {
    setSiteRule(
      "https://kept.example.com",
      Ci.nsIPermissionManager.ALLOW_ACTION
    );
    setSiteRule(
      "https://gone.example.com",
      Ci.nsIPermissionManager.DENY_ACTION
    );
    let rows = await awaitRows(list, [
      "https://gone.example.com",
      "https://kept.example.com",
    ]);

    let deleteButton = rows[0].querySelector(".vpn-site-rule-delete");
    deleteButton.scrollIntoView();
    EventUtils.synthesizeMouseAtCenter(deleteButton, {}, browser.contentWindow);
    await BrowserTestUtils.waitForMutationCondition(
      list.deleteDialogEl,
      { attributes: true, attributeFilter: ["open"] },
      () => list.deleteDialogEl.open,
      { msg: "Delete confirmation is shown" }
    );

    await task(list, browser);
  });
}

/**
 * Clicks a button in the delete confirmation and waits for it to close.
 */
async function clickDeleteDialogButton(list, button) {
  let closed = BrowserTestUtils.waitForEvent(list.deleteDialogEl, "close");
  button.click();
  await closed;
}

// Test the confirmation is a modal dialog that names the website, shows the
// delete icon, and offers Delete and Cancel, without touching any rule.
add_task(async function test_delete_rule_dialog_contents() {
  await withDeleteRuleDialog(async list => {
    let dialog = list.deleteDialogEl;
    ok(dialog.matches(":modal"), "Confirmation is modal");
    is(
      dialog.getAttribute("aria-labelledby"),
      list.deleteMessageEl.id,
      "Dialog is labelled by its message"
    );
    Assert.deepEqual(
      list.ownerDocument.l10n.getAttributes(list.deleteMessageEl),
      {
        id: "ip-protection-delete-site-rule-message",
        args: { website: "https://gone.example.com" },
      },
      "Message names the website whose rule is deleted"
    );
    is(
      dialog.querySelector(".vpn-site-rules-delete-icon").getAttribute("src"),
      "chrome://global/skin/icons/delete.svg",
      "Dialog shows the delete icon"
    );
    is(
      list.deleteConfirmButtonEl.type,
      "primary",
      "Delete is the primary button"
    );
    is(
      list.deleteConfirmButtonEl.dataset.l10nId,
      "ip-protection-delete-site-rule-confirm",
      "Primary button is labelled Delete"
    );
    is(
      list.deleteCancelButtonEl.dataset.l10nId,
      "ip-protection-delete-site-rule-cancel",
      "Secondary button is labelled Cancel"
    );
    Assert.deepEqual(
      storedRules(),
      ["https://gone.example.com", "https://kept.example.com"],
      "Nothing is deleted before the user confirms"
    );

    await clickDeleteDialogButton(list, list.deleteCancelButtonEl);
  });
});

// Test confirming deletes that site's rule and leaves the other rules alone.
add_task(async function test_delete_rule_dialog_confirm() {
  await withDeleteRuleDialog(async list => {
    await clickDeleteDialogButton(list, list.deleteConfirmButtonEl);

    await awaitRows(list, ["https://kept.example.com"]);
    Assert.deepEqual(
      storedRules(),
      ["https://kept.example.com"],
      "Only the deleted site's permission is gone"
    );
  });
});
