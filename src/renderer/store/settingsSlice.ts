import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { AgentConfig } from '@shared/types'

export interface SettingsState {
  config: AgentConfig | null
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  showSettings: boolean
}

const initialState: SettingsState = {
  config: null,
  theme: 'dark',
  sidebarCollapsed: false,
  showSettings: false
}

const getAPI = (): any => (window as any).agentAPI

export const loadConfig = createAsyncThunk('settings/loadConfig', async () => {
  return await getAPI().getConfig()
})

export const updateConfig = createAsyncThunk(
  'settings/updateConfig',
  async (config: Partial<AgentConfig>) => {
    return await getAPI().setConfig(config)
  }
)

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark'
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed
    },
    setShowSettings: (state, action: PayloadAction<boolean>) => {
      state.showSettings = action.payload
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadConfig.fulfilled, (state, action: PayloadAction<AgentConfig>) => {
        state.config = action.payload
      })
      .addCase(updateConfig.fulfilled, (state, action: PayloadAction<AgentConfig>) => {
        state.config = action.payload
      })
  }
})

export const { toggleTheme, toggleSidebar, setShowSettings } = settingsSlice.actions
export default settingsSlice.reducer
