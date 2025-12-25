# Change Log

## [2.0.1] - 2025-12-24

### 🐛 Bug Fixes & Polish
- **Smart Form Reset:** The "Clear Form" button is now smarter. Instead of resetting everything to default, it clears text fields but **preserves your selected driver** and automatically applies the correct default port (e.g., keeps MySQL selected and resets port to 3306).
- **UI Cleanup:** Fixed a visual glitch where empty form fields would display the text "undefined" in gray placeholder text.
- **Export Improvements:** Restored the automatic date-timestamp naming (e.g., `Results_2025-12-24...`) when exporting to Excel/CSV.

---

## [2.0.0] - 2025-12-24

> **⚠️ MAJOR UPDATE: BREAKING CHANGE**
>
> This version introduces a new, strict way of defining notebook cells to ensure stability with complex SQL queries. **Your existing notebooks will open as single blocks.** You must manually insert the separator `-- %%` between queries to split them back into cells.

### 🛡️ The "Strict Mode" Architecture
- **BREAKING: New Cell Separator:** Cells are no longer split by empty lines. You must now explicitly use the separator `-- %%` on a new line to define cell boundaries. This fixes crucial issues where long queries containing blank lines, comments, or complex procedures were incorrectly split.

### 📊 Interactive Grid 2.0
- **Multi-Column Selection:** Hold **Ctrl** (or Cmd) and click column headers to select multiple columns for bulk copying.
- **Native & Smart Export:** Completely rewrote the export engine.
    - Uses the OS native "Save As" dialog.
    - Auto-generates filenames with timestamps to prevent accidental overwrites.
    - Automatically opens the file after exporting (configurable).
- **Natural Sorting:** Clicking a header now cycles through three states: Ascending 🔼 -> Descending 🔽 -> **Original Order** (None).

### 🧠 UX & Stability
- **Smart Connection Form:** Selecting a driver (Postgres, MySQL, MSSQL) now automatically fills in the standard default port.
- **Communication Protocol:** Fixed critical issues with `postMessage` related to renderer IDs, ensuring reliable button actions (like Export) across all VS Code builds.

---

## [1.1.0] - 2025-12-23

### 🛡️ Security & Performance (Major Overhaul)
- **Engine Upgrade:** Updated core runtime to **Node.js 20+**.
- **Zero Vulnerabilities:** Patched all security dependencies. Replaced insecure `xlsx` library with the official SheetJS distribution.
- **Driver Updates:** Upgraded `mssql` (v12) and `mysql2` (v3) drivers for better stability and performance.
### 👁️ Visual Experience & UX
- **Collapse/Expand Control:** Added dedicated controls to manage code visibility.
    - **Global Toolbar:** Toggle all cells at once with the new "Collapse All" and "Expand All" buttons in the top notebook toolbar.
    - **Cell Toolbar:** Added individual **Expand (v)** and **Collapse (^)** buttons to each cell for precise control.
- **🎯 Focus Stability:** Implemented a "Focus Force" mechanism to ensure cell actions (like moving or collapsing) always target the correct cell, preventing execution errors.
- **Navigation:** Refined the cell toolbar layout for better accessibility.

### 🐛 Bug Fixes
- Fixed an issue where toggle buttons wouldn't respond immediately when clicking from the toolbar menu.

## [1.0.3] - 2025-12-22
- **🧠 Smarter Intellisense:** - Autocomplete now searches across **all active connections** if the table isn't found in the current context.
    - Added **Case-Insensitivity**: `test_users.` now correctly finds `TEST_USERS`.
- **↔️ Elastic Table Layout:** The data grid now supports **horizontal scrolling** properly. Columns auto-size to fit content, and the table expands beyond the viewport instead of shrinking.
- **🛡️ Robust Rendering:** Added protections against "undefined" rows and handled unnamed columns (e.g., `getdate()`) gracefully by assigning them a generated ID (`No column name`).
- **⚙️ Optimized Defaults:** Increased default `maxResultRows` to **100** (up from 25) and cleaned up unused settings.

## [1.0.2] - 2025-12-21
- **⏱️ Execution Timestamp:** Added a clock to the results toolbar to show exactly when the query finished running.
- **🐛 Bug Fix:** Fixed "Columns require an id" error in the interactive grid when using columns with special characters.
- **🧹 UI Cleanup:** Removed the redundant "Connect" button from the sidebar (connections are now managed exclusively by the Notebook Kernel).

## v1.0.0 - 2025-12-20

- Initial release of SQL Notebook Pro.

### Major Features
- **Multi-Kernel Architecture:** Replaced the single global connection model with a true Notebook Kernel system. Now you can switch between different database connections directly from the Notebook toolbar (top right), just like switching Python kernels.
- **Connection Grouping:** Added support for organizing connections into folders/groups in the side panel.
- **Edit Connections:** Added "Edit Connection" option to the context menu. You can now modify host, user, or groups without deleting and recreating the connection.
- **Smart Password Handling:** When editing a connection, leaving the password field empty preserves the existing secure password.

### UI Improvements
- **Interactive Data Grid:**
  - **Excel-Style Filtering:** Completely redesigned column filters with search, multi-select checkboxes, and "Select All" functionality.
  - **Dynamic Height:** The result table now auto-adjusts its height to fit the content, up to a maximum scrollable height.
  - **Floating Menus:** Fixed issues where menus were clipped by cell boundaries using React Portals.
  - **Improved Sorting:** Clicking the column header name sorts the data, while clicking the empty space selects the column.
- **Hot Reload:** Connection configuration changes (like updating a password) now apply immediately to the next query without requiring a VS Code restart.

### Internal
- Updated minimum VS Code engine requirement to `^1.75.0`.
- Refactored `renderer` and `controller` for better performance and stability.