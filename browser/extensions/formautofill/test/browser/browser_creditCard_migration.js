/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * The credit card migration seen from the browser: a card saved by the JSON
 * store, copied across, and then used through the paths a card is used by.
 *
 * What the xpcshell tests cannot cover is the number. Each store encrypts under
 * its own key, so the copy decrypts and re-encrypts, and filling a form is the
 * only path that takes the ciphertext the receiving store wrote and asks for
 * the number back through the OS re-authentication the user would see.
 */

const ENABLED_PREF = "extensions.formautofill.creditCards.storage.rust.enabled";
const ACTIVE_PREF = "extensions.formautofill.creditCards.storage.rust.active";

const TEST_FORM = `<form id="form">
  <input id="cc-name" autocomplete="cc-name">
  <input id="cc-number" autocomplete="cc-number">
  <input id="cc-exp-month" autocomplete="cc-exp-month">
  <input id="cc-exp-year" autocomplete="cc-exp-year">
  <input type="submit"/>
</form>`;

const CC_FORM_URL =
  "https://example.org/document-builder.sjs?html=" + TEST_FORM;

const TEST_CARD = {
  "cc-name": "John Doe",
  "cc-number": "4111111111111111",
  "cc-exp-month": 4,
  "cc-exp-year": 2030,
};

// 15 digits, so the mask this store rebuilds on read is wider than the number
// the card was saved with. See MASKED_NUMBER_LENGTH.
const TEST_CARD_AMEX = {
  "cc-name": "Jane Roe",
  "cc-number": "378282246310005",
  "cc-exp-month": 12,
  "cc-exp-year": 2031,
};

// What the form holds once it is filled: the same card, with the month padded
// as autofill writes it.
const EXPECTED_FILL = {
  "cc-name": TEST_CARD["cc-name"],
  "cc-number": TEST_CARD["cc-number"],
  "cc-exp-month": "04",
  "cc-exp-year": String(TEST_CARD["cc-exp-year"]),
};

const EXPECTED_FILL_AMEX = {
  "cc-name": TEST_CARD_AMEX["cc-name"],
  "cc-number": TEST_CARD_AMEX["cc-number"],
  "cc-exp-month": "12",
  "cc-exp-year": String(TEST_CARD_AMEX["cc-exp-year"]),
};

/**
 * Move the profile to the store the pref names and wait for it, the way the
 * pref observer does at runtime.
 *
 * @param {boolean} rust Whether the Rust store should serve afterwards.
 */
async function switchTo(rust) {
  Services.prefs.setBoolPref(ENABLED_PREF, rust);
  await formAutofillStorage._creditCardSwitch;
  Assert.equal(
    Services.prefs.getBoolPref(ACTIVE_PREF, false),
    rust,
    `the profile is served by ${rust ? "Rust" : "JSON"}`
  );
}

/**
 * Fill the credit card form from the autocomplete popup and return what landed
 * in the fields. This is what reads the number back out of the store.
 *
 * @returns {Promise<object>} The filled values, keyed by field id.
 */
async function fillFromStorage(expected = EXPECTED_FILL) {
  let filled;
  await BrowserTestUtils.withNewTab(CC_FORM_URL, async browser => {
    await openPopupOn(browser, "#cc-name");
    await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
    await BrowserTestUtils.synthesizeKey("VK_RETURN", {}, browser);
    await waitForAutofill(browser, "#cc-name", expected["cc-name"]);

    filled = await SpecialPowers.spawn(browser, [], () =>
      Object.fromEntries(
        ["cc-name", "cc-number", "cc-exp-month", "cc-exp-year"].map(id => [
          id,
          content.document.getElementById(id).value,
        ])
      )
    );
  });
  return filled;
}

add_setup(async function () {
  // The number is decrypted for filling, which is where the OS prompt would
  // be. It is a prompt this suite cannot answer, and not what is under test.
  const osAuthWas = FormAutofillUtils.getOSAuthEnabled();
  FormAutofillUtils.setOSAuthEnabled(false);

  // Restored to whatever it was, rather than to what the manifest asks for:
  // the tasks below flip it both ways and the harness checks it afterwards.
  const enabledWas = Services.prefs.getBoolPref(ENABLED_PREF, false);

  await SpecialPowers.pushPrefEnv({
    set: [["extensions.formautofill.creditCards.enabled", true]],
  });

  registerCleanupFunction(async () => {
    FormAutofillUtils.setOSAuthEnabled(osAuthWas);
    await removeAllRecords();
    Services.prefs.setBoolPref(ENABLED_PREF, enabledWas);
    await formAutofillStorage._creditCardSwitch;
  });
});

add_task(async function test_a_migrated_card_fills_a_form() {
  // Saved while JSON is serving, so what fills the form is a card the
  // migration copied rather than one the Rust store was handed directly.
  await switchTo(false);
  await setStorage(TEST_CARD);
  await switchTo(true);

  const [stored] = await getCreditCards();
  Assert.equal(stored["cc-name"], TEST_CARD["cc-name"], "the card came across");
  Assert.ok(
    stored["cc-number"].endsWith("1111"),
    "with the last four digits it was saved with"
  );
  Assert.notEqual(
    stored["cc-number"],
    TEST_CARD["cc-number"],
    "and the number itself is not handed back in the clear"
  );

  Assert.deepEqual(
    await fillFromStorage(),
    EXPECTED_FILL,
    "the number the receiving store re-encrypted decrypts back to the card"
  );

  await removeAllRecords();
});

add_task(async function test_a_migrated_card_derives_its_read_fields() {
  // This store keeps the name, the expiry parts and the last four digits, and
  // derives the rest on read. A migrated card is where that shows: the number
  // it was saved with is gone by the time anything reads it back, so the mask
  // is rebuilt at a fixed width rather than the card's own.
  await switchTo(false);
  await setStorage(TEST_CARD_AMEX);
  await switchTo(true);

  const [stored] = await getCreditCards();
  Assert.equal(
    stored["cc-number"],
    "\u2022".repeat(12) + "0005",
    "the mask is rebuilt at a fixed width, not the 15 digits saved"
  );
  Assert.equal(stored["cc-given-name"], "Jane", "cc-given-name is derived");
  Assert.equal(stored["cc-family-name"], "Roe", "cc-family-name is derived");
  Assert.equal(stored["cc-exp"], "2031-12", "cc-exp is derived");
  Assert.equal(stored["cc-type"], "amex", "cc-type came across the copy");

  Assert.deepEqual(
    await fillFromStorage(EXPECTED_FILL_AMEX),
    EXPECTED_FILL_AMEX,
    "and the number still fills, however the mask was rebuilt"
  );

  await removeAllRecords();
});

add_task(async function test_a_card_captured_after_the_switch_is_saved() {
  // Nothing to copy, so the switch is only the handover: what is under test is
  // that capture writes into the store that took over, and that filling reads
  // back what it wrote.
  await switchTo(false);
  await switchTo(true);

  const onChanged = waitForStorageChangedEvents("add");
  await BrowserTestUtils.withNewTab(CC_FORM_URL, async browser => {
    const onPopupShown = waitForPopupShown();
    await focusUpdateSubmitForm(browser, {
      focusSelector: "#cc-name",
      newValues: {
        "#cc-name": TEST_CARD["cc-name"],
        "#cc-number": TEST_CARD["cc-number"],
        "#cc-exp-month": String(TEST_CARD["cc-exp-month"]),
        "#cc-exp-year": String(TEST_CARD["cc-exp-year"]),
      },
    });
    await onPopupShown;
    await clickDoorhangerButton(MAIN_BUTTON, 0);
  });
  await onChanged;

  const cards = await getCreditCards();
  Assert.equal(cards.length, 1, "the card was saved");
  Assert.deepEqual(
    await fillFromStorage(),
    EXPECTED_FILL,
    "and reads back as the number that was typed"
  );

  await removeAllRecords();
});

add_task(async function test_resubmitting_a_stored_card_updates_it() {
  await switchTo(false);
  await switchTo(true);
  await setStorage(TEST_CARD);
  const [before] = await getCreditCards();

  // Same number, later expiry. Recognising it as the card already stored takes
  // decrypting every stored number, which is the store's own business now, and
  // a store that could not do it would save a second copy instead.
  const onChanged = waitForStorageChangedEvents("update");
  await BrowserTestUtils.withNewTab(CC_FORM_URL, async browser => {
    const onPopupShown = waitForPopupShown();
    await focusUpdateSubmitForm(browser, {
      focusSelector: "#cc-name",
      newValues: {
        "#cc-name": TEST_CARD["cc-name"],
        "#cc-number": TEST_CARD["cc-number"],
        "#cc-exp-month": String(TEST_CARD["cc-exp-month"]),
        "#cc-exp-year": "2031",
      },
    });
    await onPopupShown;
    await clickDoorhangerButton(MAIN_BUTTON, 0);
  });
  await onChanged;

  const cards = await getCreditCards();
  Assert.equal(cards.length, 1, "the stored card was updated, not duplicated");
  Assert.equal(cards[0].guid, before.guid, "keeping its guid");
  Assert.equal(cards[0]["cc-exp-year"], 2031, "with the expiry that was typed");

  await removeAllRecords();
});

add_task(async function test_the_number_survives_a_switch_back() {
  await switchTo(false);
  await setStorage(TEST_CARD);
  await switchTo(true);
  await switchTo(false);

  const cards = await getCreditCards();
  Assert.equal(cards.length, 1, "the card came back to JSON");
  Assert.deepEqual(
    await fillFromStorage(),
    EXPECTED_FILL,
    "with a number the JSON store can read, so the round trip is lossless"
  );

  await removeAllRecords();
});

add_task(async function test_a_declined_os_prompt_aborts_the_fill() {
  await switchTo(false);
  await setStorage(TEST_CARD);
  await switchTo(true);

  // Every other task here runs with OS re-authentication off. This one turns
  // it on and declines it, which is the path that decides whether the number
  // reaches the page at all.
  const { FormAutofillUtils: utils } = ChromeUtils.importESModule(
    "resource://gre/modules/shared/FormAutofillUtils.sys.mjs"
  );
  const realEnabled = utils.getOSAuthEnabled;
  const realVerify = utils.verifyUserOSAuth;
  utils.getOSAuthEnabled = () => true;
  utils.verifyUserOSAuth = async () => false;
  Services.fog.testResetFOG();

  try {
    await BrowserTestUtils.withNewTab(CC_FORM_URL, async browser => {
      await openPopupOn(browser, "#cc-name");
      await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
      await BrowserTestUtils.synthesizeKey("VK_RETURN", {}, browser);
      await TestUtils.waitForCondition(
        () => Glean.formautofill.promptShownOsReauth.testGetValue()?.length,
        "the fill path reports how the prompt ended"
      );
      const filled = await SpecialPowers.spawn(browser, [], () =>
        [...content.document.querySelectorAll("input")].map(i => i.value)
      );
      Assert.ok(
        !filled.some(value => value == TEST_CARD["cc-number"]),
        "the number never reaches the page"
      );
    });
  } finally {
    utils.getOSAuthEnabled = realEnabled;
    utils.verifyUserOSAuth = realVerify;
  }

  const events = Glean.formautofill.promptShownOsReauth.testGetValue() ?? [];
  Assert.equal(
    events.at(-1).extra.trigger,
    "autofill",
    "recorded for the fill"
  );
  Assert.equal(
    events.at(-1).extra.result,
    "fail_user_canceled",
    "as a decline, which is what the user did, not an error"
  );

  await removeAllRecords();
});
