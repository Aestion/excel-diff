"""
End-to-end test suite for excel-diff-cli.
Run: python tests/run_tests.py

Tests the full pipeline:
1. list files
2. read files
3. diff files
4. write files (merge)
5. verify merge result
"""
import subprocess
import json
import os
import sys
import shutil

CLI = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'target', 'debug', 'ExcelDiffCli.exe')
if not os.path.exists(CLI):
    CLI = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'target', 'debug', 'ExcelDiffCli')

TEST_DIR = os.path.join(os.environ.get('TEMP', '/tmp'), 'excel-diff-test')
OLD_DIR = os.path.join(TEST_DIR, 'old')
NEW_DIR = os.path.join(TEST_DIR, 'new')

passed = 0
failed = 0
CLI_ENV = {**os.environ, 'EXCEL_DIFF_ENGINE': 'openpyxl'}

def run_cli(*args):
    result = subprocess.run([CLI] + list(args), capture_output=True, text=True, env=CLI_ENV)
    if result.returncode != 0:
        raise Exception(f"CLI failed: {result.stderr.strip()}")
    return result.stdout.strip()

def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  PASS: {name}")
        passed += 1
    except Exception as e:
        print(f"  FAIL: {name}: {e}")
        failed += 1

def setup():
    """Create test data"""
    if os.path.exists(TEST_DIR):
        shutil.rmtree(TEST_DIR)
    os.makedirs(OLD_DIR)
    os.makedirs(NEW_DIR)

    import openpyxl

    # Old file: 20 rows, IDs 1-20
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Sheet1'
    ws.append(['ID', 'Name', 'Dept', 'Salary'])
    for i in range(1, 21):
        ws.append([i, f'Person{i}', 'Eng', 100 + i])
    wb.save(os.path.join(OLD_DIR, 'data.xlsx'))

    # New file: 18 rows, IDs 1-18 (missing 19,20), some modified
    wb2 = openpyxl.Workbook()
    ws2 = wb2.active
    ws2.title = 'Sheet1'
    ws2.append(['ID', 'Name', 'Dept', 'Salary'])
    for i in range(1, 19):
        salary = 100 + i + (5 if i % 3 == 0 else 0)  # modify every 3rd
        ws2.append([i, f'Person{i}', 'Eng', salary])
    ws2.append([99, 'NewPerson', 'HR', 200])  # added
    wb2.save(os.path.join(NEW_DIR, 'data.xlsx'))

def cleanup():
    if os.path.exists(TEST_DIR):
        shutil.rmtree(TEST_DIR)

# === Tests ===

def test_list():
    out = run_cli('list', OLD_DIR)
    files = json.loads(out)
    assert len(files) == 1, f"Expected 1 file, got {len(files)}"
    assert files[0]['name'] == 'data.xlsx'

def test_read():
    out = run_cli('read', os.path.join(OLD_DIR, 'data.xlsx'))
    data = json.loads(out)
    assert len(data['sheets']) == 1
    assert len(data['sheets'][0]['rows']) == 21  # header + 20 data

def test_diff():
    out = run_cli('diff',
        os.path.join(OLD_DIR, 'data.xlsx'),
        os.path.join(NEW_DIR, 'data.xlsx'),
        '--key', '0')
    data = json.loads(out)
    stats = data['stats']
    # IDs 1-18: matched (some modified)
    # IDs 19,20: deleted
    # ID 99: added
    assert stats['deleted'] == 2, f"Expected 2 deleted, got {stats['deleted']}"
    assert stats['added'] == 1, f"Expected 1 added, got {stats['added']}"
    assert stats['modified'] == 6, f"Expected 6 modified (every 3rd of 18), got {stats['modified']}"
    assert stats['unchanged'] == 12, f"Expected 12 unchanged, got {stats['unchanged']}"

def test_write_preserves_format():
    # Write old data to new file (simulating merge)
    old_data = run_cli('read', os.path.join(OLD_DIR, 'data.xlsx'))

    # Create a temp JSON file
    json_path = os.path.join(TEST_DIR, 'merge_data.json')
    with open(json_path, 'w') as f:
        f.write(old_data)

    # Write to new file
    run_cli('write', os.path.join(NEW_DIR, 'data.xlsx'), '--json', json_path)

    # Verify: read back and compare
    merged = run_cli('read', os.path.join(NEW_DIR, 'data.xlsx'))
    merged_data = json.loads(merged)

    orig = json.loads(old_data)
    assert len(merged_data['sheets'][0]['rows']) == len(orig['sheets'][0]['rows']), "Row count mismatch"

    # Check specific values
    assert merged_data['sheets'][0]['rows'][1] == orig['sheets'][0]['rows'][1], "First data row mismatch"
    assert merged_data['sheets'][0]['rows'][20] == orig['sheets'][0]['rows'][20], "Last data row mismatch"

def test_write_then_diff_is_identical():
    # After writing old data to new file, diff should show all unchanged
    out = run_cli('diff',
        os.path.join(OLD_DIR, 'data.xlsx'),
        os.path.join(NEW_DIR, 'data.xlsx'),
        '--key', '0')
    data = json.loads(out)
    assert data['stats']['modified'] == 0, f"Expected 0 modified after merge, got {data['stats']['modified']}"
    assert data['stats']['added'] == 0, f"Expected 0 added after merge, got {data['stats']['added']}"
    assert data['stats']['deleted'] == 0, f"Expected 0 deleted after merge, got {data['stats']['deleted']}"

def test_detect_keys():
    out = run_cli('detect-keys', os.path.join(OLD_DIR, 'data.xlsx'), '--sheet', 'Sheet1')
    keys = json.loads(out)
    assert 0 in keys, f"Expected column 0 (ID) to be detected as key, got {keys}"

def test_partial_merge():
    """Merge only some rows, verify diff still shows remaining differences"""
    # Read old, but only take rows 1-10
    old_out = run_cli('read', os.path.join(OLD_DIR, 'data.xlsx'))
    old_data = json.loads(old_out)
    partial_rows = old_data['sheets'][0]['rows'][:11]  # header + 10 rows

    partial_data = json.dumps({"sheets": [{"name": "Sheet1", "rows": partial_rows}]})
    json_path = os.path.join(TEST_DIR, 'partial.json')
    with open(json_path, 'w') as f:
        f.write(partial_data)

    run_cli('write', os.path.join(NEW_DIR, 'data.xlsx'), '--json', json_path)

    # Diff should show deleted rows (11-20 from old)
    out = run_cli('diff',
        os.path.join(OLD_DIR, 'data.xlsx'),
        os.path.join(NEW_DIR, 'data.xlsx'),
        '--key', '0')
    data = json.loads(out)
    # Old has 20 rows, new now has 10 -> 10 deleted
    assert data['stats']['deleted'] == 10, f"Expected 10 deleted, got {data['stats']['deleted']}"

# === Run ===

if __name__ == '__main__':
    print("=" * 60)
    print("Excel Diff CLI Test Suite")
    print("=" * 60)

    # Build CLI first
    print("\nBuilding CLI...")
    build_result = subprocess.run(
        ['cargo', 'build', '--bin', 'ExcelDiffCli'],
        cwd=os.path.join(os.path.dirname(__file__), '..', 'src-tauri'),
        capture_output=True, text=True, env=CLI_ENV
    )
    if build_result.returncode != 0:
        print(f"Build failed:\n{build_result.stderr}")
        sys.exit(1)
    print("Build OK")

    setup()

    print("\nRunning tests:")
    test("list files", test_list)
    test("read file", test_read)
    test("diff files", test_diff)
    test("write preserves data", test_write_preserves_format)
    test("write then diff identical", test_write_then_diff_is_identical)
    test("detect keys", test_detect_keys)
    test("partial merge", test_partial_merge)

    cleanup()

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'=' * 60}")

    sys.exit(0 if failed == 0 else 1)
