# -*- coding: utf-8 -*-
"""
Excel writer using xlwings (Excel COM)
Supports the same JSON input format as write_excel.py
"""
import sys
import json
import xlwings as xw


def is_empty(v):
    return v is None or (isinstance(v, str) and v.strip() == "")


def set_cell(cell, val, formula=None):
    """Set cell value, with optional formula"""
    if formula:
        cell.formula = formula
    elif is_empty(val):
        cell.value = None
    elif isinstance(val, (int, float)):
        cell.value = val
    elif isinstance(val, bool):
        cell.value = val
    else:
        cell.value = str(val)


def detect_mode(data):
    """Detect if data is full-sheet, incremental, or copy-from-source"""
    sheets = data.get('sheets', [])
    if 'sourceFile' in data:
        return 'copy'
    if not sheets:
        return 'unknown'
    first = sheets[0]
    if 'changes' in first or 'insert_rows' in first:
        return 'incremental'
    if 'rows' in first:
        return 'full'
    return 'unknown'


def write_full(book, data):
    """Full sheet write mode"""
    for sheet_data in data['sheets']:
        sheet_name = sheet_data['name']
        rows = sheet_data['rows']

        if sheet_name in [s.name for s in book.sheets]:
            sheet = book.sheets[sheet_name]
        else:
            sheet = book.sheets.add(sheet_name)

        # Write all cells
        for ri, row in enumerate(rows, start=1):
            for ci, cell_data in enumerate(row, start=1):
                if isinstance(cell_data, dict):
                    val = cell_data.get('value')
                    formula = cell_data.get('formula')
                    set_cell(sheet.range((ri, ci)), val, formula)
                else:
                    set_cell(sheet.range((ri, ci)), cell_data)

        # Clear extra rows
        max_row_to_keep = len(rows)
        used = sheet.used_range
        if used and used.rows.count > max_row_to_keep:
            for ri in range(max_row_to_keep + 1, used.rows.count + 1):
                for ci in range(1, used.columns.count + 1):
                    sheet.range((ri, ci)).value = None


def write_incremental(book, data):
    """Incremental mode — only modify changed cells"""
    for sheet_change in data['sheets']:
        sheet_name = sheet_change['name']
        sheet_names = [s.name for s in book.sheets]
        if sheet_name in sheet_names:
            sheet = book.sheets[sheet_name]
        else:
            sheet = book.sheets.add(sheet_name)

        # Apply cell changes
        for change in sheet_change.get('changes', []):
            val = change.get('value')
            formula = change.get('formula')
            set_cell(sheet.range((change['row'], change['col'])), val, formula)

        # Insert new rows at the end
        for row_data in sheet_change.get('insert_rows', []):
            new_row = sheet.used_range.rows.count + 1 if sheet.used_range else 1
            for ci, cell_data in enumerate(row_data, start=1):
                if isinstance(cell_data, dict):
                    val = cell_data.get('value')
                    formula = cell_data.get('formula')
                    set_cell(sheet.range((new_row, ci)), val, formula)
                else:
                    set_cell(sheet.range((new_row, ci)), cell_data)

        # Clear deleted rows
        for row_idx in sheet_change.get('delete_rows', []):
            used = sheet.used_range
            if used and used.columns.count > 0:
                for ci in range(1, used.columns.count + 1):
                    sheet.range((row_idx, ci)).value = None


def write_copy_from_source(book, data):
    """Copy mode - copy rows from source file while preserving formulas/styles"""
    source_file = data['sourceFile']
    src_app = None
    try:
        src_app = xw.App(visible=False)
        src_app.calculation = 'manual'
        src_app.display_alerts = False
        src_book = src_app.books.open(source_file)

        for copy_op in data.get('copyRows', []):
            sheet_name = copy_op['sheetName']
            source_row = copy_op['sourceRow']
            target_row = copy_op['targetRow']

            src_sheet_names = [s.name for s in src_book.sheets]
            if sheet_name not in src_sheet_names:
                continue

            dst_sheet_names = [s.name for s in book.sheets]
            if sheet_name not in dst_sheet_names:
                book.sheets.add(sheet_name)

            src_sheet = src_book.sheets[sheet_name]
            dst_sheet = book.sheets[sheet_name]

            # Copy entire row using xlwings range copy (preserves styles)
            if source_row <= src_sheet.used_range.rows.count:
                src_range = src_sheet.range((source_row, 1)).expand('right')
                dst_range = dst_sheet.range((target_row, 1))
                src_range.copy(destination=dst_range)

        src_book.close()
    finally:
        if src_app is not None:
            try:
                src_app.quit()
            except Exception:
                pass


def main():
    if len(sys.argv) < 3:
        print("Usage: python write_excel_xlwings.py <file_path> <json_file>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    json_path = sys.argv[2]
    app = None

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        app = xw.App(visible=False)
        app.calculation = 'manual'
        app.display_alerts = False

        book = app.books.open(file_path)

        mode = detect_mode(data)
        if mode == 'full':
            write_full(book, data)
        elif mode == 'incremental':
            write_incremental(book, data)
        elif mode == 'copy':
            write_copy_from_source(book, data)
        else:
            print("Unknown data format", file=sys.stderr)
            book.close()
            sys.exit(1)

        book.save()
        book.close()
        print("OK", flush=True)

    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        if app is not None:
            try:
                app.quit()
            except Exception:
                pass


if __name__ == '__main__':
    main()
