import React, { createContext, useContext, useState } from 'react';

interface OptionsTickerContextType {
  optionsTicker: string;
  setOptionsTicker: (ticker: string) => void;
}

const OptionsTickerContext = createContext<OptionsTickerContextType>({
  optionsTicker: '',
  setOptionsTicker: () => {},
});

export const OptionsTickerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [optionsTicker, setOptionsTicker] = useState('');
  return (
    <OptionsTickerContext.Provider value={{ optionsTicker, setOptionsTicker }}>
      {children}
    </OptionsTickerContext.Provider>
  );
};

export const useOptionsTicker = () => useContext(OptionsTickerContext);
