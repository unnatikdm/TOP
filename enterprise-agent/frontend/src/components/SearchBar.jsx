import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

/**
 * SearchBar — Premium glass-morphism search input with 200ms debounce.
 * 
 * Props:
 *   value        — controlled input value
 *   onChange      — callback(newValue)
 *   onSearch      — callback(query) triggered on Enter or debounce
 *   loading       — boolean, shows spinner when true
 *   placeholder   — input placeholder text
 *   suggestions   — optional array of {label, value} quick-search chips
 *   onSuggestionClick — callback(value) when a suggestion chip is clicked
 *   debounceMs    — debounce delay in ms (default 200)
 */
export default function SearchBar({
  value = '',
  onChange,
  onSearch,
  loading = false,
  placeholder = 'Search across GitHub, Slack, Jira, Sentry…',
  suggestions = [],
  onSuggestionClick,
  debounceMs = 200
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounced search — fires after user stops typing for debounceMs
  const debouncedSearch = useCallback((q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Only auto-trigger on long-enough queries (min 3 chars)
      if (q.trim().length >= 3 && onSearch) {
        onSearch(q.trim());
      }
    }, debounceMs);
  }, [debounceMs, onSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (e) => {
    const newVal = e.target.value;
    if (onChange) onChange(newVal);
    debouncedSearch(newVal);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (onSearch && value.trim()) onSearch(value.trim());
    }
  };

  const handleClear = () => {
    if (onChange) onChange('');
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <div className="searchbar-container">
      <div className={`searchbar-glass ${focused ? 'searchbar-focused' : ''} ${loading ? 'searchbar-loading' : ''}`}>
        <div className="searchbar-icon-left">
          {loading ? (
            <Loader2 size={20} className="searchbar-spinner" />
          ) : (
            <Search size={20} />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="searchbar-input"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
        {value && (
          <button className="searchbar-clear" onClick={handleClear} title="Clear search">
            <X size={16} />
          </button>
        )}
        <button
          className="searchbar-submit"
          onClick={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (onSearch && value.trim()) onSearch(value.trim());
          }}
          disabled={loading || !value.trim()}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="searchbar-suggestions">
          <span className="searchbar-suggestions-label">Try:</span>
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="searchbar-chip"
              onClick={() => {
                if (onChange) onChange(s.value);
                if (onSuggestionClick) onSuggestionClick(s.value);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
