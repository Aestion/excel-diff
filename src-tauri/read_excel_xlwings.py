"""
Read Excel file using xlwings (Excel COM)
Produces the same JSON output format as read_excel.py
"""
import sys
import json
import xlwings as xw


def get_val(value):
    """Normalize cell value for JSON serialization"""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return value
    return str(value)


def main():
    if len(sys.argv) < 2:
        print("Usage: python read_excel_xlwings.py <file_path>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    app = None

    try:
        app = xw.App(visible=False)
        app.calculation = 'automatic'
        app.display_alerts = False

        book = app.books.open(file_path)
        # Force calculation of all formulas
        app.calculate()

        sheet_names = [s.name for s in book.sheets]
        sheets = []

        for sheet in book.sheets:
            # Get used range
            used = sheet.used_range
            if used is None:
                sheets.append({
                    "name": sheet.name,
                    "columns": [],
                    "rows": []
                })
                continue

            row_count = used.rows.count
            col_count = used.columns.count

            if row_count == 0 or col_count == 0:
                sheets.append({
                    "name": sheet.name,
                    "columns": [],
                    "rows": []
                })
                continue

            # Build columns from row 2. Row 1 is an optional note row in these config sheets.
            header_row = 2 if row_count >= 2 else 1
            columns = []
            for col_idx in range(1, col_count + 1):
                val = used(header_row, col_idx).value
                name = get_val(val) or f"Column {col_idx}"
                columns.append({"index": col_idx - 1, "name": str(name), "dataType": "mixed"})

            # Build rows - read each cell individually to get both value and formula
            rows = []
            for row_idx in range(1, row_count + 1):
                row_data = []
                for col_idx in range(1, col_count + 1):
                    cell = used(row_idx, col_idx)
                    cell_obj = {"value": get_val(cell.value)}

                    # Check if this cell has a formula
                    try:
                        cell_formula = cell.formula
                        if isinstance(cell_formula, str) and cell_formula.startswith('='):
                            cell_obj["formula"] = cell_formula
                    except Exception:
                        pass

                    row_data.append(cell_obj)
                rows.append(row_data)

            sheets.append({"name": sheet.name, "columns": columns, "rows": rows})

        book.close()

        result = {
            "filePath": file_path,
            "sheets": sheets,
            "sheetNames": sheet_names
        }

        json_str = json.dumps(result, ensure_ascii=True)
        sys.stdout.buffer.write(json_str.encode('utf-8'))
        sys.stdout.flush()

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
