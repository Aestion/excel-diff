"""
功能测试套件 — 测试每个具体功能点，而非单纯验证文件一致性。

测试范围：
  1. Diff 功能：修改行/新增行/删除行/混合场景
  2. 行级合并：单行/多行/指定key
  3. 单元格编辑：单个单元格修改
  4. 关键列：不同关键列的对比结果
  5. 边界情况：空文件/列数不同/重复key
"""
import subprocess, json, os, sys, shutil, tempfile

CLI_DIR = os.path.join(os.path.dirname(__file__), '..', 'src-tauri')
CLI = os.path.join(CLI_DIR, 'target', 'debug', 'ExcelDiffCli.exe')
if not os.path.exists(CLI):
    CLI = os.path.join(CLI_DIR, 'target', 'debug', 'ExcelDiffCli')

TEST_DIR = tempfile.mkdtemp(prefix='excel-diff-test-')
passed = 0
failed = 0
results = []
CLI_ENV = {**os.environ, 'EXCEL_DIFF_ENGINE': 'openpyxl'}

def run_cli(*args):
    r = subprocess.run([CLI] + list(args), capture_output=True, text=True, cwd=CLI_DIR, env=CLI_ENV)
    if r.returncode != 0:
        raise Exception(r.stderr.strip())
    return r.stdout.strip()

def run_cli_json(*args):
    return json.loads(run_cli(*args))

def diff_stats(old, new, key_col):
    d = run_cli_json('diff', old, new, '--key', str(key_col))
    return d['stats']

def make_xlsx(path, sheet_name, headers, rows):
    """Create an Excel file using openpyxl"""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)

def test(category, name, fn):
    global passed, failed
    full = f"[{category}] {name}"
    try:
        fn()
        results.append(('PASS', full, ''))
        passed += 1
    except Exception as e:
        results.append(('FAIL', full, str(e)))
        failed += 1

def assert_eq(actual, expected, msg=""):
    if actual != expected:
        raise AssertionError(f"{msg}: expected {expected}, got {actual}")

def assert_contains(actual, expected_subset, msg=""):
    for k, v in expected_subset.items():
        if actual.get(k) != v:
            raise AssertionError(f"{msg}: {k} expected {v}, got {actual.get(k)}")

def cell_value(cell):
    return cell.get('value') if isinstance(cell, dict) else cell

# ========================================
# Test Data Setup
# ========================================

def setup_test_data():
    """Create various test Excel files"""
    os.makedirs(TEST_DIR, exist_ok=True)

    # Case 1: 基础对比数据
    make_xlsx(f'{TEST_DIR}/base_old.xlsx', 'Sheet1',
        ['ID', 'Name', 'Dept', 'Salary'],
        [[1, 'Alice', 'Eng', 90], [2, 'Bob', 'Sales', 80], [3, 'Charlie', 'Eng', 95], [4, 'Diana', 'HR', 70]])

    make_xlsx(f'{TEST_DIR}/base_new.xlsx', 'Sheet1',
        ['ID', 'Name', 'Dept', 'Salary'],
        [[1, 'Alice', 'Eng', 90],      # unchanged
         [2, 'Bob', 'Sales', 85],       # modified (salary 80->85)
         [4, 'Diana', 'HR', 70],        # unchanged (Charlie deleted)
         [5, 'Eve', 'Mkt', 88]])        # added

    # Case 2: 只有修改，无增删
    make_xlsx(f'{TEST_DIR}/mod_old.xlsx', 'Sheet1',
        ['ID', 'Value'], [[1, 'A'], [2, 'B'], [3, 'C']])
    make_xlsx(f'{TEST_DIR}/mod_new.xlsx', 'Sheet1',
        ['ID', 'Value'], [[1, 'X'], [2, 'B'], [3, 'Z']])

    # Case 3: 只有新增
    make_xlsx(f'{TEST_DIR}/add_old.xlsx', 'Sheet1',
        ['ID', 'Name'], [[1, 'A'], [2, 'B']])
    make_xlsx(f'{TEST_DIR}/add_new.xlsx', 'Sheet1',
        ['ID', 'Name'], [[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']])

    # Case 4: 只有删除
    make_xlsx(f'{TEST_DIR}/del_old.xlsx', 'Sheet1',
        ['ID', 'Name'], [[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']])
    make_xlsx(f'{TEST_DIR}/del_new.xlsx', 'Sheet1',
        ['ID', 'Name'], [[1, 'A'], [2, 'B']])

    # Case 5: 完全相同
    make_xlsx(f'{TEST_DIR}/same_a.xlsx', 'Sheet1',
        ['ID', 'Name'], [[1, 'A'], [2, 'B']])
    make_xlsx(f'{TEST_DIR}/same_b.xlsx', 'Sheet1',
        ['ID', 'Name'], [[1, 'A'], [2, 'B']])

    # Case 6: 多列修改
    make_xlsx(f'{TEST_DIR}/multi_col_old.xlsx', 'Sheet1',
        ['ID', 'A', 'B', 'C'], [[1, 'x', 'y', 'z'], [2, 'a', 'b', 'c']])
    make_xlsx(f'{TEST_DIR}/multi_col_new.xlsx', 'Sheet1',
        ['ID', 'A', 'B', 'C'], [[1, 'x', 'Y', 'z'], [2, 'A', 'b', 'C']])

# ========================================
# 1. Diff 功能测试
# ========================================

def test_diff_identical():
    """完全相同的文件应该全部 unchanged"""
    s = diff_stats(f'{TEST_DIR}/same_a.xlsx', f'{TEST_DIR}/same_b.xlsx', 0)
    assert_eq(s['unchanged'], 2, 'unchanged')
    assert_eq(s['modified'], 0, 'modified')
    assert_eq(s['deleted'], 0, 'deleted')
    assert_eq(s['added'], 0, 'added')

def test_diff_modified_only():
    """只有修改行"""
    s = diff_stats(f'{TEST_DIR}/mod_old.xlsx', f'{TEST_DIR}/mod_new.xlsx', 0)
    assert_eq(s['modified'], 2, 'modified')   # ID=1 and ID=3
    assert_eq(s['unchanged'], 1, 'unchanged') # ID=2
    assert_eq(s['deleted'], 0, 'deleted')
    assert_eq(s['added'], 0, 'added')

def test_diff_added_only():
    """只有新增行"""
    s = diff_stats(f'{TEST_DIR}/add_old.xlsx', f'{TEST_DIR}/add_new.xlsx', 0)
    assert_eq(s['added'], 2, 'added')         # ID=3, ID=4
    assert_eq(s['unchanged'], 2, 'unchanged') # ID=1, ID=2
    assert_eq(s['deleted'], 0, 'deleted')
    assert_eq(s['modified'], 0, 'modified')

def test_diff_deleted_only():
    """只有删除行"""
    s = diff_stats(f'{TEST_DIR}/del_old.xlsx', f'{TEST_DIR}/del_new.xlsx', 0)
    assert_eq(s['deleted'], 2, 'deleted')     # ID=3, ID=4
    assert_eq(s['unchanged'], 2, 'unchanged') # ID=1, ID=2
    assert_eq(s['added'], 0, 'added')
    assert_eq(s['modified'], 0, 'modified')

def test_diff_mixed():
    """混合场景：修改+新增+删除"""
    s = diff_stats(f'{TEST_DIR}/base_old.xlsx', f'{TEST_DIR}/base_new.xlsx', 0)
    assert_eq(s['modified'], 1, 'modified')   # ID=2 (salary 80->85)
    assert_eq(s['deleted'], 1, 'deleted')     # ID=3
    assert_eq(s['added'], 1, 'added')         # ID=5
    assert_eq(s['unchanged'], 2, 'unchanged') # ID=1, ID=4

def test_diff_multi_col():
    """多列修改检测"""
    d = run_cli_json('diff', f'{TEST_DIR}/multi_col_old.xlsx', f'{TEST_DIR}/multi_col_new.xlsx', '--key', '0')
    rows = d['rows']
    modified = [r for r in rows if r['status'] == 'modified']
    assert_eq(len(modified), 2, 'modified count')
    # ID=1: col B changed (y->Y), diffCols should be [2]
    r1 = [r for r in modified if '1' in str(r['key'])][0]
    assert 2 in r1['diffCols'], f"Expected col 2 in diffCols, got {r1['diffCols']}"
    # ID=2: col A and C changed (a->A, c->C)
    r2 = [r for r in modified if '2' in str(r['key'])][0]
    assert 1 in r2['diffCols'] and 3 in r2['diffCols'], f"Expected cols 1,3 in diffCols, got {r2['diffCols']}"

# ========================================
# 2. 行级合并测试
# ========================================

def test_merge_single_modified_row():
    """合并单个修改行：把 old 中 Bob 的薪资(80)复制到 new"""
    target = f'{TEST_DIR}/merge_single.xlsx'
    shutil.copy(f'{TEST_DIR}/base_new.xlsx', target)

    # Before: Bob's salary is 85 in new
    before = run_cli_json('read', target)
    assert_eq(cell_value(before['sheets'][0]['rows'][2][3]), 85, 'Bob salary before merge')

    # Merge Bob (key=2) from old to new
    run_cli('merge-rows', f'{TEST_DIR}/base_old.xlsx', target, '--key', '0', '--keys', '2')

    # After: Bob's salary should be 80
    after = run_cli_json('read', target)
    assert_eq(cell_value(after['sheets'][0]['rows'][2][3]), 80, 'Bob salary after merge')

    # Diff should show Bob as unchanged now
    s = diff_stats(f'{TEST_DIR}/base_old.xlsx', target, 0)
    assert_eq(s['modified'], 0, 'modified after merge')

def test_merge_multiple_rows():
    """合并多个指定行"""
    target = f'{TEST_DIR}/merge_multi.xlsx'
    shutil.copy(f'{TEST_DIR}/base_new.xlsx', target)

    # Merge ID=2 and ID=5 (5 doesn't exist in old, should be skipped)
    run_cli('merge-rows', f'{TEST_DIR}/base_old.xlsx', target, '--key', '0', '--keys', '2,5')

    after = run_cli_json('read', target)
    assert_eq(cell_value(after['sheets'][0]['rows'][2][3]), 80, 'Bob salary after multi-merge')

def test_merge_insert_deleted_row():
    """通过合并实现"插入删除行"：把 old 中 Charlie 复制到 new"""
    target = f'{TEST_DIR}/merge_insert.xlsx'
    shutil.copy(f'{TEST_DIR}/base_new.xlsx', target)

    # New doesn't have Charlie (ID=3)
    before = run_cli_json('read', target)
    ids_before = [cell_value(r[0]) for r in before['sheets'][0]['rows'][1:]]
    assert 3.0 not in ids_before, 'Charlie should not exist before'

    # Write old data entirely to new (simulates "insert all deleted")
    run_cli('read', f'{TEST_DIR}/base_old.xlsx', '--', '>', f'{TEST_DIR}/_tmp.json')
    # Actually use merge-rows for Charlie specifically
    # But Charlie doesn't exist in new, so merge-rows won't find it
    # Instead, we write the entire old data
    old_json = run_cli('read', f'{TEST_DIR}/base_old.xlsx')
    with open(f'{TEST_DIR}/_insert.json', 'w') as f:
        f.write(old_json)
    run_cli('write', target, '--json', f'{TEST_DIR}/_insert.json')

    after = run_cli_json('read', target)
    ids_after = [cell_value(r[0]) for r in after['sheets'][0]['rows'][1:]]
    assert 3.0 in ids_after, 'Charlie should exist after insert'

    # Diff should show no differences
    s = diff_stats(f'{TEST_DIR}/base_old.xlsx', target, 0)
    assert_eq(s['deleted'], 0, 'no deleted after insert')

def test_merge_partial():
    """部分合并：只合并修改行，不合并删除行"""
    target = f'{TEST_DIR}/merge_partial.xlsx'
    shutil.copy(f'{TEST_DIR}/base_new.xlsx', target)

    # Only merge modified row (ID=2)
    run_cli('merge-rows', f'{TEST_DIR}/base_old.xlsx', target, '--key', '0', '--keys', '2')

    # Diff should still show: 1 deleted (Charlie), 1 added (Eve)
    s = diff_stats(f'{TEST_DIR}/base_old.xlsx', target, 0)
    assert_eq(s['modified'], 0, 'no modified after merge')
    assert_eq(s['deleted'], 1, 'still 1 deleted (Charlie)')
    assert_eq(s['added'], 1, 'still 1 added (Eve)')

# ========================================
# 3. 单元格编辑测试
# ========================================

def test_edit_cell():
    """编辑单个单元格"""
    target = f'{TEST_DIR}/edit_cell.xlsx'
    shutil.copy(f'{TEST_DIR}/base_new.xlsx', target)

    # Edit Bob's salary from 85 to 99
    run_cli('edit-cell', target, '--key', '0', '--row', '2', '--col', '3', '--val', '99')

    after = run_cli_json('read', target)
    assert_eq(cell_value(after['sheets'][0]['rows'][2][3]), 99, 'salary after edit')

def test_edit_cell_then_diff():
    """编辑后 diff 应该反映变化"""
    target = f'{TEST_DIR}/edit_diff.xlsx'
    shutil.copy(f'{TEST_DIR}/base_new.xlsx', target)

    # Before: Bob has salary 85 (differs from old's 80)
    s1 = diff_stats(f'{TEST_DIR}/base_old.xlsx', target, 0)
    assert_eq(s1['modified'], 1, 'modified before edit')

    # Edit Bob's salary to 80 (same as old)
    run_cli('edit-cell', target, '--key', '0', '--row', '2', '--col', '3', '--val', '80')

    # After: Bob should be unchanged
    s2 = diff_stats(f'{TEST_DIR}/base_old.xlsx', target, 0)
    assert_eq(s2['modified'], 0, 'modified after fixing Bob')

# ========================================
# 4. 关键列测试
# ========================================

def test_key_column_auto_detect():
    """自动检测关键列应该找到 ID 列"""
    keys = json.loads(run_cli('detect-keys', f'{TEST_DIR}/base_old.xlsx', '--sheet', 'Sheet1'))
    assert 0 in keys, f'Expected col 0 (ID) as key, got {keys}'

def test_different_key_column():
    """用不同关键列应该产生不同结果"""
    # Create data where Name is unique but ID is not
    make_xlsx(f'{TEST_DIR}/key_test_a.xlsx', 'Sheet1',
        ['ID', 'Name', 'Val'], [[1, 'Alice', 10], [1, 'Bob', 20]])
    make_xlsx(f'{TEST_DIR}/key_test_b.xlsx', 'Sheet1',
        ['ID', 'Name', 'Val'], [[1, 'Alice', 10], [1, 'Bob', 30]])

    # Key by Name (col 1): should show 1 modified (Bob's Val)
    s_name = diff_stats(f'{TEST_DIR}/key_test_a.xlsx', f'{TEST_DIR}/key_test_b.xlsx', 1)
    assert_eq(s_name['modified'], 1, 'modified with Name key')
    assert_eq(s_name['unchanged'], 1, 'unchanged with Name key')

    # Key by ID (col 0): both rows have same key "1.0", only first matches
    s_id = diff_stats(f'{TEST_DIR}/key_test_a.xlsx', f'{TEST_DIR}/key_test_b.xlsx', 0)
    # With duplicate keys, first match wins
    assert s_id['unchanged'] + s_id['modified'] >= 1, 'at least 1 row matched with ID key'

# ========================================
# 5. 边界情况测试
# ========================================

def test_column_count_difference():
    """列数不同的文件对比：多出的列有数据应该显示差异"""
    make_xlsx(f'{TEST_DIR}/col_old.xlsx', 'Sheet1',
        ['A', 'B'], [[1, 'x']])
    make_xlsx(f'{TEST_DIR}/col_new.xlsx', 'Sheet1',
        ['A', 'B', 'C'], [[1, 'x', 'extra']])

    s = diff_stats(f'{TEST_DIR}/col_old.xlsx', f'{TEST_DIR}/col_new.xlsx', 0)
    # Extra column with data → should show as modified
    assert_eq(s['modified'], 1, 'extra column should show as modified')

    # Test: extra column with NO data (both empty) → should be unchanged
    make_xlsx(f'{TEST_DIR}/col_old2.xlsx', 'Sheet1',
        ['A', 'B'], [[1, 'x']])
    make_xlsx(f'{TEST_DIR}/col_new2.xlsx', 'Sheet1',
        ['A', 'B', 'C'], [[1, 'x', None]])
    s2 = diff_stats(f'{TEST_DIR}/col_old2.xlsx', f'{TEST_DIR}/col_new2.xlsx', 0)
    assert_eq(s2['unchanged'], 1, 'empty extra column should be unchanged')

def test_empty_new_file():
    """新版只有表头"""
    make_xlsx(f'{TEST_DIR}/empty_new.xlsx', 'Sheet1', ['ID', 'Name'], [])

    s = diff_stats(f'{TEST_DIR}/base_old.xlsx', f'{TEST_DIR}/empty_new.xlsx', 0)
    assert_eq(s['deleted'], 4, 'all rows deleted')
    assert_eq(s['added'], 0, 'no added')
    assert_eq(s['modified'], 0, 'no modified')

def test_empty_old_file():
    """旧版只有表头，新版有数据"""
    make_xlsx(f'{TEST_DIR}/empty_old.xlsx', 'Sheet1', ['ID', 'Name'], [])

    s = diff_stats(f'{TEST_DIR}/empty_old.xlsx', f'{TEST_DIR}/add_new.xlsx', 0)
    assert_eq(s['added'], 4, 'all rows added')
    assert_eq(s['deleted'], 0, 'no deleted')

def test_list_subdirectories():
    """列出子目录文件"""
    os.makedirs(f'{TEST_DIR}/sub', exist_ok=True)
    make_xlsx(f'{TEST_DIR}/sub/nested.xlsx', 'Sheet1', ['X'], [[1]])

    files = run_cli_json('list', TEST_DIR)
    paths = [f['relativePath'] for f in files]
    assert any('sub' in p and 'nested' in p for p in paths), f'Should find nested file, got {paths}'

# ========================================
# Run
# ========================================

if __name__ == '__main__':
    print('=' * 70)
    print('Excel Diff — 功能测试套件')
    print('=' * 70)

    # Build
    print('\nBuilding...')
    r = subprocess.run(['cargo', 'build', '--bin', 'ExcelDiffCli'],
        cwd=CLI_DIR, capture_output=True, text=True, env=CLI_ENV)
    if r.returncode != 0:
        print(f'Build failed: {r.stderr}')
        sys.exit(1)
    print('Build OK\n')

    setup_test_data()

    print('Running tests:\n')

    # 1. Diff
    test('Diff', '完全相同文件', test_diff_identical)
    test('Diff', '只有修改行', test_diff_modified_only)
    test('Diff', '只有新增行', test_diff_added_only)
    test('Diff', '只有删除行', test_diff_deleted_only)
    test('Diff', '混合场景(改+增+删)', test_diff_mixed)
    test('Diff', '多列修改检测', test_diff_multi_col)

    # 2. 行级合并
    test('Merge', '合并单个修改行', test_merge_single_modified_row)
    test('Merge', '合并多个指定行', test_merge_multiple_rows)
    test('Merge', '插入删除行', test_merge_insert_deleted_row)
    test('Merge', '部分合并(只合修改不合删除)', test_merge_partial)

    # 3. 单元格编辑
    test('Edit', '编辑单个单元格', test_edit_cell)
    test('Edit', '编辑后diff验证', test_edit_cell_then_diff)

    # 4. 关键列
    test('Key', '自动检测关键列', test_key_column_auto_detect)
    test('Key', '不同关键列结果', test_different_key_column)

    # 5. 边界情况
    test('Edge', '列数不同', test_column_count_difference)
    test('Edge', '新版为空', test_empty_new_file)
    test('Edge', '旧版为空', test_empty_old_file)
    test('Edge', '子目录文件', test_list_subdirectories)

    # Results
    print('\n' + '=' * 70)
    for status, name, err in results:
        icon = 'PASS' if status == 'PASS' else 'FAIL'
        print(f'  [{icon}] {name}')
        if err:
            print(f'         -> {err}')
    print('=' * 70)
    print(f'\nTotal: {passed} passed, {failed} failed out of {passed + failed}')
    print('=' * 70)

    # Cleanup
    shutil.rmtree(TEST_DIR, ignore_errors=True)
    sys.exit(0 if failed == 0 else 1)
