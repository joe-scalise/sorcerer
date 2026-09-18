package com.aetherci.sorcerer.remote

import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityLifecycleTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

  @Before
  fun setUp() {
    SecureConnectionStore(context).clear()
  }

  @After
  fun tearDown() {
    SecureConnectionStore(context).clear()
  }

  @Test
  fun missingConnectionStateSurvivesActivityRecreation() {
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      onView(withText(R.string.connection_required_title)).check(matches(isDisplayed()))
      scenario.recreate()
      onView(withText(R.string.connection_required_title)).check(matches(isDisplayed()))
    }
  }
}
