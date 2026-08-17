import re

SRC = r'C:\Users\hp\WorkBuddy\2026-08-07-09-48-48\src\pages\Movies.tsx'
OUT = r'C:\Users\hp\WorkBuddy\2026-08-07-09-48-48\src\pages\Books.tsx'

with open(SRC, encoding='utf-8') as f:
    s = f.read()

# —— 批量机械重命名（顺序敏感：长的/具体的先走）——
reps = [
    (r'\bTMDBCandidate\b', 'BookCandidate'),
    (r'\bMovieInput\b', 'BookInput'),
    (r'\bfetchMovieByTitle\b', 'fetchBookByTitle'),
    (r'\bsyncMovie\b', 'syncBook'),
    (r'\buploadTmdbImage\b', 'uploadBookImage'),
    (r'\buploadMovieCover\b', 'uploadBookCover'),
    (r'\bMovie\b', 'Book'),          # Movie 类型 / MoviesPage / MovieList / MovieDetailPanel / MovieModal
    (r'\bwatched_at\b', 'read_at'),
    (r'\bview_count\b', 'read_count'),
    (r"\bmovie\b", 'book'),          # movie 变量 / movies 复数 / movieKey
    (r'观影名称', '书籍名称'),          # 先修专属标签（避免被 观影→阅读 误改成「阅读名称」）
    (r'观影', '阅读'),
    (r'影片', '书籍'),
]
for pat, rep in reps:
    s = re.sub(pat, rep, s)

# —— import 行修正 ——
s = s.replace(
    "import { fetchBookByTitle, syncBook, uploadBookCover, uploadBookImage, normalizeRegion, type BookCandidate } from '../lib/books'",
    "import { fetchBookByTitle, syncBook, uploadBookCover, uploadBookImage, type BookCandidate } from '../lib/books'",
)
# 去掉 normalizeRegion 残留导入（若存在）
s = s.replace(', normalizeRegion', '')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(s)

print('written', OUT)
