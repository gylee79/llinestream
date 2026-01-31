'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

type LandingPagePreference = 'about' | 'original';

interface LandingPageContextType {
  preference: LandingPagePreference;
  setPreference: (preference: LandingPagePreference) => void;
  togglePreference: () => void;
  isLandingPageLoading: boolean;
}

const LandingPageContext = createContext<LandingPageContextType | undefined>(undefined);

export function LandingPageProvider({ children }: { children: ReactNode }) {
  const [isLandingPageLoading, setIsLoading] = useState(true);
  const [preference, setPreferenceState] = useState<LandingPagePreference>('about'); // Default is 'about'

  useEffect(() => {
    try {
      const storedPreference = localStorage.getItem('landingPagePreference') as LandingPagePreference | null;
      if (storedPreference === 'original') {
        setPreferenceState('original');
      }
    } catch (error) {
      console.error("Could not access localStorage for landing page preference.", error);
    }
    setIsLoading(false);
  }, []);

  const setPreference = useCallback((newPreference: LandingPagePreference) => {
    try {
      localStorage.setItem('landingPagePreference', newPreference);
      setPreferenceState(newPreference);
    } catch (error) {
        console.error("Could not set localStorage for landing page preference.", error);
    }
  }, []);

  const togglePreference = useCallback(() => {
    setPreference(preference === 'about' ? 'original' : 'about');
  }, [preference, setPreference]);

  const value = { preference, setPreference, togglePreference, isLandingPageLoading };

  return (
    <LandingPageContext.Provider value={value}>
      {children}
    </LandingPageContext.Provider>
  );
}

export function useLandingPage() {
  const context = useContext(LandingPageContext);
  if (context === undefined) {
    throw new Error('useLandingPage must be used within a LandingPageProvider');
  }
  return context;
}
