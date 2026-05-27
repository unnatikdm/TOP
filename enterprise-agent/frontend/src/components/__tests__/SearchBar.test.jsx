import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchBar from '../SearchBar';

// Helper to advance timers
const advanceTimers = (ms) => act(() => jest.advanceTimersByTime(ms));

describe('SearchBar Component', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders input with placeholder', () => {
    render(<SearchBar placeholder="Type something…" />);
    expect(screen.getByPlaceholderText('Type something…')).toBeInTheDocument();
  });

  test('renders default placeholder when none provided', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText('Search across GitHub, Slack, Jira, Sentry…')).toBeInTheDocument();
  });

  test('calls onChange when user types', () => {
    const handleChange = jest.fn();
    render(<SearchBar value="" onChange={handleChange} />);
    const input = screen.getByPlaceholderText('Search across GitHub, Slack, Jira, Sentry…');
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(handleChange).toHaveBeenCalledWith('test query');
  });

  test('shows clear button only when value is non-empty', () => {
    const { rerender } = render(<SearchBar value="" />);
    expect(screen.queryByTitle('Clear search')).not.toBeInTheDocument();

    rerender(<SearchBar value="something" />);
    expect(screen.getByTitle('Clear search')).toBeInTheDocument();
  });

  test('clear button calls onChange with empty string', () => {
    const handleChange = jest.fn();
    render(<SearchBar value="test" onChange={handleChange} />);
    fireEvent.click(screen.getByTitle('Clear search'));
    expect(handleChange).toHaveBeenCalledWith('');
  });

  test('Enter key triggers onSearch immediately', () => {
    const handleSearch = jest.fn();
    render(<SearchBar value="my query" onSearch={handleSearch} />);
    const input = screen.getByPlaceholderText('Search across GitHub, Slack, Jira, Sentry…');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleSearch).toHaveBeenCalledWith('my query');
  });

  test('debounces onSearch after typing (200ms default)', () => {
    const handleSearch = jest.fn();
    const handleChange = jest.fn();
    render(
      <SearchBar value="" onChange={handleChange} onSearch={handleSearch} debounceMs={200} />
    );
    const input = screen.getByPlaceholderText('Search across GitHub, Slack, Jira, Sentry…');

    // Type "abc" — should debounce
    fireEvent.change(input, { target: { value: 'abc' } });

    // Not called yet (only 100ms)
    advanceTimers(100);
    expect(handleSearch).not.toHaveBeenCalled();

    // Called after 200ms total
    advanceTimers(100);
    expect(handleSearch).toHaveBeenCalledWith('abc');
  });

  test('Search button is disabled when loading', () => {
    render(<SearchBar value="query" loading={true} />);
    expect(screen.getByText('Searching…')).toBeDisabled();
  });

  test('Search button is disabled when value is empty', () => {
    render(<SearchBar value="" />);
    expect(screen.getByText('Search')).toBeDisabled();
  });

  test('renders suggestion chips', () => {
    const suggestions = [
      { label: 'Chip 1', value: 'val1' },
      { label: 'Chip 2', value: 'val2' }
    ];
    render(<SearchBar suggestions={suggestions} />);
    expect(screen.getByText('Chip 1')).toBeInTheDocument();
    expect(screen.getByText('Chip 2')).toBeInTheDocument();
    expect(screen.getByText('Try:')).toBeInTheDocument();
  });

  test('clicking suggestion chip triggers callbacks', () => {
    const handleChange = jest.fn();
    const handleSuggestion = jest.fn();
    const suggestions = [{ label: 'PostgreSQL pool', value: 'pg pool' }];
    render(
      <SearchBar
        suggestions={suggestions}
        onChange={handleChange}
        onSuggestionClick={handleSuggestion}
      />
    );
    fireEvent.click(screen.getByText('PostgreSQL pool'));
    expect(handleChange).toHaveBeenCalledWith('pg pool');
    expect(handleSuggestion).toHaveBeenCalledWith('pg pool');
  });

  test('loading state shows spinner text', () => {
    render(<SearchBar value="test" loading={true} />);
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });
});
