package com.aetherci.sorcerer.remote

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PairActivityDeepLinkTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

  @After
  fun tearDown() {
    SecureConnectionStore(context).clear()
  }

  @Test
  fun coldStartDeepLinkIsDecodedAndRequiresConfirmation() {
    val intent = Intent(
      Intent.ACTION_VIEW,
      Uri.parse(
        "sorcerer-remote://pair?scheme=https&host=desktop.example.com&port=443&code=ABCDEF12&v=1",
      ),
      context,
      PairActivity::class.java,
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    ActivityScenario.launch<PairActivity>(intent).use {
      onView(withId(R.id.host_input)).check(matches(withText("desktop.example.com")))
      onView(withId(R.id.port_input)).check(matches(withText("443")))
      onView(withText(R.string.pair_confirmation_title)).check(matches(isDisplayed()))
      it.recreate()
      onView(withText(R.string.pair_confirmation_title)).check(matches(isDisplayed()))
    }
  }
}
