/// <reference lib="dom" />

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
// Utilidad para reemplazar attachment: links por base64
function injectAttachmentsIntoMarkdown(markdown: string, attachments: Record<string, Record<string, string>>) {
  if (!attachments) {return markdown;}
  return markdown.replace(/!\[([^\]]*)\]\(attachment:([^\)]+)\)/g, (full: string, alt: string, filename: string) => {
    const att = attachments[filename];
    if (!att) {return full;}
    const mime = Object.keys(att)[0];
    const base64 = att[mime];
    return `![${alt}](data:${mime};base64,${base64})`;
  });
}
import ReactDOM from 'react-dom';
import type { ActivationFunction } from 'vscode-notebook-renderer';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getFacetedUniqueValues,
  getFacetedRowModel,
  flexRender,
  SortingState,
  ColumnFiltersState,
  ColumnSizingState,
} from '@tanstack/react-table';

const Portal = ({ children }: { children: React.ReactNode }) =>
  ReactDOM.createPortal(children, document.body);

const styles = `
  :root {
    --grid-border: #2d2d2d;
    --grid-header-bg: #252526;
    --grid-bg: #1e1e1e;
    --grid-hover: #2a2d2e;
    --selection-bg: #0078d4;
    --selection-bg-dim: #0078d440;
    --selection-border: #0078d4;
    --font-family: 'Segoe UI', 'Segoe UI Emoji', 'Apple Color Emoji', 'SF Mono', Consolas, 'Courier New', monospace;
    --font-size: 13px;
    --row-height: 26px;
  }
  .sql-grid-container {
    font-family: var(--font-family);
    font-size: var(--font-size);
    color: #cccccc;
    background: var(--grid-bg);
    width: 100%;
    padding: 0;
    max-height: 390px;
    height: auto;
    display: flex;
    flex-direction: column;
    user-select: none;
    border: 1px solid var(--grid-border);
    box-sizing: border-box;
    overflow: hidden;
    transition: min-height 0.2s ease;
  }

  .toolbar {
    height: var(--row-height);
    padding: 0 8px;
    box-sizing: border-box;
    background: #333333;
    border-bottom: 1px solid var(--grid-border);
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }

  .toolbar-time {
    font-size: 11px;
    color: #858585;
    margin-left: 8px;
    border-left: 1px solid #555;
    padding-left: 8px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .btn-action {
    background: transparent;
    color: #cccccc;
    border: 1px solid transparent;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
    border-radius: 2px;
    height: 22px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-action:hover { background: #454545; border-color: #555; }
  .btn-action:focus { outline: none; }

  .table-wrapper {
    overflow: auto;
    position: relative;
    background: var(--grid-bg);
    flex: 1;
    width: 100%;
    margin: 0;
    padding: 0;
  }

  table {
    border-collapse: separate;
    min-width: 100%;
    width: auto;
    table-layout: auto;
    margin: 0;
    border-spacing: 0;
    border-style: hidden;
  }

  th, td {
    border-right: 1px solid var(--grid-border);
    border-bottom: 1px solid var(--grid-border);
    padding: 0;
    white-space: nowrap;
    height: var(--row-height);
    line-height: var(--row-height);
    box-sizing: border-box;
    cursor: default;
  }

  td {
    padding: 0 8px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 500px;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--grid-header-bg);
    box-shadow: 0 1px 0 var(--grid-border);
  }

  th {
    font-weight: 600;
    text-align: left;
    user-select: none;
    overflow: hidden;
    cursor: url('data:image/svg+xml;utf8,<svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L12 22M12 22L7 17M12 22L17 17" stroke="white" stroke-width="2"/></svg>') 8 8, pointer;
    min-width: 80px;
  }

  .th-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    width: 100%;
    padding-left: 8px;
  }
  .th-content:hover { background-color: #383838; }

  .th-text-group {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    cursor: pointer;
    margin-right: auto;
    padding-right: 8px;
  }
  .th-text-group:hover { color: white; }

  .th-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .th-sort-icon { font-size: 10px; color: #0078d4; flex-shrink: 0; }

  .filter-wrapper {
    width: 28px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-right: 6px;
  }

  .filter-trigger {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: #a0a0a0;
    font-size: 10px;
    opacity: 0;
    cursor: default;
  }

  .th-content:hover .filter-trigger, .filter-trigger.active { opacity: 1; }
  .filter-trigger:hover { background-color: #454545; color: white; }
  .filter-trigger.active { color: #0078d4; font-weight: bold; opacity: 1; }

  .corner-header, .row-index {
    position: sticky;
    left: 0;
    background: var(--grid-header-bg);
    border-left: none;
    color: #858585;
    border-right: 1px solid var(--grid-border);
    font-size: 11px;
    white-space: nowrap;
    z-index: 10;
    width: 1%;
    min-width: 30px;
    text-align: right;
    padding-right: 4px;
    padding-left: 4px;
  }

  th:last-child, td:last-child {
    border-right: none;
  }
  .corner-header { z-index: 30; cursor: pointer; }
  .corner-header:hover { background: #444; color: white; }
  .row-index { cursor: pointer; }
  .row-index:hover { color: white; background: #333; }

  .resizer {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    width: 5px;
    background: transparent;
    cursor: col-resize;
    user-select: none;
    touch-action: none;
    z-index: 10;
  }
  .resizer:hover, .resizer.isResizing {
    background: #0078d4;
  }

  .selected-bg { background-color: var(--selection-bg-dim) !important; color: white !important; }
  .bt { box-shadow: inset 0 1px 0 0 var(--selection-border) !important; }
  .bb { box-shadow: inset 0 -1px 0 0 var(--selection-border) !important; }
  .bl { box-shadow: inset 1px 0 0 0 var(--selection-border) !important; }
  .br { box-shadow: inset -1px 0 0 0 var(--selection-border) !important; }
  .bt.bl { box-shadow: inset 1px 1px 0 0 var(--selection-border) !important; }
  .bt.br { box-shadow: inset -1px 1px 0 0 var(--selection-border) !important; }
  .bb.bl { box-shadow: inset 1px -1px 0 0 var(--selection-border) !important; }
  .bb.br { box-shadow: inset -1px -1px 0 0 var(--selection-border) !important; }

  .filter-menu-floating {
    position: fixed;
    z-index: 10000;
    background: #252526;
    color: #cccccc;
    border: 1px solid #454545;
    box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    width: 240px;
    display: flex;
    flex-direction: column;
    font-size: 12px;
    border-radius: 2px;
  }
  .popup-search { padding: 6px; border-bottom: 1px solid #3d3d3d; flex-shrink: 0; }
  .popup-search input { width: 100%; background: #3c3c3c; color: white; border: 1px solid #333; padding: 4px 6px; outline: none; box-sizing: border-box; }
  .popup-list { overflow-y: auto; max-height: 200px; padding: 4px 0; flex: 1; }
  .popup-item { padding: 4px 8px; display: flex; gap: 8px; align-items: center; cursor: pointer; user-select: none; }
  .popup-item:hover { background: #383838; }
  .popup-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 8px; border-top: 1px solid #3d3d3d; background: #252526; flex-shrink: 0; }
  .btn-primary { background: #0078d4; color: white; border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
  .btn-primary:hover { background: #0063b1; }
  .btn-secondary { background: #3c3c3c; color: white; border: 1px solid transparent; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
  .btn-secondary:hover { background: #454545; }

  .toolbar-badge {
    font-size: 10px;
    color: #9cdcfe;
    background: rgba(0, 120, 212, 0.15);
    border: 1px solid rgba(0, 120, 212, 0.35);
    border-radius: 999px;
    padding: 1px 6px;
  }

  .dataset-warning {
    padding: 6px 8px;
    font-size: 11px;
    color: #d7ba7d;
    background: #2d2415;
    border-bottom: 1px solid var(--grid-border);
  }

  .virtual-spacer-cell {
    padding: 0;
    border: none;
    height: 0;
    line-height: 0;
    background: transparent;
  }
`;

const ROW_HEIGHT_PX = 26;
const VIRTUALIZATION_THRESHOLD = 500;
const VIRTUAL_OVERSCAN = 12;
const MAX_FILTER_OPTIONS = 1000;

const FilterMenu = ({
  column,
  isOpen,
  onToggle,
  onClose
}: {
  column: any,
  isOpen: boolean,
  onToggle: (e: React.MouseEvent) => void,
  onClose: () => void
}) => {
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0, alignTop: false });

  const { uniqueValues, totalUniqueValues, isCapped } = useMemo(() => {
    const unique = column.getFacetedUniqueValues?.();
    if (!unique || typeof unique.keys !== 'function') {
      return { uniqueValues: [], totalUniqueValues: 0, isCapped: false };
    }

    const allValues = Array.from(unique.keys());
    const cappedValues = allValues.slice(0, MAX_FILTER_OPTIONS);

    return {
      uniqueValues: cappedValues.map(val => {
        const label =
          val === null || val === undefined
            ? '(Empty)'
            : String(val);
        return { raw: val, label };
      }).sort((a, b) => a.label.localeCompare(b.label)),
      totalUniqueValues: allValues.length,
      isCapped: allValues.length > MAX_FILTER_OPTIONS
    };
  }, [column]);

  const filteredList = uniqueValues.filter(v => v.label.toLowerCase().includes(search.toLowerCase()));
  const currentFilter = (column.getFilterValue() as any[]) || [];

  const handleCheckbox = (val: any) => {
    let newFilter = currentFilter.includes(val)
      ? currentFilter.filter(i => i !== val)
      : [...currentFilter, val];
    column.setFilterValue(newFilter.length ? newFilter : undefined);
  };

  const selectAll = () => column.setFilterValue(filteredList.map(v => v.raw));
  const clearFilter = () => {
    column.setFilterValue(undefined);
    setSearch("");
  };

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const MENU_HEIGHT = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      const showAbove = spaceBelow < MENU_HEIGHT;

      let left = rect.right - 240;
      if (left < 0) {left = rect.left;}

      setCoords({
        x: left,
        y: showAbove ? rect.top : rect.bottom,
        alignTop: showAbove
      });
      setSearch("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {return;}
    const close = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
         onClose();
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [isOpen, onClose]);

  return (
    <div className="filter-wrapper" onClick={e => e.stopPropagation()}>
      <div
        ref={triggerRef}
        className={`filter-trigger ${currentFilter.length ? 'active' : ''}`}
        onClick={onToggle}
        title="Filtrar"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 12l4-4V2H6v10z"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M1.5 2h13l-5 5v5l-3 3V7l-5-5z"/>
        </svg>
      </div>

      {isOpen && (
        <Portal>
          <div
            className="filter-menu-floating"
            onMouseDown={e => e.stopPropagation()}
            style={{
              top: coords.y,
              left: coords.x,
              transform: coords.alignTop ? 'translateY(-100%)' : 'none',
              marginTop: coords.alignTop ? -4 : 4,
              marginBottom: coords.alignTop ? 4 : 0
            }}
          >
            <div className="popup-search">
              <input
                placeholder="Search.."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                autoFocus
              />
            </div>
            <div className="popup-list">
              <div className="popup-item" onClick={clearFilter} style={{fontStyle:'italic', color:'#0078d4'}}>
                Clear
              </div>
              {isCapped && (
                <div style={{ padding: '4px 8px', color: '#d7ba7d', fontSize: 11 }}>
                  Showing first {MAX_FILTER_OPTIONS.toLocaleString()} of {totalUniqueValues.toLocaleString()} values
                </div>
              )}
              {filteredList.map((item, idx) => (
                <label key={idx} className="popup-item">
                  <input
                    type="checkbox"
                    checked={currentFilter.includes(item.raw)}
                    onChange={() => handleCheckbox(item.raw)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
              {filteredList.length === 0 && <div style={{padding:8, textAlign:'center', color:'#888'}}>0 Rows</div>}
            </div>
            <div className="popup-actions">
              <button className="btn-secondary" onClick={selectAll}>All</button>
              <button className="btn-primary" onClick={onClose}>Close</button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};

const BADGE_STYLES: Record<string, React.CSSProperties> = {
  danger: { backgroundColor: '#4a1818', color: '#ff9999', border: '1px solid #752525' },
  warning: { backgroundColor: '#4d4100', color: '#ffeb80', border: '1px solid #6e5d00' },
  success: { backgroundColor: '#103d10', color: '#99ff99', border: '1px solid #1a5e1a' },
  inactive: { backgroundColor: '#2d2d2d', color: '#cccccc', border: '1px solid #454545' },
  processing: { backgroundColor: '#003366', color: '#99ccff', border: '1px solid #004488' }
};

const SmartCell = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) {
    return <span style={{ opacity: 0.5, fontStyle: 'italic' }}>NULL</span>;
  }

  if (typeof value === 'object') {
    return <span style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>{JSON.stringify(value)}</span>;
  }

  const str = String(value);

  // 1. URL Detection
  if (str.startsWith('http://') || str.startsWith('https://')) {
    return (
      <a
        href={str}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#3794ff', textDecoration: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
        onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
      >
        {str}
      </a>
    );
  }

  const lower = str.toLowerCase();
  let style: React.CSSProperties | null = null;

  if (str.includes('🔴') || lower.includes('atrasada') || lower.includes('failed') || lower.includes('error') || lower.includes('critical')) {
    style = BADGE_STYLES.danger;
  } else if (str.includes('🟡') || lower.includes('urgente') || lower.includes('warning') || lower.includes('pending')) {
    style = BADGE_STYLES.warning;
  } else if (str.includes('🟢') || lower.includes('a tiempo') || lower.includes('success') || lower.includes('ready') || lower.includes('ok') || lower.includes('completed')) {
    style = BADGE_STYLES.success;
  } else if (str.includes('⚪') || lower.includes('sin fecha') || lower.includes('inactive') || lower.includes('null') || lower.includes('none')) {
    style = BADGE_STYLES.inactive;
  } else if (str.includes('🔵') || lower.includes('processing') || lower.includes('running')) {
    style = BADGE_STYLES.processing;
  }

  if (style) {
    return <span style={{ ...style, padding: '1px 8px', borderRadius: '10px', fontSize: '11px', display: 'inline-block', lineHeight: '1.4', fontWeight: 500 }}>{str}</span>;
  }

  return <span>{str}</span>;
};

const EditableCell = ({ initialValue, row, column, updateData, isEdited }: any) => {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  const onBlur = () => {
    setIsEditing(false);
    if (value !== initialValue) {
      updateData(row.index, column.id, value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onBlur();
    } else if (e.key === 'Escape') {
      setValue(initialValue);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        value={value ?? ''}
        onChange={e => setValue(e.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%', height: '100%', boxSizing: 'border-box',
          background: '#1e1e1e', color: 'white', border: '1px solid #0078d4', outline: 'none', padding: '0 4px'
        }}
      />
    );
  }

  return (
    <div
      onDoubleClick={() => setIsEditing(true)}
      title="Double click to edit"
      style={{
        width: '100%', height: '100%',
        backgroundColor: isEdited ? 'rgba(215, 186, 125, 0.2)' : 'transparent',
        cursor: 'text',
        display: 'flex', alignItems: 'center'
      }}
    >
      <SmartCell value={value} />
    </div>
  );
};

const normalizeRows = (rows: unknown[], columnOrder: string[] | null) => {
  if (!columnOrder || !Array.isArray(rows)) {return rows;}
  return rows.map(row => {
    if (Array.isArray(row)) {
      const obj: Record<string, unknown> = {};
      columnOrder.forEach((_, idx) => {
        obj[`col_${idx}`] = (row as unknown[])[idx];
      });
      return obj;
    }

    if (row && typeof row === 'object') {
      const obj: Record<string, unknown> = {};
      columnOrder.forEach((col, idx) => {
        obj[`col_${idx}`] = (row as Record<string, unknown>)[col];
      });
      return obj;
    }

    return row;
  });
};

const formatExecutionTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const formatExecutionDate = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface OutputPayload {
  rows?: any[];
  columns?: string[];
  info?: {
    executionTime?: string;
    executionDate?: string;
    truncated?: boolean;
    originalLength?: number;
    tableName?: string;
    executionId?: string;
  };
}

const TableApp = ({ data, postMessage }: { data: OutputPayload | any[], postMessage?: (msg: any) => void }) => {
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rawRows = Array.isArray(data) ? data : (data.rows || []);
  const columnOrder = !Array.isArray(data) && Array.isArray(data.columns) ? data.columns : null;
  const normalizedRows = useMemo(() => normalizeRows(rawRows, columnOrder), [rawRows, columnOrder]);
  const [rows, setRows] = useState(normalizedRows);

  useEffect(() => {
    setRows(normalizedRows);
  }, [normalizedRows]);
  const executionTimeFromBackend = !Array.isArray(data) && data.info?.executionTime;
  const executionDateFromBackend = !Array.isArray(data) && data.info?.executionDate;
  const isTruncated = Boolean(!Array.isArray(data) && data.info?.truncated);
  const totalRowsFromBackend = !Array.isArray(data) && typeof data.info?.originalLength === 'number'
    ? data.info.originalLength
    : rows.length;
  const fallbackTime = useMemo(() => formatExecutionTime(new Date()), []);
  const fallbackDate = useMemo(() => formatExecutionDate(new Date()), []);
  const runTime = executionTimeFromBackend || fallbackTime;
  const runDate = executionDateFromBackend || fallbackDate;
  const tableNameFromBackend = !Array.isArray(data) && data.info?.tableName ? data.info.tableName : 'TargetTable';
  const executionId = !Array.isArray(data) && data.info?.executionId ? data.info.executionId : 'fallback';
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [exportSqlText, setExportSqlText] = useState('📝 INSERTs');

  const [editedRows, setEditedRows] = useState<Record<number, Record<string, any>>>({});
  const [saveBtnText, setSaveBtnText] = useState('💾 Save Changes');

  const updateData = useCallback((rowIndex: number, columnId: string, value: any) => {
     setEditedRows(old => ({
        ...old,
        [rowIndex]: {
           ...(old[rowIndex] || {}),
           [columnId]: value
        }
     }));
  }, []);

  const [selection, setSelection] = useState<{
    type: 'all' | 'row' | 'col' | 'range' | 'multi',
    ids?: Set<any>,
    range?: { r1: number, c1: number, r2: number, c2: number },
    ranges?: Array<{ r1: number, c1: number, r2: number, c2: number }>
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{r: number, c: number} | null>(null);

  const isSelectNoRows =
  Array.isArray(rows) &&
  (
    rows.length === 0 ||
    rows.every(
      row =>
        !row ||
        (typeof row === 'object' &&
         Object.values(row).every(
           v => v === null || v === undefined
         ))
    )
  );

  const statusData = isSelectNoRows
  ? [{
      rowsReturned: 0,
      columnCount: 0,
      message: 'No rows returned'
    }]
  : rows;

  const columns = useMemo(() => {
    try {
      if (isSelectNoRows) {
        return [
          { header: 'rowsReturned', accessorKey: 'rowsReturned' },
          { header: 'columnCount', accessorKey: 'columnCount' },
          { header: 'message', accessorKey: 'message' }
        ];
      }

      if (!rows || !Array.isArray(rows) || rows.length === 0) {return [];}

      const firstRow = rows.find(row => row && typeof row === 'object') as Record<string, any>;
      if (!firstRow) {return [];}

      if (columnOrder && Array.isArray(columnOrder)) {
        return columnOrder.map((header, index) => {
          const safeHeader = header && String(header).trim().length > 0 ? String(header) : '(No column name)';
          const colId = `col_${index}`;
          return {
            id: colId,
            header: safeHeader,
            accessorFn: (row: any) => row[colId],
            enableColumnFilter: true,
            filterFn: (row: any, id: string, filterValue: any[]) => {
              return filterValue.includes(row.original[colId]);
            },
            cell: (info: any) => {
              const meta = info.table.options.meta as any;
              const rowIndex = info.row.index;
              const cId = info.column.id;
              const isEdited = meta?.editedRows?.[rowIndex]?.[cId] !== undefined;
              const val = isEdited ? meta.editedRows[rowIndex][cId] : info.getValue();
              return <EditableCell initialValue={val} row={info.row} column={info.column} updateData={meta?.updateData} isEdited={isEdited} />;
            }
          };
        });
      }

      return Object.keys(firstRow).flatMap((key, index) => {
        const isUnnamed = !key || key.trim() === '';
        const sampleValue = firstRow[key];

        if (Array.isArray(sampleValue)) {
          const headerLabel = isUnnamed ? '(No column name)' : key;
          return sampleValue.map((_, subIndex) => ({
            id: isUnnamed ? `col_unnamed_${index}_${subIndex}` : `${key}__dup_${subIndex}`,
            header: headerLabel,
            accessorFn: (row: any) => {
              const val = row[key];
              return Array.isArray(val) ? val[subIndex] : val;
            },
            enableColumnFilter: true,
            filterFn: (row: any, id: string, filterValue: any[]) => {
              const arr = row.original[key];
              const val = Array.isArray(arr) ? arr[subIndex] : arr;
              return filterValue.includes(val);
            },
            cell: (info: any) => {
              const meta = info.table.options.meta as any;
              const rowIndex = info.row.index;
              const cId = info.column.id;
              const isEdited = meta?.editedRows?.[rowIndex]?.[cId] !== undefined;
              const val = isEdited ? meta.editedRows[rowIndex][cId] : info.getValue();
              return <EditableCell initialValue={val} row={info.row} column={info.column} updateData={meta?.updateData} isEdited={isEdited} />;
            }
          }));
        }

        const safeId = isUnnamed ? `col_unnamed_${index}` : key;
        const safeHeader = isUnnamed ? '(No column name)' : key;

        return [{
          id: safeId,
          header: safeHeader,
          accessorFn: (row: any) => row[key],
          enableColumnFilter: true,
          filterFn: (row: any, id: string, filterValue: any[]) => {
            return filterValue.includes(row.original[key]);
          },
          cell: (info: any) => {
            const meta = info.table.options.meta as any;
            const rowIndex = info.row.index;
            const cId = info.column.id;
            const isEdited = meta?.editedRows?.[rowIndex]?.[cId] !== undefined;
            const val = isEdited ? meta.editedRows[rowIndex][cId] : info.getValue();
            return <EditableCell initialValue={val} row={info.row} column={info.column} updateData={meta?.updateData} isEdited={isEdited} />;
          }
        }];
      });
    } catch (error) {
        console.error("Error generating columns:", error);
        return [];
      }
  }, [rows, isSelectNoRows, columnOrder]);

  const table = useReactTable({
    data: statusData,
    columns: columns,
    state: { sorting, columnFilters, columnSizing },
    columnResizeMode: 'onChange',
    meta: { editedRows, updateData },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const tableRows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleFlatColumns();
  const shouldVirtualize = tableRows.length > VIRTUALIZATION_THRESHOLD;
  const viewportHeight = tableWrapperRef.current?.clientHeight ?? 390;
  const visibleRowCount = Math.max(20, Math.ceil(viewportHeight / ROW_HEIGHT_PX) + (VIRTUAL_OVERSCAN * 2));
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - VIRTUAL_OVERSCAN)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(tableRows.length, startIndex + visibleRowCount)
    : tableRows.length;
  const renderedRows = shouldVirtualize ? tableRows.slice(startIndex, endIndex) : tableRows;
  const topSpacerHeight = shouldVirtualize ? startIndex * ROW_HEIGHT_PX : 0;
  const bottomSpacerHeight = shouldVirtualize ? Math.max(0, (tableRows.length - endIndex) * ROW_HEIGHT_PX) : 0;

  useEffect(() => {
    setScrollTop(0);
    if (tableWrapperRef.current) {
      tableWrapperRef.current.scrollTop = 0;
      tableWrapperRef.current.scrollLeft = 0;
    }
      setEditedRows({});
      setSelection(null);
      setSorting([]);
      setColumnFilters([]);
      setColumnSizing({});
      setActiveMenuId(null);
      setIsDragging(false);
      setDragStart(null);
      setExportSqlText('📝 INSERTs');
      setSaveBtnText('💾 Save Changes');
    }, [executionId]);

  const handleSortClick = (column: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const isSorted = column.getIsSorted();

    if (!isSorted) {
      column.toggleSorting(false);
    } else if (isSorted === 'asc') {
      column.toggleSorting(true);
    } else {
      column.clearSorting();
    }
  };

  const handleCopy = useCallback(() => {
    if (!selection) {return;}

    const getVal = (r: number, cId: string) => {
      const cell = tableRows[r]?.getVisibleCells().find(c => c.column.id === cId);
      let v = cell?.getValue();
      return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    };

    let rowsToText: string[] = [];

    if (selection.type === 'multi' && Array.isArray(selection.ranges)) {
      selection.ranges.forEach((range, idx) => {
        const { r1, c1, r2, c2 } = range;
        const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
        const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);

        for (let r = minR; r <= maxR; r++) {
          const line = [];
          for (let c = minC; c <= maxC; c++) {
            if (visibleColumns[c]) {
              line.push(getVal(r, visibleColumns[c].id));
            }
          }
          rowsToText.push(line.join('\t'));
        }

        if (selection.ranges && idx < selection.ranges.length - 1) {
          rowsToText.push('');
        }
      });
    } else if (selection.type === 'range' && selection.range) {
      const { r1, c1, r2, c2 } = selection.range;
      const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
      const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);

      for (let r = minR; r <= maxR; r++) {
        const line = [];
        for (let c = minC; c <= maxC; c++) {
          if (visibleColumns[c]) {
            line.push(getVal(r, visibleColumns[c].id));
          }
        }
        rowsToText.push(line.join('\t'));
      }
    } else if (selection.type === 'all' || selection.type === 'row' || selection.type === 'col') {
      let targetRows = tableRows;
      let targetCols = visibleColumns;

      if (selection.type === 'row' && selection.ids) {
        targetRows = tableRows.filter((_, i) => selection.ids!.has(i));
      }
      if (selection.type === 'col' && selection.ids) {
        targetCols = visibleColumns.filter(c => selection.ids!.has(c.id));
      }

      rowsToText.push(targetCols.map(c => c.columnDef.header).join('\t'));

      targetRows.forEach(r => {
        const line = targetCols.map(c => {
          let v = r.getVisibleCells().find(cell => cell.column.id === c.id)?.getValue();
          return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        });
        rowsToText.push(line.join('\t'));
      });
    }

    navigator.clipboard.writeText(rowsToText.join('\n'));
  }, [selection, tableRows, visibleColumns]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if((e.ctrlKey||e.metaKey)&&e.key==='c') { e.preventDefault(); handleCopy(); }};
    window.addEventListener('keydown', k); return ()=>window.removeEventListener('keydown', k);
  }, [handleCopy]);

  const onMouseDown = (r:number, c:number, isCtrl: boolean) => {
    if (isCtrl && selection?.type === 'range' && selection.range) {
      setSelection(prev => ({
        type: 'multi',
        ranges: prev ? [prev.range!, { r1: r, c1: c, r2: r, c2: c }] : [{ r1: r, c1: c, r2: r, c2: c }]
      }));
      setIsDragging(true);
      setDragStart({r, c});
    } else if (isCtrl && selection?.type === 'multi' && selection.ranges) {
      setSelection(prev => ({
        type: 'multi',
        ranges: [...prev!.ranges!, { r1: r, c1: c, r2: r, c2: c }]
      }));
      setIsDragging(true);
      setDragStart({r, c});
    } else {
      setIsDragging(true);
      setDragStart({r,c});
      setSelection({type:'range', range:{r1:r,c1:c,r2:r,c2:c}});
    }
  };

  const onMouseEnter = (r:number, c:number) => {
    if(isDragging && dragStart) {
      if (selection?.type === 'multi' && selection.ranges) {
        const updatedRanges = [...selection.ranges];
        updatedRanges[updatedRanges.length - 1] = {
          r1: dragStart.r,
          c1: dragStart.c,
          r2: r,
          c2: c
        };
        setSelection({type:'multi', ranges: updatedRanges});
      } else {
        setSelection({type:'range', range:{r1:dragStart.r,c1:dragStart.c,r2:r,c2:c}});
      }
    }
  };

  const onMouseUp = () => setIsDragging(false);
  const handleCornerClick = () => setSelection({type:'all'});

  const handleRowHeaderClick = (idx: number, isCtrl: boolean) => {
    if (isCtrl && selection?.type === 'row' && selection.ids) {
      const newIds = new Set(selection.ids);
      if (newIds.has(idx)) {
        newIds.delete(idx);
      } else {
        newIds.add(idx);
      }
      setSelection(newIds.size > 0 ? {type:'row', ids: newIds} : null);
    } else {
      setSelection({type:'row', ids: new Set([idx])});
    }
  };

  const getCellClass = (r:number, c:number, colId: string) => {
    if (!selection) {return '';}
    let isSel = false;
    let rangeForBorders = null;

    if (selection.type==='all') {isSel=true;}
    if (selection.type==='row' && selection.ids?.has(r)) {isSel=true;}
    if (selection.type==='col' && selection.ids?.has(colId)) {isSel=true;}

    if (selection.type==='range' && selection.range) {
      const {r1,c1,r2,c2}=selection.range;
      if (r>=Math.min(r1,r2) && r<=Math.max(r1,r2) && c>=Math.min(c1,c2) && c<=Math.max(c1,c2)) {
        isSel=true;
        rangeForBorders = selection.range;
      }
    }

    if (selection.type==='multi' && selection.ranges) {
      for (const range of selection.ranges) {
        const {r1,c1,r2,c2}=range;
        if (r>=Math.min(r1,r2) && r<=Math.max(r1,r2) && c>=Math.min(c1,c2) && c<=Math.max(c1,c2)) {
          isSel=true;
          rangeForBorders = range;
        }
      }
    }

    let borders = '';
    if(isSel && rangeForBorders) {
       const {r1,c1,r2,c2}=rangeForBorders;
       const minR=Math.min(r1,r2), maxR=Math.max(r1,r2), minC=Math.min(c1,c2), maxC=Math.max(c1,c2);
       if(r===minR) {borders+='bt ';} if(r===maxR) {borders+='bb ';} if(c===minC) {borders+='bl ';} if(c===maxC) {borders+='br ';}
    }
    return isSel ? `selected-bg ${borders}` : '';
  };

  const exportCSV = () => {
    if (postMessage) {
      const exportColumns = visibleColumns.map(c => String(c.columnDef.header ?? c.id));
      const exportRows = tableRows.map(r =>
        visibleColumns.map(c => {
          const value = r.getVisibleCells().find(cell => cell.column.id === c.id)?.getValue();
          return typeof value === 'object' ? JSON.stringify(value) : value;
        })
      );
      const currentData = tableRows.map(r => r.original);
      postMessage({ type: 'export_data', payload: { data: currentData, columns: exportColumns, rows: exportRows, format: 'csv' } });
    }
  };

  const exportExcel = () => {
    if (postMessage) {
      const exportColumns = visibleColumns.map(c => String(c.columnDef.header ?? c.id));
      const exportRows = tableRows.map(r =>
        visibleColumns.map(c => {
          const value = r.getVisibleCells().find(cell => cell.column.id === c.id)?.getValue();
          return typeof value === 'object' ? JSON.stringify(value) : value;
        })
      );
      const currentData = tableRows.map(r => r.original);
      postMessage({ type: 'export_data', payload: { data: currentData, columns: exportColumns, rows: exportRows, format: 'xlsx' } });
    }
  };

  const exportSQL = () => {
    const tableName = tableNameFromBackend;

    const exportColumns = visibleColumns.map(c => {
       const header = String(c.columnDef.header ?? c.id);
       return header.match(/^[a-zA-Z0-9_]+$/) ? header : `[${header}]`;
    });

    const sqlRows = tableRows.map(r => {
      const vals = visibleColumns.map(c => {
        const val = r.getVisibleCells().find(cell => cell.column.id === c.id)?.getValue();
        if (val === null || val === undefined) {return 'NULL';}
        if (typeof val === 'number') {return val;}
        if (typeof val === 'boolean') {return val ? 1 : 0;}
        if (typeof val === 'object') {return `'${JSON.stringify(val).replace(/'/g, "''")}'`;}
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      return `  (${vals.join(', ')})`;
    });

    const sql = `-- Exported from SQL Notebook Pro\nINSERT INTO ${tableName} (${exportColumns.join(', ')})\nVALUES\n${sqlRows.join(',\n')};`;

    if (postMessage) {
      postMessage({ type: 'export_sql', payload: { sql } });
      setExportSqlText('⏳ Exporting...');
      setTimeout(() => setExportSqlText('📝 INSERTs'), 2000);
    }
  };

  const generateUpdates = () => {
     const tableName = tableNameFromBackend;

     let pkColDef = columns.find((c: any) => String(c.header).toLowerCase() === 'id') as any;
     if (!pkColDef && columns.length > 0) {
         pkColDef = columns[0] as any;
     }
     if (!pkColDef) { return; }

     const pkCol = String(pkColDef.header ?? pkColDef.id);

     const updates: string[] = [];
     Object.keys(editedRows).forEach(rIndexStr => {
        const rIndex = parseInt(rIndexStr, 10);
        const changes = editedRows[rIndex];
        const originalRow = rows[rIndex] as Record<string, any>;

        let pkValue = originalRow[pkColDef.id];
        if (pkValue === undefined) { return; }

        const setClauses = Object.entries(changes).map(([colId, val]) => {
            const safeVal = val === null || val === '' ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`;
            const colDef = columns.find((c: any) => c.id === colId) as any;
            const colName = String(colDef ? (colDef.header ?? colId) : colId);
            const safeCol = colName.match(/^[a-zA-Z0-9_]+$/) ? colName : `[${colName}]`;
            return `${safeCol} = ${safeVal}`;
        });

        if (setClauses.length === 0) {return;}

        const safePkVal = typeof pkValue === 'number' ? pkValue : `'${String(pkValue).replace(/'/g, "''")}'`;
        const safePkCol = pkCol.match(/^[a-zA-Z0-9_]+$/) ? pkCol : `[${pkCol}]`;

        updates.push(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${safePkCol} = ${safePkVal};`);
     });

     if (updates.length > 0) {
         const finalSql = updates.join('\n');
         if (postMessage) {
            postMessage({ type: 'apply_updates', payload: { sql: finalSql } });
            setSaveBtnText('✅ Saved!');

            // Refrescar la vista local al instante con los nuevos datos
            const updatedRows = [...rows];
            Object.keys(editedRows).forEach(rIndexStr => {
                const rIndex = parseInt(rIndexStr, 10);
                updatedRows[rIndex] = {
                    ...(updatedRows[rIndex] as Record<string, any>),
                    ...editedRows[rIndex]
                };
            });
            setRows(updatedRows);

            setTimeout(() => { setSaveBtnText('💾 Save Changes'); setEditedRows({}); }, 2000);
         }
     }
  };

  const containerMinHeight = activeMenuId ? 360 : 'auto';

  return (
    <div
      className="sql-grid-container"
      style={{ minHeight: containerMinHeight }}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <style>{styles}</style>
      <div className="toolbar">
        <span style={{fontSize:11, fontWeight:'bold'}}>
          {isTruncated
            ? `${tableRows.length.toLocaleString()} rows shown of ${totalRowsFromBackend.toLocaleString()} total`
            : `${tableRows.length.toLocaleString()} rows`}
        </span>
        {shouldVirtualize && <span className="toolbar-badge">⚡ optimized view</span>}
        <span className="toolbar-time">
           🕒 {runTime}
        </span>
          <span className="toolbar-time">
            📅 {runDate}
          </span>
        <div style={{flex:1}}/>
        {!isSelectNoRows && (
          <>
            {Object.keys(editedRows).length > 0 && (
              <button className="btn-action" onClick={generateUpdates} title="Generate UPDATE script" style={{color: '#d7ba7d', borderColor: '#d7ba7d'}}>
                {saveBtnText}
              </button>
            )}
            <button className="btn-action" onClick={exportSQL} title="Export as SQL INSERTs to File">
              {exportSqlText}
            </button>
            <button className="btn-action" onClick={exportExcel}>
              📊 Excel
            </button>
            <button className="btn-action" onClick={exportCSV}>
              📄 CSV
            </button>
          </>
        )}
      </div>

      {(shouldVirtualize || isTruncated) && !isSelectNoRows && (
        <div className="dataset-warning">
          {isTruncated
            ? `This notebook is limited to ${tableRows.length.toLocaleString()} rows by the "SQL Notebook: Max Result Rows" setting. The query returned ${totalRowsFromBackend.toLocaleString()} rows. Increase that setting to view more rows here.`
            : 'Large result detected. Only the visible rows are rendered while you scroll to avoid UI freezes.'}
        </div>
      )}

      <div
        ref={tableWrapperRef}
        className="table-wrapper"
        onScroll={(e) => {
          if (shouldVirtualize) {
            setScrollTop(e.currentTarget.scrollTop);
          }
        }}
      >
        <table>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                <th className="corner-header" onClick={handleCornerClick}>◢</th>
                {hg.headers.map(header => {
                  const isResized = table.getState().columnSizing[header.id] !== undefined;
                  const customWidth = isResized ? header.column.getSize() : undefined;

                  return (
                    <th key={header.id}
                      className={selection?.type==='col' && selection.ids?.has(header.id) ? 'selected-bg' : ''}
                      style={isResized ? { width: customWidth, minWidth: customWidth, maxWidth: customWidth, position: 'relative' } : { position: 'relative' }}
                    >

                    <div
                        className="th-content"
                        onClick={(e) => {
                           const isMulti = e.ctrlKey || e.metaKey;
                           const colId = header.id;

                           setSelection(prev => {
                             if (!isMulti || !prev || prev.type !== 'col' || !prev.ids) {
                               return { type: 'col', ids: new Set([colId]) };
                             }
                             const newIds = new Set(prev.ids);
                             if (newIds.has(colId)) {
                               newIds.delete(colId);
                             } else {
                               newIds.add(colId);
                             }
                             return newIds.size > 0 ? { type: 'col', ids: newIds } : null;
                           });
                        }}
                    >
                      <div
                        className="th-text-group"
                        onClick={(e) => handleSortClick(header.column, e)}
                        title="Click para ordenar"
                      >
                        <span className="th-title">
                           {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        <span className="th-sort-icon">
                          {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                        </span>
                      </div>

                      <FilterMenu
                        column={header.column}
                        isOpen={activeMenuId === header.id}
                        onToggle={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(activeMenuId === header.id ? null : header.id);
                        }}
                        onClose={() => setActiveMenuId(null)}
                      />

                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setColumnSizing(old => {
                            const newState = { ...old };
                            delete newState[header.id];
                            return newState;
                          });
                        }}
                        className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
                        onClick={e => e.stopPropagation()}
                        title="Drag to resize, Double-click to auto-fit"
                      />
                    </div>
                  </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {shouldVirtualize && topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  className="virtual-spacer-cell"
                  colSpan={visibleColumns.length + 1}
                  style={{ height: `${topSpacerHeight}px` }}
                />
              </tr>
            )}
            {renderedRows.map((row, localIndex) => {
              const rIndex = shouldVirtualize ? startIndex + localIndex : localIndex;
              return (
                <tr key={row.id}>
                  <td className={`row-index ${selection?.type==='row' && selection.ids?.has(rIndex)?'selected-bg':''}`}
                      onClick={(e)=>handleRowHeaderClick(rIndex, e.ctrlKey || e.metaKey)}>{rIndex + 1}</td>
                  {row.getVisibleCells().map((cell, cIndex) => {
                    const isResized = table.getState().columnSizing[cell.column.id] !== undefined;
                    const customWidth = isResized ? cell.column.getSize() : undefined;

                    return (
                      <td key={cell.id}
                          className={getCellClass(rIndex, cIndex, cell.column.id)}
                          onMouseDown={(e)=>onMouseDown(rIndex, cIndex, e.ctrlKey || e.metaKey)}
                          onMouseEnter={()=>onMouseEnter(rIndex, cIndex)}
                          style={isResized ? { width: customWidth, minWidth: customWidth, maxWidth: customWidth } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {shouldVirtualize && bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  className="virtual-spacer-cell"
                  colSpan={visibleColumns.length + 1}
                  style={{ height: `${bottomSpacerHeight}px` }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const activate: ActivationFunction = (context) => {
  return {
    renderOutputItem(data, element) {
      const json = data.json();
      // Si es una celda markdown con attachments, reemplazar attachment: links
      if (json && json.kind === 1 && json.attachments) {
        json.value = injectAttachmentsIntoMarkdown(json.value, json.attachments);
      }
      ReactDOM.render(<TableApp data={json} postMessage={context.postMessage} />, element);
    }
  };
};