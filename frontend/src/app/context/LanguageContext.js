"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import en from "../translations/en";
import hi from "../translations/hi";
import mr from "../translations/mr";

// Gujarati (gu) is still missing a translation file; a trader whose
// language_pref is "gu" falls back to English until one lands here.
const translations = { en, hi, mr };

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Load preferred language from localStorage on mount
    const savedLang = localStorage.getItem("preferred_language");
    // Validate against what actually ships rather than a hardcoded pair, so
    // adding a translation file is the only step needed to enable a language.
    if (savedLang && Object.keys(translations).includes(savedLang)) {
      setLang(savedLang);
    }
    setMounted(true);
  }, []);

  const changeLanguage = (newLang) => {
    setLang(newLang);
    localStorage.setItem("preferred_language", newLang);
  };

  const t = (key) => {
    if (!translations[lang] || !translations[lang][key]) {
      // Fallback to english, then just the key if missing
      return translations["en"][key] || key;
    }
    return translations[lang][key];
  };

  if (!mounted) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>; // Prevent hydration mismatch
  }

  return (
    <LanguageContext.Provider value={{ lang, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
