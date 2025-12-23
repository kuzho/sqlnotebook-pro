# SQL Notebook Pro

<img align="right" src="media/logo.png" width="120px">

**SQL Notebook Pro** transforms VS Code into a powerful SQL IDE. Open `.sql` files as notebooks, execute query blocks, and analyze results with an Excel-like interactive grid.

> **Forked & Enhanced:** Built upon the original SQL Notebook, this Pro version adds native Intellisense, connection grouping, robust editing, portable settings, and a completely redesigned result viewer.

---

## ✨ Key Features

### 1. 🧠 Smart Intellisense & Autocomplete
Write SQL faster with our native Intellisense engine. The extension automatically reads your database schema to provide context-aware suggestions.

* **Global Search:** If a table isn't found in the current connection, the extension smartly scans all your active connections to find it.
* **Case-Insensitive:** Type `test_users` or `TEST_USERS` — we find it either way.
* **Columns:** Type a table name followed by a dot (e.g., `users.`) to instantly see that table's columns.
* **Keywords:** Full support for standard SQL keywords (SELECT, WHERE, JOIN, etc.).

### 2. Interactive Data Grid (Excel-Style)
Filter, sort, and analyze your data without writing extra queries.
* **Elastic Layout:** The grid auto-expands horizontally to fit your data.
* **Filtering:** Use the funnel icon to search, select, or exclude specific values.
* **Export:** One-click export to **Excel (XLSX)** or **CSV**.
<br>
<img src="media/demo-grid.png" width="100%" alt="Interactive SQL Grid with Filters">
<br><br>

### 3. Connection Groups & Editing
Organize your database chaos. Group connections by environment (Dev, Prod, Staging) or project. Right-click any connection to **Edit** details instantly without re-entering passwords.
<br>
<img src="media/demo-sidebar.png" width="100%" alt="Connection Grouping and Context Menu">
<br><br>

### 4. Smart Connection Form
Create connections safely. Includes a **Test Connection** button to verify credentials before saving. Passwords are stored securely in the system keychain, while settings are portable.
<br>

---

## 🚀 Feature Highlights (v1.0.3)

- **⚡ Multi-Kernel Architecture:** Switch connections instantly using the Notebook Toolbar (top-right), just like switching Python environments.
- **📁 Connection Grouping:** Use the "Group" field to organize connections into folders.
- **✏️ Edit Mode:** Right-click to edit Host, User, or Port without re-entering passwords.
- **☁️ Portable Settings:** Connections are saved in `settings.json`, making it easy to sync between computers (passwords remain local & secure in your OS Keychain).
- **🔄 Hot Reload:** Edit a connection and run a query immediately—no restart required.
- **⏱️ Execution Timer:** See exactly how long your query took to run in the results bar.
- **📊 Export:** One-click export to **Excel** or **CSV**.

## Usage

1.  **Open a SQL File:** Open any `.sql` file, click `Open With...` (or right-click the tab), and select **SQL Notebook**.
2.  **Create Connection:** Use the "SQL Notebook" sidebar to add a connection.
    - *Tip:* Enter a "Group Name" to create a folder automatically.
3.  **Select Connection:** Click the **Select Kernel** button (top-right corner of the editor) or the current connection name to choose which database to use.
4.  **Run Queries:** Click the **Play** button on each cell (blocks are separated by empty lines).
5.  **Use Autocomplete:**
    - Start typing a command (e.g., `SEL`) to see keywords.
    - Type a table name (e.g., `users`) to see table suggestions.
    - **Crucial:** Type a dot after a table name (e.g., `users.`) to trigger the **Column List**.

## Configuration

You can customize the extension in VS Code Settings:

* **SQL Notebook: Max Result Rows:** (Default: 100) Limits the initial rows rendered for performance. You can increase this if you need more data at a glance.
* **SQL Notebook: Query Timeout:** (Default: 30000ms) Cancels queries that take too long.

## FAQ

**Where are my passwords stored?**
Passwords are stored securely in the VS Code **Secret Storage** (your OS keychain), never in plain text.

**How do I filter data in the table?**
Click the small funnel icon (Filter) next to any column header to search or select specific values, just like in Excel.

**Can I sync my connections?**
Yes! Since connection details (Host, User, DB) are stored in `settings.json`, they sync automatically if you use VS Code Settings Sync. You will only need to re-enter passwords on the new machine for security.

---
*Based on the original work by cmoog.*