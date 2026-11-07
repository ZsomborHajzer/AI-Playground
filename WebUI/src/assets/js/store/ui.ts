import { acceptHMRUpdate, defineStore } from 'pinia'
import { ref } from 'vue'

export const useUIStore = defineStore('ui', () => {
  // History modal state
  const showHistory = ref(false)

  // Model management overlay. Deliberately not tied to `promptArea.currentMode`:
  // closing it should return the user to exactly the view they were in.
  const showModelManager = ref(false)

  const showMarketplace = ref(false)

  function openMarketplace() {
    showModelManager.value = false
    showMarketplace.value = true
  }

  function closeMarketplace() {
    showMarketplace.value = false
  }

  function openHistory() {
    showHistory.value = true
  }

  function closeHistory() {
    showHistory.value = false
  }

  function openModelManager() {
    showMarketplace.value = false
    showModelManager.value = true
  }

  function closeModelManager() {
    showModelManager.value = false
  }

  return {
    showHistory,
    openHistory,
    closeHistory,
    showModelManager,
    openModelManager,
    closeModelManager,
    showMarketplace,
    openMarketplace,
    closeMarketplace,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUIStore, import.meta.hot))
}
