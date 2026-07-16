import { books1to25 } from "./books-1-25.js";
import { books26to50 } from "./books-26-50.js";
import { books51to75 } from "./books-51-75.js";
import { books76to100 } from "./books-76-100.js";

export const SHELVES = [
  "Ancient Wisdom",
  "Eastern Paths",
  "Stoic Clarity",
  "Modern Meaning",
  "Quiet Living",
  "Inner Work",
  "Nature & Presence",
  "Purpose & Craft",
  "Love & Belonging",
  "Death & Wonder",
];

export const books = [
  ...books1to25,
  ...books26to50,
  ...books51to75,
  ...books76to100,
].sort((a, b) => a.number - b.number);

export default books;
