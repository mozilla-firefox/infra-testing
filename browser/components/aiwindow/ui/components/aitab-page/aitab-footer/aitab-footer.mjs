/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

/**
 * "Made with Smart Window" credit at the bottom of a generated AI Tab page.
 */
export class AITabFooter extends MozLitElement {
  render() {
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/aiwindow/components/aitab-base.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/aiwindow/components/aitab-footer.css"
      />
      <footer class="aitab-footer">
        <p class="aitab-made-with" data-l10n-id="aitab-page-made-with">
          <span class="aitab-made-with-brand" data-l10n-name="brand"></span>
        </p>
      </footer>
    `;
  }
}

customElements.define("aitab-footer", AITabFooter);
