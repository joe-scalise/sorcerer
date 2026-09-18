package com.aetherci.sorcerer.remote

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel

sealed interface PairingOperationState {
  data object Idle : PairingOperationState
  data class Running(val request: PairingRequest) : PairingOperationState
  data class Completed(val request: PairingRequest, val result: PairingResult) : PairingOperationState
}

class PairingViewModel : ViewModel() {
  private val pairingClient = PairingClient()
  private val mutableState = MutableLiveData<PairingOperationState>(PairingOperationState.Idle)
  val state: LiveData<PairingOperationState> = mutableState

  fun start(request: PairingRequest, deviceName: String, hasLocalNetworkPermission: Boolean) {
    if (mutableState.value is PairingOperationState.Running) return
    mutableState.value = PairingOperationState.Running(request)
    pairingClient.pair(request, deviceName, hasLocalNetworkPermission) { result ->
      if (mutableState.value is PairingOperationState.Running) {
        mutableState.value = PairingOperationState.Completed(request, result)
      }
    }
  }

  fun reset() {
    mutableState.value = PairingOperationState.Idle
  }

  override fun onCleared() {
    pairingClient.close()
  }
}
