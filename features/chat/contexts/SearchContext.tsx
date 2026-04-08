import { createContext, useContext } from 'react';

export const SearchContext = createContext<{ term: string }>({ term: '' });
export const useSearchTerm = () => useContext(SearchContext).term;
