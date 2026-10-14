/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.listentopage.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import mozilla.components.compose.base.theme.AcornTheme
import mozilla.components.feature.listentopage.ArticleProgress
import mozilla.components.feature.listentopage.ListenError
import mozilla.components.feature.listentopage.PlaybackPhase
import mozilla.components.feature.listentopage.PlaybackSpeed
import mozilla.components.feature.listentopage.R
import mozilla.components.feature.listentopage.VoiceState
import mozilla.components.support.test.robolectric.testContext
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ListenSheetTest {

    @get:Rule val composeTestRule = createComposeRule()

    private val forward = testContext.getString(R.string.mozac_feature_listentopage_forward_30_sec)
    private val rewind = testContext.getString(R.string.mozac_feature_listentopage_back_10_sec)
    private val pause = testContext.getString(R.string.mozac_feature_listentopage_pause)
    private val play = testContext.getString(R.string.mozac_feature_listentopage_play)
    private val close = testContext.getString(R.string.mozac_feature_listentopage_close)

    private fun setContent(
        expanded: Boolean,
        onExpandClicked: () -> Unit = {},
        playbackPhase: PlaybackPhase = PlaybackPhase.Playing,
        error: ListenError? = null,
    ) {
        composeTestRule.setContent {
            AcornTheme {
                ListenSheet(
                    article = ArticleDetails(title = TITLE, site = "bbc.co.uk"),
                    articleProgressState = remember { mutableStateOf(ArticleProgress()) },
                    playbackPhase = playbackPhase,
                    speed = PlaybackSpeed.Default,
                    voiceState = VoiceState(),
                    onAction = {},
                    onExpandClicked = onExpandClicked,
                    expanded = expanded,
                    error = error,
                )
            }
        }
    }

    @Test
    fun `WHEN the sheet is expanded THEN the full controls are shown`() {
        setContent(expanded = true)

        composeTestRule.onNodeWithContentDescription(rewind).assertExists()
        composeTestRule.onNodeWithContentDescription(forward).assertExists()
    }

    @Test
    fun `WHEN the sheet is compact THEN only the compact controls are shown`() {
        setContent(expanded = false)

        composeTestRule.onNodeWithContentDescription(rewind).assertExists()
        composeTestRule.onNodeWithContentDescription(forward).assertDoesNotExist()
    }

    @Test
    fun `GIVEN the sheet is compact WHEN the article heading is clicked THEN expanding is requested`() {
        var expandClicked = false
        setContent(expanded = false, onExpandClicked = { expandClicked = true })

        composeTestRule.onNodeWithText(TITLE).performClick()

        assertTrue(expandClicked)
    }

    @Test
    fun `GIVEN playing WHEN shown THEN the playback button has a pause label`() {
        setContent(expanded = false, playbackPhase = PlaybackPhase.Playing)

        composeTestRule.onNodeWithTag(PLAY_PAUSE_BUTTON_TEST_TAG).assert(hasContentDescription(pause))
    }

    @Test
    fun `GIVEN buffering WHEN shown THEN the playback button has a pause label`() {
        setContent(expanded = false, playbackPhase = PlaybackPhase.Buffering)

        composeTestRule.onNodeWithTag(PLAY_PAUSE_BUTTON_TEST_TAG).assert(hasContentDescription(pause))
    }

    @Test
    fun `GIVEN paused WHEN shown THEN the playback button has a play label`() {
        setContent(expanded = false, playbackPhase = PlaybackPhase.Paused)

        composeTestRule.onNodeWithTag(PLAY_PAUSE_BUTTON_TEST_TAG).assert(hasContentDescription(play))
    }

    @Test
    fun `GIVEN an error WHEN shown THEN the error message is shown`() {
        setContent(expanded = false, playbackPhase = PlaybackPhase.Playing, error = ListenError.PlaybackFailed)

        val listenErrorMessage = testContext.getString(ListenError.PlaybackFailed.userFacingMessage)
        composeTestRule.onNodeWithText(listenErrorMessage).assertExists()
        composeTestRule.onNodeWithTag(PLAY_PAUSE_BUTTON_TEST_TAG).assert(hasContentDescription(listenErrorMessage))
    }

    @Test
    fun `GIVEN an error WHEN shown THEN all buttons are disabled except for the close button`() {
        setContent(expanded = true, playbackPhase = PlaybackPhase.Playing, error = ListenError.PlaybackFailed)
        composeTestRule.onNodeWithTag(PLAY_PAUSE_BUTTON_TEST_TAG).assertIsNotEnabled()
        composeTestRule.onNodeWithContentDescription(rewind).assertIsNotEnabled()
        composeTestRule.onNodeWithContentDescription(forward).assertIsNotEnabled()
        composeTestRule.onNodeWithContentDescription(close).assertIsEnabled()
    }

    private companion object {
        const val TITLE = "Match Preview: Wrexham AFC vs Sunderland AFC"
    }
}
