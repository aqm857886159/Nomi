/* eslint-disable react-refresh/only-export-components */
import React from 'react'

const GenerationFlowNodeContext = React.createContext(false)

export function GenerationFlowNodeScope({ children }: { children: React.ReactNode }): JSX.Element {
  return <GenerationFlowNodeContext.Provider value>{children}</GenerationFlowNodeContext.Provider>
}

export function useGenerationFlowNodeManagedDrag(): boolean {
  return React.useContext(GenerationFlowNodeContext)
}
