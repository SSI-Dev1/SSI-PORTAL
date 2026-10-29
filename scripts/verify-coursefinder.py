#!/usr/bin/env python3
"""Field-by-field check of a CourseFinder .xlsx against the imported database records.

Reads the workbook with the Python standard library only (independent of the app's importer)
and compares every cell of every course row with the database dump written by
`CATALOGUE_DUMP=<file> bash supabase/tests/run.sh`.

    python3 -I scripts/verify-coursefinder.py <workbook.xlsx> <dump.json>

Cell text is compared after the same two normalisations the importer applies: Excel's
_xHHHH_ escapes are decoded (e.g. _x000D_ = carriage return), line endings become "\n", and
leading/trailing whitespace is trimmed. Exits non-zero on any mismatch.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']


def norm(text):
    text = re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)
    return re.sub(r'\r\n?', '\n', text).strip()


def read_rows(path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
                shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = {}
    for row in sheet.iter('{%s}row' % NS['m']):
        cells = {}
        for c in row.findall('m:c', NS):
            col = re.sub(r'\d', '', c.get('r'))
            v = c.find('m:v', NS)
            if c.get('t') == 's' and v is not None:
                val = shared[int(v.text)]
            elif c.get('t') == 'inlineStr':
                val = ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m']))
            else:
                val = v.text if v is not None else ''
            val = norm(val)
            if val:
                cells[col] = val
        if cells:
            rows[int(row.get('r'))] = cells
    return rows


def num(v):
    return None if v in (None, '') else float(v)


def main(xlsx, dump):
    rows = read_rows(xlsx)
    header = rows[1]
    data = {r: c for r, c in rows.items() if r > 1 and 'B' in c and 'D' in c}
    notes = [c['A'].lstrip('*').strip() for r, c in sorted(rows.items()) if r > 1 and re.match(r'^\*?\s*note\b', c.get('A', ''), re.I)]
    db = json.load(open(dump))
    uni = db['university']
    courses = {c['name']: c for c in db['courses'] or []}
    problems = []
    checked = 0

    def same(label, row, expected, actual, numeric=False):
        nonlocal checked
        checked += 1
        ok = (num(expected) == num(actual)) if numeric else ((expected or None) == (actual or None))
        if not ok:
            problems.append(f'row {row} · {label}: Excel {expected!r} ≠ database {actual!r}')

    # column → (database field, numeric?)
    fields = {
        'A': ('source_serial', False), 'D': ('name', False), 'E': ('website_url', False), 'F': ('campus', False),
        'H': ('level', False), 'I': ('duration', False), 'J': ('open_intakes', False), 'K': ('intake_year_text', False),
        'L': ('academic_requirement', False), 'M': ('ielts_min', True), 'N': ('ielts_band', True), 'O': ('toefl_score', True),
        'P': ('toefl_band', True), 'Q': ('pte_score', True), 'R': ('pte_band', True), 'S': ('det_score', True),
        'T': ('application_deadline_text', False), 'U': ('application_fee', False), 'V': ('tuition_text', False),
        'W': ('scholarship_available', False), 'X': ('average_scholarship', False), 'Y': ('scholarship_url', False),
        'Z': ('backlog_range', False), 'AA': ('remarks', False), 'AB': ('application_mode', False), 'AC': ('english_waiver', False),
    }
    for r, cells in sorted(data.items()):
        c = courses.get(cells['D'])
        if not c:
            problems.append(f'row {r} · course {cells["D"]!r} not in the database')
            continue
        same('B University', r, cells.get('B'), uni['name'])
        same('C University Ranking', r, cells.get('C'), uni['ranking_details'])
        same('G Country', r, cells.get('G'), uni['country'])
        same('university link', r, uni['id'], c['university_id'])
        for col, (field, numeric) in fields.items():
            same(f'{col} {header[col]} → {field}', r, cells.get(col), c.get(field), numeric)
        # Original row: every header column, blanks kept as null.
        src = c.get('source_data') or {}
        if len(src) != len(header):
            problems.append(f'row {r} · source record has {len(src)} columns, sheet has {len(header)}')
        for col, h in header.items():
            same(f'source {col} {h}', r, cells.get(col), src.get(h))
        same('source row', r, str(r), str(c.get('source_row')))
        # Tuition amount used for filters = the first amount in the fee text.
        same('tuition amount', r, re.search(r'\d[\d,]*(?:\.\d+)?', cells['V']).group(0).replace(',', ''), c['tuition'], True)
        # Intakes: one row per listed month in the given year; "ASAP" never becomes a date.
        want = sorted((int(cells['K']), MONTHS.index(m.strip()[:3].lower()) + 1) for m in cells['J'].split(','))
        have = sorted((i['year'], i['month']) for i in c['intake_rows'])
        same('intakes', r, str(want), str(have))
        for i in c['intake_rows']:
            if i['deadline'] is not None:
                problems.append(f'row {r} · intake {i["month"]}/{i["year"]} has a date deadline {i["deadline"]!r} not in the sheet')
        same('notes', r, json.dumps(notes), json.dumps(c.get('source_notes')))

    names = [c['D'] for c in data.values()]
    extra = set(courses) - set(names)
    if extra:
        problems.append(f'database has UEA courses not in the sheet: {sorted(extra)}')
    if len(names) != len(set(names)):
        problems.append('sheet has duplicate course names')

    urls = sum(1 for c in data.values() if c.get('E'))
    sch = sum(1 for c in data.values() if c.get('Y'))
    blanks = {f'{col} {h}': sum(1 for c in data.values() if col not in c) for col, h in header.items()}
    print(f'Sheet: {len(data)} course rows · {len(header)} columns · {urls} course URLs · {sch} scholarship URLs · {len(notes)} notes')
    print('Blank source cells: ' + (', '.join(f'{k} ×{v}' for k, v in blanks.items() if v) or 'none'))
    print(f'Database: {len(courses)} courses for {uni["name"]}')
    print(f'Checked {checked} values.')
    if problems:
        print(f'{len(problems)} MISMATCH(ES):')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)
    print('ALL FIELDS MATCH')


if __name__ == '__main__':
    main(*sys.argv[1:3])
