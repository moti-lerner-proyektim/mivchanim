# מעתיק את הלוגיקה הטהורה מ-Code.gs ל-js/core.js (משמש את מצב ההדגמה בדפדפן)
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'apps-script/Code.gs').read_text(encoding='utf-8')
core = src.split('/* CORE-START */')[1].split('/* CORE-END */')[0]
out = '/* נוצר אוטומטית מ-apps-script/Code.gs – לא לערוך ידנית (tools/build-core.py) */\n' + core.strip()+ '\n'
(root / 'js/core.js').write_text(out, encoding='utf-8')
print('core.js', len(out))
