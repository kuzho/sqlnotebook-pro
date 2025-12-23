import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import * as XLSX from 'xlsx';
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
    --font-family: 'Segoe UI', 'SF Mono', Consolas, 'Courier New', monospace;
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
    padding: 4px 8px;
    background: #333333;
    border-bottom: 1px solid var(--grid-border);
    display: flex;
    gap: 8px;
    align-items: center;
    height: 28px;
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
`;

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

  const uniqueValues = useMemo(() => {
  const unique = column.getFacetedUniqueValues?.();
  if (!unique || typeof unique.keys !== 'function') return [];

  return Array.from(unique.keys()).map(val => {
    const label =
      val === null || val === undefined
        ? '(Vacío)'
        : String(val);
    return { raw: val, label };
  }).sort((a, b) => a.label.localeCompare(b.label));
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
      if (left < 0) left = rect.left;

      setCoords({
        x: left,
        y: showAbove ? rect.top : rect.bottom,
        alignTop: showAbove
      });
      setSearch("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
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

const TableApp = ({ data }: { data: any[] }) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const runTime = useMemo(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), []);

  const [selection, setSelection] = useState<{
    type: 'all' | 'row' | 'col' | 'range',
    ids?: Set<any>,
    range?: { r1: number, c1: number, r2: number, c2: number }
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{r: number, c: number} | null>(null);

  const isSelectNoRows =
  Array.isArray(data) &&
  (
    data.length === 0 ||
    data.every(
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
  : data;

  const columns = useMemo(() => {
    try {
      if (isSelectNoRows) {
        return [
          { header: 'rowsReturned', accessorKey: 'rowsReturned' },
          { header: 'columnCount', accessorKey: 'columnCount' },
          { header: 'message', accessorKey: 'message' }
        ];
      }
      if (!data || !Array.isArray(data) || data.length === 0) return [];

      const firstRow = data.find(row => row && typeof row === 'object');
      if (!firstRow) return [];

      return Object.keys(firstRow).map((key, index) => {
        const isUnnamed = !key || key.trim() === '';
        const safeId = isUnnamed ? `col_unnamed_${index}` : key;
        const safeHeader = isUnnamed ? '(No column name)' : key;

        return {
          id: safeId,
          header: safeHeader,
          accessorFn: (row: any) => row[key],
          enableColumnFilter: true,
          filterFn: (row: any, id: string, filterValue: any[]) => {
            return filterValue.includes(row.original[key]);
          },
          cell: (info: any) => {
            const val = info.getValue();
            if (val === null) return <span style={{ opacity: 0.5, fontStyle: 'italic' }}>NULL</span>;
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }
        };
      });
    } catch (error) {
        console.error("Error generating columns:", error);
        return []; 
      }
    }, [data, isSelectNoRows]);

  const table = useReactTable({
    data: statusData,
    columns: columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const rows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleFlatColumns();

  const handleSortClick = (column: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const isSorted = column.getIsSorted();
    if (!isSorted) {
      column.toggleSorting(false);
    } else if (isSorted === 'asc') {
      column.toggleSorting(true);
    } else {
      column.toggleSorting(false);
    }
  };

const handleCopy = useCallback(() => {
  if (!selection) return;

  const getVal = (r: number, cId: string) => {
    const cell = rows[r]?.getVisibleCells().find(c => c.column.id === cId);
    let v = cell?.getValue();
    return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
  };

  let rowsToText: string[] = [];

  if (selection.type === 'range' && selection.range) {
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
    let targetRows = rows;
    let targetCols = visibleColumns;

    if (selection.type === 'row' && selection.ids) {
      targetRows = rows.filter((_, i) => selection.ids!.has(i));
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
}, [selection, rows, visibleColumns]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if((e.ctrlKey||e.metaKey)&&e.key==='c') { e.preventDefault(); handleCopy(); }};
    window.addEventListener('keydown', k); return ()=>window.removeEventListener('keydown', k);
  }, [handleCopy]);

  const onMouseDown = (r:number, c:number) => { setIsDragging(true); setDragStart({r,c}); setSelection({type:'range', range:{r1:r,c1:c,r2:r,c2:c}}); };
  const onMouseEnter = (r:number, c:number) => { if(isDragging && dragStart) setSelection({type:'range', range:{r1:dragStart.r,c1:dragStart.c,r2:r,c2:c}}); };
  const onMouseUp = () => setIsDragging(false);
  const handleCornerClick = () => setSelection({type:'all'});
  const handleRowHeaderClick = (idx: number) => setSelection({type:'row', ids: new Set([idx])});

  const getCellClass = (r:number, c:number, colId: string) => {
    if (!selection) return '';
    let isSel = false;
    if (selection.type==='all') isSel=true;
    if (selection.type==='row' && selection.ids?.has(r)) isSel=true;
    if (selection.type==='col' && selection.ids?.has(colId)) isSel=true;
    if (selection.type==='range' && selection.range) {
      const {r1,c1,r2,c2}=selection.range;
      if (r>=Math.min(r1,r2) && r<=Math.max(r1,r2) && c>=Math.min(c1,c2) && c<=Math.max(c1,c2)) isSel=true;
    }
    let borders = '';
    if(isSel && selection.type==='range' && selection.range) {
       const {r1,c1,r2,c2}=selection.range;
       const minR=Math.min(r1,r2), maxR=Math.max(r1,r2), minC=Math.min(c1,c2), maxC=Math.max(c1,c2);
       if(r===minR) borders+='bt '; if(r===maxR) borders+='bb '; if(c===minC) borders+='bl '; if(c===maxC) borders+='br ';
    }
    return isSel ? `selected-bg ${borders}` : '';
  };

  const getFileDate = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  };

  const exportCSV = () => {
    const headers = columns.map(c => c.header).join(',');
    const csv = rows.map(r => r.getVisibleCells().map(c => `"${String(c.getValue()??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const date = getFileDate();
    const b = new Blob([`${headers}\n${csv}`],{type:'text/csv'});
    const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = `Results_${date}.csv`; l.click();
  };

  const exportExcel = () => {
    const ws=XLSX.utils.json_to_sheet(data); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Data");const date = getFileDate();XLSX.writeFile(wb, `Results_${date}.xlsx`);
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
        <span style={{fontSize:11, fontWeight:'bold'}}>{rows.length} rows</span>
        <span className="toolbar-time">
           🕒 {runTime}
        </span>
        <div style={{flex:1}}/>
        {!isSelectNoRows && (
          <>
            <button className="btn-action" onClick={exportExcel}>📊 Excel</button>
            <button className="btn-action" onClick={exportCSV}>📄 CSV</button>
          </>
        )}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                <th className="corner-header" onClick={handleCornerClick}>◢</th>
                {hg.headers.map(header => (
                  <th key={header.id} className={selection?.type==='col' && selection.ids?.has(header.id) ? 'selected-bg' : ''}>

                    <div
                        className="th-content"
                        onClick={() => setSelection({ type: 'col', ids: new Set([header.id]) })}
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
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, rIndex) => (
              <tr key={row.id}>
                <td className={`row-index ${selection?.type==='row' && selection.ids?.has(rIndex)?'selected-bg':''}`}
                    onClick={()=>handleRowHeaderClick(rIndex)}>{rIndex + 1}</td>
                {row.getVisibleCells().map((cell, cIndex) => (
                  <td key={cell.id}
                      className={getCellClass(rIndex, cIndex, cell.column.id)}
                      onMouseDown={()=>onMouseDown(rIndex, cIndex)}
                      onMouseEnter={()=>onMouseEnter(rIndex, cIndex)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
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
      try { ReactDOM.unmountComponentAtNode(element); } catch(e){}
      element.innerHTML = '';
      ReactDOM.render(<TableApp data={json} />, element);
    }
  };
};