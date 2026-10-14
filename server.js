// server.js
// 統合版: 通常生成モード & 密集優先生成モード & パターン解法モード(高速化版)

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// 共通ユーティリティ & データロード
// =========================================================

function normalizeWord(word) {
    const replacements = {
        'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
        'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ッ': 'ツ',
        'ぁ': 'ア', 'ぃ': 'イ', 'ぅ': 'ウ', 'ぇ': 'エ', 'ぉ': 'オ',
        'ゃ': 'ヤ', 'ゅ': 'ユ', 'ょ': 'ヨ', '・': ''
    };

    let normalizedWord = '';

    for (const char of word) {
        normalizedWord += replacements[char] || char;
    }

    // カタカナと長音以外(♀ ♂ : . 数字 英字など)は除去
    return normalizedWord.replace(/[^ァ-ヶー]/g, '');
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
}

const filesMap = {
    pokemon: ['pokemon.txt'],
    countries: ['countries.txt'],
    capitals: ['capitals.txt'],
    countries_capitals: ['countries.txt', 'capitals.txt']
};

// ジェネレーター用
let indexedWordLists = {};

// ソルバー用
const wordsByLengthSolver = {};

// ソルバー用: 長さ → 位置 → 文字 → ビットセット
const solverIndex = {};

// 密集生成用: フック文字ごとの単語インデックス
const denseWordIndex = {};

function loadAndOptimizeWordLists() {
    console.log('単語リストを読み込み、最適化中...');

    for (const key in filesMap) {
        const fileList = filesMap[key];

        const uniqueWordsGen = new Set();

        wordsByLengthSolver[key] = {};

        for (const file of fileList) {
            const filePath = path.join(__dirname, file);

            try {
                if (fs.existsSync(filePath)) {
                    const rawWords = fs.readFileSync(filePath, 'utf8')
                        .split('\n')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);

                    for (const rawWord of rawWords) {
                        uniqueWordsGen.add(rawWord);

                        const normWord = normalizeWord(rawWord);

                        if (normWord.length < 2) continue;

                        if (!wordsByLengthSolver[key][normWord.length]) {
                            wordsByLengthSolver[key][normWord.length] = new Set();
                        }

                        wordsByLengthSolver[key][normWord.length].add(normWord);
                    }
                }
            } catch (error) {
                console.error(`- エラー: ${file} の読み込みに失敗しました。`, error.message);
            }
        }

        // ジェネレーター用インデックス
        if (uniqueWordsGen.size > 0) {
            const indexed = {};

            for (const rawWord of Array.from(uniqueWordsGen)) {
                const word = normalizeWord(rawWord);

                if (word.length < 2) continue;

                if (!indexed[word.length]) {
                    indexed[word.length] = new Set();
                }

                indexed[word.length].add(word);
            }

            for (const length in indexed) {
                indexed[length] = shuffleArray(Array.from(indexed[length]));
            }

            indexedWordLists[key] = indexed;
        }

        // ソルバー用: Set → Array
        for (const length in wordsByLengthSolver[key]) {
            wordsByLengthSolver[key][length] = Array.from(wordsByLengthSolver[key][length]);
        }

        console.log(`- リスト [${key}]: 登録完了`);
    }
}

function buildDenseWordIndex() {
    for (const listName in indexedWordLists) {
        denseWordIndex[listName] = {};

        for (const length in indexedWordLists[listName]) {
            const words = indexedWordLists[listName][length];

            for (const word of words) {
                for (let pos = 0; pos < word.length; pos++) {
                    const char = word[pos];

                    if (!denseWordIndex[listName][char]) {
                        denseWordIndex[listName][char] = [];
                    }

                    denseWordIndex[listName][char].push({
                        word,
                        pos,
                        length: word.length
                    });
                }
            }
        }
    }

    console.log('- 密集生成用インデックス構築完了');
}

function buildSolverIndex() {
    for (const key in wordsByLengthSolver) {
        solverIndex[key] = {};

        for (const len in wordsByLengthSolver[key]) {
            const words = wordsByLengthSolver[key][len];
            const L = Number(len);
            const nW = (words.length + 31) >>> 5;
            const byPosChar = Array.from({ length: L }, () => new Map());
            const full = new Uint32Array(nW);

            words.forEach((w, idx) => {
                full[idx >>> 5] |= (1 << (idx & 31));

                for (let p = 0; p < L; p++) {
                    let bs = byPosChar[p].get(w[p]);

                    if (!bs) {
                        bs = new Uint32Array(nW);
                        byPosChar[p].set(w[p], bs);
                    }

                    bs[idx >>> 5] |= (1 << (idx & 31));
                }
            });

            solverIndex[key][len] = { words, nW, byPosChar, full };
        }
    }

    console.log('- ソルバー用ビットセットインデックス構築完了');
}

loadAndOptimizeWordLists();
buildDenseWordIndex();
buildSolverIndex();

// =========================================================
// 盤面ユーティリティ
// =========================================================

function createEmptyGrid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(' '));
}

function displayListName(listUsedName) {
    return listUsedName === 'countries_capitals'
        ? '国名・首都名'
        : listUsedName;
}

function gridToDisplay(grid) {
    return grid.map(row =>
        row.map(cell => cell === ' ' ? '⬛︎' : cell)
    );
}

// =========================================================
// 2. 通常ジェネレーター
// =========================================================

// 生成全体の時間上限(ms)
const GEN_TIME_LIMIT_MS = 8000;
// 密集生成の1回あたりの時間上限(ms)
const DENSE_RUN_TIME_LIMIT_MS = 1500;

// 置けるか判定する(盤面は変更しない)。置ける場合は交差数、置けない場合は -1
function canPlaceWord(grid, word, r, c, direction, isFirstWord) {
    const rows = grid.length;
    const cols = grid[0].length;
    const len = word.length;
    const vertical = direction === 'vertical';
    const dr = vertical ? 1 : 0;
    const dc = vertical ? 0 : 1;

    if (r < 0 || c < 0 || r + dr * (len - 1) >= rows || c + dc * (len - 1) >= cols) {
        return -1;
    }

    // 単語の前後は空きマスであること
    const br = r - dr;
    const bc = c - dc;

    if (br >= 0 && bc >= 0 && grid[br][bc] !== ' ') return -1;

    const ar = r + dr * len;
    const ac = c + dc * len;

    if (ar < rows && ac < cols && grid[ar][ac] !== ' ') return -1;

    let intersectionCount = 0;

    for (let i = 0; i < len; i++) {
        const rr = r + dr * i;
        const cc = c + dc * i;
        const existing = grid[rr][cc];

        if (existing !== ' ') {
            if (existing !== word[i]) return -1;

            intersectionCount++;
        } else if (vertical) {
            if (
                (cc > 0 && grid[rr][cc - 1] !== ' ') ||
                (cc < cols - 1 && grid[rr][cc + 1] !== ' ')
            ) {
                return -1;
            }
        } else {
            if (
                (rr > 0 && grid[rr - 1][cc] !== ' ') ||
                (rr < rows - 1 && grid[rr + 1][cc] !== ' ')
            ) {
                return -1;
            }
        }
    }

    if (intersectionCount === 0 && !isFirstWord) return -1;

    return intersectionCount;
}

// 盤面に直接書き込む。戻り値は変更したセル座標 [r0, c0, r1, c1, ...]
function applyWord(grid, word, r, c, direction) {
    const changed = [];
    const vertical = direction === 'vertical';

    for (let i = 0; i < word.length; i++) {
        const rr = r + (vertical ? i : 0);
        const cc = c + (vertical ? 0 : i);

        if (grid[rr][cc] === ' ') {
            grid[rr][cc] = word[i];
            changed.push(rr, cc);
        }
    }

    return changed;
}

function undoWord(grid, changed) {
    for (let j = 0; j < changed.length; j += 2) {
        grid[changed[j]][changed[j + 1]] = ' ';
    }
}

// 孤立した空きマス塊の数などを求める(エンドポイントの最終判定用)
function countIsolatedEmptyBlocks(grid) {
    const rows = grid.length;
    const cols = grid[0].length;

    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

    let isolatedBlockCount = 0;
    const isolatedCells = new Set();

    const directions = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === ' ' && !visited[r][c]) {
                let isTouchingBoundary = false;
                const queue = [[r, c]];
                const currentBlock = new Set();

                visited[r][c] = true;
                currentBlock.add(`${r},${c}`);

                if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
                    isTouchingBoundary = true;
                }

                let head = 0;

                while (head < queue.length) {
                    const [currR, currC] = queue[head++];

                    for (const [dr, dc] of directions) {
                        const nextR = currR + dr;
                        const nextC = currC + dc;

                        if (
                            nextR >= 0 &&
                            nextR < rows &&
                            nextC >= 0 &&
                            nextC < cols &&
                            grid[nextR][nextC] === ' ' &&
                            !visited[nextR][nextC]
                        ) {
                            visited[nextR][nextC] = true;
                            queue.push([nextR, nextC]);
                            currentBlock.add(`${nextR},${nextC}`);

                            if (
                                nextR === 0 ||
                                nextR === rows - 1 ||
                                nextC === 0 ||
                                nextC === cols - 1
                            ) {
                                isTouchingBoundary = true;
                            }
                        }
                    }
                }

                if (!isTouchingBoundary) {
                    isolatedBlockCount++;

                    currentBlock.forEach(cell => isolatedCells.add(cell));
                }
            }
        }
    }

    return {
        count: isolatedBlockCount,
        isolatedCells
    };
}

function getUntouchedWords(placedWords, isolatedCells) {
    if (isolatedCells.size === 0) {
        return placedWords;
    }

    const untouchedWords = [];

    const adjacencies = [
        [-1, 0], [1, 0], [0, -1], [0, 1]
    ];

    for (const pWord of placedWords) {
        let isTouching = false;

        for (let i = 0; i < pWord.word.length; i++) {
            const r = pWord.r + (pWord.direction === 'vertical' ? i : 0);
            const c = pWord.c + (pWord.direction === 'horizontal' ? i : 0);

            for (const [dr, dc] of adjacencies) {
                if (isolatedCells.has(`${r + dr},${c + dc}`)) {
                    isTouching = true;
                    break;
                }
            }

            if (isTouching) break;
        }

        if (!isTouching) {
            untouchedWords.push(pWord);
        }
    }

    return untouchedWords;
}

// calculateDensityScore と同じ式を、型付き配列で高速に計算する版
function calculateDensityScoreFast(grid, placedWords) {
    const rows = grid.length;
    const cols = grid[0].length;
    const N = rows * cols;

    const visited = new Uint8Array(N);
    const iso = new Uint8Array(N);
    const queue = new Int32Array(N);

    let emptyCells = 0;
    let isolatedBlocks = 0;
    let isoCount = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] !== ' ') continue;

            emptyCells++;

            const start = r * cols + c;

            if (visited[start]) continue;

            let head = 0;
            let tail = 0;
            let touching = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;

            visited[start] = 1;
            queue[tail++] = start;

            while (head < tail) {
                const cur = queue[head++];
                const cr = (cur / cols) | 0;
                const cc = cur - cr * cols;

                for (let dr = -1; dr <= 1; dr++) {
                    const nr = cr + dr;

                    if (nr < 0 || nr >= rows) continue;

                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;

                        const nc = cc + dc;

                        if (nc < 0 || nc >= cols) continue;

                        const ni = nr * cols + nc;

                        if (visited[ni] || grid[nr][nc] !== ' ') continue;

                        visited[ni] = 1;
                        queue[tail++] = ni;

                        if (nr === 0 || nr === rows - 1 || nc === 0 || nc === cols - 1) {
                            touching = true;
                        }
                    }
                }
            }

            if (!touching) {
                isolatedBlocks++;
                isoCount += tail;

                for (let i = 0; i < tail; i++) {
                    iso[queue[i]] = 1;
                }
            }
        }
    }

    let untouchedCount = 0;

    if (isoCount === 0) {
        untouchedCount = placedWords.length;
    } else {
        for (const pWord of placedWords) {
            const vertical = pWord.direction === 'vertical';
            let touchingWord = false;

            for (let i = 0; i < pWord.word.length && !touchingWord; i++) {
                const r = pWord.r + (vertical ? i : 0);
                const c = pWord.c + (vertical ? 0 : i);

                if (r > 0 && iso[(r - 1) * cols + c]) touchingWord = true;
                else if (r < rows - 1 && iso[(r + 1) * cols + c]) touchingWord = true;
                else if (c > 0 && iso[r * cols + c - 1]) touchingWord = true;
                else if (c < cols - 1 && iso[r * cols + c + 1]) touchingWord = true;
            }

            if (!touchingWord) untouchedCount++;
        }
    }

    const touchedWordsCount = placedWords.length - untouchedCount;

    const baseScore = placedWords.length * 10000 - emptyCells;
    const topologyBonus = isolatedBlocks * 10000000000;
    const noIsolatedBlockPenalty = isolatedBlocks === 0 ? -5000000000 : 0;
    const untouchedWordPenalty = untouchedCount * -300000000;

    let contactBonus = 0;

    if (placedWords.length > 0) {
        contactBonus = (touchedWordsCount / placedWords.length) * 100000;

        if (isolatedBlocks > 0 && untouchedCount === 0) {
            contactBonus += 1000000;
        }
    }

    return (
        topologyBonus +
        noIsolatedBlockPenalty +
        untouchedWordPenalty +
        baseScore +
        contactBonus
    );
}

// 文字ごとのフック位置(中心から遠い順)
function buildHooksByChar(grid, rows, cols) {
    const centerR = rows / 2;
    const centerC = cols / 2;
    const map = new Map();

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const ch = grid[r][c];

            if (ch === ' ') continue;

            let list = map.get(ch);

            if (!list) {
                list = [];
                map.set(ch, list);
            }

            list.push({
                r,
                c,
                d: (r - centerR) * (r - centerR) + (c - centerC) * (c - centerC)
            });
        }
    }

    for (const list of map.values()) {
        list.sort((a, b) => b.d - a.d);
    }

    return map;
}

function generateCrossword(rows, cols, indexedWords, initialPlacedWords = [], deadline = Infinity) {
    const MAX_ATTEMPTS = 150000;

    let attemptCount = 0;

    const availableLengths = Object.keys(indexedWords)
        .map(Number)
        .sort((a, b) => b - a)
        .sort(() => Math.random() - 0.5);

    let bestSolution = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity
    };

    // 盤面は1つだけ持ち、置く→再帰→戻す で使い回す
    const grid = createEmptyGrid(rows, cols);
    const initialUsed = new Set();
    const initialPlaced = [];

    for (const pWord of initialPlacedWords) {
        if (canPlaceWord(grid, pWord.word, pWord.r, pWord.c, pWord.direction, true) < 0) {
            return bestSolution;
        }

        applyWord(grid, pWord.word, pWord.r, pWord.c, pWord.direction);
        initialUsed.add(pWord.word);
        initialPlaced.push(pWord);
    }

    const currentCandidates = {};

    for (const length in indexedWords) {
        currentCandidates[length] = shuffleArray([...indexedWords[length]]);
    }

    function backtrack(usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS || Date.now() > deadline) {
            return;
        }

        const currentDensityScore = calculateDensityScoreFast(grid, placedWords);

        if (currentDensityScore > bestSolution.densityScore) {
            bestSolution = {
                grid: grid.map(row => [...row]),
                placedWords: [...placedWords],
                score: placedWords.length,
                densityScore: currentDensityScore
            };
        }

        const hooks = buildHooksByChar(grid, rows, cols);

        for (const length of availableLengths) {
            const candidates = currentCandidates[length];

            if (!candidates) continue;

            for (const word of candidates) {
                if (usedWords.has(word)) continue;

                for (let i = 0; i < word.length; i++) {
                    const list = hooks.get(word[i]);

                    if (!list) continue;

                    for (const hook of list) {
                        const horizontalFirst = Math.random() < 0.5;

                        for (let t = 0; t < 2; t++) {
                            const direction =
                                (t === 0) === horizontalFirst
                                    ? 'horizontal'
                                    : 'vertical';

                            const startR = direction === 'horizontal' ? hook.r : hook.r - i;
                            const startC = direction === 'horizontal' ? hook.c - i : hook.c;

                            if (canPlaceWord(grid, word, startR, startC, direction, false) < 0) {
                                continue;
                            }

                            const changed = applyWord(grid, word, startR, startC, direction);

                            usedWords.add(word);
                            placedWords.push({ word, r: startR, c: startC, direction });

                            backtrack(usedWords, placedWords);

                            placedWords.pop();
                            usedWords.delete(word);
                            undoWord(grid, changed);

                            return;
                        }
                    }
                }
            }
        }
    }

    if (initialPlacedWords.length === 0) {
        const startLength = availableLengths[0];
        const startWords = indexedWords[startLength] || [];
        const startWord = startWords[Math.floor(Math.random() * startWords.length)];

        if (startWord) {
            const centerR = Math.floor(rows / 2);
            const centerC = Math.floor(cols / 2 - startWord.length / 2);
            const directions = shuffleArray(['horizontal', 'vertical']);

            for (const dir of directions) {
                if (canPlaceWord(grid, startWord, centerR, centerC, dir, true) < 0) {
                    continue;
                }

                const changed = applyWord(grid, startWord, centerR, centerC, dir);

                initialUsed.add(startWord);
                initialPlaced.push({
                    word: startWord,
                    r: centerR,
                    c: centerC,
                    direction: dir
                });

                backtrack(initialUsed, initialPlaced);

                initialUsed.delete(startWord);
                initialPlaced.pop();
                undoWord(grid, changed);
            }
        }
    } else {
        backtrack(initialUsed, initialPlaced);
    }

    return bestSolution;
}

// =========================================================
// 2-B. 密集優先ジェネレーター
// =========================================================

// 全盤面を数え直す版(結果表示・フォールバック用)
function countDenseBlocksDetailed(grid) {
    const rows = grid.length;
    const cols = grid[0].length;

    const counts = regionDenseCounts(grid, rows, cols, 0, rows - 1, 0, cols - 1);

    return {
        block2x2: counts.b22,
        block2x3: counts.b23,
        block3x2: counts.b32,
        block3x3: counts.b33,
        score: denseScoreOf(counts)
    };
}

const DENSE_SHAPES = [
    { h: 2, w: 2, key: 'b22' },
    { h: 2, w: 3, key: 'b23' },
    { h: 3, w: 2, key: 'b32' },
    { h: 3, w: 3, key: 'b33' }
];

function denseScoreOf(c) {
    return c.b22 * 10 + (c.b23 + c.b32) * 35 + c.b33 * 120;
}

// 指定した矩形範囲(br0..br1, bc0..bc1)に触れるウィンドウだけを数える
function regionDenseCounts(grid, rows, cols, br0, br1, bc0, bc1) {
    const res = { b22: 0, b23: 0, b32: 0, b33: 0 };

    for (const { h, w, key } of DENSE_SHAPES) {
        const yMin = Math.max(0, br0 - h + 1);
        const yMax = Math.min(rows - h, br1);
        const xMin = Math.max(0, bc0 - w + 1);
        const xMax = Math.min(cols - w, bc1);

        for (let y = yMin; y <= yMax; y++) {
            for (let x = xMin; x <= xMax; x++) {
                let full = true;

                for (let dy = 0; dy < h && full; dy++) {
                    const row = grid[y + dy];

                    for (let dx = 0; dx < w; dx++) {
                        if (row[x + dx] === ' ') {
                            full = false;
                            break;
                        }
                    }
                }

                if (full) res[key]++;
            }
        }
    }

    return res;
}

function generateDenseCrossword(rows, cols, indexedWords, wordIndex, deadline = Infinity) {
    const MAX_ATTEMPTS = 80000;
    const BEAM_WIDTH = 8;
    const MAX_INITIAL_CANDIDATES_PER_LENGTH = 80;
    const MAX_INDEXED_CANDIDATES_PER_HOOK = 120;

    const maxLen = Math.max(rows, cols);

    let attemptCount = 0;

    const availableLengths = Object.keys(indexedWords)
        .map(Number)
        .filter(length => length <= maxLen)
        .sort((a, b) => b - a);

    let bestSolution = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity,
        denseInfo: null
    };

    const currentCandidates = {};

    for (const length in indexedWords) {
        currentCandidates[length] = shuffleArray([...indexedWords[length]]);
    }

    // 盤面と密集ブロック数・埋まったマス数は差分更新しながら1つを使い回す
    const grid = createEmptyGrid(rows, cols);
    const dense = { block2x2: 0, block2x3: 0, block3x2: 0, block3x3: 0, score: 0 };
    let filled = 0;

    function stateScore(placedCount) {
        const emptyCells = rows * cols - filled;

        return (
            dense.score * 10000000 +
            filled * 100000 +
            placedCount * 70000 -
            emptyCells * 100
        );
    }

    function updateBest(placedWords) {
        const currentScore = stateScore(placedWords.length);

        if (currentScore > bestSolution.densityScore) {
            bestSolution = {
                grid: grid.map(row => [...row]),
                placedWords: [...placedWords],
                score: placedWords.length,
                densityScore: currentScore,
                denseInfo: { ...dense }
            };
        }
    }

    // 配置候補を評価する(盤面は最終的に元へ戻す)。置けなければ null
    function evaluateCandidate(word, r, c, direction, isFirst, placedCount, seen) {
        const len = word.length;
        const vertical = direction === 'vertical';
        const dr = vertical ? 1 : 0;
        const dc = vertical ? 0 : 1;

        if (r < 0 || c < 0 || r + dr * (len - 1) >= rows || c + dc * (len - 1) >= cols) {
            return null;
        }

        const br = r - dr;
        const bc = c - dc;

        if (br >= 0 && bc >= 0 && grid[br][bc] !== ' ') return null;

        const ar = r + dr * len;
        const ac = c + dc * len;

        if (ar < rows && ac < cols && grid[ar][ac] !== ' ') return null;

        let intersectionCount = 0;
        let newCellCount = 0;

        for (let i = 0; i < len; i++) {
            const existing = grid[r + dr * i][c + dc * i];

            if (existing === ' ') {
                newCellCount++;
            } else if (existing !== word[i]) {
                return null;
            } else {
                intersectionCount++;
            }
        }

        if (!isFirst && intersectionCount === 0) return null;
        if (newCellCount === 0) return null;

        if (seen) {
            const key = `${word}|${r}|${c}|${direction}`;

            if (seen.has(key)) return null;

            seen.add(key);
        }

        const br0 = r;
        const br1 = r + dr * (len - 1);
        const bc0 = c;
        const bc1 = c + dc * (len - 1);

        const before = regionDenseCounts(grid, rows, cols, br0, br1, bc0, bc1);
        const changed = applyWord(grid, word, r, c, direction);
        const after = regionDenseCounts(grid, rows, cols, br0, br1, bc0, bc1);

        undoWord(grid, changed);

        const g22 = after.b22 - before.b22;
        const g23 = after.b23 - before.b23;
        const g32 = after.b32 - before.b32;
        const g33 = after.b33 - before.b33;
        const gain = g22 * 10 + (g23 + g32) * 35 + g33 * 120;

        const score =
            g33 * 100000000 +
            g23 * 20000000 +
            g32 * 20000000 +
            g22 * 5000000 +
            gain * 100000 +
            intersectionCount * 300000 +
            newCellCount * 50000 +
            (placedCount + 1) * 1000;

        return { word, r, c, direction, score, g22, g23, g32, g33, gain, newCellCount };
    }

    function commit(p) {
        const changed = applyWord(grid, p.word, p.r, p.c, p.direction);

        dense.block2x2 += p.g22;
        dense.block2x3 += p.g23;
        dense.block3x2 += p.g32;
        dense.block3x3 += p.g33;
        dense.score += p.gain;
        filled += p.newCellCount;

        return changed;
    }

    function revert(p, changed) {
        undoWord(grid, changed);

        dense.block2x2 -= p.g22;
        dense.block2x3 -= p.g23;
        dense.block3x2 -= p.g32;
        dense.block3x3 -= p.g33;
        dense.score -= p.gain;
        filled -= p.newCellCount;
    }

    function topPlacements(placements) {
        return placements
            .sort((a, b) => b.score - a.score)
            .slice(0, BEAM_WIDTH);
    }

    function getInitialPlacements(usedWords, placedCount) {
        const placements = [];

        for (const length of availableLengths) {
            const candidates = currentCandidates[length];

            if (!candidates) continue;

            const limit = Math.min(candidates.length, MAX_INITIAL_CANDIDATES_PER_LENGTH);

            for (let k = 0; k < limit; k++) {
                const word = candidates[k];

                if (usedWords.has(word)) continue;

                for (const direction of ['horizontal', 'vertical']) {
                    const startR =
                        direction === 'horizontal'
                            ? Math.floor(rows / 2)
                            : Math.floor(rows / 2 - word.length / 2);

                    const startC =
                        direction === 'horizontal'
                            ? Math.floor(cols / 2 - word.length / 2)
                            : Math.floor(cols / 2);

                    const p = evaluateCandidate(
                        word, startR, startC, direction, true, placedCount, null
                    );

                    if (p) placements.push(p);
                }
            }
        }

        return topPlacements(placements);
    }

    function getNextPlacements(usedWords, placedCount) {
        const placements = [];
        const seen = new Set();
        const hookPoints = [];
        const centerR = rows / 2;
        const centerC = cols / 2;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] !== ' ') {
                    hookPoints.push({
                        r,
                        c,
                        char: grid[r][c],
                        d: (r - centerR) * (r - centerR) + (c - centerC) * (c - centerC)
                    });
                }
            }
        }

        hookPoints.sort((a, b) => a.d - b.d);

        for (const hook of hookPoints) {
            const indexed = wordIndex[hook.char];

            if (!indexed) continue;

            let taken = 0;

            for (let k = 0; k < indexed.length && taken < MAX_INDEXED_CANDIDATES_PER_HOOK; k++) {
                const item = indexed[k];

                if (item.length > maxLen) continue;

                taken++;

                if (usedWords.has(item.word)) continue;

                for (const direction of ['horizontal', 'vertical']) {
                    const startR = direction === 'horizontal' ? hook.r : hook.r - item.pos;
                    const startC = direction === 'horizontal' ? hook.c - item.pos : hook.c;

                    const p = evaluateCandidate(
                        item.word, startR, startC, direction, false, placedCount, seen
                    );

                    if (p) placements.push(p);
                }
            }
        }

        return topPlacements(placements);
    }

    function backtrack(usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS) return;

        if ((attemptCount & 31) === 0 && Date.now() > deadline) {
            attemptCount = MAX_ATTEMPTS + 1;
            return;
        }

        updateBest(placedWords);

        const placements =
            placedWords.length === 0
                ? getInitialPlacements(usedWords, placedWords.length)
                : getNextPlacements(usedWords, placedWords.length);

        for (const p of placements) {
            const changed = commit(p);

            usedWords.add(p.word);
            placedWords.push({
                word: p.word,
                r: p.r,
                c: p.c,
                direction: p.direction
            });

            backtrack(usedWords, placedWords);

            placedWords.pop();
            usedWords.delete(p.word);
            revert(p, changed);
        }
    }

    backtrack(new Set(), []);

    return bestSolution;
}

// =========================================================
// 3. ソルバー(ビットセット + 前向き検査 + MRV)
// =========================================================

function getWordSlots(pattern) {
    const rows = pattern.length;
    const cols = pattern[0].length;

    const wordSlots = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (pattern[r][c] === 1) {
                if (
                    (c === 0 || pattern[r][c - 1] === 0) &&
                    c < cols - 1 &&
                    pattern[r][c + 1] === 1
                ) {
                    let length = 0;

                    for (let i = c; i < cols; i++) {
                        if (pattern[r][i] === 1) {
                            length++;
                        } else {
                            break;
                        }
                    }

                    wordSlots.push({
                        index: wordSlots.length,
                        position: { r, c },
                        direction: 'horizontal',
                        length,
                        intersections: []
                    });
                }

                if (
                    (r === 0 || pattern[r - 1][c] === 0) &&
                    r < rows - 1 &&
                    pattern[r + 1][c] === 1
                ) {
                    let length = 0;

                    for (let i = r; i < rows; i++) {
                        if (pattern[i][c] === 1) {
                            length++;
                        } else {
                            break;
                        }
                    }

                    wordSlots.push({
                        index: wordSlots.length,
                        position: { r, c },
                        direction: 'vertical',
                        length,
                        intersections: []
                    });
                }
            }
        }
    }

    for (let i = 0; i < wordSlots.length; i++) {
        const slotA = wordSlots[i];

        for (let j = i + 1; j < wordSlots.length; j++) {
            const slotB = wordSlots[j];

            if (slotA.direction !== slotB.direction) {
                const horiz = slotA.direction === 'horizontal' ? slotA : slotB;
                const vert = slotA.direction === 'vertical' ? slotA : slotB;

                const vertStartR = vert.position.r;
                const vertEndR = vert.position.r + vert.length - 1;
                const horizStartC = horiz.position.c;
                const horizEndC = horiz.position.c + horiz.length - 1;

                const crossR = horiz.position.r;
                const crossC = vert.position.c;

                if (
                    crossR >= vertStartR &&
                    crossR <= vertEndR &&
                    crossC >= horizStartC &&
                    crossC <= horizEndC
                ) {
                    const posA =
                        slotA.direction === 'horizontal'
                            ? crossC - horizStartC
                            : crossR - vertStartR;

                    const posB =
                        slotB.direction === 'horizontal'
                            ? crossC - horizStartC
                            : crossR - vertStartR;

                    slotA.intersections.push({
                        otherSlotIndex: slotB.index,
                        thisPos: posA,
                        otherPos: posB
                    });

                    slotB.intersections.push({
                        otherSlotIndex: slotA.index,
                        thisPos: posB,
                        otherPos: posA
                    });
                }
            }
        }
    }

    return wordSlots;
}

function popcnt(bs) {
    let c = 0;

    for (let i = 0; i < bs.length; i++) {
        let v = bs[i];
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        c += Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    return c;
}

function isEmptyBitset(bs) {
    for (let i = 0; i < bs.length; i++) {
        if (bs[i] !== 0) return false;
    }

    return true;
}

function solveCrossword(pattern, listUsedName, opts = {}) {
    const maxSolutions = opts.maxSolutions ?? 200;
    const timeLimitMs = opts.timeLimitMs ?? 5000;

    const idx = solverIndex[listUsedName];
    const rows = pattern.length;
    const cols = pattern[0].length;
    const slots = getWordSlots(pattern);
    const n = slots.length;

    const solutions = [];
    let truncated = false;

    if (n === 0) return { solutions, truncated };

    const info = slots.map(s => idx[s.length]);

    // 辞書に存在しない長さのスロットがあれば解なし
    if (info.some(x => !x)) return { solutions, truncated };

    // 深さごとに候補集合を保持(再帰中に new しない)
    const domains = Array.from({ length: n + 1 }, () =>
        info.map(inf => new Uint32Array(inf.nW))
    );

    for (let i = 0; i < n; i++) {
        domains[0][i].set(info[i].full);
    }

    const assigned = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const deadline = Date.now() + timeLimitMs;
    let nodes = 0;

    function recordSolution() {
        const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));

        for (let i = 0; i < n; i++) {
            const s = slots[i];
            const word = info[i].words[assigned[i]];

            for (let k = 0; k < s.length; k++) {
                const r = s.position.r + (s.direction === 'vertical' ? k : 0);
                const c = s.position.c + (s.direction === 'horizontal' ? k : 0);
                grid[r][c] = word[k];
            }
        }

        solutions.push(grid);

        if (solutions.length >= maxSolutions) truncated = true;
    }

    function dfs(depth) {
        if (truncated) return;

        if ((++nodes & 1023) === 0 && Date.now() > deadline) {
            truncated = true;
            return;
        }

        const cur = domains[depth];

        // MRV: 候補が最小のスロットを選ぶ
        let best = -1;
        let bestCnt = Infinity;

        for (let i = 0; i < n; i++) {
            if (done[i]) continue;

            const c = popcnt(cur[i]);

            if (c === 0) return;

            if (c < bestCnt) {
                bestCnt = c;
                best = i;
            }
        }

        if (best === -1) {
            recordSolution();
            return;
        }

        const slot = slots[best];
        const dom = cur[best];
        const inf = info[best];
        const next = domains[depth + 1];

        done[best] = 1;

        for (let b = 0; b < dom.length && !truncated; b++) {
            let v = dom[b];

            while (v !== 0 && !truncated) {
                const low = v & -v;
                const wi = (b << 5) + (31 - Math.clz32(low));
                v ^= low;

                const word = inf.words[wi];

                for (let k = 0; k < n; k++) next[k].set(cur[k]);

                let ok = true;

                // 交差スロットを絞り込む(前向き検査)
                for (const x of slot.intersections) {
                    const o = x.otherSlotIndex;

                    if (done[o]) continue;

                    const m = info[o].byPosChar[x.otherPos].get(word[x.thisPos]);

                    if (!m) { ok = false; break; }

                    const d = next[o];
                    let any = 0;

                    for (let t = 0; t < d.length; t++) {
                        d[t] &= m[t];
                        any |= d[t];
                    }

                    if (any === 0) { ok = false; break; }
                }

                // 同じ単語を重複して使わない
                if (ok) {
                    for (let o = 0; o < n; o++) {
                        if (done[o] || o === best || slots[o].length !== slot.length) continue;

                        const d = next[o];
                        d[wi >>> 5] &= ~(1 << (wi & 31));

                        if (isEmptyBitset(d)) { ok = false; break; }
                    }
                }

                if (!ok) continue;

                assigned[best] = wi;
                dfs(depth + 1);
                assigned[best] = -1;
            }
        }

        done[best] = 0;
    }

    dfs(0);

    return { solutions, truncated };
}

// =========================================================
// 4. API エンドポイント
// =========================================================

// 通常 自動生成API
app.post('/generate', (req, res) => {
    const { rows, cols, listName } = req.body;

    if (
        !rows ||
        !cols ||
        rows < 5 ||
        cols < 5 ||
        rows > 20 ||
        cols > 20
    ) {
        return res.status(400).send({
            error: '縦横のマス目の数は5から20の間で指定してください。'
        });
    }

    const listUsedName =
        Object.hasOwn(indexedWordLists, listName)
            ? listName
            : 'pokemon';

    const currentWordList = indexedWordLists[listUsedName];

    let currentBestResult = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity
    };

    const NUM_RESTARTS = 30;
    const MAX_REPLACEMENT_ROUNDS = 5;

    let finalResult = null;

    const deadline = Date.now() + GEN_TIME_LIMIT_MS;

    for (let i = 0; i < NUM_RESTARTS; i++) {
        if (i > 0 && Date.now() > deadline) break;

        const result = generateCrossword(rows, cols, currentWordList, [], deadline);

        if (result.densityScore > currentBestResult.densityScore) {
            currentBestResult = result;
        }
    }

    let rounds = 0;

    while (rounds < MAX_REPLACEMENT_ROUNDS) {
        if (Date.now() > deadline) break;

        rounds++;

        const { isolatedCells } =
            countIsolatedEmptyBlocks(currentBestResult.grid);

        const untouchedWords =
            getUntouchedWords(currentBestResult.placedWords, isolatedCells);

        if (untouchedWords.length === 0) {
            finalResult = currentBestResult;
            break;
        }

        if (untouchedWords.length === currentBestResult.placedWords.length) {
            break;
        }

        const wordsToKeep = currentBestResult.placedWords.filter(
            pWord => !untouchedWords.includes(pWord)
        );

        let restartResult = {
            densityScore: -Infinity
        };

        for (let i = 0; i < 5; i++) {
            const result = generateCrossword(
                rows,
                cols,
                currentWordList,
                wordsToKeep,
                deadline
            );

            if (result.densityScore > restartResult.densityScore) {
                restartResult = result;
            }
        }

        if (restartResult.densityScore > currentBestResult.densityScore) {
            currentBestResult = restartResult;
        } else {
            break;
        }
    }

    const resultToDisplay = finalResult || currentBestResult;

    const { isolatedCells } = countIsolatedEmptyBlocks(resultToDisplay.grid);
    const finalUntouchedWords =
        getUntouchedWords(resultToDisplay.placedWords, isolatedCells);

    if (isolatedCells.size === 0 || finalUntouchedWords.length > 0) {
        const warning =
            finalUntouchedWords.length > 0
                ? '全ての単語を孤立ブロックに接させることができませんでした。不合格な単語が残っています。'
                : '要件を満たす孤立した空きマス塊のあるパズルが見つかりませんでした。';

        return res.json({
            grid: gridToDisplay(createEmptyGrid(rows, cols)),
            placedWords: [],
            score: 0,
            listUsed: displayListName(listUsedName),
            warning
        });
    }

    res.json({
        grid: gridToDisplay(resultToDisplay.grid),
        placedWords: resultToDisplay.placedWords,
        score: resultToDisplay.score,
        listUsed: displayListName(listUsedName),
        mode: 'normal'
    });
});

// 密集優先 自動生成API
app.post('/generate-dense', (req, res) => {
    const { rows, cols, listName } = req.body;

    if (
        !rows ||
        !cols ||
        rows < 5 ||
        cols < 5 ||
        rows > 20 ||
        cols > 20
    ) {
        return res.status(400).send({
            error: '縦横のマス目の数は5から20の間で指定してください。'
        });
    }

    const listUsedName =
        Object.hasOwn(indexedWordLists, listName)
            ? listName
            : 'pokemon';

    const currentWordList = indexedWordLists[listUsedName];
    const currentWordIndex = denseWordIndex[listUsedName] || {};

    let bestResult = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity,
        denseInfo: null
    };

    const NUM_RESTARTS = 16;

    const deadline = Date.now() + GEN_TIME_LIMIT_MS;

    for (let i = 0; i < NUM_RESTARTS; i++) {
        if (i > 0 && Date.now() > deadline) break;

        const result = generateDenseCrossword(
            rows,
            cols,
            currentWordList,
            currentWordIndex,
            Math.min(deadline, Date.now() + DENSE_RUN_TIME_LIMIT_MS)
        );

        if (result.densityScore > bestResult.densityScore) {
            bestResult = result;
        }
    }

    res.json({
        grid: gridToDisplay(bestResult.grid),
        placedWords: bestResult.placedWords,
        score: bestResult.score,
        densityScore: bestResult.densityScore,
        denseInfo: bestResult.denseInfo || countDenseBlocksDetailed(bestResult.grid),
        listUsed: displayListName(listUsedName),
        mode: 'dense'
    });
});

// パターン解法API
app.post('/solve', (req, res) => {
    const { pattern, listName } = req.body;

    const valid =
        Array.isArray(pattern) &&
        pattern.length >= 2 && pattern.length <= 15 &&
        pattern.every(row =>
            Array.isArray(row) &&
            row.length === pattern[0].length &&
            row.length >= 2 && row.length <= 15 &&
            row.every(v => v === 0 || v === 1)
        );

    if (!valid) {
        return res.status(400).send({ error: '無効なパターンデータです。' });
    }

    const listUsedName =
        Object.hasOwn(solverIndex, listName)
            ? listName
            : 'pokemon';

    const { solutions, truncated } = solveCrossword(pattern, listUsedName, {
        maxSolutions: 200,
        timeLimitMs: 5000
    });

    if (solutions.length === 0) {
        return res.json({
            solutions: [],
            warning: truncated
                ? '制限時間内に解が見つかりませんでした。パターンを簡単にしてみてください。'
                : '解が見つかりませんでした。パターンや辞書を変えてみてください。'
        });
    }

    res.json({
        solutions,
        truncated,
        listUsed: displayListName(listUsedName)
    });
});

app.listen(port, () => {
    console.log('統合サーバーが起動しました 🚀');
    console.log(`ブラウザで http://localhost:${port}/ にアクセスしてください`);
});