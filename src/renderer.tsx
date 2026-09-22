import React, {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from 'react';
function injectAttachmentsIntoMarkdown(
  markdown: string,
  attachments: Record<string, Record<string, string>>,
) {
  if (!attachments) {
    return markdown;
  }
  return markdown.replace(
    /!\[([^\]]*)\]\(attachment:([^\)]+)\)/g,
    (full: string, alt: string, filename: string) => {
      const att = attachments[filename];
      if (!att) {
        return full;
      }
      const mime = Object.keys(att)[0];
      const base64 = att[mime];
      return `![${alt}](data:${mime};base64,${base64})`;
    },
  );
}
import { createPortal } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
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
import { useVirtualizer } from '@tanstack/react-virtual';
const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, window.document.body);
const styles = `
  :root {
    --grid-border: var(--vscode-panel-border, #454545);
    --grid-header-bg: var(--vscode-editorWidget-background, #252526);
    --grid-bg: var(--vscode-editor-background, #1e1e1e);
    --grid-hover: var(--vscode-list-hoverBackground, #2a2d2e);

    --selection-border: #005a9e;
    --selection-bg-dim: rgba(0, 120, 212, 0.25);

    --font-family: 'Segoe UI', 'Segoe UI Emoji', 'Apple Color Emoji', 'SF Mono', Consolas, 'Courier New', monospace;
    --font-size: 13px;
    --row-height: 26px;
  }
  .sql-grid-container {
    font-family: var(--font-family);
    font-size: var(--font-size);
    color: var(--vscode-editor-foreground, #cccccc);
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
  }
  .toolbar {
    height: var(--row-height);
    padding: 0 8px;
    box-sizing: border-box;
    background: var(--grid-header-bg);
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
    color: var(--vscode-editor-foreground, #cccccc);
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
  .table-wrapper:focus {
    outline: none;
  }
  .table-wrapper {
    overflow: auto;
    position: relative;
    background: var(--grid-bg);
    flex: 1;
    width: 100%;
    margin: 0;
    padding: 0;
  }
  .sql-grid-table {
    display: grid;
    width: 100%;
    margin: 0;
    border-style: hidden;
  }
  .sql-thead, .sql-tbody, .sql-tr {
    display: contents;
  }

  .sql-th:first-child,
  .sql-td:first-child {
    white-space: nowrap;
  }
  .sql-th, .sql-td {
    border-right: 1px solid var(--grid-border);
    border-bottom: 1px solid var(--grid-border);
    padding: 0;
    white-space: nowrap;
    height: var(--row-height);
    max-height: var(--row-height);
    line-height: var(--row-height);
    box-sizing: border-box;
    cursor: default;
  }
  .sql-td {
    padding: 0 8px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sql-thead {
    display: contents;
  }
  .sql-th {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--grid-header-bg);
    box-shadow: 0 1px 0 var(--grid-border);
    font-weight: 600;
    text-align: left;
    user-select: none;
    overflow: hidden;
    cursor: url('data:image/svg+xml;utf8,<svg width="16" height="16" viewBox="0 0 24 24" fill="%23858585" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L12 22M12 22L7 17M12 22L17 17" stroke="%23858585" stroke-width="2"/></svg>') 8 8, pointer;
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
  .th-text-group:hover { color: var(--vscode-editor-foreground, white); }
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
    color: var(--vscode-editor-foreground, #858585);
    border-right: 1px solid var(--grid-border);
    font-size: 11px;
    z-index: 30;
    white-space: nowrap;
    text-align: right !important;
    padding-right: 8px !important;
    padding-left: 4px;
    box-sizing: border-box;
  }

  .sql-th:not(:first-child), .sql-td:not(:first-child) {
    white-space: nowrap;
  }
  .sql-th:last-child, .sql-td:last-child {
    border-right: none;
  }
  .corner-header { z-index: 40 !important; cursor: pointer; }
  .corner-header:hover { background: var(--grid-hover); color: var(--vscode-editor-foreground, white); }
  .row-index { cursor: pointer; }
  .row-index:hover { background: var(--grid-hover); color: var(--vscode-editor-foreground, white); }
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
  .filter-menu-floating {
    position: fixed;
    z-index: 10000;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editorWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    width: 240px;
    display: flex;
    flex-direction: column;
    font-size: 12px;
    border-radius: 2px;
  }
  .popup-search { padding: 6px; border-bottom: 1px solid #3d3d3d; flex-shrink: 0; }
  .popup-search input { width: 100%; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, white); border: 1px solid var(--vscode-input-border, #333); padding: 4px 6px; outline: none; box-sizing: border-box; }
  .popup-list { overflow-y: auto; max-height: 200px; padding: 4px 0; flex: 1; }
  .popup-item { padding: 4px 8px; display: flex; gap: 8px; align-items: center; cursor: pointer; user-select: none; }
  .popup-item:hover { background: var(--grid-hover, #383838); }
  .popup-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 8px; border-top: 1px solid var(--vscode-editorWidget-border, #3d3d3d); background: var(--vscode-editorWidget-background, #252526); flex-shrink: 0; }
  .btn-primary { background: #0078d4; color: white; border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
  .btn-primary:hover { background: #0063b1; }
  .btn-secondary { background: #3c3c3c; color: white; border: 1px solid transparent; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
  .btn-secondary:hover { background: #454545; }
  .dataset-warning {
    padding: 6px 8px;
    font-size: 11px;
    color: #d7ba7d;
    background: #2d2415;
    border-bottom: 1px solid var(--grid-border);
  }

  .table-wrapper,
  .sql-grid-container .sql-grid-table,
  .sql-grid-container .sql-tbody,
  .sql-grid-container .sql-tbody .sql-tr {
    background-color: var(--grid-bg) !important;
  }
  .sql-grid-container .sql-thead .sql-tr,
  .sql-grid-container .sql-thead .sql-th {
    background-color: var(--grid-header-bg) !important;
  }
  .virtual-spacer-cell {
    padding: 0 !important;
    border: none !important;
    height: 0;
    line-height: 0;
    background-color: var(--grid-bg) !important;
    max-height: none !important;
  }

  .sql-grid-container .sql-tr:nth-child(even) .sql-td,
  .sql-grid-container .sql-tr:nth-child(even) .sql-td,
  .sql-grid-container .sql-tr:nth-child(odd) .sql-td {
    background-color: transparent;
  }

  .sql-grid-container .row-index,
  .sql-grid-container .corner-header {
    background-color: var(--grid-header-bg) !important;
  }
`;
const ROW_HEIGHT_PX = 26;
const VIRTUALIZATION_THRESHOLD = 50;
const VIRTUAL_OVERSCAN = 15;
const MAX_FILTER_OPTIONS = 1000;
const FilterMenu = ({
  column,
  isOpen,
  onToggle,
  onClose,
}: {
  column: any;
  isOpen: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onClose: () => void;
}) => {
  const [search, setSearch] = useState('');
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
      uniqueValues: cappedValues
        .map((val) => {
          const label =
            val === null || val === undefined ? '(Empty)' : String(val);
          return { raw: val, label };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
      totalUniqueValues: allValues.length,
      isCapped: allValues.length > MAX_FILTER_OPTIONS,
    };
  }, [column]);
  const filteredList = uniqueValues.filter((v) =>
    v.label.toLowerCase().includes(search.toLowerCase()),
  );
  const currentFilter = (column.getFilterValue() as any[]) || [];
  const handleCheckbox = (val: any) => {
    let newFilter = currentFilter.includes(val)
      ? currentFilter.filter((i) => i !== val)
      : [...currentFilter, val];
    column.setFilterValue(newFilter.length ? newFilter : undefined);
  };
  const selectAll = () => column.setFilterValue(filteredList.map((v) => v.raw));
  const clearFilter = () => {
    column.setFilterValue(undefined);
    setSearch('');
  };

  const listRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredList.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 24,
    overscan: 10,
  });

  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    setActiveIndex(-1);
  }, [search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filteredList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredList.length) {
        handleCheckbox(filteredList[activeIndex].raw);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = (triggerRef.current as HTMLElement).getBoundingClientRect();
      const MENU_HEIGHT = 280;
      const spaceBelow = (window.innerHeight || 0) - rect.bottom;
      const showAbove = spaceBelow < MENU_HEIGHT;
      let left = rect.right - 240;
      if (left < 0) {
        left = rect.left;
      }
      setCoords({
        x: left,
        y: showAbove ? rect.top : rect.bottom,
        alignTop: showAbove,
      });
      setSearch('');
    }
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const close = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !(triggerRef.current as HTMLElement).contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener('mousedown', close as any);
    return () => window.removeEventListener('mousedown', close);
  }, [isOpen, onClose]);
  return (
    <div className="filter-wrapper" onClick={(e) => e.stopPropagation()}>
      <div
        ref={triggerRef}
        className={`filter-trigger ${currentFilter.length ? 'active' : ''}`}
        onClick={onToggle}
        title="Filtrar"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 12l4-4V2H6v10z" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M1.5 2h13l-5 5v5l-3 3V7l-5-5z"
          />
        </svg>
      </div>
      {isOpen && (
        <Portal>
          <div
            className="filter-menu-floating"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              top: coords.y,
              left: coords.x,
              transform: coords.alignTop ? 'translateY(-100%)' : 'none',
              marginTop: coords.alignTop ? -4 : 4,
              marginBottom: coords.alignTop ? 4 : 0,
            }}
          >
            <div className="popup-search" onKeyDown={handleKeyDown}>
              <input
                placeholder="Search.."
                value={search}
                onChange={(e: any) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div
              className="popup-item"
              onClick={clearFilter}
              style={{
                fontStyle: 'italic',
                color: '#0078d4',
                borderBottom: '1px solid #333',
              }}
            >
              Clear
            </div>
            {isCapped && (
              <div
                style={{
                  padding: '4px 8px',
                  color: '#d7ba7d',
                  fontSize: 11,
                  borderBottom: '1px solid #333',
                }}
              >
                Showing first {MAX_FILTER_OPTIONS.toLocaleString()} of{' '}
                {totalUniqueValues.toLocaleString()} values
              </div>
            )}
            <div
              className="popup-list"
              onKeyDown={handleKeyDown}
              ref={listRef}
              style={{ height: 200, overflowY: 'auto' }}
            >
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = filteredList[virtualRow.index];
                  const idx = virtualRow.index;
                  return (
                    <label
                      key={idx}
                      className={`popup-item ${activeIndex === idx ? 'active-item' : ''}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        ...(activeIndex === idx
                          ? {
                              backgroundColor:
                                'var(--vscode-list-activeSelectionBackground)',
                              color:
                                'var(--vscode-list-activeSelectionForeground)',
                            }
                          : {}),
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={currentFilter.includes(item.raw)}
                        onChange={() => handleCheckbox(item.raw)}
                      />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
              {filteredList.length === 0 && (
                <div style={{ padding: 8, textAlign: 'center', color: '#888' }}>
                  0 Rows
                </div>
              )}
            </div>
            <div className="popup-actions">
              <button className="btn-secondary" onClick={selectAll}>
                All
              </button>
              <button className="btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
const BADGE_STYLES: Record<string, React.CSSProperties> = {
  danger: {
    backgroundColor: '#4a1818',
    color: '#ff9999',
    border: '1px solid #752525',
  },
  warning: {
    backgroundColor: '#4d4100',
    color: '#ffeb80',
    border: '1px solid #6e5d00',
  },
  success: {
    backgroundColor: '#103d10',
    color: '#99ff99',
    border: '1px solid #1a5e1a',
  },
  inactive: {
    backgroundColor: '#2d2d2d',
    color: '#cccccc',
    border: '1px solid #454545',
  },
  processing: {
    backgroundColor: '#003366',
    color: '#99ccff',
    border: '1px solid #004488',
  },
};
const SmartCell = React.memo(
  ({ value, badgeKeywords }: { value: unknown; badgeKeywords?: any }) => {
    if (value === null || value === undefined) {
      return <span style={{ opacity: 0.5, fontStyle: 'italic' }}>NULL</span>;
    }
    if (typeof value === 'object') {
      return (
        <span style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
          {JSON.stringify(value)}
        </span>
      );
    }
    const str = String(value);
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return (
        <a
          href={str}
          target="_blank"
          rel="noopener noreferrer"
          style={
            { color: '#3794ff', textDecoration: 'none' } as React.CSSProperties
          }
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.textDecoration =
              'underline')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.textDecoration =
              'none')
          }
        >
          {str}
        </a>
      );
    }
    const lower = str.toLowerCase();
    let style: React.CSSProperties | null = null;
    const kw = badgeKeywords || {
      danger: [
        '🔴',
        'atrasada',
        'failed',
        'fail',
        'error',
        'critical',
        'cancelado',
        'cancelled',
        'rechazado',
        'rejected',
        'timeout',
      ],
      warning: [
        '🟡',
        'urgente',
        'warning',
        'pending',
        'en pausa',
        'paused',
        'en espera',
        'waiting',
        'delayed',
        'demorado',
      ],
      success: [
        '🟢',
        'a tiempo',
        'success',
        'ready',
        'ok',
        'completed',
        'done',
        'activo',
        'active',
        'terminado',
        'finished',
        'aprobado',
        'approved',
        'entregado',
      ],
      inactive: [
        '⚪',
        'sin fecha',
        'inactive',
        'null',
        'none',
        'cerrado',
        'closed',
        'disabled',
        'desactivado',
        'archived',
        'archivado',
        'n/a',
        'empty',
      ],
      processing: [
        '🔵',
        'processing',
        'running',
        'en progreso',
        'in progress',
        'en proceso',
        'started',
        'iniciado',
        'cargando',
        'loading',
      ],
    };
    if (kw.danger.some((w: string) => lower.includes(w.toLowerCase()))) {
      style = BADGE_STYLES.danger;
    } else if (
      kw.warning.some((w: string) => lower.includes(w.toLowerCase()))
    ) {
      style = BADGE_STYLES.warning;
    } else if (
      kw.success.some((w: string) => lower.includes(w.toLowerCase()))
    ) {
      style = BADGE_STYLES.success;
    } else if (
      kw.inactive.some((w: string) => lower.includes(w.toLowerCase()))
    ) {
      style = BADGE_STYLES.inactive;
    } else if (
      kw.processing.some((w: string) => lower.includes(w.toLowerCase()))
    ) {
      style = BADGE_STYLES.processing;
    }
    if (style) {
      return (
        <span
          style={{
            ...style,
            padding: '1px 8px',
            borderRadius: '10px',
            fontSize: '11px',
            display: 'inline-block',
            lineHeight: '1.4',
            fontWeight: 500,
          }}
        >
          {str}
        </span>
      );
    }
    return <span>{str}</span>;
  },
);
const EditableCell = React.memo(
  ({
    initialValue,
    row,
    column,
    updateData,
    isEdited,
    badgeKeywords,
    isEditingExternal,
    table,
  }: any) => {
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);
    const isSaving = useRef(false);

    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);

    useEffect(() => {
      if (isEditingExternal && !isEditing) {
        setIsEditing(true);
      }
    }, [isEditingExternal]);

    const onBlur = () => {
      if (isSaving.current) {
        return;
      }
      isSaving.current = true;
      setIsEditing(false);

      if (value !== initialValue) {
        updateData(row.index, column.id, value);
      }
      setTimeout(() => {
        isSaving.current = false;
      }, 0);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        onBlur();
        setTimeout(() => {
          const wrapper = document.querySelector(
            '.table-wrapper',
          ) as HTMLElement;
          wrapper?.focus();
        }, 10);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        setValue(initialValue);
        setIsEditing(false);
        setTimeout(() => {
          const wrapper = document.querySelector(
            '.table-wrapper',
          ) as HTMLElement;
          wrapper?.focus();
        }, 10);
      } else if (e.key === 'Tab') {
        e.stopPropagation();
        e.preventDefault();
        onBlur();

        setTimeout(() => {
          const columns = table.getVisibleLeafColumns();
          const currentIndex = columns.findIndex(
            (c: any) => c.id === column.id,
          );
          if (currentIndex !== -1 && currentIndex + 1 < columns.length) {
            const nextColId = columns[currentIndex + 1].id;
            table.options.meta?.setEditingCell({
              r: row.index,
              cId: nextColId,
            });

            table.options.meta?.setSelection({
              type: 'cell',
              range: {
                r1: row.index,
                c1: currentIndex + 1,
                r2: row.index,
                c2: currentIndex + 1,
              },
            });
          } else {
            const wrapper = document.querySelector(
              '.table-wrapper',
            ) as HTMLElement;
            wrapper?.focus();
          }
        }, 10);
      }
    };

    if (isEditing) {
      return (
        <input
          autoFocus
          value={value ?? ''}
          onChange={(e: any) => setValue(e.target.value)}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            background: 'var(--vscode-input-background, #1e1e1e)',
            color: 'var(--vscode-input-foreground, white)',
            border: '1px solid var(--selection-border, #0078d4)',
            outline: 'none',
            padding: '0 4px',
          }}
        />
      );
    }

    return (
      <div
        onDoubleClick={() => setIsEditing(true)}
        title="Double click to edit"
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: isEdited
            ? 'rgba(215, 186, 125, 0.2)'
            : 'transparent',
          cursor: 'text',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <SmartCell value={value} badgeKeywords={badgeKeywords} />
      </div>
    );
  },
);
const ThemeColorPicker = React.memo(
  ({
    color,
    onChange,
  }: {
    color: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <span className="toolbar-time" title="Color del Selector">
      <input
        type="color"
        value={color}
        onChange={onChange}
        style={{
          width: '14px',
          height: '14px',
          padding: 0,
          border: '1px solid #555',
          borderRadius: '2px',
          cursor: 'pointer',
          background: 'transparent',
        }}
      />
    </span>
  ),
);
const MemoTd = React.memo(
  ({
    cell,
    rIndex,
    cIndex,
    colId,
    customWidth,
    selectionStyle,
    isEdited,
  }: any) => {
    return (
      <div
        role="cell"
        className="sql-td"
        data-r={rIndex}
        data-c={cIndex}
        style={{
          ...selectionStyle,
        }}
      >
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.rIndex === next.rIndex &&
      prev.cIndex === next.cIndex &&
      prev.customWidth === next.customWidth &&
      prev.isEdited === next.isEdited &&
      prev.selectionStyle?.backgroundColor ===
        next.selectionStyle?.backgroundColor &&
      prev.selectionStyle?.boxShadow === next.selectionStyle?.boxShadow &&
      prev.colId === next.colId &&
      prev.cell === next.cell
    );
  },
);
const MemoRowIndex = React.memo(
  ({ rIndex, isSelected }: any) => {
    return (
      <div
        role="cell"
        className={`sql-td row-index ${isSelected ? 'selected-bg' : ''}`}
        data-row-index={rIndex}
      >
        {rIndex + 1}
      </div>
    );
  },
  (prev, next) =>
    prev.rIndex === next.rIndex && prev.isSelected === next.isSelected,
);
const normalizeRows = (rows: unknown[], columnOrder: string[] | null) => {
  if (!columnOrder || !Array.isArray(rows)) {
    return rows;
  }
  return rows.map((row) => {
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
    primaryKeys?: string[];
    executionId?: string;
    badgeKeywords?: {
      danger: string[];
      warning: string[];
      success: string[];
      inactive: string[];
      processing: string[];
    };
  };
}
const TableApp = ({
  data,
  postMessage,
  onDidReceiveMessage,
}: {
  data: OutputPayload | any[];
  postMessage?: (msg: any) => void;
  onDidReceiveMessage?: any;
}) => {
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const componentIdRef = useRef(
    `table_${Math.random().toString(36).substring(2, 9)}`,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    const target = containerRef.current;
    if (!target) {
      return;
    }
    const initialWidth = (target as HTMLElement).clientWidth;
    containerWidthRef.current = initialWidth;
    setContainerWidth(initialWidth);
    let rafId = 0;
    const observer = new (window as any).ResizeObserver((entries: any[]) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          containerWidthRef.current = entry.contentRect.width;
          setContainerWidth(entry.contentRect.width);
        }
      });
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);
  const rawRows = Array.isArray(data) ? data : data.rows || [];
  const columnOrder =
    !Array.isArray(data) && Array.isArray(data.columns) ? data.columns : null;
  const normalizedRows = useMemo(
    () => normalizeRows(rawRows, columnOrder),
    [rawRows, columnOrder],
  );
  const [rows, setRows] = useState(normalizedRows);
  const prevExecutionIdRef = useRef<string | undefined | null>(
    !Array.isArray(data) ? data.info?.executionId : null,
  );

  useLayoutEffect(() => {
    const currentExecutionId = !Array.isArray(data)
      ? data.info?.executionId
      : null;
    if (
      currentExecutionId &&
      prevExecutionIdRef.current === currentExecutionId
    ) {
      return;
    }
    setRows(normalizedRows);
    prevExecutionIdRef.current = currentExecutionId;
  }, [normalizedRows, data]);
  const executionTimeFromBackend =
    !Array.isArray(data) && data.info?.executionTime;
  const executionDateFromBackend =
    !Array.isArray(data) && data.info?.executionDate;
  const isTruncated = Boolean(!Array.isArray(data) && data.info?.truncated);
  const totalRowsFromBackend =
    !Array.isArray(data) && typeof data.info?.originalLength === 'number'
      ? data.info.originalLength
      : rows.length;
  const fallbackTime = useMemo(() => formatExecutionTime(new Date()), []);
  const fallbackDate = useMemo(() => formatExecutionDate(new Date()), []);
  const runTime = executionTimeFromBackend || fallbackTime;
  const runDate = executionDateFromBackend || fallbackDate;
  const tableNameFromBackend =
    !Array.isArray(data) && data.info?.tableName
      ? data.info.tableName
      : 'TargetTable';
  const primaryKeysFromBackend =
    !Array.isArray(data) && data.info?.primaryKeys ? data.info.primaryKeys : [];
  const executionId =
    !Array.isArray(data) && data.info?.executionId
      ? data.info.executionId
      : 'fallback';

  const badgeKeywords = useMemo(() => {
    return !Array.isArray(data) && data.info?.badgeKeywords
      ? data.info.badgeKeywords
      : {
          danger: [
            '🔴',
            'atrasada',
            'failed',
            'fail',
            'error',
            'critical',
            'cancelado',
            'cancelled',
            'rechazado',
            'rejected',
            'timeout',
          ],
          warning: [
            '🟡',
            'urgente',
            'warning',
            'pending',
            'en pausa',
            'paused',
            'en espera',
            'waiting',
            'delayed',
            'demorado',
          ],
          success: [
            '🟢',
            'a tiempo',
            'success',
            'ready',
            'ok',
            'completed',
            'done',
            'activo',
            'active',
            'terminado',
            'finished',
            'aprobado',
            'approved',
            'entregado',
          ],
          inactive: [
            '⚪',
            'sin fecha',
            'inactive',
            'null',
            'none',
            'cerrado',
            'closed',
            'disabled',
            'desactivado',
            'archived',
            'archivado',
            'n/a',
            'empty',
          ],
          processing: [
            '🔵',
            'processing',
            'running',
            'en progreso',
            'in progress',
            'en proceso',
            'started',
            'iniciado',
            'cargando',
            'loading',
          ],
        };
  }, [data]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{
    r: number;
    cId: string;
  } | null>(null);
  const [exportSqlText, setExportSqlText] = useState('📝 To Insert');
  const [editedRows, setEditedRows] = useState<
    Record<number, Record<string, any>>
  >({});
  const editedRowsRef = useRef(editedRows);
  useLayoutEffect(() => {
    editedRowsRef.current = editedRows;
  }, [editedRows]);
  const [saveBtnText, setSaveBtnText] = useState('💾 Save Changes');
  const [themeColor, setThemeColor] = useState(() => {
    return (
      window.localStorage.getItem('sqlnotebook-selection-color') || '#005a9e'
    );
  });
  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newColor = e.target.value;
      setThemeColor(newColor);
      window.localStorage.setItem('sqlnotebook-selection-color', newColor);
    },
    [],
  );
  const themeBgDim = useMemo(() => {
    let hex = themeColor.replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const num = parseInt(hex, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, 0.25)`;
  }, [themeColor]);
  const updateData = useCallback(
    (rowIndex: number, columnId: string, value: any) => {
      setEditedRows((old) => ({
        ...old,
        [rowIndex]: {
          ...(old[rowIndex] || {}),
          [columnId]: value,
        },
      }));
    },
    [],
  );
  const [selection, setSelection] = useState<{
    type: 'all' | 'row' | 'col' | 'range' | 'multi';
    ids?: Set<any>;
    range?: { r1: number; c1: number; r2: number; c2: number };
    ranges?: Array<{ r1: number; c1: number; r2: number; c2: number }>;
  } | null>(null);
  const [dragMode, setDragMode] = useState<'none' | 'cell' | 'row'>('none');
  const [dragStart, setDragStart] = useState<{ r: number; c: number } | null>(
    null,
  );
  const [dragStartRow, setDragStartRow] = useState<number | null>(null);
  const isSelectNoRows =
    Array.isArray(rows) &&
    (rows.length === 0 ||
      rows.every(
        (row) =>
          !row ||
          (typeof row === 'object' &&
            Object.values(row).every((v) => v === null || v === undefined)),
      ));
  const statusData = isSelectNoRows
    ? [
        {
          rowsReturned: 0,
          columnCount: 0,
          message: 'No rows returned',
        },
      ]
    : rows;
  const columns = useMemo(() => {
    const getColSize = (
      headerText: string,
      colKey?: string,
      subIndex?: number,
    ) => {
      const headerLen = headerText ? String(headerText).length : 0;
      const headerWidth = headerLen * 8 + 60;
      let dataLen = 0;
      if (colKey) {
        const scanLimit = Math.min(rows.length, 50);
        for (let i = 0; i < scanLimit; i++) {
          const r = rows[i] as Record<string, any>;
          if (!r) {
            continue;
          }
          let val = r[colKey];
          if (subIndex !== undefined && Array.isArray(val)) {
            val = val[subIndex];
          }
          if (val !== null && val !== undefined) {
            const strVal =
              typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (strVal.length > dataLen) {
              dataLen = strVal.length;
            }
          }
        }
      }
      const dataWidth = dataLen * 8 + 25;
      return Math.max(60, Math.min(500, Math.max(headerWidth, dataWidth)));
    };
    try {
      let rawCols: any[] = [];
      if (isSelectNoRows) {
        rawCols = [
          {
            header: 'rowsReturned',
            accessorKey: 'rowsReturned',
            size: getColSize('rowsReturned'),
          },
          {
            header: 'columnCount',
            accessorKey: 'columnCount',
            size: getColSize('columnCount'),
          },
          {
            header: 'message',
            accessorKey: 'message',
            size: getColSize('message') + 100,
          },
        ];
      } else if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return [];
      } else {
        const firstRow = rows.find(
          (row) => row && typeof row === 'object',
        ) as Record<string, any>;
        if (!firstRow) {
          return [];
        }
        if (columnOrder && Array.isArray(columnOrder)) {
          rawCols = columnOrder.map((header, index) => {
            const safeHeader =
              header && String(header).trim().length > 0
                ? String(header)
                : '(No column name)';
            const colId = `col_${index}`;
            return {
              id: colId,
              header: safeHeader,
              size: getColSize(safeHeader, colId),
              accessorFn: (row: any) => row[colId],
              enableColumnFilter: true,
              filterFn: (row: any, id: string, filterValue: any[]) => {
                const val = row.original[colId];
                if (
                  (val === null || val === undefined) &&
                  (filterValue.includes(null) ||
                    filterValue.includes(undefined))
                ) {
                  return true;
                }
                return filterValue.includes(val);
              },
              cell: (info: any) => {
                const meta = info.table.options.meta as any;
                const rowIndex = info.row.index;
                const cId = info.column.id;
                const isEdited =
                  meta?.editedRowsRef?.current?.[rowIndex]?.[cId] !== undefined;
                const val = isEdited
                  ? meta.editedRowsRef.current[rowIndex][cId]
                  : info.getValue();
                const isEditingExternal =
                  meta?.editingCell?.r === rowIndex &&
                  meta?.editingCell?.cId === cId;
                return (
                  <EditableCell
                    initialValue={val}
                    row={info.row}
                    column={info.column}
                    updateData={meta?.updateData}
                    isEdited={isEdited}
                    badgeKeywords={meta?.badgeKeywords}
                    isEditingExternal={isEditingExternal}
                  />
                );
              },
            };
          });
        } else {
          rawCols = Object.keys(firstRow).flatMap((key, index) => {
            const isUnnamed = !key || key.trim() === '';
            const sampleValue = firstRow[key];
            if (Array.isArray(sampleValue)) {
              const headerLabel = isUnnamed ? '(No column name)' : key;
              return sampleValue.map((_, subIndex) => ({
                id: isUnnamed
                  ? `col_unnamed_${index}_${subIndex}`
                  : `${key}__dup_${subIndex}`,
                header: headerLabel,
                size: getColSize(headerLabel, key, subIndex),
                accessorFn: (row: any) => {
                  const val = row[key];
                  return Array.isArray(val) ? val[subIndex] : val;
                },
                enableColumnFilter: true,
                filterFn: (row: any, id: string, filterValue: any[]) => {
                  const arr = row.original[key];
                  const val = Array.isArray(arr) ? arr[subIndex] : arr;
                  if (
                    (val === null || val === undefined) &&
                    (filterValue.includes(null) ||
                      filterValue.includes(undefined))
                  ) {
                    return true;
                  }
                  return filterValue.includes(val);
                },
                cell: (info: any) => {
                  const meta = info.table.options.meta as any;
                  const rowIndex = info.row.index;
                  const cId = info.column.id;

                  const isEdited =
                    meta?.editedRows?.[rowIndex]?.[cId] !== undefined;
                  const val = isEdited
                    ? meta.editedRows[rowIndex][cId]
                    : info.getValue();

                  const isEditingExternal =
                    meta?.editingCell?.r === rowIndex &&
                    meta?.editingCell?.cId === cId;

                  return (
                    <EditableCell
                      initialValue={val}
                      row={info.row}
                      column={info.column}
                      table={info.table}
                      updateData={meta?.updateData}
                      isEdited={isEdited}
                      badgeKeywords={meta?.badgeKeywords}
                      isEditingExternal={isEditingExternal}
                    />
                  );
                },
              }));
            }
            const safeId = isUnnamed ? `col_unnamed_${index}` : key;
            const safeHeader = isUnnamed ? '(No column name)' : key;
            return [
              {
                id: safeId,
                header: safeHeader,
                size: getColSize(safeHeader, key),
                accessorFn: (row: any) => row[key],
                enableColumnFilter: true,
                filterFn: (row: any, id: string, filterValue: any[]) => {
                  const val = row.original[key];
                  if (
                    (val === null || val === undefined) &&
                    (filterValue.includes(null) ||
                      filterValue.includes(undefined))
                  ) {
                    return true;
                  }
                  return filterValue.includes(val);
                },
                cell: (info: any) => {
                  const meta = info.table.options.meta as any;
                  const rowIndex = info.row.index;
                  const cId = info.column.id;

                  const isEdited =
                    meta?.editedRows?.[rowIndex]?.[cId] !== undefined;
                  const val = isEdited
                    ? meta.editedRows[rowIndex][cId]
                    : info.getValue();

                  const isEditingExternal =
                    meta?.editingCell?.r === rowIndex &&
                    meta?.editingCell?.cId === cId;

                  return (
                    <EditableCell
                      initialValue={val}
                      row={info.row}
                      column={info.column}
                      table={info.table}
                      updateData={meta?.updateData}
                      isEdited={isEdited}
                      badgeKeywords={meta?.badgeKeywords}
                      isEditingExternal={isEditingExternal}
                    />
                  );
                },
              },
            ];
          });
        }
      }
      return rawCols;
    } catch (error) {
      console.error('Error generating columns:', error);
      return [];
    }
  }, [rows, isSelectNoRows, columnOrder]);
  const tableMeta = useMemo(
    () => ({
      editedRows,
      updateData,
      badgeKeywords,
      editingCell,
      setEditingCell,
      setSelection,
    }),
    [
      editedRows,
      updateData,
      badgeKeywords,
      editingCell,
      setEditingCell,
      setSelection,
    ],
  );
  const table = useReactTable({
    data: statusData,
    columns: columns,
    state: { sorting, columnFilters, columnSizing },
    columnResizeMode: 'onChange',
    meta: tableMeta,
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

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableWrapperRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: VIRTUAL_OVERSCAN,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  const topSpacerHeight = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const bottomSpacerHeight =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const colSpanCount = visibleColumns.length + 1;
  useEffect(() => {
    if (tableWrapperRef.current) {
      tableWrapperRef.current.scrollTop = 0;
      tableWrapperRef.current.scrollLeft = 0;
    }
    setSelection(null);
    setSorting([]);
    setColumnFilters([]);
    setColumnSizing({});
    setDragMode('none');
    setDragStart(null);
    setDragStartRow(null);
    setExportSqlText('📝 To Insert');
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
    if (!selection) {
      return;
    }
    const getVal = (r: number, cIdx: number) => {
      const cell = tableRows[r]?.getVisibleCells()[cIdx];
      let v = cell?.getValue();
      return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    };
    let rowsToText: string[] = [];
    if (selection.type === 'multi' && Array.isArray(selection.ranges)) {
      selection.ranges.forEach((range, idx) => {
        const { r1, c1, r2, c2 } = range;
        const minR = Math.min(r1, r2),
          maxR = Math.max(r1, r2);
        const minC = Math.min(c1, c2),
          maxC = Math.max(c1, c2);
        for (let r = minR; r <= maxR; r++) {
          const line = [];
          for (let c = minC; c <= maxC; c++) {
            if (visibleColumns[c]) {
              line.push(getVal(r, c));
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
      const minR = Math.min(r1, r2),
        maxR = Math.max(r1, r2);
      const minC = Math.min(c1, c2),
        maxC = Math.max(c1, c2);
      for (let r = minR; r <= maxR; r++) {
        const line = [];
        for (let c = minC; c <= maxC; c++) {
          if (visibleColumns[c]) {
            line.push(getVal(r, c));
          }
        }
        rowsToText.push(line.join('\t'));
      }
    } else if (
      selection.type === 'all' ||
      selection.type === 'row' ||
      selection.type === 'col'
    ) {
      let targetRows = tableRows;
      let targetCols = visibleColumns;
      if (selection.type === 'row' && selection.ids) {
        targetRows = tableRows.filter((_, i) => selection.ids!.has(i));
      }
      if (selection.type === 'col' && selection.ids) {
        targetCols = visibleColumns.filter((c) => selection.ids!.has(c.id));
      }
      rowsToText.push(targetCols.map((c) => c.columnDef.header).join('\t'));
      targetRows.forEach((r) => {
        const line = targetCols.map((c) => {
          let v = r
            .getVisibleCells()
            .find((cell) => cell.column.id === c.id)
            ?.getValue();
          return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        });
        rowsToText.push(line.join('\t'));
      });
    }
    window.navigator.clipboard.writeText(rowsToText.join('\n'));
  }, [selection, tableRows, visibleColumns]);
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (selection?.type === 'range' && selection.range) {
        const { r1, c1, r2, c2 } = selection.range;
        if (r1 === r2 && c1 === c2) {
          let nextR = r1;
          let nextC = c1;
          let moved = false;
          if (e.key === 'ArrowUp') {
            nextR = Math.max(0, r1 - 1);
            moved = true;
          } else if (e.key === 'ArrowDown') {
            nextR = Math.min(tableRows.length - 1, r1 + 1);
            moved = true;
          } else if (e.key === 'ArrowLeft') {
            nextC = Math.max(0, c1 - 1);
            moved = true;
          } else if (e.key === 'ArrowRight') {
            nextC = Math.min(visibleColumns.length - 1, c1 + 1);
            moved = true;
          }

          if (moved) {
            e.preventDefault();
            e.stopPropagation();
            setSelection({
              type: 'range',
              range: { r1: nextR, c1: nextC, r2: nextR, c2: nextC },
            });
            setEditingCell(null);

            const wrapper = tableWrapperRef.current as HTMLElement;
            if (wrapper) {
              rowVirtualizer.scrollToIndex(nextR, { align: 'auto' });

              const tdEl = wrapper.querySelector(
                `[data-r="${nextR}"][data-c="${nextC}"]`,
              ) as HTMLElement;
              if (tdEl) {
                const wrapperRect = wrapper.getBoundingClientRect();
                const tdRect = tdEl.getBoundingClientRect();
                if (tdRect.left < wrapperRect.left + 40) {
                  wrapper.scrollLeft -= wrapperRect.left + 40 - tdRect.left;
                } else if (tdRect.right > wrapperRect.right) {
                  wrapper.scrollLeft += tdRect.right - wrapperRect.right;
                }
              }
            }
          } else if (e.key === 'Enter' || e.key === 'F2') {
            e.preventDefault();
            e.stopPropagation();
            const colId = visibleColumns[c1]?.id;
            if (colId) {
              setEditingCell({ r: r1, cId: colId });
            }
          } else if (
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            e.stopPropagation();
            const colId = visibleColumns[c1]?.id;
            if (colId) {
              setEditingCell({ r: r1, cId: colId });
            }
          }
        }
      }
    },
    [handleCopy, selection, tableRows.length, visibleColumns, rowVirtualizer],
  );
  const onMouseDown = (r: number, c: number, isCtrl: boolean) => {
    tableWrapperRef.current?.focus();
    if (isCtrl && selection && selection.type === 'range' && selection.range) {
      setSelection((prev) => ({
        type: 'multi',
        ranges: prev?.range
          ? [prev.range, { r1: r, c1: c, r2: r, c2: c }]
          : [{ r1: r, c1: c, r2: r, c2: c }],
      }));
      setDragMode('cell');
      setDragStart({ r, c });
    } else if (
      isCtrl &&
      selection &&
      selection.type === 'multi' &&
      selection.ranges
    ) {
      setSelection((prev) => ({
        type: 'multi',
        ranges: [...(prev?.ranges || []), { r1: r, c1: c, r2: r, c2: c }],
      }));
      setDragMode('cell');
      setDragStart({ r, c });
    } else {
      setDragMode('cell');
      setDragStart({ r, c });
      setSelection({ type: 'range', range: { r1: r, c1: c, r2: r, c2: c } });
    }
  };
  const onMouseEnter = (r: number, c: number) => {
    if (dragMode === 'cell' && dragStart) {
      if (selection && selection.type === 'multi' && selection.ranges) {
        const updatedRanges = [...selection.ranges];
        updatedRanges[updatedRanges.length - 1] = {
          r1: dragStart.r,
          c1: dragStart.c,
          r2: r,
          c2: c,
        };
        const lastRange = selection.ranges[selection.ranges.length - 1];
        if (lastRange.r2 === r && lastRange.c2 === c) {
          return;
        }
        setSelection((prev) => ({ type: 'multi', ranges: updatedRanges }));
      } else {
        if (
          selection &&
          selection.range?.r2 === r &&
          selection.range?.c2 === c
        ) {
          return;
        }
        setSelection((prev) => ({
          type: 'range',
          range: { r1: dragStart.r, c1: dragStart.c, r2: r, c2: c },
        }));
      }
    }
  };
  const onRowMouseDown = (r: number, isCtrl: boolean) => {
    setDragMode('row');
    setDragStartRow(r);
    handleRowHeaderClick(r, isCtrl);
  };
  const onRowMouseEnter = (r: number) => {
    if (dragMode === 'row' && dragStartRow !== null) {
      const minR = Math.min(dragStartRow, r);
      const maxR = Math.max(dragStartRow, r);
      setSelection((prev) => {
        if (
          prev?.type === 'row' &&
          prev.ids &&
          prev.ids.size === maxR - minR + 1 &&
          prev.ids.has(r) &&
          prev.ids.has(dragStartRow)
        ) {
          return prev;
        }
        const newIds = new Set<number>();
        for (let i = minR; i <= maxR; i++) {
          newIds.add(i);
        }
        return { type: 'row', ids: newIds };
      });
    }
  };
  const handleCornerClick = () => setSelection({ type: 'all' });
  useEffect(() => {
    if (dragMode === 'none') {
      return;
    }
    let animationFrame: number;
    const wrapper = tableWrapperRef.current;
    let lastX = 0;
    let lastY = 0;
    let isScrolling = false;
    let lastSelectUpdate = 0;
    const handleMouseUpGlobal = () => {
      setDragMode('none');
      setDragStartRow(null);
    };
    const autoScroll = () => {
      if (!wrapper) {
        return;
      }
      const rect = (wrapper as HTMLElement).getBoundingClientRect();
      let scrollX = 0;
      let scrollY = 0;
      const edge = 40;
      const speed = 25;
      if (lastY > rect.bottom - edge) {
        scrollY = speed;
      } else if (lastY < rect.top + edge) {
        scrollY = -speed;
      }
      if (lastX > rect.right - edge) {
        scrollX = speed;
      } else if (lastX < rect.left + edge) {
        scrollX = -speed;
      }
      if (scrollX !== 0 || scrollY !== 0) {
        (wrapper as HTMLElement).scrollBy({ left: scrollX, top: scrollY });
        const now = Date.now();
        if (now - lastSelectUpdate > 50) {
          lastSelectUpdate = now;
          const el = window.document.elementFromPoint(lastX, lastY);
          if (el) {
            const td = el.closest('.sql-td');
            if (td) {
              if (dragMode === 'cell' && dragStart) {
                const rStr = td.getAttribute('data-r');
                const cStr = td.getAttribute('data-c');
                if (rStr && cStr) {
                  const r = parseInt(rStr, 10);
                  const c = parseInt(cStr, 10);
                  setSelection((prev) => {
                    if (prev?.type === 'multi' && prev.ranges) {
                      const lastRange = prev.ranges[prev.ranges.length - 1];
                      if (lastRange.r2 === r && lastRange.c2 === c) {
                        return prev;
                      }
                      const updatedRanges = [...prev.ranges];
                      updatedRanges[updatedRanges.length - 1] = {
                        r1: dragStart.r,
                        c1: dragStart.c,
                        r2: r,
                        c2: c,
                      };
                      return { type: 'multi', ranges: updatedRanges };
                    }
                    if (
                      prev?.type === 'range' &&
                      prev.range?.r2 === r &&
                      prev.range?.c2 === c
                    ) {
                      return prev;
                    }
                    return {
                      type: 'range',
                      range: { r1: dragStart.r, c1: dragStart.c, r2: r, c2: c },
                    };
                  });
                }
              } else if (dragMode === 'row' && dragStartRow !== null) {
                const rStr = td.getAttribute('data-row-index');
                if (rStr) {
                  const r = parseInt(rStr, 10);
                  const minR = Math.min(dragStartRow, r);
                  const maxR = Math.max(dragStartRow, r);
                  setSelection((prev) => {
                    if (
                      prev?.type === 'row' &&
                      prev.ids &&
                      prev.ids.size === maxR - minR + 1 &&
                      prev.ids.has(r) &&
                      prev.ids.has(dragStartRow)
                    ) {
                      return prev;
                    }
                    const newIds = new Set<number>();
                    for (let i = minR; i <= maxR; i++) {
                      newIds.add(i);
                    }
                    return { type: 'row', ids: newIds };
                  });
                }
              }
            }
          }
        }
        animationFrame = window.requestAnimationFrame(autoScroll);
      } else {
        isScrolling = false;
      }
    };
    const handleMouseMoveGlobal = (e: any) => {
      lastX = e.clientX || 0;
      lastY = e.clientY || 0;
      if (!isScrolling) {
        isScrolling = true;
        autoScroll();
      }
    };
    window.addEventListener('mouseup', handleMouseUpGlobal);
    window.addEventListener('mousemove', handleMouseMoveGlobal);
    return () => {
      window.removeEventListener('mouseup', handleMouseUpGlobal);
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [dragMode, dragStart, dragStartRow]);
  const handleRowHeaderClick = (idx: number, isCtrl: boolean) => {
    if (isCtrl && selection && selection.type === 'row' && selection.ids) {
      const newIds = new Set(selection.ids);
      if (newIds.has(idx)) {
        newIds.delete(idx);
      } else {
        newIds.add(idx);
      }
      setSelection(newIds.size > 0 ? { type: 'row', ids: newIds } : null);
    } else {
      setSelection({ type: 'row', ids: new Set([idx]) });
    }
  };
  const EMPTY_STYLE: React.CSSProperties = {};
  const SELECTION_STYLES = useMemo(() => {
    const styles: Record<number, React.CSSProperties> = {};
    for (let top = 0; top < 2; top++) {
      for (let bottom = 0; bottom < 2; bottom++) {
        for (let left = 0; left < 2; left++) {
          for (let right = 0; right < 2; right++) {
            let shadows = [];
            if (top) {
              shadows.push(`inset 0 1px 0 0 var(--selection-border)`);
            }
            if (bottom) {
              shadows.push(`inset 0 -1px 0 0 var(--selection-border)`);
            }
            if (left) {
              shadows.push(`inset 1px 0 0 0 var(--selection-border)`);
            }
            if (right) {
              shadows.push(`inset -1px 0 0 0 var(--selection-border)`);
            }
            const key = (top << 3) | (bottom << 2) | (left << 1) | right;
            styles[key] = {
              backgroundColor: 'var(--selection-bg-dim)',
              boxShadow: shadows.length > 0 ? shadows.join(', ') : undefined,
            };
          }
        }
      }
    }
    return styles;
  }, []);

  const selectionBoxes = useMemo(() => {
    if (!selection) {
      return [];
    }
    if (selection.type === 'all') {
      return [
        {
          minR: 0,
          maxR: tableRows.length - 1,
          minC: 0,
          maxC: visibleColumns.length - 1,
        },
      ];
    }
    if (selection.type === 'row' && selection.ids) {
      return Array.from(selection.ids).map((r) => ({
        minR: r,
        maxR: r,
        minC: 0,
        maxC: visibleColumns.length - 1,
      }));
    }
    if (selection.type === 'col' && selection.ids) {
      return Array.from(selection.ids).map((colId) => {
        const c = visibleColumns.findIndex((col) => col.id === colId);
        return { minR: 0, maxR: tableRows.length - 1, minC: c, maxC: c };
      });
    }
    if (selection.type === 'range' && selection.range) {
      const { r1, c1, r2, c2 } = selection.range;
      return [
        {
          minR: Math.min(r1, r2),
          maxR: Math.max(r1, r2),
          minC: Math.min(c1, c2),
          maxC: Math.max(c1, c2),
        },
      ];
    }
    if (selection.type === 'multi' && selection.ranges) {
      return selection.ranges.map(({ r1, c1, r2, c2 }) => ({
        minR: Math.min(r1, r2),
        maxR: Math.max(r1, r2),
        minC: Math.min(c1, c2),
        maxC: Math.max(c1, c2),
      }));
    }
    return [];
  }, [selection, tableRows.length, visibleColumns]);

  const getCellSelectionStyle = (
    r: number,
    c: number,
    colId: string,
  ): React.CSSProperties => {
    if (selectionBoxes.length === 0) {
      return EMPTY_STYLE;
    }

    for (const box of selectionBoxes) {
      if (r >= box.minR && r <= box.maxR && c >= box.minC && c <= box.maxC) {
        const top = r === box.minR ? 1 : 0;
        const bottom = r === box.maxR ? 1 : 0;
        const left = c === box.minC ? 1 : 0;
        const right = c === box.maxC ? 1 : 0;
        const key = (top << 3) | (bottom << 2) | (left << 1) | right;
        return SELECTION_STYLES[key];
      }
    }
    return EMPTY_STYLE;
  };
  const exportCSV = () => {
    if (postMessage) {
      const exportColumns = visibleColumns.map((c) =>
        String(c.columnDef.header ?? c.id),
      );
      const exportRows = tableRows.map((r) =>
        visibleColumns.map((c, i) => {
          const value = r.getVisibleCells()[i]?.getValue();
          return typeof value === 'object' ? JSON.stringify(value) : value;
        }),
      );
      const currentData = tableRows.map((r) => r.original);
      postMessage({
        type: 'export_data',
        payload: {
          data: currentData,
          columns: exportColumns,
          rows: exportRows,
          format: 'csv',
        },
      });
    }
  };
  const exportExcel = () => {
    if (postMessage) {
      const exportColumns = visibleColumns.map((c) =>
        String(c.columnDef.header ?? c.id),
      );
      const exportRows = tableRows.map((r) =>
        visibleColumns.map((c) => {
          const value = r
            .getVisibleCells()
            .find((cell) => cell.column.id === c.id)
            ?.getValue();
          return typeof value === 'object' ? JSON.stringify(value) : value;
        }),
      );
      const currentData = tableRows.map((r) => r.original);
      postMessage({
        type: 'export_data',
        payload: {
          data: currentData,
          columns: exportColumns,
          rows: exportRows,
          format: 'xlsx',
        },
      });
    }
  };
  const exportSQL = () => {
    const tableName = tableNameFromBackend;
    const exportColumns = visibleColumns.map((c) => {
      const header = String(c.columnDef.header ?? c.id);
      return header.match(/^[a-zA-Z0-9_]+$/) ? header : `[${header}]`;
    });
    const sqlRows = tableRows.map((r) => {
      const vals = visibleColumns.map((c, i) => {
        const val = r.getVisibleCells()[i]?.getValue();
        if (val === null || val === undefined) {
          return 'NULL';
        }
        if (typeof val === 'number') {
          return val;
        }
        if (typeof val === 'boolean') {
          return val ? 1 : 0;
        }
        if (typeof val === 'object') {
          return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
        }
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      return `  (${vals.join(', ')})`;
    });
    const chunkSize = 900;
    const chunks: string[] = [];
    for (let i = 0; i < sqlRows.length; i += chunkSize) {
      const chunk = sqlRows.slice(i, i + chunkSize);
      chunks.push(
        `INSERT INTO ${tableName} (${exportColumns.join(', ')})\nVALUES\n${chunk.join(',\n')};`,
      );
    }
    const sql = `-- Exported from SQL Notebook Pro\n${chunks.join('\n\n')}`;
    const blob = new Blob([sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName}_export.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportSqlText('✅ Exported');
    setTimeout(() => setExportSqlText('📝 To Insert'), 2000);
  };
  const generateUpdates = () => {
    const tableName = tableNameFromBackend;
    let pkCols =
      primaryKeysFromBackend.length > 0
        ? columns.filter((c: any) =>
            primaryKeysFromBackend.includes(c.header || c.id),
          )
        : [
            columns.find((c: any) => String(c.header).toLowerCase() === 'id') ||
              columns[0],
          ].filter(Boolean);
    if (!pkCols || pkCols.length === 0) {
      return;
    }
    const updates: string[] = [];
    Object.keys(editedRows).forEach((rIndexStr) => {
      const rIndex = parseInt(rIndexStr, 10);
      const changes = editedRows[rIndex];
      const originalRow = rows[rIndex] as Record<string, any>;
      const hasAllPks = pkCols.every(
        (pkColDef: any) => originalRow[pkColDef.id] !== undefined,
      );
      if (!hasAllPks) {
        return;
      }
      const setClauses = Object.entries(changes).map(([colId, val]) => {
        const safeVal =
          val === null || val === undefined
            ? 'NULL'
            : `'${String(val).replace(/'/g, "''")}'`;
        const colDef = columns.find((c: any) => c.id === colId) as any;
        const colName = String(colDef ? (colDef.header ?? colId) : colId);
        const safeCol = colName.match(/^[a-zA-Z0-9_]+$/)
          ? colName
          : `[${colName}]`;
        return `${safeCol} = ${safeVal}`;
      });
      if (setClauses.length === 0) {
        return;
      }
      const whereClauses = pkCols.map((pkColDef: any) => {
        const pkValue = originalRow[pkColDef.id];
        const safePkVal =
          typeof pkValue === 'number'
            ? pkValue
            : `'${String(pkValue).replace(/'/g, "''")}'`;
        const pkColName = String(pkColDef.header ?? pkColDef.id);
        const safePkCol = pkColName.match(/^[a-zA-Z0-9_]+$/)
          ? pkColName
          : `[${pkColName}]`;
        return `${safePkCol} = ${safePkVal}`;
      });
      updates.push(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')};`,
      );
    });
    if (updates.length > 0) {
      const finalSql = updates.join('\n');
      if (postMessage) {
        setSaveBtnText('Saving...');
        postMessage({
          type: 'apply_updates',
          payload: { sql: finalSql, tableId: componentIdRef.current },
        });

        setSaveBtnText('✅ Saved!');
        const updatedRows = [...rows];
        Object.keys(editedRows).forEach((rIndexStr) => {
          const rIndex = parseInt(rIndexStr, 10);
          updatedRows[rIndex] = {
            ...(updatedRows[rIndex] as Record<string, any>),
            ...editedRows[rIndex as any],
          };
        });
        setRows(updatedRows);
        setTimeout(() => {
          setSaveBtnText('💾 Save Changes');
          setEditedRows({});
        }, 2000);
      }
    } else {
      setSaveBtnText('No Changes');
    }
  };

  useEffect(() => {
    if (!onDidReceiveMessage) {
      return;
    }
    const disposable = onDidReceiveMessage((eventOrMessage: any) => {
      const e = eventOrMessage.data ? eventOrMessage.data : eventOrMessage;
      console.log('Received message in renderer:', e);
      if (e.type === 'apply_updates_result') {
        if (e.payload.tableId && e.payload.tableId !== componentIdRef.current) {
          return;
        }
        if (!e.payload.success) {
          setSaveBtnText('❌ Error');
          setTimeout(() => setSaveBtnText('💾 Save Changes'), 3000);
        }
      }
    });
    return () => {
      if (disposable && typeof (disposable as any).dispose === 'function') {
        (disposable as any).dispose();
      }
    };
  }, [onDidReceiveMessage]);

  const containerMinHeight = activeMenuId ? 360 : 'auto';
  return (
    <div
      ref={containerRef}
      className="sql-grid-container"
      style={
        {
          minHeight: containerMinHeight,
          '--selection-border': themeColor,
          '--selection-bg-dim': themeBgDim,
        } as React.CSSProperties
      }
    >
      <style>{styles}</style>
      <div className="toolbar">
        <span style={{ fontSize: 11, fontWeight: 'bold' }}>
          {isTruncated
            ? `${tableRows.length.toLocaleString()} rows shown of ${totalRowsFromBackend.toLocaleString()} total`
            : `${tableRows.length.toLocaleString()} rows`}
        </span>
        <span className="toolbar-time">🕒 {runTime}</span>
        <span className="toolbar-time">📅 {runDate}</span>
        <ThemeColorPicker color={themeColor} onChange={handleColorChange} />
        <div style={{ flex: 1 }} />
        {!isSelectNoRows && (
          <>
            {(Object.keys(editedRows).length > 0 ||
              ['Saving...', '✅ Saved!', '✔ Saved!', '❌ Error'].includes(
                saveBtnText,
              )) && (
              <button
                className="btn-action"
                onClick={generateUpdates}
                title="Generate UPDATE script"
                style={{
                  color: saveBtnText.includes('Error')
                    ? '#f48771'
                    : saveBtnText.includes('Saved')
                      ? '#89d185'
                      : '#d7ba7d',
                  borderColor: saveBtnText.includes('Error')
                    ? '#f48771'
                    : saveBtnText.includes('Saved')
                      ? '#89d185'
                      : '#d7ba7d',
                }}
              >
                {saveBtnText}
              </button>
            )}
            <button
              className="btn-action"
              onClick={exportSQL}
              title="Export as SQL To Insert to File"
            >
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
      {isTruncated && !isSelectNoRows && (
        <div className="dataset-warning">
          {`This notebook is limited to ${tableRows.length.toLocaleString()} rows by the "SQL Notebook: Max Result Rows" setting. The query returned ${totalRowsFromBackend.toLocaleString()} rows. Increase that setting to view more rows here.`}
        </div>
      )}
      <div
        ref={tableWrapperRef}
        className="table-wrapper"
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
      >
        <div
          role="table"
          className="sql-grid-table"
          style={{
            gridTemplateColumns: `max-content ${visibleColumns
              .map((column) => {
                const isResized =
                  table.getState().columnSizing[column.id] !== undefined;
                return isResized
                  ? `${column.getSize()}px`
                  : `minmax(min-content, 1fr)`;
              })
              .join(' ')}`,
          }}
        >
          <div role="rowgroup" className="sql-thead">
            {table.getHeaderGroups().map((hg) => (
              <div role="row" className="sql-tr" key={hg.id}>
                <div
                  role="columnheader"
                  className="sql-th corner-header"
                  onClick={handleCornerClick}
                >
                  ◢
                </div>
                {visibleColumns.map((column) => {
                  const header = hg.headers.find(
                    (h) => h.column.id === column.id,
                  );
                  if (!header) {
                    return null;
                  }
                  const customWidth = column.getSize();
                  return (
                    <div
                      role="columnheader"
                      key={header.id}
                      className={`sql-th${
                        selection &&
                        selection.type === 'col' &&
                        selection.ids?.has(header.id)
                          ? ' selected-bg'
                          : ''
                      }`}
                      style={{
                        position: 'relative',
                      }}
                    >
                      <div
                        className="th-content"
                        onClick={(e) => {
                          const isMulti = e.ctrlKey || e.metaKey;
                          const colId = header.id;
                          setSelection((prev) => {
                            if (
                              !isMulti ||
                              !prev ||
                              prev.type !== 'col' ||
                              !prev.ids
                            ) {
                              return { type: 'col', ids: new Set([colId]) };
                            }
                            const newIds = new Set(prev.ids);
                            if (newIds.has(colId)) {
                              newIds.delete(colId);
                            } else {
                              newIds.add(colId);
                            }
                            return newIds.size > 0
                              ? { type: 'col', ids: newIds }
                              : null;
                          });
                        }}
                      >
                        <div
                          className="th-text-group"
                          onClick={(e) => handleSortClick(header.column, e)}
                          title="Click para ordenar"
                        >
                          <span className="th-title">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </span>
                          <span className="th-sort-icon">
                            {{ asc: ' ▲', desc: ' ▼' }[
                              header.column.getIsSorted() as string
                            ] ?? ''}
                          </span>
                        </div>
                        <FilterMenu
                          column={header.column}
                          isOpen={activeMenuId === header.id}
                          onToggle={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(
                              activeMenuId === header.id ? null : header.id,
                            );
                          }}
                          onClose={() => setActiveMenuId(null)}
                        />
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const colId = header.column.id;
                            const resizerDiv =
                              e.currentTarget as HTMLDivElement;
                            const thContent =
                              resizerDiv.parentElement as HTMLElement;
                            const titleSpan = thContent?.querySelector(
                              '.th-title',
                            ) as HTMLSpanElement | null;
                            const canvas =
                              window.document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                              return;
                            }
                            const headerText =
                              titleSpan?.textContent ||
                              String(header.column.id);
                            ctx.font =
                              '600 13px var(--vscode-editor-font-family, Consolas), monospace';
                            const headerTextWidth =
                              ctx.measureText(headerText).width;
                            const finalHeaderWidth = headerTextWidth + 40;
                            ctx.font =
                              '13px var(--vscode-editor-font-family, Consolas), monospace';
                            let textWidthData = 0;
                            const rowsToScan = tableRows.slice(0, 500);
                            for (const r of rowsToScan) {
                              const val = r.getValue(colId);
                              if (val !== null && val !== undefined) {
                                const strVal =
                                  typeof val === 'object'
                                    ? JSON.stringify(val)
                                    : String(val);
                                const w = ctx.measureText(strVal).width;
                                if (w > textWidthData) {
                                  textWidthData = w;
                                }
                              }
                            }
                            const finalDataWidth = textWidthData + 20;
                            const newWidth = Math.min(
                              400,
                              Math.max(60, finalHeaderWidth, finalDataWidth),
                            );
                            setColumnSizing((old) => ({
                              ...old,
                              [header.id]: newWidth,
                            }));
                          }}
                          className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag to resize, Double-click to auto-fit"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div
            role="rowgroup"
            className="sql-tbody"
            onMouseDown={(e) => {
              const td = (e.target as HTMLElement).closest('.sql-td');
              if (!td) {
                return;
              }
              if (td.classList.contains('row-index')) {
                const rStr = td.getAttribute('data-row-index');
                if (rStr) {
                  onRowMouseDown(parseInt(rStr, 10), e.ctrlKey || e.metaKey);
                }
                return;
              }
              const rStr = td.getAttribute('data-r');
              const cStr = td.getAttribute('data-c');
              if (rStr && cStr) {
                onMouseDown(
                  parseInt(rStr, 10),
                  parseInt(cStr, 10),
                  e.ctrlKey || e.metaKey,
                );
              }
            }}
            onMouseOver={(e) => {
              const td = (e.target as HTMLElement).closest('.sql-td');
              if (!td) {
                return;
              }
              if (td.classList.contains('row-index')) {
                const rStr = td.getAttribute('data-row-index');
                if (rStr) {
                  onRowMouseEnter(parseInt(rStr, 10));
                }
                return;
              }
              const rStr = td.getAttribute('data-r');
              const cStr = td.getAttribute('data-c');
              if (rStr && cStr) {
                onMouseEnter(parseInt(rStr, 10), parseInt(cStr, 10));
              }
            }}
          >
            {virtualRows.length > 0 && topSpacerHeight > 0 && (
              <div role="row" className="sql-tr" aria-hidden="true">
                <div
                  role="cell"
                  className="sql-td virtual-spacer-cell"
                  style={{
                    height: `${topSpacerHeight}px`,
                    minHeight: `${topSpacerHeight}px`,
                    maxHeight: `${topSpacerHeight}px`,
                    gridColumn: '1 / -1',
                  }}
                />
              </div>
            )}
            {virtualRows.map((virtualRow) => {
              const rIndex = virtualRow.index;
              const row = tableRows[rIndex];
              const isRowSelected =
                selection &&
                selection.type === 'row' &&
                selection.ids?.has(rIndex);

              return (
                <div role="row" className="sql-tr" key={row.id}>
                  <MemoRowIndex rIndex={rIndex} isSelected={isRowSelected} />
                  {visibleColumns.map((column, colIndex) => {
                    const cell = row.getVisibleCells()[colIndex];
                    if (!cell) {
                      return null;
                    }
                    const customWidth = column.getSize();
                    const selectionStyle = getCellSelectionStyle(
                      rIndex,
                      colIndex,
                      cell.column.id,
                    );
                    const isEdited =
                      editedRows[rIndex]?.[cell.column.id] !== undefined;
                    return (
                      <MemoTd
                        key={cell.id}
                        cell={cell}
                        rIndex={rIndex}
                        cIndex={colIndex}
                        colId={cell.column.id}
                        customWidth={customWidth}
                        selectionStyle={selectionStyle}
                        isEdited={isEdited}
                      />
                    );
                  })}
                </div>
              );
            })}
            {virtualRows.length > 0 && bottomSpacerHeight > 0 && (
              <div role="row" className="sql-tr" aria-hidden="true">
                <div
                  role="cell"
                  className="sql-td virtual-spacer-cell"
                  style={{
                    height: `${bottomSpacerHeight}px`,
                    minHeight: `${bottomSpacerHeight}px`,
                    maxHeight: `${bottomSpacerHeight}px`,
                    gridColumn: '1 / -1',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
const ExecutionPlanApp: React.FC<{ data: any }> = ({ data }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderNode = (node: any, depth: number, id: string) => {
    let title = 'Node';
    let details: any = { ...node };
    let children: any[] = [];

    if (data.driver === 'postgres') {
      title = node['Node Type'] || 'Node';
      delete details['Plans'];
      children = node['Plans'] || [];
    } else {
      title =
        typeof node === 'object' && node !== null
          ? node.StmtText ||
            node.PhysicalOp ||
            node.LogicalOp ||
            (node.id !== undefined ? `Node ${node.id}` : 'Plan Node')
          : 'Value';
      if (node && typeof node === 'object') {
        Object.keys(node).forEach((k) => {
          if (Array.isArray(node[k])) {
            children = children.concat(node[k]);
            delete details[k];
          }
        });
      }
    }

    const isExpanded = expanded[id] !== false;

    return (
      <div
        key={id}
        style={{
          marginLeft: depth > 0 ? '24px' : '0',
          marginTop: '12px',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          fontSize: '12px',
        }}
      >
        <div
          onClick={() => toggle(id)}
          style={{
            cursor: 'pointer',
            padding: '8px 12px',
            backgroundColor:
              'var(--vscode-list-inactiveSelectionBackground, #37373d)',
            border: '1px solid var(--vscode-panel-border, #454545)',
            borderLeft: '4px solid var(--vscode-charts-blue, #0078d4)',
            borderRadius: '6px',
            display: 'inline-flex',
            alignItems: 'center',
            minWidth: '250px',
            userSelect: 'none',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <span style={{ fontSize: '14px', marginRight: '8px' }}>⚡</span>
          <span
            style={{
              flex: 1,
              fontWeight: 'bold',
              color: 'var(--vscode-foreground)',
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: '10px',
              marginLeft: '16px',
              color: 'var(--vscode-descriptionForeground)',
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
        {isExpanded && (
          <div
            style={{
              padding: '12px 0 12px 20px',
              borderLeft: '2px dashed var(--vscode-panel-border, #454545)',
              marginLeft: '12px',
              marginTop: '4px',
            }}
          >
            <div
              style={{
                backgroundColor:
                  'var(--vscode-editor-background, rgba(0,0,0,0.2))',
                padding: '12px',
                borderRadius: '4px',
                border: '1px solid var(--vscode-panel-border)',
              }}
            >
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {Object.keys(details)
                    .filter((k) => details[k] !== null && details[k] !== '')
                    .map((k) => (
                      <tr key={k}>
                        <td
                          style={{
                            padding: '4px 8px',
                            fontWeight: 'bold',
                            color: 'var(--vscode-textPreformat-foreground)',
                            borderBottom:
                              '1px solid var(--vscode-panel-border)',
                            width: '30%',
                          }}
                        >
                          {k}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            color: 'var(--vscode-foreground)',
                            borderBottom:
                              '1px solid var(--vscode-panel-border)',
                          }}
                        >
                          {typeof details[k] === 'object'
                            ? JSON.stringify(details[k])
                            : String(details[k])}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {children.map((c, i) => renderNode(c, depth + 1, `${id}-${i}`))}
          </div>
        )}
      </div>
    );
  };

  let rootNode = data.data;
  if (data.driver === 'postgres' && Array.isArray(data.data)) {
    rootNode = data.data[0]?.Plan || data.data;
  }

  return (
    <div
      style={{
        padding: '16px',
        background: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #cccccc)',
        overflow: 'auto',
        maxHeight: '500px',
      }}
    >
      <h3
        style={{
          marginTop: 0,
          marginBottom: '16px',
          color: 'var(--vscode-textLink-foreground, #0078d4)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 1L12.5 1.5L12.5 4.5L12 5L10 5L10 9L11 9L11.5 9.5L11.5 12.5L11 13L5 13L4.5 12.5L4.5 9.5L5 9L6 9L6 5L4 5L3.5 4.5L3.5 1.5L4 1L12 1ZM10 2L10 4L11.5 4L11.5 2L10 2ZM6 2L6 4L8 4L8 2L6 2ZM4.5 4L4.5 2L5 2L5 4L4.5 4ZM5 10L5 12L11 12L11 10L5 10Z"
          />
        </svg>
        Execution Plan (Tree View)
      </h3>
      {Array.isArray(rootNode)
        ? rootNode.map((n, i) => renderNode(n, 0, `root-${i}`))
        : renderNode(rootNode, 0, 'root')}
    </div>
  );
};

const roots = new WeakMap<HTMLElement, Root>();
export const activate: ActivationFunction = (context) => {
  return {
    renderOutputItem(data, element) {
      const json = data.json();
      if (json && json.kind === 1 && json.attachments) {
        json.value = injectAttachmentsIntoMarkdown(
          json.value,
          json.attachments,
        );
      }
      let root = roots.get(element);
      if (!root) {
        root = createRoot(element);
        roots.set(element, root);
      }
      if (json && json.isExplainPlan) {
        root.render(<ExecutionPlanApp data={json} />);
      } else {
        root.render(
          <TableApp
            data={json}
            postMessage={context.postMessage}
            onDidReceiveMessage={context.onDidReceiveMessage}
          />,
        );
      }
    },
    disposeOutputItem(id) {},
  };
};
