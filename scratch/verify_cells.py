import json
import sys

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

with open('notebooks/media_worker_pipeline.ipynb', 'r', encoding='utf-8') as f:
    nb = json.load(f)

print(f"Total cells: {len(nb['cells'])}")
errors = 0
for i, cell in enumerate(nb['cells'], 1):
    c_type = cell['cell_type']
    src = ''.join(cell['source'])
    title_line = [l for l in src.splitlines() if '@title' in l]
    title = title_line[0] if title_line else (src.splitlines()[0] if src.splitlines() else 'Empty')
    print(f"Cell {i} ({c_type}): {title[:60]} (lines: {len(src.splitlines())})")
    if c_type == 'code':
        try:
            compile(src, f"cell_{i}", "exec")
            print("  -> Syntax OK")
        except Exception as e:
            print(f"  -> SYNTAX ERROR: {e}")
            errors += 1

if errors > 0:
    print(f"\nFAILED with {errors} errors!")
    sys.exit(1)
else:
    print("\nALL NOTEBOOK CELLS COMPILED CLEANLY!")
