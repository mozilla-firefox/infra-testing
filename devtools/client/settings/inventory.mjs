/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @import { Setting, SettingChangeHandler } from "./types/inventory.d.ts" */

/** @type {ReadonlyArray<Setting>} */
export const inventory = [
  {
    id: "rulers-setting",
    type: "boolean",
    pref: "devtools.command-button-rulers.enabled",
    l10nId: "devtools-settings-toolbox-rulers",
    changeAction: "updateToolboxButtons",
  },
  {
    id: "screenshot-setting",
    type: "boolean",
    pref: "devtools.command-button-screenshot.enabled",
    l10nId: "devtools-settings-toolbox-screenshot",
    changeAction: "updateToolboxButtons",
  },
];

/** @satisfies {Record<string, SettingChangeHandler>} */
export const callbacks = {
  updateToolboxButtons: ({ toolbox }) =>
    toolbox.updateToolboxButtonsVisibility(),
};
