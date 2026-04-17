# Change Log

## [3.0.8]
### ✨ New Features & Polish
- **Required Parameters Validation:** Added a "Required" checkbox to the parameters panel. The extension will now automatically block execution and show an error if a required parameter is used in the query but left empty.
- **Safe Execution Protection:** Introduced a new setting `sqlnotebook.safeDelete` (enabled by default) that blocks the execution of `DELETE` and `UPDATE` statements without a `WHERE` clause, preventing accidental mass data modification or wipes.
- **Enhanced Result Feedback:** Execution messages for `INSERT`, `UPDATE`, `DELETE`, and `SELECT` queries with zero rows are now beautifully rendered inside the interactive results grid with success badges instead of plain text.

## [3.0.7]
### ✨ New Features & Polish
- **Schema Explorer Data Types:** Hovering over columns in the connections panel now displays their native SQL data type (e.g., `VARCHAR`, `INT`). The data type is also subtly displayed next to the column name for quick reference.
- **Universal SQL Formatter:** Re-engineered the SQL formatter to generate clean, highly-compact, and professional queries across all drivers. It now smartly handles `AS` aliases, compacts nested parentheses, correctly formats `CASE WHEN`, and preserves `WITH (NOLOCK)` positioning.
- **Connection Explorer Scripting:** Right-clicking a table in the connections panel now provides a "Select Top 100 Rows" option that automatically scaffolds a new query in a notebook.
- **Kernel Grouping:** Connections in the Kernel Selector are now neatly labeled with their assigned folder/group (e.g., `Prod / DB_Name`), enabling instant filtering by typing the group name.
- **Bug Fixes:** Resolved an issue where modifying a connection's display name resulted in duplicated entries and lost passwords.

### 🔧 Maintenance
- **Dependency Updates:** Updated several key dependencies (`@vscode/vsce`, `glob`, `prettier`, `eslint`, `pg`, `trino-client`, etc.) to their latest versions to resolve deprecation warnings, improve security, and ensure compatibility with the latest VS Code APIs.

## [3.0.6]

### Added
- **T-SQL Formatting Improvement**: Implementation of hierarchical indentation for `BEGIN...END` blocks (Stored Procedure style).
- **CASE Statement Fix**: Adjusted indentation logic in `CASE` statements to prevent excessive spacing.
- **Driver-Based Scoping**: Advanced T-SQL rules are now only applied when using the MSSQL driver, respecting standard formatting for other engines.
## [3.0.5] - 2026-04-11

### ⚡ Changed
- **Large Result Rendering:** Improved table responsiveness for big result sets by reducing expensive full-table rendering work in the notebook output grid.
- **Filter Menu Scalability:** Limited extremely large unique-value filter lists to keep filter popups responsive on heavy datasets.
- **Result Limit Messaging:** Clarified output messaging when displayed rows are limited by the `SQL Notebook: Max Result Rows` setting.

### 🐛 Bug Fixes
- **Renderer Stability:** Fixed regressions where row counts could appear without visible cell values in specific result payload shapes.
- **MySQL Command Output:** Reverted overly opinionated command-result formatting to preserve predictable raw output behavior.

## [3.0.4] - 2026-04-03

### ⚡ Changed
- **Canonical SQL Save Format:** Simplified notebook persistence to a single canonical SQL format using `-- %%` separators and embedded metadata blocks in comments.
- **Format Compatibility:** Existing JSON notebooks are still readable and will normalize to canonical SQL format on save.
- **Export Command UX:** Updated export action labeling to match the canonical SQL workflow.

### 🐛 Bug Fixes
- **TypeScript Config Modernization:** Updated TypeScript module settings to avoid deprecated `moduleResolution=node10` behavior in project configs.
- **Webview Form Typing:** Fixed boolean normalization typing in `webview/main.tsx` when processing form data.
- **Readonly Output Clone:** Fixed notebook export cell cloning by converting readonly outputs to mutable arrays in `src/main.ts`.

## [3.0.3] - 2025-05-15

### 🐛 Bug Fixes
- **Parameters Panel Persistence:** Fixed an issue where SQL parameters would disappear when closing and reopening the side panel. The extension now preserves unsaved parameter changes in memory independently of the panel's visibility and ensures reliable synchronization when the view is reopened.

## [3.0.2] - 2025-05-14

### ✨ Features
- **Export to Legacy SQL:** Added a new button in the notebook toolbar to export the current JSON notebook back to a plain `.sql` file with `-- %%` separators.

### ✨ Improved
- **Improved Date Compatibility:** Date parameters are now always formatted using a space separator instead of 'T' (e.g. `YYYY-MM-DD HH:mm`). This ensures full compatibility with SQL Server (MSSQL) while remaining valid for MySQL, Postgres, and others, avoiding "Conversion failed" errors.
- **Sargable Date Queries:** By providing standard SQL date strings, the extension encourages direct comparisons (e.g., `date_col >= @param`) instead of wrapping parameters in CAST/CONVERT functions, improving performance and readability.
- **Export Logic:** Enhanced the SQL Export to include markdown cells as comments and preserve parameter blocks accurately.
- **Smart Status Badge:** The Parameters panel now intelligently tracks the notebook's dirty state. It correctly shows `UNSAVED` when editing cells or parameters, `SAVED` after `Ctrl+S`, and `NO FILE` when switching to non-notebook tabs.

### 🐛 Bug Fixes
- **Save Sync:** Fixed an issue where the "Saved" status in the Parameters panel wouldn't update when saving the notebook using `Ctrl + S`.
- **Migration via UI Button:** Fixed the "Save" button in the parameters panel so it correctly triggers a file system write, ensuring legacy files migrate to the new JSON format.

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
