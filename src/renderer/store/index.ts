import { configureStore } from '@reduxjs/toolkit'
import chatReducer from './chatSlice'
import settingsReducer from './settingsSlice'
import statusReducer from './statusSlice'

export const store = configureStore({
  reducer: {
    chat: chatReducer,
    settings: settingsReducer,
    status: statusReducer
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
