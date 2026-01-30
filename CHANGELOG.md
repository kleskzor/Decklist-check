# Changelog

## [Unreleased]

### Features

#### Core Architecture
- **Script Consolidation**: Centralized all application logic into `scripts/main.js`.
- **State Persistence**: Implemented `localStorage` integration (`mtg_decklist_data`) to automatically save player data and verification progress.
- **Smart Image Caching**: Added `IndexedDB` support (`MTGImageCache`) to store card images locally.
  - Reduces Scryfall API calls to prevent rate limiting.
  - Includes fallback logic for CORS errors or API failures.

#### Decklist Operations
- **Verification Flow**:
  - Cards can be checked off individually or via "Check All".
  - Checked cards are visually dimmed and automatically sorted to the bottom of the list.
  - Added progress counters (Total, Verified, Remaining).
- **Edit Mode**:
  - Toggleable interface for modifying card counts.
  - Ability to add new cards dynamically using the search bar.
  - "Reset" functionality to restore deck to its original state.
- **Deck Import**:
  - Added support for importing decks directly from **Moxfield** URLs.
  - Automatically parses Commanders, Companions, Mainboard, and Sideboard.
- **Advanced Validation**:
  - **Card Count Check**: Enforces 100 cards (or 101 with Companion).
  - **Scryfall Verification**: Validates card names against Scryfall API with local caching (`MTGCardDB`).
  - **Intelligent Resolution**:
    - Auto-retry logic for split cards and minor typos.
    - Interactive modal to manually resolve unknown cards with autocomplete suggestions.
  - **Bulk CSV Validation**:
    - Validates all decks during CSV import with a visual progress bar.
    - Imports proceed even on error, flagging invalid decks with visual indicators (red background).
    - "Deck Verified" button to clear error flags after manual review.

#### Search & Discovery
- **Card Search**: Integrated Scryfall Autocomplete API with debouncing (300ms).
  - Added keyboard navigation support (Arrow keys, Enter) for search results.
- **Player Search**: Real-time filtering of the player list in the sidebar.

#### Tournament Management
- **Data Handling**:
  - Robust CSV parsing that handles quoted fields and mixed line endings.
  - **Export**: Functionality to export the current tournament state (including check status) to CSV.
- **Meta Analysis**: Added a modal to view the breakdown of deck archetypes.
- **Player Management**:
  - Modal for adding new players with decklist parsing.
  - Options to delete individual players or clear the entire tournament.

### UI/UX
- **Sidebar Organization**: Player list is now split into "Pending" and "Completed" sections.
- **Visual Feedback**: Added error states for images and confirmation dialogs for destructive actions.
- **Responsiveness**: Layout adapts to show deck stats and controls appropriately.
- **Deck View Enhancements**:
  - **Commander Previews**: Hovering over commander names displays the card image.
  - **Visual Polish**: Bold white text for archetypes; grouped stats and controls.
  - **Controls**: Distinct styling for the "Edit" button (Yellow/Bold).
- **Add Deck Modal**:
  - Integrated real-time card counter in the header.
  - Improved layout and "Validate" workflow before saving.
