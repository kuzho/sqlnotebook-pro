# Change Log

## [3.0.1] - 2026-03-30

### ✨ New Features
- **Date Parameter Support:** Now supports passing a `@date` parameter in SQL queries, allowing filtering by date and datetime values directly from the notebook interface.

## [3.0.0] - 2026-03-25

### ✨ New Features
- **Redesigned Parameters Panel:** Completely rebuilt the SQL Parameters panel with a compact, per-row UI. Each parameter shows a badge (`@name type`) alongside its inline value control. Click the ✏️ button to expand a full edit form for that row, and ✓ to confirm. Edit mode is automatically closed when a query starts executing.
- **Embedded Images in Markdown Cells:** Markdown cells now render images embedded as `attachment:` links (e.g. `![alt](attachment:filename.png)`) by resolving them from the notebook's stored attachments. Images are displayed inline without requiring external file paths.
- **JSON Cell Formatting:** SQL query results that return a single JSON string are now pretty-printed in the output cell, making JSON payloads easy to read directly in the notebook.

### 🔧 Internal
- Removed legacy client-side paste/drop/input event listeners that attempted to convert local image paths to base64 inline. Image embedding is now handled cleanly via the `attachment:` protocol.
- Fixed implicit `any` TypeScript errors in the attachment injection utility.

## [2.2.0] - 2026-03-24

### 🐛 Bug Fixes
- **Parameters Panel Save State:** Fixed a bug where switching from a SQL notebook to another editor incorrectly reset the save status badge to `SAVED`, even when parameter changes had not been persisted to disk. The `UNSAVED` indicator is now preserved correctly across editor switches until the file is actually saved.

## [2.1.9] - 2026-03-22

### 🔒 Security
- **MSSQL TLS Hardening (Secure by Default):** MSSQL connections now default to certificate validation (`trustServerCertificate = false`) and modern TLS minimum (`TLSv1.2`).
- **Legacy Compatibility Toggle:** Added optional `Legacy TLS 1.0 (SQL Server 2012)` for environments that still require old protocol support.
- **Credential Hygiene:** Fixed connection deletion to remove the correct secret key from VS Code Secret Storage.
- **Webview Hardening:** Added Content Security Policy (CSP) with nonce to connection and parameters webviews.
- **Logging Hygiene:** Removed a debug log that printed connection object details before query execution.

## [2.1.8] - 2026-03-22

### ⚡ Changed
- **Results Metadata:** Added `executionDate` to the result `info` payload alongside `executionTime`, so executions now report both date and time.
- **Results Toolbar:** Updated the results header to display both launch time (`🕒`) and launch date (`📅`).
- **Format Standardization:** Execution timestamp fields now use fixed formats for consistency across locales: `executionDate` as `YYYY-MM-DD` and `executionTime` as `HH:mm:ss`.

## [2.1.7] - 2026-03-20

### ⚡ Changed
- **SQL Parameters (Cell-First Execution):** Removed run-by-selection behavior. Query execution now always runs the full cell, avoiding accidental partial runs caused by transient text selections.
- **SQL Parameters (Storage Model):** Simplified parameter scope to active notebook runtime + notebook metadata persistence. Removed global parameter fallback complexity and improved consistency when switching/opening/closing notebooks.
- **SQL Parameters (Type-Aware Values):** Added structured parameter types (`text`, `checkbox`, `select`) with runtime resolution support in execution.
  - `checkbox` supports `checkedValue` / `uncheckedValue`.
  - `select` supports option lists and selected value handling.
  - Text parameters keep backward-compatible behavior.
- **SQL Parameters (Save Flow):** Improved manual save behavior and save-state feedback (`SAVED` / `UNSAVED`), with clearer synchronization between webview state and notebook metadata.

### 🐛 Bug Fixes
- **Parameters Panel Responsiveness:** Reworked layout to prevent field overlap in narrow sidebars and long lists (no more `value` overlapping `Text`/`@name`).
- **Parameters Panel Top Controls:** Improved wrapping and stability for add/save/status controls when panel width is constrained.
- **Parameters Panel Large Lists:** Added incremental rendering and progressive loading for better performance with many parameters.

### 🎨 UI/UX
- **Parameters Panel:** Redesigned parameter rows as responsive cards with stable grid layout and always-visible delete action.
- **Sticky Header:** Kept parameter controls visible while scrolling long parameter lists.

## [2.1.6] - 2026-03-15

### 🐞 Bug Fixes
- **Trino HTTPS/443 Connectivity:** Fixed connection failures (`400` errors) when using domain hosts on port `443`. Trino endpoint construction now respects explicit protocols and automatically defaults to HTTPS on port 443.
- **Trino Connection Test:** Updated the connection test flow to use the same robust endpoint normalization logic as runtime queries.
- **Trino Schema Discovery:** Improved metadata loading to discover schemas across catalogs (when no catalog/schema is specified), enabling broader navigation and autocomplete for Trino environments.

## [2.1.5] - 2026-03-12

### 🐞 Bug Fixes
- **Trino Driver:** Fixed major compatibility issues with Trino. Now queries execute correctly, errors are shown in the notebook, and the driver no longer fails with `this.client.query is not a function`. Improved error reporting for Trino SQL syntax and connection problems.

## [2.1.4] - 2026-03-11

### 🚀 Features & Fixes
- **Trino Compatibility & Parameter Fix:** Re-engineered the parameter formatter to be compatible with strict SQL dialects like Trino. It now intelligently quotes non-numeric values while leaving numbers as literals. This resolves `Incorrect syntax near ','` errors and officially enables support for the Trino driver.
- **TLS Connection Support:** Added support for `encrypt` and `trustServerCertificate` options in MSSQL connections. This resolves `UNSUPPORTED_PROTOCOL` errors when connecting to older SQL Server instances (e.g., SQL Server 2012) that have specific TLS requirements.

## [2.1.3] - 2026-02-10

### 🐛 Bug Fixes & Polish
- **Results Grid:** Preserved exact column order from queries with duplicate column names (e.g., `SELECT col, *`) in MSSQL.
- **Export:** CSV/XLSX exports now keep the visible column order even when duplicate headers exist.

## [2.1.2] - 2026-02-09

### ⚡ Changed
- **IntelliSense:** Added `@` parameter suggestions from the Parameters panel.
- **IntelliSense:** Added alias-aware column suggestions (`t.` / `alias.`).
- **IntelliSense:** Added schema-qualified table suggestions (`schema.table`).
- **IntelliSense:** Added JOIN/ON suggestions based on foreign keys when available.
- **IntelliSense:** Added driver-specific keywords and functions.

## [2.1.1] - 2026-02-05

### ⚡ Changed
- **SQL Parameters:** Values are now always sent as text (single-quoted) when replacing variables.
- **SQL Formatting:** Added a per-cell formatter button with automatic dialect detection based on the active connection.
- **Results Grid:** Duplicate columns now render as separate columns while keeping the same header label.

## [2.1.0] - 2026-01-19

### ⚡ Changed
- **SQL Parameters Persistence:** Parameters now use a block format at the top of the SQL file: `/*<SQL_PARAMS>...*/`.
  - Clean, readable in plain text (Git/Notepad).
  - Hidden in the VS Code notebook view.
- **Local vs Global Parameters:**
  - **Save for active file** stores parameters in the notebook metadata (per file).
  - **Global parameters** are stored in workspace state.
- **Manual Save Behavior:** When **Save for active file** is enabled, parameters are written only when the user saves the file.
- **IN() List Smarts:** Comma-separated values now respect quotes. Examples that work:
  - `"hoola","mundo"`
  - `'hola','mundo'`
  - `hola,mundo` (auto-quoted)
- **Run Selection:** If you highlight part of a query, only the selected SQL is executed.

---

## [2.0.2] - 2025-12-24

### ✨ New Features
- **Multi-Range Selection:** Hold **Ctrl** (or Cmd on Mac) and drag to select multiple non-contiguous cell ranges in the data grid.
- **Multi-Row Selection:** Hold **Ctrl** and click row numbers to select multiple individual rows.
- **Enhanced Copy:** Copy multiple selections at once with Ctrl+C - all ranges are copied separated by empty lines.

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
