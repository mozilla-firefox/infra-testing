# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from session_store_test_case import SessionStoreTestCase


class TestSessionRestoreWithEncryption(SessionStoreTestCase):
    # Header IOUtils writes in front of encrypted files.
    _encryptedFileMagic = b"mozEnc0\x00"

    def setUp(self):
        super().setUp(startup_page=3, include_private=False)
        self.enableSessionEncryption()

    def enableSessionEncryption(self):
        # SessionStartup locks the available pref at startup so that only its
        # default value is honoured. Unlock it so the values set here take
        # effect for the session data written from this point on.
        self.marionette.execute_script(
            """
            const AVAILABLE = "browser.sessionstore.encryption.available";
            Services.prefs.unlockPref(AVAILABLE);
            Services.prefs.setBoolPref(AVAILABLE, true);
            Services.prefs.setBoolPref(
              "browser.sessionstore.encryption.enabled",
              true
            );
            """
        )

    def test_restore_with_encryption(self):
        """Encrypted session data should be restored after a restart."""
        self.wait_for_windows(
            self.test_windows, "Not all requested windows have been opened"
        )

        profile_path = self.marionette.instance.profile.profile
        self.marionette.quit()

        session_file = os.path.join(profile_path, "sessionstore.jsonlz4")
        with open(session_file, "rb") as f:
            header = f.read(len(self._encryptedFileMagic))
        self.assertEqual(
            header,
            self._encryptedFileMagic,
            "session file written on shutdown should be encrypted",
        )

        self.marionette.start_session()
        self.marionette.set_context("chrome")

        self.wait_for_windows(
            self.test_windows,
            "Windows should be restored from encrypted session data",
        )
